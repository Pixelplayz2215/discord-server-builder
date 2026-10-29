// Raid tools tab: lock the whole server at once, pause invites and DMs, and deal with a wave of new
// joins in bulk. Moderators get the parts their own Discord permissions allow.

const RAID_WINDOWS = [['900000', 'Last 15 minutes'], ['3600000', 'Last hour'], ['21600000', 'Last 6 hours'], ['86400000', 'Last 24 hours'], ['604800000', 'Last 7 days']];
const PAUSE_LENGTHS = [['3600', '1 hour'], ['21600', '6 hours'], ['43200', '12 hours'], ['86400', '24 hours']];
const NEW_ACCOUNT_MS = 7 * 86400000;
const LOCKABLE_TYPES = new Set([0, 5, 15]); // text, announcement, forum

const RaidTab = {
  progress: null, // { botId, guildId, el } while a bulk ban runs

  render(ctx, el) {
    const { srv } = ctx;
    if (srv.raidConfig === undefined) {
      srv.raidConfig = null;
      api('servers:config', ctx.botId, ctx.guildId)
        .then((config) => {
          srv.raidConfig = config;
          ctx.rerender();
        })
        .catch(toastError);
    }
    el.append(
      h(
        'div',
        { class: 'split', style: { gridTemplateColumns: 'minmax(0,1fr) 380px' } },
        RaidTab.joinsCard(ctx),
        h('div', { class: 'stack', style: { gap: '16px' } }, RaidTab.lockdownCard(ctx), ctx.mod ? null : RaidTab.pauseCard(ctx)),
      ),
    );
  },

  can(ctx, perm) {
    return ServerPage.can(ServerPage.perms(ctx), perm);
  },

  /* ---------- Lockdown ---------- */
  lockdownCard(ctx) {
    const { srv } = ctx;
    const lockdown = srv.raidConfig?.lockdown;
    const status = h('div', { class: 'progress-note' });
    const head = h('div', { class: 'card-head' }, icon('lock'), h('h3', null, 'Lockdown'), lockdown ? h('span', { class: 'badge coral' }, 'On') : null);
    if (!RaidTab.can(ctx, PERM.MANAGE_CHANNELS)) {
      return h('div', { class: 'card' }, head, h('p', { class: 'muted' }, ctx.mod ? 'You need the Manage Channels permission to lock channels.' : 'The bot needs the Manage Channels permission.'));
    }
    if (srv.raidConfig === null) return h('div', { class: 'card' }, head, h('div', { class: 'skeleton' }));

    if (lockdown) {
      const endBtn = h('button', { class: 'btn teal' }, icon('unlock'), 'End lockdown');
      endBtn.addEventListener('click', withBusy(endBtn, () => RaidTab.endLockdown(ctx, status)));
      return h(
        'div',
        { class: 'card' },
        head,
        h(
          'div',
          { class: 'stack' },
          h('p', { class: 'muted' }, `${lockdown.channels.length} channel${lockdown.channels.length === 1 ? ' has' : 's have'} been locked since ${new Date(lockdown.at).toLocaleString()}. Ending the lockdown unlocks only those, so channels that were already read-only stay that way.`),
          endBtn,
          status,
        ),
      );
    }

    const reason = Mod.reasonInput();
    const lockBtn = h('button', { class: 'btn danger' }, icon('lock'), 'Lock down server');
    lockBtn.addEventListener('click', withBusy(lockBtn, () => RaidTab.startLockdown(ctx, reason.value, status)));
    const targets = RaidTab.lockTargets(ctx);
    return h(
      'div',
      { class: 'card' },
      head,
      h(
        'div',
        { class: 'stack' },
        h('p', { class: 'muted', style: { fontSize: 'calc(13rem / 14)' } }, `Stops everyone sending messages in the ${targets.length} channel${targets.length === 1 ? '' : 's'} they can talk in now. Roles with their own channel permissions (like staff) can still talk.`),
        reason,
        lockBtn,
        status,
      ),
    );
  },

  // Public channels where @everyone can still talk.
  lockTargets(ctx) {
    return ctx.srv.channels.filter((c) => LOCKABLE_TYPES.has(c.type) && !ChannelsTab.isLocked(ctx, c) && !ChannelsTab.isPrivate(ctx, c));
  },

  async startLockdown(ctx, reason, status) {
    const targets = RaidTab.lockTargets(ctx);
    if (!targets.length) return toast('Every public channel is already locked.', 'error');
    if (!(await confirmDialog({ title: 'Lock down the server?', message: `${targets.length} channels will stop accepting messages from everyone until you end the lockdown.`, confirmLabel: 'Lock down', danger: true }))) return;
    const lockdown = { at: Date.now(), channels: [] };
    let failed = 0;
    for (const [i, ch] of targets.entries()) {
      status.textContent = `Locking ${i + 1} of ${targets.length}: #${ch.name}`;
      try {
        ChannelsTab.replaceChannel(ctx, await api('channel:lock', ctx.botId, ctx.guildId, ch.id, true, reason || 'Server lockdown'));
        lockdown.channels.push(ch.id);
        // Saved as it goes, so closing the app halfway still lets the lockdown be ended.
        ctx.srv.raidConfig = await api('raid:saveLockdown', ctx.botId, ctx.guildId, lockdown);
      } catch {
        failed++;
      }
    }
    toast(`Locked ${lockdown.channels.length} channel${lockdown.channels.length === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}`, failed ? 'error' : 'ok');
    ctx.rerender();
  },

  async endLockdown(ctx, status) {
    const { channels } = ctx.srv.raidConfig.lockdown;
    let failed = 0;
    for (const [i, id] of channels.entries()) {
      status.textContent = `Unlocking ${i + 1} of ${channels.length}…`;
      try {
        ChannelsTab.replaceChannel(ctx, await api('channel:lock', ctx.botId, ctx.guildId, id, false, 'Lockdown ended'));
      } catch (err) {
        if (err.code !== 10003) failed++; // a channel deleted since then needs no unlocking
      }
    }
    ctx.srv.raidConfig = await api('raid:saveLockdown', ctx.botId, ctx.guildId, null);
    toast(failed ? `Lockdown ended, but ${failed} channel(s) couldn't be unlocked` : 'Lockdown ended', failed ? 'error' : 'ok');
    ctx.rerender();
  },

  /* ---------- Pause invites and DMs (owner only) ---------- */
  pauseCard(ctx) {
    const { srv } = ctx;
    const head = h('div', { class: 'card-head' }, icon('pause'), h('h3', null, 'Pause joins & DMs'));
    if (!RaidTab.can(ctx, PERM.MANAGE_GUILD)) return h('div', { class: 'card' }, head, h('p', { class: 'muted' }, 'The bot needs the Manage Server permission.'));
    const data = srv.guild.incidents_data || {};
    const until = (iso) => (iso && new Date(iso) > new Date() ? new Date(iso) : null);
    const invites = until(data.invites_disabled_until);
    const dms = until(data.dms_disabled_until);
    const length = selectEl(PAUSE_LENGTHS, '3600');

    const set = async (patch) => {
      const body = { invites_disabled_until: invites?.toISOString() || null, dms_disabled_until: dms?.toISOString() || null, ...patch };
      const result = await rest(ctx.botId, 'PUT', `/guilds/${ctx.guildId}/incident-actions`, { body, reason: 'Raid tools' });
      srv.guild.incidents_data = result || body;
      ctx.rerender();
    };
    const later = () => new Date(Date.now() + Number(length.value) * 1000).toISOString();
    const button = (label, ic, cls, fn) => {
      const btn = h('button', { class: `btn ${cls}` }, icon(ic), label);
      btn.addEventListener('click', withBusy(btn, fn));
      return btn;
    };
    const line = (what, date) => h('div', { class: 'stat-line' }, h('b', null, what), date ? h('span', { class: 'badge coral' }, `Paused until ${date.toLocaleString()}`) : h('span', { class: 'badge teal' }, 'Open'));

    return h(
      'div',
      { class: 'card' },
      head,
      h(
        'div',
        { class: 'stack' },
        h('p', { class: 'muted', style: { fontSize: 'calc(13rem / 14)' } }, "Discord's own raid switches: nobody new can join through invites, and members who don't share a friendship can't DM each other. They switch back on by themselves (24 hours at most)."),
        line('Invites', invites),
        line('DMs between members', dms),
        field('For how long', length),
        h(
          'div',
          { class: 'action-grid' },
          invites ? button('Resume invites', 'unlock', '', () => set({ invites_disabled_until: null })) : button('Pause invites', 'pause', 'danger', () => set({ invites_disabled_until: later() })),
          dms ? button('Resume DMs', 'unlock', '', () => set({ dms_disabled_until: null })) : button('Pause DMs', 'pause', 'danger', () => set({ dms_disabled_until: later() })),
        ),
      ),
    );
  },

  /* ---------- Recent joins ---------- */
  joinsCard(ctx) {
    const { srv } = ctx;
    if (!srv.members && !srv.membersLoading && !srv.membersError) MembersTab.load(ctx);
    srv.raidWindow = srv.raidWindow || '3600000';
    srv.raidSelected = srv.raidSelected || new Set();
    const head = h('div', { class: 'card-head', style: { padding: '16px 16px 0' } }, icon('userPlus'), h('h3', null, 'Recent joins'));
    if (srv.membersError) return h('div', { class: 'card' }, head, MembersTab.errorView(ctx));
    if (!srv.members) return h('div', { class: 'card' }, head, h('div', { class: 'loading-block' }, [1, 2, 3].map(() => h('div', { class: 'skeleton' }))));

    const since = Date.now() - Number(srv.raidWindow);
    const joined = srv.members
      .filter((m) => !m.user.bot && m.user.id !== srv.guild.owner_id && m.joined_at && Date.parse(m.joined_at) >= since)
      .sort((a, b) => Date.parse(b.joined_at) - Date.parse(a.joined_at));
    const isNew = (m) => Date.now() - snowflakeDate(m.user.id).getTime() < NEW_ACCOUNT_MS;
    const shown = joined.filter((m) => (!srv.raidNewOnly || isNew(m)) && (!srv.raidNoAvatar || !m.user.avatar));
    for (const id of srv.raidSelected) if (!shown.some((m) => m.user.id === id)) srv.raidSelected.delete(id);
    const selected = srv.raidSelected;

    const rows = shown.slice(0, 500).map((m) => {
      const box = h('input', { type: 'checkbox', checked: selected.has(m.user.id) });
      box.addEventListener('change', () => {
        if (box.checked) selected.add(m.user.id);
        else selected.delete(m.user.id);
        ctx.rerender();
      });
      return h(
        'label',
        { class: 'list-row clickable' },
        h('span', { class: 'check-row' }, box),
        h('img', { class: 'avatar', src: memberAvatar(ctx.guildId, m, 64), width: 32, height: 32, alt: '', loading: 'lazy' }),
        h(
          'div',
          { class: 'grow', style: { minWidth: 0 } },
          h('div', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'primary ellipsis' }, MembersTab.memberName(m)), isNew(m) ? h('span', { class: 'badge coral' }, 'New account') : null, m.user.avatar ? null : h('span', { class: 'badge' }, 'No avatar')),
          h('div', { class: 'secondary ellipsis' }, `@${m.user.username} · joined ${fmtRelative(m.joined_at)} · account ${fmtRelative(snowflakeDate(m.user.id))}`),
        ),
      );
    });

    const newCount = joined.filter(isNew).length;
    const action = (label, ic, perm, run) => {
      const btn = h('button', { class: `btn sm ${ic === 'clock' ? '' : 'danger'}`, disabled: !selected.size || !RaidTab.can(ctx, perm) }, icon(ic), label);
      btn.addEventListener('click', withBusy(btn, run));
      return btn;
    };

    return h(
      'div',
      { class: 'card flush' },
      head,
      h(
        'div',
        { class: 'stack', style: { padding: '12px 16px' } },
        h(
          'div',
          { class: 'row wrap' },
          h('div', { style: { width: '190px' } }, selectEl(RAID_WINDOWS, srv.raidWindow, (v) => { srv.raidWindow = v; ctx.rerender(); })),
          switchEl(!!srv.raidNewOnly, (v) => { srv.raidNewOnly = v; ctx.rerender(); }, 'New accounts only'),
          switchEl(!!srv.raidNoAvatar, (v) => { srv.raidNoAvatar = v; ctx.rerender(); }, 'No profile picture only'),
        ),
        h('div', { class: 'stat-line' }, h('b', null, `${joined.length} joined`), h('span', { class: newCount ? 'badge coral' : 'badge' }, `${newCount} with accounts under 7 days old`), srv.membersTruncated ? h('span', { class: 'subtle' }, '(first 10,000 members only)') : null),
        h(
          'div',
          { class: 'row wrap' },
          h('button', { class: 'btn sm ghost', disabled: !shown.length, onclick: () => { for (const m of shown.slice(0, 500)) selected.add(m.user.id); ctx.rerender(); } }, `Select all ${Math.min(shown.length, 500)}`),
          selected.size ? h('button', { class: 'btn sm ghost', onclick: () => { selected.clear(); ctx.rerender(); } }, 'Clear') : null,
          h('div', { class: 'grow' }),
          h('span', { class: 'subtle' }, `${selected.size} selected`),
          action('Timeout', 'clock', PERM.MODERATE_MEMBERS, () => RaidTab.bulk(ctx, 'timeout')),
          action('Kick', 'kick', PERM.KICK_MEMBERS, () => RaidTab.bulk(ctx, 'kick')),
          action('Ban', 'ban', PERM.BAN_MEMBERS, () => RaidTab.bulk(ctx, 'ban')),
        ),
      ),
      h('div', { style: { borderTop: '1px solid var(--border)' } }, rows.length ? h('div', { class: 'list' }, rows) : h('div', { class: 'empty' }, icon('userPlus'), h('h3', null, 'Nobody matches'), h('p', null, 'Pick a longer time or turn a filter off.'))),
    );
  },

  async bulk(ctx, kind) {
    const { srv } = ctx;
    const ids = [...srv.raidSelected];
    const reason = Mod.reasonInput();
    reason.value = 'Raid cleanup';
    const extra = kind === 'ban' ? selectEl(BAN_DELETE_OPTIONS, '3600') : kind === 'timeout' ? selectEl(TIMEOUT_OPTIONS, '86400') : null;
    const verb = { ban: 'Ban', kick: 'Kick', timeout: 'Time out' }[kind];
    const ok = await openModal({
      title: `${verb} ${ids.length} member${ids.length === 1 ? '' : 's'}?`,
      body: [
        h('p', null, kind === 'ban' ? 'They are removed and cannot rejoin until unbanned.' : kind === 'kick' ? 'They can rejoin with a new invite.' : 'They cannot chat, react or join voice until the timeout ends.'),
        extra ? field(kind === 'ban' ? 'Message history' : 'Duration', extra) : null,
        field('Reason', reason),
      ],
      actions: [{ label: 'Cancel', kind: 'ghost', value: false }, { label: verb, kind: 'danger', value: true }],
    });
    if (!ok) return;

    const progress = h('div', { class: 'progress' }, h('div'));
    const note = h('div', { class: 'progress-note' }, 'Starting…');
    const update = (done) => {
      progress.firstChild.style.width = `${Math.round((done / ids.length) * 100)}%`;
      note.textContent = `${done} of ${ids.length} done`;
    };
    const running = openModal({ title: `${verb}ing ${ids.length} member${ids.length === 1 ? '' : 's'}…`, dismissable: false, body: [progress, note] });
    const modal = document.querySelector('#modal-root .modal-backdrop:last-child .modal');

    let done = [];
    let failed = 0;
    try {
      if (kind === 'ban') {
        RaidTab.progress = { botId: ctx.botId, guildId: ctx.guildId, update };
        const result = await api('raid:ban', ctx.botId, ctx.guildId, ids, Number(extra.value), reason.value);
        done = result.banned;
        failed = result.failed.length;
      } else {
        for (const [i, id] of ids.entries()) {
          try {
            if (kind === 'kick') await rest(ctx.botId, 'DELETE', `/guilds/${ctx.guildId}/members/${id}`, { reason: reason.value, noCase: true });
            else await rest(ctx.botId, 'PATCH', `/guilds/${ctx.guildId}/members/${id}`, { body: { communication_disabled_until: new Date(Date.now() + Number(extra.value) * 1000).toISOString() }, reason: reason.value, noCase: true });
            done.push(id);
          } catch {
            failed++;
          }
          update(i + 1);
        }
      }
    } catch (err) {
      toastError(err);
    } finally {
      RaidTab.progress = null;
      modal?.closeModal();
      await running;
    }
    for (const id of done) {
      if (kind === 'timeout') Mod.updateMember(ctx, id, { communication_disabled_until: new Date(Date.now() + Number(extra.value) * 1000).toISOString() });
      else Mod.dropMember(ctx, id);
      srv.raidSelected.delete(id);
    }
    if (kind === 'ban') delete srv.bans;
    const past = { ban: 'Banned', kick: 'Kicked', timeout: 'Timed out' }[kind];
    if (done.length || failed) toast(`${past} ${done.length}${failed ? `, ${failed} failed (they may rank above the bot${ctx.mod ? ' or you' : ''})` : ''}`, failed ? 'error' : 'ok');
    ctx.rerender();
  },
};

onEvent('raid:progress', ({ botId, guildId, done }) => {
  const p = RaidTab.progress;
  if (p && p.botId === botId && p.guildId === guildId) p.update(done);
});
