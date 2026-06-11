#!/usr/bin/env node
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

function run(command, options = {}) {
  return execSync(command, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function runInherit(command) {
  execSync(command, { stdio: "inherit" });
}

export function isSecurityDependabotPr({ userLogin, body, labels }) {
  if (userLogin !== "dependabot[bot]") {
    return false;
  }

  const labelNames = (labels ?? []).map((label) =>
    typeof label === "string" ? label : label.name,
  );
  const text = body ?? "";

  const hasAdvisory =
    /github\.com\/advisories\/GHSA-/i.test(text) ||
    /CVE-\d{4}-\d+/i.test(text) ||
    /vulnerabilit(?:y|ies)\s+(?:are|is)\s+fixed/i.test(text) ||
    labelNames.includes("security");

  return hasAdvisory;
}

function parseAuditJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return { metadata: { vulnerabilities: {} } };
  }
}

export function countVulnerabilities(auditJson) {
  const counts = auditJson.metadata?.vulnerabilities ?? {};
  const info = counts.info ?? 0;
  const low = counts.low ?? 0;
  const moderate = counts.moderate ?? 0;
  const high = counts.high ?? 0;
  const critical = counts.critical ?? 0;

  return {
    info,
    low,
    moderate,
    high,
    critical,
    total: info + low + moderate + high + critical,
  };
}

function collectAuditAtRef(ref) {
  runInherit(`git checkout --force ${ref}`);
  runInherit("pnpm install --frozen-lockfile");
  try {
    return run("pnpm audit --json");
  } catch (error) {
    if (typeof error.stdout === "string" && error.stdout.length > 0) {
      return error.stdout;
    }
    throw error;
  }
}

export function auditImproved(beforeRef, afterRef) {
  const beforeRaw = collectAuditAtRef(beforeRef);
  const afterRaw = collectAuditAtRef(afterRef);

  const before = countVulnerabilities(parseAuditJson(beforeRaw));
  const after = countVulnerabilities(parseAuditJson(afterRaw));

  return {
    before,
    after,
    improved: after.total < before.total,
  };
}

export function bumpPatch(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Invalid semver for patch bump: ${version}`);
  }

  const major = match[1];
  const minor = match[2];
  const patch = Number(match[3]) + 1;
  return `${major}.${minor}.${patch}`;
}

export function parseDependabotUpdates(body, title) {
  const text = `${title ?? ""}\n${body ?? ""}`;
  const updates = [];
  const seen = new Set();

  const bumpPatterns = [
    /Bumps?\s+[`']?(@?[^`'\s]+(?:\/[^`'\s]+)?)[`']?\s+from\s+[`']?([^\s`']+)[`']?\s+to\s+[`']?([^\s`']+)[`']?/gi,
    /update\s+[`']?(@?[^`'\s]+(?:\/[^`'\s]+)?)[`']?\s+from\s+[`']?([^\s`']+)[`']?\s+to\s+[`']?([^\s`']+)[`']?/gi,
  ];

  for (const pattern of bumpPatterns) {
    for (const match of text.matchAll(pattern)) {
      const name = match[1];
      const key = `${name}:${match[3]}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      updates.push({
        name,
        from: match[2],
        to: match[3],
        advisories: [],
      });
    }
  }

  const advisoryPatterns = [
    /\[((?:GHSA|CVE)-[^\]]+)\]\((https?:\/\/[^)]+)\)/gi,
    /(GHSA-[a-z0-9-]+)/gi,
    /(CVE-\d{4}-\d+)/gi,
  ];

  const advisories = [];
  const advisorySeen = new Set();

  for (const pattern of advisoryPatterns) {
    for (const match of text.matchAll(pattern)) {
      const id = match[1];
      if (advisorySeen.has(id)) {
        continue;
      }
      advisorySeen.add(id);
      advisories.push({
        id,
        url: match[2] ?? (id.startsWith("GHSA-") ? `https://github.com/advisories/${id}` : null),
      });
    }
  }

  if (updates.length === 0 && advisories.length > 0) {
    updates.push({
      name: "dependencies",
      from: "n/a",
      to: "n/a",
      advisories,
    });
  } else if (updates.length > 0) {
    for (const update of updates) {
      update.advisories = advisories;
    }
  }

  return updates;
}

export function buildSecurityChangelogEntry({ version, date, updates, audit }) {
  const lines = [`## [${version}] - ${date}`, "", "### Security", ""];

  for (const update of updates) {
    lines.push(`- **${update.name}** \`${update.from}\` → \`${update.to}\``);
    for (const advisory of update.advisories) {
      if (advisory.url) {
        lines.push(`  - Fixed [${advisory.id}](${advisory.url})`);
      } else {
        lines.push(`  - Fixed ${advisory.id}`);
      }
    }
    if (update.advisories.length === 0) {
      lines.push("  - Dependency update addressing reported advisories");
    }
    lines.push("");
  }

  lines.push(
    `Audit summary: ${audit.before.total} → ${audit.after.total} vulnerabilities ` +
      `(high ${audit.before.high}→${audit.after.high}, critical ${audit.before.critical}→${audit.after.critical}).`,
    "",
  );

  return lines.join("\n");
}

export function prependChangelog(changelogPath, entry) {
  const current = readFileSync(changelogPath, "utf8");
  const unreleasedHeader = "## [Unreleased]";
  const header = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`;

  if (!current.startsWith("# Changelog")) {
    writeFileSync(changelogPath, `${header}${unreleasedHeader}\n\n${entry}`);
    return;
  }

  if (current.includes(unreleasedHeader)) {
    const updated = current.replace(unreleasedHeader, `${unreleasedHeader}\n\n${entry}`);
    writeFileSync(changelogPath, updated);
    return;
  }

  writeFileSync(changelogPath, current.replace("# Changelog", `# Changelog\n\n${entry}`));
}

export function extractReleaseNotes(changelogPath, version) {
  const content = readFileSync(changelogPath, "utf8");
  const header = `## [${version}]`;
  const start = content.indexOf(header);
  if (start === -1) {
    throw new Error(`Changelog section for ${version} not found`);
  }

  const rest = content.slice(start);
  const nextHeader = rest.indexOf("\n## [", header.length);
  const section = nextHeader === -1 ? rest : rest.slice(0, nextHeader);
  return section
    .replace(header, `## Security release ${version}`)
    .replace(/ - \d{4}-\d{2}-\d{2}/, "")
    .trim();
}

function readPackageVersion() {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  return pkg.version;
}

function writePackageVersion(version) {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  pkg.version = version;
  writeFileSync("package.json", `${JSON.stringify(pkg, null, 2)}\n`);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function prepareCommand() {
  const mergeSha = process.env.MERGE_SHA;
  const prBody = process.env.PR_BODY ?? "";
  const prTitle = process.env.PR_TITLE ?? "";

  if (!mergeSha) {
    throw new Error("MERGE_SHA is required");
  }

  const beforeSha = run(`git rev-parse ${mergeSha}^1`);
  const audit = auditImproved(beforeSha, mergeSha);

  if (!audit.improved) {
    console.log("No audit improvement detected; skipping security release.");
    return;
  }

  runInherit(`git checkout --force ${mergeSha}`);
  const currentVersion = readPackageVersion();
  const nextVersion = bumpPatch(currentVersion);
  const updates = parseDependabotUpdates(prBody, prTitle);
  const entry = buildSecurityChangelogEntry({
    version: nextVersion,
    date: todayIso(),
    updates,
    audit,
  });

  writePackageVersion(nextVersion);
  prependChangelog("CHANGELOG.md", entry);

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    writeFileSync(githubOutput, `version=${nextVersion}\n`, { flag: "a" });
  }

  console.log(`Prepared security release ${nextVersion}`);
}

function notesCommand() {
  const version = process.env.VERSION;
  if (!version) {
    throw new Error("VERSION is required");
  }

  const notes = extractReleaseNotes("CHANGELOG.md", version);
  process.stdout.write(notes);
}

const command = process.argv[2];

if (command === "prepare") {
  await prepareCommand();
} else if (command === "notes") {
  notesCommand();
} else if (command === "check-pr") {
  const isSecurity = isSecurityDependabotPr({
    userLogin: process.env.PR_USER ?? "",
    body: process.env.PR_BODY ?? "",
    labels: JSON.parse(process.env.PR_LABELS ?? "[]"),
  });
  process.exit(isSecurity ? 0 : 1);
} else if (process.argv[1]?.endsWith("security-release.mjs")) {
  console.error("Usage: node scripts/security-release.mjs <prepare|notes|check-pr>");
  process.exit(1);
}
