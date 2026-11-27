import { z } from "zod";

export const gitPushConfigSchema = z.object({
  path: z.string().min(1),
  verbose: z.boolean().default(false),
});

export type GitPushConfig = z.infer<typeof gitPushConfigSchema>;

export type GitPushActionConfig = {
  path?: string;
  verbose?: boolean;
};
