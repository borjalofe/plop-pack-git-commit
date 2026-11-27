import {
  type GitCommitActionConfig,
  type GitCommitConfig,
  gitCommitConfigSchema,
} from "../schemas/git-commit-config.js";
import { formatZodError } from "./zod-error.js";

/**
 * Shared config parsing for the `commit` and `gitCommit` (commit-and-push)
 * actions. Both consume the same contract (`message`, `files`|`all`,
 * `skipEmpty`), so a single parser enforces the files/all exclusivity once.
 * `actionName` only names the action in actionable validation errors.
 */
export function parseCommitConfig(
  config: GitCommitActionConfig & Record<string, unknown>,
  actionName: string,
): GitCommitConfig {
  const parsed = gitCommitConfigSchema.safeParse({
    path: config.path ?? process.cwd(),
    message: config.message,
    files: config.files,
    all: config.all,
    verbose: config.verbose ?? false,
    skipEmpty: config.skipEmpty ?? true,
  });

  if (!parsed.success) {
    throw new Error(`Invalid ${actionName} config: ${formatZodError(parsed.error)}`);
  }

  return parsed.data;
}
