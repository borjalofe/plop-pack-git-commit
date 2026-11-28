# plop-actions-git

PlopJS action pack for git commits and pushes, with the steps available separately: `commit` to stage and create a commit, `push` to publish the active branch to its configured upstream, and `commit-and-push` to keep the combined flow.

Inspired by [plop-pack-git-init](https://github.com/crutchcorn/plop-pack-git-init), but focused on committing existing or generated files in an already initialized repository.

## Problem

`plop-pack-git-init` covers "create a repo". After generators write files into a vault or project that already has git, I still had to stage, commit, and push by hand. That break in the flow is exactly where Plop should finish the job.

## Who uses it

- Me, from vault / Plop tooling
- Anyone installing the package from npm

## Scope

**Includes:** Plop actions `commit` (stage and commit, never push), `push` (publish the active branch to its configured upstream, never commit), `commit-and-push` (both steps) with the `gitCommit` compatibility alias, Zod schema exports, CI + security release automation.

**Does not include:** fail-hard push; automatic upstream creation (the action never runs `push -u` or invents a destination); force push.

## How to run it

### Install

```bash
pnpm add plop-actions-git
# or
npm i plop-actions-git
```

### Usage

```js
module.exports = function (plop) {
  plop.load("plop-actions-git");

  plop.setGenerator("example", {
    prompts: [],
    actions: [
      {
        type: "add",
        path: "notes/{{name}}.md",
        template: "# {{name}}\n",
      },
      {
        type: "commit-and-push",
        path: process.cwd(),
        message: "docs: add {{name}} note",
        files: "notes/{{name}}.md",
      },
    ],
  });
};
```

### Registered actions

| Action | Stages | Creates a commit | Pushes |
|--------|--------|------------------|--------|
| `commit` | `files` or `all` | yes | never |
| `push` | never | never | yes |
| `commit-and-push` | `files` or `all` | yes | yes |
| `gitCommit` | `files` or `all` | yes | yes |

`push` only publishes commits that already exist; pending working-tree changes are ignored. `gitCommit` is kept for existing generators and behaves exactly like `commit-and-push`.

### Commit specific file(s)

```js
{
  type: "commit",
  path: process.cwd(),
  message: "docs: add contact note",
  files: "notes/contacto.md",
}
```

`files` accepts a string or an array of strings. The same options apply to `commit-and-push` when you need the push step too. The commit action never pushes: it does not read `branch.<name>.remote` and does not touch remotes.

### Commit everything pending

```js
{
  type: "commit",
  path: process.cwd(),
  message: "chore: sync generated files",
  all: true,
}
```

This runs `git add -A` before committing.

### Push only, without committing

```js
{
  type: "push",
  path: process.cwd(),
}
```

The push action never stages and never creates a commit, even when the working tree has pending changes. It publishes the branch's configured upstream and resolves with a warning when there is no destination (missing upstream, detached HEAD, missing remote) instead of inventing one.

## Options

The `commit`, `commit-and-push` and `gitCommit` actions accept the same options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `path` | `string` | `process.cwd()` | Repository path |
| `message` | `string` | required | Commit message |
| `files` | `string \| string[]` | — | Stage only these paths |
| `all` | `boolean` | — | Stage all changes with `git add -A` |
| `verbose` | `boolean` | `false` | Stream git output to the terminal |
| `skipEmpty` | `boolean` | `true` | Resolve instead of failing when there is nothing to commit |

Provide either `files` or `all: true`. They are mutually exclusive.

The `push` action accepts only:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `path` | `string` | `process.cwd()` | Repository path |
| `verbose` | `boolean` | `false` | Stream git output to the terminal |

`push` returns `Pushed to <remote>/<remote-branch>` on success and `Push skipped: ...` or `Push failed: ...` when it resolves without publishing. The combined actions return `Committed and pushed to ...` on success, `Committed; push skipped/failed: ...` on soft warnings, and `Nothing to commit` when `skipEmpty` resolves an empty run.

## Pre-commit hooks

The `commit`, `commit-and-push` and `gitCommit` actions run through real
`git commit`, so git executes configured hooks itself (`pre-commit` first)
and honors `core.hooksPath`. The commit step never runs
`--no-verify` and never implements a manual hook runner; a commit accepted
through a hook behaves exactly like a commit without hooks.

When git rejects the commit during the hook, the action fails with the hook's
output and the recovery steps:

```text
git commit was rejected by the pre-commit hook (exit code 1).

Fix the hook issues, inspect git status, re-stage any files the hook modified, then run the gitCommit action again.

<hook stdout and stderr diagnostics>
```

A `git commit` failure that git itself raises without a hook rejection reports
the git diagnostics and generic recovery steps instead of claiming the hook
rejected the commit. The recommended recovery is to fix the reported issues
and rerun the action; `--no-verify` is never the suggested fix.

`verbose: true` keeps the live streaming of git output to the terminal and
reports the same actionable error. The standalone `push` action does not create
a commit and does not execute pre-commit hooks.

## Push behavior

The `push` action and the combined actions publish only the active branch to the
upstream destination configured for that branch. They read the destination from
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

- the combined actions see nothing to commit (`skipEmpty`) and skip the push
  before staging anything;
- `HEAD` is detached (no branch to publish);
- the active branch has no configured upstream (`branch.<name>.remote` /
  `branch.<name>.merge`);
- the branch tracks a local ref (`remote = .`);
- the configured remote does not exist.

If the push itself fails (network, rejection), the action resolves with a
warning instead of failing the generator. In every skip or failure case the
local repository is preserved: commits from the commit action are kept and the
push action leaves HEAD untouched.

## Schema export

```ts
import { gitCommitConfigSchema, gitPushConfigSchema } from "plop-actions-git";

const result = gitCommitConfigSchema.safeParse({
  path: process.cwd(),
  message: "feat: add generator output",
  all: true,
});

const pushResult = gitPushConfigSchema.safeParse({
  path: process.cwd(),
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
