import { z } from "zod";

export const gitCommitConfigSchema = z
  .object({
    path: z.string().min(1),
    message: z.string().trim().min(1),
    files: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
    all: z.boolean().optional(),
    verbose: z.boolean().default(false),
    skipEmpty: z.boolean().default(true),
  })
  .refine((data) => (data.files !== undefined) !== (data.all === true), {
    message: "Provide either files or all: true, not both or neither",
  });

export type GitCommitConfig = z.infer<typeof gitCommitConfigSchema>;

export type GitCommitActionConfig = {
  path?: string;
  message?: string;
  files?: string | string[];
  all?: boolean;
  verbose?: boolean;
  skipEmpty?: boolean;
};
