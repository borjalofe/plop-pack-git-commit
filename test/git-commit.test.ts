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

  async function setUpstream(
    repoPath: string,
    branch: string,
    remote: string,
    mergeRef: string,
  ): Promise<void> {
    await runGit(["config", `branch.${branch}.remote`, remote], { cwd: repoPath });
    await runGit(["config", `branch.${branch}.merge`, mergeRef], { cwd: repoPath });
  }

  it("publishes the active branch to its configured upstream, honoring a non-origin remote and a different remote branch name", async () => {
    const bareDir = await createBareRemote();
    const repoPath = await createTempDir("plop-git-commit-repo-");
    await initGitRepo(repoPath, "work");
    await runGit(["remote", "add", "upstream", bareDir], { cwd: repoPath });
    await setUpstream(repoPath, "work", "upstream", "refs/heads/published");

    await writeFile(path.join(repoPath, "file.txt"), "content\n");

    const message = await gitCommitAction(
      {},
      {
        path: repoPath,
        message: "first commit",
        files: "file.txt",
      },
    );

    expect(message).toContain("Committed and pushed to upstream/published");

    const published = await runGit(["log", "-1", "--pretty=format:%s", "published"], {
      cwd: bareDir,
    });
    expect(published.stdout.trim()).toBe("first commit");

    await expect(
      runGit(["rev-parse", "--verify", "refs/heads/work"], { cwd: bareDir }),
    ).rejects.toThrow();
  });

  it("does not fall back to origin when the active branch has no configured upstream", async () => {
    const bareDir = await createBareRemote();
    const repoPath = await createTempDir("plop-git-commit-repo-");
    await initGitRepo(repoPath);
    await runGit(["remote", "add", "origin", bareDir], { cwd: repoPath });

    await writeFile(path.join(repoPath, "file.txt"), "content\n");

    const message = await gitCommitAction(
      {},
      {
        path: repoPath,
        message: "local only",
        files: "file.txt",
      },
    );

    expect(message).toContain("push skipped: no upstream configured");
    await expect(
      runGit(["rev-parse", "--verify", "refs/heads/main"], { cwd: bareDir }),
    ).rejects.toThrow();
  });

  it("skips the push on a detached HEAD without inventing a destination", async () => {
    const repoPath = await createTempDir("plop-git-commit-repo-");
    await initGitRepo(repoPath);
    await writeFile(path.join(repoPath, "first.txt"), "one\n");
    await runGit(["add", "-A"], { cwd: repoPath });
    await runGit(["commit", "-m", "base"], { cwd: repoPath });
    const head = await runGit(["rev-parse", "HEAD"], { cwd: repoPath });
    await runGit(["checkout", head.stdout.trim()], { cwd: repoPath });

    await writeFile(path.join(repoPath, "second.txt"), "two\n");

    const message = await gitCommitAction(
      {},
      {
        path: repoPath,
        message: "detached commit",
        files: "second.txt",
      },
    );

    expect(message).toContain("push skipped: HEAD is detached");
    const log = await runGit(["log", "-1", "--pretty=format:%s"], { cwd: repoPath });
    expect(log.stdout.trim()).toBe("detached commit");
  });

  it("skips the push when the configured remote does not exist", async () => {
    const repoPath = await createTempDir("plop-git-commit-repo-");
    await initGitRepo(repoPath);
    await setUpstream(repoPath, "main", "ghost", "refs/heads/main");
    await writeFile(path.join(repoPath, "file.txt"), "content\n");

    const message = await gitCommitAction(
      {},
      {
        path: repoPath,
        message: "missing remote",
        files: "file.txt",
      },
    );

    expect(message).toContain("configured remote ghost");
    expect(message).toContain("does not exist");
    const log = await runGit(["log", "-1", "--pretty=format:%s"], { cwd: repoPath });
    expect(log.stdout.trim()).toBe("missing remote");
  });

  it("warns but does not throw when the push to the configured upstream fails", async () => {
    const repoPath = await createTempDir("plop-git-commit-repo-");
    await initGitRepo(repoPath);
    await runGit(["remote", "add", "backup", "/definitely/not/a/git/remote"], { cwd: repoPath });
    await setUpstream(repoPath, "main", "backup", "refs/heads/main");
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
