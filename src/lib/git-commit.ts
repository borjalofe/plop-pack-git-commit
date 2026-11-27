import { constants, access } from "node:fs/promises";
import path from "node:path";
import { type RunGitFailure, runGit } from "./run-git.js";

const DEFAULT_HOOKS_DIR = ".git/hooks";
const PRE_COMMIT_HOOK = "pre-commit";
const GIT_ISSUED_FAILURE = /^\s*(?:fatal|error): /m;

/**
 * Pre-commit hooks run because the commit call is a plain `git commit`: git
 * itself executes the configured hooks and honors `core.hooksPath`. Nothing
 * here runs hooks manually or bypasses them.
 */
async function preCommitHookExists(repoPath: string): Promise<boolean> {
  let hooksPath = DEFAULT_HOOKS_DIR;
  try {
    const { stdout } = await runGit(["config", "--get", "core.hooksPath"], {
      cwd: repoPath,
      // Always quiet: verbose mode must not stream this internal lookup's
      // configuration value, and its result must not be lost to streaming.
      capture: true,
    });
    const configured = stdout.trim();
    if (configured.length > 0) {
      hooksPath = configured;
    }
  } catch {
    // core.hooksPath unset; git falls back to the default hooks directory.
  }

  const hookFile = path.isAbsolute(hooksPath)
    ? path.join(hooksPath, PRE_COMMIT_HOOK)
    : path.join(repoPath, hooksPath, PRE_COMMIT_HOOK);

  try {
    await access(hookFile, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function hookDiagnostics(failure: RunGitFailure): string {
  const stderr = failure.stderr?.trim() ?? "";
  const stdout = failure.stdout?.trim() ?? "";
  return stderr.length > 0 ? stderr : stdout;
}

async function commitRejection(
  repoPath: string,
  verbose: boolean,
  failure: RunGitFailure,
): Promise<Error> {
  const diagnostics = hookDiagnostics(failure);
  const output = `${failure.stderr ?? ""}\n${failure.stdout ?? ""}`;
  // Git prints no message of its own when a hook exits non-zero. A
  // `fatal:` / `error:` line therefore identifies a failure git itself
  // raised; it must not be claimed to be a hook rejection.
  const gitIssued = GIT_ISSUED_FAILURE.test(output);
  const exitCode = failure.exitCode ?? "unknown";

  let headline: string;
  let recovery: string;
  if (!gitIssued && (await preCommitHookExists(repoPath))) {
    headline = "git commit was rejected by the pre-commit hook";
    recovery =
      "Fix the hook issues, inspect git status, re-stage any files the hook modified, then run the gitCommit action again.";
  } else {
    headline = "git commit failed";
    recovery =
      "Inspect git status, resolve the reported git issue, then run the gitCommit action again.";
  }

  const parts = [`${headline} (exit code ${exitCode}).`, recovery];
  if (diagnostics.length > 0) {
    parts.push(diagnostics);
  }
  return new Error(parts.join("\n\n"));
}

/**
 * Create the commit for already staged changes through real git so
 * configured pre-commit hooks execute. A rejected hook rejects this call:
 * the returned error keeps the hook's stdout/stderr diagnostics and explains
 * the recovery steps (fix hook issues, inspect git status, re-stage files the
 * hook modified, rerun). It never recommends bypassing hooks.
 */
export async function commitStagedChanges(
  repoPath: string,
  message: string,
  verbose: boolean,
): Promise<void> {
  try {
    await runGit(["commit", "-m", message], { cwd: repoPath, verbose, capture: true });
  } catch (error) {
    const failure = error as RunGitFailure;
    if (error instanceof Error && typeof failure.stderr === "string") {
      throw await commitRejection(repoPath, verbose, failure);
    }
    throw error;
  }
}
