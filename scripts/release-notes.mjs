#!/usr/bin/env node
/**
 * Builds the GitHub release body from the commit log.
 *
 * This repository pushes straight to main using Conventional Commit subjects
 * and never opens pull requests. GitHub's own auto-generated release notes are
 * built from *merged pull requests*, so for this repo they would come out
 * essentially empty. Deriving the notes from the commits between the previous
 * "v*" tag and HEAD works regardless.
 *
 * Usage:
 *   node scripts/release-notes.mjs            # previous v* tag .. HEAD
 *   node scripts/release-notes.mjs <range>    # explicit git range, for testing
 *
 * Writes RELEASE_BODY.md at the repository root and echoes it to stdout.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

// execFileSync with an argument array, never a shell string: quoting rules
// differ between cmd.exe and sh, and a pattern like v* must reach git verbatim.
const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const tag = `v${version}`;

// Newest "v*" tag reachable from HEAD = the previous release.
let prev = '';
try {
  prev = git(['describe', '--tags', '--abbrev=0', '--match', 'v*', 'HEAD']);
} catch {
  prev = '';
}

let range = process.argv[2];
if (!range) {
  if (!prev) {
    console.error(
      "No previous 'v*' tag is reachable from HEAD, so the changelog range is unknown.\n" +
        'Refusing to fall back to the entire history. Either create/push a version tag,\n' +
        'or pass an explicit range:\n' +
        '  node scripts/release-notes.mjs <range>',
    );
    process.exit(1);
  }
  range = `${prev}..HEAD`;
}

const subjects = git(['log', '--no-merges', '--pretty=format:%s', range])
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);

const BREAKING = /^\w+(\(.+?\))?!: /;
const GROUPS = [
  ['feat', 'Features'],
  ['fix', 'Fixes'],
  ['perf', 'Performance'],
  ['refactor', 'Refactoring'],
  ['docs', 'Documentation'],
  ['chore', 'Chores'],
];

const claimed = new Set();
const sections = [];

const breaking = subjects.filter((s) => BREAKING.test(s));
if (breaking.length) {
  breaking.forEach((s) => claimed.add(s));
  sections.push(
    `### Breaking changes\n\n${breaking.map((s) => `- ${s.replace(BREAKING, '')}`).join('\n')}`,
  );
}

for (const [prefix, title] of GROUPS) {
  const re = new RegExp(`^${prefix}(\\(.+?\\))?!?: `);
  const items = subjects.filter((s) => re.test(s) && !claimed.has(s));
  if (!items.length) continue;
  items.forEach((s) => claimed.add(s));
  sections.push(`### ${title}\n\n${items.map((s) => `- ${s.replace(re, '')}`).join('\n')}`);
}

const other = subjects.filter((s) => !claimed.has(s));
if (other.length) {
  sections.push(`### Other\n\n${other.map((s) => `- ${s}`).join('\n')}`);
}

const repo = process.env.GITHUB_REPOSITORY || 'helloworldbugs/keepass-cat';
const changelog = prev
  ? `\n---\n\nFull changelog: https://github.com/${repo}/compare/${prev}...${tag}`
  : '';

const body = sections.length
  ? `# ${tag}\n\n${sections.join('\n\n')}${changelog}\n`
  : `# ${tag}\n\nNo user-facing changes since ${prev || 'the beginning'}.${changelog}\n`;

writeFileSync('RELEASE_BODY.md', body);
process.stdout.write(body);
