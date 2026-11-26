# plop-pack-git-commit

PlopJS action pack that stages changes, creates a git commit, and publishes the active branch to its configured upstream.

Inspired by [plop-pack-git-init](https://github.com/crutchcorn/plop-pack-git-init), but focused on committing existing or generated files in an already initialized repository.

## Problem

`plop-pack-git-init` covers "create a repo". After generators write files into a vault or project that already has git, I still had to stage, commit, and push by hand. That break in the flow is exactly where Plop should finish the job.

## Who uses it

- Me, from vault / Plop tooling
- Anyone installing the package from npm

## Scope

**Includes:** Plop action `gitCommit` (stage specific files or `all`, commit, publish the active branch to its configured upstream), Zod schema export, CI + security release automation.

**Does not include:** fail-hard push; automatic upstream creation (the action never runs `push -u` or invents a destination); force push.

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

After a successful commit, the action publishes only the active branch to the
upstream destination configured for that branch. It reads the destination from
git itself:

```bash
remote=$(git config --get branch.<current>.remote)
merge=$(git config --get branch.<current>.merge)   # e.g. refs/heads/<remote-branch>
git push "$remote" "refs/heads/<current>:$merge"
```

The remote name and the remote branch name are never assumed: a branch that
tracks `upstream`, `forgejo`, or `github`, or whose remote branch has a
different name, is published to exactly that destination. The explicit
single-ref refspec means no other references are pushed regardless of your
`push.default`. The action never forces and never changes your git
configuration.

The push is skipped with a clear warning, and no destination is invented, when:

- there was nothing to commit (`skipEmpty`);
- `HEAD` is detached (no branch to publish);
- the active branch has no configured upstream (`branch.<name>.remote` /
  `branch.<name>.merge`);
- the branch tracks a local ref (`remote = .`);
- the configured remote does not exist.

If the push itself fails (network, rejection), the action resolves with a
warning instead of failing the generator. In every skip or failure case the
local commit is preserved.

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
- The active branch has an upstream configured (`git push -u <remote> <branch>` once, or `git branch --set-upstream-to`) when you expect push to succeed

## Decisions

**Why publish to the configured upstream instead of `git push origin HEAD`?**

The branch already records where it should go (`branch.<name>.remote` and
`branch.<name>.merge`). Honoring it works for clones whose remote is
`forgejo` / `github` or whose remote branch has a different name, and it avoids
pushing to a wrong or invented `origin/<same-name>` destination. A branch with
no upstream gets a warning and a local commit, not a silent push to a guessed
remote.

**Why `skipEmpty` default `true`?**

Generators often run when the working tree did not change. Failing the whole Plop run for "nothing to commit" is worse DX than resolving cleanly.

**Why warning on push failure instead of fail-hard?**

Commit already happened. Aborting the generator after a network blip strands the user mid-flow. CI that needs strict push should call git itself or wrap the action.

**Alternatives considered:** husky-only hooks (do not help Plop mid-generator); GitHub Action for commit (wrong layer); `simple-git` vs `child_process` (pack uses explicit git CLI for transparency).

## Trade-offs and limitations

The branch must have an upstream configured for the push to run; the action
never creates one. Soft push failures vs strict CI. Package optimises
interactive generators, not gatekeeping pipelines.

## Evidence of quality

```bash
pnpm install
pnpm check   # lint + test + build
```

Also: Vitest, Biome, lefthook, GitHub Actions (CI, CodeQL, audit, Dependabot, release with npm provenance).

## Lessons learned

Security-release automation (Dependabot → patch bump → changelog → publish) taught me to separate "bot security release" from "human feature release" so provenance and tags do not double-fire.

## Next steps

1. Optional explicit `remote` / `ref` config to override the branch upstream.
2. Optional `failOnPushError` for CI-strict consumers.
3. Optional opt-in to create the upstream (`push -u`) when none is configured.

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
