// Applies appearance settings (theme, colours, fonts, size, logo, name) to the page.
// Loaded in <head> so the first paint already uses the saved look.

const FONT_STACKS = {
  poppins: "'Poppins', system-ui, -apple-system, 'Segoe UI', sans-serif",
  system: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
  mono: "'Cascadia Code', Consolas, ui-monospace, 'Courier New', monospace",
};

const PALETTE_VARS = {
  bg: '--bg',
  surface: '--surface',
  text: '--text',
  accent: '--accent',
  accent2: '--accent-2',
  accentMid: '--accent-mid',
  glow1: '--glow-1',
  glow2: '--glow-2',
  muted: '--muted',
  subtle: '--subtle',
  pink: '--pink',
  blue: '--blue',
  gold: '--gold',
};

const DEFAULT_LOGO = '../../build/icon.png';

function luminance(hex) {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// Dark text on light accents, white text otherwise.
const readableOn = (hex) => (luminance(hex) > 0.4 ? '#0b0b14' : '#ffffff');

const Theme = {
  settings: Appearance.normalize(null),

  apply(settings) {
    const s = Appearance.normalize(settings);
    this.settings = s;
    const root = document.documentElement;
    const pal = Appearance.palette(s);
    // Unset vars fall back to the stylesheet's derived values.
    for (const [key, cssVar] of Object.entries(PALETTE_VARS)) {
      if (pal[key]) root.style.setProperty(cssVar, pal[key]);
      else root.style.removeProperty(cssVar);
    }
    root.style.setProperty('--on-accent', readableOn(pal.accent));
    root.style.setProperty('--on-accent-2', readableOn(pal.accent2));
    root.style.setProperty('--on-glow', readableOn(pal.glow1));
    root.style.setProperty('--text-size', `${s.textSize}px`);
    root.style.setProperty('--round', String(s.roundness / 16));
    root.style.setProperty('--zoom', String(s.scale));
    root.style.setProperty('--font-body', FONT_STACKS[s.font]);
    root.style.colorScheme = pal.scheme;
    root.dataset.effects = s.effects ? 'on' : 'off';
    root.dataset.pixel = s.pixelLabels ? 'on' : 'off';
    this.applyBranding();
  },

  logoSrc() {
    return this.settings.logo || DEFAULT_LOGO;
  },

  hasCustomLogo() {
    return !!this.settings.logo;
  },

  // App name and logo in the title bar. The "by Pixelplayz2215" credit is fixed in index.html.
  applyBranding() {
    const s = this.settings;
    document.title = s.appName;
    const logo = document.querySelector('.titlebar-logo');
    const name = document.querySelector('.titlebar-name');
    if (!logo || !name) return;
    logo.src = this.logoSrc();
    logo.style.display = s.showLogo ? '' : 'none';
    const words = s.appName.split(/\s+/);
    const last = words.length > 1 ? words.pop() : null;
    const accent = document.createElement('span');
    accent.className = 'grad-text';
    accent.textContent = last ?? words.join(' ');
    name.replaceChildren(...(last ? [words.join(' '), accent] : [accent]));
  },
};

Theme.apply(window.bridge.initialSettings);
document.addEventListener('DOMContentLoaded', () => Theme.applyBranding());
