import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gitCommitAction } from "../src/git-commit-action.js";
import { runGit } from "../src/lib/run-git.js";
import { gitCommitConfigSchema } from "../src/schemas/git-commit-config.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function initGitRepo(dir: string, branch = "main"): Promise<void> {
  await runGit(["init", "-b", branch], { cwd: dir });
  await runGit(["config", "user.email", "test@example.com"], { cwd: dir });
  await runGit(["config", "user.name", "Test User"], { cwd: dir });
}

async function createBareRemote(): Promise<string> {
  const bareDir = await createTempDir("plop-git-commit-bare-");
  await runGit(["init", "--bare", "-b", "main"], { cwd: bareDir });
  return bareDir;
}

describe("gitCommitConfigSchema", () => {
  it("rejects when neither files nor all is provided", () => {
    const result = gitCommitConfigSchema.safeParse({
      path: "/tmp/repo",
      message: "test",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when files and all are provided together", () => {
    const result = gitCommitConfigSchema.safeParse({
      path: "/tmp/repo",
      message: "test",
      files: "a.txt",
      all: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty message", () => {
    const result = gitCommitConfigSchema.safeParse({
      path: "/tmp/repo",
      message: "   ",
      all: true,
    });
    expect(result.success).toBe(false);
  });
});

describe("gitCommitAction", () => {
  it("commits a single file when files is provided", async () => {
    const repoPath = await createTempDir("plop-git-commit-repo-");
    await initGitRepo(repoPath);
    await writeFile(path.join(repoPath, "tracked.txt"), "tracked\n");
    await writeFile(path.join(repoPath, "other.txt"), "other\n");
    await runGit(["add", "tracked.txt", "other.txt"], { cwd: repoPath });
    await runGit(["commit", "-m", "initial"], { cwd: repoPath });

    await writeFile(path.join(repoPath, "tracked.txt"), "updated\n");
    await writeFile(path.join(repoPath, "other.txt"), "new other\n");

    const message = await gitCommitAction(
      {},
      {
        path: repoPath,
        message: "update tracked only",
        files: "tracked.txt",
      },
    );

    expect(message).toContain("Committed");
    const log = await runGit(["show", "--name-only", "--pretty=format:"], { cwd: repoPath });
    expect(log.stdout.trim().split("\n")).toEqual(["tracked.txt"]);
  });

  it("stages and commits all pending changes when all is true", async () => {
    const repoPath = await createTempDir("plop-git-commit-repo-");
    await initGitRepo(repoPath);
    await writeFile(path.join(repoPath, "tracked.txt"), "tracked\n");
    await runGit(["add", "tracked.txt"], { cwd: repoPath });
    await runGit(["commit", "-m", "initial"], { cwd: repoPath });

    await writeFile(path.join(repoPath, "tracked.txt"), "updated\n");
    await writeFile(path.join(repoPath, "new.txt"), "new\n");

    await gitCommitAction(
      {},
      {
        path: repoPath,
        message: "commit everything",
        all: true,
      },
    );

    const status = await runGit(["status", "--porcelain"], { cwd: repoPath });
    expect(status.stdout.trim()).toBe("");
  });

  it("resolves without error when skipEmpty is true and there is nothing to commit", async () => {
    const repoPath = await createTempDir("plop-git-commit-repo-");
    await initGitRepo(repoPath);
    await writeFile(path.join(repoPath, "file.txt"), "content\n");
    await runGit(["add", "file.txt"], { cwd: repoPath });
    await runGit(["commit", "-m", "initial"], { cwd: repoPath });

    const message = await gitCommitAction(
      {},
      {
        path: repoPath,
        message: "noop",
        all: true,
        skipEmpty: true,
      },
    );

    expect(message).toBe("Nothing to commit");
  });

  it("throws when skipEmpty is false and there is nothing to commit", async () => {
    const repoPath = await createTempDir("plop-git-commit-repo-");
    await initGitRepo(repoPath);

    await expect(
      gitCommitAction(
        {},
        {
          path: repoPath,
          message: "noop",
          all: true,
          skipEmpty: false,
        },
      ),
    ).rejects.toThrow("Nothing to commit");
  });

  it("throws when path is not a git repository", async () => {
    const repoPath = await createTempDir("plop-git-commit-repo-");

    await expect(
      gitCommitAction(
        {},
        {
          path: repoPath,
          message: "test",
          all: true,
        },
      ),
    ).rejects.toThrow("Not a git repository");
  });

  it("throws on invalid config", async () => {
    await expect(
      gitCommitAction(
        {},
        {
          path: process.cwd(),
          message: "test",
        },
      ),
    ).rejects.toThrow("Invalid gitCommit config");
  });

  it("pushes to origin after a successful commit", async () => {
    const bareDir = await createBareRemote();
    const repoPath = await createTempDir("plop-git-commit-repo-");
    await initGitRepo(repoPath);
    await runGit(["remote", "add", "origin", bareDir], { cwd: repoPath });

    await writeFile(path.join(repoPath, "file.txt"), "content\n");

    const message = await gitCommitAction(
      {},
      {
        path: repoPath,
        message: "first commit",
        files: "file.txt",
      },
    );

    expect(message).toContain("Committed and pushed to origin");
    const bareHead = await runGit(["show-ref", "--heads", "main"], { cwd: bareDir });
    expect(bareHead.stdout.trim()).not.toBe("");
  });

  it("warns but does not throw when origin is missing", async () => {
    const repoPath = await createTempDir("plop-git-commit-repo-");
    await initGitRepo(repoPath);
    await writeFile(path.join(repoPath, "file.txt"), "content\n");

    const message = await gitCommitAction(
      {},
      {
        path: repoPath,
        message: "local only",
        files: "file.txt",
      },
    );

    expect(message).toContain("Committed; push skipped");
    const fileContents = await readFile(path.join(repoPath, "file.txt"), "utf8");
    expect(fileContents).toBe("content\n");
  });

  it("warns but does not throw when push fails", async () => {
    const repoPath = await createTempDir("plop-git-commit-repo-");
    await initGitRepo(repoPath);
    await runGit(["remote", "add", "origin", "/definitely/not/a/git/remote"], { cwd: repoPath });
    await writeFile(path.join(repoPath, "file.txt"), "content\n");

    const message = await gitCommitAction(
      {},
      {
        path: repoPath,
        message: "commit without push",
        files: "file.txt",
      },
    );

    expect(message).toContain("Committed; push failed");
    const log = await runGit(["log", "-1", "--pretty=format:%s"], { cwd: repoPath });
    expect(log.stdout.trim()).toBe("commit without push");
  });
});
