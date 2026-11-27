import { parseCommitConfig } from "./lib/commit-config.js";
import { pushCurrentBranch } from "./lib/git-push.js";
import { stageChangesAndCommit } from "./lib/git-stage.js";
import type { GitCommitActionConfig } from "./schemas/git-commit-config.js";

export async function gitCommitAction(
  _answers: unknown,
  config: GitCommitActionConfig & Record<string, unknown>,
): Promise<string> {
  const {
    path: repoPath,
    message,
    verbose,
    skipEmpty,
    files,
    all,
  } = parseCommitConfig(config, "gitCommit");

  const committed = await stageChangesAndCommit(
    repoPath,
    { message, files, all, skipEmpty },
    verbose,
  );

  if (!committed) {
    return "Nothing to commit";
  }

  const pushResult = await pushCurrentBranch(repoPath, verbose);

  if (pushResult.ok) {
    return `Committed and pushed to ${pushResult.remote}/${pushResult.remoteBranch}: ${message}`;
  }

  if (verbose) {
    console.warn(pushResult.warning);
  }

  return pushResult.warning;
}
