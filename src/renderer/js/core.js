// Shared UI helpers: element builder, icons, IPC wrapper, toasts, modals, formatters.

/* ---------- Element builder ---------- */
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  let deferredValue;
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key === 'html') el.innerHTML = value; // only ever used with the static icon set below
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value') deferredValue = value;
    else if (key === 'checked' || key === 'disabled' || key === 'selected') el[key] = !!value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  if (deferredValue !== undefined) el.value = deferredValue;
  return el;
}

/* ---------- Icons (Lucide-style strokes) ---------- */
const ICON_PATHS = {
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  voice: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"/>',
  megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  forum: '<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/>',
  stage: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/>',
  folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>',
  hammer: '<path d="m15 12-8.5 8.5a2.12 2.12 0 0 1-3-3L12 9"/><path d="M17.64 15 22 10.64"/><path d="m20.91 11.7-1.25-1.25a3.18 3.18 0 0 1-.93-2.25v-.86L16.01 4.6a5.56 5.56 0 0 0-3.94-1.64H9l.92.82A6.18 6.18 0 0 1 12 8.4v1.56l2 2h2.47l2.26 1.91"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  refresh: '<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/>',
  trash: '<path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  kick: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  tag: '<path d="M12 2H2v10l9.29 9.29a2.41 2.41 0 0 0 3.42 0l6.58-6.58a2.41 2.41 0 0 0 0-3.42L12 2Z"/><path d="M7 7h.01"/>',
  edit: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  unlock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
  sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  crown: '<path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zM5 20h14"/>',
  bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  chevronUp: '<path d="m18 15-6-6-6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  eraser: '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21M22 21H7M5 11l9 9"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  power: '<path d="M12 2v10M18.4 6.6a9 9 0 1 1-12.77.04"/>',
  server: '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 6h.01M6 18h.01"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7l10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>',
  userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  pin: '<path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  grip: '<circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>',
  triangle: '<path d="M12 3 22 20H2z"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  square: '<rect x="4" y="4" width="16" height="16" rx="2" transform="rotate(12 12 12)"/>',
  cross: '<path d="M5 5l14 14M19 5 5 19"/>',
};

function icon(name, cls) {
  const span = document.createElement('span');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${cls ? ` class="${cls}"` : ''}>${ICON_PATHS[name] || ''}</svg>`;
  return span.firstChild;
}

/* ---------- IPC ---------- */
async function api(channel, ...args) {
  const res = await window.bridge.invoke(channel, ...args);
  if (!res.ok) {
    const err = new Error(res.error?.message || 'Something went wrong.');
    err.code = res.error?.code;
    err.status = res.error?.status;
    throw err;
  }
  return res.data;
}
const rest = (botId, method, path, opts) => api('rest', botId, method, path, opts);
const onEvent = (channel, cb) => window.bridge.on(channel, cb);

/* ---------- Toasts ---------- */
function toast(message, kind = 'ok') {
  const el = h('div', { class: `toast ${kind}` }, icon(kind === 'error' ? 'alert' : kind === 'info' ? 'info' : 'check'), h('div', null, message));
  document.getElementById('toasts').append(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 220);
  }, kind === 'error' ? 6500 : 3500);
}
const toastError = (err) => toast(err?.message || String(err), 'error');

/* ---------- Modals ---------- */
// actions: [{ label, kind, icon, value, onClick, disabled, ref }] — onClick may return false to keep the
// modal open; ref receives the button element.
function openModal({ title, body, actions = [], wide = false, dismissable = true }) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    let done = false;
    const close = (value) => {
      if (done) return;
      done = true;
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && dismissable) close(undefined);
    };
    const buttons = actions.map((a) => {
      const btn = h('button', { class: `btn ${a.kind || ''}`, disabled: a.disabled }, a.icon ? icon(a.icon) : null, a.label);
      if (a.ref) a.ref(btn);
      btn.addEventListener('click', async () => {
        if (a.onClick) {
          btn.disabled = true;
          try {
            const result = await a.onClick();
            if (result === false) return;
            close(result === undefined ? a.value : result);
          } catch (err) {
            toastError(err);
          } finally {
            btn.disabled = false;
          }
        } else close(a.value);
      });
      return btn;
    });
    const modal = h(
      'div',
      { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'modal-head' }, h('h3', null, title), dismissable ? h('button', { class: 'icon-btn', onclick: () => close(undefined), 'aria-label': 'Close' }, icon('x')) : null),
      h('div', { class: 'modal-body' }, body),
      buttons.length ? h('div', { class: 'modal-foot' }, buttons) : null,
    );
    const backdrop = h('div', { class: 'modal-backdrop' }, modal);
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop && dismissable) close(undefined);
    });
    document.addEventListener('keydown', onKey);
    root.append(backdrop);
    const focusable = modal.querySelector('input, textarea, select');
    if (focusable) setTimeout(() => focusable.focus(), 30);
    modal.closeModal = close;
  });
}

function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false, requireText }) {
  const input = requireText ? h('input', { class: 'input', placeholder: requireText }) : null;
  return openModal({
    title,
    body: [
      typeof message === 'string' ? h('p', null, message) : message,
      requireText ? h('div', { class: 'field' }, h('label', null, `Type "${requireText}" to confirm`), input) : null,
    ],
    actions: [
      { label: 'Cancel', kind: 'ghost', value: false },
      {
        label: confirmLabel,
        kind: danger ? 'danger' : 'primary',
        onClick: () => {
          if (requireText && input.value.trim() !== requireText) {
            toast('The text does not match.', 'error');
            return false;
          }
          return true;
        },
      },
    ],
  }).then((v) => !!v);
}

/* ---------- Form helpers ---------- */
function field(label, control, hint) {
  return h('div', { class: 'field' }, h('label', null, label), control, hint ? h('div', { class: 'hint' }, hint) : null);
}
function switchEl(checked, onChange, label, danger = false) {
  const input = h('input', { type: 'checkbox', checked });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: `switch ${danger ? 'danger' : ''}` }, input, h('span', { class: 'track' }), label ? h('span', null, label) : null);
}
function selectEl(options, value, onChange, cls = 'select') {
  const el = h('select', { class: cls }, options.map(([v, label]) => h('option', { value: v }, label)));
  el.value = value;
  if (onChange) el.addEventListener('change', () => onChange(el.value));
  return el;
}
function searchBox(placeholder, onInput, value = '') {
  const input = h('input', { class: 'input', placeholder, value });
  input.addEventListener('input', () => onInput(input.value));
  return h('div', { class: 'input-wrap' }, icon('search'), input);
}
function withBusy(btn, fn) {
  return async (...args) => {
    btn.disabled = true;
    btn.classList.add('spin');
    try {
      return await fn(...args);
    } catch (err) {
      toastError(err);
    } finally {
      btn.disabled = false;
      btn.classList.remove('spin');
    }
  };
}

/* ---------- Discord helpers ---------- */
const CDN = 'https://cdn.discordapp.com';
function userAvatar(user, size = 128) {
  if (!user) return `${CDN}/embed/avatars/0.png`;
  if (user.avatar) return `${CDN}/avatars/${user.id}/${user.avatar}.${user.avatar.startsWith('a_') ? 'gif' : 'png'}?size=${size}`;
  const index = user.discriminator && user.discriminator !== '0' ? Number(user.discriminator) % 5 : Number((BigInt(user.id) >> 22n) % 6n);
  return `${CDN}/embed/avatars/${index}.png`;
}
function memberAvatar(guildId, member, size = 128) {
  if (member.avatar) return `${CDN}/guilds/${guildId}/users/${member.user.id}/avatars/${member.avatar}.png?size=${size}`;
  return userAvatar(member.user, size);
}
function guildIcon(guild, size = 64) {
  const el = h('div', {
    class: 'guild-icon',
    style: { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.34)}px`, borderRadius: `${Math.round(size * 0.3)}px` },
  });
  if (guild.icon) el.append(h('img', { src: `${CDN}/icons/${guild.id}/${guild.icon}.png?size=${size * 2}`, alt: '' }));
  else el.textContent = acronym(guild.name);
  return el;
}
const acronym = (name) =>
  (name || '?')
    .replace(/'s /g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => [...w][0])
    .join('')
    .slice(0, 3);
const displayName = (user) => user?.global_name || user?.username || 'Unknown';
const snowflakeDate = (id) => new Date(Number((BigInt(id) >> 22n) + 1420070400000n));
const roleColor = (role) => (role?.color ? `#${role.color.toString(16).padStart(6, '0')}` : '#99aab5');

function fmtDate(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
const RELATIVE_STEPS = [['year', 31557600], ['month', 2629800], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]];
function fmtRelative(value) {
  const d = value instanceof Date ? value : new Date(value);
  const secs = (d.getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, size] of RELATIVE_STEPS) {
    if (Math.abs(secs) >= size || unit === 'second') return rtf.format(Math.round(secs / size), unit);
  }
  return fmtDate(d);
}
const fmtNum = (n) => (n == null ? '—' : Number(n).toLocaleString());

function copyText(text, label = 'Copied to clipboard') {
  navigator.clipboard.writeText(text).then(() => toast(label), toastError);
}
function openExternal(url) {
  api('open:external', url).catch(toastError);
}

// Permission bits the UI needs to read.
const PERM = {
  ADMINISTRATOR: 1n << 3n,
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  VIEW_AUDIT_LOG: 1n << 7n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  MANAGE_MESSAGES: 1n << 13n,
  CONNECT: 1n << 20n,
  MANAGE_NICKNAMES: 1n << 27n,
  MANAGE_ROLES: 1n << 28n,
  MODERATE_MEMBERS: 1n << 40n,
};

const CHANNEL_ICON = { 0: 'hash', 2: 'voice', 4: 'folder', 5: 'megaphone', 13: 'stage', 15: 'forum', 16: 'forum' };
const CHANNEL_LABEL = { 0: 'Text', 2: 'Voice', 4: 'Category', 5: 'Announcement', 13: 'Stage', 15: 'Forum', 16: 'Media' };
