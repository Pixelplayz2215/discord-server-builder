// Checks the app's latest GitHub release for a newer build. Each version has its own release; the
// version.json attached to it says which version the files are and what changed lately. The portable
// .exe downloads the new exe and swaps it in place of itself; the installed app runs the new installer.
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
// Portable copies update to the portable exe, installed copies to the installer. Private mod-view
// builds aren't published, so they update to the regular portable exe; a moderator's saved sign-in
// (and its portal address) carries over, so nothing is lost.
const PORTABLE_ASSET = /portable\.exe$/i;
const SETUP_ASSET = /setup\.exe$/i;

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

// Copies made by the setup exe sit next to the uninstaller electron-builder writes.
function isInstalled() {
  if (portableExe() || !app.isPackaged) return false;
  try {
    return fs.readdirSync(path.dirname(process.execPath)).some((f) => /^Uninstall .*\.exe$/i.test(f));
  } catch {
    return false;
  }
}

const canSelfUpdate = () => !!portableExe() || isInstalled();

// The release, the version its files are, and the exe this copy should update to (null if none).
async function fetchRelease() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: HEADERS });
  if (res.status === 404) return null;
  if (res.status === 403 || res.status === 429) throw new Error('GitHub\'s rate limit was reached. Try again in a little while.');
  if (!res.ok) throw new Error(`GitHub returned HTTP ${res.status}.`);
  const release = await res.json();
  const assets = release.assets || [];
  const exe = assets.find((a) => (isInstalled() ? SETUP_ASSET : PORTABLE_ASSET).test(a.name)) || null;

  let version = String(release.tag_name || '').replace(/^v/i, '');
  let changelog = [];
  const manifest = assets.find((a) => a.name === 'version.json');
  if (manifest) {
    const m = await fetch(manifest.browser_download_url, { headers: { 'User-Agent': HEADERS['User-Agent'] } });
    const data = m.ok ? await m.json().catch(() => null) : null;
    if (data?.version) version = String(data.version);
    if (Array.isArray(data?.changelog)) changelog = data.changelog;
  }
  return { release, version, exe, changelog };
}

// What changed in each version newer than this one (version.json lists the latest few).
const changesSince = (changelog, current) =>
  changelog
    .filter((e) => e && isNewer(e.version, current) && Array.isArray(e.changes))
    .slice(0, 10)
    .map((e) => ({ version: String(e.version), changes: e.changes.map((c) => String(c).slice(0, 600)).slice(0, 20) }));

async function checkForUpdate() {
  const current = app.getVersion();
  const found = await fetchRelease();
  if (!found) return { current, available: false, url: RELEASES_PAGE, message: 'No release found on GitHub yet.' };
  const { release, version, exe, changelog } = found;
  return {
    current,
    latest: version,
    available: isNewer(version, current),
    changes: changesSince(changelog, current),
    notes: String(release.body || '').slice(0, 2000),
    url: release.html_url || RELEASES_PAGE,
    asset: exe ? { name: exe.name, size: exe.size } : null,
    canInstall: !!exe && canSelfUpdate(),
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
// assets served from this repository's release downloads. The portable exe is downloaded next to
// the running one; the installer goes to the temp folder.
async function installUpdate(onProgress) {
  if (!canSelfUpdate()) throw new Error('This copy can\'t update itself (it isn\'t the installed app or the portable exe). Download the new version from GitHub instead.');
  const found = await fetchRelease();
  if (!found?.exe || !isNewer(found.version, app.getVersion())) throw new Error('No newer version was found.');

  const url = new URL(found.exe.browser_download_url);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !url.pathname.startsWith(`/${REPO}/releases/download/`)) {
    throw new Error('The download link does not point at this app\'s GitHub releases.');
  }
  const exe = portableExe();
  const dest = exe ? path.join(path.dirname(exe), `${path.parse(exe).name}.update.exe`) : path.join(os.tmpdir(), 'DiscordServerBuilder-setup.exe');
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

// Passed to the relaunched app so it knows an update just finished.
const AFTER_UPDATE_FLAG = '--after-update';

// A small batch file for installed copies: runs the new installer silently into *this* copy's
// folder (/D), waits for it, then starts this same exe again and cleans up.
// The installer's own --force-run isn't used: it relaunches through the Start menu shortcut, which
// keeps its old target during updates, so a PC with a second install (or a stale shortcut) would
// open the wrong copy. /D likewise stops the installer picking a folder from its saved settings.
// It's quoted because electron-builder re-reads /D with a parser that stops at the first space,
// which would turn "E:\Discord Server Builder" into "E:\Discord".
function installerScript(setup, exe) {
  const q = (p) => p.replace(/%/g, '%%');
  return [
    '@echo off',
    'chcp 65001 >nul',
    `start "" /wait "${q(setup)}" /S --updated /D="${q(path.dirname(exe))}"`,
    `start "" "${q(exe)}" ${AFTER_UPDATE_FLAG}`,
    `del "${q(setup)}" >nul 2>&1`,
    '(goto) 2>nul & del "%~f0"',
    '',
  ].join('\r\n');
}

function restartInto(newFile) {
  app.releaseSingleInstanceLock();
  const script = path.join(os.tmpdir(), `discord-server-builder-update-${process.pid}.cmd`);
  const contents = isInstalled() ? installerScript(newFile, process.execPath) : swapScript(newFile, portableExe());
  fs.writeFileSync(script, contents, 'utf8');
  spawn('cmd.exe', ['/d', '/c', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  app.quit();
}

// After an installed update, point this app's Start menu and desktop shortcuts at this copy if they
// lead somewhere else (for example an older install in another folder).
function repairShortcuts() {
  if (!process.argv.includes(AFTER_UPDATE_FLAG) || !isInstalled()) return [];
  const { shell } = require('electron');
  const name = `${app.getName()}.lnk`;
  const links = [
    path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', name),
    path.join(app.getPath('desktop'), name),
  ];
  const fixed = [];
  for (const link of links) {
    try {
      if (!fs.existsSync(link)) continue;
      const current = shell.readShortcutLink(link);
      if (path.resolve(current.target).toLowerCase() === process.execPath.toLowerCase()) continue;
      shell.writeShortcutLink(link, 'update', { target: process.execPath, cwd: path.dirname(process.execPath), icon: process.execPath, iconIndex: 0 });
      fixed.push(link);
    } catch {
      // a shortcut we can't read or write is left alone
    }
  }
  return fixed;
}

module.exports = { checkForUpdate, installUpdate, restartInto, repairShortcuts, downloadFile, swapScript, installerScript, isNewer, RELEASES_PAGE };
