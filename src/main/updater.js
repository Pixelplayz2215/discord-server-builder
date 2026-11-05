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
// No connection, or GitHub's API failing for a moment (5xx), is tried again after a short wait.
async function fetchRelease() {
  const res = await withRetries(
    async () => {
      const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: HEADERS }).catch(() => {
        throw failure('GitHub couldn\'t be reached. Check your internet connection.', { retry: true });
      });
      if (r.status >= 500) throw httpFailure(r, `GitHub returned HTTP ${r.status}.`);
      return r;
    },
    { waits: [1000, 3000] },
  );
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

// Watches GitHub for a new release while the app runs, in the tray too. Each look asks the release
// page (github.com/…/releases/latest), which redirects to the newest release's tag: one small request
// that's never cached and doesn't count against GitHub's API rate limit, unlike the API (whose
// answers can be a minute old, and which allows 60 requests an hour). onNewVersion(version) is called
// once for each newer version.
const WATCH_EVERY_MS = 2 * 60 * 1000;
function createReleaseWatcher({ onNewVersion, current = () => app.getVersion(), fetchImpl = fetch, everyMs = WATCH_EVERY_MS, firstLookMs = 20 * 1000 }) {
  let told = null;
  let timer = null;
  let first = null;

  async function look() {
    try {
      const res = await fetchImpl(RELEASES_PAGE, { method: 'HEAD', redirect: 'manual', headers: { 'User-Agent': HEADERS['User-Agent'] } });
      // No release yet (it redirects to the releases list), or offline: look again next time.
      const tag = String(res.headers.get('location') || '').match(/\/releases\/tag\/([^/?#]+)$/)?.[1];
      if (!tag) return;
      const version = decodeURIComponent(tag).replace(/^v/i, '');
      if (version && version !== told && isNewer(version, current())) {
        told = version;
        onNewVersion(version);
      }
    } catch {
      // offline: look again next time
    }
  }

  return {
    start() {
      if (timer) return;
      first = setTimeout(look, firstLookMs);
      timer = setInterval(look, everyMs);
    },
    stop() {
      clearTimeout(first);
      clearInterval(timer);
      timer = null;
    },
    look,
  };
}

// GitHub's servers sometimes fail for a moment (HTTP 5xx), most often right after a release is
// published, and connections drop or stall. Those are tried again after these waits (so 4 tries in
// all). A 404, a refused link or a full disk isn't: trying again wouldn't help.
const RETRY_WAITS_MS = [2000, 5000, 15000];
const MAX_WAIT_MS = 60 * 1000;
// A download that sends nothing for this long is stopped and tried again.
const STALL_MS = 30 * 1000;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const failure = (message, { retry = false, waitMs = 0 } = {}) => Object.assign(new Error(message), { retry, waitMs });

// Timeouts, rate limits and server errors are worth another try, after the Retry-After the server
// asks for (in seconds), up to a minute.
function httpFailure(res, message) {
  const after = Number(res.headers?.get('retry-after'));
  return failure(message, { retry: res.status === 408 || res.status === 429 || res.status >= 500, waitMs: after > 0 ? after * 1000 : 0 });
}

// Runs attempt() until it succeeds or fails in a way another try can't fix. onRetry({ message,
// waitMs, next, tries }) says a try failed and when the next one starts.
async function withRetries(attempt, { waits = RETRY_WAITS_MS, sleep = pause, onRetry = () => {} } = {}) {
  for (let n = 1; ; n++) {
    try {
      return await attempt(n);
    } catch (err) {
      if (!err.retry || n > waits.length) throw err;
      const waitMs = Math.min(MAX_WAIT_MS, Math.max(waits[n - 1], err.waitMs || 0));
      onRetry({ message: err.message, waitMs, next: n + 1, tries: waits.length + 1 });
      await sleep(waitMs);
    }
  }
}

// One try at the download, into the partial file. size is the file's size from the release, which
// catches a download that arrives cut short.
async function downloadOnce(url, partial, onProgress, { size, stallMs, fetchImpl }) {
  const controller = new AbortController();
  let stalled = false;
  let timer = null;
  const watch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stalled = true;
      controller.abort();
    }, stallMs);
  };
  watch();
  try {
    let res;
    try {
      res = await fetchImpl(url, { headers: { 'User-Agent': HEADERS['User-Agent'] }, signal: controller.signal });
    } catch {
      throw failure(stalled ? 'Download failed (GitHub stopped answering).' : 'Download failed (GitHub couldn\'t be reached).', { retry: true });
    }
    if (!res.ok || !res.body) {
      res.body?.cancel().catch(() => {});
      throw httpFailure(res, `Download failed (HTTP ${res.status}).`);
    }
    // Content-Length counts compressed bytes when the server compresses, so it only stands in for
    // the release's size when it doesn't.
    const total = size || (res.headers.get('content-encoding') ? 0 : Number(res.headers.get('content-length')) || 0);
    let received = 0;
    onProgress(0, total);
    const counter = new Transform({
      transform(chunk, _encoding, done) {
        watch();
        received += chunk.length;
        onProgress(received, total);
        done(null, chunk);
      },
    });
    // pipeline() passes one stream's error on to the others, so the side that failed first says
    // whether it was the connection (worth another try) or the disk (not).
    let failedFirst = null;
    const source = Readable.fromWeb(res.body).on('error', () => (failedFirst ??= 'network'));
    const file = fs.createWriteStream(partial).on('error', () => (failedFirst ??= 'disk'));
    try {
      await pipeline(source, counter, file);
    } catch (err) {
      if (failedFirst !== 'network') throw err;
      throw failure(stalled ? 'Download failed (GitHub stopped sending the file).' : 'Download failed (the connection dropped).', { retry: true });
    }
    if (total && received !== total) throw failure('Download failed (the file arrived incomplete).', { retry: true });
  } finally {
    clearTimeout(timer);
  }
}

// Downloads url to dest, trying again when GitHub fails for a moment or the connection drops. The
// file only appears at dest once it's complete.
async function downloadFile(url, dest, onProgress, { size = 0, onRetry, waits, sleep, stallMs = STALL_MS, fetchImpl = fetch } = {}) {
  const partial = `${dest}.download`;
  try {
    await withRetries(() => downloadOnce(url, partial, onProgress, { size, stallMs, fetchImpl }), { waits, sleep, onRetry });
    fs.renameSync(partial, dest);
  } catch (err) {
    fs.rmSync(partial, { force: true });
    if (err.retry) err.message += ` It was tried ${(waits || RETRY_WAITS_MS).length + 1} times. Try again in a few minutes.`;
    throw err;
  }
  return dest;
}

// Looks the release up again here rather than trusting a URL from the UI, and only accepts
// assets served from this repository's release downloads. The portable exe is downloaded next to
// the running one; the installer goes to the temp folder. onRetry is told when a try fails and the
// download starts again.
async function installUpdate(onProgress, { onRetry } = {}) {
  if (!canSelfUpdate()) throw new Error('This copy can\'t update itself (it isn\'t the installed app or the portable exe). Download the new version from GitHub instead.');
  const found = await fetchRelease();
  if (!found?.exe || !isNewer(found.version, app.getVersion())) throw new Error('No newer version was found.');

  const url = new URL(found.exe.browser_download_url);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !url.pathname.startsWith(`/${REPO}/releases/download/`)) {
    throw new Error('The download link does not point at this app\'s GitHub releases.');
  }
  const exe = portableExe();
  const dest = exe ? path.join(path.dirname(exe), `${path.parse(exe).name}.update.exe`) : path.join(os.tmpdir(), 'DiscordServerBuilder-setup.exe');
  return downloadFile(url.href, dest, onProgress, { size: found.exe.size, onRetry });
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

module.exports = { checkForUpdate, createReleaseWatcher, installUpdate, restartInto, repairShortcuts, downloadFile, swapScript, installerScript, isNewer, RELEASES_PAGE };
