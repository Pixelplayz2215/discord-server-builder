// Checks GitHub Releases for a newer version. In the portable .exe it can also download the new
// portable .exe next to the current one and restart into it.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { app } = require('electron');
const pkg = require('../../package.json');

const REPO = pkg.updateRepo;
const RELEASES_PAGE = `https://github.com/${REPO}/releases`;
const HEADERS = { Accept: 'application/vnd.github+json', 'User-Agent': 'DiscordServerBuilder-Updater' };

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

async function checkForUpdate() {
  const current = app.getVersion();
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: HEADERS });
  if (res.status === 404) {
    return {
      current,
      available: false,
      url: RELEASES_PAGE,
      message: 'No public release found on GitHub yet. Releases in a private repository can\'t be checked.',
    };
  }
  if (res.status === 403 || res.status === 429) throw new Error('GitHub\'s rate limit was reached. Try again in a little while.');
  if (!res.ok) throw new Error(`GitHub returned HTTP ${res.status}.`);

  const release = await res.json();
  const latest = String(release.tag_name || '').replace(/^v/i, '');
  const asset = (release.assets || []).find((a) => /portable\.exe$/i.test(a.name));
  return {
    current,
    latest,
    available: isNewer(latest, current),
    notes: String(release.body || '').slice(0, 2000),
    url: release.html_url || RELEASES_PAGE,
    asset: asset ? { name: asset.name, size: asset.size } : null,
    canInstall: !!asset && !!portableExe(),
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
// assets served from this repository's release downloads.
async function installUpdate(onProgress) {
  const exe = portableExe();
  if (!exe) throw new Error('Only the portable .exe can update itself. Download the new version from GitHub instead.');
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: HEADERS });
  if (res.status === 404) throw new Error('No public release found on GitHub.');
  if (!res.ok) throw new Error(`Could not reach GitHub (HTTP ${res.status}).`);
  const release = await res.json();
  const latest = String(release.tag_name || '').replace(/^v/i, '');
  const asset = (release.assets || []).find((a) => /portable\.exe$/i.test(a.name));
  if (!isNewer(latest, app.getVersion()) || !asset) throw new Error('No newer portable .exe was found.');

  const url = new URL(asset.browser_download_url);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !url.pathname.startsWith(`/${REPO}/releases/download/`)) {
    throw new Error('The download link does not point at this app\'s GitHub releases.');
  }
  const dest = path.join(path.dirname(exe), path.basename(asset.name));
  return downloadFile(url.href, dest, onProgress);
}

function restartInto(file) {
  // Let the new copy take the single-instance lock before this one has fully exited.
  app.releaseSingleInstanceLock();
  spawn(file, [], { detached: true, stdio: 'ignore' }).unref();
  app.quit();
}

module.exports = { checkForUpdate, installUpdate, restartInto, downloadFile, isNewer, RELEASES_PAGE };
