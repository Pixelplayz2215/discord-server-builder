// Draws welcome and goodbye cards on the portal for 24/7, with the same drawing code as the app
// (src/shared/welcomecard.js) on @napi-rs/canvas. Windows-only fonts (Segoe UI, Impact…) are drawn
// with Poppins, since the portal's host doesn't have them. Also reads a server emoji's colour for
// poll bars, like the app does.
const path = require('path');
const WelcomeCard = require('../src/shared/welcomecard');
const { avatarUrl } = require('../src/main/welcome');
const polls = require('../src/main/polls');

let canvas = null;
try {
  canvas = require('@napi-rs/canvas');
} catch {
  // drawn without a card; the welcome page in the app says why
}

const FONTS = path.join(__dirname, '..', 'src', 'renderer', 'fonts');
const POPPINS = [400, 500, 600, 700, 800].map((w) => path.join(FONTS, `poppins-latin-${w}-normal.woff2`));
let fontsReady = false;

function registerFonts() {
  if (fontsReady || !canvas) return;
  fontsReady = true;
  for (const family of WelcomeCard.FONTS.filter((f) => f !== 'Silkscreen')) for (const file of POPPINS) canvas.GlobalFonts.registerFromPath(file, family);
  canvas.GlobalFonts.registerFromPath(path.join(FONTS, 'silkscreen-latin-400-normal.woff2'), 'Silkscreen');
}

const MISSING = "the portal couldn't load its drawing library. On Render, open the service and choose Manual Deploy → Clear build cache & deploy.";

// fileData(name): a picture from the server's #bot-settings channel (a card background), or null.
function createCards({ fetchImpl = fetch, fileData = async () => null } = {}) {
  async function fetchImage(url) {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return canvas.loadImage(Buffer.from(await res.arrayBuffer()));
  }

  async function render(card, vars, user) {
    if (!canvas) throw new Error(MISSING);
    registerFonts();
    const [avatar, background] = await Promise.all([
      fetchImage(avatarUrl(user)).catch(() => null),
      card.background.type === 'image' && card.background.image
        ? fileData(card.background.image).then((data) => (data ? canvas.loadImage(data) : null)).catch(() => null)
        : null,
    ]);
    const c = canvas.createCanvas(WelcomeCard.WIDTH, WelcomeCard.HEIGHT);
    WelcomeCard.draw(c.getContext('2d'), card, vars, { avatar, background });
    return c.encode('png');
  }

  const colors = new Map(); // server emoji id -> bar colour

  // The bar colour for a poll answer's emoji: standard emojis from a table, server emojis from their picture.
  async function emojiColor(emoji, index) {
    if (!emoji?.id || !canvas) return polls.defaultColor(emoji, index);
    if (!colors.has(emoji.id)) {
      try {
        const img = await fetchImage(`https://cdn.discordapp.com/emojis/${emoji.id}.png?size=32`);
        const c = canvas.createCanvas(32, 32);
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, 32, 32);
        colors.set(emoji.id, polls.dominantColor(ctx.getImageData(0, 0, 32, 32).data));
      } catch {
        return polls.defaultColor(emoji, index); // try again next time
      }
    }
    return colors.get(emoji.id) || polls.defaultColor(emoji, index);
  }

  return { render, emojiColor, available: !!canvas };
}

module.exports = { createCards };
