# plop-pack-git-commit

PlopJS action pack that stages changes, creates a git commit, and pushes to `origin`.

Inspired by [plop-pack-git-init](https://github.com/crutchcorn/plop-pack-git-init), but focused on committing existing or generated files in an already initialized repository.

## Problem

`plop-pack-git-init` covers "create a repo". After generators write files into a vault or project that already has git, I still had to stage, commit, and push by hand. That break in the flow is exactly where Plop should finish the job.

## Who uses it

- Me, from vault / Plop tooling
- Anyone installing the package from npm

## Scope

**Includes:** Plop action `gitCommit` (stage specific files or `all`, commit, push `origin HEAD`), Zod schema export, CI + security release automation.

**Does not include:** configurable remote/branch names today; fail-hard push; hosting-specific remotes (`forgejo` / `github` as remote names).

## How to run it

### Install

```bash
pnpm add plop-pack-git-commit
# or
npm i plop-pack-git-commit
```

### Usage

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

## Decisions

**Why always `git push origin HEAD`?**

Keeps the action tiny and predictable for the common case (one remote named `origin`). Homelab clones that use remotes `forgejo` / `github` instead of `origin` will get a warning and a local commit — documented limitation, not a silent success.

**Why `skipEmpty` default `true`?**

Generators often run when the working tree did not change. Failing the whole Plop run for "nothing to commit" is worse DX than resolving cleanly.

**Why warning on push failure instead of fail-hard?**

Commit already happened. Aborting the generator after a network blip strands the user mid-flow. CI that needs strict push should call git itself or wrap the action.

**Alternatives considered:** husky-only hooks (do not help Plop mid-generator); GitHub Action for commit (wrong layer); `simple-git` vs `child_process` (pack uses explicit git CLI for transparency).

## Trade-offs and limitations

Hardcoded `origin` vs multi-remote homelab naming. Soft push failures vs strict CI. Package optimises interactive generators, not gatekeeping pipelines.

## Evidence of quality

```bash
pnpm install
pnpm check   # lint + test + build
```

Also: Vitest, Biome, lefthook, GitHub Actions (CI, CodeQL, audit, Dependabot, release with npm provenance).

## Lessons learned

Security-release automation (Dependabot → patch bump → changelog → publish) taught me to separate "bot security release" from "human feature release" so provenance and tags do not double-fire.

## Next steps

1. Optional `remote` / `ref` config for non-`origin` setups.
2. Optional `failOnPushError` for CI-strict consumers.
3. Document a vault Plop example that matches remotes `forgejo`/`github`.

## Development

```bash
pnpm install
pnpm check
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

### Security releases (automated)

When a **Dependabot security PR** is merged to `main`:

1. `Security release prepare` checks author, advisory signals, and that `pnpm audit` improved.
2. Opens a review PR (`security-release/x.y.z`) with patch bump + CHANGELOG **Security** section.
3. Merge triggers `Security release publish` (tag, GitHub Release, npm).

Manual feature releases still use the `Release` workflow (GitHub Release UI).

### Releasing to npm (manual)

1. Bump `version` in `package.json`.
2. Commit, push to `main`, create GitHub Release with matching `vX.Y.Z` tag.
3. `Release` workflow runs `pnpm check` and publishes with [npm provenance](https://docs.npmjs.com/generating-provenance-statements).

| Secret | Purpose |
|--------|---------|
| `NPM_TOKEN` | npm automation token with publish access |

Enable **Dependabot alerts** and **Code scanning** under repository Settings → Code security.

## License

MIT
