// Reads and updates CHANGELOG.md for the release script: the changes waiting under "## Unreleased",
// each version's section, and the text of a version's release page.

const VERSION_HEADING = /^(\d+\.\d+\.\d+) \((\d{4}-\d{2}-\d{2})\)$/;

// { intro, sections: [{ heading, version, date, body }] } in file order (newest first).
function parseChangelog(text) {
  const [intro, ...parts] = String(text).replace(/\r\n/g, '\n').split(/^## /m);
  const sections = parts.map((part) => {
    const [heading, ...rest] = part.split('\n');
    const m = heading.trim().match(VERSION_HEADING);
    return { heading: heading.trim(), version: m?.[1] || null, date: m?.[2] || null, body: rest.join('\n').trim() };
  });
  return { intro: intro.trimEnd(), sections };
}

// The "- " lines of a section, without the dash.
const changesOf = (body) =>
  body
    .split('\n')
    .filter((line) => /^- \S/.test(line))
    .map((line) => line.slice(2).trim());

const render = ({ intro, sections }) => `${[intro, ...sections.map((s) => `## ${s.heading}${s.body ? `\n\n${s.body}` : ''}`)].join('\n\n')}\n`;

// The newest versions, for version.json (so the app's update popup can list what changed).
function versionEntries(text, max = 10) {
  return parseChangelog(text)
    .sections.filter((s) => s.version)
    .slice(0, max)
    .map((s) => ({ version: s.version, date: s.date, changes: changesOf(s.body) }));
}

// Moves the lines under "Unreleased" into a new "## <version> (<date>)" section, leaving
// "Unreleased" empty for next time.
function promoteUnreleased(text, version, date) {
  const doc = parseChangelog(text);
  const unreleased = doc.sections.find((s) => s.heading === 'Unreleased');
  if (!unreleased) throw new Error('CHANGELOG.md has no "## Unreleased" section.');
  const changes = changesOf(unreleased.body);
  if (!changes.length) throw new Error('Add what changed as "- " lines under "## Unreleased" in CHANGELOG.md first.');
  if (doc.sections.some((s) => s.version === version)) throw new Error(`CHANGELOG.md already has a section for ${version}.`);
  const index = doc.sections.indexOf(unreleased);
  const sections = [...doc.sections];
  sections.splice(index, 1, { heading: 'Unreleased', body: '' }, { heading: `${version} (${date})`, version, date, body: unreleased.body });
  return { text: render({ intro: doc.intro, sections }), changes };
}

// The release page: this version's changes first (older copies of the app show the start of it in
// their update popup), then the standing text from RELEASE_NOTES.md.
function releaseNotes({ version, changes, template, repo }) {
  return [
    `## What's new in ${version}`,
    '',
    ...changes.map((c) => `- ${c}`),
    '',
    `Every version's changes: [CHANGELOG.md](https://github.com/${repo}/blob/main/CHANGELOG.md)`,
    '',
    String(template || '').trim(),
    '',
  ].join('\n');
}

module.exports = { parseChangelog, changesOf, versionEntries, promoteUnreleased, releaseNotes };
