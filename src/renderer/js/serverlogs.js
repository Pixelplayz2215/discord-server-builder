// Server logs settings, shown at the top of the Logs tab for owners: which events the bot posts to a
// log channel while the app runs (it can stay in the tray to log around the clock).

const LOG_EVENTS = [
  ['members', 'Joins and leaves', 'New accounts are flagged.', 'members'],
  ['moderation', 'Bans, timeouts, and nickname and role changes', null, null],
  ['messages', 'Deleted and edited messages', 'Shows what the message said.', 'content'],
  ['server', 'Channels and roles created, deleted or renamed', null, null],
];

const ServerLogs = {
  async load(ctx) {
    const { srv } = ctx;
    srv.logsLoading = true;
    try {
      srv.logs = await api('logs:get', ctx.botId, ctx.guildId);
      srv.logsError = null;
    } catch (err) {
      srv.logsError = err.message;
    }
    srv.logsLoading = false;
    ctx.rerender();
  },

  async save(ctx, patch) {
    const { srv } = ctx;
    const next = { ...srv.logs.config, ...patch, events: { ...srv.logs.config.events, ...patch.events } };
    try {
      srv.logs = await api('logs:set', ctx.botId, ctx.guildId, next);
    } catch (err) {
      toastError(err);
    }
    ctx.rerender();
  },

  card(ctx) {
    const { srv } = ctx;
    if (!srv.logs && !srv.logsLoading && !srv.logsError) ServerLogs.load(ctx);
    const head = h('div', { class: 'card-head' }, icon('list'), h('h3', null, 'Server logs'), srv.logs?.config.enabled ? h('span', { class: 'badge teal' }, 'On') : h('span', { class: 'badge' }, 'Off'));
    if (srv.logsError) return h('div', { class: 'card' }, head, h('div', { class: 'callout warn' }, icon('alert'), h('div', null, srv.logsError)));
    if (!srv.logs) return h('div', { class: 'card' }, head, h('div', { class: 'skeleton' }));

    const { config, intents, connection, lastError } = srv.logs;
    const textChannels = srv.channels.filter((c) => c.type === 0).sort((a, b) => a.position - b.position);
    const channelPick = selectEl([['', 'Pick a channel…'], ...textChannels.map((c) => [c.id, `#${c.name}`])], config.channelId || '', (v) => ServerLogs.save(ctx, { channelId: v || null }));
    const createBtn = h('button', { class: 'btn sm' }, icon('plus'), 'Create #server-logs');
    createBtn.addEventListener(
      'click',
      withBusy(createBtn, async () => {
        const channel = await api('logs:createChannel', ctx.botId, ctx.guildId);
        srv.channels = [...srv.channels, channel];
        toast('Created #server-logs (only mods can see it)');
        await ServerLogs.save(ctx, { channelId: channel.id });
      }),
    );
    const testBtn = h('button', { class: 'btn sm', disabled: !config.channelId }, icon('send'), 'Send a test message');
    testBtn.addEventListener(
      'click',
      withBusy(testBtn, async () => {
        await api('logs:test', ctx.botId, ctx.guildId);
        toast('Test message sent');
      }),
    );

    const missing = [];
    if (!intents.members && (config.events.members || config.events.moderation)) missing.push(['Server Members Intent', 'joins, leaves and member changes']);
    if (!intents.content && config.events.messages) missing.push(['Message Content Intent', 'the text of deleted and edited messages']);

    const live = { online: 'Connected', invisible: 'Connected (bot shown as offline)', connecting: 'Connecting…', error: connection.detail || 'Connection problem', offline: 'Not connected' }[connection.state] || connection.state;

    return h(
      'div',
      { class: 'card', style: { marginBottom: '18px' } },
      head,
      h(
        'div',
        { class: 'stack' },
        h('p', { class: 'muted', style: { fontSize: 'calc(13rem / 14)' } }, 'The bot posts what happens in this server to a log channel while this app is running. With the close button set to keep the app in the tray, it logs around the clock.'),
        switchEl(config.enabled, (v) => ServerLogs.save(ctx, { enabled: v }), 'Log this server'),
        h('div', { class: 'row wrap' }, h('div', { style: { width: '260px' } }, channelPick), createBtn, testBtn),
        h(
          'div',
          { class: 'grid cols-2', style: { gap: '10px' } },
          LOG_EVENTS.map(([key, label, hint]) =>
            h('div', null, switchEl(config.events[key], (v) => ServerLogs.save(ctx, { events: { [key]: v } }), label), hint ? h('div', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)', marginLeft: '48px' } }, hint) : null),
          ),
        ),
        missing.length
          ? h(
              'div',
              { class: 'callout warn' },
              icon('alert'),
              h(
                'div',
                { class: 'grow' },
                missing.map(([intent, what]) => h('div', null, h('b', null, `${intent} is off, `), `so ${what} can't be logged.`)),
                h('div', { class: 'subtle', style: { marginTop: '4px' } }, 'Turn it on in the Developer Portal (Bot tab), then press Refresh on the bot\'s page.'),
              ),
              h('button', { class: 'btn sm', onclick: () => openExternal(`https://discord.com/developers/applications/${ctx.bot.appId || ctx.bot.id}/bot`) }, icon('external'), 'Open bot settings'),
            )
          : null,
        config.enabled
          ? h('div', { class: 'stat-line' }, h('span', { class: `badge ${['online', 'invisible'].includes(connection.state) ? 'teal' : 'coral'}` }, live), lastError ? h('span', { class: 'badge coral', title: lastError }, `Last post failed: ${lastError}`) : null)
          : null,
      ),
    );
  },
};
