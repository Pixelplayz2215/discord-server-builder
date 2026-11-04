// Auto roles page: roles new members (and bots) get when they join, and a Verify button that gives
// roles. Given by the main process (src/main/autoroles.js) while the app runs; the Verify button is
// answered by the mod portal when slash commands are on.

const AUTO_ROLE_DELAYS = [['0', 'Right away'], ['60', 'After 1 minute'], ['300', 'After 5 minutes'], ['600', 'After 10 minutes'], ['1800', 'After 30 minutes'], ['3600', 'After 1 hour']];
const AUTO_ROLE_MAX = 4;
const VERIFY_STYLES = [['success', 'Green', '#248046'], ['primary', 'Blurple', '#5865f2'], ['secondary', 'Grey', '#4e5058'], ['danger', 'Red', '#da373c']];

// Role chips to pick up to `max` roles. Roles above the bot's own can't be given, so they're greyed out.
// setRoles(list, botTop) shows a server's roles once they're loaded.
function roleChips(selected, onChange, { max = AUTO_ROLE_MAX } = {}) {
  const host = h('div', { class: 'ticket-roles' });
  let roles = [];
  let botTop = Infinity;
  const draw = () => {
    host.replaceChildren(
      ...(roles.length
        ? roles.map((r) => {
            const on = selected.includes(r.id);
            const tooHigh = r.position >= botTop;
            const full = !on && selected.length >= max;
            return h(
              'button',
              { type: 'button', class: `chip ticket-role ${on ? 'on' : ''}`, disabled: tooHigh || full, title: tooHigh ? "Above the bot's own role, so it can't give it" : full ? `Up to ${max} roles` : '', onclick: () => { selected = on ? selected.filter((x) => x !== r.id) : [...selected, r.id]; onChange(selected); draw(); } },
              on ? icon('check') : h('span', { class: 'role-dot', style: { background: roleColor(r) } }),
              `@${r.name}`,
              tooHigh ? h('span', { class: 'subtle' }, ' (above the bot)') : null,
            );
          })
        : [h('span', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)' } }, 'Pick a server first')]),
    );
  };
  draw();
  return {
    el: host,
    setRoles(list, top) {
      roles = list;
      botTop = top;
      // Roles that no longer exist (or are above the bot now) are dropped from the choice.
      if (list.length) {
        selected = selected.filter((id) => list.some((r) => r.id === id && r.position < top));
        onChange(selected);
      }
      draw();
    },
  };
}

const AutoRolesPage = {
  data: null,
  error: null,
  loading: false,
  progress: {}, // `${botId}:${guildId}` -> 'done/total'
  lockProgress: {}, // `${botId}:${guildId}` -> what locking is doing now

  async load() {
    AutoRolesPage.loading = true;
    try {
      AutoRolesPage.data = await api('autoroles:list');
      AutoRolesPage.error = null;
    } catch (err) {
      AutoRolesPage.error = err.message;
    }
    AutoRolesPage.loading = false;
    AutoRolesPage.rerender();
  },

  rerender() {
    if (App.route.page !== 'autoroles') return;
    const scroll = document.getElementById('autoroles-page')?.scrollTop || 0;
    App.renderPage();
    const page = document.getElementById('autoroles-page');
    if (page) page.scrollTop = scroll;
  },

  render() {
    const page = AutoRolesPage;
    if (!page.data && !page.loading && !page.error) page.load();
    const owners = App.bots.filter((b) => b.type !== 'mod');
    const list = page.data || [];
    let content;
    if (page.error) content = h('div', { class: 'callout warn' }, icon('alert'), h('div', null, page.error));
    else if (!owners.length) content = h('div', { class: 'card' }, h('div', { class: 'empty' }, icon('bot'), h('h3', null, 'Connect a bot first'), h('p', null, 'Your bot gives the roles. Add one with its token on the Home page.')));
    else if (!page.data) content = h('div', { class: 'loading-block' }, [1, 2].map(() => h('div', { class: 'skeleton' })));
    else if (!list.length) {
      content = h('div', { class: 'card' }, h('div', { class: 'empty' }, icon('userPlus'), h('h3', null, 'No auto roles yet'), h('p', null, 'Give every new member a role like "Member" when they join, and optionally add a Verify button members press to get access.'), h('button', { class: 'btn primary', onclick: () => page.edit(null) }, icon('plus'), 'Set up a server')));
    } else content = h('div', { class: 'stack', style: { gap: '14px' } }, list.map((s) => page.serverCard(s)));

    return h(
      'div',
      { class: 'settings', id: 'autoroles-page' },
      h(
        'div',
        { class: 'settings-inner' },
        h(
          'div',
          { class: 'settings-head' },
          h(
            'div',
            { class: 'grow' },
            h('span', { class: 'eyebrow' }, 'Community'),
            h('h1', null, 'Auto roles'),
            h('p', { class: 'muted', style: { marginTop: '6px' } }, 'Roles every new member gets when they join, and a Verify button that gives roles when pressed. Joins are handled while this app is open or in the tray.'),
          ),
          h('button', { class: 'btn primary', disabled: !owners.length || !page.data, onclick: () => page.edit(null) }, icon('plus'), 'Set up a server'),
        ),
        content,
      ),
    );
  },

  serverCard(s) {
    const bot = App.bot(s.botId);
    const roleNames = (ids) => ids.map((id) => s.roleNames?.[id] || 'a role').map((n) => `@${n}`).join(', ');
    const key = `${s.botId}:${s.guildId}`;
    const existing = h('button', { class: 'btn sm', disabled: !s.enabled, 'data-progress': key }, icon('users'), AutoRolesPage.progress[key] ? `Giving… ${AutoRolesPage.progress[key]}` : 'Give to existing members');
    existing.addEventListener('click', withBusy(existing, async () => {
      if (!(await confirmDialog({ title: 'Give the roles to existing members?', message: `Everyone in ${s.guildName || 'the server'} who doesn't have them yet gets them now. On a big server this takes a while; you can keep using the app.`, confirmLabel: 'Give roles' }))) return;
      try {
        const res = await api('autoroles:giveExisting', s.botId, s.guildId);
        toast(res.given ? `Gave the roles to ${res.given} member${res.given === 1 ? '' : 's'}` : `Everyone already has them (checked ${res.checked} members)`);
      } finally {
        delete AutoRolesPage.progress[key];
        AutoRolesPage.load();
      }
    }));
    // Locking the server behind the Verify button, or unlocking it again.
    const lockBtn = h('button', { class: 'btn sm', 'data-lock': key }, icon(s.lock ? 'unlock' : 'lock'), AutoRolesPage.lockProgress[key] || (s.lock ? 'Unlock' : 'Lock behind Verify…'));
    lockBtn.addEventListener('click', withBusy(lockBtn, async () => {
      try {
        if (s.lock) {
          if (!(await confirmDialog({ title: `Unlock ${s.guildName || 'the server'}?`, message: '@everyone sees the channels it could before it was locked, and the permission changes are put back. Members keep their verified role.', confirmLabel: 'Unlock' }))) return;
          AutoRolesPage.data = await api('verifylock:unlock', s.botId, s.guildId);
          toast('Unlocked: @everyone sees the channels again');
        } else {
          const options = await AutoRolesPage.lockDialog(s);
          if (!options) return;
          AutoRolesPage.data = await api('verifylock:lock', s.botId, s.guildId, options);
          toast('Locked: new members see only the Verify channel until they verify');
        }
      } finally {
        delete AutoRolesPage.lockProgress[key];
        AutoRolesPage.load();
      }
    }));
    const line = (ic, label, value) => h('div', { class: 'ticket-line' }, icon(ic), h('span', { class: 'subtle' }, label), h('span', { class: 'ellipsis' }, value));
    const delay = AUTO_ROLE_DELAYS.find(([v]) => Number(v) === s.delay)?.[1].toLowerCase() || 'right away';
    return h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-head' }, icon('userPlus'), h('h3', { class: 'grow ellipsis' }, s.guildName || 'A server'), h('span', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)' } }, `via ${bot ? displayName(bot) : 'a removed bot'}`)),
      s.enabled && !s.membersIntent
        ? h('div', { class: 'callout warn', style: { marginBottom: '12px' } }, icon('alert'), h('div', null, h('b', null, 'Turn on the Server Members Intent. '), "Without it Discord doesn't tell the bot when members join. In the Developer Portal, open your bot → Bot → Privileged Gateway Intents, turn on Server Members Intent and save."))
        : null,
      h(
        'div',
        { class: 'stack', style: { gap: '6px' } },
        line('userPlus', 'New members get', s.enabled && s.roles.length ? `${roleNames(s.roles)}, ${delay}` : 'Nothing'),
        line('bot', 'New bots get', s.enabled && s.botRoles.length ? roleNames(s.botRoles) : 'Nothing'),
        line('check', 'Verify button', s.verify.enabled ? `In #${s.verify.channelName || s.verify.channelId}, gives ${roleNames(s.verify.roles)}` : 'Off'),
        s.verify.enabled ? line('lock', 'Server', s.lock ? `Locked behind Verify ${fmtRelative(s.lock.at)}${s.lock.partial ? ' (only part way: press Unlock to put it back)' : ''}` : 'Open to everyone') : null,
      ),
      s.verify.enabled ? h('div', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)', marginTop: '8px' } }, s.answeredBy === 'portal' ? 'The Verify button is answered around the clock by your mod portal.' : 'The Verify button is answered while this app runs. Turn on slash commands on the Home page to have your portal answer it around the clock.') : null,
      s.problem ? h('div', { class: 'callout warn', style: { marginTop: '10px' } }, icon('alert'), h('div', null, s.problem)) : null,
      h(
        'div',
        { class: 'row wrap', style: { marginTop: '14px' } },
        existing,
        s.verify.enabled ? lockBtn : null,
        h('button', { class: 'btn sm', onclick: () => AutoRolesPage.edit(s) }, icon('edit'), 'Edit'),
        s.verify.messageId ? h('button', { class: 'btn sm ghost', onclick: () => openExternal(`https://discord.com/channels/${s.guildId}/${s.verify.channelId}/${s.verify.messageId}`) }, icon('external'), 'Open Verify message') : null,
        h('div', { class: 'grow' }),
        h('button', { class: 'btn sm danger', onclick: () => AutoRolesPage.remove(s) }, icon('trash'), 'Remove'),
      ),
    );
  },

  // Shows what locking the server behind its Verify button would change, with the choices.
  // Resolves to the options to lock with, or null.
  async lockDialog(s) {
    const options = { giveExisting: true, hideVerify: false, openChannelIds: [] };
    const summary = h('div', { class: 'stack', style: { gap: '8px' } }, h('div', { class: 'loading-block' }, h('div', { class: 'skeleton' })));
    const openList = h('div', { class: 'verify-open-list' });
    let plan = null;
    let lockButton = null;
    let asked = 0; // only the newest answer is shown when boxes are ticked quickly
    const names = (list, max = 6) => (list.length > max ? `${list.slice(0, max).join(', ')} and ${list.length - max} more` : list.join(', '));

    // The server is read when the window opens; after that, ticking a box only works out the changes again.
    async function refresh({ fresh = false } = {}) {
      const mine = ++asked;
      summary.classList.add('updating');
      let next;
      try {
        next = await api('verifylock:plan', s.botId, s.guildId, { ...options, fresh });
      } catch (err) {
        if (mine !== asked) return;
        plan = null;
        if (lockButton) lockButton.disabled = true;
        summary.classList.remove('updating');
        summary.replaceChildren(h('div', { class: 'callout warn' }, icon('alert'), h('div', null, err.message)));
        return;
      }
      if (mine !== asked) return;
      plan = next;
      summary.classList.remove('updating');
      if (lockButton) lockButton.disabled = false;
      if (!openList.childElementCount) drawOpenList();
      const verified = names(plan.verifiedRoles.map((r) => `@${r.name}`));
      // Voice and stage channels go without the #, as in Discord.
      const open = [`#${plan.verifyChannelName}`, ...plan.openChannels.map((c) => (c.type === 2 || c.type === 13 ? `🔊 ${c.name}` : `#${c.name}`))];
      const openIds = new Set([plan.verifyChannelId, ...plan.openChannels.map((c) => c.id)]);
      const byName = plan.channels.filter((c) => !openIds.has(c.id)).map((c) => `#${c.name}`);
      const bots = plan.roles.filter((r) => r.bot).map((r) => r.name);
      const item = (ic, text) => h('div', { class: 'ticket-line verify-plan-line' }, icon(ic), h('span', null, text));
      summary.replaceChildren(
        ...[
          item('eyeOff', plan.alreadyHidden ? `@everyone already can't see channels unless a channel lets it in. ${names(open)} will let everyone in.` : `@everyone stops seeing your channels, except ${names(open, 12)}.`),
          item('eye', `${verified} ${plan.verifiedRoles.length === 1 ? 'sees' : 'see'} everything @everyone could see before${plan.roles.some((r) => !r.bot) ? ' (gets View Channels)' : ''}.`),
          options.hideVerify ? item('check', `#${plan.verifyChannelName} disappears for members once they verify.`) : item('eye', `#${plan.verifyChannelName}, where the Verify button is, stays visible to everyone, verified members included.`),
          byName.length ? item('hash', `${byName.length} ${byName.length === 1 ? 'channel lets' : 'channels let'} @everyone in by name. ${byName.length === 1 ? 'It lets' : 'They let'} ${verified} in instead: ${names(byName)}.`) : null,
          bots.length ? item('bot', `These bots get View Channels on their own role, so they keep seeing your channels: ${names(bots)}.`) : null,
          plan.joinRolesSee.length
            ? h('div', { class: 'callout warn' }, icon('alert'), h('div', null, h('b', null, `New members would skip the Verify button: `), `they get ${names(plan.joinRolesSee.map((n) => `@${n}`))} as soon as they join (your auto roles), and that can see channels. Stop giving it on join (Edit), or take View Channels off it in Server Settings → Roles.`))
            : null,
          plan.stuckBots.length ? h('div', { class: 'callout warn' }, icon('alert'), h('div', null, h('b', null, 'These bots would stop seeing your channels: '), `${names(plan.stuckBots)}. Their roles are above the bot's, so it can't change them. Give them View Channels in Server Settings → Roles first.`)) : null,
          item('archive', 'A backup of your roles, channels and permissions is made first, and Unlock puts the permission changes back.'),
        ].filter(Boolean),
      );
    }

    // The channels that could stay open, every kind with its icon, under their categories as in
    // Discord. Drawn once (ticking a box doesn't redraw them).
    function drawOpenList() {
      const rows = [];
      let category = null;
      for (const c of plan.openable) {
        if (c.category !== category) {
          category = c.category;
          if (category) rows.push(h('div', { class: 'verify-open-category' }, category));
        }
        const box = h('input', { type: 'checkbox', checked: options.openChannelIds.includes(c.id) });
        box.addEventListener('change', () => {
          options.openChannelIds = box.checked ? [...options.openChannelIds, c.id] : options.openChannelIds.filter((id) => id !== c.id);
          refresh();
        });
        rows.push(h('label', { class: 'check-row verify-open-channel', title: CHANNEL_LABEL[c.type] || 'Channel' }, box, icon(CHANNEL_ICON[c.type] || 'hash'), h('span', { class: 'ellipsis' }, c.name)));
      }
      openList.replaceChildren(...rows);
    }

    const body = h(
      'div',
      { class: 'stack', style: { gap: '14px' } },
      h('p', null, "One step instead of changing every channel by hand: new members see only the Verify channel until they press the button, and verified members see the rest."),
      switchEl(options.giveExisting, (v) => (options.giveExisting = v), 'Give the verified role to everyone already in the server (recommended, or they lose access until they press Verify). On a big server this takes a few minutes.'),
      switchEl(options.hideVerify, (v) => {
        options.hideVerify = v;
        refresh();
      }, `Hide #${s.verify.channelName || 'the Verify channel'} from members once they've verified (leave this off if it's your rules channel)`),
      h('div', null, h('div', { class: 'label', style: { marginBottom: '6px' } }, 'Also keep these open to everyone'), openList),
      h('div', null, h('div', { class: 'label', style: { marginBottom: '6px' } }, 'What changes'), summary),
    );
    refresh({ fresh: true });
    const ok = await openModal({
      title: `Lock ${s.guildName || 'the server'} behind Verify?`,
      wide: true,
      body,
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        { label: 'Lock the server', kind: 'primary', icon: 'lock', value: true, ref: (b) => ((lockButton = b), (b.disabled = true)) },
      ],
    });
    return ok && plan ? options : null;
  },

  async remove(s) {
    const ok = await confirmDialog({ title: `Stop auto roles in ${s.guildName || 'this server'}?`, message: 'New members stop getting roles, and the Verify message is deleted. Roles already given stay.', confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    try {
      AutoRolesPage.data = await api('autoroles:remove', s.botId, s.guildId);
      toast('Auto roles removed');
    } catch (err) {
      toastError(err);
    }
    AutoRolesPage.rerender();
  },

  async edit(existing) {
    const owners = App.bots.filter((b) => b.type !== 'mod');
    const draft = existing
      ? JSON.parse(JSON.stringify(existing))
      : { botId: owners[0].id, guildId: '', guildName: '', enabled: true, roles: [], botRoles: [], delay: 0, verify: { enabled: false, channelId: '', roles: [], title: 'Welcome! Please verify', text: 'Press the button below to confirm you have read the rules and get access to the rest of the server.', color: 0x0bbfbc, button: { label: 'Verify', emoji: { name: '✅' }, style: 'success' } } };
    if (!App.bot(draft.botId)) draft.botId = owners[0].id;
    const v = draft.verify;
    let roles = [];
    let botTop = Infinity;
    let emojis = [];

    const options = (sel, list, value) => {
      sel.replaceChildren(...list.map(([val, label]) => h('option', { value: val }, label)));
      sel.value = list.some(([val]) => val === value) ? value : list[0]?.[0] || '';
    };
    const botSel = selectEl(owners.map((b) => [b.id, displayName(b)]), draft.botId, (val) => { draft.botId = val; draft.guildId = ''; loadGuilds(); });
    const guildSel = selectEl([['', 'Loading servers…']], '');
    const channelSel = selectEl([['', 'Pick a server first']], '', (val) => { v.channelId = val; });
    botSel.disabled = !!existing;
    guildSel.disabled = !!existing;
    guildSel.addEventListener('change', () => { draft.guildId = guildSel.value; draft.guildName = guildSel.selectedOptions[0]?.textContent || ''; loadServer(); });

    const memberChips = roleChips(draft.roles, (list) => (draft.roles = list));
    const botChips = roleChips(draft.botRoles, (list) => (draft.botRoles = list));
    const verifyChips = roleChips(v.roles, (list) => (v.roles = list));

    const loadGuilds = async () => {
      options(guildSel, [['', 'Loading servers…']], '');
      try {
        const guilds = await SocialPage.guildsFor(draft.botId);
        options(guildSel, [['', guilds.length ? 'Pick a server…' : 'This bot is in no servers'], ...guilds.map((g) => [g.id, g.name])], draft.guildId);
      } catch (err) {
        options(guildSel, [['', `Couldn't load servers: ${err.message}`]], '');
      }
      draft.guildId = guildSel.value;
      if (draft.guildId) draft.guildName = guildSel.selectedOptions[0]?.textContent || draft.guildName;
      loadServer();
    };
    const loadServer = async () => {
      roles = [];
      let channels = [];
      if (draft.guildId) {
        try {
          const [list, roleList, me, emojiList] = await Promise.all([rest(draft.botId, 'GET', `/guilds/${draft.guildId}/channels`), rest(draft.botId, 'GET', `/guilds/${draft.guildId}/roles`), rest(draft.botId, 'GET', `/guilds/${draft.guildId}/members/${draft.botId}`), rest(draft.botId, 'GET', `/guilds/${draft.guildId}/emojis`).catch(() => [])]);
          channels = list.filter((c) => c.type === 0 || c.type === 5).sort((a, b) => a.position - b.position);
          botTop = Math.max(0, ...roleList.filter((r) => me.roles.includes(r.id)).map((r) => r.position));
          roles = roleList.filter((r) => r.id !== draft.guildId && !r.managed).sort((a, b) => b.position - a.position);
          emojis = emojiList;
        } catch {
          roles = [];
        }
      }
      options(channelSel, draft.guildId ? [['', 'Pick a channel…'], ...channels.map((c) => [c.id, `#${c.name}`])] : [['', 'Pick a server first']], v.channelId);
      if (draft.guildId) v.channelId = channelSel.value;
      for (const chips of [memberChips, botChips, verifyChips]) chips.setRoles(roles, botTop);
      drawPreview();
    };

    const join = h('div', { class: 'stack', style: { gap: '12px', display: draft.enabled ? '' : 'none' } });
    const verifyBox = h('div', { class: 'stack', style: { gap: '12px', display: v.enabled ? '' : 'none' } });
    const text = (obj, key, attrs = {}) => {
      const el = h(attrs.rows ? 'textarea' : 'input', { class: attrs.rows ? 'textarea' : 'input', ...attrs }, attrs.rows ? obj[key] : null);
      if (!attrs.rows) el.value = obj[key] ?? '';
      el.addEventListener('input', () => { obj[key] = el.value; drawPreview(); });
      return el;
    };
    const colour = h('input', { type: 'color', class: 'color-input', value: `#${Number(v.color).toString(16).padStart(6, '0')}` });
    colour.addEventListener('input', () => { v.color = parseInt(colour.value.slice(1), 16); drawPreview(); });
    const emojiBtn = h('button', { class: 'emoji-btn big', type: 'button', title: 'Button emoji' });
    const drawEmoji = () => emojiBtn.replaceChildren(v.button.emoji ? emojiNode(v.button.emoji, 22) : h('span', { class: 'subtle' }, 'None'));
    emojiBtn.addEventListener('click', async () => {
      const emoji = await EmojiPicker.open(emojis);
      if (!emoji) return;
      v.button.emoji = emoji;
      drawEmoji();
      drawPreview();
    });
    drawEmoji();

    const preview = h('div', { class: 'rr-preview' });
    function drawPreview() {
      const bot = App.bot(draft.botId);
      const style = VERIFY_STYLES.find(([s]) => s === v.button.style) || VERIFY_STYLES[0];
      preview.replaceChildren(
        h('div', { class: 'rr-author' }, h('img', { class: 'avatar', src: userAvatar(bot, 64), width: 32, height: 32, alt: '' }), h('b', null, displayName(bot)), h('span', { class: 'badge peri' }, 'APP')),
        h('div', { class: 'rr-embed', style: { borderLeftColor: colour.value } }, v.title.trim() ? h('div', { class: 'rr-title' }, v.title.trim()) : null, h('div', { class: 'rr-text' }, discordText(v.text.trim() || 'Press the button below to verify.'))),
        h('div', { class: 'row', style: { marginTop: '8px' } }, h('span', { class: 'ticket-button', style: { background: style[2] } }, v.button.emoji ? emojiNode(v.button.emoji, 16) : null, v.button.label || 'Verify')),
      );
    }

    join.append(
      field('New members get', memberChips.el),
      field('New bots get', botChips.el, 'Bots that join can get their own role instead, like "Bots".'),
      field('When', selectEl(AUTO_ROLE_DELAYS, String(draft.delay), (val) => (draft.delay = Number(val))), 'A short wait means accounts that join and leave right away (raids) never get the role. If your server uses Membership Screening, roles wait until the member accepts the rules.'),
    );
    verifyBox.append(
      field('Post the button in', channelSel),
      field('Pressing it gives', verifyChips.el, 'Members who already have these roles are told they are verified.'),
      field('Title', text(v, 'title', { maxlength: 256 })),
      field('Message', text(v, 'text', { rows: 3, maxlength: 2000 })),
      h('div', { class: 'ticket-button-row' }, field('Button text', text(v.button, 'label', { maxlength: 80 })), field('Emoji', h('div', { class: 'row', style: { gap: '6px' } }, emojiBtn, h('button', { type: 'button', class: 'icon-btn', title: 'No emoji', onclick: () => { v.button.emoji = null; drawEmoji(); drawPreview(); } }, icon('x')))), field('Colour', selectEl(VERIFY_STYLES.map(([s, label]) => [s, label]), v.button.style, (val) => { v.button.style = val; drawPreview(); }))),
      field('Card colour', colour),
    );

    loadGuilds();
    drawPreview();

    return openModal({
      title: existing ? `Auto roles in ${existing.guildName || 'this server'}` : 'Set up auto roles',
      wide: 'xl',
      dismissable: false,
      body: h(
        'div',
        { class: 'rr-editor' },
        h(
          'div',
          { class: 'stack', style: { gap: '16px' } },
          h('div', { class: 'grid cols-2', style: { gap: '12px' } }, field('Bot', botSel), field('Server', guildSel)),
          h('div', { class: 'ticket-section' }, switchEl(draft.enabled, (on) => { draft.enabled = on; join.style.display = on ? '' : 'none'; }, 'Give roles when someone joins'), join),
          h('div', { class: 'ticket-section' }, switchEl(v.enabled, (on) => { v.enabled = on; verifyBox.style.display = on ? '' : 'none'; }, 'Post a Verify button'), verifyBox),
        ),
        h('div', null, h('div', { class: 'label', style: { marginBottom: '8px' } }, 'The Verify message'), preview, h('p', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)', marginTop: '10px' } }, "A common setup: @everyone can only see the Verify channel, and the role the button gives can see the rest. After saving, press Lock behind Verify on the Auto roles page to set that up in one go. The bot needs Manage Roles, and its role must be above the roles it gives.")),
      ),
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        {
          label: 'Save',
          kind: 'primary',
          icon: 'check',
          onClick: async () => {
            if (!guildSel.value) throw new Error('Pick the server.');
            const names = Object.fromEntries(roles.map((r) => [r.id, r.name]));
            const payload = { ...draft, guildId: guildSel.value, guildName: guildSel.selectedOptions[0]?.textContent || draft.guildName, roleNames: names, verify: { ...v, channelName: (channelSel.selectedOptions[0]?.textContent || '').replace(/^#/, '') } };
            AutoRolesPage.data = await api('autoroles:save', draft.botId, payload);
            toast('Auto roles saved');
            AutoRolesPage.rerender();
          },
        },
      ],
    });
  },
};

// Locking behind Verify: what it's doing now, on its button.
onEvent('verifylock:progress', ({ botId, guildId, text }) => {
  const key = `${botId}:${guildId}`;
  AutoRolesPage.lockProgress[key] = text;
  const btn = document.querySelector(`#autoroles-page [data-lock="${key}"]`);
  if (btn) btn.lastChild.textContent = text;
});

onEvent('autoroles:progress', ({ botId, guildId, done, total }) => {
  const key = `${botId}:${guildId}`;
  AutoRolesPage.progress[key] = `${done}/${total}`;
  const btn = document.querySelector(`#autoroles-page [data-progress="${key}"]`);
  if (btn) btn.lastChild.textContent = `Giving… ${done}/${total}`;
});
