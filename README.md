# plop-pack-git-commit

PlopJS action pack that stages changes, creates a git commit, and pushes to `origin`.

Inspired by [plop-pack-git-init](https://github.com/crutchcorn/plop-pack-git-init), but focused on committing existing or generated files in an already initialized repository.

## Installation

```bash
pnpm add plop-pack-git-commit
# or
npm i plop-pack-git-commit
```

## Usage

```js
module.exports = function (plop) {
  plop.load("plop-pack-git-commit");

  plop.setGenerator("example", {
    prompts: [],
    actions: [
      {
        type: "add",
        path: "notes/{{name}}.md",
        template: "# {{name}}\n",
      },
      {
        type: "gitCommit",
        path: process.cwd(),
        message: "docs: add {{name}} note",
        files: "notes/{{name}}.md",
      },
    ],
  });
};
```

### Commit specific file(s)

```js
{
  type: "gitCommit",
  path: process.cwd(),
  message: "docs: add contact note",
  files: "notes/contacto.md",
}
```

`files` accepts a string or an array of strings.

### Commit everything pending

```js
{
  type: "gitCommit",
  path: process.cwd(),
  message: "chore: sync generated files",
  all: true,
}
```

This runs `git add -A` before committing.

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `path` | `string` | `process.cwd()` | Repository path |
| `message` | `string` | required | Commit message |
| `files` | `string \| string[]` | — | Stage only these paths |
| `all` | `boolean` | — | Stage all changes with `git add -A` |
| `verbose` | `boolean` | `false` | Stream git output to the terminal |
| `skipEmpty` | `boolean` | `true` | Resolve instead of failing when there is nothing to commit |

Provide either `files` or `all: true`. They are mutually exclusive.

## Push behavior

After a successful commit, the action always runs:

```bash
git push origin HEAD
```

- If there was nothing to commit (`skipEmpty`), push is skipped.
- If `origin` is missing or push fails, the action resolves with a warning instead of failing the generator. The commit remains local.

## Schema export

You can validate action configs outside Plop:

```ts
import { gitCommitConfigSchema } from "plop-pack-git-commit";

const result = gitCommitConfigSchema.safeParse({
  path: process.cwd(),
  message: "feat: add generator output",
  all: true,
});
```

## Requirements

- `git` available in `PATH`
- Git user identity configured (`user.name`, `user.email`)
- Remote `origin` configured when you expect push to succeed

## Development

```bash
pnpm install
pnpm check   # lint + test + build
pnpm lint
pnpm test
pnpm build
```

## GitHub Actions

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `CI` | push/PR to `main` | lint, test, build |
| `Security audit` | push/PR + weekly | `pnpm audit` fails on high/critical |
| `Dependency review` | pull requests | blocks PRs that add vulnerable deps |
| `CodeQL` | push/PR + weekly | static analysis for TypeScript/JavaScript |
| `Release` | GitHub Release published | verify tag, `pnpm check`, publish to npm |

Dependabot opens weekly PRs to update dependencies.

### Releasing to npm

1. Bump `version` in `package.json` (e.g. `0.1.1`).
2. Commit, push to `main`, and create a GitHub Release with tag `v0.1.1` (must match `package.json`).
3. The `Release` workflow runs `pnpm check` and publishes with [npm provenance](https://docs.npmjs.com/generating-provenance-statements).

Repository secret required:

| Secret | Purpose |
|--------|---------|
| `NPM_TOKEN` | npm automation token with publish access to this package |

Enable **Dependabot alerts** and **Code scanning** under repository Settings → Code security.

## License

MIT
