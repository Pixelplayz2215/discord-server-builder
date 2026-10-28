// Draws the Pixelplayz pixel-arrow logo (teal over coral with a soft diagonal blend) and writes
// build/icon.png (256px, also used in the UI) and build/icon.ico (256/64/48/32/16). No dependencies.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const TEAL = hex('#0dbfbc');
const CORAL = hex('#fc354c');

// The arrow on an 8x9 cell grid: row r covers columns 0..ROW_WIDTHS[r]-1.
const ROW_WIDTHS = [3, 4, 6, 7, 8, 7, 6, 4, 3];
// Colour boundary in cell units, from the artwork: (0, 2.77) to (7, 5.96), blended over ±0.28 cells.
const LINE = { x0: 0, y0: 415 / 150, x1: 7, y1: 894 / 150 };
const BLEND = 0.28;

function colorAt(u, v) {
  const dx = LINE.x1 - LINE.x0;
  const dy = LINE.y1 - LINE.y0;
  const below = ((v - LINE.y0) * dx - (u - LINE.x0) * dy) / Math.hypot(dx, dy);
  const t = Math.min(1, Math.max(0, (below + BLEND) / (2 * BLEND)));
  const s = t * t * (3 - 2 * t); // smoothstep
  return TEAL.map((c, i) => Math.round(c + (CORAL[i] - c) * s));
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const cell = Math.max(1, Math.floor(size / 9));
  const ox = Math.floor((size - 8 * cell) / 2);
  const oy = Math.floor((size - 9 * cell) / 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = Math.floor((x - ox) / cell);
      const gy = Math.floor((y - oy) / cell);
      if (gy < 0 || gy > 8 || gx < 0 || gx >= ROW_WIDTHS[gy]) continue;
      const c = colorAt((x - ox + 0.5) / cell, (y - oy + 0.5) / cell);
      const i = (y * size + x) * 4;
      px[i] = c[0];
      px[i + 1] = c[1];
      px[i + 2] = c[2];
      px[i + 3] = 255;
    }
  }
  return px;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function encodeIco(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const e = 6 + i * 16;
    header[e] = size >= 256 ? 0 : size;
    header[e + 1] = size >= 256 ? 0 : size;
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(png.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.png)]);
}

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
const images = [256, 64, 48, 32, 16].map((size) => ({ size, png: encodePng(size, render(size)) }));
fs.writeFileSync(path.join(outDir, 'icon.png'), images[0].png);
fs.writeFileSync(path.join(outDir, 'icon.ico'), encodeIco(images));
console.log('Wrote build/icon.png and build/icon.ico');
