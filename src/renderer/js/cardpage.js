// Runs in the hidden card window. main.js calls renderCard() and gets the card back as a PNG data URL.
// Images arrive as data URLs, so the canvas can always be read back.

const loadCardImage = (src) =>
  new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

async function renderCard(card, vars, avatarUrl, backgroundUrl) {
  await Promise.all(['500 26px Poppins', '600 32px Poppins', '800 58px Poppins', '400 50px Silkscreen'].map((f) => document.fonts.load(f).catch(() => null)));
  const [avatar, background] = await Promise.all([loadCardImage(avatarUrl), loadCardImage(backgroundUrl)]);
  const canvas = document.createElement('canvas');
  canvas.width = WelcomeCard.WIDTH;
  canvas.height = WelcomeCard.HEIGHT;
  WelcomeCard.draw(canvas.getContext('2d'), card, vars, { avatar, background });
  return canvas.toDataURL('image/png');
}
