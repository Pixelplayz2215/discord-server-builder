// Reaction roles: a message in a channel with one reaction per role. Members react to get a role and
// remove their reaction to drop it. The bot hands roles out from its gateway events while the app is
// open or in the tray, and catches up on reactions it missed when it connects again.
// No Electron here, so it can be tested with a fake Discord.

// Gateway intents the bot needs: server info, reactions, and message deletes (to notice a removed panel).
const RR_INTENTS = (1 << 0) | (1 << 9) | (1 << 10);
const MAX_PAIRS = 20; // Discord allows 20 different reactions on one message
const CATCH_UP_LIMIT = 500; // reactors checked per role when catching up
const MODES = ['normal', 'unique', 'verify'];

// Discord sometimes sends standard emojis with the "emoji presentation" selector and sometimes without.
const bare = (name) => String(name || '').replace(/️/g, '');
const sameEmoji = (a, b) => (a?.id || b?.id ? String(a?.id) === String(b?.id) : bare(a?.name) === bare(b?.name));
// How an emoji goes in a reactions URL: the character itself, or name:id for a server emoji.
const emojiPath = (e) => encodeURIComponent(e.id ? `${e.name}:${e.id}` : e.name);
// How an emoji shows inside a message.
const emojiText = (e) => (e.id ? `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>` : e.name);

// The message members react to: an embed card or plain text, with the roles listed under it.
function panelMessage(panel) {
  const roles = panel.listRoles === false ? '' : panel.pairs.map((p) => `${emojiText(p.emoji)}  <@&${p.roleId}>${p.description ? ` · ${p.description}` : ''}`).join('\n');
  const text = [String(panel.message || '').trim(), roles].filter(Boolean).join('\n\n');
  if (panel.style === 'text') {
    const content = [panel.title ? `**${panel.title}**` : '', text].filter(Boolean).join('\n');
    return { content: content.slice(0, 2000) || 'React below to pick your roles.', embeds: [], allowed_mentions: { parse: [] } };
  }
  const embed = { color: Number.isInteger(panel.color) ? panel.color : 0x7f8cf0 };
  if (panel.title) embed.title = panel.title.slice(0, 256);
  embed.description = (text || 'React below to pick your roles.').slice(0, 4096);
  return { content: '', embeds: [embed], allowed_mentions: { parse: [] } };
}

const isUnknown = (err, code) => err?.code === code || err?.status === 404;

// Posts or updates a panel's message and its reactions. `previous` is the panel as it was last
// published (or null). Returns the message id.
async function publishPanel(rest, panel, previous) {
  const body = panelMessage(panel);
  const create = () => rest.request('POST', `/channels/${panel.channelId}/messages`, { body: body.content ? body : { ...body, content: undefined } });
  let messageId = null;
  const moved = previous && previous.channelId !== panel.channelId;
  if (previous?.messageId && !moved) {
    try {
      await rest.request('PATCH', `/channels/${panel.channelId}/messages/${previous.messageId}`, { body });
      messageId = previous.messageId;
    } catch (err) {
      if (!isUnknown(err, 10008)) throw err; // the old message was deleted: post a new one
    }
  }
  if (!messageId) {
    messageId = (await create()).id;
    // The panel moved to another channel: the old message would only confuse people.
    if (moved && previous.messageId) await rest.request('DELETE', `/channels/${previous.channelId}/messages/${previous.messageId}`).catch(() => {});
  }
  // Take the bot's own reaction off emojis that were removed, then add every current one (adding
  // one that's already there changes nothing). Members' roles from removed emojis are left alone.
  if (messageId === previous?.messageId) {
    for (const old of previous.pairs) {
      if (!panel.pairs.some((p) => sameEmoji(p.emoji, old.emoji))) {
        await rest.request('DELETE', `/channels/${panel.channelId}/messages/${messageId}/reactions/${emojiPath(old.emoji)}/@me`).catch(() => {});
      }
    }
  }
  for (const p of panel.pairs) await rest.request('PUT', `/channels/${panel.channelId}/messages/${messageId}/reactions/${emojiPath(p.emoji)}/@me`);
  return messageId;
}

// Handles one bot's reaction events. panelFor(messageId) finds a published panel; report(panel,
// problem) records the latest problem (or null when things work) so the app can show it.
function createReactionRoles({ rest, botId, panelFor, report = () => {} }) {
  const reason = (panel) => `Reaction role${panel.title ? ` (${panel.title.slice(0, 60)})` : ''}`;

  async function addRole(panel, userId, roleId) {
    await rest.request('PUT', `/guilds/${panel.guildId}/members/${userId}/roles/${roleId}`, { reason: reason(panel) });
  }
  async function removeRole(panel, userId, roleId) {
    await rest.request('DELETE', `/guilds/${panel.guildId}/members/${userId}/roles/${roleId}`, { reason: reason(panel) });
  }

  const describe = (err) =>
    err.code === 50013 ? "The bot can't give that role. Give it Manage Roles and move its role above the roles it hands out." : err.message;

  async function onAdd(d) {
    const panel = panelFor(d.message_id);
    if (!panel || d.user_id === botId || d.member?.user?.bot) return;
    const pair = panel.pairs.find((p) => sameEmoji(p.emoji, d.emoji));
    if (!pair) return;
    try {
      if (panel.mode === 'unique') {
        // One role from this message: swap out any other, and take back their other reactions.
        const others = panel.pairs.filter((p) => p !== pair);
        for (const p of others) if (d.member?.roles?.includes(p.roleId)) await removeRole(panel, d.user_id, p.roleId);
        for (const p of others) await rest.request('DELETE', `/channels/${panel.channelId}/messages/${panel.messageId}/reactions/${emojiPath(p.emoji)}/${d.user_id}`).catch(() => {});
      }
      if (!d.member?.roles?.includes(pair.roleId)) await addRole(panel, d.user_id, pair.roleId);
      report(panel, null);
    } catch (err) {
      report(panel, describe(err));
    }
  }

  async function onRemove(d) {
    const panel = panelFor(d.message_id);
    if (!panel || d.user_id === botId || panel.mode === 'verify') return;
    const pair = panel.pairs.find((p) => sameEmoji(p.emoji, d.emoji));
    if (!pair) return;
    try {
      await removeRole(panel, d.user_id, pair.roleId);
      report(panel, null);
    } catch (err) {
      if (!isUnknown(err, 10007)) report(panel, describe(err)); // they left the server: nothing to do
    }
  }

  // A mod cleared the reactions: put the bot's back so the message keeps working.
  async function restore(panel, emoji) {
    for (const p of panel.pairs) {
      if (emoji && !sameEmoji(p.emoji, emoji)) continue;
      await rest.request('PUT', `/channels/${panel.channelId}/messages/${panel.messageId}/reactions/${emojiPath(p.emoji)}/@me`).catch(() => {});
    }
  }

  // Gives roles to members who reacted while the bot wasn't watching. Roles are only ever added
  // here: someone holding a role without a reaction may have been given it another way.
  async function catchUp(panel) {
    let added = 0;
    let checked = 0;
    try {
      for (const pair of panel.pairs) {
        let after;
        for (let seen = 0; seen < CATCH_UP_LIMIT; ) {
          const users = await rest.request('GET', `/channels/${panel.channelId}/messages/${panel.messageId}/reactions/${emojiPath(pair.emoji)}`, { query: { limit: 100, after } });
          if (!users.length) break;
          for (const user of users) {
            if (user.bot || user.id === botId) continue;
            checked++;
            const member = await rest.request('GET', `/guilds/${panel.guildId}/members/${user.id}`).catch(() => null);
            if (member && !member.roles.includes(pair.roleId)) {
              await addRole(panel, user.id, pair.roleId);
              added++;
            }
          }
          seen += users.length;
          if (users.length < 100) break;
          after = users[users.length - 1].id;
        }
      }
      report(panel, null);
    } catch (err) {
      report(panel, isUnknown(err, 10008) ? 'The message was deleted. Edit the panel and save it to post it again.' : describe(err));
    }
    return { added, checked };
  }

  function handle(type, d) {
    if (!d) return null;
    if (type === 'MESSAGE_REACTION_ADD') return onAdd(d);
    if (type === 'MESSAGE_REACTION_REMOVE') return onRemove(d);
    const panel = d.message_id ? panelFor(d.message_id) : d.id ? panelFor(d.id) : null;
    if (!panel) return null;
    if (type === 'MESSAGE_REACTION_REMOVE_ALL') return restore(panel, null);
    if (type === 'MESSAGE_REACTION_REMOVE_EMOJI') return restore(panel, d.emoji);
    if (type === 'MESSAGE_DELETE' && d.id === panel.messageId) report(panel, 'The message was deleted. Edit the panel and save it to post it again.');
    return null;
  }

  return { handle, catchUp };
}

// Checks and tidies a panel from the app before it's saved.
function normalizePanel(input) {
  const id = (v, what) => {
    if (!/^\d{15,21}$/.test(String(v || ''))) throw new Error(`Pick a ${what}.`);
    return String(v);
  };
  const pairs = (Array.isArray(input?.pairs) ? input.pairs : []).map((p) => {
    const e = p?.emoji || {};
    const emoji = e.id ? { id: id(e.id, 'server emoji'), name: String(e.name || 'emoji').replace(/[^\w]/g, '').slice(0, 32) || 'emoji', animated: !!e.animated } : { name: String(e.name || '').trim().slice(0, 32) };
    if (!emoji.name) throw new Error('Every reaction needs an emoji.');
    return { emoji, roleId: id(p.roleId, 'role for every reaction'), roleName: String(p.roleName || '').slice(0, 100), description: String(p.description || '').trim().slice(0, 100) };
  });
  if (!pairs.length) throw new Error('Add at least one reaction and role.');
  if (pairs.length > MAX_PAIRS) throw new Error(`Discord allows ${MAX_PAIRS} different reactions on one message.`);
  pairs.forEach((p, i) => {
    if (pairs.findIndex((q) => sameEmoji(q.emoji, p.emoji)) !== i) throw new Error('Each reaction needs its own emoji.');
  });
  const color = Number(input?.color);
  return {
    id: input?.id ? String(input.id) : null,
    guildId: id(input?.guildId, 'server'),
    guildName: String(input?.guildName || '').slice(0, 100),
    channelId: id(input?.channelId, 'channel'),
    channelName: String(input?.channelName || '').slice(0, 100),
    title: String(input?.title || '').trim().slice(0, 256),
    message: String(input?.message || '').trim().slice(0, 3500),
    style: input?.style === 'text' ? 'text' : 'embed',
    color: Number.isInteger(color) && color >= 0 && color <= 0xffffff ? color : 0x7f8cf0,
    listRoles: input?.listRoles !== false,
    mode: MODES.includes(input?.mode) ? input.mode : 'normal',
    pairs,
  };
}

module.exports = { createReactionRoles, publishPanel, panelMessage, normalizePanel, sameEmoji, emojiPath, emojiText, RR_INTENTS, MAX_PAIRS };
