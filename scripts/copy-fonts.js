// Copies the Poppins + Silkscreen webfonts (OFL) from node_modules into the
// renderer so the app works fully offline. Run after `npm install`.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'src', 'renderer', 'fonts');
fs.mkdirSync(out, { recursive: true });

const files = [
  ['@fontsource/poppins', ['400', '500', '600', '700', '800'].map((w) => `poppins-latin-${w}-normal.woff2`)],
  ['@fontsource/silkscreen', ['silkscreen-latin-400-normal.woff2']],
];

for (const [pkg, names] of files) {
  const dir = path.join(root, 'node_modules', pkg);
  for (const name of names) fs.copyFileSync(path.join(dir, 'files', name), path.join(out, name));
  fs.copyFileSync(path.join(dir, 'LICENSE'), path.join(out, `${pkg.split('/')[1]}-LICENSE.txt`));
}
console.log('Copied fonts to src/renderer/fonts');
