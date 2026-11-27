export function formatZodError(error: {
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>;
}) {
  return error.issues
    .map((issue) => `${issue.path.map(String).join(".") || "config"}: ${issue.message}`)
    .join("; ");
}
