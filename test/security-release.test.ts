import { describe, expect, it } from "vitest";
import {
  buildSecurityChangelogEntry,
  bumpPatch,
  countVulnerabilities,
  extractReleaseNotes,
  isSecurityDependabotPr,
  parseDependabotUpdates,
} from "../scripts/security-release.mjs";

describe("isSecurityDependabotPr", () => {
  it("accepts Dependabot PRs with GHSA advisories", () => {
    expect(
      isSecurityDependabotPr({
        userLogin: "dependabot[bot]",
        body: "Bumps zod. The following vulnerabilities are fixed:\n- [GHSA-aaaa-bbbb-cccc](https://github.com/advisories/GHSA-aaaa-bbbb-cccc)",
        labels: [{ name: "dependencies" }],
      }),
    ).toBe(true);
  });

  it("rejects non-Dependabot PRs", () => {
    expect(
      isSecurityDependabotPr({
        userLogin: "borjalofe",
        body: "GHSA-aaaa-bbbb-cccc",
        labels: [],
      }),
    ).toBe(false);
  });

  it("rejects routine Dependabot bumps without advisories", () => {
    expect(
      isSecurityDependabotPr({
        userLogin: "dependabot[bot]",
        body: "Bumps typescript from 5.8.2 to 5.8.3",
        labels: [{ name: "dependencies" }],
      }),
    ).toBe(false);
  });
});

describe("bumpPatch", () => {
  it("increments patch segment", () => {
    expect(bumpPatch("0.1.0")).toBe("0.1.1");
    expect(bumpPatch("1.4.9")).toBe("1.4.10");
  });
});

describe("parseDependabotUpdates", () => {
  it("extracts package versions and advisories", () => {
    const updates = parseDependabotUpdates(
      "Bumps `zod` from `3.24.1` to `3.24.2`\n\nThe following vulnerabilities are fixed:\n- [GHSA-aaaa-bbbb-cccc](https://github.com/advisories/GHSA-aaaa-bbbb-cccc)",
      "Bump zod",
    );

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      name: "zod",
      from: "3.24.1",
      to: "3.24.2",
    });
    expect(updates[0]?.advisories[0]?.id).toBe("GHSA-aaaa-bbbb-cccc");
  });
});

describe("countVulnerabilities", () => {
  it("sums vulnerability counts from audit metadata", () => {
    const total = countVulnerabilities({
      metadata: {
        vulnerabilities: { info: 0, low: 1, moderate: 2, high: 1, critical: 0 },
      },
    });

    expect(total.total).toBe(4);
    expect(total.high).toBe(1);
  });
});

describe("changelog helpers", () => {
  it("builds a security changelog entry", () => {
    const entry = buildSecurityChangelogEntry({
      version: "0.1.1",
      date: "2026-06-11",
      updates: [
        {
          name: "zod",
          from: "3.24.1",
          to: "3.24.2",
          advisories: [
            {
              id: "GHSA-aaaa-bbbb-cccc",
              url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
            },
          ],
        },
      ],
      audit: {
        before: { total: 2, high: 1, critical: 0, info: 0, low: 0, moderate: 1 },
        after: { total: 0, high: 0, critical: 0, info: 0, low: 0, moderate: 0 },
        improved: true,
      },
    });

    expect(entry).toContain("## [0.1.1] - 2026-06-11");
    expect(entry).toContain("**zod** `3.24.1` → `3.24.2`");
    expect(entry).toContain("GHSA-aaaa-bbbb-cccc");
    expect(entry).toContain("2 → 0 vulnerabilities");
  });

  it("extracts release notes for a version", () => {
    const changelog = `# Changelog

## [Unreleased]

## [0.1.1] - 2026-06-11

### Security

- **zod** patch bump

## [0.1.0] - 2026-06-10

### Added

- Initial release
`;

    const notes = extractReleaseNotesFromContent(changelog, "0.1.1");
    expect(notes).toContain("Security release 0.1.1");
    expect(notes).toContain("**zod** patch bump");
    expect(notes).not.toContain("0.1.0");
  });
});

function extractReleaseNotesFromContent(content: string, version: string): string {
  const header = `## [${version}]`;
  const start = content.indexOf(header);
  const rest = content.slice(start);
  const nextHeader = rest.indexOf("\n## [", header.length);
  const section = nextHeader === -1 ? rest : rest.slice(0, nextHeader);
  return section
    .replace(header, `## Security release ${version}`)
    .replace(/ - \d{4}-\d{2}-\d{2}/, "")
    .trim();
}

// Re-test via exported helper using temp approach - import extractReleaseNotes needs file
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

describe("extractReleaseNotes", () => {
  it("reads changelog file from disk", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "changelog-"));
    const file = path.join(dir, "CHANGELOG.md");
    writeFileSync(
      file,
      "## [Unreleased]\n\n## [0.2.0] - 2026-06-11\n\n### Security\n\n- patched dep\n",
    );

    const notes = extractReleaseNotes(file, "0.2.0");
    expect(notes).toContain("Security release 0.2.0");
    expect(notes).toContain("patched dep");
  });
});
