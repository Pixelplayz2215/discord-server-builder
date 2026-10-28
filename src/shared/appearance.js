// Appearance settings shared by the main process (window chrome, zoom, icon) and the UI (CSS variables).
// Loaded with require() in main and as a plain <script> in the renderer, where it defines window.Appearance.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Appearance = api;
})(typeof self !== 'undefined' ? self : this, () => {
  // colors: the editable palette. extra: hand-tuned values that only fit the theme's own colours.
  const THEMES = {
    pixelplayz: {
      name: 'Pixelplayz',
      scheme: 'dark',
      colors: { bg: '#0f0c22', surface: '#1c173d', text: '#fbf9fc', accent: '#0bbfbc', accent2: '#fc354c', accentMid: '#7f8cf0', glow1: '#a41d70', glow2: '#193b6d' },
      extra: { muted: '#b8aecb', subtle: '#8a80a3' },
    },
    midnight: {
      name: 'Midnight',
      scheme: 'dark',
      colors: { bg: '#0a0f1e', surface: '#131b2e', text: '#e8eefc', accent: '#4cc9f0', accent2: '#f72585', accentMid: '#7b6cf6', glow1: '#3a0ca3', glow2: '#0f3a6b' },
    },
    blurple: {
      name: 'Blurple',
      scheme: 'dark',
      colors: { bg: '#1e1f22', surface: '#2b2d31', text: '#f2f3f5', accent: '#5865f2', accent2: '#ed4245', accentMid: '#949cf7', glow1: '#4752c4', glow2: '#23272a' },
      extra: { muted: '#b5bac1', subtle: '#80848e' },
    },
    synthwave: {
      name: 'Synthwave',
      scheme: 'dark',
      colors: { bg: '#1a0b2e', surface: '#2a1248', text: '#fff0fb', accent: '#f9c80e', accent2: '#ff3cac', accentMid: '#9d4edd', glow1: '#ff3cac', glow2: '#2b86c5' },
    },
    emerald: {
      name: 'Emerald',
      scheme: 'dark',
      colors: { bg: '#08130f', surface: '#11231b', text: '#ecfdf5', accent: '#34d399', accent2: '#f59e0b', accentMid: '#5eead4', glow1: '#065f46', glow2: '#0e3a4a' },
    },
    amoled: {
      name: 'AMOLED Black',
      scheme: 'dark',
      colors: { bg: '#000000', surface: '#0e0e12', text: '#ffffff', accent: '#0bbfbc', accent2: '#fc354c', accentMid: '#7f8cf0', glow1: '#2a0a1f', glow2: '#06142b' },
    },
    daylight: {
      name: 'Daylight',
      scheme: 'light',
      colors: { bg: '#f4f2fa', surface: '#ffffff', text: '#1c1836', accent: '#0a9d9a', accent2: '#e3243b', accentMid: '#5b6ad8', glow1: '#f0b8d8', glow2: '#bccbff' },
      extra: { muted: '#5b5476', subtle: '#878099', pink: '#b8337f', blue: '#3f52c4', gold: '#9a6200' },
    },
    sakura: {
      name: 'Sakura',
      scheme: 'light',
      colors: { bg: '#fff4f7', surface: '#ffffff', text: '#3a1d2e', accent: '#d63c74', accent2: '#7c4dff', accentMid: '#f06292', glow1: '#ffc1d9', glow2: '#dccfff' },
      extra: { muted: '#6e4b5e', subtle: '#9b7d8c', pink: '#c2185b', blue: '#5e35b1', gold: '#a35f00' },
    },
  };

  const COLOR_FIELDS = [
    ['bg', 'Background', 'Window background'],
    ['surface', 'Panels', 'Cards, sidebars and dialogs'],
    ['text', 'Text', 'Main text colour'],
    ['accent', 'Primary accent', 'Highlights, toggles, focus rings, teal buttons'],
    ['accent2', 'Secondary accent', 'Main buttons and warnings'],
    ['accentMid', 'Gradient middle', 'Middle of the gradient text'],
    ['glow1', 'Glow 1', 'Background glow and logo circle (first colour)'],
    ['glow2', 'Glow 2', 'Background glow and logo circle (second colour)'],
  ];

  const FONTS = { poppins: 'Poppins', system: 'System (Segoe UI)', mono: 'Monospace' };

  const DEFAULTS = {
    theme: 'pixelplayz',
    colors: {},
    appName: 'Server Builder',
    logo: null,
    showLogo: true,
    scale: 1,
    textSize: 14,
    roundness: 16,
    font: 'poppins',
    pixelLabels: true,
    effects: true,
  };

  const HEX = /^#[0-9a-f]{6}$/i;
  const LOGO = /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,/;
  const MAX_LOGO_CHARS = 3000000;

  const clamp = (value, min, max, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };

  function normalize(input) {
    const s = { ...DEFAULTS, ...(input && typeof input === 'object' ? input : {}) };
    const colors = {};
    for (const [key] of COLOR_FIELDS) if (HEX.test(s.colors?.[key])) colors[key] = s.colors[key].toLowerCase();
    return {
      theme: THEMES[s.theme] ? s.theme : DEFAULTS.theme,
      colors,
      appName: String(s.appName || '').trim().slice(0, 32) || DEFAULTS.appName,
      logo: typeof s.logo === 'string' && LOGO.test(s.logo) && s.logo.length < MAX_LOGO_CHARS ? s.logo : null,
      showLogo: s.showLogo !== false,
      scale: Math.round(clamp(s.scale, 0.8, 1.4, 1) * 100) / 100,
      textSize: Math.round(clamp(s.textSize, 12, 18, 14)),
      roundness: Math.round(clamp(s.roundness, 0, 24, 16)),
      font: FONTS[s.font] ? s.font : DEFAULTS.font,
      pixelLabels: s.pixelLabels !== false,
      effects: s.effects !== false,
    };
  }

  function palette(settings) {
    const theme = THEMES[settings.theme] || THEMES[DEFAULTS.theme];
    const pal = { scheme: theme.scheme, ...theme.colors, ...theme.extra, ...settings.colors };
    // Hand-tuned muted/subtle text only fits the theme's own text and panel colours.
    if (settings.colors.text || settings.colors.surface) {
      delete pal.muted;
      delete pal.subtle;
    }
    return pal;
  }

  return { THEMES, COLOR_FIELDS, FONTS, DEFAULTS, normalize, palette };
});
