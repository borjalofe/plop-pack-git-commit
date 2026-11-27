import type { CustomActionFunction, NodePlopAPI } from "node-plop";
import { commitAction } from "./commit-action.js";
import { gitCommitAction } from "./git-commit-action.js";
import { pushAction } from "./push-action.js";
import {
  type GitCommitActionConfig,
  type GitCommitConfig,
  gitCommitConfigSchema,
} from "./schemas/git-commit-config.js";
import {
  type GitPushActionConfig,
  type GitPushConfig,
  gitPushConfigSchema,
} from "./schemas/git-push-config.js";

export { commitAction, gitCommitAction, gitCommitConfigSchema, gitPushConfigSchema, pushAction };
export type { GitCommitActionConfig, GitCommitConfig, GitPushActionConfig, GitPushConfig };

export default function registerGitCommitPack(plop: NodePlopAPI): void {
  plop.setDefaultInclude({ actionTypes: true });
  plop.setActionType("commit", commitAction as CustomActionFunction);
  plop.setActionType("push", pushAction as CustomActionFunction);
  plop.setActionType("commit-and-push", gitCommitAction as CustomActionFunction);
  plop.setActionType("gitCommit", gitCommitAction as CustomActionFunction);
}
