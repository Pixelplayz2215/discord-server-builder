// Checks the app's GitHub release for a newer build. There is one permanent release (tag "latest")
// whose files are replaced on every update; the version.json attached to it says which version
// they are. In the portable .exe the app can download the new exe and swap it in place of itself.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { app } = require('electron');
const pkg = require('../../package.json');

const REPO = pkg.updateRepo;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const HEADERS = { Accept: 'application/vnd.github+json', 'User-Agent': 'DiscordServerBuilder-Updater' };
// mod-view builds have a mod portal address baked in, so they keep updating to the mod-view file.
const PREFERRED_ASSET = pkg.modPortalUrl ? /^mod-view\.exe$/i : /portable\.exe$/i;

const parseVersion = (v) =>
  String(v)
    .replace(/^v/i, '')
    .split(/[.-]/)
    .slice(0, 3)
    .map((n) => parseInt(n, 10) || 0);

function isNewer(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

// Set by the portable launcher to the .exe the user started; unset when running from source.
const portableExe = () => process.env.PORTABLE_EXECUTABLE_FILE || null;

// The release, the version its files are, and the exe this copy should update to (null if none).
async function fetchRelease() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: HEADERS });
  if (res.status === 404) return null;
  if (res.status === 403 || res.status === 429) throw new Error('GitHub\'s rate limit was reached. Try again in a little while.');
  if (!res.ok) throw new Error(`GitHub returned HTTP ${res.status}.`);
  const release = await res.json();
  const assets = release.assets || [];
  const exe = assets.find((a) => PREFERRED_ASSET.test(a.name)) || assets.find((a) => /portable\.exe$/i.test(a.name)) || null;

  let version = String(release.tag_name || '').replace(/^v/i, '');
  const manifest = assets.find((a) => a.name === 'version.json');
  if (manifest) {
    const m = await fetch(manifest.browser_download_url, { headers: { 'User-Agent': HEADERS['User-Agent'] } });
    const data = m.ok ? await m.json().catch(() => null) : null;
    if (data?.version) version = String(data.version);
  }
  return { release, version, exe };
}

async function checkForUpdate() {
  const current = app.getVersion();
  const found = await fetchRelease();
  if (!found) return { current, available: false, url: RELEASES_PAGE, message: 'No release found on GitHub yet.' };
  const { release, version, exe } = found;
  return {
    current,
    latest: version,
    available: isNewer(version, current),
    notes: String(release.body || '').slice(0, 2000),
    url: release.html_url || RELEASES_PAGE,
    asset: exe ? { name: exe.name, size: exe.size } : null,
    canInstall: !!exe && !!portableExe(),
  };
}

async function downloadFile(url, dest, onProgress) {
  const res = await fetch(url, { headers: { 'User-Agent': HEADERS['User-Agent'] } });
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status}).`);
  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;
  const counter = new Transform({
    transform(chunk, _encoding, done) {
      received += chunk.length;
      onProgress(received, total);
      done(null, chunk);
    },
  });
  const partial = `${dest}.download`;
  try {
    await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(partial));
    fs.renameSync(partial, dest);
  } catch (err) {
    fs.rmSync(partial, { force: true });
    throw err;
  }
  return dest;
}

// Looks the release up again here rather than trusting a URL from the UI, and only accepts
// assets served from this repository's release downloads. Downloads next to the running exe.
async function installUpdate(onProgress) {
  const exe = portableExe();
  if (!exe) throw new Error('Only the portable .exe can update itself. Download the new version from GitHub instead.');
  const found = await fetchRelease();
  if (!found?.exe || !isNewer(found.version, app.getVersion())) throw new Error('No newer version was found.');

  const url = new URL(found.exe.browser_download_url);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !url.pathname.startsWith(`/${REPO}/releases/download/`)) {
    throw new Error('The download link does not point at this app\'s GitHub releases.');
  }
  const dest = path.join(path.dirname(exe), `${path.parse(exe).name}.update.exe`);
  return downloadFile(url.href, dest, onProgress);
}

// A small batch file that waits for this copy to exit, moves the new exe over the old one (so the
// file name and any shortcuts stay the same), starts it, then deletes itself. If the old file stays
// locked for about a minute it starts the downloaded copy instead.
function swapScript(newFile, target) {
  const q = (p) => p.replace(/%/g, '%%');
  return [
    '@echo off',
    'chcp 65001 >nul',
    'set tries=0',
    ':retry',
    `move /y "${q(newFile)}" "${q(target)}" >nul 2>&1 && goto launch`,
    'set /a tries+=1',
    'if %tries% geq 60 goto launch',
    'ping -n 2 127.0.0.1 >nul',
    'goto retry',
    ':launch',
    `if exist "${q(newFile)}" (start "" "${q(newFile)}") else (start "" "${q(target)}")`,
    '(goto) 2>nul & del "%~f0"',
    '',
  ].join('\r\n');
}

function restartInto(newFile) {
  const script = path.join(os.tmpdir(), `discord-server-builder-update-${process.pid}.cmd`);
  fs.writeFileSync(script, swapScript(newFile, portableExe()), 'utf8');
  app.releaseSingleInstanceLock();
  spawn('cmd.exe', ['/d', '/c', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  app.quit();
}

module.exports = { checkForUpdate, installUpdate, restartInto, downloadFile, swapScript, isNewer, RELEASES_PAGE };
