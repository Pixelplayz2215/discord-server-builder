// Publishes a new version of the app as its own GitHub release, with its changes from CHANGELOG.md.
//   1. Moves the lines under "## Unreleased" in CHANGELOG.md into a new section for this version (it
//      stops if there are none) and, if package.json's version is already published, bumps the patch
//      number. Both are committed as "Release x.y.z" and pushed.
//   2. Builds DiscordServerBuilder-setup.exe (installer) and DiscordServerBuilder-portable.exe, plus
//      your private mod-view.exe when mod-view.json exists.
//   3. Creates the release "vx.y.z" with both exes and version.json, notes made from the version's
//      changes plus RELEASE_NOTES.md, and marks it latest so the app's update check finds it. Copies
//      go to releases/. mod-view.exe is only copied to releases/; it is never uploaded.
// If a release run stops partway (say the build fails), run it again: it picks up the same version.
// Run: npm run release   (needs the GitHub CLI signed in with push access to updateRepo)
// For a bigger step than the patch number: npm run release -- minor (or major, or an exact 1.2.0).
const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const { versionEntries, promoteUnreleased, releaseNotes } = require('./changelog');

const root = path.join(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const changelogPath = path.join(root, 'CHANGELOG.md');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const repo = pkg.updateRepo;

const fail = (message) => {
  console.error(`\n${message}`);
  process.exit(1);
};
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });
const output = (cmd) => execSync(cmd, { cwd: root, encoding: 'utf8' });
const gh = (...args) => spawnSync('gh', args, { cwd: root, encoding: 'utf8' });

const parse = (v) => String(v).split('.').map((n) => parseInt(n, 10) || 0);
const isNewer = (a, b) => {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// The version the update check currently sees: the latest release's version.json (or its tag).
function latestPublished() {
  const res = gh('api', `repos/${repo}/releases/latest`);
  if (res.status !== 0) return null;
  const release = JSON.parse(res.stdout);
  const manifest = gh('release', 'download', release.tag_name, '--repo', repo, '--pattern', 'version.json', '--output', '-');
  if (manifest.status === 0) return JSON.parse(manifest.stdout).version;
  return String(release.tag_name).replace(/^v/i, '');
}

// The release has to match the pushed code, so start from a clean, pushed main.
if (output('git status --porcelain').trim()) fail('You have uncommitted changes. Commit and push them first.');
output('git fetch --quiet');
if (/ahead \d+/.test(output('git status -sb').split('\n')[0])) fail('Your branch has commits that are not on GitHub yet. Push them first.');
if (gh('--version').error) fail('The GitHub CLI (gh) was not found. Install it from https://cli.github.com and run "gh auth login".');

// The version to release: asked for (minor, major or an exact x.y.z), else package.json's, or the next
// patch number when that one is already published.
function nextVersion(wanted, published) {
  const base = published || pkg.version;
  const [major, minor, patch] = parse(base);
  if (wanted === 'major') return `${major + 1}.0.0`;
  if (wanted === 'minor') return `${major}.${minor + 1}.0`;
  if (wanted === 'patch') return `${major}.${minor}.${patch + 1}`;
  if (/^\d+\.\d+\.\d+$/.test(wanted)) return wanted;
  return fail(`"${wanted}" isn't a version. Use minor, major, patch or an exact version like 1.2.0.`);
}

const published = latestPublished();
const wanted = process.argv[2];
let version = pkg.version;
if (wanted && !isNewer(pkg.version, published || '0.0.0')) {
  version = nextVersion(wanted, published);
  if (published && !isNewer(version, published)) fail(`Version ${version} isn't newer than ${published}, which is already published.`);
} else if (published && !isNewer(version, published)) {
  const [major, minor, patch] = parse(published);
  version = `${major}.${minor}.${patch + 1}`;
}
const tag = `v${version}`;

// The changes for this version: new ones from "Unreleased", or the section a stopped run already made.
let changelog = fs.readFileSync(changelogPath, 'utf8');
let changes = versionEntries(changelog, Infinity).find((e) => e.version === version)?.changes;
const files = [];
if (!changes) {
  try {
    const promoted = promoteUnreleased(changelog, version, today());
    changelog = promoted.text;
    changes = promoted.changes;
  } catch (err) {
    fail(err.message);
  }
  fs.writeFileSync(changelogPath, changelog);
  files.push('CHANGELOG.md');
}
if (version !== pkg.version) {
  console.log(`Version ${published} is already published; releasing ${version}.`);
  pkg.version = version;
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  const lockPath = path.join(root, 'package-lock.json');
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  lock.version = version;
  if (lock.packages?.['']) lock.packages[''].version = version;
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  files.push('package.json', 'package-lock.json');
}
if (files.length) {
  run(`git add ${files.join(' ')}`);
  run(`git commit -m "Release ${version}"`);
  run('git push');
}

const assets = [path.join('dist', 'DiscordServerBuilder-setup.exe'), path.join('dist', 'DiscordServerBuilder-portable.exe')];
const localOnly = [];
run('npm run dist:all');
if (fs.existsSync(path.join(root, 'mod-view.json'))) {
  run('npm run dist:mod');
  localOnly.push(path.join('dist', 'mod-view.exe'));
}
for (const file of [...assets, ...localOnly]) if (!fs.existsSync(path.join(root, file))) fail(`Build output not found: ${file}`);

// version.json tells the app which version this is, and what changed lately for its update popup.
const commit = output('git rev-parse HEAD').trim();
const manifestPath = path.join('dist', 'version.json');
fs.writeFileSync(path.join(root, manifestPath), JSON.stringify({ version, commit, publishedAt: new Date().toISOString(), changelog: versionEntries(changelog) }, null, 2));
const notesPath = path.join('dist', 'release-notes.md');
fs.writeFileSync(path.join(root, notesPath), releaseNotes({ version, changes, template: fs.readFileSync(path.join(root, 'RELEASE_NOTES.md'), 'utf8'), repo }));

// Each version gets its own tag; a stopped run may already have made it.
const existingTag = spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], { cwd: root, encoding: 'utf8' }).stdout.trim();
if (existingTag && existingTag !== commit) fail(`The tag ${tag} already exists on another commit. Check what it is before releasing.`);
if (!existingTag) run(`git tag ${tag} ${commit}`);
run(`git push origin refs/tags/${tag}`);

const title = `Discord Server Builder ${tag}`;
const upload = [...assets, manifestPath];
const result =
  gh('release', 'view', tag, '--repo', repo).status === 0
    ? gh('release', 'upload', tag, ...upload, '--repo', repo, '--clobber')
    : gh('release', 'create', tag, ...upload, '--repo', repo, '--title', title, '--notes-file', notesPath, '--latest', '--verify-tag');
if (result.status !== 0) fail(`Uploading to GitHub failed:\n${result.stderr}`);
const edited = gh('release', 'edit', tag, '--repo', repo, '--title', title, '--notes-file', notesPath, '--latest');
if (edited.status !== 0) fail(`Updating the release notes failed:\n${edited.stderr}`);

const releasesDir = path.join(root, 'releases');
fs.mkdirSync(releasesDir, { recursive: true });
for (const file of [...assets, ...localOnly]) fs.copyFileSync(path.join(root, file), path.join(releasesDir, path.basename(file)));

console.log(`\nPublished ${tag} at https://github.com/${repo}/releases/tag/${tag} (copies in releases/).`);
if (localOnly.length) console.log('mod-view.exe was built into releases/ only. Share it with your mods privately.');
console.log('Apps checking for updates will now offer it.');
