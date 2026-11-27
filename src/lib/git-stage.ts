import { access } from "node:fs/promises";
import path from "node:path";
import { runGit } from "./run-git.js";

/**
 * Whether `repoPath` contains git metadata. Uses the same `.git` presence check
 * as upstream tooling; bare repositories and worktrees can bypass it.
 */
export async function isGitRepository(repoPath: string): Promise<boolean> {
  try {
    await access(path.join(repoPath, ".git"));
    return true;
  } catch {
    return false;
  }
}

function normalizeFiles(files: string | string[]): string[] {
  return Array.isArray(files) ? files : [files];
}

async function hasChangesToStage(repoPath: string, verbose: boolean): Promise<boolean> {
  const { stdout } = await runGit(["status", "--porcelain"], {
    cwd: repoPath,
    verbose,
  });
  return stdout.trim().length > 0;
}

async function stageFiles(
  repoPath: string,
  config: { files?: string | string[]; all?: boolean },
  verbose: boolean,
): Promise<void> {
  if (config.files !== undefined) {
    await runGit(["add", "--", ...normalizeFiles(config.files)], {
      cwd: repoPath,
      verbose,
    });
    return;
  }

  if (config.all) {
    await runGit(["add", "-A"], { cwd: repoPath, verbose });
  }
}

async function hasStagedDiff(repoPath: string, verbose: boolean): Promise<boolean> {
  try {
    await runGit(["diff", "--cached", "--quiet"], { cwd: repoPath, verbose });
    return false;
  } catch (error) {
    if (error instanceof Error && error.message.includes("exited with code 1")) {
      return true;
    }
    throw error;
  }
}

export type StageCommitConfig = {
  message: string;
  files?: string | string[];
  all?: boolean;
  skipEmpty: boolean;
};

/**
 * Stage and commit in an existing git repository, shared by the `commit` and
 * combined `commit-and-push` actions.
 *
 * When `skipEmpty` is true and there is nothing to commit (working tree or
 * after staging), resolves with `false` instead of failing. When `skipEmpty` is
 * false those cases throw. Never stages and commits invalid input: the
 * repository check runs before any git write.
 *
 * Returns `true` when a commit was created, `false` when the run was resolved
 * as empty under `skipEmpty`.
 */
export async function stageChangesAndCommit(
  repoPath: string,
  config: StageCommitConfig,
  verbose = false,
): Promise<boolean> {
  if (!(await isGitRepository(repoPath))) {
    throw new Error(`Not a git repository: ${repoPath}`);
  }

  const hasWorkingTreeChanges = await hasChangesToStage(repoPath, verbose);

  if (!hasWorkingTreeChanges && config.skipEmpty) {
    return false;
  }

  if (!hasWorkingTreeChanges && !config.skipEmpty) {
    throw new Error("Nothing to commit");
  }

  await stageFiles(repoPath, { files: config.files, all: config.all }, verbose);

  const staged = await hasStagedDiff(repoPath, verbose);

  if (!staged && config.skipEmpty) {
    return false;
  }

  if (!staged && !config.skipEmpty) {
    throw new Error("Nothing to commit after staging");
  }

  await runGit(["commit", "-m", config.message], { cwd: repoPath, verbose });

  return true;
}
