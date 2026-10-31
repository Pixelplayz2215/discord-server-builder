// Reaction roles page: messages members react to, to give themselves roles. The main process posts
// them and hands roles out while the app is open or in the tray.

const RR_MODES = [
  ['normal', 'Pick any number of roles'],
  ['unique', 'Pick only one (choosing another swaps it)'],
  ['verify', 'Add only: removing the reaction keeps the role (good for rules or verification)'],
];
const RR_MAX = 20;

// An emoji as shown in the app: a server emoji's image, or the character itself.
function emojiNode(emoji, size = 22) {
  if (emoji?.id) return h('img', { class: 'emoji-img', src: `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'png'}?size=48`, width: size, height: size, alt: `:${emoji.name}:`, title: `:${emoji.name}:` });
  return h('span', { class: 'emoji-char', style: { fontSize: `${size * 0.9}px` } }, emoji?.name || '?');
}

const EmojiPicker = {
  // Resolves to { name } for a standard emoji, { id, name, animated } for a server emoji, or undefined.
  open(serverEmojis) {
    const search = h('input', { class: 'input', placeholder: 'Search emojis…', autocomplete: 'off' });
    const pasted = h('input', { class: 'input', placeholder: 'Or paste any emoji here', maxlength: 16, autocomplete: 'off' });
    let modal;
    const pick = (emoji) => modal?.closeModal(emoji);
    const button = (emoji, words) => h('button', { class: 'emoji-btn', type: 'button', title: emoji.id ? `:${emoji.name}:` : words.split(' ')[0], 'data-words': `${emoji.name} ${words}`.toLowerCase(), onclick: () => pick(emoji) }, emojiNode(emoji, 26));

    const usable = serverEmojis.filter((e) => e.available !== false);
    const sections = [
      usable.length ? ['This server', usable.map((e) => button({ id: e.id, name: e.name, animated: !!e.animated }, e.name))] : null,
      ...STANDARD_EMOJIS.map(([category, list]) => [category, list.map(([char, words]) => button({ name: char }, words))]),
    ]
      .filter(Boolean)
      .map(([title, buttons]) => h('div', { class: 'emoji-section' }, h('div', { class: 'label' }, title), h('div', { class: 'emoji-grid' }, buttons)));
    const body = h('div', { class: 'emoji-scroll' }, sections, usable.length ? null : h('p', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)' } }, 'This server has no emojis of its own yet. Upload some in Server Settings → Emoji and they show up here.'));

    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      for (const section of body.querySelectorAll('.emoji-section')) {
        let shown = 0;
        for (const btn of section.querySelectorAll('.emoji-btn')) {
          const match = !q || btn.dataset.words.includes(q);
          btn.style.display = match ? '' : 'none';
          if (match) shown++;
        }
        section.style.display = shown ? '' : 'none';
      }
    });
    const usePasted = () => {
      const value = pasted.value.trim();
      // A pasted server emoji looks like <:name:id> or <a:name:id>.
      const custom = value.match(/^<(a?):(\w{2,32}):(\d{15,21})>$/);
      if (custom) return pick({ id: custom[3], name: custom[2], animated: !!custom[1] });
      if (!value || /[\w\s]/.test(value)) return toast('Paste a single emoji.', 'error');
      pick({ name: value });
    };

    const result = openModal({
      title: 'Pick an emoji',
      wide: true,
      body: [search, body, h('div', { class: 'row' }, h('div', { class: 'grow' }, pasted), h('button', { class: 'btn sm', onclick: usePasted }, 'Use it'))],
      actions: [{ label: 'Cancel', kind: 'ghost' }],
    });
    modal = document.querySelector('#modal-root .modal-backdrop:last-child .modal');
    return result;
  },
};

const ReactionRolesPage = {
  data: null,
  error: null,
  loading: false,

  async load() {
    ReactionRolesPage.loading = true;
    try {
      ReactionRolesPage.data = await api('rr:list');
      ReactionRolesPage.error = null;
    } catch (err) {
      ReactionRolesPage.error = err.message;
    }
    ReactionRolesPage.loading = false;
    ReactionRolesPage.rerender();
  },

  rerender() {
    if (App.route.page !== 'reactionroles') return;
    const scroll = document.getElementById('rr-page')?.scrollTop || 0;
    App.renderPage();
    const page = document.getElementById('rr-page');
    if (page) page.scrollTop = scroll;
  },

  render() {
    const page = ReactionRolesPage;
    if (!page.data && !page.loading && !page.error) page.load();
    const owners = App.bots.filter((b) => b.type !== 'mod');
    const list = page.data || [];
    let content;
    if (page.error) content = h('div', { class: 'callout warn' }, icon('alert'), h('div', null, page.error));
    else if (!owners.length) content = h('div', { class: 'card' }, h('div', { class: 'empty' }, icon('bot'), h('h3', null, 'Connect a bot first'), h('p', null, 'Reaction roles are handed out by your bot. Add one with its token on the Home page.')));
    else if (!page.data) content = h('div', { class: 'loading-block' }, [1, 2].map(() => h('div', { class: 'skeleton' })));
    else if (!list.length) {
      content = h('div', { class: 'card' }, h('div', { class: 'empty' }, icon('smile'), h('h3', null, 'No reaction roles yet'), h('p', null, 'Make a message with emojis members react to, to give themselves roles like pronouns, games, colours or ping roles.'), h('button', { class: 'btn primary', onclick: () => page.edit(null) }, icon('plus'), 'New reaction roles')));
    } else content = h('div', { class: 'stack', style: { gap: '14px' } }, list.map((p) => page.panelCard(p)));

    return h(
      'div',
      { class: 'settings', id: 'rr-page' },
      h(
        'div',
        { class: 'settings-inner' },
        h(
          'div',
          { class: 'settings-head' },
          h(
            'div',
            { class: 'grow' },
            h('span', { class: 'eyebrow' }, 'Roles'),
            h('h1', null, 'Reaction roles'),
            h('p', { class: 'muted', style: { marginTop: '6px' } }, 'Members react to a message to give themselves roles, and remove the reaction to drop them. The bot hands roles out while this app is open or in the tray, and catches up on reactions it missed when it starts.'),
          ),
          h('button', { class: 'btn primary', disabled: !owners.length || !page.data, onclick: () => page.edit(null) }, icon('plus'), 'New reaction roles'),
        ),
        content,
      ),
    );
  },

  panelCard(p) {
    const bot = App.bot(p.botId);
    const mode = RR_MODES.find(([m]) => m === p.mode)?.[1].split(' (')[0].split(':')[0] || 'Pick any number of roles';
    const sync = h('button', { class: 'btn sm', title: 'Give roles to anyone who reacted while the bot was away' }, icon('refresh'), 'Catch up');
    sync.addEventListener('click', withBusy(sync, async () => {
      const res = await api('rr:sync', p.botId, p.guildId, p.id);
      toast(res.added ? `Gave ${res.added} missing role${res.added === 1 ? '' : 's'} (checked ${res.checked} reactions)` : `Everyone already has their roles (checked ${res.checked} reactions)`);
      ReactionRolesPage.load();
    }));
    return h(
      'div',
      { class: 'card' },
      h(
        'div',
        { class: 'card-head' },
        icon('smile'),
        h('h3', { class: 'grow ellipsis' }, p.title || p.message.split('\n')[0].slice(0, 80) || 'Reaction roles'),
        h('span', { class: 'badge peri' }, mode),
      ),
      h('div', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)', marginTop: '-4px' } }, `#${p.channelName || p.channelId} in ${p.guildName || 'a server'} · via ${bot ? displayName(bot) : 'a removed bot'}`),
      h('div', { class: 'row wrap', style: { gap: '6px', marginTop: '12px' } }, p.pairs.map((pair) => h('span', { class: 'chip rr-chip' }, emojiNode(pair.emoji, 16), h('span', null, pair.roleName || 'role')))),
      p.problem ? h('div', { class: 'callout warn', style: { marginTop: '12px' } }, icon('alert'), h('div', null, p.problem)) : null,
      h(
        'div',
        { class: 'row wrap', style: { marginTop: '14px' } },
        h('button', { class: 'btn sm', onclick: () => ReactionRolesPage.edit(p) }, icon('edit'), 'Edit'),
        sync,
        p.messageId ? h('button', { class: 'btn sm ghost', onclick: () => openExternal(`https://discord.com/channels/${p.guildId}/${p.channelId}/${p.messageId}`) }, icon('external'), 'Open in Discord') : null,
        h('div', { class: 'grow' }),
        h('button', { class: 'btn sm danger', onclick: () => ReactionRolesPage.remove(p) }, icon('trash'), 'Delete'),
      ),
    );
  },

  async remove(p) {
    let deleteMessage = true;
    const ok = await confirmDialog({
      title: 'Delete these reaction roles?',
      message: h('div', { class: 'stack', style: { gap: '12px' } }, h('p', null, 'The bot stops handing out these roles. Members keep the roles they already have.'), switchEl(true, (v) => (deleteMessage = v), 'Also delete the message in Discord')),
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      ReactionRolesPage.data = await api('rr:delete', p.botId, p.guildId, p.id, deleteMessage);
      toast('Reaction roles deleted');
    } catch (err) {
      toastError(err);
    }
    ReactionRolesPage.rerender();
  },

  async edit(existing) {
    const owners = App.bots.filter((b) => b.type !== 'mod');
    const draft = existing
      ? JSON.parse(JSON.stringify(existing))
      : { botId: owners[0].id, guildId: '', channelId: '', title: 'Pick your roles', message: 'React below to get a role. Remove your reaction to drop it.', style: 'embed', color: 0x7f8cf0, listRoles: true, mode: 'normal', pairs: [] };
    if (!App.bot(draft.botId)) draft.botId = owners[0].id;
    let roles = [];
    let emojis = [];
    let botTop = 0;

    const options = (sel, list, value) => {
      sel.replaceChildren(...list.map(([v, label, disabled]) => h('option', { value: v, disabled }, label)));
      sel.value = list.some(([v, , disabled]) => v === value && !disabled) ? value : list[0]?.[0] || '';
    };
    const botSel = selectEl(owners.map((b) => [b.id, displayName(b)]), draft.botId, (v) => { draft.botId = v; draft.guildId = ''; loadGuilds(); });
    const guildSel = selectEl([['', 'Loading servers…']], '');
    const channelSel = selectEl([['', 'Pick a server first']], '');
    botSel.disabled = !!existing; // a posted message belongs to the bot that posted it
    guildSel.disabled = !!existing;
    guildSel.addEventListener('change', () => { draft.guildId = guildSel.value; loadServer(); });
    channelSel.addEventListener('change', () => { draft.channelId = channelSel.value; });

    const loadGuilds = async () => {
      options(guildSel, [['', 'Loading servers…']], '');
      try {
        const guilds = await SocialPage.guildsFor(draft.botId);
        options(guildSel, [['', guilds.length ? 'Pick a server…' : 'This bot is in no servers'], ...guilds.map((g) => [g.id, g.name])], draft.guildId);
      } catch (err) {
        options(guildSel, [['', `Couldn't load servers: ${err.message}`]], '');
      }
      draft.guildId = guildSel.value;
      loadServer();
    };
    // The server's channels, roles the bot can hand out, and its own emojis.
    const loadServer = async () => {
      roles = [];
      emojis = [];
      if (!draft.guildId) {
        options(channelSel, [['', 'Pick a server first']], '');
        drawPairs();
        return;
      }
      options(channelSel, [['', 'Loading channels…']], '');
      try {
        const [channels, roleList, emojiList, me] = await Promise.all([
          rest(draft.botId, 'GET', `/guilds/${draft.guildId}/channels`),
          rest(draft.botId, 'GET', `/guilds/${draft.guildId}/roles`),
          rest(draft.botId, 'GET', `/guilds/${draft.guildId}/emojis`).catch(() => []),
          rest(draft.botId, 'GET', `/guilds/${draft.guildId}/members/${draft.botId}`),
        ]);
        const textual = channels.filter((c) => c.type === 0 || c.type === 5).sort((a, b) => a.position - b.position);
        options(channelSel, [['', 'Pick a channel…'], ...textual.map((c) => [c.id, `#${c.name}`])], draft.channelId);
        draft.channelId = channelSel.value;
        botTop = Math.max(0, ...roleList.filter((r) => me.roles.includes(r.id)).map((r) => r.position));
        roles = roleList.filter((r) => r.id !== draft.guildId && !r.managed).sort((a, b) => b.position - a.position);
        emojis = emojiList;
      } catch (err) {
        options(channelSel, [['', `Couldn't load the server: ${err.message}`]], '');
      }
      drawPairs();
    };

    const title = h('input', { class: 'input', value: draft.title, maxlength: 256, placeholder: 'Title (optional)' });
    const message = h('textarea', { class: 'textarea', rows: 4, maxlength: 3500, placeholder: 'Your message, e.g. which roles these are and what they do' }, draft.message);
    const styleSel = selectEl([['embed', 'Card (embed)'], ['text', 'Plain message']], draft.style, (v) => { draft.style = v; colorWrap.style.display = v === 'embed' ? '' : 'none'; drawPreview(); });
    const color = h('input', { type: 'color', class: 'color-input', value: `#${(draft.color ?? 0x7f8cf0).toString(16).padStart(6, '0')}` });
    const colorWrap = h('div', { style: { display: draft.style === 'embed' ? '' : 'none' } }, field('Colour', color));
    const listRoles = switchEl(draft.listRoles !== false, (v) => { draft.listRoles = v; drawPreview(); }, 'List the emojis and roles under the message');
    const modeSel = selectEl(RR_MODES, draft.mode, (v) => { draft.mode = v; });
    for (const el of [title, message]) el.addEventListener('input', drawPreviewSoon);
    color.addEventListener('input', () => { draft.color = parseInt(color.value.slice(1), 16); drawPreview(); });

    const pairsHost = h('div', { class: 'stack', style: { gap: '8px' } });
    const countLabel = h('div', { class: 'label grow' });
    const addBtn = h('button', { class: 'btn sm', type: 'button' }, icon('plus'), 'Add a reaction role');
    addBtn.addEventListener('click', async () => {
      const emoji = await EmojiPicker.open(emojis);
      if (!emoji) return;
      if (draft.pairs.some((p) => sameEmojiUi(p.emoji, emoji))) return toast('That emoji is already used on this message.', 'error');
      draft.pairs.push({ emoji, roleId: '', roleName: '', description: '' });
      drawPairs();
    });

    function drawPairs() {
      const assignable = roles.filter((r) => r.position < botTop);
      const roleOptions = [['', assignable.length ? 'Pick a role…' : draft.guildId ? 'No roles the bot can give' : 'Pick a server first'], ...roles.map((r) => [r.id, r.position < botTop ? `@${r.name}` : `@${r.name} (above the bot)`, r.position >= botTop])];
      pairsHost.replaceChildren(
        ...draft.pairs.map((pair, i) => {
          const emojiBtn = h('button', { class: 'emoji-btn big', type: 'button', title: 'Change emoji' }, emojiNode(pair.emoji, 26));
          emojiBtn.addEventListener('click', async () => {
            const emoji = await EmojiPicker.open(emojis);
            if (!emoji) return;
            if (draft.pairs.some((p, j) => j !== i && sameEmojiUi(p.emoji, emoji))) return toast('That emoji is already used on this message.', 'error');
            pair.emoji = emoji;
            drawPairs();
          });
          const roleSel = h('select', { class: 'select' });
          options(roleSel, roleOptions, pair.roleId);
          if (roles.length && pair.roleId && roleSel.value !== pair.roleId) pair.roleId = '';
          roleSel.addEventListener('change', () => {
            pair.roleId = roleSel.value;
            pair.roleName = roles.find((r) => r.id === roleSel.value)?.name || '';
            drawPreview();
          });
          const desc = h('input', { class: 'input', value: pair.description || '', maxlength: 100, placeholder: 'What it is for (optional)' });
          desc.addEventListener('input', () => { pair.description = desc.value; drawPreviewSoon(); });
          return h(
            'div',
            { class: 'rr-pair' },
            emojiBtn,
            h('div', { class: 'rr-role' }, roleSel),
            h('div', { class: 'grow' }, desc),
            h('button', { class: 'icon-btn danger', type: 'button', title: 'Remove', onclick: () => { draft.pairs.splice(i, 1); drawPairs(); } }, icon('x')),
          );
        }),
        ...(draft.pairs.length ? [] : [h('div', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)' } }, 'No reactions yet. Add one to pick its emoji, then the role it gives.')]),
      );
      addBtn.disabled = draft.pairs.length >= RR_MAX;
      countLabel.textContent = `Reactions (${draft.pairs.length}/${RR_MAX})`;
      drawPreview();
    }

    // A rough picture of the message in Discord.
    const preview = h('div', { class: 'rr-preview' });
    let previewTimer;
    function drawPreviewSoon() {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(drawPreview, 120);
    }
    function drawPreview() {
      const roleLine = (pair) => {
        const role = roles.find((r) => r.id === pair.roleId);
        return h('div', { class: 'rr-line' }, emojiNode(pair.emoji, 18), h('span', { class: 'rr-mention', style: role?.color ? { color: roleColor(role) } : null }, `@${role?.name || pair.roleName || 'role'}`), pair.description ? h('span', { class: 'muted' }, ` · ${pair.description}`) : null);
      };
      const text = message.value.trim();
      const lines = draft.listRoles !== false ? draft.pairs.map(roleLine) : [];
      const inner = [title.value.trim() ? h('div', { class: 'rr-title' }, title.value.trim()) : null, text ? h('div', { class: 'rr-text' }, text) : null, lines.length ? h('div', { class: 'rr-lines' }, lines) : null];
      const bubble = draft.style === 'embed' ? h('div', { class: 'rr-embed', style: { borderLeftColor: color.value } }, inner) : h('div', { class: 'rr-plain' }, inner);
      const reactions = h('div', { class: 'row wrap', style: { gap: '6px', marginTop: '8px' } }, draft.pairs.map((p) => h('span', { class: 'rr-reaction' }, emojiNode(p.emoji, 16), h('span', null, '1'))));
      const botUser = App.bot(draft.botId);
      preview.replaceChildren(h('div', { class: 'rr-author' }, h('img', { class: 'avatar', src: userAvatar(botUser, 64), width: 32, height: 32, alt: '' }), h('b', null, displayName(botUser)), h('span', { class: 'badge peri' }, 'APP')), bubble, reactions);
    }

    loadGuilds();
    drawPairs();

    return openModal({
      title: existing ? 'Edit reaction roles' : 'New reaction roles',
      wide: 'xl',
      // Escape in the emoji picker must not close this form as well and lose the work.
      dismissable: false,
      body: h(
        'div',
        { class: 'rr-editor' },
        h(
          'div',
          { class: 'stack', style: { gap: '12px' } },
          h('div', { class: 'grid cols-2', style: { gap: '12px' } }, field('Bot', botSel), field('Server', guildSel)),
          field('Post in', channelSel, existing ? 'Changing the channel posts a new message there and deletes the old one.' : null),
          field('Title', title),
          field('Message', message),
          h('div', { class: 'grid cols-2', style: { gap: '12px' } }, field('Look', styleSel), colorWrap),
          listRoles,
          field('How it works', modeSel),
          h('div', { class: 'row', style: { marginTop: '4px' } }, countLabel, addBtn),
          pairsHost,
        ),
        h('div', null, h('div', { class: 'label', style: { marginBottom: '8px' } }, 'Preview'), preview, h('p', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)', marginTop: '10px' } }, 'The bot needs Manage Roles, and its role must be above the roles it gives. "Pick only one" also needs Manage Messages, to take back the other reaction.')),
      ),
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        {
          label: existing ? 'Save and update message' : 'Post in Discord',
          kind: 'primary',
          icon: 'send',
          onClick: async () => {
            if (!guildSel.value || !channelSel.value) throw new Error('Pick the server and channel to post in.');
            if (!draft.pairs.length) throw new Error('Add at least one reaction and role.');
            if (draft.pairs.some((p) => !p.roleId)) throw new Error('Pick a role for every reaction.');
            const payload = {
              ...draft,
              guildId: guildSel.value,
              guildName: guildSel.selectedOptions[0]?.textContent || '',
              channelId: channelSel.value,
              channelName: (channelSel.selectedOptions[0]?.textContent || '').replace(/^#/, ''),
              title: title.value.trim(),
              message: message.value.trim(),
              color: parseInt(color.value.slice(1), 16),
            };
            ReactionRolesPage.data = await api('rr:save', draft.botId, payload);
            toast(existing ? 'Reaction roles updated' : `Posted in #${payload.channelName}`);
            ReactionRolesPage.rerender();
          },
        },
      ],
    });
  },
};

// Same rule as the main process: server emojis by id, standard ones ignoring the presentation selector.
function sameEmojiUi(a, b) {
  if (a?.id || b?.id) return String(a?.id) === String(b?.id);
  return String(a?.name).replace(/️/g, '') === String(b?.name).replace(/️/g, '');
}
