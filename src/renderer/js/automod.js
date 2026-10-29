// AutoMod tab: Discord's built-in AutoMod rules. Discord enforces them itself around the clock, so
// they keep working when the app and bot are offline. Owner only (the bot needs Manage Server).

const AUTOMOD_TYPES = {
  1: { name: 'Blocked words', icon: 'type', limit: 6, timeout: true, about: 'Blocks messages that contain words or phrases you list.' },
  4: { name: 'Common bad words', icon: 'shield', limit: 1, timeout: false, about: "Uses Discord's own lists of profanity, sexual content and slurs." },
  3: { name: 'Spam', icon: 'alert', limit: 1, timeout: false, about: 'Blocks messages that Discord thinks are spam.' },
  5: { name: 'Mass mentions', icon: 'users', limit: 1, timeout: true, about: 'Blocks messages that mention too many people or roles at once.' },
  6: { name: 'Member names', icon: 'users', limit: 1, timeout: false, editable: false, about: 'Checks member names and profiles for blocked words.' },
};
const AUTOMOD_PRESETS = [[1, 'Profanity'], [2, 'Sexual content'], [3, 'Slurs']];
const AUTOMOD_TIMEOUTS = [['60', '60 seconds'], ['300', '5 minutes'], ['600', '10 minutes'], ['3600', '1 hour'], ['86400', '1 day'], ['604800', '1 week']];
const ACTION = { BLOCK: 1, ALERT: 2, TIMEOUT: 3 };

const AutoModTab = {
  async load(ctx) {
    const { srv } = ctx;
    srv.automodLoading = true;
    try {
      srv.automod = await rest(ctx.botId, 'GET', `/guilds/${ctx.guildId}/auto-moderation/rules`);
      srv.automodError = null;
    } catch (err) {
      srv.automodError = err.code === 50013 ? 'The bot needs the Manage Server permission to see and change AutoMod rules.' : err.message;
    }
    srv.automodLoading = false;
    ctx.rerender();
  },

  render(ctx, el) {
    const { srv } = ctx;
    if (!srv.automod && !srv.automodLoading && !srv.automodError) AutoModTab.load(ctx);
    const rules = srv.automod || [];
    const count = (type) => rules.filter((r) => r.trigger_type === type).length;

    const addButtons = [1, 4, 3, 5].map((type) => {
      const t = AUTOMOD_TYPES[type];
      const full = count(type) >= t.limit;
      return h(
        'button',
        { class: 'btn sm', disabled: !srv.automod || full, title: full ? `Discord allows ${t.limit === 1 ? 'one rule' : `${t.limit} rules`} of this kind` : t.about, onclick: () => AutoModTab.edit(ctx, type) },
        icon('plus'),
        t.name,
      );
    });

    el.append(
      h(
        'div',
        { class: 'toolbar' },
        h('p', { class: 'muted grow', style: { maxWidth: '640px' } }, "Discord enforces these rules itself, around the clock, even when this app and your bot are offline. Matching messages are blocked before anyone sees them."),
        h('button', { class: 'btn sm', onclick: () => { srv.automod = null; AutoModTab.load(ctx); ctx.rerender(); } }, icon('refresh'), 'Reload'),
      ),
      h('div', { class: 'row wrap', style: { marginBottom: '16px' } }, h('span', { class: 'label' }, 'Add a rule'), addButtons),
    );

    if (srv.automodError) {
      el.append(h('div', { class: 'callout warn' }, icon('alert'), h('div', null, h('b', null, "Couldn't load AutoMod rules. "), srv.automodError)));
      return;
    }
    if (!srv.automod) {
      el.append(h('div', { class: 'loading-block' }, [1, 2].map(() => h('div', { class: 'skeleton' }))));
      return;
    }
    if (!rules.length) {
      el.append(h('div', { class: 'card' }, h('div', { class: 'empty' }, icon('bot'), h('h3', null, 'No AutoMod rules yet'), h('p', null, 'Add one above. "Common bad words" and "Spam" are a good start for most servers.'))));
      return;
    }
    el.append(h('div', { class: 'grid cols-2' }, rules.map((rule) => AutoModTab.ruleCard(ctx, rule))));
  },

  ruleCard(ctx, rule) {
    const t = AUTOMOD_TYPES[rule.trigger_type] || { name: 'Rule', icon: 'shield' };
    const toggle = switchEl(rule.enabled, (enabled) => AutoModTab.toggle(ctx, rule, enabled), rule.enabled ? 'On' : 'Off');
    return h(
      'div',
      { class: 'card rule-card' },
      h('div', { class: 'card-head' }, icon(t.icon), h('h3', { class: 'ellipsis' }, rule.name), toggle),
      h('div', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)' } }, t.name),
      h('div', { class: 'rule-meta' }, AutoModTab.summary(ctx, rule).map((text) => h('span', { class: 'chip' }, h('span', null, text)))),
      h(
        'div',
        { class: 'row', style: { marginTop: '12px' } },
        t.editable === false ? h('span', { class: 'subtle grow', style: { fontSize: 'calc(12rem / 14)' } }, 'Edit this one in Discord (Server Settings → AutoMod).') : h('button', { class: 'btn sm', onclick: () => AutoModTab.edit(ctx, rule.trigger_type, rule) }, icon('edit'), 'Edit'),
        h('div', { class: 'grow' }),
        h('button', { class: 'btn sm danger', onclick: () => AutoModTab.remove(ctx, rule) }, icon('trash'), 'Delete'),
      ),
    );
  },

  summary(ctx, rule) {
    const m = rule.trigger_metadata || {};
    const out = [];
    if (rule.trigger_type === 1) {
      if (m.keyword_filter?.length) out.push(`${m.keyword_filter.length} word${m.keyword_filter.length === 1 ? '' : 's'}`);
      if (m.regex_patterns?.length) out.push(`${m.regex_patterns.length} pattern${m.regex_patterns.length === 1 ? '' : 's'}`);
    }
    if (rule.trigger_type === 4) out.push(AUTOMOD_PRESETS.filter(([id]) => m.presets?.includes(id)).map(([, name]) => name).join(', ') || 'No lists');
    if (rule.trigger_type === 5) out.push(`Over ${m.mention_total_limit} mentions${m.mention_raid_protection_enabled ? ' · raid protection' : ''}`);
    if (m.allow_list?.length) out.push(`${m.allow_list.length} allowed`);
    for (const a of rule.actions || []) {
      if (a.type === ACTION.BLOCK) out.push('Blocks message');
      if (a.type === ACTION.ALERT) out.push(`Alerts #${ctx.srv.channels.find((c) => c.id === a.metadata?.channel_id)?.name || 'deleted-channel'}`);
      if (a.type === ACTION.TIMEOUT) out.push(`${AUTOMOD_TIMEOUTS.find(([s]) => Number(s) === a.metadata?.duration_seconds)?.[1] || `${a.metadata?.duration_seconds}s`} timeout`);
    }
    const exempt = (rule.exempt_roles?.length || 0) + (rule.exempt_channels?.length || 0);
    if (exempt) out.push(`${exempt} exempt`);
    return out;
  },

  async toggle(ctx, rule, enabled) {
    try {
      const updated = await rest(ctx.botId, 'PATCH', `/guilds/${ctx.guildId}/auto-moderation/rules/${rule.id}`, { body: { enabled } });
      Object.assign(rule, updated);
      toast(`${rule.name} is ${enabled ? 'on' : 'off'}`);
    } catch (err) {
      toastError(err);
    }
    ctx.rerender();
  },

  async remove(ctx, rule) {
    if (!(await confirmDialog({ title: `Delete "${rule.name}"?`, message: 'Discord stops enforcing it right away.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await rest(ctx.botId, 'DELETE', `/guilds/${ctx.guildId}/auto-moderation/rules/${rule.id}`);
      ctx.srv.automod = ctx.srv.automod.filter((r) => r.id !== rule.id);
      toast(`Deleted ${rule.name}`);
      ctx.rerender();
    } catch (err) {
      toastError(err);
    }
  },

  // Toggle chips for picking roles or channels (exemptions).
  picker(items, selected) {
    return h(
      'div',
      { class: 'chip-picker' },
      items.length
        ? items.map(([id, label, color]) => {
            const chip = h('span', { class: `chip toggle ${selected.has(id) ? 'on' : ''}` }, color ? h('span', { class: 'dot', style: { background: color } }) : null, h('span', null, label));
            chip.addEventListener('click', () => {
              if (selected.has(id)) selected.delete(id);
              else selected.add(id);
              chip.classList.toggle('on', selected.has(id));
            });
            return chip;
          })
        : h('span', { class: 'subtle' }, 'None'),
    );
  },

  async edit(ctx, type, rule) {
    const { srv } = ctx;
    const t = AUTOMOD_TYPES[type];
    const m = rule?.trigger_metadata || {};
    const actionOf = (kind) => rule?.actions?.find((a) => a.type === kind);
    const lines = (list) => (list || []).join('\n');
    const parse = (text) => [...new Set(text.split(/\n/).map((s) => s.trim()).filter(Boolean))];
    const textChannels = srv.channels.filter((c) => c.type === 0 || c.type === 5).sort((a, b) => a.position - b.position);

    const name = h('input', { class: 'input', value: rule?.name || t.name, maxlength: 100 });
    const keywords = h('textarea', { class: 'textarea', rows: 5, placeholder: 'One word or phrase per line. Use * as a wildcard, e.g. *scam* or free nitro*' }, lines(m.keyword_filter));
    const regex = h('textarea', { class: 'textarea mono', rows: 2, placeholder: 'Optional regular expressions, one per line (Rust syntax)' }, lines(m.regex_patterns));
    const allow = h('textarea', { class: 'textarea', rows: 2, placeholder: 'Words that never trigger this rule, one per line' }, lines(m.allow_list));
    const presets = new Set(rule ? m.presets || [] : [1, 2, 3]);
    const mentionLimit = h('input', { class: 'input', type: 'number', min: 1, max: 50, value: m.mention_total_limit || 5 });
    let raidProtection = rule ? !!m.mention_raid_protection_enabled : true;

    let block = rule ? !!actionOf(ACTION.BLOCK) : true;
    let alert = !!actionOf(ACTION.ALERT);
    let timeout = !!actionOf(ACTION.TIMEOUT);
    const blockMessage = h('input', { class: 'input', maxlength: 150, placeholder: 'Optional message shown to the sender', value: actionOf(ACTION.BLOCK)?.metadata?.custom_message || '' });
    const alertChannel = selectEl([['', 'Pick a channel…'], ...textChannels.map((c) => [c.id, `#${c.name}`])], actionOf(ACTION.ALERT)?.metadata?.channel_id || '');
    const timeoutLength = selectEl(AUTOMOD_TIMEOUTS, String(actionOf(ACTION.TIMEOUT)?.metadata?.duration_seconds || 600));
    let enabled = rule ? rule.enabled : true;

    const exemptRoles = new Set(rule?.exempt_roles || []);
    const exemptChannels = new Set(rule?.exempt_channels || []);
    const roleItems = srv.roles.filter((r) => r.id !== srv.guild.id && !r.managed).sort((a, b) => b.position - a.position).map((r) => [r.id, r.name, roleColor(r)]);
    const channelItems = srv.channels.filter((c) => [0, 4, 5, 15].includes(c.type)).sort((a, b) => a.position - b.position).map((c) => [c.id, c.type === 4 ? c.name.toUpperCase() : `#${c.name}`]);

    // Built only for this rule's type: an element can only sit in one place on the page.
    const triggerFields = {
      1: () => [field('Words and phrases', keywords, 'Up to 1000, each up to 60 characters. Matching ignores capital letters.'), field('Patterns (advanced)', regex), field('Allowed words', allow)],
      4: () => [
        h('div', { class: 'label' }, 'Lists to use'),
        h(
          'div',
          { class: 'stack', style: { gap: '8px' } },
          AUTOMOD_PRESETS.map(([id, label]) => switchEl(presets.has(id), (on) => (on ? presets.add(id) : presets.delete(id)), label)),
        ),
        field('Allowed words', allow),
      ],
      3: () => [h('p', { class: 'muted' }, "Discord decides what counts as spam. There's nothing to set up besides what happens to it.")],
      5: () => [field('Most mentions allowed in one message', mentionLimit, 'Messages with more unique user and role mentions than this are blocked (1 to 50).'), switchEl(raidProtection, (v) => (raidProtection = v), 'Raid protection: also catch mention raids across several messages')],
    };

    const body = [
      field('Rule name', name),
      ...triggerFields[type](),
      h('div', { class: 'label', style: { marginTop: '6px' } }, 'When it matches'),
      h('div', { class: 'stack', style: { gap: '10px' } }, switchEl(block, (v) => (block = v), 'Block the message'), blockMessage),
      h('div', { class: 'stack', style: { gap: '10px' } }, switchEl(alert, (v) => (alert = v), 'Post an alert in a channel'), alertChannel),
      t.timeout ? h('div', { class: 'stack', style: { gap: '10px' } }, switchEl(timeout, (v) => (timeout = v), 'Time out the sender'), timeoutLength) : null,
      field('Roles it ignores', AutoModTab.picker(roleItems, exemptRoles), 'Click to toggle. Members with these roles are never stopped.'),
      field('Channels it ignores', AutoModTab.picker(channelItems, exemptChannels)),
      switchEl(enabled, (v) => (enabled = v), 'Rule is on'),
    ];

    const save = async () => {
      const metadata = {};
      if (type === 1) {
        metadata.keyword_filter = parse(keywords.value);
        metadata.regex_patterns = parse(regex.value);
        metadata.allow_list = parse(allow.value);
        if (!metadata.keyword_filter.length && !metadata.regex_patterns.length) throw new Error('Add at least one word, phrase or pattern.');
        if (metadata.keyword_filter.some((k) => k.length > 60)) throw new Error('Each word or phrase can be at most 60 characters.');
        if (metadata.regex_patterns.length > 10) throw new Error('Discord allows up to 10 patterns per rule.');
      }
      if (type === 4) {
        metadata.presets = [...presets].sort();
        metadata.allow_list = parse(allow.value);
        if (!metadata.presets.length) throw new Error('Pick at least one list.');
      }
      if (type === 5) {
        const limit = Number(mentionLimit.value);
        if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('Pick a mention limit from 1 to 50.');
        metadata.mention_total_limit = limit;
        metadata.mention_raid_protection_enabled = raidProtection;
      }
      const actions = [];
      if (block) actions.push({ type: ACTION.BLOCK, metadata: blockMessage.value.trim() ? { custom_message: blockMessage.value.trim() } : {} });
      if (alert) {
        if (!alertChannel.value) throw new Error('Pick the channel for alerts.');
        actions.push({ type: ACTION.ALERT, metadata: { channel_id: alertChannel.value } });
      }
      if (t.timeout && timeout) actions.push({ type: ACTION.TIMEOUT, metadata: { duration_seconds: Number(timeoutLength.value) } });
      if (!actions.length) throw new Error('Pick at least one thing to do when the rule matches.');

      const payload = {
        name: name.value.trim() || t.name,
        event_type: 1,
        actions,
        enabled,
        exempt_roles: [...exemptRoles],
        exempt_channels: [...exemptChannels],
        ...(type === 3 ? {} : { trigger_metadata: metadata }),
      };
      const path = `/guilds/${ctx.guildId}/auto-moderation/rules`;
      const saved = rule
        ? await rest(ctx.botId, 'PATCH', `${path}/${rule.id}`, { body: payload, reason: 'AutoMod rule changed in Discord Server Builder' })
        : await rest(ctx.botId, 'POST', path, { body: { ...payload, trigger_type: type }, reason: 'AutoMod rule added in Discord Server Builder' });
      srv.automod = rule ? srv.automod.map((r) => (r.id === saved.id ? saved : r)) : [...srv.automod, saved];
      toast(rule ? `Saved ${saved.name}` : `Added ${saved.name}`);
      ctx.rerender();
    };

    return openModal({
      title: rule ? `Edit ${rule.name}` : `New rule: ${t.name}`,
      wide: true,
      body: [h('p', { class: 'muted' }, t.about), ...body],
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        { label: rule ? 'Save' : 'Add rule', kind: 'primary', icon: 'check', onClick: save },
      ],
    });
  },
};
