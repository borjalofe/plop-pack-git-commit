import { pushActiveBranchToUpstream } from "./lib/git-push.js";
import { isGitRepository } from "./lib/git-stage.js";
import { formatZodError } from "./lib/zod-error.js";
import { type GitPushActionConfig, gitPushConfigSchema } from "./schemas/git-push-config.js";

/**
 * Publish the active branch to its configured upstream, never stage or commit.
 * Reuses the resolved-upstream single-ref push and soft-warning behavior of the
 * combined action; no local commits are created and the message wording is
 * push-only ("Push skipped: ..." / "Push failed: ...").
 */
export async function pushAction(
  _answers: unknown,
  config: GitPushActionConfig & Record<string, unknown>,
): Promise<string> {
  const parsed = gitPushConfigSchema.safeParse({
    path: config.path ?? process.cwd(),
    verbose: config.verbose ?? false,
  });

  if (!parsed.success) {
    throw new Error(`Invalid push config: ${formatZodError(parsed.error)}`);
  }

  const { path: repoPath, verbose } = parsed.data;

  if (!(await isGitRepository(repoPath))) {
    throw new Error(`Not a git repository: ${repoPath}`);
  }

  const outcome = await pushActiveBranchToUpstream(repoPath, verbose);

  if (outcome.ok) {
    return `Pushed to ${outcome.remote}/${outcome.remoteBranch}`;
  }

  return `${outcome.skipped ? "Push skipped" : "Push failed"}: ${outcome.detail}`;
}
