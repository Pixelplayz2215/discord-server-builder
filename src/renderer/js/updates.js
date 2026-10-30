// Update check against GitHub Releases and the "New version found" popup.

const Updater = {
  prompting: false,

  // **bold** and `code` from the changelog, as elements (never as HTML).
  inline(text) {
    return String(text)
      .split(/(\*\*[^*]+\*\*|`[^`]+`)/)
      .filter(Boolean)
      .map((part) => (part.startsWith('**') ? h('b', null, part.slice(2, -2)) : part.startsWith('`') ? h('code', { class: 'mono' }, part.slice(1, -1)) : part));
  },

  async check({ silent = false } = {}) {
    try {
      const info = await api('update:check');
      if (info.available) Updater.prompt(info);
      else if (!silent) toast(info.message || `You're on the latest version (v${info.current}).`, info.message ? 'info' : 'ok');
      return info;
    } catch (err) {
      if (!silent) toastError(err);
      return null;
    }
  },

  prompt(info) {
    if (Updater.prompting) return;
    Updater.prompting = true;

    const bar = h('div', { style: { width: '0%' } });
    const progress = h('div', { class: 'progress hidden' }, bar);
    const status = h('div', { class: 'subtle hidden', style: { fontSize: 'calc(12rem / 14)' } });
    const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
    let laterBtn;
    let installing = false;

    const install = async () => {
      if (installing) return false;
      installing = true;
      laterBtn.disabled = true;
      progress.classList.remove('hidden');
      status.classList.remove('hidden');
      status.textContent = 'Downloading…';
      const off = onEvent('update:progress', ({ received, total }) => {
        bar.style.width = total ? `${Math.min(100, (received / total) * 100)}%` : '50%';
        status.textContent = total ? `Downloading… ${mb(received)} of ${mb(total)}` : `Downloading… ${mb(received)}`;
      });
      try {
        await api('update:install');
        bar.style.width = '100%';
        status.textContent = 'Restarting into the new version…';
      } catch (err) {
        installing = false;
        laterBtn.disabled = false;
        status.textContent = err.message;
        toastError(err);
      } finally {
        off();
      }
      return false; // stay open; the app restarts once the download is in place
    };

    const cannotInstall = info.asset
      ? 'This copy isn\'t the installed app or the portable .exe, so it can\'t update itself. Download the new version from GitHub instead.'
      : 'This release doesn\'t have a matching download attached. Download it from GitHub instead.';

    // What changed since this version, from the release's version.json; older releases only have notes.
    const changes = info.changes?.length
      ? h(
          'div',
          { class: 'release-notes changes' },
          info.changes.map((entry) => [h('div', { class: 'label' }, `What's new in ${entry.version}`), h('ul', null, entry.changes.map((c) => h('li', null, Updater.inline(c))))]),
        )
      : info.notes
        ? h('div', { class: 'release-notes' }, info.notes)
        : null;

    openModal({
      title: 'New version found',
      body: [
        h('p', null, `Version ${info.latest} is available (you have ${info.current}). Reload to update.`),
        changes,
        info.canInstall ? null : h('p', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)' } }, cannotInstall),
        progress,
        status,
      ],
      actions: [
        { label: 'Later', kind: 'ghost', ref: (btn) => (laterBtn = btn) },
        info.canInstall
          ? { label: 'Reload to update', kind: 'primary', icon: 'refresh', onClick: install }
          : { label: 'Open download page', kind: 'primary', icon: 'external', onClick: () => openExternal(info.url) },
      ],
    }).finally(() => (Updater.prompting = false));
  },
};
