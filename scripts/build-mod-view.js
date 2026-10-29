// Builds "mod-view": the same portable app with your mod portal address pre-filled on the sign-in box,
// for handing to your moderators privately. It is never uploaded to GitHub.
// The address comes from mod-view.json in the project folder (kept out of git):
//   { "portalUrl": "https://your-mod-portal.onrender.com" }
// Output: dist/mod-view.exe     Run: npm run dist:mod
const fs = require('fs');
const path = require('path');
const { build, Platform } = require('electron-builder');

const configPath = path.join(__dirname, '..', 'mod-view.json');
let portalUrl = '';
try {
  portalUrl = JSON.parse(fs.readFileSync(configPath, 'utf8')).portalUrl || '';
} catch {
  // no config file yet
}
if (!/^https:\/\//.test(portalUrl)) {
  console.error('Create mod-view.json in the project folder with your portal address, e.g.\n  { "portalUrl": "https://your-mod-portal.onrender.com" }');
  process.exit(1);
}

// These settings are merged over the "build" section of package.json.
build({
  targets: Platform.WINDOWS.createTarget('portable'),
  config: {
    extraMetadata: { modPortalUrl: portalUrl },
    portable: { artifactName: 'mod-view.exe' },
  },
}).then(
  () => console.log(`Built dist/mod-view.exe (portal: ${portalUrl})`),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
