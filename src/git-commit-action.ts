import { access } from "node:fs/promises";
import path from "node:path";
import { pushToOrigin } from "./lib/git-push.js";
import { runGit } from "./lib/run-git.js";
import { type GitCommitActionConfig, gitCommitConfigSchema } from "./schemas/git-commit-config.js";

async function isGitRepository(repoPath: string): Promise<boolean> {
  try {
    await access(path.join(repoPath, ".git"));
    return true;
  } catch {
    return false;
  }
}

function formatZodError(error: {
  issues: Array<{ path: Array<string | number>; message: string }>;
}) {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`)
    .join("; ");
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

export async function gitCommitAction(
  _answers: unknown,
  config: GitCommitActionConfig,
): Promise<string> {
  const parsed = gitCommitConfigSchema.safeParse({
    path: config.path ?? process.cwd(),
    message: config.message,
    files: config.files,
    all: config.all,
    verbose: config.verbose ?? false,
    skipEmpty: config.skipEmpty ?? true,
  });

  if (!parsed.success) {
    throw new Error(`Invalid gitCommit config: ${formatZodError(parsed.error)}`);
  }

  const { path: repoPath, message, verbose, skipEmpty, files, all } = parsed.data;

  if (!(await isGitRepository(repoPath))) {
    throw new Error(`Not a git repository: ${repoPath}`);
  }

  const hasWorkingTreeChanges = await hasChangesToStage(repoPath, verbose);

  if (!hasWorkingTreeChanges && skipEmpty) {
    return "Nothing to commit";
  }

  if (!hasWorkingTreeChanges && !skipEmpty) {
    throw new Error("Nothing to commit");
  }

  await stageFiles(repoPath, { files, all }, verbose);

  const staged = await hasStagedDiff(repoPath, verbose);

  if (!staged && skipEmpty) {
    return "Nothing to commit";
  }

  if (!staged && !skipEmpty) {
    throw new Error("Nothing to commit after staging");
  }

  await runGit(["commit", "-m", message], { cwd: repoPath, verbose });

  const pushResult = await pushToOrigin(repoPath, verbose);

  if (pushResult.ok) {
    return `Committed and pushed to origin: ${message}`;
  }

  if (verbose) {
    console.warn(pushResult.warning);
  }

  return pushResult.warning;
}
