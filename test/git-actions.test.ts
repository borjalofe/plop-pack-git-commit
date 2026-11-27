import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import nodePlop from "node-plop";
import type { NodePlopAPI } from "node-plop";
import { afterEach, describe, expect, it } from "vitest";
import registerGitCommitPack from "../src/index.js";
import { runGit } from "../src/lib/run-git.js";

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
  const bareDir = await createTempDir("plop-git-actions-bare-");
  await runGit(["init", "--bare", "-b", "main"], { cwd: bareDir });
  return bareDir;
}

async function setUpstream(
  repoPath: string,
  branch: string,
  remote: string,
  mergeRef: string,
): Promise<void> {
  await runGit(["config", `branch.${branch}.remote`, remote], { cwd: repoPath });
  await runGit(["config", `branch.${branch}.merge`, mergeRef], { cwd: repoPath });
}

async function commitAll(repoPath: string, message: string): Promise<void> {
  await runGit(["add", "-A"], { cwd: repoPath });
  await runGit(["commit", "-m", message], { cwd: repoPath });
}

async function setUpPackageRepo(
  prefix: string,
  branch = "main",
): Promise<{ repoPath: string; bareDir: string }> {
  const bareDir = await createBareRemote();
  const repoPath = await createTempDir(prefix);
  await initGitRepo(repoPath, branch);
  await runGit(["remote", "add", "origin", bareDir], { cwd: repoPath });
  return { repoPath, bareDir };
}

/**
 * Calling convention of a registered action used by these tests. node-plop
 * declares its own CustomActionFunction with three required parameters, but the
 * registry hands back the action function itself, invoked with answers and
 * config at runtime.
 */
type RegisteredAction = (
  answers: unknown,
  config: Record<string, unknown>,
) => Promise<string> | string;

async function action(name: string): Promise<RegisteredAction> {
  const plop: NodePlopAPI = await nodePlop("");
  registerGitCommitPack(plop);
  const registered = plop.getActionType(name);
  return registered as unknown as RegisteredAction;
}

async function localCommitCount(repoPath: string): Promise<string> {
  const { stdout } = await runGit(["rev-list", "--count", "HEAD"], { cwd: repoPath });
  return stdout.trim();
}

describe("registered plop actions", () => {
  it("registers the commit, push, commit-and-push and gitCommit action types", async () => {
    const plop: NodePlopAPI = await nodePlop("");
    registerGitCommitPack(plop);

    expect(plop.getActionTypeList()).toEqual(
      expect.arrayContaining(["commit", "push", "commit-and-push", "gitCommit"]),
    );
    for (const name of ["commit", "push", "commit-and-push", "gitCommit"]) {
      expect(typeof plop.getActionType(name)).toBe("function");
    }
  });

  describe("hook integration", () => {
    for (const name of ["commit", "commit-and-push", "gitCommit"]) {
      it(`${name} reports hook rejection without advancing HEAD or the upstream`, async () => {
        const { repoPath, bareDir } = await setUpPackageRepo("plop-git-actions-hook-");
        await writeFile(path.join(repoPath, "tracked.txt"), "initial\n");
        await commitAll(repoPath, "initial");
        await runGit(["push", "-u", "origin", "main"], { cwd: repoPath });
        const before = await runGit(["rev-parse", "HEAD"], { cwd: repoPath });
        const hook = path.join(repoPath, ".git", "hooks", "pre-commit");
        await writeFile(
          hook,
          "#!/bin/sh\nprintf 'HOOK_STDOUT\\n'\nprintf 'HOOK_STDERR\\n' >&2\nexit 1\n",
        );
        await chmod(hook, 0o755);
        await writeFile(path.join(repoPath, "tracked.txt"), "pending\n");

        const run = await action(name);
        const result = Promise.resolve().then(() =>
          run({}, { path: repoPath, message: "must reject", files: "tracked.txt" }),
        );
        await expect(result).rejects.toThrow(/pre-commit hook/);
        await expect(result).rejects.toThrow("HOOK_STDOUT");
        await expect(result).rejects.toThrow("HOOK_STDERR");
        await expect(result).rejects.toThrow("inspect git status");
        await expect(result).rejects.toThrow("re-stage");
        const after = await runGit(["rev-parse", "HEAD"], { cwd: repoPath });
        const remote = await runGit(["rev-parse", "refs/heads/main"], { cwd: bareDir });
        expect(after.stdout).toBe(before.stdout);
        expect(remote.stdout).toBe(before.stdout);
        const staged = await runGit(["diff", "--cached", "--name-only"], { cwd: repoPath });
        expect(staged.stdout.trim()).toBe("tracked.txt");
        expect(await readFile(path.join(repoPath, "tracked.txt"), "utf8")).toBe("pending\n");
      });
    }

    it("push ignores a rejecting pre-commit hook and preserves pending files and index", async () => {
      const { repoPath, bareDir } = await setUpPackageRepo("plop-git-actions-push-hook-");
      await writeFile(path.join(repoPath, "tracked.txt"), "initial\n");
      await commitAll(repoPath, "initial");
      await setUpstream(repoPath, "main", "origin", "refs/heads/main");
      const before = await runGit(["rev-parse", "HEAD"], { cwd: repoPath });
      const hook = path.join(repoPath, ".git", "hooks", "pre-commit");
      await writeFile(hook, "#!/bin/sh\nprintf 'HOOK_MUST_NOT_RUN\\n' >&2\nexit 1\n");
      await chmod(hook, 0o755);
      await writeFile(path.join(repoPath, "tracked.txt"), "pending\n");
      await runGit(["add", "tracked.txt"], { cwd: repoPath });
      const indexBefore = await runGit(["diff", "--cached"], { cwd: repoPath });
      const run = await action("push");
      expect(await run({}, { path: repoPath })).toBe("Pushed to origin/main");
      const after = await runGit(["rev-parse", "HEAD"], { cwd: repoPath });
      const remote = await runGit(["rev-parse", "refs/heads/main"], { cwd: bareDir });
      const indexAfter = await runGit(["diff", "--cached"], { cwd: repoPath });
      expect(after.stdout).toBe(before.stdout);
      expect(remote.stdout).toBe(before.stdout);
      expect(indexAfter.stdout).toBe(indexBefore.stdout);
      expect(await readFile(path.join(repoPath, "tracked.txt"), "utf8")).toBe("pending\n");
    });
  });

  describe("commit action", () => {
    it("stages the listed files, commits locally and never pushes to a configured upstream", async () => {
      const { repoPath, bareDir } = await setUpPackageRepo("plop-git-actions-commit-");
      await writeFile(path.join(repoPath, "tracked.txt"), "tracked\n");
      await writeFile(path.join(repoPath, "other.txt"), "other\n");
      await commitAll(repoPath, "initial");
      await setUpstream(repoPath, "main", "origin", "refs/heads/main");

      await writeFile(path.join(repoPath, "tracked.txt"), "updated\n");
      await writeFile(path.join(repoPath, "other.txt"), "new other\n");

      const run = await action("commit");
      const message = await run(
        {},
        { path: repoPath, message: "commit only", files: "tracked.txt" },
      );

      expect(message).toBe("Committed: commit only");
      const log = await runGit(["log", "-1", "--pretty=format:%s"], { cwd: repoPath });
      expect(log.stdout.trim()).toBe("commit only");
      expect(await localCommitCount(repoPath)).toBe("2");

      await expect(
        runGit(["rev-parse", "--verify", "refs/heads/main"], { cwd: bareDir }),
      ).rejects.toThrow();
    });

    it("stages all pending changes when all is true", async () => {
      const repoPath = await createTempDir("plop-git-actions-commit-");
      await initGitRepo(repoPath);
      await writeFile(path.join(repoPath, "tracked.txt"), "tracked\n");
      await commitAll(repoPath, "initial");

      await writeFile(path.join(repoPath, "tracked.txt"), "updated\n");
      await writeFile(path.join(repoPath, "new.txt"), "new\n");

      const run = await action("commit");
      const message = await run({}, { path: repoPath, message: "commit everything", all: true });

      expect(message).toBe("Committed: commit everything");
      const status = await runGit(["status", "--porcelain"], { cwd: repoPath });
      expect(status.stdout.trim()).toBe("");
      const log = await runGit(["log", "-1", "--pretty=format:%s"], { cwd: repoPath });
      expect(log.stdout.trim()).toBe("commit everything");
    });

    it("resolves with exactly 'Nothing to commit' when the tree is clean and skipEmpty defaults to true", async () => {
      const repoPath = await createTempDir("plop-git-actions-commit-");
      await initGitRepo(repoPath);
      await writeFile(path.join(repoPath, "file.txt"), "content\n");
      await commitAll(repoPath, "initial");

      const run = await action("commit");
      const message = await run({}, { path: repoPath, message: "noop", all: true });

      expect(message).toBe("Nothing to commit");
    });

    it("throws when skipEmpty is false and there is nothing to commit", async () => {
      const repoPath = await createTempDir("plop-git-actions-commit-");
      await initGitRepo(repoPath);

      const run = await action("commit");
      await expect(
        run({}, { path: repoPath, message: "noop", all: true, skipEmpty: false }),
      ).rejects.toThrow("Nothing to commit");
    });

    it("throws an actionable config error when neither files nor all is provided", async () => {
      const repoPath = await createTempDir("plop-git-actions-commit-");
      await initGitRepo(repoPath);

      const run = await action("commit");
      await expect(run({}, { path: repoPath, message: "test" })).rejects.toThrow(
        "Invalid commit config",
      );
    });
  });

  describe("push action", () => {
    it("publishes only the active branch to its configured upstream and pushes no other references", async () => {
      const { repoPath, bareDir } = await setUpPackageRepo("plop-git-actions-push-", "work");
      await writeFile(path.join(repoPath, "tracked.txt"), "one\n");
      await commitAll(repoPath, "seed on work");

      await runGit(["checkout", "-b", "other"], { cwd: repoPath });
      await writeFile(path.join(repoPath, "other.txt"), "other\n");
      await commitAll(repoPath, "other branch commit");
      await runGit(["checkout", "work"], { cwd: repoPath });

      await writeFile(path.join(repoPath, "work.txt"), "work change\n");
      await commitAll(repoPath, "work branch commit");
      await setUpstream(repoPath, "work", "upstream", "refs/heads/published");
      await runGit(["remote", "add", "upstream", bareDir], { cwd: repoPath });

      const run = await action("push");
      const message = await run({}, { path: repoPath });

      expect(message).toBe("Pushed to upstream/published");
      const published = await runGit(["log", "-1", "--pretty=format:%s", "refs/heads/published"], {
        cwd: bareDir,
      });
      expect(published.stdout.trim()).toBe("work branch commit");

      await expect(
        runGit(["rev-parse", "--verify", "refs/heads/work"], { cwd: bareDir }),
      ).rejects.toThrow();
      await expect(
        runGit(["rev-parse", "--verify", "refs/heads/other"], { cwd: bareDir }),
      ).rejects.toThrow();
    });

    it("never creates commits, even with a dirty tree and a configured upstream", async () => {
      const { repoPath, bareDir } = await setUpPackageRepo("plop-git-actions-push-");
      await writeFile(path.join(repoPath, "tracked.txt"), "tracked\n");
      await commitAll(repoPath, "initial");
      await setUpstream(repoPath, "main", "origin", "refs/heads/main");

      await writeFile(path.join(repoPath, "tracked.txt"), "updated\n");
      const headBefore = await runGit(["rev-parse", "HEAD"], { cwd: repoPath });

      const run = await action("push");
      const message = await run({}, { path: repoPath });

      expect(message).toBe("Pushed to origin/main");
      expect(await localCommitCount(repoPath)).toBe("1");
      const headAfter = await runGit(["rev-parse", "HEAD"], { cwd: repoPath });
      expect(headAfter.stdout.trim()).toBe(headBefore.stdout.trim());
      const status = await runGit(["status", "--porcelain"], { cwd: repoPath });
      expect(status.stdout).toContain(" M tracked.txt");
      const pushed = await runGit(["log", "-1", "--pretty=format:%s", "refs/heads/main"], {
        cwd: bareDir,
      });
      expect(pushed.stdout.trim()).toBe("initial");
    });

    it("skips on detached HEAD without inventing a destination", async () => {
      const repoPath = await createTempDir("plop-git-actions-push-");
      await initGitRepo(repoPath);
      await writeFile(path.join(repoPath, "first.txt"), "one\n");
      await commitAll(repoPath, "base");
      const head = await runGit(["rev-parse", "HEAD"], { cwd: repoPath });
      await runGit(["checkout", head.stdout.trim()], { cwd: repoPath });

      await writeFile(path.join(repoPath, "second.txt"), "two\n");

      const run = await action("push");
      const message = await run({}, { path: repoPath });

      expect(message).toBe("Push skipped: HEAD is detached, no branch to publish");
      const log = await runGit(["log", "-1", "--pretty=format:%s"], { cwd: repoPath });
      expect(log.stdout.trim()).toBe("base");
    });

    it("warns when the active branch has no configured upstream and does not fall back to a provided origin", async () => {
      const { repoPath, bareDir } = await setUpPackageRepo("plop-git-actions-push-");
      await writeFile(path.join(repoPath, "file.txt"), "content\n");
      await commitAll(repoPath, "local only");

      const run = await action("push");
      const message = await run({}, { path: repoPath });

      expect(message).toBe("Push skipped: no upstream configured for branch main");
      await expect(
        runGit(["rev-parse", "--verify", "refs/heads/main"], { cwd: bareDir }),
      ).rejects.toThrow();
    });

    it("warns when the branch tracks a local ref instead of a remote", async () => {
      const repoPath = await createTempDir("plop-git-actions-push-");
      await initGitRepo(repoPath);
      await writeFile(path.join(repoPath, "file.txt"), "content\n");
      await commitAll(repoPath, "base");
      await runGit(["branch", "sibling"], { cwd: repoPath });
      await setUpstream(repoPath, "main", ".", "refs/heads/sibling");

      const run = await action("push");
      const message = await run({}, { path: repoPath });

      expect(message).toBe("Push skipped: branch main tracks a local ref, not a remote");
    });

    it("warns when the configured remote does not exist", async () => {
      const repoPath = await createTempDir("plop-git-actions-push-");
      await initGitRepo(repoPath);
      await writeFile(path.join(repoPath, "file.txt"), "content\n");
      await commitAll(repoPath, "missing remote");
      await setUpstream(repoPath, "main", "ghost", "refs/heads/main");

      const run = await action("push");
      const message = await run({}, { path: repoPath });

      expect(message).toBe("Push skipped: configured remote ghost for branch main does not exist");
    });

    it("resolves with a soft warning when the push itself fails", async () => {
      const repoPath = await createTempDir("plop-git-actions-push-");
      await initGitRepo(repoPath);
      await writeFile(path.join(repoPath, "file.txt"), "content\n");
      await commitAll(repoPath, "broken remote");
      await runGit(["remote", "add", "backup", "/definitely/not/a/git/remote"], { cwd: repoPath });
      await setUpstream(repoPath, "main", "backup", "refs/heads/main");

      const run = await action("push");
      const message = await run({}, { path: repoPath });

      expect(message).toContain("Push failed");
      const log = await runGit(["log", "-1", "--pretty=format:%s"], { cwd: repoPath });
      expect(log.stdout.trim()).toBe("broken remote");
    });

    it("throws an actionable config error for invalid config", async () => {
      const repoPath = await createTempDir("plop-git-actions-push-");
      await initGitRepo(repoPath);

      const run = await action("push");
      await expect(run({}, { path: repoPath, verbose: "yes" })).rejects.toThrow(
        "Invalid push config",
      );
    });
  });

  describe("commit-and-push action", () => {
    it("keeps the existing combined behavior: commit plus configured-upstream push", async () => {
      const { repoPath, bareDir } = await setUpPackageRepo("plop-git-actions-combo-");
      await writeFile(path.join(repoPath, "tracked.txt"), "tracked\n");
      await commitAll(repoPath, "initial");
      await setUpstream(repoPath, "main", "origin", "refs/heads/main");

      await writeFile(path.join(repoPath, "tracked.txt"), "updated\n");

      const run = await action("commit-and-push");
      const message = await run(
        {},
        { path: repoPath, message: "combined push message", files: "tracked.txt" },
      );

      expect(message).toBe("Committed and pushed to origin/main: combined push message");
      const pushed = await runGit(["log", "-1", "--pretty=format:%s", "refs/heads/main"], {
        cwd: bareDir,
      });
      expect(pushed.stdout.trim()).toBe("combined push message");
      expect(await localCommitCount(repoPath)).toBe("2");
      const status = await runGit(["status", "--porcelain"], { cwd: repoPath });
      expect(status.stdout.trim()).toBe("");
    });

    it("returns exactly 'Nothing to commit' and does not push when the tree is clean (skipEmpty default)", async () => {
      const { repoPath, bareDir } = await setUpPackageRepo("plop-git-actions-combo-");
      await writeFile(path.join(repoPath, "tracked.txt"), "tracked\n");
      await commitAll(repoPath, "initial");
      await setUpstream(repoPath, "main", "origin", "refs/heads/main");

      const run = await action("commit-and-push");
      const message = await run({}, { path: repoPath, message: "noop", all: true });

      expect(message).toBe("Nothing to commit");
      await expect(
        runGit(["rev-parse", "--verify", "refs/heads/main"], { cwd: bareDir }),
      ).rejects.toThrow();
    });
  });

  describe("gitCommit legacy alias", () => {
    it("keeps the existing combined behavior: commit plus configured-upstream push", async () => {
      const { repoPath, bareDir } = await setUpPackageRepo("plop-git-actions-alias-");
      await writeFile(path.join(repoPath, "tracked.txt"), "tracked\n");
      await commitAll(repoPath, "initial");
      await setUpstream(repoPath, "main", "origin", "refs/heads/main");

      await writeFile(path.join(repoPath, "tracked.txt"), "updated\n");

      const run = await action("gitCommit");
      const message = await run(
        {},
        { path: repoPath, message: "legacy combined commit", files: "tracked.txt" },
      );

      expect(message).toBe("Committed and pushed to origin/main: legacy combined commit");
      const pushed = await runGit(["log", "-1", "--pretty=format:%s", "refs/heads/main"], {
        cwd: bareDir,
      });
      expect(pushed.stdout.trim()).toBe("legacy combined commit");
      expect(await localCommitCount(repoPath)).toBe("2");
      const status = await runGit(["status", "--porcelain"], { cwd: repoPath });
      expect(status.stdout.trim()).toBe("");
    });

    it("returns exactly 'Nothing to commit' and does not push when the tree is clean (skipEmpty default)", async () => {
      const { repoPath, bareDir } = await setUpPackageRepo("plop-git-actions-alias-");
      await writeFile(path.join(repoPath, "tracked.txt"), "tracked\n");
      await commitAll(repoPath, "initial");
      await setUpstream(repoPath, "main", "origin", "refs/heads/main");

      const run = await action("gitCommit");
      const message = await run({}, { path: repoPath, message: "noop", all: true });

      expect(message).toBe("Nothing to commit");
      await expect(
        runGit(["rev-parse", "--verify", "refs/heads/main"], { cwd: bareDir }),
      ).rejects.toThrow();
    });
  });
});
