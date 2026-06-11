import { spawn } from "node:child_process";

export type RunGitOptions = {
  cwd: string;
  verbose?: boolean;
};

export type RunGitResult = {
  stdout: string;
  stderr: string;
};

const didSucceed = (code: number | null): boolean => code === 0;

export function runGit(args: string[], options: RunGitOptions): Promise<RunGitResult> {
  const { cwd, verbose = false } = options;

  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      stdio: verbose ? "inherit" : "pipe",
    });

    if (verbose) {
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

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (didSucceed(code)) {
        resolve({ stdout, stderr });
        return;
      }

      const detail = stderr.trim() || stdout.trim();
      reject(
        new Error(
          detail
            ? `git ${args.join(" ")} failed: ${detail}`
            : `git ${args.join(" ")} exited with code ${code ?? "unknown"}`,
        ),
      );
    });

    child.on("error", reject);
  });
}
