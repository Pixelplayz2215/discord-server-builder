// Tests for the changelog handling in the release script. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseChangelog, versionEntries, promoteUnreleased, releaseNotes } = require('../scripts/changelog');

const sample = `# Changelog

Intro text.

## Unreleased

- **New thing.** It does \`stuff\`.
- Fixed a bug.

## 1.0.6 (2026-10-30)

- **Social alerts.** Post when people upload.

## 1.0.5 (2026-10-28)

- Tray.
`;

test('the real CHANGELOG.md parses, newest version first, with an Unreleased section', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
  const { sections } = parseChangelog(text);
  assert.equal(sections[0].heading, 'Unreleased');
  const versions = versionEntries(text, Infinity);
  assert.equal(versions[0].version, require('../package.json').version, 'the newest section matches package.json');
  for (const v of versions) assert.ok(v.changes.length, `${v.version} has changes`);
  assert.deepEqual(versions.map((v) => v.version), [...versions.map((v) => v.version)].sort((a, b) => b.localeCompare(a, undefined, { numeric: true })));
});

test('releasing moves the Unreleased lines into a new version section', () => {
  const { text, changes } = promoteUnreleased(sample, '1.0.7', '2026-11-01');
  assert.deepEqual(changes, ['**New thing.** It does `stuff`.', 'Fixed a bug.']);
  const entries = versionEntries(text);
  assert.deepEqual(entries.map((e) => e.version), ['1.0.7', '1.0.6', '1.0.5']);
  assert.equal(entries[0].date, '2026-11-01');
  assert.deepEqual(parseChangelog(text).sections[0], { heading: 'Unreleased', version: null, date: null, body: '' });
  assert.match(text, /^# Changelog\n\nIntro text\.\n\n## Unreleased\n\n## 1\.0\.7 \(2026-11-01\)\n\n- \*\*New thing/);
  assert.ok(text.endsWith('- Tray.\n'));
  // Releasing again with nothing new is refused, as is reusing a version.
  assert.throws(() => promoteUnreleased(text, '1.0.8', '2026-11-02'), /Add what changed/);
  assert.throws(() => promoteUnreleased(sample, '1.0.6', '2026-11-02'), /already has a section/);
});

test('release pages lead with the version\'s changes', () => {
  const notes = releaseNotes({ version: '1.0.7', changes: ['A', 'B'], template: '**App** text.\n', repo: 'me/app' });
  assert.ok(notes.startsWith("## What's new in 1.0.7\n\n- A\n- B\n"));
  assert.match(notes, /\[CHANGELOG\.md\]\(https:\/\/github\.com\/me\/app\/blob\/main\/CHANGELOG\.md\)/);
  assert.ok(notes.trimEnd().endsWith('**App** text.'));
});
