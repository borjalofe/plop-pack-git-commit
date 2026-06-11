import { runGit } from "./run-git.js";

export type PushResult = { ok: true } | { ok: false; warning: string };

async function hasOriginRemote(repoPath: string, verbose: boolean): Promise<boolean> {
  try {
    await runGit(["remote", "get-url", "origin"], { cwd: repoPath, verbose });
    return true;
  } catch {
    return false;
  }
}

export async function pushToOrigin(repoPath: string, verbose = false): Promise<PushResult> {
  if (!(await hasOriginRemote(repoPath, verbose))) {
    return {
      ok: false,
      warning: "Committed; push skipped: remote origin is not configured",
    };
  }

  try {
    await runGit(["push", "origin", "HEAD"], { cwd: repoPath, verbose });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      warning: `Committed; push failed: ${message}`,
    };
  }
}
