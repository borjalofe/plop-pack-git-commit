import { spawn } from "node:child_process";

export type RunGitOptions = {
  cwd: string;
  verbose?: boolean;
  /**
   * Capture stdout/stderr while the command runs. Needed where the caller
   * consumes captured output even when `verbose` also streams it, for example
   * the commit phase when a pre-commit hook rejects the commit.
   */
  capture?: boolean;
};

export type RunGitResult = {
  stdout: string;
  stderr: string;
};

export type RunGitFailure = Error & {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
};

const didSucceed = (code: number | null): boolean => code === 0;

export function runGit(args: string[], options: RunGitOptions): Promise<RunGitResult> {
  const { cwd, verbose = false, capture = false } = options;

  return new Promise((resolve, reject) => {
    if (verbose && !capture) {
      // Historical verbose behavior: git inherits the parent stdio, so output
      // streams unchanged and nothing is captured. Kept for every other git
      // flow in this package.
      const child = spawn("git", args, {
        cwd,
        stdio: "inherit",
      });

      child.on("close", (code) => {
        if (didSucceed(code)) {
          resolve({ stdout: "", stderr: "" });
          return;
        }

        reject(new Error(`git ${args.join(" ")} exited with code ${code ?? "unknown"}`));
      });
      child.on("error", reject);
      return;
    }

    let stdout = "";
    let stderr = "";

    const child = spawn("git", args, {
      cwd,
      stdio: "pipe",
    });

    child.stdout?.on("data", (chunk: Buffer | string) => {
      if (verbose) {
        process.stdout.write(chunk);
      }
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      if (verbose) {
        process.stderr.write(chunk);
      }
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (didSucceed(code)) {
        resolve({ stdout, stderr });
        return;
      }

      const detail = stderr.trim() || stdout.trim();
      const failure = new Error(
        detail
          ? `git ${args.join(" ")} failed: ${detail}`
          : `git ${args.join(" ")} exited with code ${code ?? "unknown"}`,
      ) as RunGitFailure;
      failure.stdout = stdout;
      failure.stderr = stderr;
      failure.exitCode = code;
      reject(failure);
    });

    child.on("error", reject);
  });
}
