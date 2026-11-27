import { runGit } from "./run-git.js";

export type PushResult =
  | { ok: true; remote: string; remoteBranch: string }
  | { ok: false; warning: string };

/**
 * Structured outcome of publishing the active branch to its configured
 * upstream. On skip and failure cases `skipped` distinguishes "the push was
 * never attempted" from "the push was attempted and failed", and `detail` is
 * the plain explanation without any action-level message prefix.
 */
export type UpstreamPushOutcome =
  | { ok: true; remote: string; remoteBranch: string }
  | { ok: false; skipped: boolean; detail: string };

/**
 * Current branch name, or null when HEAD is detached.
 */
async function currentBranch(repoPath: string, verbose: boolean): Promise<string | null> {
  try {
    const { stdout } = await runGit(["symbolic-ref", "--quiet", "--short", "HEAD"], {
      cwd: repoPath,
      verbose,
    });
    const name = stdout.trim();
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

/**
 * Value of a git config key, or null when it is unset (git exits non-zero).
 */
async function gitConfigGet(
  repoPath: string,
  key: string,
  verbose: boolean,
): Promise<string | null> {
  try {
    const { stdout } = await runGit(["config", "--get", key], { cwd: repoPath, verbose });
    const value = stdout.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

async function remoteExists(repoPath: string, remote: string, verbose: boolean): Promise<boolean> {
  try {
    await runGit(["remote", "get-url", remote], { cwd: repoPath, verbose });
    return true;
  } catch {
    return false;
  }
}

function shortRemoteBranch(mergeRef: string): string {
  const prefix = "refs/heads/";
  return mergeRef.startsWith(prefix) ? mergeRef.slice(prefix.length) : mergeRef;
}

/**
 * Publish only the active branch to its configured upstream destination.
 *
 * The destination is resolved from the branch's own git configuration
 * (`branch.<name>.remote` and `branch.<name>.merge`); the remote name and the
 * remote branch name are never assumed. The branch is published with an
 * explicit single-ref refspec, so no other references are pushed regardless of
 * `push.default`. The push never forces and never changes git configuration.
 *
 * On a detached HEAD, a missing upstream, a local-only tracking ref, or a
 * missing remote, the push is skipped with no destination invented. On a push
 * error the outcome is a failure instead of a thrown error, so the caller
 * decides how to report it. The local repository is never modified.
 */
export async function pushActiveBranchToUpstream(
  repoPath: string,
  verbose = false,
): Promise<UpstreamPushOutcome> {
  const branch = await currentBranch(repoPath, verbose);
  if (branch === null) {
    return { ok: false, skipped: true, detail: "HEAD is detached, no branch to publish" };
  }

  const remote = await gitConfigGet(repoPath, `branch.${branch}.remote`, verbose);
  const mergeRef = await gitConfigGet(repoPath, `branch.${branch}.merge`, verbose);

  if (remote === null || mergeRef === null) {
    return {
      ok: false,
      skipped: true,
      detail: `no upstream configured for branch ${branch}`,
    };
  }

  if (remote === ".") {
    return {
      ok: false,
      skipped: true,
      detail: `branch ${branch} tracks a local ref, not a remote`,
    };
  }

  if (!(await remoteExists(repoPath, remote, verbose))) {
    return {
      ok: false,
      skipped: true,
      detail: `configured remote ${remote} for branch ${branch} does not exist`,
    };
  }

  try {
    await runGit(["push", remote, `refs/heads/${branch}:${mergeRef}`], {
      cwd: repoPath,
      verbose,
    });
    return { ok: true, remote, remoteBranch: shortRemoteBranch(mergeRef) };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Combined-action view of `pushActiveBranchToUpstream`: soft warnings use the
 * gitCommit wording ("Committed; push skipped/failed: ...") because the branch
 * has already been committed when the push step runs.
 */
export async function pushCurrentBranch(repoPath: string, verbose = false): Promise<PushResult> {
  const outcome = await pushActiveBranchToUpstream(repoPath, verbose);
  if (outcome.ok) {
    return outcome;
  }

  const stage = outcome.skipped ? "push skipped" : "push failed";
  return { ok: false, warning: `Committed; ${stage}: ${outcome.detail}` };
}
