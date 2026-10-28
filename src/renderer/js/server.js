// Server page: header, tabs and the Overview / Members / Moderation / Channels / Audit log tabs.

const SERVER_TABS = [
  ['overview', 'Overview', 'server'],
  ['members', 'Members', 'users'],
  ['moderation', 'Moderation', 'shield'],
  ['channels', 'Channels', 'hash'],
  ['builder', 'Builder', 'hammer'],
  ['audit', 'Audit log', 'list'],
];

const TIMEOUT_OPTIONS = [
  ['60', '60 seconds'],
  ['300', '5 minutes'],
  ['600', '10 minutes'],
  ['3600', '1 hour'],
  ['86400', '1 day'],
  ['604800', '1 week'],
  ['2419200', '28 days (max)'],
];
const BAN_DELETE_OPTIONS = [
  ['0', "Don't delete messages"],
  ['3600', 'Delete last hour'],
  ['21600', 'Delete last 6 hours'],
  ['86400', 'Delete last 24 hours'],
  ['259200', 'Delete last 3 days'],
  ['604800', 'Delete last 7 days'],
];
const SLOWMODE_OPTIONS = [['0', 'Off'], ['5', '5s'], ['10', '10s'], ['30', '30s'], ['60', '1m'], ['300', '5m'], ['900', '15m'], ['3600', '1h'], ['21600', '6h']];
const VERIFICATION = ['None', 'Low', 'Medium', 'High', 'Highest'];
const isVoice = (type) => type === 2 || type === 13;
const isSnowflake = (v) => /^\d{15,21}$/.test(String(v).trim());

const ServerPage = {
  ctx(bot, view) {
    const guildId = view.guildId;
    return {
      bot,
      botId: bot.id,
      view,
      guildId,
      srv: App.server(bot.id, guildId),
      rerender: () => ServerPage.refreshTab(bot.id, guildId),
    };
  },

  render(bot, view) {
    const ctx = ServerPage.ctx(bot, view);
    const { srv } = ctx;
    if (!srv.guild && !srv.loading && !srv.error) ServerPage.loadCore(bot.id, ctx.guildId);
    const summary = view.guilds?.find((g) => g.id === ctx.guildId) || { id: ctx.guildId, name: 'Server' };
    const content = h('div', { class: 'content', id: 'tab-content' });
    ServerPage.fillTab(ctx, content);
    return h('div', null, ServerPage.hero(ctx, summary), content);
  },

  async loadCore(botId, guildId) {
    const srv = App.server(botId, guildId);
    srv.loading = true;
    try {
      const [guild, channels, roles, botMember] = await Promise.all([
        rest(botId, 'GET', `/guilds/${guildId}`, { query: { with_counts: true } }),
        rest(botId, 'GET', `/guilds/${guildId}/channels`),
        rest(botId, 'GET', `/guilds/${guildId}/roles`),
        rest(botId, 'GET', `/guilds/${guildId}/members/${botId}`),
      ]);
      Object.assign(srv, { guild, channels, roles, botMember, error: null });
    } catch (err) {
      srv.error = err.message;
    }
    srv.loading = false;
    if (App.isShowing(botId, guildId)) App.renderMain();
  },

  refreshTab(botId, guildId) {
    if (!App.isShowing(botId, guildId)) return;
    const el = document.getElementById('tab-content');
    const main = document.getElementById('bot-main');
    if (!el || !main) return;
    const scroll = main.scrollTop;
    el.replaceChildren();
    ServerPage.fillTab(ServerPage.ctx(App.bot(botId), App.view(botId)), el);
    main.scrollTop = scroll;
  },

  fillTab(ctx, el) {
    const { srv, view } = ctx;
    if (srv.error) {
      el.append(
        h(
          'div',
          { class: 'callout warn' },
          icon('alert'),
          h('div', { class: 'grow' }, h('b', null, 'Could not load this server. '), srv.error),
          h('button', { class: 'btn sm', onclick: () => { srv.error = null; ServerPage.loadCore(ctx.botId, ctx.guildId); App.renderMain(); } }, 'Retry'),
        ),
      );
      return;
    }
    if (!srv.guild) {
      el.append(h('div', { class: 'loading-block' }, [1, 2, 3, 4].map(() => h('div', { class: 'skeleton' }))));
      return;
    }
    const tabs = { overview: OverviewTab, members: MembersTab, moderation: ModerationTab, channels: ChannelsTab, builder: Builder, audit: AuditTab };
    (tabs[view.tab] || OverviewTab).render(ctx, el);
  },

  hero(ctx, summary) {
    const { srv, view } = ctx;
    const g = srv.guild || summary;
    const bits = srv.guild ? ServerPage.perms(ctx) : null;
    const refresh = h('button', { class: 'btn sm', title: 'Reload server data' }, icon('refresh'), 'Refresh');
    refresh.addEventListener('click', () => {
      for (const key of ['members', 'membersError', 'bans', 'bansError', 'audit', 'auditError', 'owner']) delete srv[key];
      srv.guild = null;
      ServerPage.loadCore(ctx.botId, ctx.guildId);
      App.renderMain();
    });
    return h(
      'div',
      { class: 'server-hero' },
      h(
        'div',
        { class: 'top' },
        guildIcon(g, 64),
        h(
          'div',
          { class: 'grow' },
          h('h2', { class: 'ellipsis' }, g.name),
          h(
            'div',
            { class: 'meta' },
            h('span', { class: 'badge' }, icon('users'), `${fmtNum(g.approximate_member_count)} members`),
            g.approximate_presence_count != null ? h('span', { class: 'badge teal' }, `${fmtNum(g.approximate_presence_count)} online`) : null,
            g.premium_tier ? h('span', { class: 'badge pixel peri' }, `Boost lvl ${g.premium_tier}`) : null,
            g.features?.includes('COMMUNITY') ? h('span', { class: 'badge gold' }, 'Community') : null,
            bits == null
              ? null
              : ServerPage.can(bits, PERM.ADMINISTRATOR)
                ? h('span', { class: 'badge teal' }, icon('shield'), 'Bot is Administrator')
                : h('span', { class: 'badge coral' }, icon('alert'), 'Bot has limited permissions'),
          ),
        ),
        refresh,
        h('button', { class: 'btn sm', onclick: () => openExternal(`https://discord.com/channels/${ctx.guildId}`) }, icon('external'), 'Open in Discord'),
      ),
      h(
        'div',
        { class: 'tabs' },
        SERVER_TABS.map(([id, label, ic]) =>
          h('button', { class: `tab ${view.tab === id ? 'active' : ''}`, onclick: () => { view.tab = id; App.renderMain(); } }, icon(ic), label),
        ),
      ),
    );
  },

  perms(ctx) {
    const { srv, botId } = ctx;
    if (srv.guild.owner_id === botId) return PERM.ADMINISTRATOR;
    let bits = 0n;
    for (const role of srv.roles) if (role.id === srv.guild.id || srv.botMember.roles.includes(role.id)) bits |= BigInt(role.permissions);
    return bits;
  },

  can(bits, perm) {
    return (bits & PERM.ADMINISTRATOR) !== 0n || (bits & perm) !== 0n;
  },

  botTopPosition(ctx) {
    const { srv } = ctx;
    if (srv.guild.owner_id === ctx.botId) return Infinity;
    return Math.max(0, ...srv.roles.filter((r) => srv.botMember.roles.includes(r.id)).map((r) => r.position));
  },

  roleById(ctx, id) {
    return ctx.srv.roles?.find((r) => r.id === id);
  },

  memberRoles(ctx, member) {
    return member.roles
      .map((id) => ServerPage.roleById(ctx, id))
      .filter(Boolean)
      .sort((a, b) => b.position - a.position);
  },
};

const roleChip = (role) => h('span', { class: 'chip', title: role.name }, h('span', { class: 'dot', style: { background: roleColor(role) } }), h('span', null, role.name));

/* ======================= Overview ======================= */
const OverviewTab = {
  render(ctx, el) {
    const { srv } = ctx;
    const g = srv.guild;
    const bits = ServerPage.perms(ctx);
    const nonCategory = srv.channels.filter((c) => c.type !== 4);

    const ownerEl = h('dd', null, srv.owner ? `${displayName(srv.owner)} (@${srv.owner.username})` : g.owner_id);
    if (!srv.owner) {
      rest(ctx.botId, 'GET', `/users/${g.owner_id}`)
        .then((user) => {
          srv.owner = user;
          ownerEl.textContent = `${displayName(user)} (@${user.username})`;
        })
        .catch(() => {});
    }

    const permRow = (label, perm) => {
      const ok = ServerPage.can(bits, perm);
      return h('div', { class: 'row', style: { padding: '4px 0' } }, h('span', { class: `badge ${ok ? 'teal' : 'coral'}` }, icon(ok ? 'check' : 'x')), h('span', null, label));
    };
    const topRole = srv.roles.filter((r) => srv.botMember.roles.includes(r.id)).sort((a, b) => b.position - a.position)[0];

    el.append(
      h(
        'div',
        { class: 'stack', style: { gap: '18px' } },
        h(
          'div',
          { class: 'grid cols-4' },
          BotPage.stat(fmtNum(g.approximate_member_count), 'Members'),
          BotPage.stat(fmtNum(g.approximate_presence_count), 'Online now'),
          BotPage.stat(nonCategory.length, `Channels · ${srv.channels.length - nonCategory.length} categories`),
          BotPage.stat(srv.roles.length - 1, 'Roles'),
        ),
        h(
          'div',
          { class: 'grid cols-2' },
          h(
            'div',
            { class: 'card' },
            h('div', { class: 'card-head' }, icon('info'), h('h3', null, 'Server info')),
            h(
              'dl',
              { class: 'kv' },
              h('dt', null, 'Server ID'),
              h('dd', null, h('span', { class: 'mono', style: { cursor: 'pointer' }, title: 'Copy', onclick: () => copyText(g.id, 'Server ID copied') }, g.id)),
              h('dt', null, 'Owner'),
              ownerEl,
              h('dt', null, 'Created'),
              h('dd', null, `${fmtDate(snowflakeDate(g.id))} (${fmtRelative(snowflakeDate(g.id))})`),
              h('dt', null, 'Verification'),
              h('dd', null, VERIFICATION[g.verification_level] || '—'),
              h('dt', null, 'Boosts'),
              h('dd', null, `${g.premium_subscription_count || 0} boosts · level ${g.premium_tier || 0}`),
              h('dt', null, 'Locale'),
              h('dd', null, g.preferred_locale || '—'),
              g.description ? [h('dt', null, 'Description'), h('dd', null, g.description)] : null,
              h('dt', null, 'Features'),
              h(
                'dd',
                null,
                g.features?.length
                  ? h('div', { class: 'row wrap', style: { gap: '4px' } }, g.features.slice(0, 10).map((f) => h('span', { class: 'badge' }, f.replace(/_/g, ' ').toLowerCase())))
                  : 'None',
              ),
            ),
          ),
          h(
            'div',
            { class: 'card' },
            h('div', { class: 'card-head' }, icon('shield'), h('h3', null, 'Bot permissions')),
            h(
              'div',
              { class: 'grid cols-2', style: { gap: '0 12px' } },
              permRow('Administrator', PERM.ADMINISTRATOR),
              permRow('Manage Server', PERM.MANAGE_GUILD),
              permRow('Manage Roles', PERM.MANAGE_ROLES),
              permRow('Manage Channels', PERM.MANAGE_CHANNELS),
              permRow('Kick Members', PERM.KICK_MEMBERS),
              permRow('Ban Members', PERM.BAN_MEMBERS),
              permRow('Timeout Members', PERM.MODERATE_MEMBERS),
              permRow('Manage Messages', PERM.MANAGE_MESSAGES),
              permRow('Manage Nicknames', PERM.MANAGE_NICKNAMES),
              permRow('View Audit Log', PERM.VIEW_AUDIT_LOG),
            ),
            h(
              'p',
              { class: 'subtle', style: { fontSize: '12px', marginTop: '12px' } },
              topRole ? `Highest bot role: @${topRole.name}. The bot can only manage members and roles below it.` : 'The bot has no roles in this server.',
            ),
          ),
        ),
        h('div', { class: 'grid cols-2' }, OverviewTab.rolesCard(ctx), OverviewTab.settingsCard(ctx)),
      ),
    );
  },

  rolesCard(ctx) {
    const { srv } = ctx;
    const top = ServerPage.botTopPosition(ctx);
    const roles = srv.roles.filter((r) => r.id !== srv.guild.id).sort((a, b) => b.position - a.position);
    const addBtn = h('button', { class: 'btn sm', onclick: () => OverviewTab.createRole(ctx) }, icon('plus'), 'New role');
    return h(
      'div',
      { class: 'card flush' },
      h('div', { class: 'card-head', style: { padding: '16px 16px 0' } }, icon('tag'), h('h3', null, `Roles (${roles.length})`), addBtn),
      h(
        'div',
        { class: 'list', style: { maxHeight: '360px', overflowY: 'auto' } },
        roles.map((role) => {
          const manageable = !role.managed && role.position < top;
          return h(
            'div',
            { class: 'list-row', style: { minHeight: '46px', padding: '6px 16px' } },
            h('span', { class: 'dot', style: { width: '12px', height: '12px', borderRadius: '50%', background: roleColor(role), flexShrink: 0 } }),
            h('span', { class: 'grow ellipsis', style: { fontWeight: 500 } }, role.name),
            role.managed ? h('span', { class: 'badge peri' }, 'Integration') : null,
            BigInt(role.permissions) & PERM.ADMINISTRATOR ? h('span', { class: 'badge coral' }, 'Admin') : null,
            role.hoist ? h('span', { class: 'badge' }, 'Hoisted') : null,
            h('button', { class: 'icon-btn danger', title: manageable ? 'Delete role' : 'The bot cannot manage this role', disabled: !manageable, onclick: () => OverviewTab.deleteRole(ctx, role) }, icon('trash')),
          );
        }),
      ),
    );
  },

  async createRole(ctx) {
    const name = h('input', { class: 'input', placeholder: 'New role', maxlength: 100 });
    const color = h('input', { type: 'color', value: '#0bbfbc' });
    let hoist = false;
    let mentionable = false;
    await openModal({
      title: 'Create role',
      body: [
        field('Name', name),
        h('div', { class: 'row' }, h('span', { class: 'label' }, 'Colour'), color),
        switchEl(false, (v) => (hoist = v), 'Show members separately'),
        switchEl(false, (v) => (mentionable = v), 'Allow anyone to @mention'),
      ],
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        {
          label: 'Create role',
          kind: 'primary',
          onClick: async () => {
            const role = await rest(ctx.botId, 'POST', `/guilds/${ctx.guildId}/roles`, {
              body: { name: name.value.trim() || 'new role', color: parseInt(color.value.slice(1), 16), hoist, mentionable },
              reason: 'Created in Discord Server Builder',
            });
            ctx.srv.roles.push(role);
            toast(`Created @${role.name}`);
            ctx.rerender();
          },
        },
      ],
    });
  },

  async deleteRole(ctx, role) {
    if (!(await confirmDialog({ title: `Delete @${role.name}?`, message: 'Everyone loses this role. This cannot be undone.', confirmLabel: 'Delete role', danger: true }))) return;
    try {
      await rest(ctx.botId, 'DELETE', `/guilds/${ctx.guildId}/roles/${role.id}`, { reason: 'Deleted in Discord Server Builder' });
      ctx.srv.roles = ctx.srv.roles.filter((r) => r.id !== role.id);
      toast(`Deleted @${role.name}`);
      ctx.rerender();
    } catch (err) {
      toastError(err);
    }
  },

  settingsCard(ctx) {
    const { srv } = ctx;
    const nameInput = h('input', { class: 'input', value: srv.guild.name, maxlength: 100 });
    const saveBtn = h('button', { class: 'btn' }, icon('save'), 'Save');
    saveBtn.addEventListener(
      'click',
      withBusy(saveBtn, async () => {
        const guild = await rest(ctx.botId, 'PATCH', `/guilds/${ctx.guildId}`, { body: { name: nameInput.value.trim() }, reason: 'Renamed in Discord Server Builder' });
        Object.assign(srv.guild, { name: guild.name });
        const summary = ctx.view.guilds?.find((g) => g.id === ctx.guildId);
        if (summary) summary.name = guild.name;
        BotPage.renderSidebar(ctx.botId);
        App.renderMain();
        toast('Server renamed');
      }),
    );
    return h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-head' }, icon('edit'), h('h3', null, 'Server settings')),
      h('div', { class: 'stack' }, field('Server name', h('div', { class: 'row' }, h('div', { class: 'grow' }, nameInput), saveBtn))),
      h('div', { style: { height: '1px', background: 'var(--border)', margin: '18px 0' } }),
      h(
        'div',
        { class: 'row' },
        h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, 'Remove the bot from this server'), h('div', { class: 'subtle', style: { fontSize: '12px' } }, 'You can invite it again any time.')),
        h('button', { class: 'btn danger', onclick: () => OverviewTab.leave(ctx) }, icon('kick'), 'Leave server'),
      ),
    );
  },

  async leave(ctx) {
    const name = ctx.srv.guild.name;
    if (!(await confirmDialog({ title: `Leave ${name}?`, message: 'The bot will leave this server.', confirmLabel: 'Leave server', danger: true }))) return;
    try {
      await rest(ctx.botId, 'DELETE', `/users/@me/guilds/${ctx.guildId}`);
      ctx.view.guilds = ctx.view.guilds.filter((g) => g.id !== ctx.guildId);
      delete ctx.view.servers[ctx.guildId];
      BotPage.openGuild(ctx.botId, null);
      toast(`Left ${name}`);
    } catch (err) {
      toastError(err);
    }
  },
};

/* ======================= Moderation actions (shared) ======================= */
const Mod = {
  reasonInput: () => h('input', { class: 'input', placeholder: 'Reason (shows in the audit log)', maxlength: 400 }),

  updateMember(ctx, userId, patch) {
    for (const list of [ctx.srv.members, Object.values(ctx.srv.lookups || {})]) {
      const m = list?.find((x) => x.user.id === userId);
      if (m) Object.assign(m, patch);
    }
  },

  dropMember(ctx, userId) {
    if (ctx.srv.members) ctx.srv.members = ctx.srv.members.filter((m) => m.user.id !== userId);
    if (ctx.srv.lookups) delete ctx.srv.lookups[userId];
    if (ctx.srv.selectedMemberId === userId) ctx.srv.selectedMemberId = null;
  },

  async timeout(ctx, userId, label) {
    const duration = selectEl(TIMEOUT_OPTIONS, '600');
    const reason = Mod.reasonInput();
    return openModal({
      title: `Timeout ${label}`,
      body: [h('p', null, 'They will not be able to chat, react or join voice until the timeout ends.'), field('Duration', duration), field('Reason', reason)],
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        {
          label: 'Timeout',
          kind: 'primary',
          icon: 'clock',
          onClick: async () => {
            const until = new Date(Date.now() + Number(duration.value) * 1000).toISOString();
            await rest(ctx.botId, 'PATCH', `/guilds/${ctx.guildId}/members/${userId}`, { body: { communication_disabled_until: until }, reason: reason.value });
            Mod.updateMember(ctx, userId, { communication_disabled_until: until });
            toast(`${label} timed out`);
            ctx.rerender();
          },
        },
      ],
    });
  },

  async removeTimeout(ctx, userId, label) {
    try {
      await rest(ctx.botId, 'PATCH', `/guilds/${ctx.guildId}/members/${userId}`, { body: { communication_disabled_until: null }, reason: 'Timeout removed' });
      Mod.updateMember(ctx, userId, { communication_disabled_until: null });
      toast(`Removed timeout for ${label}`);
      ctx.rerender();
    } catch (err) {
      toastError(err);
    }
  },

  async kick(ctx, userId, label) {
    const reason = Mod.reasonInput();
    return openModal({
      title: `Kick ${label}?`,
      body: [h('p', null, 'They can rejoin with a new invite.'), field('Reason', reason)],
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        {
          label: 'Kick',
          kind: 'danger',
          icon: 'kick',
          onClick: async () => {
            await rest(ctx.botId, 'DELETE', `/guilds/${ctx.guildId}/members/${userId}`, { reason: reason.value });
            Mod.dropMember(ctx, userId);
            toast(`Kicked ${label}`);
            ctx.rerender();
          },
        },
      ],
    });
  },

  async ban(ctx, userId, label) {
    const reason = Mod.reasonInput();
    const purge = selectEl(BAN_DELETE_OPTIONS, '0');
    return openModal({
      title: `Ban ${label}?`,
      body: [h('p', null, 'They are removed and cannot rejoin until unbanned.'), field('Message history', purge), field('Reason', reason)],
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        {
          label: 'Ban',
          kind: 'danger',
          icon: 'ban',
          onClick: async () => {
            await rest(ctx.botId, 'PUT', `/guilds/${ctx.guildId}/bans/${userId}`, { body: { delete_message_seconds: Number(purge.value) }, reason: reason.value });
            Mod.dropMember(ctx, userId);
            delete ctx.srv.bans;
            toast(`Banned ${label}`);
            ctx.rerender();
          },
        },
      ],
    });
  },

  async unban(ctx, userId, label) {
    try {
      await rest(ctx.botId, 'DELETE', `/guilds/${ctx.guildId}/bans/${userId}`, { reason: 'Unbanned in Discord Server Builder' });
      if (ctx.srv.bans) ctx.srv.bans = ctx.srv.bans.filter((b) => b.user.id !== userId);
      toast(`Unbanned ${label}`);
      ctx.rerender();
    } catch (err) {
      toastError(err);
    }
  },

  async nickname(ctx, member) {
    const input = h('input', { class: 'input', value: member.nick || '', placeholder: displayName(member.user), maxlength: 32 });
    return openModal({
      title: 'Change nickname',
      body: [field('Nickname', input, 'Leave empty to reset.')],
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        {
          label: 'Save',
          kind: 'primary',
          onClick: async () => {
            const nick = input.value.trim() || null;
            await rest(ctx.botId, 'PATCH', `/guilds/${ctx.guildId}/members/${member.user.id}`, { body: { nick }, reason: 'Nickname changed' });
            Mod.updateMember(ctx, member.user.id, { nick });
            toast('Nickname updated');
            ctx.rerender();
          },
        },
      ],
    });
  },

  async dm(ctx, user) {
    const text = h('textarea', { class: 'textarea', placeholder: 'Message…', maxlength: 2000 });
    return openModal({
      title: `Message ${displayName(user)}`,
      body: [h('p', null, 'Sends a direct message from the bot. It fails if they have DMs from server members turned off.'), text],
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        {
          label: 'Send DM',
          kind: 'primary',
          icon: 'send',
          onClick: async () => {
            if (!text.value.trim()) return false;
            const channel = await rest(ctx.botId, 'POST', '/users/@me/channels', { body: { recipient_id: user.id } });
            await rest(ctx.botId, 'POST', `/channels/${channel.id}/messages`, { body: { content: text.value } });
            toast('Message sent');
          },
        },
      ],
    });
  },

  async toggleRole(ctx, member, role) {
    const has = member.roles.includes(role.id);
    try {
      await rest(ctx.botId, has ? 'DELETE' : 'PUT', `/guilds/${ctx.guildId}/members/${member.user.id}/roles/${role.id}`, { reason: 'Roles changed in Discord Server Builder' });
      Mod.updateMember(ctx, member.user.id, { roles: has ? member.roles.filter((r) => r !== role.id) : [...member.roles, role.id] });
      ctx.rerender();
    } catch (err) {
      toastError(err);
    }
  },
};

/* ======================= Members ======================= */
const MembersTab = {
  async load(ctx) {
    const { srv } = ctx;
    srv.membersLoading = true;
    srv.membersError = null;
    try {
      const { members, truncated } = await api('members:all', ctx.botId, ctx.guildId, 10000);
      srv.members = members;
      srv.membersTruncated = truncated;
    } catch (err) {
      srv.membersError = err;
    }
    srv.membersLoading = false;
    ctx.rerender();
  },

  render(ctx, el) {
    const { srv } = ctx;
    if (!srv.members && !srv.membersLoading && !srv.membersError) MembersTab.load(ctx);

    const body = h('div');
    const draw = () => body.replaceChildren(MembersTab.body(ctx, draw));
    const roleOptions = [['', 'All roles'], ...srv.roles.filter((r) => r.id !== srv.guild.id).sort((a, b) => b.position - a.position).map((r) => [r.id, r.name])];
    const reload = h('button', { class: 'btn sm', title: 'Reload members' }, icon('refresh'), 'Reload');
    reload.addEventListener('click', () => {
      srv.members = null;
      MembersTab.load(ctx);
      ctx.rerender();
    });

    el.append(
      h(
        'div',
        { class: 'toolbar' },
        searchBox('Search name, nickname or ID…', (q) => { srv.memberQuery = q; srv.memberLimit = 200; draw(); }, srv.memberQuery),
        h('div', { style: { width: '200px' } }, selectEl(roleOptions, srv.memberRole, (v) => { srv.memberRole = v; srv.memberLimit = 200; draw(); })),
        h('div', { class: 'grow' }),
        h('button', { class: 'btn sm', onclick: () => MembersTab.lookup(ctx) }, icon('search'), 'Look up by ID'),
        reload,
      ),
      body,
    );
    draw();
  },

  filtered(ctx) {
    const { srv } = ctx;
    const q = srv.memberQuery.trim().toLowerCase();
    return (srv.members || []).filter((m) => {
      if (srv.memberRole && !m.roles.includes(srv.memberRole)) return false;
      if (!q) return true;
      return [m.nick, m.user.username, m.user.global_name, m.user.id].some((v) => v && v.toLowerCase().includes(q));
    });
  },

  body(ctx, draw) {
    const { srv } = ctx;
    if (srv.membersError) return MembersTab.errorView(ctx);
    if (!srv.members) return h('div', { class: 'loading-block' }, [1, 2, 3, 4, 5, 6].map(() => h('div', { class: 'skeleton' })));

    const list = MembersTab.filtered(ctx);
    const shown = list.slice(0, srv.memberLimit);
    const selected = MembersTab.findMember(ctx, srv.selectedMemberId);
    const select = (id) => {
      srv.selectedMemberId = srv.selectedMemberId === id ? null : id;
      draw();
    };

    const listCard = h(
      'div',
      { class: 'card flush' },
      h(
        'div',
        { class: 'list-head' },
        h('span', { class: 'grow' }, `${fmtNum(list.length)} of ${fmtNum(srv.members.length)} members${srv.membersTruncated ? ' (first 10,000)' : ''}`),
        selected ? null : h('span', { class: 'col-roles' }, 'Roles'),
        selected ? null : h('span', { class: 'col-date' }, 'Joined'),
        h('span', { class: 'col-actions' }, 'Actions'),
      ),
      shown.length
        ? h('div', { class: 'list' }, shown.map((m) => MembersTab.row(ctx, m, select, !!selected)))
        : h('div', { class: 'empty' }, icon('users'), h('h3', null, 'No members match')),
      list.length > shown.length
        ? h('div', { class: 'more-row' }, h('button', { class: 'btn sm', onclick: () => { srv.memberLimit += 300; draw(); } }, `Show more (${fmtNum(list.length - shown.length)} left)`))
        : null,
    );

    if (!selected) return listCard;
    return h('div', { class: 'split' }, listCard, h('div', { class: 'sticky' }, MembersTab.panel(ctx, selected, () => select(selected.user.id))));
  },

  findMember(ctx, id) {
    if (!id) return null;
    return ctx.srv.members?.find((m) => m.user.id === id) || ctx.srv.lookups?.[id] || null;
  },

  memberName: (m) => m.nick || displayName(m.user),
  timedOut: (m) => m.communication_disabled_until && new Date(m.communication_disabled_until) > new Date(),

  row(ctx, m, select, compact) {
    const roles = ServerPage.memberRoles(ctx, m);
    const colored = roles.find((r) => r.color);
    const name = MembersTab.memberName(m);
    const stop = (fn) => (e) => {
      e.stopPropagation();
      fn();
    };
    return h(
      'div',
      { class: `list-row clickable ${ctx.srv.selectedMemberId === m.user.id ? 'selected' : ''}`, onclick: () => select(m.user.id) },
      h('img', { class: 'avatar', src: memberAvatar(ctx.guildId, m, 64), width: 36, height: 36, alt: '', loading: 'lazy' }),
      h(
        'div',
        { class: 'grow', style: { minWidth: 0 } },
        h(
          'div',
          { class: 'row', style: { gap: '6px' } },
          h('span', { class: 'primary ellipsis', style: colored ? { color: roleColor(colored) } : null }, name),
          m.user.bot ? h('span', { class: 'badge peri' }, 'BOT') : null,
          ctx.srv.guild.owner_id === m.user.id ? h('span', { class: 'badge gold' }, icon('crown'), 'Owner') : null,
          MembersTab.timedOut(m) ? h('span', { class: 'badge coral' }, icon('clock'), 'Timed out') : null,
        ),
        h('div', { class: 'secondary ellipsis' }, `@${m.user.username}`),
      ),
      compact ? null : h('div', { class: 'col-roles' }, roles.slice(0, 2).map(roleChip), roles.length > 2 ? h('span', { class: 'chip' }, `+${roles.length - 2}`) : null),
      compact ? null : h('div', { class: 'col-date' }, fmtDate(m.joined_at)),
      h(
        'div',
        { class: 'col-actions' },
        h('button', { class: 'icon-btn', title: 'Timeout', onclick: stop(() => Mod.timeout(ctx, m.user.id, name)) }, icon('clock')),
        h('button', { class: 'icon-btn danger', title: 'Kick', onclick: stop(() => Mod.kick(ctx, m.user.id, name)) }, icon('kick')),
        h('button', { class: 'icon-btn danger', title: 'Ban', onclick: stop(() => Mod.ban(ctx, m.user.id, name)) }, icon('ban')),
      ),
    );
  },

  panel(ctx, m, close) {
    const { srv } = ctx;
    const name = MembersTab.memberName(m);
    const top = ServerPage.botTopPosition(ctx);
    const assignable = srv.roles.filter((r) => r.id !== srv.guild.id && !r.managed && r.position < top).sort((a, b) => b.position - a.position);
    const locked = ServerPage.memberRoles(ctx, m).filter((r) => !assignable.includes(r));
    const timedOut = MembersTab.timedOut(m);

    return h(
      'div',
      { class: 'card flush member-panel' },
      h(
        'div',
        { class: 'head', style: { position: 'relative' } },
        h('button', { class: 'icon-btn', style: { position: 'absolute', top: '10px', right: '10px' }, onclick: close, title: 'Close' }, icon('x')),
        h('img', { class: 'avatar', src: memberAvatar(ctx.guildId, m, 256), width: 84, height: 84, alt: '' }),
        h('h3', { style: { fontSize: '18px' } }, name),
        h('div', { class: 'subtle' }, `@${m.user.username}`),
        h(
          'div',
          { class: 'row wrap', style: { justifyContent: 'center', gap: '6px' } },
          m.user.bot ? h('span', { class: 'badge peri' }, 'BOT') : null,
          srv.guild.owner_id === m.user.id ? h('span', { class: 'badge gold' }, icon('crown'), 'Owner') : null,
          timedOut ? h('span', { class: 'badge coral' }, icon('clock'), `Timed out until ${new Date(m.communication_disabled_until).toLocaleString()}`) : null,
          m.pending ? h('span', { class: 'badge' }, 'Pending screening') : null,
        ),
      ),
      h(
        'div',
        { class: 'body' },
        h(
          'dl',
          { class: 'kv' },
          h('dt', null, 'User ID'),
          h('dd', null, h('span', { class: 'mono', style: { cursor: 'pointer' }, onclick: () => copyText(m.user.id, 'User ID copied') }, m.user.id)),
          h('dt', null, 'Joined server'),
          h('dd', null, m.joined_at ? `${fmtDate(m.joined_at)} (${fmtRelative(m.joined_at)})` : '—'),
          h('dt', null, 'Account created'),
          h('dd', null, fmtDate(snowflakeDate(m.user.id))),
          h('dt', null, 'Nickname'),
          h('dd', null, m.nick || '—'),
          m.premium_since ? [h('dt', null, 'Boosting since'), h('dd', null, fmtDate(m.premium_since))] : null,
        ),
        h(
          'div',
          null,
          h('div', { class: 'label', style: { marginBottom: '8px' } }, 'Roles — click to toggle'),
          h(
            'div',
            { class: 'row wrap', style: { gap: '6px' } },
            assignable.map((role) =>
              h(
                'span',
                { class: `chip toggle ${m.roles.includes(role.id) ? 'on' : ''}`, onclick: () => Mod.toggleRole(ctx, m, role) },
                h('span', { class: 'dot', style: { background: roleColor(role) } }),
                h('span', null, role.name),
              ),
            ),
            locked.map((role) => h('span', { class: 'chip', style: { opacity: 0.6 }, title: 'Above the bot — cannot change' }, icon('lock'), h('span', null, role.name))),
            !assignable.length && !locked.length ? h('span', { class: 'subtle' }, 'No roles the bot can assign.') : null,
          ),
        ),
        h(
          'div',
          { class: 'action-grid' },
          timedOut
            ? h('button', { class: 'btn', onclick: () => Mod.removeTimeout(ctx, m.user.id, name) }, icon('clock'), 'End timeout')
            : h('button', { class: 'btn', onclick: () => Mod.timeout(ctx, m.user.id, name) }, icon('clock'), 'Timeout'),
          h('button', { class: 'btn', onclick: () => Mod.nickname(ctx, m) }, icon('edit'), 'Nickname'),
          h('button', { class: 'btn', onclick: () => Mod.dm(ctx, m.user) }, icon('send'), 'Send DM'),
          h('button', { class: 'btn', onclick: () => copyText(`<@${m.user.id}>`, 'Mention copied') }, icon('copy'), 'Copy mention'),
          h('button', { class: 'btn danger', onclick: () => Mod.kick(ctx, m.user.id, name) }, icon('kick'), 'Kick'),
          h('button', { class: 'btn danger', onclick: () => Mod.ban(ctx, m.user.id, name) }, icon('ban'), 'Ban'),
        ),
      ),
    );
  },

  errorView(ctx) {
    const err = ctx.srv.membersError;
    const intent = err.code === 50001 || err.status === 403;
    return h(
      'div',
      { class: 'stack' },
      h(
        'div',
        { class: 'callout warn' },
        icon('alert'),
        h(
          'div',
          { class: 'grow' },
          intent
            ? [h('b', null, 'Server Members Intent is off. '), 'Discord only lets a bot list members when "Server Members Intent" is enabled for it in the Developer Portal (Bot tab). Turn it on, save, then reload.']
            : [h('b', null, 'Could not load members. '), err.message],
        ),
      ),
      h(
        'div',
        { class: 'row' },
        intent ? h('button', { class: 'btn teal', onclick: () => openExternal(`https://discord.com/developers/applications/${ctx.bot.appId || ctx.bot.id}/bot`) }, icon('external'), 'Open bot settings') : null,
        h('button', { class: 'btn', onclick: () => { ctx.srv.membersError = null; MembersTab.load(ctx); ctx.rerender(); } }, icon('refresh'), 'Try again'),
        h('button', { class: 'btn', onclick: () => MembersTab.lookup(ctx) }, icon('search'), 'Look up a member by ID instead'),
      ),
    );
  },

  async lookup(ctx) {
    const input = h('input', { class: 'input mono', placeholder: 'User ID, e.g. 123456789012345678' });
    await openModal({
      title: 'Look up member',
      body: [field('User ID', input, 'Right-click a user in Discord → Copy User ID (needs Developer Mode).')],
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        {
          label: 'Look up',
          kind: 'primary',
          icon: 'search',
          onClick: async () => {
            const id = input.value.trim();
            if (!isSnowflake(id)) {
              toast('That is not a valid user ID.', 'error');
              return false;
            }
            const member = await rest(ctx.botId, 'GET', `/guilds/${ctx.guildId}/members/${id}`);
            ctx.srv.lookups = { ...ctx.srv.lookups, [id]: member };
            if (ctx.srv.members && !ctx.srv.members.some((m) => m.user.id === id)) ctx.srv.members.unshift(member);
            if (!ctx.srv.members) {
              ctx.srv.members = [member];
              ctx.srv.membersError = null;
            }
            ctx.srv.selectedMemberId = id;
            ctx.view.tab = 'members';
            App.renderMain();
          },
        },
      ],
    });
  },
};

/* ======================= Moderation ======================= */
const ModerationTab = {
  async loadBans(ctx) {
    const { srv } = ctx;
    srv.bansLoading = true;
    try {
      srv.bans = await rest(ctx.botId, 'GET', `/guilds/${ctx.guildId}/bans`, { query: { limit: 1000 } });
      srv.bansError = null;
    } catch (err) {
      srv.bansError = err.message;
    }
    srv.bansLoading = false;
    ctx.rerender();
  },

  render(ctx, el) {
    const { srv } = ctx;
    if (!srv.bans && !srv.bansLoading && !srv.bansError) ModerationTab.loadBans(ctx);
    el.append(h('div', { class: 'split', style: { gridTemplateColumns: 'minmax(0,1fr) 380px' } }, ModerationTab.bansCard(ctx), h('div', { class: 'stack', style: { gap: '16px' } }, ModerationTab.quickCard(ctx), ModerationTab.pruneCard(ctx))));
  },

  bansCard(ctx) {
    const { srv } = ctx;
    const listHost = h('div', { class: 'list' });
    let query = '';
    const draw = () => {
      if (srv.bansError) return listHost.replaceChildren(h('div', { class: 'callout warn', style: { margin: '14px' } }, icon('alert'), h('div', null, srv.bansError)));
      if (!srv.bans) return listHost.replaceChildren(h('div', { class: 'loading-block', style: { padding: '14px' } }, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' })));
      const q = query.toLowerCase();
      const bans = srv.bans.filter((b) => !q || [b.user.username, b.user.global_name, b.user.id, b.reason].some((v) => v && v.toLowerCase().includes(q)));
      if (!bans.length) return listHost.replaceChildren(h('div', { class: 'empty' }, icon('shield'), h('h3', null, srv.bans.length ? 'No bans match' : 'No bans'), h('p', null, srv.bans.length ? '' : 'Nobody is banned from this server.')));
      listHost.replaceChildren(
        ...bans.slice(0, 300).map((b) =>
          h(
            'div',
            { class: 'list-row' },
            h('img', { class: 'avatar', src: userAvatar(b.user, 64), width: 36, height: 36, alt: '', loading: 'lazy' }),
            h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'primary ellipsis' }, displayName(b.user), h('span', { class: 'subtle', style: { fontWeight: 400 } }, `  @${b.user.username}`)), h('div', { class: 'secondary ellipsis' }, b.reason ? `Reason: ${b.reason}` : 'No reason given')),
            h('button', { class: 'btn sm', onclick: () => Mod.unban(ctx, b.user.id, displayName(b.user)) }, icon('unlock'), 'Unban'),
          ),
        ),
      );
    };
    draw();
    return h(
      'div',
      { class: 'card flush' },
      h(
        'div',
        { class: 'card-head', style: { padding: '16px 16px 0' } },
        icon('ban'),
        h('h3', null, `Bans${srv.bans ? ` (${srv.bans.length})` : ''}`),
        h('button', { class: 'btn sm', onclick: () => { srv.bans = null; ModerationTab.loadBans(ctx); ctx.rerender(); } }, icon('refresh'), 'Reload'),
      ),
      h('div', { style: { padding: '0 16px 12px' } }, searchBox('Search bans…', (q) => { query = q; draw(); })),
      h('div', { style: { borderTop: '1px solid var(--border)' } }, listHost),
    );
  },

  quickCard(ctx) {
    const input = h('input', { class: 'input mono', placeholder: 'User ID' });
    const withId = (fn) => () => {
      const id = input.value.trim();
      if (!isSnowflake(id)) return toast('Enter a valid user ID first.', 'error');
      fn(id);
    };
    return h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-head' }, icon('hammer'), h('h3', null, 'Quick actions by ID')),
      h(
        'div',
        { class: 'stack' },
        h('p', { class: 'muted', style: { fontSize: '13px' } }, 'Works even for people who already left (ban) or when the members list is unavailable.'),
        input,
        h(
          'div',
          { class: 'action-grid' },
          h('button', { class: 'btn danger', onclick: withId((id) => Mod.ban(ctx, id, id)) }, icon('ban'), 'Ban'),
          h('button', { class: 'btn danger', onclick: withId((id) => Mod.kick(ctx, id, id)) }, icon('kick'), 'Kick'),
          h('button', { class: 'btn', onclick: withId((id) => Mod.timeout(ctx, id, id)) }, icon('clock'), 'Timeout'),
          h('button', { class: 'btn', onclick: withId((id) => Mod.unban(ctx, id, id)) }, icon('unlock'), 'Unban'),
        ),
      ),
    );
  },

  pruneCard(ctx) {
    const days = selectEl([['1', '1 day'], ['7', '7 days'], ['14', '14 days'], ['30', '30 days']], '30');
    const result = h('div', { class: 'subtle', style: { fontSize: '12px' } }, 'Removes members without roles who have not been active for the chosen time.');
    const countBtn = h('button', { class: 'btn' }, icon('search'), 'Count');
    countBtn.addEventListener(
      'click',
      withBusy(countBtn, async () => {
        const res = await rest(ctx.botId, 'GET', `/guilds/${ctx.guildId}/prune`, { query: { days: days.value } });
        result.textContent = `${fmtNum(res.pruned)} member(s) would be removed.`;
      }),
    );
    const pruneBtn = h('button', { class: 'btn danger' }, icon('eraser'), 'Prune');
    pruneBtn.addEventListener(
      'click',
      withBusy(pruneBtn, async () => {
        if (!(await confirmDialog({ title: 'Prune inactive members?', message: `Members with no roles who were inactive for ${days.value} day(s) will be kicked.`, confirmLabel: 'Prune', danger: true }))) return;
        const res = await rest(ctx.botId, 'POST', `/guilds/${ctx.guildId}/prune`, { body: { days: Number(days.value), compute_prune_count: true }, reason: 'Pruned in Discord Server Builder' });
        result.textContent = `Pruned ${fmtNum(res.pruned)} member(s).`;
        ctx.srv.members = null;
        toast(`Pruned ${fmtNum(res.pruned)} member(s)`);
      }),
    );
    return h('div', { class: 'card' }, h('div', { class: 'card-head' }, icon('eraser'), h('h3', null, 'Prune inactive members')), h('div', { class: 'stack' }, days, result, h('div', { class: 'action-grid' }, countBtn, pruneBtn)));
  },
};

/* ======================= Channels ======================= */
const ChannelsTab = {
  overwrite(ctx, ch) {
    return (ch.permission_overwrites || []).find((o) => o.id === ctx.guildId);
  },
  isLocked(ctx, ch) {
    const ow = ChannelsTab.overwrite(ctx, ch);
    return !!ow && (BigInt(ow.deny) & (isVoice(ch.type) ? PERM.CONNECT : PERM.SEND_MESSAGES)) !== 0n;
  },
  isPrivate(ctx, ch) {
    const ow = ChannelsTab.overwrite(ctx, ch);
    return !!ow && (BigInt(ow.deny) & PERM.VIEW_CHANNEL) !== 0n;
  },

  groups(ctx) {
    const channels = ctx.srv.channels;
    const order = (a, b) => isVoice(a.type) - isVoice(b.type) || a.position - b.position;
    const groups = [{ category: null, channels: channels.filter((c) => c.type !== 4 && !c.parent_id).sort(order) }];
    for (const cat of channels.filter((c) => c.type === 4).sort((a, b) => a.position - b.position)) {
      groups.push({ category: cat, channels: channels.filter((c) => c.parent_id === cat.id).sort(order) });
    }
    return groups.filter((g) => g.category || g.channels.length);
  },

  render(ctx, el) {
    const { srv } = ctx;
    const selected = srv.channels.find((c) => c.id === srv.selectedChannelId);
    const select = (id) => {
      srv.selectedChannelId = id;
      ctx.rerender();
    };
    const reload = h('button', { class: 'btn sm' }, icon('refresh'), 'Reload');
    reload.addEventListener(
      'click',
      withBusy(reload, async () => {
        srv.channels = await rest(ctx.botId, 'GET', `/guilds/${ctx.guildId}/channels`);
        ctx.rerender();
      }),
    );

    const list = h(
      'div',
      { class: 'card flush', style: { paddingBottom: '8px' } },
      ChannelsTab.groups(ctx).map((group) =>
        h(
          'div',
          { class: 'channel-group' },
          group.category
            ? h(
                'div',
                { class: `channel-group-title ${srv.selectedChannelId === group.category.id ? 'selected' : ''}`, style: { cursor: 'pointer' }, onclick: () => select(group.category.id) },
                icon('chevronDown'),
                group.category.name,
                ChannelsTab.isPrivate(ctx, group.category) ? icon('eyeOff') : null,
              )
            : null,
          group.channels.map((ch) =>
            h(
              'div',
              { class: `channel-row ${srv.selectedChannelId === ch.id ? 'selected' : ''}`, onclick: () => select(ch.id) },
              icon(CHANNEL_ICON[ch.type] || 'hash', 'type'),
              h('span', { class: 'ellipsis' }, ch.name),
              h(
                'span',
                { class: 'badges' },
                ChannelsTab.isLocked(ctx, ch) ? h('span', { class: 'badge coral' }, icon('lock'), 'Locked') : null,
                ChannelsTab.isPrivate(ctx, ch) ? h('span', { class: 'badge peri' }, icon('eyeOff'), 'Private') : null,
                ch.rate_limit_per_user ? h('span', { class: 'badge' }, icon('clock'), `${ch.rate_limit_per_user}s`) : null,
                ch.nsfw ? h('span', { class: 'badge coral' }, '18+') : null,
              ),
            ),
          ),
        ),
      ),
    );

    el.append(
      h(
        'div',
        { class: 'toolbar' },
        h('span', { class: 'muted' }, `${srv.channels.filter((c) => c.type !== 4).length} channels in ${srv.channels.filter((c) => c.type === 4).length} categories`),
        h('div', { class: 'grow' }),
        h('button', { class: 'btn sm teal', onclick: () => ChannelsTab.create(ctx) }, icon('plus'), 'New channel'),
        reload,
      ),
      h(
        'div',
        { class: 'split', style: { gridTemplateColumns: 'minmax(0,1fr) 400px' } },
        list,
        h(
          'div',
          { class: 'sticky' },
          selected
            ? ChannelsTab.panel(ctx, selected)
            : h('div', { class: 'card empty' }, icon('hash'), h('h3', null, 'Pick a channel'), h('p', null, 'Send messages, purge, lock, set slowmode, rename or delete.')),
        ),
      ),
    );
  },

  replaceChannel(ctx, channel) {
    ctx.srv.channels = ctx.srv.channels.map((c) => (c.id === channel.id ? channel : c));
  },

  panel(ctx, ch) {
    const textLike = [0, 5].includes(ch.type);
    const purgeable = [0, 2, 5, 13].includes(ch.type);
    const locked = ChannelsTab.isLocked(ctx, ch);
    const reason = 'Discord Server Builder';
    const sections = [];

    if (textLike) {
      const msg = h('textarea', { class: 'textarea', placeholder: `Message #${ch.name}`, maxlength: 2000 });
      const sendBtn = h('button', { class: 'btn primary' }, icon('send'), 'Send');
      sendBtn.addEventListener(
        'click',
        withBusy(sendBtn, async () => {
          if (!msg.value.trim()) return;
          await rest(ctx.botId, 'POST', `/channels/${ch.id}/messages`, { body: { content: msg.value } });
          msg.value = '';
          toast(`Sent to #${ch.name}`);
        }),
      );
      sections.push(h('div', { class: 'stack', style: { gap: '8px' } }, h('div', { class: 'label' }, 'Send a message as the bot'), msg, h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, sendBtn)));
    }

    if (purgeable) {
      const count = h('input', { class: 'input', type: 'number', min: 1, max: 1000, value: '50', style: { width: '110px' } });
      const purgeBtn = h('button', { class: 'btn danger' }, icon('eraser'), 'Purge');
      purgeBtn.addEventListener(
        'click',
        withBusy(purgeBtn, async () => {
          const n = Math.min(1000, Math.max(1, Number(count.value) || 0));
          if (!(await confirmDialog({ title: `Purge ${n} messages?`, message: `Deletes the latest ${n} messages in #${ch.name}. Pinned messages and anything older than 14 days are skipped.`, confirmLabel: 'Purge', danger: true }))) return;
          const res = await api('channel:purge', ctx.botId, ch.id, n, reason);
          toast(`Deleted ${res.deleted} message(s)${res.skipped ? `, skipped ${res.skipped}` : ''}`);
        }),
      );
      sections.push(h('div', { class: 'stack', style: { gap: '8px' } }, h('div', { class: 'label' }, 'Purge recent messages'), h('div', { class: 'row' }, count, h('span', { class: 'subtle grow', style: { fontSize: '12px' } }, 'max 1000'), purgeBtn)));
    }

    if (ch.type !== 4) {
      const lockBtn = h('button', { class: `btn ${locked ? 'teal' : ''}` }, icon(locked ? 'unlock' : 'lock'), locked ? 'Unlock channel' : 'Lock channel');
      lockBtn.addEventListener(
        'click',
        withBusy(lockBtn, async () => {
          ChannelsTab.replaceChannel(ctx, await api('channel:lock', ctx.botId, ctx.guildId, ch.id, !locked, reason));
          toast(locked ? `Unlocked #${ch.name}` : `Locked #${ch.name}`);
          ctx.rerender();
        }),
      );
      const row = [h('div', { class: 'grow' }, h('div', { class: 'label' }, 'Lock'), h('div', { class: 'subtle', style: { fontSize: '12px' } }, isVoice(ch.type) ? 'Stops @everyone joining.' : 'Stops @everyone sending messages.')), lockBtn];
      sections.push(h('div', { class: 'row' }, row));
    }

    if ([0, 15].includes(ch.type)) {
      const slow = selectEl(SLOWMODE_OPTIONS, String(ch.rate_limit_per_user || 0), async (value) => {
        try {
          ChannelsTab.replaceChannel(ctx, await rest(ctx.botId, 'PATCH', `/channels/${ch.id}`, { body: { rate_limit_per_user: Number(value) }, reason }));
          toast(Number(value) ? `Slowmode set to ${value}s` : 'Slowmode off');
          ctx.rerender();
        } catch (err) {
          toastError(err);
        }
      });
      sections.push(h('div', { class: 'row' }, h('div', { class: 'grow label' }, 'Slowmode'), h('div', { style: { width: '120px' } }, slow)));
    }

    const nameInput = h('input', { class: 'input', value: ch.name, maxlength: 100 });
    const topicInput = !isVoice(ch.type) && ch.type !== 4 ? h('input', { class: 'input', value: ch.topic || '', placeholder: 'Topic', maxlength: 1024 }) : null;
    const saveBtn = h('button', { class: 'btn' }, icon('save'), 'Save');
    saveBtn.addEventListener(
      'click',
      withBusy(saveBtn, async () => {
        const body = { name: nameInput.value.trim() };
        if (topicInput) body.topic = topicInput.value;
        ChannelsTab.replaceChannel(ctx, await rest(ctx.botId, 'PATCH', `/channels/${ch.id}`, { body, reason }));
        toast('Channel updated');
        ctx.rerender();
      }),
    );
    sections.push(h('div', { class: 'stack', style: { gap: '8px' } }, h('div', { class: 'label' }, 'Edit'), nameInput, topicInput, h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, saveBtn)));

    const deleteBtn = h('button', { class: 'btn danger' }, icon('trash'), `Delete ${ch.type === 4 ? 'category' : 'channel'}`);
    deleteBtn.addEventListener(
      'click',
      withBusy(deleteBtn, async () => {
        if (!(await confirmDialog({ title: `Delete ${ch.name}?`, message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true }))) return;
        await rest(ctx.botId, 'DELETE', `/channels/${ch.id}`, { reason });
        ctx.srv.channels = ctx.srv.channels.filter((c) => c.id !== ch.id);
        ctx.srv.selectedChannelId = null;
        toast(`Deleted ${ch.name}`);
        ctx.rerender();
      }),
    );
    sections.push(h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, deleteBtn));

    return h(
      'div',
      { class: 'card' },
      h(
        'div',
        { class: 'card-head' },
        icon(CHANNEL_ICON[ch.type] || 'hash'),
        h('h3', { class: 'ellipsis' }, ch.name),
        h('span', { class: 'badge' }, CHANNEL_LABEL[ch.type] || 'Channel'),
      ),
      h('div', { class: 'row', style: { marginTop: '-6px', marginBottom: '14px' } }, h('span', { class: 'mono subtle', style: { cursor: 'pointer' }, onclick: () => copyText(ch.id, 'Channel ID copied') }, ch.id)),
      h('div', { class: 'stack', style: { gap: '18px' } }, sections.flatMap((s, i) => (i ? [h('div', { style: { height: '1px', background: 'var(--border)' } }), s] : [s]))),
    );
  },

  async create(ctx) {
    const name = h('input', { class: 'input', placeholder: 'new-channel', maxlength: 100 });
    // Discord rejects Announcement and Stage channels unless the server has Community enabled.
    const community = ctx.srv.guild.features?.includes('COMMUNITY');
    const typeOptions = [['0', '# Text'], ['2', '🔊 Voice'], ['15', '💬 Forum'], ['4', '📁 Category'], ['5', '📢 Announcement'], ['13', '🎙️ Stage']];
    const type = h(
      'select',
      { class: 'select' },
      typeOptions.map(([value, label]) => {
        const locked = !community && (value === '5' || value === '13');
        return h('option', { value, disabled: locked }, locked ? `${label} (Community only)` : label);
      }),
    );
    type.value = '0';
    const parent = selectEl([['', 'No category'], ...ctx.srv.channels.filter((c) => c.type === 4).sort((a, b) => a.position - b.position).map((c) => [c.id, c.name])], '');
    await openModal({
      title: 'New channel',
      body: [
        field('Name', name),
        h('div', { class: 'grid cols-2', style: { gap: '12px' } }, field('Type', type), field('Category', parent)),
        community ? null : h('p', { class: 'subtle', style: { fontSize: '12px' } }, 'Announcement and Stage channels need Community turned on (Server Settings → Enable Community in Discord).'),
      ],
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        {
          label: 'Create',
          kind: 'primary',
          icon: 'plus',
          onClick: async () => {
            if (!name.value.trim()) return false;
            const body = { name: name.value.trim(), type: Number(type.value) };
            if (parent.value && body.type !== 4) body.parent_id = parent.value;
            const ch = await rest(ctx.botId, 'POST', `/guilds/${ctx.guildId}/channels`, { body, reason: 'Created in Discord Server Builder' });
            ctx.srv.channels.push(ch);
            ctx.srv.selectedChannelId = ch.id;
            toast(`Created ${ch.name}`);
            ctx.rerender();
          },
        },
      ],
    });
  },
};

/* ======================= Audit log ======================= */
const AUDIT_ACTIONS = {
  1: 'updated the server', 10: 'created channel', 11: 'updated channel', 12: 'deleted channel',
  13: 'added a permission to', 14: 'changed permissions on', 15: 'removed a permission from',
  20: 'kicked', 21: 'pruned members', 22: 'banned', 23: 'unbanned', 24: 'updated member', 25: 'changed roles of',
  26: 'moved members', 27: 'disconnected', 28: 'added bot', 30: 'created role', 31: 'updated role', 32: 'deleted role',
  40: 'created an invite', 41: 'updated an invite', 42: 'deleted an invite', 50: 'created webhook', 51: 'updated webhook', 52: 'deleted webhook',
  60: 'added emoji', 61: 'updated emoji', 62: 'deleted emoji', 72: 'deleted a message from', 73: 'bulk deleted messages in',
  74: 'pinned a message in', 75: 'unpinned a message in', 80: 'added integration', 81: 'updated integration', 82: 'removed integration',
  83: 'started a stage in', 84: 'updated a stage in', 85: 'ended a stage in', 90: 'added sticker', 91: 'updated sticker', 92: 'deleted sticker',
  100: 'created event', 101: 'updated event', 102: 'cancelled event', 110: 'created thread', 111: 'updated thread', 112: 'deleted thread',
  121: 'updated command permissions', 140: 'created AutoMod rule', 141: 'updated AutoMod rule', 142: 'deleted AutoMod rule',
  143: 'AutoMod blocked a message from', 144: 'AutoMod flagged a message from', 145: 'AutoMod timed out',
};
const AUDIT_FILTERS = [
  ['', 'All actions'],
  ['moderation', 'Kicks, bans & timeouts'],
  ['channels', 'Channels'],
  ['roles', 'Roles'],
  ['messages', 'Messages'],
];
const AUDIT_GROUPS = {
  moderation: [20, 21, 22, 23, 24, 25, 27, 145],
  channels: [10, 11, 12, 13, 14, 15],
  roles: [30, 31, 32, 25],
  messages: [72, 73, 74, 75, 143, 144],
};

const AuditTab = {
  async load(ctx, before) {
    const { srv } = ctx;
    srv.auditLoading = true;
    try {
      const res = await rest(ctx.botId, 'GET', `/guilds/${ctx.guildId}/audit-logs`, { query: { limit: 100, before } });
      const users = Object.fromEntries((res.users || []).map((u) => [u.id, u]));
      srv.audit = {
        entries: [...(before ? srv.audit.entries : []), ...res.audit_log_entries],
        users: { ...(before ? srv.audit.users : {}), ...users },
        more: res.audit_log_entries.length === 100,
      };
      srv.auditError = null;
    } catch (err) {
      srv.auditError = err.message;
    }
    srv.auditLoading = false;
    ctx.rerender();
  },

  render(ctx, el) {
    const { srv } = ctx;
    if (!srv.audit && !srv.auditLoading && !srv.auditError) AuditTab.load(ctx);
    srv.auditFilter ??= '';
    const reload = h('button', { class: 'btn sm' }, icon('refresh'), 'Reload');
    reload.addEventListener('click', () => {
      srv.audit = null;
      AuditTab.load(ctx);
      ctx.rerender();
    });
    el.append(
      h(
        'div',
        { class: 'toolbar' },
        h('div', { style: { width: '240px' } }, selectEl(AUDIT_FILTERS, srv.auditFilter, (v) => { srv.auditFilter = v; ctx.rerender(); })),
        h('div', { class: 'grow' }),
        reload,
      ),
    );
    if (srv.auditError) return el.append(h('div', { class: 'callout warn' }, icon('alert'), h('div', null, h('b', null, 'Could not load the audit log. '), srv.auditError, ' The bot needs the View Audit Log permission.')));
    if (!srv.audit) return el.append(h('div', { class: 'loading-block' }, [1, 2, 3, 4, 5].map(() => h('div', { class: 'skeleton' }))));

    const group = AUDIT_GROUPS[srv.auditFilter];
    const entries = srv.audit.entries.filter((e) => !group || group.includes(e.action_type));
    el.append(
      h(
        'div',
        { class: 'card flush' },
        entries.length
          ? h('div', { class: 'list' }, entries.map((e) => AuditTab.row(ctx, e)))
          : h('div', { class: 'empty' }, icon('list'), h('h3', null, 'Nothing here yet')),
        srv.audit.more
          ? h('div', { class: 'more-row' }, h('button', { class: 'btn sm', disabled: srv.auditLoading, onclick: () => AuditTab.load(ctx, srv.audit.entries[srv.audit.entries.length - 1].id) }, 'Load older entries'))
          : null,
      ),
    );
  },

  targetName(ctx, e) {
    const { srv } = ctx;
    const changedName = e.changes?.find((c) => c.key === 'name');
    const fallback = changedName?.new_value || changedName?.old_value;
    const t = e.action_type;
    if ([20, 22, 23, 24, 25, 27, 28, 72, 143, 144, 145].includes(t)) {
      const user = srv.audit.users[e.target_id];
      return user ? `${displayName(user)}` : e.target_id;
    }
    if ((t >= 10 && t <= 15) || [73, 74, 75, 83, 84, 85].includes(t)) {
      const id = t >= 72 ? e.options?.channel_id || e.target_id : e.target_id;
      const ch = srv.channels.find((c) => c.id === id);
      return ch ? `#${ch.name}` : fallback ? `#${fallback}` : '';
    }
    if (t >= 30 && t <= 32) {
      const role = srv.roles.find((r) => r.id === e.target_id);
      return role ? `@${role.name}` : fallback ? `@${fallback}` : '';
    }
    return fallback || '';
  },

  row(ctx, e) {
    const executor = ctx.srv.audit.users[e.user_id];
    const t = e.action_type;
    const coral = [12, 20, 21, 22, 27, 32, 72, 73, 143, 144, 145].includes(t);
    const teal = [10, 23, 28, 30, 40].includes(t);
    const ic = { 20: 'kick', 22: 'ban', 23: 'unlock', 72: 'eraser', 73: 'eraser', 145: 'clock', 24: 'users', 25: 'tag', 30: 'tag', 31: 'tag', 32: 'tag', 40: 'link', 41: 'link', 42: 'link' }[t] || (t >= 10 && t <= 15 ? 'hash' : 'list');
    let action = AUDIT_ACTIONS[t] || `action #${t}`;
    if (t === 24 && e.changes?.some((c) => c.key === 'communication_disabled_until')) {
      action = e.changes.find((c) => c.key === 'communication_disabled_until').new_value ? 'timed out' : 'removed timeout from';
    }
    const when = snowflakeDate(e.id);
    return h(
      'div',
      { class: 'list-row audit-row' },
      h('div', { class: `icon ${coral ? 'coral' : teal ? 'teal' : ''}` }, icon(ic)),
      h(
        'div',
        { class: 'grow', style: { minWidth: 0 } },
        h('div', { class: 'ellipsis' }, h('b', null, executor ? displayName(executor) : 'Someone'), ` ${action} `, h('b', null, AuditTab.targetName(ctx, e))),
        e.reason ? h('div', { class: 'secondary ellipsis' }, `Reason: ${e.reason}`) : null,
      ),
      h('span', { class: 'subtle', style: { fontSize: '12px', whiteSpace: 'nowrap' }, title: when.toLocaleString() }, fmtRelative(when)),
    );
  },
};
