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

## License

MIT
