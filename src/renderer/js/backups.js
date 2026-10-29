// Backups tab: snapshots of a server's roles, channels, permissions and settings, saved on this PC,
// and restoring them. Owner only.

const BackupsTab = {
  active: null, // progress UI of the restore that is running

  async load(ctx) {
    const { srv } = ctx;
    srv.backupsLoading = true;
    try {
      const [list, config] = await Promise.all([api('backups:list', ctx.guildId), api('servers:config', ctx.botId, ctx.guildId)]);
      srv.backups = list;
      srv.autoBackup = !!config.autoBackup;
      srv.backupsError = null;
    } catch (err) {
      srv.backupsError = err.message;
    }
    srv.backupsLoading = false;
    ctx.rerender();
  },

  render(ctx, el) {
    const { srv } = ctx;
    if (!srv.backups && !srv.backupsLoading && !srv.backupsError) BackupsTab.load(ctx);

    const label = h('input', { class: 'input', placeholder: 'Optional label, e.g. "Before the rework"', maxlength: 80 });
    const backupBtn = h('button', { class: 'btn primary' }, icon('save'), 'Back up now');
    backupBtn.addEventListener(
      'click',
      withBusy(backupBtn, async () => {
        srv.backups = await api('backups:create', ctx.botId, ctx.guildId, label.value.trim());
        toast('Backup saved');
        ctx.rerender();
      }),
    );
    const importBtn = h('button', { class: 'btn' }, icon('upload'), 'Import');
    importBtn.addEventListener(
      'click',
      withBusy(importBtn, async () => {
        const list = await api('backups:import', ctx.guildId);
        if (!list) return;
        srv.backups = list;
        toast('Backup imported');
        ctx.rerender();
      }),
    );

    el.append(
      h(
        'div',
        { class: 'split', style: { gridTemplateColumns: 'minmax(0,1fr) 380px' } },
        BackupsTab.listCard(ctx),
        h(
          'div',
          { class: 'stack', style: { gap: '16px' } },
          h(
            'div',
            { class: 'card' },
            h('div', { class: 'card-head' }, icon('save'), h('h3', null, 'Back up this server')),
            h(
              'div',
              { class: 'stack' },
              h('p', { class: 'muted', style: { fontSize: 'calc(13rem / 14)' } }, 'Saves every role, category, channel and permission, plus the server settings, to this PC. Messages and members are not included.'),
              label,
              h('div', { class: 'row' }, backupBtn, importBtn),
            ),
          ),
          h(
            'div',
            { class: 'card' },
            h('div', { class: 'card-head' }, icon('clock'), h('h3', null, 'Automatic backups')),
            h(
              'div',
              { class: 'stack' },
              srv.backups ? switchEl(srv.autoBackup, (v) => BackupsTab.setAuto(ctx, v), 'Back up every day') : h('div', { class: 'skeleton' }),
              h('p', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)' } }, 'Runs once a day while the app is open, including when it is in the tray. The newest 7 automatic backups are kept.'),
            ),
          ),
        ),
      ),
    );
  },

  async setAuto(ctx, enabled) {
    try {
      await api('backups:setAuto', ctx.botId, ctx.guildId, enabled);
      ctx.srv.autoBackup = enabled;
      toast(enabled ? 'Daily backups are on' : 'Daily backups are off');
    } catch (err) {
      toastError(err);
    }
  },

  listCard(ctx) {
    const { srv } = ctx;
    const head = h('div', { class: 'card-head', style: { padding: '16px 16px 0' } }, icon('archive'), h('h3', null, `Backups${srv.backups ? ` (${srv.backups.length})` : ''}`));
    let body;
    if (srv.backupsError) body = h('div', { class: 'callout warn', style: { margin: '14px' } }, icon('alert'), h('div', null, srv.backupsError));
    else if (!srv.backups) body = h('div', { class: 'loading-block', style: { padding: '14px' } }, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }));
    else if (!srv.backups.length) body = h('div', { class: 'empty' }, icon('archive'), h('h3', null, 'No backups yet'), h('p', null, 'Press "Back up now", or turn on daily backups.'));
    else {
      body = h(
        'div',
        { class: 'list' },
        srv.backups.map((b) =>
          h(
            'div',
            { class: 'list-row' },
            h(
              'div',
              { class: 'grow', style: { minWidth: 0 } },
              h(
                'div',
                { class: 'row', style: { gap: '6px' } },
                h('span', { class: 'primary ellipsis' }, b.label || fmtDate(b.takenAt)),
                b.auto ? h('span', { class: 'badge peri' }, 'Automatic') : null,
                b.id.endsWith('-imported') ? h('span', { class: 'badge' }, 'Imported') : null,
                b.serverId !== ctx.guildId ? h('span', { class: 'badge gold', title: 'This backup was taken in another server' }, `From ${b.serverName}`) : null,
              ),
              h('div', { class: 'secondary ellipsis' }, `${new Date(b.takenAt).toLocaleString()} (${fmtRelative(b.takenAt)}) · ${b.roles} roles · ${b.channels} channels`),
            ),
            h('button', { class: 'btn sm teal', onclick: () => BackupsTab.restore(ctx, b) }, icon('reset'), 'Restore'),
            h('button', { class: 'icon-btn', title: 'Export to a file', onclick: () => BackupsTab.export(ctx, b) }, icon('download')),
            h('button', { class: 'icon-btn danger', title: 'Delete', onclick: () => BackupsTab.remove(ctx, b) }, icon('trash')),
          ),
        ),
      );
    }
    return h('div', { class: 'card flush' }, head, h('div', { style: { borderTop: '1px solid var(--border)', marginTop: '12px' } }, body));
  },

  async export(ctx, b) {
    try {
      const file = await api('backups:export', ctx.guildId, b.id);
      if (file) toast('Backup exported');
    } catch (err) {
      toastError(err);
    }
  },

  async remove(ctx, b) {
    if (!(await confirmDialog({ title: 'Delete this backup?', message: 'It goes to the Recycle Bin, so you can still get it back from there.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      ctx.srv.backups = await api('backups:delete', ctx.guildId, b.id);
      ctx.rerender();
    } catch (err) {
      toastError(err);
    }
  },

  async restore(ctx, b) {
    const opts = { missing: true, permissions: true, layout: true, settings: false };
    const preview = h('div', { class: 'stack', style: { gap: '8px' } }, h('div', { class: 'subtle' }, 'Checking what would change…'));
    const refresh = async () => {
      preview.replaceChildren(h('div', { class: 'subtle' }, 'Checking what would change…'));
      try {
        const steps = await api('backups:plan', ctx.botId, ctx.guildId, b.id, opts);
        preview.replaceChildren(
          ...(steps.length
            ? [
                h('b', null, `${steps.length} change${steps.length === 1 ? '' : 's'}:`),
                h('div', { class: 'log', style: { height: '180px' } }, steps.slice(0, 200).map((s) => h('div', { class: 'info' }, s)), steps.length > 200 ? h('div', { class: 'info' }, `…and ${steps.length - 200} more`) : null),
              ]
            : [h('div', { class: 'callout ok' }, icon('check'), h('div', null, 'This server already matches the backup for the options you picked.'))]),
        );
        planned = steps.length;
      } catch (err) {
        preview.replaceChildren(h('div', { class: 'callout warn' }, icon('alert'), h('div', null, err.message)));
      }
    };
    let planned = 0;
    const option = (key, label) => switchEl(opts[key], (v) => { opts[key] = v; refresh(); }, label);
    refresh();

    const ok = await openModal({
      title: `Restore ${b.label || fmtDate(b.takenAt)}`,
      wide: true,
      body: [
        b.serverId !== ctx.guildId ? h('div', { class: 'callout warn' }, icon('alert'), h('div', null, `This backup is from ${b.serverName}. Restoring it here copies that server's roles, channels and permissions into this one.`)) : null,
        h(
          'div',
          { class: 'stack', style: { gap: '10px' } },
          option('missing', 'Recreate roles and channels that were deleted'),
          option('permissions', 'Put permissions back (role permissions and channel overrides)'),
          option('layout', 'Put channels back in their categories, and roles and channels back in order'),
          option('settings', 'Put server settings back (name, verification level, notifications, AFK and welcome channel)'),
        ),
        h('p', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)' } }, 'Nothing is deleted: roles and channels made after the backup stay. Messages and members are not part of backups. Roles above the bot\'s own role can\'t be changed.'),
        preview,
      ],
      actions: [
        { label: 'Cancel', kind: 'ghost', value: false },
        {
          label: 'Restore',
          kind: 'primary',
          icon: 'reset',
          onClick: () => {
            if (!planned) {
              toast('There is nothing to restore with these options.', 'error');
              return false;
            }
            return true;
          },
        },
      ],
    });
    if (!ok) return;
    BackupsTab.run(ctx, b, opts);
  },

  async run(ctx, b, opts) {
    const bar = h('div', { style: { width: '0%' } });
    const status = h('div', { class: 'progress-note' }, 'Starting…');
    const log = h('div', { class: 'log' });
    BackupsTab.active = { botId: ctx.botId, guildId: ctx.guildId, total: 1, done: 0, bar, status, log };
    let closeBtn;
    const finished = openModal({
      title: 'Restoring backup',
      wide: true,
      dismissable: false,
      body: [status, h('div', { class: 'progress' }, bar), log],
      actions: [{ label: 'Close', kind: 'ghost', disabled: true, ref: (btn) => (closeBtn = btn) }],
    });
    try {
      const stats = await api('backups:restore', ctx.botId, ctx.guildId, b.id, opts);
      status.textContent = stats.failed ? `Finished with ${stats.failed} problem${stats.failed === 1 ? '' : 's'} (see below).` : 'Restored.';
      log.append(h('div', { class: 'info' }, `Done: ${stats.ok} ok, ${stats.failed} failed.`));
    } catch (err) {
      status.textContent = 'The restore stopped.';
      log.append(h('div', { class: 'error' }, err.message));
    } finally {
      bar.style.width = '100%';
      log.scrollTop = log.scrollHeight;
      BackupsTab.active = null;
      closeBtn.disabled = false;
    }
    await finished;
    // Roles and channels changed: load the server again.
    for (const key of ['members', 'bans', 'automod', 'raidConfig']) delete ctx.srv[key];
    ctx.srv.guild = null;
    ServerPage.loadCore(ctx.botId, ctx.guildId);
    App.renderMain();
  },
};

onEvent('backup:event', (event) => {
  const a = BackupsTab.active;
  if (!a || a.botId !== event.botId || a.guildId !== event.guildId) return;
  if (event.type === 'start') a.total = Math.max(1, event.total);
  if (event.type === 'step') {
    a.done++;
    a.bar.style.width = `${Math.min(100, Math.round((a.done / a.total) * 100))}%`;
    a.status.textContent = `${a.done} of ${a.total}…`;
    a.log.append(h('div', { class: event.level }, event.msg));
    a.log.scrollTop = a.log.scrollHeight;
  }
});

// An automatic backup was taken: show it next time the tab draws (or now, if it's open).
onEvent('backups:changed', ({ guildId }) => {
  for (const bot of App.bots) {
    const srv = App.views[bot.id]?.servers[guildId];
    if (!srv) continue;
    delete srv.backups;
    if (App.isShowing(bot.id, guildId) && App.view(bot.id).tab === 'backups') ServerPage.refreshTab(bot.id, guildId);
  }
});
