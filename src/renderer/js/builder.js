// Builder tab: pick or edit a template (roles, categories, channels) and build it into the server.

const Builder = {
  active: null, // progress UI of the build that is running
  drag: null, // { list, index, group } while dragging a row

  state(ctx) {
    const { srv } = ctx;
    if (!srv.builder) {
      const template = Builder.normalize(cloneTemplate(BUILTIN_TEMPLATES[0]));
      srv.builder = {
        template,
        selectedId: template.id,
        dirty: false,
        opts: { renameServer: false, serverName: template.serverName || srv.guild.name, wipeChannels: false, wipeRoles: false },
      };
    }
    return srv.builder;
  },

  normalize(t) {
    const newKey = () => `r_${Math.random().toString(36).slice(2, 9)}`;
    const roles = (Array.isArray(t.roles) ? t.roles : []).map((r) => ({
      key: r.key || newKey(),
      name: String(r.name || ''),
      color: /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : '#99aab5',
      hoist: !!r.hoist,
      mentionable: !!r.mentionable,
      perms: ['admin', 'manager', 'moderator', 'member', 'none', 'custom'].includes(r.perms) ? r.perms : 'none',
      ...(r.perms === 'custom' ? { permissions: String(r.permissions || '0') } : {}),
    }));
    const categories = (Array.isArray(t.categories) ? t.categories : []).map((c) => ({
      name: String(c.name || ''),
      private: Array.isArray(c.private) ? c.private : [],
      readonly: !!c.readonly,
      channels: (Array.isArray(c.channels) ? c.channels : []).map((ch) => ({
        type: ['text', 'voice', 'announcement', 'forum', 'stage'].includes(ch.type) ? ch.type : 'text',
        name: String(ch.name || ''),
        topic: ch.topic || '',
        private: Array.isArray(ch.private) ? ch.private : [],
        readonly: !!ch.readonly,
        system: !!ch.system,
        slowmode: Number(ch.slowmode) || 0,
        nsfw: !!ch.nsfw,
        userLimit: Number(ch.userLimit) || 0,
      })),
    }));
    return { id: t.id, name: t.name || 'Untitled', icon: t.icon || '📁', description: t.description || '', serverName: t.serverName || '', roles, categories };
  },

  // What gets sent to the builder: names trimmed, empty rows dropped, dangling role keys removed.
  sanitize(t) {
    const roles = t.roles.filter((r) => r.name.trim()).map((r) => ({ ...r, name: r.name.trim() }));
    const keys = new Set(roles.map((r) => r.key));
    const clean = (node) => ({ ...node, private: node.private.filter((k) => keys.has(k)) });
    const categories = t.categories
      .map((c) => ({ ...clean(c), name: c.name.trim(), channels: c.channels.filter((ch) => ch.name.trim()).map((ch) => ({ ...clean(ch), name: ch.name.trim() })) }))
      .filter((c) => c.name || c.channels.length);
    return { ...t, roles, categories };
  },

  counts(t) {
    return {
      roles: t.roles.filter((r) => r.name.trim()).length,
      categories: t.categories.filter((c) => c.name.trim()).length,
      channels: t.categories.reduce((n, c) => n + c.channels.filter((ch) => ch.name.trim()).length, 0),
    };
  },

  render(ctx, el) {
    const b = Builder.state(ctx);
    const host = h('div');
    const redraw = () => {
      const main = document.getElementById('bot-main');
      const scroll = main?.scrollTop;
      host.replaceChildren(Builder.view(ctx, b, redraw));
      if (main) main.scrollTop = scroll;
    };
    el.append(host);
    redraw();
  },

  view(ctx, b, redraw) {
    const t = b.template;
    const dirty = () => (b.dirty = true);

    const cloneBtn = h('button', { class: 'btn sm', title: 'Copy this server\'s current roles and channels into a template' }, icon('copy'), 'Clone this server');
    cloneBtn.addEventListener('click', withBusy(cloneBtn, () => Builder.cloneCurrent(ctx, b, redraw)));

    return h(
      'div',
      null,
      h(
        'div',
        { class: 'row', style: { marginBottom: '18px', alignItems: 'flex-end' } },
        h(
          'div',
          { class: 'grow' },
          h('span', { class: 'eyebrow' }, 'Server builder'),
          h('h2', { style: { marginTop: '6px' } }, 'Design your layout'),
          h('p', { class: 'muted', style: { marginTop: '4px' } }, `Pick a template, tweak the roles and channels, then build it into ${ctx.srv.guild.name}.`),
        ),
        cloneBtn,
        h('button', { class: 'btn sm', onclick: () => Builder.importTemplate(b, redraw) }, icon('upload'), 'Import'),
        h('button', { class: 'btn sm', onclick: () => api('templates:export', Builder.sanitize(t)).then((p) => p && toast(`Exported to ${p}`), toastError) }, icon('download'), 'Export'),
        h('button', { class: 'btn sm teal', onclick: () => Builder.saveTemplate(b, redraw) }, icon('save'), 'Save as template'),
      ),

      Builder.templateStrip(ctx, b, redraw),

      h(
        'div',
        { class: 'card', style: { padding: '16px', marginBottom: '16px' } },
        h('div', { class: 'card-head' }, icon('tag'), h('h3', null, `Roles (${t.roles.length})`), h('button', { class: 'btn sm', onclick: () => { t.roles.push({ key: `r_${Math.random().toString(36).slice(2, 9)}`, name: 'New role', color: '#7f8cf0', hoist: false, mentionable: false, perms: 'none' }); dirty(); redraw(); } }, icon('plus'), 'Add role')),
        h('p', { class: 'subtle', style: { fontSize: '12px', margin: '-6px 0 10px' } }, 'Top of the list is the highest role. Roles are created just below the bot\'s own role. Drag ⠿ to reorder.'),
        t.roles.length
          ? h('div', { class: 'role-grid' }, t.roles.map((role, i) => Builder.roleRow(t, role, i, dirty, redraw)))
          : h('p', { class: 'subtle' }, 'No roles — the build will only create channels.'),
      ),

      h('div', { class: 'section-title', style: { margin: '0 0 12px' } }, h('h3', { class: 'grow' }, 'Categories & channels')),
      t.categories.map((cat, i) => Builder.categoryCard(t, cat, i, dirty, redraw)),
      h('button', { class: 'btn', onclick: () => { t.categories.push({ name: 'NEW CATEGORY', private: [], readonly: false, channels: [] }); dirty(); redraw(); } }, icon('folder'), 'Add category'),

      Builder.buildBar(ctx, b, redraw),
    );
  },

  templateStrip(ctx, b, redraw) {
    const choose = async (tpl) => {
      if (b.dirty && !(await confirmDialog({ title: 'Discard your changes?', message: 'Switching templates replaces the layout you edited.', confirmLabel: 'Switch template', danger: true }))) return;
      b.template = Builder.normalize(cloneTemplate(tpl));
      b.selectedId = tpl.id;
      b.dirty = false;
      b.opts.serverName = tpl.serverName || ctx.srv.guild.name;
      redraw();
    };
    const card = (tpl) => {
      const counts = Builder.counts(tpl);
      return h(
        'div',
        { class: `tpl-card ${b.selectedId === tpl.id ? 'active' : ''}`, role: 'button', tabindex: 0, onclick: () => choose(tpl), onkeydown: (e) => e.key === 'Enter' && choose(tpl) },
        h('div', { class: 'emoji' }, tpl.icon || '📁'),
        h('div', { class: 'name ellipsis' }, tpl.name),
        h('div', { class: 'desc' }, tpl.description || `${counts.roles} roles · ${counts.channels} channels`),
        tpl.builtin
          ? null
          : h(
              'button',
              {
                class: 'icon-btn danger del',
                title: 'Delete saved template',
                onclick: async (e) => {
                  e.stopPropagation();
                  if (!(await confirmDialog({ title: `Delete "${tpl.name}"?`, message: 'The saved template is removed from this PC.', confirmLabel: 'Delete', danger: true }))) return;
                  await api('templates:delete', tpl.id).catch(toastError);
                  App.savedTemplates = App.savedTemplates.filter((x) => x.id !== tpl.id);
                  redraw();
                },
              },
              icon('trash'),
            ),
      );
    };
    return h('div', { class: 'tpl-strip' }, [...BUILTIN_TEMPLATES, ...App.savedTemplates].map(card));
  },

  // Drag-and-drop reordering, started from the row's grip so inputs stay selectable.
  sortable(row, list, index, group, redraw) {
    const grip = h('span', { class: 'grip', title: 'Drag to reorder' }, icon('grip'));
    grip.addEventListener('mousedown', () => (row.draggable = true));
    grip.addEventListener('mouseup', () => (row.draggable = false));
    row.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      Builder.drag = { list, index, group };
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      row.draggable = false;
      row.classList.remove('dragging');
      Builder.drag = null;
    });
    Builder.dropTarget(row, group, (d) => {
      const [item] = d.list.splice(d.index, 1);
      list.splice(index, 0, item);
      redraw();
    });
    return grip;
  },

  dropTarget(el, group, onDrop) {
    el.addEventListener('dragover', (e) => {
      if (Builder.drag?.group !== group) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.add('drop-target');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
    el.addEventListener('drop', (e) => {
      el.classList.remove('drop-target');
      const d = Builder.drag;
      if (!d || d.group !== group) return;
      e.preventDefault();
      e.stopPropagation();
      onDrop(d);
    });
  },

  roleRow(t, role, i, dirty, redraw) {
    const row = h('div', { class: 'role-row' });
    const color = h('input', { type: 'color', value: role.color, title: 'Role colour' });
    color.addEventListener('input', () => { role.color = color.value; dirty(); });
    const name = h('input', { class: 'input sm', value: role.name, placeholder: 'Role name', maxlength: 100 });
    name.addEventListener('input', () => { role.name = name.value; dirty(); });
    const presets = role.perms === 'custom' ? ROLE_PRESETS : ROLE_PRESETS.filter(([v]) => v !== 'custom');
    const perms = selectEl(presets, role.perms, (v) => { role.perms = v; dirty(); }, 'select sm');
    perms.title = 'Permission preset';
    const toggle = (prop, ic, title) => {
      const btn = h('button', { class: `icon-btn ${role[prop] ? 'on' : ''}`, title }, typeof ic === 'string' && ICON_PATHS[ic] ? icon(ic) : ic);
      btn.addEventListener('click', () => {
        role[prop] = !role[prop];
        btn.classList.toggle('on', role[prop]);
        dirty();
      });
      return btn;
    };
    const del = h('button', { class: 'icon-btn danger', title: 'Remove role' }, icon('trash'));
    del.addEventListener('click', () => {
      t.roles.splice(i, 1);
      for (const node of [...t.categories, ...t.categories.flatMap((c) => c.channels)]) node.private = node.private.filter((k) => k !== role.key);
      dirty();
      redraw();
    });
    row.append(
      Builder.sortable(row, t.roles, i, 'role', redraw),
      color,
      name,
      perms,
      toggle('hoist', 'layers', 'Show members separately'),
      toggle('mentionable', h('b', { style: { fontSize: '13px' } }, '@'), 'Anyone can @mention'),
      del,
    );
    return row;
  },

  async pickRoles(t, node, label) {
    if (!t.roles.length) return toast('Add some roles first — private channels are shown only to chosen roles.', 'info');
    const chosen = new Set(node.private);
    const chips = t.roles.map((role) => {
      const chip = h('span', { class: `chip toggle ${chosen.has(role.key) ? 'on' : ''}` }, h('span', { class: 'dot', style: { background: role.color } }), h('span', null, role.name || 'Unnamed role'));
      chip.addEventListener('click', () => {
        if (chosen.has(role.key)) chosen.delete(role.key);
        else chosen.add(role.key);
        chip.classList.toggle('on', chosen.has(role.key));
      });
      return chip;
    });
    const result = await openModal({
      title: `Who can see ${label}?`,
      body: [h('p', null, 'Only the chosen roles (and Administrators) will see it. Choose none to make it visible to everyone.'), h('div', { class: 'row wrap', style: { gap: '8px' } }, chips)],
      actions: [
        { label: 'Make public', kind: 'ghost', value: 'public' },
        { label: 'Save', kind: 'primary', value: 'save' },
      ],
    });
    if (result === 'public') node.private = [];
    else if (result === 'save') node.private = [...chosen];
    else return false;
    return true;
  },

  flag(on, ic, text, title, tone, onClick) {
    return h('button', { class: `flag ${on ? `on ${tone || ''}` : ''}`, title, onclick: onClick, type: 'button' }, icon(ic), text);
  },

  privateFlag(t, node, label, dirty, redraw) {
    const names = node.private.map((k) => t.roles.find((r) => r.key === k)?.name).filter(Boolean);
    return Builder.flag(names.length > 0, names.length ? 'eyeOff' : 'eye', names.length ? `${names.length}` : '', names.length ? `Private — visible to: ${names.join(', ')}` : 'Visible to everyone (click to make private)', 'pink', async () => {
      if (await Builder.pickRoles(t, node, label)) {
        dirty();
        redraw();
      }
    });
  },

  categoryCard(t, cat, ci, dirty, redraw) {
    const card = h('div', { class: 'cat-card' });
    const head = h('div', { class: 'cat-head' });
    const name = h('input', { class: 'input sm', value: cat.name, placeholder: '(no category — channels sit at the top)', maxlength: 100 });
    name.addEventListener('input', () => { cat.name = name.value; dirty(); });
    const readonly = Builder.flag(cat.readonly, 'lock', '', cat.readonly ? 'Read-only for @everyone (staff can post)' : 'Everyone can post (click for read-only)', 'gold', () => {
      cat.readonly = !cat.readonly;
      dirty();
      redraw();
    });
    const del = h('button', { class: 'icon-btn danger', title: 'Remove category and its channels' }, icon('trash'));
    del.addEventListener('click', () => {
      t.categories.splice(ci, 1);
      dirty();
      redraw();
    });
    head.append(Builder.sortable(card, t.categories, ci, 'category', redraw), icon('folder'), name, Builder.privateFlag(t, cat, cat.name || 'these channels', dirty, redraw), readonly, del);

    const addChannel = (type) => {
      cat.channels.push({ type, name: type === 'voice' ? 'New Voice' : 'new-channel', topic: '', private: [], readonly: false, system: false, slowmode: 0, nsfw: false, userLimit: 0 });
      dirty();
      redraw();
    };
    const addRow = h(
      'div',
      { class: 'add-row' },
      h('button', { class: 'btn sm ghost', onclick: () => addChannel('text') }, icon('hash'), 'Text'),
      h('button', { class: 'btn sm ghost', onclick: () => addChannel('voice') }, icon('voice'), 'Voice'),
      h('button', { class: 'btn sm ghost', onclick: () => addChannel('forum') }, icon('forum'), 'Forum'),
      h('button', { class: 'btn sm ghost', onclick: () => addChannel('announcement') }, icon('megaphone'), 'Announcement'),
    );
    // Dropping a channel on the add-row moves it to the end of this category.
    Builder.dropTarget(addRow, 'channel', (d) => {
      const [item] = d.list.splice(d.index, 1);
      cat.channels.push(item);
      redraw();
    });

    card.append(head, h('div', { class: 'cat-body' }, cat.channels.map((ch, i) => Builder.channelRow(t, cat, ch, i, dirty, redraw)), addRow));
    return card;
  },

  channelRow(t, cat, ch, i, dirty, redraw) {
    const row = h('div', { class: 'chan-row' });
    const voice = ch.type === 'voice' || ch.type === 'stage';
    const type = selectEl(CHANNEL_TYPE_OPTIONS, ch.type, (v) => { ch.type = v; dirty(); redraw(); }, 'select sm');
    const name = h('input', { class: 'input sm name', value: ch.name, placeholder: 'channel-name', maxlength: 100 });
    name.addEventListener('input', () => { ch.name = name.value; dirty(); });

    let detail;
    if (ch.type === 'voice') {
      detail = h('input', { class: 'input sm topic', type: 'number', min: 0, max: 99, value: ch.userLimit ? String(ch.userLimit) : '', placeholder: 'User limit (empty = no limit)' });
      detail.addEventListener('input', () => { ch.userLimit = Math.min(99, Math.max(0, Number(detail.value) || 0)); dirty(); });
    } else if (ch.type === 'stage') {
      detail = h('div', { class: 'topic subtle', style: { fontSize: '12px', paddingLeft: '4px' } }, 'Stage channels need a Community server (falls back to voice).');
    } else {
      detail = h('input', { class: 'input sm topic', value: ch.topic, placeholder: ch.type === 'forum' ? 'Post guidelines' : 'Topic (optional)', maxlength: 1024 });
      detail.addEventListener('input', () => { ch.topic = detail.value; dirty(); });
    }

    const readonly = voice
      ? h('span', { class: 'flag', style: { visibility: 'hidden' } }, icon('lock'))
      : Builder.flag(ch.readonly, 'lock', '', ch.readonly ? 'Read-only for @everyone (staff can post)' : 'Everyone can post (click for read-only)', 'gold', () => {
          ch.readonly = !ch.readonly;
          dirty();
          redraw();
        });
    const welcome =
      ch.type === 'text'
        ? Builder.flag(ch.system, 'pin', '', ch.system ? 'Welcome channel (join messages go here)' : 'Set as welcome channel', '', () => {
            const next = !ch.system;
            for (const c of t.categories.flatMap((x) => x.channels)) c.system = false;
            ch.system = next;
            dirty();
            redraw();
          })
        : h('span', { class: 'flag', style: { visibility: 'hidden' } }, icon('pin'));
    const del = h('button', { class: 'icon-btn danger', title: 'Remove channel' }, icon('trash'));
    del.addEventListener('click', () => {
      cat.channels.splice(i, 1);
      dirty();
      redraw();
    });

    row.append(
      Builder.sortable(row, cat.channels, i, 'channel', redraw),
      type,
      name,
      detail,
      Builder.privateFlag(t, ch, voice ? ch.name : `#${ch.name}`, dirty, redraw),
      readonly,
      welcome,
      del,
    );
    return row;
  },

  buildBar(ctx, b, redraw) {
    const { opts } = b;
    const counts = Builder.counts(b.template);
    const nameInput = h('input', { class: 'input sm', value: opts.serverName, placeholder: 'Server name', maxlength: 100, disabled: !opts.renameServer, style: { width: '220px' } });
    nameInput.addEventListener('input', () => (opts.serverName = nameInput.value));
    const buildBtn = h('button', { class: 'btn grad lg' }, icon('sparkles'), 'Build server');
    buildBtn.addEventListener('click', () => Builder.run(ctx, b, buildBtn));
    return h(
      'div',
      { class: 'build-bar' },
      h(
        'div',
        { class: 'stack', style: { gap: '10px' } },
        h('div', { class: 'row' }, switchEl(opts.renameServer, (v) => { opts.renameServer = v; nameInput.disabled = !v; }, 'Rename server to'), nameInput),
        h(
          'div',
          { class: 'row', style: { gap: '22px' } },
          switchEl(opts.wipeChannels, (v) => (opts.wipeChannels = v), 'Delete existing channels', true),
          switchEl(opts.wipeRoles, (v) => (opts.wipeRoles = v), 'Delete existing roles', true),
        ),
      ),
      h('div', { class: 'grow' }),
      h('div', { class: 'summary' }, h('b', null, counts.roles), ' roles · ', h('b', null, counts.categories), ' categories · ', h('b', null, counts.channels), ' channels'),
      buildBtn,
    );
  },

  async run(ctx, b, buildBtn) {
    const t = Builder.sanitize(b.template);
    const counts = Builder.counts(t);
    if (!counts.roles && !counts.channels && !counts.categories) return toast('Nothing to build — add some roles or channels.', 'error');
    const guild = ctx.srv.guild;
    const { opts } = b;
    const destructive = opts.wipeChannels || opts.wipeRoles;
    const steps = [];
    if (opts.wipeChannels) steps.push(`Delete all ${ctx.srv.channels.length} existing channels and categories`);
    if (opts.wipeRoles) steps.push('Delete every existing role the bot is allowed to manage');
    if (opts.renameServer && opts.serverName.trim()) steps.push(`Rename the server to "${opts.serverName.trim()}"`);
    steps.push(`Create ${counts.roles} roles, ${counts.categories} categories and ${counts.channels} channels`);

    const ok = await confirmDialog({
      title: `Build into ${guild.name}?`,
      message: h(
        'div',
        { class: 'stack', style: { gap: '10px' } },
        h('ul', { style: { margin: 0, paddingLeft: '18px', color: 'var(--muted)' } }, steps.map((s) => h('li', null, s))),
        destructive ? h('div', { class: 'callout warn' }, icon('alert'), h('div', null, h('b', null, 'Deleted channels and roles cannot be restored. '), 'Their messages are gone for good.')) : null,
      ),
      confirmLabel: 'Start build',
      danger: destructive,
      requireText: destructive ? guild.name : undefined,
    });
    if (!ok) return;

    const bar = h('div', { style: { width: '0%' } });
    const status = h('div', { class: 'muted ellipsis' }, 'Starting…');
    const log = h('div', { class: 'log' });
    let closeBtn;
    Builder.active = { botId: ctx.botId, guildId: ctx.guildId, total: 1, done: 0, bar, status, log };
    buildBtn.disabled = true;
    const modal = openModal({
      title: `Building ${guild.name}`,
      wide: true,
      dismissable: false,
      body: [status, h('div', { class: 'progress' }, bar), log],
      actions: [{ label: 'Close', kind: 'primary', disabled: true, ref: (btn) => (closeBtn = btn) }],
    });

    try {
      const stats = await api('builder:run', ctx.botId, ctx.guildId, t, { ...opts, serverName: opts.serverName.trim() });
      status.textContent = `Finished — ${stats.ok} done${stats.warnings ? `, ${stats.warnings} with fallbacks` : ''}${stats.failed ? `, ${stats.failed} failed` : ''}.`;
      status.className = stats.failed ? 'ellipsis' : 'ellipsis grad-text';
      log.append(h('div', { class: 'info' }, `Done: ${stats.ok} ok, ${stats.failed} failed.`));
      toast(stats.failed ? `Build finished with ${stats.failed} error(s)` : 'Server built!', stats.failed ? 'error' : 'ok');
      b.dirty = false;
    } catch (err) {
      status.textContent = `Build stopped: ${err.message}`;
      log.append(h('div', { class: 'error' }, err.message));
    } finally {
      bar.style.width = '100%';
      log.scrollTop = log.scrollHeight;
      Builder.active = null;
      buildBtn.disabled = false;
      if (closeBtn) closeBtn.disabled = false;
    }

    await modal;
    // Reload what the build changed.
    for (const key of ['members', 'audit', 'selectedChannelId']) delete ctx.srv[key];
    ctx.srv.guild = null;
    ServerPage.loadCore(ctx.botId, ctx.guildId);
    BotPage.loadGuilds(ctx.botId);
    App.renderMain();
  },

  onEvent(event) {
    const a = Builder.active;
    if (!a || a.botId !== event.botId || a.guildId !== event.guildId) return;
    if (event.type === 'start') a.total = Math.max(1, event.total);
    if (event.type === 'step') {
      a.done++;
      a.log.append(h('div', { class: event.level }, event.msg));
      a.log.scrollTop = a.log.scrollHeight;
      a.status.textContent = `${a.done} / ${a.total} — ${event.msg}`;
      a.bar.style.width = `${Math.min(100, (a.done / a.total) * 100)}%`;
    }
  },

  async cloneCurrent(ctx, b, redraw) {
    const template = Builder.normalize(await api('builder:clone', ctx.botId, ctx.guildId));
    await api('templates:save', template);
    App.savedTemplates = await api('templates:list');
    b.template = template;
    b.selectedId = template.id;
    b.dirty = false;
    redraw();
    toast(`Saved "${template.name}" — open any server's Builder tab (on any bot) to build it there.`);
  },

  async importTemplate(b, redraw) {
    try {
      const data = await api('templates:import');
      if (!data) return;
      b.template = Builder.normalize({ ...data, id: data.id || `import-${Date.now()}` });
      b.selectedId = null;
      b.dirty = true;
      redraw();
      toast(`Imported "${b.template.name}"`);
    } catch (err) {
      toastError(err);
    }
  },

  async saveTemplate(b, redraw) {
    const t = b.template;
    const existing = App.savedTemplates.find((x) => x.id === b.selectedId);
    const name = h('input', { class: 'input', value: existing ? existing.name : t.name.replace(/ \(copy\)$/, ''), maxlength: 60 });
    const emoji = h('input', { class: 'input', value: t.icon, maxlength: 4, style: { width: '70px', textAlign: 'center', fontSize: '18px' } });
    const desc = h('input', { class: 'input', value: t.description, placeholder: 'What is this layout for?', maxlength: 140 });
    const result = await openModal({
      title: existing ? `Save "${existing.name}"` : 'Save as template',
      body: [
        h('div', { class: 'row', style: { alignItems: 'flex-end' } }, field('Icon', emoji), h('div', { class: 'grow' }, field('Name', name))),
        field('Description', desc),
        existing ? h('p', { class: 'subtle', style: { fontSize: '12px' } }, 'This overwrites the saved template you started from.') : null,
      ],
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        { label: 'Save', kind: 'primary', icon: 'save', value: true },
      ],
    });
    if (!result) return;
    const id = existing ? existing.id : `user-${Date.now()}`;
    try {
      await api('templates:save', { ...Builder.sanitize(t), id, name: name.value.trim() || 'My template', icon: emoji.value.trim() || '📁', description: desc.value.trim() });
      App.savedTemplates = await api('templates:list');
      b.template.name = name.value.trim() || 'My template';
      b.selectedId = id;
      b.dirty = false;
      redraw();
      toast('Template saved');
    } catch (err) {
      toastError(err);
    }
  },
};
