// Builds "mod-view": the same portable app with your mod portal address pre-filled on the sign-in box,
// for handing to your moderators. The address comes from package.json "modViewPortalUrl".
// Output: dist/mod-view.exe     Run: npm run dist:mod
const { build, Platform } = require('electron-builder');
const pkg = require('../package.json');

if (!pkg.modViewPortalUrl) {
  console.error('Set "modViewPortalUrl" in package.json to your mod portal address first.');
  process.exit(1);
}

// These settings are merged over the "build" section of package.json.
build({
  targets: Platform.WINDOWS.createTarget('portable'),
  config: {
    extraMetadata: { modPortalUrl: pkg.modViewPortalUrl },
    portable: { artifactName: 'mod-view.exe' },
  },
}).then(
  () => console.log(`Built dist/mod-view.exe (portal: ${pkg.modViewPortalUrl})`),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
