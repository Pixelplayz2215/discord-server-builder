// Channel permissions overlay: every role/member override on a channel, shown the way Discord does
// (allow / inherit / deny per permission). The owner can edit what the bot is able to manage;
// moderators and bots without Manage Permissions get a read-only view.

// [bit, name, description]
const PERMISSION_GROUPS = [
  {
    title: 'General',
    perms: [
      [10, 'View Channel', 'See this channel. Turning it off makes the channel private.'],
      [4, 'Manage Channel', 'Rename, change the topic and settings, or delete the channel.'],
      [28, 'Manage Permissions', 'Change the permission overrides on this channel.'],
      [29, 'Manage Webhooks', 'Create, edit and delete webhooks.'],
      [0, 'Create Invite', 'Invite people to the server through this channel.'],
    ],
  },
  {
    title: 'Text',
    perms: [
      [11, 'Send Messages', 'Post messages (create posts in forums).'],
      [38, 'Send Messages in Threads', 'Reply inside threads.'],
      [35, 'Create Public Threads', 'Start threads anyone can see.'],
      [36, 'Create Private Threads', 'Start invite-only threads.'],
      [14, 'Embed Links', 'Links show a preview.'],
      [15, 'Attach Files', 'Upload images and files.'],
      [6, 'Add Reactions', 'Add new reactions to messages.'],
      [18, 'Use External Emoji', 'Use emoji from other servers.'],
      [37, 'Use External Stickers', 'Use stickers from other servers.'],
      [17, 'Mention @everyone, @here and All Roles', 'Ping everyone or any role.'],
      [13, 'Manage Messages', 'Delete or pin other people\'s messages.'],
      [34, 'Manage Threads', 'Rename, archive, lock and delete threads.'],
      [16, 'Read Message History', 'See messages sent before they opened the channel.'],
      [12, 'Send Text-to-Speech Messages', 'Send /tts messages.'],
      [46, 'Send Voice Messages', 'Record and send voice messages.'],
      [49, 'Create Polls', 'Start polls.'],
      [31, 'Use Application Commands', 'Use slash commands and context menus.'],
      [50, 'Use External Apps', 'Use apps from outside the server.'],
    ],
  },
  {
    title: 'Voice',
    voice: true,
    perms: [
      [20, 'Connect', 'Join the voice channel.'],
      [21, 'Speak', 'Talk in the voice channel.'],
      [9, 'Video', 'Share camera or screen.'],
      [39, 'Use Activities', 'Start or join activities.'],
      [42, 'Use Soundboard', 'Play soundboard sounds.'],
      [45, 'Use External Sounds', 'Play sounds from other servers.'],
      [25, 'Use Voice Activity', 'Talk without push-to-talk.'],
      [8, 'Priority Speaker', 'Be easier to hear when talking.'],
      [22, 'Mute Members', 'Mute others for everyone.'],
      [23, 'Deafen Members', 'Deafen others for everyone.'],
      [24, 'Move Members', 'Move or disconnect people from voice.'],
      [48, 'Set Voice Channel Status', 'Change the channel status text.'],
      [32, 'Request to Speak', 'Ask to speak in a stage.', 'stage'],
    ],
  },
  {
    title: 'Events',
    voice: true,
    perms: [
      [44, 'Create Events', 'Schedule events in this channel.'],
      [33, 'Manage Events', 'Edit and cancel events.'],
    ],
  },
];

const bit = (n) => 1n << BigInt(n);
const VOICE_TYPES = new Set([2, 13]);

const ChannelPerms = {
  // Groups that apply to a channel type: text-like channels skip voice; categories show everything.
  groupsFor(type) {
    return PERMISSION_GROUPS.filter((g) => !g.voice || type === 4 || VOICE_TYPES.has(type)).map((g) => ({
      ...g,
      perms: g.perms.filter(([, , , only]) => !only || type === 4 || type === 13),
    }));
  },

  async open(ctx, ch) {
    const { srv, guildId } = ctx;
    const botBits = ServerPage.perms(ctx);
    const admin = (botBits & PERM.ADMINISTRATOR) !== 0n;
    const readOnly = ctx.mod || !(admin || botBits & PERM.MANAGE_ROLES);
    // Discord only lets the bot grant or deny permissions it has itself.
    const canManage = (b) => !readOnly && (admin || (botBits & b) !== 0n);

    const toEntry = (o) => ({ type: o.type, allow: BigInt(o.allow), deny: BigInt(o.deny) });
    const original = new Map((ch.permission_overwrites || []).map((o) => [o.id, toEntry(o)]));
    const draft = new Map([...original].map(([id, o]) => [id, { ...o }]));
    const names = new Map(); // member id -> member, filled in below
    let selected = guildId;
    let saveBtn;

    for (const m of [...(srv.members || []), ...Object.values(srv.lookups || {})]) names.set(m.user.id, m);
    const unknownMembers = [...original].filter(([id, o]) => o.type === 1 && !names.has(id)).map(([id]) => id);

    const roleOf = (id) => srv.roles.find((r) => r.id === id);
    const entry = (id) => draft.get(id) || { type: roleOf(id) ? 0 : 1, allow: 0n, deny: 0n };
    const changes = () => {
      const list = [];
      for (const [id, o] of draft) {
        const before = original.get(id);
        const empty = o.allow === 0n && o.deny === 0n;
        if (empty && before) list.push({ id, remove: true });
        else if (!empty && (!before || before.allow !== o.allow || before.deny !== o.deny)) list.push({ id, ...o });
      }
      for (const id of original.keys()) if (!draft.has(id)) list.push({ id, remove: true });
      return list;
    };
    const updateSave = () => {
      if (!saveBtn) return;
      const n = changes().length;
      saveBtn.disabled = n === 0;
      saveBtn.lastChild.textContent = n ? `Save ${n} change${n === 1 ? '' : 's'}` : 'Save changes';
    };

    const label = (id) => {
      if (id === guildId) return { name: '@everyone', kind: 'Role', dot: '#99aab5' };
      const role = roleOf(id);
      if (role) return { name: `@${role.name}`, kind: 'Role', dot: roleColor(role) };
      const m = names.get(id);
      return { name: m ? m.nick || displayName(m.user) : `Member ${id}`, kind: 'Member', avatar: m ? memberAvatar(guildId, m, 64) : null };
    };

    // Targets: @everyone first, then roles high to low, then members.
    const targets = () => {
      const ids = new Set([guildId, ...draft.keys()]);
      const roles = [...ids].filter((id) => id !== guildId && roleOf(id)).sort((a, b) => roleOf(b).position - roleOf(a).position);
      const members = [...ids].filter((id) => id !== guildId && !roleOf(id));
      return [guildId, ...roles, ...members];
    };

    const left = h('div', { class: 'perm-targets' });
    const right = h('div', { class: 'perm-list' });

    const drawLeft = () => {
      const pending = new Set(changes().map((c) => c.id));
      const rows = targets().map((id) => {
        const l = label(id);
        const o = entry(id);
        const count = o.allow || o.deny ? `${countBits(o.allow)} ✓ · ${countBits(o.deny)} ✗` : 'No changes';
        return h(
          'button',
          { class: `perm-target ${selected === id ? 'active' : ''}`, onclick: () => { selected = id; draw(); } },
          l.avatar ? h('img', { class: 'avatar', src: l.avatar, width: 22, height: 22, alt: '' }) : h('span', { class: 'dot', style: { background: l.dot } }),
          h('span', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'ellipsis', style: { fontWeight: 600 } }, l.name), h('div', { class: 'subtle', style: { fontSize: 'calc(11rem / 14)' } }, count)),
          pending.has(id) ? h('span', { class: 'changed-dot', title: 'Unsaved change' }) : null,
        );
      });
      const adders = readOnly
        ? null
        : h(
            'div',
            { class: 'stack', style: { gap: '6px', marginTop: '8px' } },
            selectEl(
              [['', '+ Add a role…'], ...srv.roles.filter((r) => r.id !== guildId && !draft.has(r.id)).sort((a, b) => b.position - a.position).map((r) => [r.id, r.name])],
              '',
              (id) => {
                if (!id) return;
                draft.set(id, { type: 0, allow: 0n, deny: 0n });
                selected = id;
                draw();
              },
              'select sm',
            ),
            h('button', { class: 'btn sm ghost', onclick: () => ChannelPerms.addMember(ctx, draft, names, (id) => { selected = id; draw(); }) }, icon('userPlus'), 'Add a member'),
          );
      left.replaceChildren(h('div', { class: 'side-label', style: { padding: '0 4px 6px' } }, 'Roles and members'), ...rows, adders);
    };

    const tri = (id, b) => {
      const o = entry(id);
      const state = o.allow & b ? 'allow' : o.deny & b ? 'deny' : 'neutral';
      const enabled = canManage(b);
      const set = (next) => {
        const cur = { ...entry(id) };
        cur.allow &= ~b;
        cur.deny &= ~b;
        if (next === 'allow') cur.allow |= b;
        if (next === 'deny') cur.deny |= b;
        draft.set(id, cur);
        draw();
      };
      const opt = (value, ic, title) =>
        h('button', { class: `tri-btn ${value} ${state === value ? 'on' : ''}`, title, disabled: !enabled, onclick: () => set(value), 'aria-pressed': String(state === value) }, ic);
      return h(
        'div',
        { class: 'tri', title: enabled ? null : readOnly ? 'View only' : "The bot doesn't have this permission, so it can't grant or deny it." },
        opt('deny', icon('x'), 'Deny'),
        opt('neutral', h('b', null, '/'), 'Inherit (no override)'),
        opt('allow', icon('check'), 'Allow'),
      );
    };

    const drawRight = () => {
      const l = label(selected);
      const removable = !readOnly && draft.has(selected);
      const head = h(
        'div',
        { class: 'perm-head' },
        h('div', { class: 'grow' }, h('h3', { class: 'ellipsis' }, l.name), h('div', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)' } }, `${l.kind} override · ✓ allow, / inherit, ✗ deny`)),
        removable
          ? h('button', { class: 'btn sm danger', onclick: () => { draft.delete(selected); selected = guildId; draw(); } }, icon('trash'), 'Remove override')
          : null,
      );
      const groups = ChannelPerms.groupsFor(ch.type).map((g) =>
        h(
          'div',
          { class: 'perm-group' },
          h('div', { class: 'side-label', style: { padding: '14px 0 4px' } }, `${g.title} permissions`),
          g.perms.map(([n, name, desc]) =>
            h('div', { class: 'perm-row' }, h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, name), h('div', { class: 'subtle', style: { fontSize: 'calc(12rem / 14)' } }, desc)), tri(selected, bit(n))),
          ),
        ),
      );
      right.replaceChildren(head, ...groups);
    };

    const draw = () => {
      const scroll = right.scrollTop;
      drawLeft();
      drawRight();
      right.scrollTop = scroll;
      updateSave();
    };

    // Discord calls a channel "synced" when its overrides match its category's exactly.
    const parent = ch.parent_id ? srv.channels.find((c) => c.id === ch.parent_id) : null;
    const nonEmpty = (entries) => new Map([...entries].filter(([, o]) => o.allow || o.deny));
    const synced = (() => {
      if (!parent) return false;
      const a = nonEmpty(original);
      const b = nonEmpty((parent.permission_overwrites || []).map((o) => [o.id, toEntry(o)]));
      return a.size === b.size && [...a].every(([id, o]) => b.get(id)?.allow === o.allow && b.get(id)?.deny === o.deny);
    })();

    const notes = [];
    if (ctx.mod) notes.push(h('div', { class: 'callout' }, icon('info'), h('div', null, 'View only. Only the server owner can change channel permissions.')));
    else if (readOnly) notes.push(h('div', { class: 'callout warn' }, icon('alert'), h('div', null, h('b', null, 'View only. '), 'The bot needs the Manage Roles permission (or Administrator) to change channel permissions.')));
    if (parent) {
      notes.push(
        h(
          'div',
          { class: 'row subtle perm-sync' },
          icon('folder'),
          h('span', { class: 'grow' }, synced ? `Synced with the ${parent.name} category.` : `Not synced with the ${parent.name} category.`),
          readOnly || synced
            ? null
            : h(
                'button',
                {
                  class: 'btn sm',
                  onclick: () => {
                    draft.clear();
                    for (const o of parent.permission_overwrites || []) draft.set(o.id, toEntry(o));
                    selected = guildId;
                    draw();
                    toast('Copied the category\'s permissions. Save to apply them.', 'info');
                  },
                },
                icon('refresh'),
                'Sync with category',
              ),
        ),
      );
    }

    const save = async () => {
      const list = changes();
      const reason = 'Channel permissions changed in Discord Server Builder';
      let failed = 0;
      for (const c of list) {
        try {
          if (c.remove) await rest(ctx.botId, 'DELETE', `/channels/${ch.id}/permissions/${c.id}`, { reason });
          else await rest(ctx.botId, 'PUT', `/channels/${ch.id}/permissions/${c.id}`, { body: { type: c.type, allow: String(c.allow), deny: String(c.deny) }, reason });
        } catch (err) {
          failed++;
          toast(`${label(c.id).name}: ${err.message}`, 'error');
        }
      }
      try {
        ChannelsTab.replaceChannel(ctx, await rest(ctx.botId, 'GET', `/channels/${ch.id}`));
      } catch (err) {
        toastError(err);
      }
      if (list.length - failed) toast(`Saved ${list.length - failed} permission change${list.length - failed === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}`);
      ctx.rerender();
    };

    draw();
    const modal = openModal({
      title: `Permissions · ${VOICE_TYPES.has(ch.type) ? '🔊' : ch.type === 4 ? '' : '#'}${ch.name}`,
      wide: 'xl',
      body: [...notes, h('div', { class: 'perm-editor' }, left, right)],
      actions: readOnly
        ? [{ label: 'Close', kind: 'primary' }]
        : [
            { label: 'Cancel', kind: 'ghost' },
            { label: 'Save changes', kind: 'primary', icon: 'save', disabled: true, ref: (b) => (saveBtn = b), onClick: save },
          ],
    });
    updateSave();

    // Fill in names for member overrides we don't have cached yet.
    if (unknownMembers.length) {
      await Promise.all(
        unknownMembers.map((id) =>
          rest(ctx.botId, 'GET', `/guilds/${guildId}/members/${id}`).then((m) => names.set(id, m), () => {}),
        ),
      );
      draw();
    }
    return modal;
  },

  async addMember(ctx, draft, names, onAdded) {
    const input = h('input', { class: 'input mono', placeholder: 'User ID, e.g. 123456789012345678' });
    await openModal({
      title: 'Add a member override',
      body: [field('User ID', input, 'Right-click someone in Discord → Copy User ID (needs Developer Mode).')],
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        {
          label: 'Add',
          kind: 'primary',
          icon: 'plus',
          onClick: async () => {
            const id = input.value.trim();
            if (!isSnowflake(id)) {
              toast('That is not a valid user ID.', 'error');
              return false;
            }
            const member = await rest(ctx.botId, 'GET', `/guilds/${ctx.guildId}/members/${id}`);
            names.set(id, member);
            if (!draft.has(id)) draft.set(id, { type: 1, allow: 0n, deny: 0n });
            onAdded(id);
          },
        },
      ],
    });
  },
};

function countBits(n) {
  let count = 0;
  for (let v = n; v; v &= v - 1n) count++;
  return count;
}
