// Discord's text formatting, drawn for the app's message previews the way Discord shows it:
// # headings, -# small text, > quotes, lists, ``` code blocks ```, **bold**, *italics*, __underline__,
// ~~strikethrough~~, ||spoilers||, `code`, [links](https://…), mentions, server emojis and <t:…>
// timestamps. Builds elements (never HTML strings), so nothing typed can run in the app.

const MD_INLINE = [
  ['escape', /\\([\\*_~`|>#\-[\]()<@])/],
  ['code', /`([^`\n]+)`/],
  ['link', /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/],
  ['emoji', /<(a?):(\w{2,32}):(\d{15,21})>/],
  ['mention', /<(@!?|@&|#)(\d{15,21})>/],
  ['time', /<t:(-?\d{1,13})(?::([tTdDfFR]))?>/],
  ['everyone', /@(everyone|here)\b/],
  ['boldItalic', /\*\*\*(?!\s)([^\n]+?)\*\*\*/],
  ['bold', /\*\*(?!\s)([^\n]+?)\*\*/],
  ['underline', /__(?!\s)([^\n]+?)__/],
  ['italic', /\*(?![\s*])([^*\n]+?)\*|(?<![\w_])_(?!\s)([^_\n]+?)_(?![\w_])/],
  ['strike', /~~(?!\s)([^\n]+?)~~/],
  ['spoiler', /\|\|([^\n]+?)\|\|/],
  ['url', /https?:\/\/[^\s<]+[^\s<.,:;"')\]]/],
];

// A timestamp as Discord shows it for each style.
function mdTime(seconds, style = 'f') {
  const d = new Date(Number(seconds) * 1000);
  if (style === 'R') return fmtRelative(d);
  const formats = {
    t: { hour: 'numeric', minute: '2-digit' },
    T: { hour: 'numeric', minute: '2-digit', second: '2-digit' },
    d: { day: '2-digit', month: '2-digit', year: 'numeric' },
    D: { day: 'numeric', month: 'long', year: 'numeric' },
    f: { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' },
    F: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' },
  };
  return d.toLocaleString(undefined, formats[style] || formats.f);
}

// One line's inline formatting. opts.roles / opts.channels name mentions ([{ id, name, color }]).
function mdInline(text, opts = {}) {
  const out = [];
  let rest = String(text);
  while (rest) {
    let best = null;
    for (const [kind, re] of MD_INLINE) {
      const m = re.exec(rest);
      if (m && (!best || m.index < best.m.index)) best = { kind, m };
    }
    if (!best) {
      out.push(rest);
      break;
    }
    const { kind, m } = best;
    if (m.index) out.push(rest.slice(0, m.index));
    out.push(mdNode(kind, m, opts));
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

function mdNode(kind, m, opts) {
  const inner = (s) => mdInline(s, opts);
  switch (kind) {
    case 'escape':
      return m[1];
    case 'code':
      return h('code', { class: 'md-code' }, m[1]);
    case 'link':
      return h('span', { class: 'md-link', title: m[2] }, inner(m[1]));
    case 'url':
      return h('span', { class: 'md-link' }, m[0]);
    case 'emoji':
      return h('img', { class: 'emoji-img md-emoji', src: `https://cdn.discordapp.com/emojis/${m[3]}.${m[1] ? 'gif' : 'png'}?size=48`, alt: `:${m[2]}:`, title: `:${m[2]}:` });
    case 'mention': {
      if (m[1] === '#') return h('span', { class: 'rr-mention' }, `#${opts.channels?.find((c) => c.id === m[2])?.name || 'channel'}`);
      if (m[1] === '@&') {
        const role = opts.roles?.find((r) => r.id === m[2]);
        return h('span', { class: 'rr-mention', style: role?.color ? { color: roleColor(role) } : null }, `@${role?.name || 'role'}`);
      }
      return h('span', { class: 'rr-mention' }, `@${opts.users?.find((u) => u.id === m[2])?.name || 'member'}`);
    }
    case 'time':
      return h('span', { class: 'md-time' }, mdTime(m[1], m[2]));
    case 'everyone':
      return h('span', { class: 'rr-mention' }, m[0]);
    case 'boldItalic':
      return h('b', null, h('i', null, inner(m[1])));
    case 'bold':
      return h('b', null, inner(m[1]));
    case 'underline':
      return h('u', null, inner(m[1]));
    case 'italic':
      return h('i', null, inner(m[1] ?? m[2]));
    case 'strike':
      return h('s', null, inner(m[1]));
    case 'spoiler':
      return h('span', { class: 'md-spoiler', title: 'Spoiler' }, inner(m[1]));
    default:
      return m[0];
  }
}

// A whole message: lines become headings, quotes, lists, code blocks and plain lines.
function discordText(text, opts = {}) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let plain = [];
  const endPlain = () => {
    if (!plain.length) return;
    const blank = plain.every((l) => !l.trim());
    // Blank lines still take up their height, as in Discord.
    out.push(h('div', { class: 'md-p' }, blank ? '​' + '\n'.repeat(plain.length - 1) : plain.flatMap((l, i) => [i ? '\n' : '', ...mdInline(l, opts)])));
    plain = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if (line.startsWith('```')) {
      endPlain();
      const code = [];
      const first = line.slice(3);
      if (first.endsWith('```') && first.length >= 3) {
        out.push(h('pre', { class: 'md-codeblock' }, first.slice(0, -3)));
        continue;
      }
      if (first && !/^\w+$/.test(first)) code.push(first); // ```js names a language; anything else is code
      while (++i < lines.length && !lines[i].startsWith('```')) code.push(lines[i]);
      out.push(h('pre', { class: 'md-codeblock' }, code.join('\n')));
      continue;
    }
    if ((m = line.match(/^(#{1,3}) +(\S.*)$/))) {
      endPlain();
      out.push(h('div', { class: `md-h${m[1].length}` }, mdInline(m[2], opts)));
      continue;
    }
    if ((m = line.match(/^-# +(\S.*)$/))) {
      endPlain();
      out.push(h('div', { class: 'md-sub' }, mdInline(m[1], opts)));
      continue;
    }
    if (line.startsWith('>>> ')) {
      endPlain();
      out.push(h('div', { class: 'md-quote' }, discordText([line.slice(4), ...lines.slice(i + 1)].join('\n'), opts)));
      break;
    }
    if (/^> /.test(line) || line === '>') {
      endPlain();
      const quoted = [];
      for (; i < lines.length && (/^> /.test(lines[i]) || lines[i] === '>'); i++) quoted.push(lines[i].slice(2));
      i--;
      out.push(h('div', { class: 'md-quote' }, discordText(quoted.join('\n'), opts)));
      continue;
    }
    if ((m = line.match(/^( *)([-*]|\d{1,3}\.) +(\S.*)$/))) {
      endPlain();
      const ordered = /\d/.test(m[2]);
      const items = [];
      for (; i < lines.length; i++) {
        const item = lines[i].match(/^( *)([-*]|\d{1,3}\.) +(\S.*)$/);
        if (!item || /\d/.test(item[2]) !== ordered) break;
        items.push(h('li', { class: item[1].length >= 2 ? 'md-nested' : null }, mdInline(item[3], opts)));
      }
      i--;
      out.push(h(ordered ? 'ol' : 'ul', { class: 'md-list', start: ordered ? Number(m[2]) || 1 : null }, items));
      continue;
    }
    plain.push(line);
  }
  endPlain();
  return out;
}
