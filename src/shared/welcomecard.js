// Welcome and goodbye cards: the settings, the {placeholders}, and the drawing. The app's preview
// and the image the bot posts are drawn by this same code, so they match.
// Loaded with require() in main (settings only) and as a plain <script> in the app and in the hidden
// card window, where it defines window.WelcomeCard.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WelcomeCard = api;
})(typeof self !== 'undefined' ? self : this, () => {
  const WIDTH = 1024;
  const HEIGHT = 450;
  const KINDS = ['welcome', 'goodbye'];
  const LAYOUTS = ['center', 'left'];
  const BACKGROUNDS = ['gradient', 'color', 'image'];
  const DIRECTIONS = ['diagonal', 'horizontal', 'vertical'];
  // Fonts on every Windows PC, plus the two the app ships with.
  const FONTS = ['Poppins', 'Silkscreen', 'Segoe UI', 'Arial Black', 'Georgia', 'Impact', 'Comic Sans MS', 'Consolas'];
  const PLACEHOLDERS = ['user', 'username', 'mention', 'server', 'count'];
  const LIMITS = { message: 1500, title: 80, subtitle: 120, extra: 120 };
  // The card's lines of text (the third only shows when it has words): the size each starts at
  // (Silkscreen runs wider), its weight, and the smallest it shrinks to before being cut.
  const LINES = ['title', 'subtitle', 'extra'];
  const LINE_STYLE = { title: { size: 58, pixelSize: 50, weight: 800, min: 26 }, subtitle: { size: 32, pixelSize: 28, weight: 600, min: 18 }, extra: { size: 26, pixelSize: 22, weight: 500, min: 16 } };
  const SIZE_RANGE = [0.6, 1.4];

  const PRESETS = {
    pixelplayz: { name: 'Pixelplayz', background: { type: 'gradient', from: '#7f8cf0', to: '#0bbfbc', direction: 'diagonal' }, title: '#ffffff', subtitle: '#eef0ff', ring: '#ffffff', font: 'Poppins' },
    midnight: { name: 'Midnight', background: { type: 'gradient', from: '#0f0c22', to: '#2f2160', direction: 'vertical' }, title: '#ffffff', subtitle: '#b9b3d6', ring: '#7f8cf0', font: 'Poppins' },
    sunset: { name: 'Sunset', background: { type: 'gradient', from: '#fc354c', to: '#fdb44b', direction: 'diagonal' }, title: '#ffffff', subtitle: '#fff3e6', ring: '#ffffff', font: 'Poppins' },
    retro: { name: 'Retro pixel', background: { type: 'color', color: '#1a1530' }, title: '#0bbfbc', subtitle: '#fc8a9a', ring: '#0bbfbc', font: 'Silkscreen' },
    clean: { name: 'Clean', background: { type: 'color', color: '#ffffff' }, title: '#23272a', subtitle: '#5c6370', ring: '#7f8cf0', font: 'Poppins', shadow: false },
  };

  const DEFAULTS = {
    welcome: {
      enabled: false,
      channelId: '',
      channelName: '',
      message: 'Hey {mention}, welcome to **{server}**! 🎉',
      ping: true,
      skipBots: true,
      showCard: true,
      card: { layout: 'center', background: { type: 'gradient', color: '#1a1530', from: '#7f8cf0', to: '#0bbfbc', direction: 'diagonal', image: '', darken: 0.35 }, title: { text: 'Welcome, {user}!', color: '#ffffff', size: 1 }, subtitle: { text: 'You are member #{count} of {server}', color: '#eef0ff', size: 1 }, extra: { text: '', color: '#eef0ff', size: 1 }, font: 'Poppins', ring: '#ffffff', shadow: true },
    },
    goodbye: {
      enabled: false,
      channelId: '',
      channelName: '',
      message: '**{user}** left the server. 👋',
      ping: false,
      skipBots: true,
      showCard: true,
      card: { layout: 'center', background: { type: 'gradient', color: '#1a1530', from: '#2f2160', to: '#fc354c', direction: 'diagonal', image: '', darken: 0.35 }, title: { text: 'Goodbye, {user}', color: '#ffffff', size: 1 }, subtitle: { text: '{server} now has {count} members', color: '#ffe9ec', size: 1 }, extra: { text: '', color: '#ffe9ec', size: 1 }, font: 'Poppins', ring: '#ffffff', shadow: true },
    },
  };

  const HEX = /^#[0-9a-f]{6}$/i;
  const color = (value, fallback) => (HEX.test(String(value || '')) ? String(value).toLowerCase() : fallback);
  const pick = (value, list, fallback) => (list.includes(value) ? value : fallback);
  const text = (value, max, fallback) => (typeof value === 'string' ? value.slice(0, max) : fallback);

  // Tidies one card's settings (from the app or a saved file), filling gaps from the defaults.
  function normalizeCard(input, kind = 'welcome') {
    const d = DEFAULTS[kind].card;
    const bg = input?.background || {};
    const darken = Number(bg.darken);
    const line = (key) => {
      const size = Number(input?.[key]?.size);
      return { text: text(input?.[key]?.text, LIMITS[key], d[key].text), color: color(input?.[key]?.color, d[key].color), size: Number.isFinite(size) ? Math.min(SIZE_RANGE[1], Math.max(SIZE_RANGE[0], size)) : 1 };
    };
    return {
      layout: pick(input?.layout, LAYOUTS, d.layout),
      background: {
        type: pick(bg.type, BACKGROUNDS, d.background.type),
        color: color(bg.color, d.background.color),
        from: color(bg.from, d.background.from),
        to: color(bg.to, d.background.to),
        direction: pick(bg.direction, DIRECTIONS, d.background.direction),
        image: /^[\w-]{1,80}\.(png|jpe?g|webp|gif)$/i.test(String(bg.image || '')) ? String(bg.image) : '',
        darken: Number.isFinite(darken) ? Math.min(0.85, Math.max(0, darken)) : d.background.darken,
      },
      title: line('title'),
      subtitle: line('subtitle'),
      extra: line('extra'),
      font: pick(input?.font, FONTS, d.font),
      ring: color(input?.ring, d.ring),
      shadow: input?.shadow !== false,
    };
  }

  // One kind's settings: where it posts, the message, and its card.
  function normalizeKind(input, kind) {
    const d = DEFAULTS[kind];
    return {
      enabled: !!input?.enabled,
      channelId: /^\d{15,21}$/.test(String(input?.channelId || '')) ? String(input.channelId) : '',
      channelName: text(input?.channelName, 100, ''),
      message: text(input?.message, LIMITS.message, d.message),
      ping: kind === 'welcome' ? input?.ping !== false : false,
      skipBots: input?.skipBots !== false,
      showCard: input?.showCard !== false,
      card: normalizeCard(input?.card, kind),
    };
  }

  function applyPreset(card, presetId) {
    const p = PRESETS[presetId];
    if (!p) return card;
    return { ...card, background: { ...card.background, ...p.background }, title: { ...card.title, color: p.title }, subtitle: { ...card.subtitle, color: p.subtitle }, extra: { ...card.extra, color: p.subtitle }, ring: p.ring, font: p.font, shadow: p.shadow !== false };
  }

  // vars: { user, username, mention, server, count }. In card text a mention can't ping, so it shows
  // as @name.
  function fill(template, vars, { inImage = false } = {}) {
    return String(template || '').replace(/\{(user|username|mention|server|count)\}/g, (_, key) => {
      if (key === 'mention') return inImage ? `@${vars.user ?? ''}` : vars.mention ?? '';
      if (key === 'count') return vars.count == null ? '?' : Number(vars.count).toLocaleString('en-US');
      return String(vars[key] ?? '');
    });
  }

  const fontFor = (family, weight, size) => `${family === 'Silkscreen' ? 400 : weight} ${size}px "${family}", "Segoe UI", "Segoe UI Emoji", sans-serif`;

  // The largest size (down to min) at which the text fits; too long even then, it's cut with "…".
  function fitText(ctx, value, family, weight, size, min, maxWidth) {
    let s = size;
    ctx.font = fontFor(family, weight, s);
    while (s > min && ctx.measureText(value).width > maxWidth) {
      s -= 2;
      ctx.font = fontFor(family, weight, s);
    }
    let shown = value;
    while (shown.length > 1 && ctx.measureText(shown).width > maxWidth) shown = `${shown.slice(0, -2)}…`;
    return shown;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Draws a card on a WIDTH × HEIGHT canvas. images: { avatar, background } (loaded images or null);
  // vars fill the {placeholders}.
  function draw(ctx, card, vars, images = {}) {
    const c = normalizeCard(card);
    const bg = c.background;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.save();
    roundRect(ctx, 0, 0, WIDTH, HEIGHT, 28);
    ctx.clip();

    if (bg.type === 'image' && images.background) {
      const img = images.background;
      const scale = Math.max(WIDTH / img.width, HEIGHT / img.height);
      ctx.drawImage(img, (WIDTH - img.width * scale) / 2, (HEIGHT - img.height * scale) / 2, img.width * scale, img.height * scale);
      if (bg.darken > 0) {
        ctx.fillStyle = `rgba(0, 0, 0, ${bg.darken})`;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
      }
    } else if (bg.type === 'gradient') {
      const end = { diagonal: [WIDTH, HEIGHT], horizontal: [WIDTH, 0], vertical: [0, HEIGHT] }[bg.direction];
      const gradient = ctx.createLinearGradient(0, 0, end[0], end[1]);
      gradient.addColorStop(0, bg.from);
      gradient.addColorStop(1, bg.to);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    } else {
      ctx.fillStyle = bg.color;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }

    const centered = c.layout === 'center';
    const lines = LINES.map((key) => ({ key, ...c[key], value: fill(c[key].text, vars, { inImage: true }) })).filter((l) => l.key !== 'extra' || l.value.trim());
    const three = lines.length === 3;
    // A third line moves the centred avatar up a little to make room.
    const avatar = centered ? { x: WIDTH / 2, y: three ? 130 : 150, r: three ? 86 : 96 } : { x: 210, y: HEIGHT / 2, r: 124 };
    const shadow = (on) => {
      ctx.shadowColor = on && c.shadow ? 'rgba(0, 0, 0, 0.45)' : 'transparent';
      ctx.shadowBlur = on && c.shadow ? 14 : 0;
      ctx.shadowOffsetY = on && c.shadow ? 3 : 0;
    };

    // The avatar, in a ring.
    shadow(true);
    ctx.beginPath();
    ctx.arc(avatar.x, avatar.y, avatar.r + 8, 0, Math.PI * 2);
    ctx.fillStyle = c.ring;
    ctx.fill();
    shadow(false);
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatar.x, avatar.y, avatar.r, 0, Math.PI * 2);
    ctx.clip();
    if (images.avatar) ctx.drawImage(images.avatar, avatar.x - avatar.r, avatar.y - avatar.r, avatar.r * 2, avatar.r * 2);
    else {
      ctx.fillStyle = '#5865f2';
      ctx.fillRect(avatar.x - avatar.r, avatar.y - avatar.r, avatar.r * 2, avatar.r * 2);
    }
    ctx.restore();

    // The text: each line at its own size, shrunk (then cut) to fit the width.
    const area = centered
      ? { x: WIDTH / 2, width: WIDTH - 120, align: 'center', ys: three ? [284, 342, 394] : [318, 378] }
      : { x: 380, width: WIDTH - 380 - 56, align: 'left', ys: three ? [HEIGHT / 2 - 60, HEIGHT / 2 + 2, HEIGHT / 2 + 56] : [HEIGHT / 2 - 14, HEIGHT / 2 + 48] };
    ctx.textAlign = area.align;
    ctx.textBaseline = 'middle';
    shadow(true);
    lines.forEach((l, i) => {
      const style = LINE_STYLE[l.key];
      const start = Math.round((c.font === 'Silkscreen' ? style.pixelSize : style.size) * l.size);
      ctx.fillStyle = l.color;
      ctx.fillText(fitText(ctx, l.value, c.font, style.weight, start, Math.min(style.min, start), area.width), area.x, area.ys[i]);
    });
    shadow(false);
    ctx.restore();
  }

  return { WIDTH, HEIGHT, KINDS, FONTS, PRESETS, DEFAULTS, PLACEHOLDERS, LIMITS, SIZE_RANGE, normalizeCard, normalizeKind, applyPreset, fill, draw };
});
