// Answers the mod slash commands (src/main/commands.js) for a bot whose Interactions Endpoint URL
// points at this portal's /interactions. Discord signs every request; unsigned ones are refused.
// Each command goes through the same checks as the app (guard.js): the mod's own Discord
// permissions, and only members ranked below them. Member actions are recorded in #mod-cases.
const crypto = require('crypto');
const { purgeMessages, setChannelLock } = require('../src/main/builder');
const { DURATIONS, DELETE_WINDOWS, SLOWMODES, labelFor } = require('../src/main/commands');
const { auditReason, P } = require('./guard');
const { createCases, TYPES, escapeMarkdown } = require('./cases');

const INTERACTION = { PING: 1, COMMAND: 2 };
const RESPONSE = { PONG: 1, MESSAGE: 4, DEFERRED: 5 };
const EPHEMERAL = 1 << 6;
const THREAD_TYPES = new Set([10, 11, 12]);
const MAX_CLOCK_SKEW_S = 300;
const SHOWN_CASES = 15;
const DMS_CLOSED = "Their DMs are closed, so they weren't told.";

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const lines = (...parts) => parts.filter(Boolean).join(' ');

function publicKey(hex) {
  return crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(hex, 'hex').toString('base64url') }, format: 'jwk' });
}

// Discord signs timestamp + body with the application's Ed25519 key.
function verifySignature(key, signature, timestamp, body, now = Date.now()) {
  if (!/^[0-9a-f]{128}$/i.test(String(signature || '')) || !/^\d{1,12}$/.test(String(timestamp || ''))) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > MAX_CLOCK_SKEW_S) return false;
  try {
    return crypto.verify(null, Buffer.concat([Buffer.from(timestamp, 'utf8'), body]), key, Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

// Caches a lookup, but tries again next time if it failed.
const once = (fn) => {
  let promise = null;
  return () =>
    (promise ??= fn().catch((err) => {
      promise = null;
      throw err;
    }));
};

const reply = (content) => ({ status: 200, body: { type: RESPONSE.MESSAGE, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } } } });

function createInteractions({ rest, guard }) {
  const application = once(async () => {
    const app = await rest.request('GET', '/applications/@me');
    return { id: app.id, key: publicKey(app.verify_key) };
  });
  const botId = once(async () => (await rest.request('GET', '/users/@me')).id);
  const caseLog = createCases(rest, { botId });

  function contextFor(interaction) {
    const u = interaction.member.user;
    return {
      command: interaction.data.name,
      guildId: interaction.guild_id,
      channelId: interaction.channel_id,
      channelType: interaction.channel?.type,
      user: { id: u.id, username: u.username, global_name: u.global_name || null },
      options: Object.fromEntries((interaction.data.options || []).map((o) => [o.name, o.value])),
      resolved: interaction.data.resolved || {},
    };
  }

  const audit = (ctx) => auditReason(ctx.options.reason, ctx.user, `/${ctx.command}`);
  const reasonLine = (ctx) => (ctx.options.reason ? `\n**Reason:** ${ctx.options.reason}` : '');

  async function actorFor(ctx, need) {
    const actor = await guard.actorIn(ctx.guildId, ctx.user);
    guard.requirePermission(actor, need);
    return actor;
  }

  // The user chosen in a user option, and whether they are in this server.
  function picked(ctx, name = 'member') {
    const id = String(ctx.options[name] || '');
    if (!/^\d{15,21}$/.test(id)) throw fail('Pick a member.');
    const u = ctx.resolved.users?.[id];
    return { id, label: u ? u.global_name || u.username : id, bot: !!u?.bot, inServer: !!ctx.resolved.members?.[id] };
  }

  async function memberTarget(ctx, need) {
    const actor = await actorFor(ctx, need);
    const target = picked(ctx);
    if (!target.inServer) throw fail(`<@${target.id}> isn't in this server.`);
    await guard.requireTarget(actor, target.id);
    return { actor, target };
  }

  async function notify(userId, content) {
    try {
      const dm = await rest.request('POST', '/users/@me/channels', { body: { recipient_id: userId } });
      await rest.request('POST', `/channels/${dm.id}/messages`, { body: { content: content.slice(0, 2000), allowed_mentions: { parse: [] } } });
      return true;
    } catch {
      return false;
    }
  }

  // Records a case after an action that already happened, so a logging problem is reported, not thrown.
  async function logCase(actor, ctx, entry) {
    try {
      const { number } = await caseLog.record(actor.guild, actor.roles, { moderator: ctx.user, reason: ctx.options.reason, ...entry });
      return `Recorded as case ${number}.`;
    } catch (err) {
      return `It couldn't be recorded in #mod-cases: ${err.message}`;
    }
  }

  function channelFor(ctx) {
    const id = String(ctx.options.channel || ctx.channelId);
    const type = ctx.options.channel ? ctx.resolved.channels?.[id]?.type : ctx.channelType;
    return { id, thread: THREAD_TYPES.has(type) };
  }

  async function lock(ctx, locked) {
    await actorFor(ctx, P.MANAGE_CHANNELS);
    const channel = channelFor(ctx);
    if (channel.thread) throw fail("Threads can't be locked this way. Pick the channel instead.");
    await setChannelLock(rest, ctx.guildId, channel.id, locked, audit(ctx));
    return `${locked ? '🔒 Locked' : '🔓 Unlocked'} <#${channel.id}>.`;
  }

  const handlers = {
    async warn(ctx) {
      const { actor, target } = await memberTarget(ctx);
      if (target.bot) throw fail("Bots can't be warned.");
      const { number } = await caseLog.record(actor.guild, actor.roles, { type: 'warn', member: target, moderator: ctx.user, reason: ctx.options.reason });
      const warnings = (await caseLog.list(actor.guild, target.id)).filter((c) => c.type === 'warn').length;
      const told = await notify(target.id, `⚠️ You were warned in **${escapeMarkdown(actor.guild.name)}**.${reasonLine(ctx)}`);
      return lines(`⚠️ Warned <@${target.id}> (case ${number}). They have ${plural(warnings, 'warning')} now.`, told ? null : DMS_CLOSED);
    },

    async timeout(ctx) {
      const { actor, target } = await memberTarget(ctx, P.MODERATE_MEMBERS);
      const seconds = Number(ctx.options.duration);
      if (!DURATIONS.some((d) => d.value === seconds)) throw fail('Pick a duration from the list.');
      await rest.request('PATCH', `/guilds/${ctx.guildId}/members/${target.id}`, {
        body: { communication_disabled_until: new Date(Date.now() + seconds * 1000).toISOString() },
        reason: audit(ctx),
      });
      const duration = labelFor(DURATIONS, seconds);
      const told = target.bot ? null : await notify(target.id, `🔇 You were timed out in **${escapeMarkdown(actor.guild.name)}** for ${duration}.${reasonLine(ctx)}`);
      return lines(`🔇 Timed out <@${target.id}> for ${duration}.`, await logCase(actor, ctx, { type: 'timeout', member: target, duration }), told === false ? DMS_CLOSED : null);
    },

    async untimeout(ctx) {
      const { actor, target } = await memberTarget(ctx, P.MODERATE_MEMBERS);
      await rest.request('PATCH', `/guilds/${ctx.guildId}/members/${target.id}`, { body: { communication_disabled_until: null }, reason: audit(ctx) });
      return lines(`🔊 Ended the timeout for <@${target.id}>.`, await logCase(actor, ctx, { type: 'untimeout', member: target }));
    },

    // They're told first: once they're out of the server the bot can't DM them.
    async kick(ctx) {
      const { actor, target } = await memberTarget(ctx, P.KICK_MEMBERS);
      const told = target.bot ? null : await notify(target.id, `👢 You were kicked from **${escapeMarkdown(actor.guild.name)}**.${reasonLine(ctx)}`);
      await rest.request('DELETE', `/guilds/${ctx.guildId}/members/${target.id}`, { reason: audit(ctx) });
      return lines(`👢 Kicked <@${target.id}>.`, await logCase(actor, ctx, { type: 'kick', member: target }), told === false ? DMS_CLOSED : null);
    },

    async ban(ctx) {
      const actor = await actorFor(ctx, P.BAN_MEMBERS);
      const target = picked(ctx);
      await guard.requireTarget(actor, target.id);
      const seconds = Number(ctx.options.delete_messages || 0);
      if (!DELETE_WINDOWS.some((d) => d.value === seconds)) throw fail('Pick how many messages to delete from the list.');
      const told = target.inServer && !target.bot ? await notify(target.id, `🔨 You were banned from **${escapeMarkdown(actor.guild.name)}**.${reasonLine(ctx)}`) : null;
      await rest.request('PUT', `/guilds/${ctx.guildId}/bans/${target.id}`, { body: { delete_message_seconds: seconds }, reason: audit(ctx) });
      return lines(`🔨 Banned <@${target.id}>.`, await logCase(actor, ctx, { type: 'ban', member: target }), told === false ? DMS_CLOSED : null);
    },

    async unban(ctx) {
      const actor = await actorFor(ctx, P.BAN_MEMBERS);
      const target = picked(ctx, 'user');
      await rest.request('DELETE', `/guilds/${ctx.guildId}/bans/${target.id}`, { reason: audit(ctx) });
      return lines(`✅ Unbanned <@${target.id}>.`, await logCase(actor, ctx, { type: 'unban', member: target }));
    },

    async cases(ctx) {
      const actor = await actorFor(ctx);
      const target = picked(ctx);
      const found = await caseLog.list(actor.guild, target.id);
      if (!found.length) return `<@${target.id}> has no cases.`;
      const counts = {};
      for (const c of found) counts[c.type] = (counts[c.type] || 0) + 1;
      const summary = Object.entries(counts).map(([type, n]) => `${n} × ${TYPES[type].label}`).join(' · ');
      const entries = found.slice(0, SHOWN_CASES).map((c) => {
        const when = Math.floor(Date.parse(c.at) / 1000);
        const head = [`**#${c.number} ${TYPES[c.type].label}**${c.duration ? ` (${c.duration})` : ''}`, Number.isFinite(when) ? `<t:${when}:R>` : null, `by <@${c.moderatorId}>`];
        return `${head.filter(Boolean).join(' · ')}\n${c.reason.slice(0, 200)}`;
      });
      const older = found.length > SHOWN_CASES ? `\n…and ${found.length - SHOWN_CASES} older.` : '';
      return {
        embeds: [{ title: `Cases for ${target.label}`, color: 0x7f8cf0, description: `${summary}\n\n${entries.join('\n\n')}${older}`.slice(0, 4096) }],
      };
    },

    async purge(ctx) {
      await actorFor(ctx, P.MANAGE_MESSAGES);
      const count = Math.min(Math.max(1, Number(ctx.options.count) || 0), 500);
      const { deleted, skipped } = await purgeMessages(rest, ctx.channelId, count, audit(ctx));
      return lines(`🧹 Deleted ${plural(deleted, 'message')}.`, skipped ? `${skipped} older than 14 days or pinned were left alone.` : null);
    },

    lock: (ctx) => lock(ctx, true),
    unlock: (ctx) => lock(ctx, false),

    async slowmode(ctx) {
      await actorFor(ctx, P.MANAGE_CHANNELS);
      const seconds = Number(ctx.options.interval);
      if (!SLOWMODES.some((s) => s.value === seconds)) throw fail('Pick an interval from the list.');
      const channel = channelFor(ctx);
      await rest.request('PATCH', `/channels/${channel.id}`, { body: { rate_limit_per_user: seconds }, reason: audit(ctx) });
      return seconds ? `🐢 Slowmode in <#${channel.id}> is now ${labelFor(SLOWMODES, seconds)}.` : `Slowmode is off in <#${channel.id}>.`;
    },
  };

  // Does the command's work after Discord has been told to wait, then fills in the reply.
  async function run(interaction, handler) {
    let message;
    try {
      const out = await handler(contextFor(interaction));
      message = typeof out === 'string' ? { content: out } : out;
    } catch (err) {
      if (!err.status || err.status >= 500) console.error(`/${interaction.data.name}:`, err);
      message = { content: `✗ ${err.message || 'Something went wrong.'}` };
    }
    try {
      await rest.request('PATCH', `/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`, { body: { ...message, allowed_mentions: { parse: [] } } });
    } catch (err) {
      console.error(`Couldn't answer /${interaction.data.name}:`, err.message);
    }
  }

  // Discord needs an answer within 3 seconds, so commands are acknowledged at once ("thinking…",
  // visible only to the mod) and `after` does the work.
  async function receive(body, headers) {
    const { key } = await application();
    if (!verifySignature(key, headers['x-signature-ed25519'], headers['x-signature-timestamp'], body)) {
      return { status: 401, body: { error: 'Invalid request signature.' } };
    }
    let interaction;
    try {
      interaction = JSON.parse(body.toString('utf8'));
    } catch {
      return { status: 400, body: { error: 'Invalid JSON.' } };
    }
    if (interaction.type === INTERACTION.PING) return { status: 200, body: { type: RESPONSE.PONG } };
    if (interaction.type !== INTERACTION.COMMAND) return reply('The mod portal only handles slash commands.');
    const handler = Object.hasOwn(handlers, interaction.data?.name) ? handlers[interaction.data.name] : null;
    if (!handler) return reply("This mod portal doesn't know that command yet. The bot owner can update it (Sync fork on GitHub).");
    if (!interaction.guild_id || !interaction.member?.user) return reply('Use this command in a server.');
    return { status: 200, body: { type: RESPONSE.DEFERRED, data: { flags: EPHEMERAL } }, after: () => run(interaction, handler) };
  }

  return { receive };
}

module.exports = { createInteractions, verifySignature, publicKey };
