// Settings page: theme presets, colours, logo and name, size, fonts and effects, updates.
// Changes apply instantly via Theme.apply and are saved (debounced) through the main process.

const SettingsPage = {
  saveTimer: null,

  render() {
    const resetAll = h('button', { class: 'btn danger', onclick: () => SettingsPage.resetAll() }, icon('reset'), 'Reset everything');
    return h(
      'div',
      { class: 'settings', id: 'settings-page' },
      h(
        'div',
        { class: 'settings-inner' },
        h(
          'div',
          { class: 'settings-head' },
          h(
            'div',
            { class: 'grow' },
            h('span', { class: 'eyebrow' }, 'Customize'),
            h('h1', null, 'Settings'),
            h('p', { class: 'muted', style: { marginTop: '6px' } }, 'Make the app look the way you want. Changes apply instantly and are saved on this PC.'),
          ),
          resetAll,
        ),
        SettingsPage.themeCard(),
        SettingsPage.colorsCard(),
        SettingsPage.brandCard(),
        SettingsPage.sizeCard(),
        SettingsPage.styleCard(),
        SettingsPage.updatesCard(),
      ),
    );
  },

  update(patch, { rerender = false } = {}) {
    Theme.apply({ ...Theme.settings, ...patch });
    clearTimeout(SettingsPage.saveTimer);
    SettingsPage.saveTimer = setTimeout(() => api('settings:set', Theme.settings).catch(toastError), 250);
    if (rerender) SettingsPage.rerender();
  },

  rerender() {
    const scroll = document.getElementById('settings-page')?.scrollTop || 0;
    App.renderPage();
    const page = document.getElementById('settings-page');
    if (page) page.scrollTop = scroll;
  },

  card(title, iconName, body, action) {
    return h('div', { class: 'card' }, h('div', { class: 'card-head' }, icon(iconName), h('h3', null, title), action), body);
  },

  themeCard() {
    const s = Theme.settings;
    const choose = async (id) => {
      if (id === s.theme && !Object.keys(s.colors).length) return;
      if (Object.keys(s.colors).length && !(await confirmDialog({ title: 'Switch theme?', message: 'Your custom colours will be replaced by the new theme\'s colours.', confirmLabel: 'Switch theme' }))) return;
      SettingsPage.update({ theme: id, colors: {} }, { rerender: true });
    };
    const cards = Object.entries(Appearance.THEMES).map(([id, theme]) => {
      const c = theme.colors;
      return h(
        'button',
        { class: `theme-card ${s.theme === id ? 'active' : ''}`, onclick: () => choose(id), title: theme.name },
        h(
          'div',
          { class: 'theme-preview', style: { background: `linear-gradient(135deg, ${c.bg} 60%, ${c.glow1})` } },
          h('div', { class: 'mini-rail', style: { background: c.surface } }),
          h(
            'div',
            { class: 'mini-panel', style: { background: c.surface } },
            h('div', { class: 'mini-line', style: { background: c.text, width: '72%', opacity: 0.85 } }),
            h('div', { class: 'mini-line', style: { background: c.text, width: '46%', opacity: 0.35 } }),
            h('div', { class: 'mini-btns' }, h('div', { class: 'mini-btn', style: { background: c.accent } }), h('div', { class: 'mini-btn', style: { background: c.accent2 } })),
          ),
        ),
        h('div', { class: 'theme-name' }, theme.name, s.theme === id ? icon('check') : null),
      );
    });
    return SettingsPage.card('Theme', 'palette', h('div', { class: 'theme-grid' }, cards));
  },

  colorsCard() {
    const s = Theme.settings;
    const pal = Appearance.palette(s);
    const customized = Object.keys(s.colors).length > 0;
    const fields = Appearance.COLOR_FIELDS.map(([key, label, hint]) => {
      const picker = h('input', { type: 'color', value: pal[key], 'aria-label': label });
      const hex = h('input', { class: 'hex', value: pal[key], maxlength: 7, spellcheck: 'false', 'aria-label': `${label} hex` });
      const reset = h('button', { class: 'icon-btn', title: 'Back to the theme colour', disabled: !(key in s.colors) }, icon('reset'));
      const set = (value) => {
        SettingsPage.update({ colors: { ...Theme.settings.colors, [key]: value } });
        reset.disabled = false;
      };
      picker.addEventListener('input', () => {
        hex.value = picker.value;
        set(picker.value);
      });
      hex.addEventListener('change', () => {
        const raw = hex.value.trim();
        if (!/^#?[0-9a-f]{6}$/i.test(raw)) {
          hex.value = picker.value;
          return toast('Use a 6-digit hex colour like #0bbfbc.', 'error');
        }
        const value = (raw.startsWith('#') ? raw : `#${raw}`).toLowerCase();
        picker.value = value;
        hex.value = value;
        set(value);
      });
      reset.addEventListener('click', () => {
        const colors = { ...Theme.settings.colors };
        delete colors[key];
        SettingsPage.update({ colors }, { rerender: true });
      });
      return h('div', { class: 'color-field', title: hint }, picker, h('div', { class: 'info' }, h('div', { class: 'name' }, label), hex), reset);
    });
    const resetAll = customized
      ? h('button', { class: 'btn sm', onclick: () => SettingsPage.update({ colors: {} }, { rerender: true }) }, icon('reset'), 'Reset colours')
      : null;
    return SettingsPage.card(
      'Colors',
      'palette',
      h(
        'div',
        { class: 'stack' },
        h('p', { class: 'muted', style: { fontSize: 'calc(13rem / 14)' } }, `Fine-tune the ${Appearance.THEMES[s.theme].name} theme. Everything else (borders, hovers, soft tints) is mixed from these.`),
        h('div', { class: 'color-grid' }, fields),
      ),
      resetAll,
    );
  },

  brandCard() {
    const s = Theme.settings;
    const custom = Theme.hasCustomLogo();
    const upload = h('button', { class: 'btn teal' }, icon('upload'), 'Upload image…');
    upload.addEventListener(
      'click',
      withBusy(upload, async () => {
        const dataUrl = await api('settings:pickLogo');
        if (!dataUrl) return;
        SettingsPage.update({ logo: dataUrl }, { rerender: true });
        toast('Logo updated');
      }),
    );
    const nameInput = h('input', { class: 'input', value: s.appName, maxlength: 32, placeholder: Appearance.DEFAULTS.appName });
    nameInput.addEventListener('input', () => SettingsPage.update({ appName: nameInput.value }));
    nameInput.addEventListener('change', () => (nameInput.value = Theme.settings.appName));

    return SettingsPage.card(
      'Logo & name',
      'image',
      h(
        'div',
        { class: 'stack', style: { gap: '18px' } },
        h(
          'div',
          { class: 'logo-row' },
          h('div', { class: 'logo-preview' }, h('img', { src: Theme.logoSrc(), alt: 'Current logo' })),
          h(
            'div',
            { class: 'stack grow', style: { gap: '10px' } },
            h('div', { class: 'row wrap' }, upload, h('button', { class: 'btn', disabled: !custom, onclick: () => SettingsPage.update({ logo: null }, { rerender: true }) }, icon('reset'), 'Use default logo')),
            h('div', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)' } }, 'PNG, JPG, GIF, WebP or SVG up to 2 MB. Square images work best. PNG and JPG logos also become the window and taskbar icon.'),
            switchEl(s.showLogo, (v) => SettingsPage.update({ showLogo: v }), 'Show logo in the title bar'),
          ),
        ),
        h(
          'div',
          { class: 'grid cols-2', style: { gap: '14px', alignItems: 'end' } },
          field('App name', nameInput, 'Shown in the title bar. The last word gets the gradient.'),
          h('div', { class: 'locked', style: { paddingBottom: '22px' } }, icon('lock'), 'The "by Pixelplayz2215" credit always stays in the title bar.'),
        ),
      ),
    );
  },

  range(label, { min, max, step, value, format, onInput, onCommit }) {
    const valueEl = h('span', { class: 'value' }, format(value));
    const input = h('input', { type: 'range', min, max, step, value: String(value), 'aria-label': label });
    input.addEventListener('input', () => {
      valueEl.textContent = format(Number(input.value));
      onInput?.(Number(input.value));
    });
    if (onCommit) input.addEventListener('change', () => onCommit(Number(input.value)));
    return h('div', { class: 'range-row' }, h('div', { class: 'label' }, label), input, valueEl);
  },

  sizeCard() {
    const s = Theme.settings;
    const d = Appearance.DEFAULTS;
    const changed = s.scale !== d.scale || s.textSize !== d.textSize || s.roundness !== d.roundness;
    return SettingsPage.card(
      'Size',
      'maximize',
      h(
        'div',
        { class: 'stack', style: { gap: '4px' } },
        // Scale reflows the whole window, so it is applied when the slider is released.
        SettingsPage.range('UI scale', { min: 80, max: 140, step: 5, value: Math.round(s.scale * 100), format: (v) => `${v}%`, onCommit: (v) => SettingsPage.update({ scale: v / 100 }) }),
        SettingsPage.range('Text size', { min: 12, max: 18, step: 1, value: s.textSize, format: (v) => `${v}px`, onInput: (v) => SettingsPage.update({ textSize: v }) }),
        SettingsPage.range('Corner roundness', { min: 0, max: 24, step: 1, value: s.roundness, format: (v) => `${v}px`, onInput: (v) => SettingsPage.update({ roundness: v }) }),
      ),
      changed
        ? h('button', { class: 'btn sm', onclick: () => SettingsPage.update({ scale: d.scale, textSize: d.textSize, roundness: d.roundness }, { rerender: true }) }, icon('reset'), 'Reset size')
        : null,
    );
  },

  styleCard() {
    const s = Theme.settings;
    return SettingsPage.card(
      'Fonts & effects',
      'type',
      h(
        'div',
        { class: 'grid cols-2', style: { gap: '16px', alignItems: 'start' } },
        field('Font', selectEl(Object.entries(Appearance.FONTS), s.font, (v) => SettingsPage.update({ font: v }))),
        h(
          'div',
          { class: 'stack', style: { gap: '14px', paddingTop: '26px' } },
          switchEl(s.pixelLabels, (v) => SettingsPage.update({ pixelLabels: v }), 'Pixel-style labels'),
          switchEl(s.effects, (v) => SettingsPage.update({ effects: v }), 'Animations & background glow'),
        ),
      ),
    );
  },

  updatesCard() {
    const s = Theme.settings;
    const version = h('span', { class: 'badge teal pixel' }, '…');
    let releasesUrl = null;
    api('app:info')
      .then((info) => {
        version.textContent = `v${info.version}`;
        releasesUrl = info.releasesUrl;
      })
      .catch(() => (version.textContent = '?'));
    const checkBtn = h('button', { class: 'btn teal' }, icon('refresh'), 'Check for updates');
    checkBtn.addEventListener('click', withBusy(checkBtn, () => Updater.check()));
    return SettingsPage.card(
      'Updates',
      'download',
      h(
        'div',
        { class: 'stack', style: { gap: '14px' } },
        h(
          'div',
          { class: 'row wrap' },
          h('span', { class: 'label' }, 'Installed version'),
          version,
          h('div', { class: 'grow' }),
          checkBtn,
          h('button', { class: 'btn', onclick: () => releasesUrl && openExternal(releasesUrl) }, icon('external'), 'View releases'),
        ),
        switchEl(s.checkUpdates, (v) => SettingsPage.update({ checkUpdates: v }), 'Check for updates when the app starts'),
        h(
          'p',
          { class: 'subtle', style: { fontSize: 'calc(12rem / 14)' } },
          'New versions come from the app\'s GitHub releases. The portable .exe downloads the update next to itself and restarts into it. Your bots and settings carry over.',
        ),
      ),
    );
  },

  async resetAll() {
    const ok = await confirmDialog({
      title: 'Reset all appearance settings?',
      message: 'Theme, colours, logo, app name, size and fonts go back to the Pixelplayz defaults. Your bots and templates are not affected.',
      confirmLabel: 'Reset everything',
      danger: true,
    });
    if (ok) SettingsPage.update(Appearance.DEFAULTS, { rerender: true });
  },
};
