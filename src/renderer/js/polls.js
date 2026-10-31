// Polls page: reaction polls with a coloured bar under each answer, posted from here or with /poll in
// Discord. The main process redraws the bars as votes come in, while the app is open or in the tray.

// Bar colours: [name, label, the square Discord shows, its colour in the app].
const POLL_COLORS = [
  ['red', 'Red', '🟥', '#dd2e44'],
  ['orange', 'Orange', '🟧', '#f4900c'],
  ['yellow', 'Yellow', '🟨', '#fdcb58'],
  ['green', 'Green', '🟩', '#78b159'],
  ['blue', 'Blue', '🟦', '#55acee'],
  ['purple', 'Purple', '🟪', '#aa8ed6'],
  ['brown', 'Brown', '🟫', '#c1694f'],
  ['white', 'White', '⬜', '#e6e7e8'],
  ['black', 'Black', '⬛', '#31373d'],
];
const POLL_MIN = 2;
const POLL_MAX = 4;
const POLL_SAMPLE = [5, 3, 2, 1]; // votes in the editor's preview, so the colours show
const POLL_STARTERS = [['1️⃣', 'blue'], ['2️⃣', 'green'], ['3️⃣', 'yellow'], ['4️⃣', 'red']];
const pollColor = (name) => POLL_COLORS.find(([c]) => c === name) || POLL_COLORS[4];
const votesLabel = (n) => `${n} vote${n === 1 ? '' : 's'}`;

function pollResults(options, counts = []) {
  const votes = options.map((_, i) => Math.max(0, Number(counts[i]) || 0));
  const total = votes.reduce((a, b) => a + b, 0);
  return { votes, total, shares: votes.map((v) => (total ? v / total : 0)), top: Math.max(0, ...votes) };
}

// A bar as Discord shows it: ten squares, 10% each.
function pollSquares(color, share) {
  const filled = Math.round(share * 10);
  return pollColor(color)[2].repeat(filled) + (color === 'black' ? '⬜' : '⬛').repeat(10 - filled);
}

const PollsPage = {
  data: null,
  error: null,
  loading: false,

  async load() {
    PollsPage.loading = true;
    try {
      PollsPage.data = await api('polls:list');
      PollsPage.error = null;
    } catch (err) {
      PollsPage.error = err.message;
    }
    PollsPage.loading = false;
    PollsPage.rerender();
  },

  rerender() {
    if (App.route.page !== 'polls') return;
    const scroll = document.getElementById('polls-page')?.scrollTop || 0;
    App.renderPage();
    const page = document.getElementById('polls-page');
    if (page) page.scrollTop = scroll;
  },

  render() {
    const page = PollsPage;
    if (!page.data && !page.loading && !page.error) page.load();
    const owners = App.bots.filter((b) => b.type !== 'mod');
    const list = page.data || [];
    let content;
    if (page.error) content = h('div', { class: 'callout warn' }, icon('alert'), h('div', null, page.error));
    else if (!owners.length) content = h('div', { class: 'card' }, h('div', { class: 'empty' }, icon('bot'), h('h3', null, 'Connect a bot first'), h('p', null, 'Polls are posted and counted by your bot. Add one with its token on the Home page.')));
    else if (!page.data) content = h('div', { class: 'loading-block' }, [1, 2].map(() => h('div', { class: 'skeleton' })));
    else if (!list.length) {
      content = h('div', { class: 'card' }, h('div', { class: 'empty' }, icon('poll'), h('h3', null, 'No polls yet'), h('p', null, 'Ask your server a question with up to 4 answers. Members vote by reacting, and each answer gets a bar in its own colour.'), h('button', { class: 'btn primary', onclick: () => page.edit(null) }, icon('plus'), 'New poll')));
    } else content = h('div', { class: 'stack', style: { gap: '14px' } }, list.map((p) => page.pollCard(p)));

    return h(
      'div',
      { class: 'settings', id: 'polls-page' },
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
            h('h1', null, 'Polls'),
            h('p', { class: 'muted', style: { marginTop: '6px' } }, 'Members vote by reacting, and the bars fill in like Discord\'s own polls. The bars update while this app is open or in the tray. Members can also post polls with /poll in Discord (turn on slash commands on the Home page), and those show up here too.'),
          ),
          h('button', { class: 'btn primary', disabled: !owners.length || !page.data, onclick: () => page.edit(null) }, icon('plus'), 'New poll'),
        ),
        content,
      ),
    );
  },

  pollCard(p) {
    const bot = App.bot(p.botId);
    const { votes, total, shares, top } = pollResults(p.options, p.counts);
    const answers = p.options.map((o, i) =>
      h(
        'div',
        { class: 'poll-answer' },
        h(
          'div',
          { class: 'poll-answer-head' },
          emojiNode(o.emoji, 18),
          h('b', { class: 'grow ellipsis' }, o.label),
          p.ended && total && votes[i] === top ? h('span', { title: 'Most votes' }, '🏆') : null,
          h('span', { class: 'subtle' }, `${Math.round(shares[i] * 100)}% · ${votesLabel(votes[i])}`),
        ),
        h('div', { class: 'poll-track' }, h('div', { class: 'poll-fill', style: { width: `${shares[i] * 100}%`, background: pollColor(o.color)[3] } })),
      ),
    );
    const from = p.source === 'command' ? `/poll by ${p.by?.name || 'a member'}` : 'posted from the app';
    const end = h('button', { class: 'btn sm' }, icon('check'), 'End poll');
    end.addEventListener('click', withBusy(end, () => PollsPage.end(p)));
    return h(
      'div',
      { class: 'card' },
      h(
        'div',
        { class: 'card-head' },
        icon('poll'),
        h('h3', { class: 'grow ellipsis' }, p.title),
        h('span', { class: `badge ${p.ended ? 'gold' : 'teal'}` }, p.ended ? 'Ended' : 'Open'),
        h('span', { class: 'badge peri' }, p.multiple ? 'Several answers' : 'One answer'),
      ),
      h('div', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)', marginTop: '-4px' } }, `#${p.channelName || p.channelId} in ${p.guildName || 'a server'} · ${from} · ${p.createdAt ? fmtRelative(p.createdAt) : ''} · via ${bot ? displayName(bot) : 'a removed bot'}`),
      h('div', { class: 'poll-answers' }, answers),
      h('div', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)', marginTop: '10px' } }, `${votesLabel(total)}${p.ended ? ' · final results' : ''}`),
      p.problem ? h('div', { class: 'callout warn', style: { marginTop: '12px' } }, icon('alert'), h('div', null, p.problem)) : null,
      h(
        'div',
        { class: 'row wrap', style: { marginTop: '14px' } },
        p.ended ? null : h('button', { class: 'btn sm', onclick: () => PollsPage.edit(p) }, icon('edit'), 'Edit'),
        p.ended ? null : end,
        p.messageId ? h('button', { class: 'btn sm ghost', onclick: () => openExternal(`https://discord.com/channels/${p.guildId}/${p.channelId}/${p.messageId}`) }, icon('external'), 'Open in Discord') : null,
        h('div', { class: 'grow' }),
        h('button', { class: 'btn sm danger', onclick: () => PollsPage.remove(p) }, icon('trash'), 'Delete'),
      ),
    );
  },

  async end(p) {
    const ok = await confirmDialog({
      title: 'End this poll?',
      message: 'The bars show the final results, with a trophy on the winner, and new votes stop counting. The message stays in Discord.',
      confirmLabel: 'End poll',
    });
    if (!ok) return;
    try {
      PollsPage.data = await api('polls:end', p.botId, p.guildId, p.id);
      toast('Poll ended');
    } catch (err) {
      toastError(err);
      PollsPage.load();
      return;
    }
    PollsPage.rerender();
  },

  async remove(p) {
    let deleteMessage = true;
    const ok = await confirmDialog({
      title: 'Delete this poll?',
      message: h('div', { class: 'stack', style: { gap: '12px' } }, h('p', null, 'It leaves this list and its bars stop updating.'), switchEl(true, (v) => (deleteMessage = v), 'Also delete the message in Discord')),
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      PollsPage.data = await api('polls:delete', p.botId, p.guildId, p.id, deleteMessage);
      toast('Poll deleted');
    } catch (err) {
      toastError(err);
    }
    PollsPage.rerender();
  },

  async edit(existing) {
    const owners = App.bots.filter((b) => b.type !== 'mod');
    const draft = existing
      ? JSON.parse(JSON.stringify(existing))
      : { botId: owners[0].id, guildId: '', channelId: '', title: '', message: '', style: 'embed', color: 0x7f8cf0, multiple: true, options: POLL_STARTERS.slice(0, POLL_MIN).map(([name, color]) => ({ emoji: { name }, label: '', color })) };
    if (!App.bot(draft.botId)) draft.botId = owners[0].id;
    let emojis = [];

    const options = (sel, list, value) => {
      sel.replaceChildren(...list.map(([v, label]) => h('option', { value: v }, label)));
      sel.value = list.some(([v]) => v === value) ? value : list[0]?.[0] || '';
    };
    const botSel = selectEl(owners.map((b) => [b.id, displayName(b)]), draft.botId, (v) => { draft.botId = v; draft.guildId = ''; loadGuilds(); });
    const guildSel = selectEl([['', 'Loading servers…']], '');
    const channelSel = selectEl([['', 'Pick a server first']], '');
    // A posted poll stays where it is: moving it would lose its votes.
    botSel.disabled = !!existing;
    guildSel.disabled = !!existing;
    channelSel.disabled = !!existing;
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
    // The server's channels and its own emojis.
    const loadServer = async () => {
      emojis = [];
      if (!draft.guildId) {
        options(channelSel, [['', 'Pick a server first']], '');
        return;
      }
      options(channelSel, [['', 'Loading channels…']], '');
      try {
        const [channels, emojiList] = await Promise.all([rest(draft.botId, 'GET', `/guilds/${draft.guildId}/channels`), rest(draft.botId, 'GET', `/guilds/${draft.guildId}/emojis`).catch(() => [])]);
        const textual = channels.filter((c) => c.type === 0 || c.type === 5).sort((a, b) => a.position - b.position);
        options(channelSel, [['', 'Pick a channel…'], ...textual.map((c) => [c.id, `#${c.name}`])], draft.channelId);
        draft.channelId = channelSel.value;
        emojis = emojiList;
      } catch (err) {
        options(channelSel, [['', `Couldn't load the server: ${err.message}`]], '');
      }
    };

    const title = h('input', { class: 'input', value: draft.title, maxlength: 256, placeholder: 'e.g. What should we play on Friday?' });
    const message = h('textarea', { class: 'textarea', rows: 3, maxlength: 900, placeholder: 'More about the poll (optional)' }, draft.message);
    const styleSel = selectEl([['embed', 'Card (embed)'], ['text', 'Plain message']], draft.style, (v) => { draft.style = v; colorWrap.style.display = v === 'embed' ? '' : 'none'; drawPreview(); });
    const color = h('input', { type: 'color', class: 'color-input', value: `#${(draft.color ?? 0x7f8cf0).toString(16).padStart(6, '0')}` });
    const colorWrap = h('div', { style: { display: draft.style === 'embed' ? '' : 'none' } }, field('Card colour', color));
    const multiple = switchEl(draft.multiple !== false, (v) => { draft.multiple = v; oneHint.style.display = v ? 'none' : ''; drawPreview(); }, 'Members can pick more than one answer');
    const oneHint = h('p', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)', margin: '-6px 0 0', display: draft.multiple !== false ? 'none' : '' } }, 'When someone picks another answer, the bot takes back their old reaction. That needs Manage Messages, and only happens while this app is running.');
    for (const el of [title, message]) el.addEventListener('input', drawPreviewSoon);
    color.addEventListener('input', () => { draft.color = parseInt(color.value.slice(1), 16); drawPreview(); });

    const answersHost = h('div', { class: 'stack', style: { gap: '8px' } });
    const countLabel = h('div', { class: 'label grow' });
    const addBtn = h('button', { class: 'btn sm', type: 'button' }, icon('plus'), 'Add an answer');
    addBtn.addEventListener('click', () => {
      const [name, colorName] = POLL_STARTERS.find(([e]) => !draft.options.some((o) => sameEmojiUi(o.emoji, { name: e }))) || POLL_STARTERS[0];
      draft.options.push({ emoji: { name }, label: '', color: colorName });
      drawAnswers();
    });

    // A new emoji brings its own bar colour; the colour can still be changed after.
    const matchColor = async (answer, i) => {
      try {
        answer.color = await api('polls:emojiColor', answer.emoji, i);
      } catch {
        // keep the current colour
      }
      drawAnswers();
    };

    function drawAnswers() {
      answersHost.replaceChildren(
        ...draft.options.map((answer, i) => {
          const emojiBtn = h('button', { class: 'emoji-btn big', type: 'button', title: 'Change emoji' }, emojiNode(answer.emoji, 26));
          emojiBtn.addEventListener('click', async () => {
            const emoji = await EmojiPicker.open(emojis);
            if (!emoji) return;
            if (draft.options.some((o, j) => j !== i && sameEmojiUi(o.emoji, emoji))) return toast('That emoji is already used in this poll.', 'error');
            answer.emoji = emoji;
            drawAnswers();
            matchColor(answer, i);
          });
          const text = h('input', { class: 'input', value: answer.label, maxlength: 55, placeholder: `Answer ${i + 1}` });
          text.addEventListener('input', () => { answer.label = text.value; drawPreviewSoon(); });
          const colorSel = selectEl(POLL_COLORS.map(([c, label, square]) => [c, `${square} ${label}`]), answer.color || 'blue', (v) => { answer.color = v; drawPreview(); });
          colorSel.classList.add('poll-color');
          colorSel.title = 'Bar colour';
          return h(
            'div',
            { class: 'rr-pair' },
            emojiBtn,
            h('div', { class: 'grow' }, text),
            colorSel,
            h('button', { class: 'icon-btn danger', type: 'button', title: 'Remove', disabled: draft.options.length <= POLL_MIN, onclick: () => { draft.options.splice(i, 1); drawAnswers(); } }, icon('x')),
          );
        }),
      );
      addBtn.disabled = draft.options.length >= POLL_MAX;
      countLabel.textContent = `Answers (${draft.options.length}/${POLL_MAX})`;
      drawPreview();
    }

    // A rough picture of the poll in Discord, with sample votes so the bar colours show.
    const preview = h('div', { class: 'rr-preview' });
    let previewTimer;
    function drawPreviewSoon() {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(drawPreview, 120);
    }
    function drawPreview() {
      const { votes, total, shares } = pollResults(draft.options, POLL_SAMPLE);
      const answerEls = draft.options.map((o, i) =>
        h(
          'div',
          { class: 'poll-preview-answer' },
          h('div', { class: 'rr-line' }, emojiNode(o.emoji, 18), h('b', null, o.label.trim() || `Answer ${i + 1}`)),
          h('div', null, h('span', { class: 'emoji-char poll-squares' }, pollSquares(o.color, shares[i])), h('b', null, ` ${Math.round(shares[i] * 100)}%`), ` · ${votesLabel(votes[i])}`),
        ),
      );
      const text = message.value.trim();
      const status = `📊 ${votesLabel(total)} · React to vote`;
      const inner = [
        h('div', { class: 'rr-title' }, title.value.trim() || 'Your question'),
        text ? h('div', { class: 'rr-text' }, text) : null,
        h('div', { class: 'poll-hint' }, draft.multiple !== false ? 'Select one or more answers' : 'Select one answer'),
        h('div', { class: 'rr-lines', style: { gap: '10px' } }, answerEls),
        h('div', { class: 'poll-footer' }, status),
      ];
      const bubble = draft.style === 'embed' ? h('div', { class: 'rr-embed', style: { borderLeftColor: color.value } }, inner) : h('div', { class: 'rr-plain' }, inner);
      const reactions = h('div', { class: 'row wrap', style: { gap: '6px', marginTop: '8px' } }, draft.options.map((o, i) => h('span', { class: 'rr-reaction' }, emojiNode(o.emoji, 16), h('span', null, String(votes[i] + 1)))));
      const botUser = App.bot(draft.botId);
      preview.replaceChildren(h('div', { class: 'rr-author' }, h('img', { class: 'avatar', src: userAvatar(botUser, 64), width: 32, height: 32, alt: '' }), h('b', null, displayName(botUser)), h('span', { class: 'badge peri' }, 'APP')), bubble, reactions);
    }

    loadGuilds();
    drawAnswers();

    return openModal({
      title: existing ? 'Edit poll' : 'New poll',
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
          field('Post in', channelSel, existing ? 'A posted poll stays in its channel, so it keeps its votes.' : null),
          field('Question', title),
          field('Message', message),
          h('div', { class: 'grid cols-2', style: { gap: '12px' } }, field('Look', styleSel), colorWrap),
          multiple,
          oneHint,
          h('div', { class: 'row', style: { marginTop: '4px' } }, countLabel, addBtn),
          answersHost,
          h('p', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)', margin: 0 } }, 'Each answer\'s bar starts in its emoji\'s colour. Pick another from the list next to it.'),
        ),
        h('div', null, h('div', { class: 'label', style: { marginBottom: '8px' } }, 'Preview (sample votes)'), preview, h('p', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)', marginTop: '10px' } }, 'The bot needs Send Messages, Embed Links, Add Reactions and Read Message History in the channel.')),
      ),
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        {
          label: existing ? 'Save and update poll' : 'Post in Discord',
          kind: 'primary',
          icon: 'send',
          onClick: async () => {
            if (!guildSel.value || !channelSel.value) throw new Error('Pick the server and channel to post in.');
            if (!title.value.trim()) throw new Error('Write the question.');
            if (draft.options.some((o) => !o.label.trim())) throw new Error('Write the text for every answer.');
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
            PollsPage.data = await api('polls:save', draft.botId, payload);
            toast(existing ? 'Poll updated' : `Posted in #${payload.channelName}`);
            PollsPage.rerender();
          },
        },
      ],
    });
  },
};

// Votes came in, or a /poll poll was found: refresh the list if it's showing.
let pollsRefresh;
onEvent('polls:changed', () => {
  clearTimeout(pollsRefresh);
  pollsRefresh = setTimeout(() => {
    if (App.route.page !== 'polls' || document.querySelector('#modal-root .modal')) return;
    PollsPage.load();
  }, 300);
});
