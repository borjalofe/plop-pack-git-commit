import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gitCommitAction } from "../src/git-commit-action.js";
import { runGit } from "../src/lib/run-git.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function createBareRemote(): Promise<string> {
  const bareDir = await createTempDir("plop-git-hooks-bare-");
  await runGit(["init", "--bare", "-b", "main"], { cwd: bareDir });
  return bareDir;
}

async function initGitRepo(dir: string): Promise<void> {
  await runGit(["init", "-b", "main"], { cwd: dir });
  await runGit(["config", "user.email", "test@example.com"], { cwd: dir });
  await runGit(["config", "user.name", "Test User"], { cwd: dir });
}

async function setUpstream(repoPath: string, branch: string, remote: string): Promise<void> {
  await runGit(["config", `branch.${branch}.remote`, remote], { cwd: repoPath });
  await runGit(["config", `branch.${branch}.merge`, `refs/heads/${branch}`], { cwd: repoPath });
}

async function writeHook(dir: string, script: string): Promise<void> {
  const hookPath = path.join(dir, "pre-commit");
  await writeFile(hookPath, script);
  await chmod(hookPath, 0o755);
}

const FAILING_HOOK = "echo HOOK_STDOUT_LINE\necho HOOK_STDERR_LINE >&2\nexit 1\n";
const PASSING_HOOK = "exit 0\n";

async function rejectionOf(action: Promise<string>): Promise<Error> {
  try {
    await action;
    throw new Error("expected the action to reject");
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

describe("gitCommitAction hooks", () => {
  it("rejects the action with hook diagnostics and recovery steps when the pre-commit hook fails", async () => {
    const bareDir = await createBareRemote();
    const repoPath = await createTempDir("plop-git-hooks-repo-");
    await initGitRepo(repoPath);
    await runGit(["remote", "add", "upstream", bareDir], { cwd: repoPath });
    await setUpstream(repoPath, "main", "upstream");
    await writeFile(path.join(repoPath, "tracked.txt"), "initial\n");
    await runGit(["add", "tracked.txt"], { cwd: repoPath });
    await runGit(["commit", "-m", "initial"], { cwd: repoPath });
    await runGit(["push", "upstream", "refs/heads/main"], { cwd: repoPath });
    await writeFile(path.join(repoPath, "tracked.txt"), "updated\n");
    await writeHook(path.join(repoPath, ".git", "hooks"), FAILING_HOOK);

    const error = await rejectionOf(
      gitCommitAction(
        {},
        {
          path: repoPath,
          message: "rejected by hook",
          files: "tracked.txt",
        },
      ),
    );
    const message = error.message;

    expect(message).toMatch(/pre-commit hook/);
    expect(message).toContain("HOOK_STDOUT_LINE");
    expect(message).toContain("HOOK_STDERR_LINE");
    expect(message).toContain("Fix the hook issues");
    expect(message).toContain("inspect git status");
    expect(message).toContain("re-stage any files the hook modified");
    expect(message).toContain("run the gitCommit action again");
    expect(message).not.toContain("--no-verify");

    const head = await runGit(["log", "-1", "--pretty=format:%s"], { cwd: repoPath });
    expect(head.stdout.trim()).toBe("initial");
    const remoteHead = await runGit(["log", "-1", "--pretty=format:%s", "refs/heads/main"], {
      cwd: bareDir,
    });
    expect(remoteHead.stdout.trim()).toBe("initial");
    const staged = await runGit(["diff", "--cached", "--name-only"], { cwd: repoPath });
    expect(staged.stdout.trim()).toBe("tracked.txt");
  });

  it("commits successfully when the pre-commit hook passes", async () => {
    const repoPath = await createTempDir("plop-git-hooks-repo-");
    await initGitRepo(repoPath);
    await writeFile(path.join(repoPath, "tracked.txt"), "initial\n");
    await runGit(["add", "tracked.txt"], { cwd: repoPath });
    await runGit(["commit", "-m", "initial"], { cwd: repoPath });
    await writeFile(path.join(repoPath, "tracked.txt"), "updated\n");
    await writeHook(path.join(repoPath, ".git", "hooks"), PASSING_HOOK);

    const message = await gitCommitAction(
      {},
      {
        path: repoPath,
        message: "passing hook",
        files: "tracked.txt",
      },
    );

    expect(message).toContain("Committed");
    const head = await runGit(["log", "-1", "--pretty=format:%s"], { cwd: repoPath });
    expect(head.stdout.trim()).toBe("passing hook");
  });

  it("reports the actionable rejection in verbose mode while keeping output streamed", async () => {
    const repoPath = await createTempDir("plop-git-hooks-repo-");
    await initGitRepo(repoPath);
    await writeFile(path.join(repoPath, "tracked.txt"), "initial\n");
    await runGit(["add", "tracked.txt"], { cwd: repoPath });
    await runGit(["commit", "-m", "initial"], { cwd: repoPath });
    await writeFile(path.join(repoPath, "tracked.txt"), "updated\n");
    await writeHook(
      path.join(repoPath, ".git", "hooks"),
      "echo HOOK_STREAMED_STDOUT\necho HOOK_STREAMED_STDERR >&2\nexit 1\n",
    );

    const streamed: { stdout: string[]; stderr: string[] } = { stdout: [], stderr: [] };
    const originalStdout = process.stdout.write.bind(process.stdout);
    const originalStderr = process.stderr.write.bind(process.stderr);
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
      streamed.stdout.push(String(chunk));
      return originalStdout(chunk as never);
    }) as typeof process.stdout.write);
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      streamed.stderr.push(String(chunk));
      return originalStderr(chunk as never);
    }) as typeof process.stderr.write);

    const error = await rejectionOf(
      gitCommitAction(
        {},
        {
          path: repoPath,
          message: "rejected in verbose",
          files: "tracked.txt",
          verbose: true,
        },
      ),
    );
    const streamedText = streamed.stdout.join("") + streamed.stderr.join("");

    expect(error.message).toMatch(/pre-commit hook/);
    expect(error.message).toContain("HOOK_STREAMED_STDOUT");
    expect(error.message).toContain("HOOK_STREAMED_STDERR");
    expect(error.message).toContain("Fix the hook issues");
    expect(error.message).toContain("inspect git status");
    expect(error.message).toContain("run the gitCommit action again");
    expect(streamedText).toContain("HOOK_STREAMED_STDOUT");
    expect(streamedText).toContain("HOOK_STREAMED_STDERR");

    const head = await runGit(["log", "-1", "--pretty=format:%s"], { cwd: repoPath });
    expect(head.stdout.trim()).toBe("initial");
  });

  async function runConfiguredHooksPathCase(verbose: boolean): Promise<void> {
    const repoPath = await createTempDir("plop-git-hooks-repo-");
    await initGitRepo(repoPath);
    await writeFile(path.join(repoPath, "tracked.txt"), "initial\n");
    await runGit(["add", "tracked.txt"], { cwd: repoPath });
    await runGit(["commit", "-m", "initial"], { cwd: repoPath });
    await writeFile(path.join(repoPath, "tracked.txt"), "updated\n");
    await mkdir(path.join(repoPath, "custom-hooks"));
    await writeHook(
      path.join(repoPath, "custom-hooks"),
      "echo CUSTOM_HOOKS_DIR_REJECTION >&2\nexit 1\n",
    );
    await runGit(["config", "--local", "core.hooksPath", "custom-hooks"], { cwd: repoPath });

    const streamed: string[] = [];
    const originalStdout = process.stdout.write.bind(process.stdout);
    const originalStderr = process.stderr.write.bind(process.stderr);
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
      streamed.push(String(chunk));
      return originalStdout(chunk as never);
    }) as typeof process.stdout.write);
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      streamed.push(String(chunk));
      return originalStderr(chunk as never);
    }) as typeof process.stderr.write);

    const error = await rejectionOf(
      gitCommitAction(
        {},
        {
          path: repoPath,
          message: "rejected by hooks path",
          files: "tracked.txt",
          verbose,
        },
      ),
    );

    expect(error.message).toMatch(/pre-commit hook/);
    expect(error.message).toContain("CUSTOM_HOOKS_DIR_REJECTION");
    expect(error.message).toContain("Fix the hook issues");
    expect(error.message).toContain("inspect git status");
    expect(error.message).toContain("run the gitCommit action again");

    const streamedText = streamed.join("");
    expect(streamedText).not.toMatch(/^custom-hooks(\n|$)/m);
    if (verbose) {
      expect(streamedText).toContain("CUSTOM_HOOKS_DIR_REJECTION");
    }

    const head = await runGit(["log", "-1", "--pretty=format:%s"], { cwd: repoPath });
    expect(head.stdout.trim()).toBe("initial");
    const staged = await runGit(["diff", "--cached", "--name-only"], { cwd: repoPath });
    expect(staged.stdout.trim()).toBe("tracked.txt");
  }

  it("executes the hooks configured through core.hooksPath", async () => {
    await runConfiguredHooksPathCase(false);
  });

  it("executes the hooks configured through core.hooksPath in verbose mode", async () => {
    await runConfiguredHooksPathCase(true);
  });

  it("does not attribute a non-hook commit failure to the pre-commit hook", async () => {
    const repoPath = await createTempDir("plop-git-hooks-repo-");
    await initGitRepo(repoPath);
    await writeFile(path.join(repoPath, "tracked.txt"), "initial\n");
    await runGit(["add", "tracked.txt"], { cwd: repoPath });
    await runGit(["commit", "-m", "initial"], { cwd: repoPath });
    await writeFile(path.join(repoPath, "tracked.txt"), "updated\n");
    await writeFile(path.join(repoPath, ".git", "refs", "heads", "main.lock"), "");

    const error = await rejectionOf(
      gitCommitAction(
        {},
        {
          path: repoPath,
          message: "locked ref",
          files: "tracked.txt",
        },
      ),
    );

    expect(error.message).not.toMatch(/pre-commit/);
    expect(error.message).toContain("Inspect git status");
    expect(error.message).toContain("run the gitCommit action again");
    expect(error.message).toMatch(/exit code/);

    const head = await runGit(["log", "-1", "--pretty=format:%s"], { cwd: repoPath });
    expect(head.stdout.trim()).toBe("initial");
  });

  it("does not attribute a git failure after a passing hook to the hook", async () => {
    const repoPath = await createTempDir("plop-git-hooks-repo-");
    await initGitRepo(repoPath);
    await writeFile(path.join(repoPath, "tracked.txt"), "initial\n");
    await runGit(["add", "tracked.txt"], { cwd: repoPath });
    await runGit(["commit", "-m", "initial"], { cwd: repoPath });
    await writeFile(path.join(repoPath, "tracked.txt"), "updated\n");
    await writeHook(path.join(repoPath, ".git", "hooks"), "echo hook-ran > hook-ran.log\nexit 0\n");
    await writeFile(path.join(repoPath, ".git", "refs", "heads", "main.lock"), "");

    const error = await rejectionOf(
      gitCommitAction(
        {},
        {
          path: repoPath,
          message: "locked ref with hook",
          files: "tracked.txt",
        },
      ),
    );

    expect(error.message).not.toMatch(/pre-commit/);
    expect(error.message).toContain("Inspect git status");
    const hookRan = await readFile(path.join(repoPath, "hook-ran.log"), "utf8");
    expect(hookRan.trim()).toBe("hook-ran");

    const head = await runGit(["log", "-1", "--pretty=format:%s"], { cwd: repoPath });
    expect(head.stdout.trim()).toBe("initial");
  });
});
