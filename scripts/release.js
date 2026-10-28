// Builds the portable .exe (plus the mod-view build when "modViewPortalUrl" is set) and publishes
// them as a GitHub release for the version in package.json, so the app's "Check for updates" can
// find it. Copies of the published files are kept in releases/.
// Bump "version" in package.json, commit and push, then run: npm run release
// (needs the GitHub CLI signed in with push access to updateRepo)
const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const pkg = require('../package.json');

const root = path.join(__dirname, '..');
const tag = `v${pkg.version}`;
const exe = path.join('dist', `DiscordServerBuilder-${pkg.version}-portable.exe`);
const modView = path.join('dist', `mod-view-${pkg.version}.exe`);
const notesFile = path.join('release-notes', `${tag}.md`);
const fail = (message) => {
  console.error(`\n${message}`);
  process.exit(1);
};
const output = (cmd) => execSync(cmd, { cwd: root, encoding: 'utf8' });

// The release tag points at the pushed code, so the exe must be built from exactly that.
if (output('git status --porcelain').trim()) fail('You have uncommitted changes. Commit and push them first.');
output('git fetch --quiet');
if (/ahead \d+/.test(output('git status -sb').split('\n')[0])) fail('Your branch has commits that are not on GitHub yet. Push them first.');

const existing = spawnSync('gh', ['release', 'view', tag, '--repo', pkg.updateRepo], { cwd: root, stdio: 'ignore' });
if (existing.error) fail('The GitHub CLI (gh) was not found. Install it from https://cli.github.com and run "gh auth login".');
if (existing.status === 0) fail(`Release ${tag} already exists. Bump "version" in package.json first.`);

const assets = [exe];
execSync('npm run dist', { cwd: root, stdio: 'inherit' });
if (pkg.modViewPortalUrl) {
  execSync('npm run dist:mod', { cwd: root, stdio: 'inherit' });
  assets.push(modView);
}
for (const file of assets) if (!fs.existsSync(path.join(root, file))) fail(`Build output not found: ${file}`);

const releasesDir = path.join(root, 'releases');
fs.mkdirSync(releasesDir, { recursive: true });
for (const file of assets) fs.copyFileSync(path.join(root, file), path.join(releasesDir, path.basename(file)));

const notes = fs.existsSync(path.join(root, notesFile)) ? ['--notes-file', notesFile] : ['--generate-notes'];
const created = spawnSync(
  'gh',
  ['release', 'create', tag, ...assets, '--repo', pkg.updateRepo, '--title', `Discord Server Builder ${tag}`, ...notes],
  { cwd: root, stdio: 'inherit' },
);
if (created.status !== 0) fail('Creating the GitHub release failed.');
console.log(`\nPublished ${tag} (copies in releases/). Apps checking for updates will now offer it.`);
