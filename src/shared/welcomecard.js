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

  // Twemoji draws emoji the way Discord shows them, on the portal too (it has no emoji font of its own).
  const fontFor = (family, weight, size) => `${family === 'Silkscreen' ? 400 : weight} ${size}px "${family}", "Twemoji", "Segoe UI", "Segoe UI Emoji", sans-serif`;

  const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  // The characters as people see them, so an emoji made of several parts stays whole.
  const graphemes = (value) => (segmenter ? Array.from(segmenter.segment(value), (s) => s.segment) : Array.from(value));

  // Names from "fancy text" sites use look-alike symbols instead of letters (𝓢𝓹𝓲𝓭𝓮𝓻, ｆａｎｃｙ, Ⓐ, ᴘɪxᴇʟ,
  // 🅿🅸🆇). The card's fonts have no such symbols, so they'd come out as empty boxes; these turn them
  // back into the plain letters. Emoji are left alone (ℹ️ and Ⓜ️ would otherwise become i and M).
  const SMALL_CAPS = { ᴀ: 'a', ʙ: 'b', ᴄ: 'c', ᴅ: 'd', ᴇ: 'e', ꜰ: 'f', ɢ: 'g', ʜ: 'h', ɪ: 'i', ᴊ: 'j', ᴋ: 'k', ʟ: 'l', ᴍ: 'm', ɴ: 'n', ᴏ: 'o', ᴘ: 'p', ꞯ: 'q', ʀ: 'r', ꜱ: 's', ᴛ: 't', ᴜ: 'u', ᴠ: 'v', ᴡ: 'w', ʏ: 'y', ᴢ: 'z' };
  const BOXED_LETTER = /^[\u{1F130}-\u{1F149}\u{1F150}-\u{1F169}\u{1F170}-\u{1F189}]$/u; // 🄰 🅐 🅰 and the rest of A–Z
  const EMOJI = /️|⃣|\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
  const PLAIN_BASE = /^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{N}\p{P}\p{S}\p{Zs}]/u;

  function plainLetters(value) {
    return graphemes(String(value ?? ''))
      .map((g) => {
        if (BOXED_LETTER.test(g)) return String.fromCharCode(65 + ((g.codePointAt(0) - 0x1f130) % 32));
        if (EMOJI.test(g)) return g;
        return g.normalize('NFKC').replace(/[ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘꞯʀꜱᴛᴜᴠᴡʏᴢ]/gu, (ch) => SMALL_CAPS[ch]);
      })
      .join('');
  }

  // Whether a character can be drawn with the card's fonts: it's drawn on a small spare canvas and
  // compared with the empty box that a character no font has (U+0378) comes out as. One that reaches
  // far above or below the line (꧁ ꧂, stacked "zalgo" marks) counts as not drawable too, since it
  // would run into the next line. Answers are remembered for each font.
  const known = new Map();
  const boxes = new Map();
  let spare = null;
  const spareCanvas = () => {
    if (!spare && typeof document !== 'undefined') spare = Object.assign(document.createElement('canvas'), { width: 96, height: 48 });
    return spare;
  };

  function canDraw(g, family, canvas) {
    if (!g.trim()) return true;
    const key = `${family}\n${g}`;
    if (known.has(key)) return known.get(key);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const shape = (s) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillText(s, 4, canvas.height / 2);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const alpha = new Uint8Array(data.length / 4);
      for (let i = 0; i < alpha.length; i += 1) alpha[i] = data[i * 4 + 3];
      return alpha;
    };
    let ok;
    ctx.save();
    try {
      ctx.font = fontFor(family, 600, 32);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#000000';
      if (!boxes.has(family)) boxes.set(family, shape('͸'));
      const box = boxes.get(family);
      const mine = shape(g);
      const m = ctx.measureText(g);
      ok = mine.some((a) => a > 0) && mine.some((a, i) => a !== box[i]) && !(Math.max(m.actualBoundingBoxAscent || 0, m.actualBoundingBoxDescent || 0) > 32);
    } catch {
      return true; // can't tell here; draw it as it is
    } finally {
      ctx.restore();
    }
    if (known.size > 5000) known.clear();
    known.set(key, ok);
    return ok;
  }

  // A line of card text ready to draw: plain letters, and nothing that would show as an empty box.
  // canvas: a spare canvas for the check (the app makes its own; the portal passes one).
  function cardText(value, family = 'Poppins', canvas = spareCanvas()) {
    const plain = plainLetters(value);
    if (!canvas) return plain;
    const parts = graphemes(plain);
    const kept = parts.map((g) => {
      if (EMOJI.test(g)) return canDraw(g, family, canvas) ? g : '';
      // Letters and their accents are already joined into one character (é, ñ, й) by plainLetters, so
      // marks still left on a Latin, Greek or Cyrillic letter are "zalgo" piles: keep just the letter.
      const piece = PLAIN_BASE.test(g) ? g.replace(/\p{M}+/gu, '') : g;
      if (piece && canDraw(piece, family, canvas)) return piece;
      // A letter the fonts only have without its accent (ệ on the portal) keeps the letter.
      const bare = PLAIN_BASE.test(g) ? piece.normalize('NFD').replace(/\p{M}+/gu, '') : '';
      return bare && bare !== piece && canDraw(bare, family, canvas) ? bare : '';
    });
    // Where something was left out, tidy the gap it leaves.
    return kept.every((g, i) => g === parts[i]) ? plain : kept.join('').replace(/\s{2,}/g, ' ').trim();
  }

  const letterCount = (value) => (String(value).match(/[\p{L}\p{N}]/gu) || []).length;

  // A member's name for the card. When some of its letters can't be drawn (a script the card's fonts
  // don't have, like Cyrillic or Japanese on the portal), their username is used instead, since
  // usernames are only plain letters, digits, _ and .
  function cardName(name, username, family = 'Poppins', canvas = spareCanvas()) {
    const shown = cardText(name, family, canvas);
    if (username && letterCount(shown) < letterCount(plainLetters(name))) return cardText(username, family, canvas);
    return shown;
  }

  // The largest size (down to min) at which the text fits; too long even then, it's cut with "…".
  function fitText(ctx, value, family, weight, size, min, maxWidth) {
    let s = size;
    ctx.font = fontFor(family, weight, s);
    while (s > min && ctx.measureText(value).width > maxWidth) {
      s -= 2;
      ctx.font = fontFor(family, weight, s);
    }
    const parts = graphemes(value);
    let shown = value;
    let n = parts.length;
    while (n > 1 && ctx.measureText(shown).width > maxWidth) {
      n -= 1;
      shown = `${parts.slice(0, n).join('').trimEnd()}…`;
    }
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
  // vars fill the {placeholders}. spare: a small canvas for checking which characters can be drawn
  // (made automatically in the app).
  function draw(ctx, card, vars, images = {}, { spare: spareGiven } = {}) {
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
    const spare = spareGiven || spareCanvas();
    const shownVars = { ...vars, user: cardName(vars?.user ?? '', vars?.username, c.font, spare), server: cardText(vars?.server ?? '', c.font, spare) };
    const lines = LINES.map((key) => ({ key, ...c[key], value: cardText(fill(c[key].text, shownVars, { inImage: true }), c.font, spare) })).filter((l) => l.key !== 'extra' || l.value.trim());
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

  return { WIDTH, HEIGHT, KINDS, FONTS, PRESETS, DEFAULTS, PLACEHOLDERS, LIMITS, SIZE_RANGE, normalizeCard, normalizeKind, applyPreset, fill, plainLetters, cardText, cardName, draw };
});
