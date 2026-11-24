# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-11-24

### Security

Resolved every `pnpm audit` advisory rated `moderate` or higher (20 total:
4 critical, 6 high, 8 moderate). Transitive dev-dependency fixes were applied
with `pnpm audit --fix` (override method), which records the forced
non-vulnerable versions in `pnpm-workspace.yaml`. The single remaining `low`
advisory (esbuild dev-server file read on Windows) is below the fixed threshold
and left untouched.

- **zod** upgraded from `^3.24.2` to `^4.6.6` (production dependency). The fix
  for [GHSA-mrhx-c7xc-m3w5][zod] (high: memory exhaustion while validating
  oversized constrained collections) ships only in the 4.x line; no 3.x patch
  exists. Because `pnpm` overrides do not protect downstream consumers of a
  published package, the declared dependency range was bumped rather than only
  overridden. See _Changed_ for the accompanying code adjustment.
- **handlebars** forced to `^4.7.10` (via `node-plop`): JavaScript injection
  via AST type and via own property (critical), plus the unsafe-inline variant
  (moderate).
- **tinypool** forced to `^2.1.1`/`^2.1.2` (via `vitest`): prototype-pollution
  gadgets escalating to RCE (critical).
- **vitest** / **@vitest/mocker** forced to `^4.1.11`/`^4.1.12`: unauthenticated
  manual mock code injection and path-traversal / arbitrary file read
  (moderate).
- **vite** forced to `^7.3.7` (via `vitest`): files outside `server.fs.allow`
  could be served, and cross-origin script execution (moderate/low).
- **postcss** forced to `^8.5.18`/`^8.5.23` (via `tsup`): path traversal in the
  previous source map (high) and an incomplete earlier fix (moderate).
- **source-map-js** forced to `^1.2.2` (via `tsup`): event-loop denial of
  service (high).
- **nanoid** forced to `^3.3.16`/`^3.3.18` (via `tsup`): non-secure and custom
  generators can loop indefinitely (high).

### Changed

- `formatZodError` now types issue paths as `ReadonlyArray<PropertyKey>` and
  stringifies each segment, matching zod 4's `ZodIssue.path` type
  (`PropertyKey[]`, which includes `symbol`). This keeps the declaration build
  (`tsup` DTS) and tests green after the zod 4 upgrade; the public
  `GitCommitConfig` API is unchanged.

[zod]: https://github.com/advisories/GHSA-mrhx-c7xc-m3w5

## [0.1.0] - 2026-06-11

### Added

- Initial `gitCommit` Plop action: stage, commit, and push to `origin`.
