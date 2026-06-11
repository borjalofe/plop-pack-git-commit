import type { NodePlopAPI } from "node-plop";
import { gitCommitAction } from "./git-commit-action.js";
import {
  type GitCommitActionConfig,
  type GitCommitConfig,
  gitCommitConfigSchema,
} from "./schemas/git-commit-config.js";

export { gitCommitAction, gitCommitConfigSchema };
export type { GitCommitActionConfig, GitCommitConfig };

export default function registerGitCommitPack(plop: NodePlopAPI): void {
  plop.setDefaultInclude({ actionTypes: true });
  plop.setActionType("gitCommit", gitCommitAction);
}
