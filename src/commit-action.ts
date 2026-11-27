import { parseCommitConfig } from "./lib/commit-config.js";
import { stageChangesAndCommit } from "./lib/git-stage.js";
import type { GitCommitActionConfig } from "./schemas/git-commit-config.js";

/**
 * Stage and create a git commit, never push. Same staging and skip-empty
 * contract as the combined action; it just has no push step.
 */
export async function commitAction(
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
  } = parseCommitConfig(config, "commit");

  const committed = await stageChangesAndCommit(
    repoPath,
    { message, files, all, skipEmpty },
    verbose,
  );

  if (!committed) {
    return "Nothing to commit";
  }

  return `Committed: ${message}`;
}
