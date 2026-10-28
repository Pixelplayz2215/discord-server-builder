// Publishes the app to its one permanent GitHub release (tag "latest"), replacing the files there.
//   1. If package.json's version is already published, bumps the patch number and commits + pushes it
//      (the app's update check compares versions, so every publish needs a new one).
//   2. Builds DiscordServerBuilder-portable.exe, plus mod-view.exe when "modViewPortalUrl" is set.
//   3. Uploads them with version.json (replacing the old files), moves the "latest" tag to this
//      commit, refreshes the notes from RELEASE_NOTES.md, and keeps copies in releases/.
// Run: npm run release   (needs the GitHub CLI signed in with push access to updateRepo)
const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const TAG = 'latest';
const pkgPath = path.join(root, 'package.json');
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

// The release has to match the pushed code, so start from a clean, pushed main.
if (output('git status --porcelain').trim()) fail('You have uncommitted changes. Commit and push them first.');
output('git fetch --quiet');
if (/ahead \d+/.test(output('git status -sb').split('\n')[0])) fail('Your branch has commits that are not on GitHub yet. Push them first.');
if (gh('--version').error) fail('The GitHub CLI (gh) was not found. Install it from https://cli.github.com and run "gh auth login".');

const releaseExists = gh('release', 'view', TAG, '--repo', repo).status === 0;
let published = null;
if (releaseExists) {
  const manifest = gh('release', 'download', TAG, '--repo', repo, '--pattern', 'version.json', '--output', '-');
  if (manifest.status === 0) published = JSON.parse(manifest.stdout).version;
}

if (published && !isNewer(pkg.version, published)) {
  const [major, minor, patch] = parse(published);
  pkg.version = `${major}.${minor}.${patch + 1}`;
  console.log(`Version ${published} is already published; bumping to ${pkg.version}.`);
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  const lockPath = path.join(root, 'package-lock.json');
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  lock.version = pkg.version;
  if (lock.packages?.['']) lock.packages[''].version = pkg.version;
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  run('git add package.json package-lock.json');
  run(`git commit -m "Release ${pkg.version}"`);
  run('git push');
}

const assets = [path.join('dist', 'DiscordServerBuilder-portable.exe')];
run('npm run dist');
if (pkg.modViewPortalUrl) {
  run('npm run dist:mod');
  assets.push(path.join('dist', 'mod-view.exe'));
}
for (const file of assets) if (!fs.existsSync(path.join(root, file))) fail(`Build output not found: ${file}`);

const commit = output('git rev-parse HEAD').trim();
const manifestPath = path.join('dist', 'version.json');
fs.writeFileSync(path.join(root, manifestPath), JSON.stringify({ version: pkg.version, commit, publishedAt: new Date().toISOString() }, null, 2));

const notesPath = path.join('dist', 'release-notes.md');
const notes = fs.existsSync(path.join(root, 'RELEASE_NOTES.md')) ? fs.readFileSync(path.join(root, 'RELEASE_NOTES.md'), 'utf8').trim() : '';
const updated = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
fs.writeFileSync(path.join(root, notesPath), `${notes}\n\n---\n*Last updated ${updated}.*\n`);

// Point the release's tag at the code these files were built from.
run(`git tag -f ${TAG} ${commit}`);
run(`git push -f origin refs/tags/${TAG}`);

const files = [...assets, manifestPath];
const title = 'Discord Server Builder';
const result = releaseExists
  ? gh('release', 'upload', TAG, ...files, '--repo', repo, '--clobber')
  : gh('release', 'create', TAG, ...files, '--repo', repo, '--title', title, '--notes-file', notesPath, '--latest');
if (result.status !== 0) fail(`Uploading to GitHub failed:\n${result.stderr}`);
if (releaseExists) {
  const edited = gh('release', 'edit', TAG, '--repo', repo, '--title', title, '--notes-file', notesPath, '--latest');
  if (edited.status !== 0) fail(`Updating the release notes failed:\n${edited.stderr}`);
}

const releasesDir = path.join(root, 'releases');
fs.mkdirSync(releasesDir, { recursive: true });
for (const file of assets) fs.copyFileSync(path.join(root, file), path.join(releasesDir, path.basename(file)));

console.log(`\nPublished version ${pkg.version} to https://github.com/${repo}/releases/tag/${TAG} (copies in releases/).`);
console.log('Apps checking for updates will now offer it.');
