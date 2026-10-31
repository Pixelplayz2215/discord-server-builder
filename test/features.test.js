// Tests for the app's backup, case and server-log modules with a fake Discord. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { caseFromCall, durationLabel, privateChannel, createCases, warnMember } = require('../src/main/cases');
const { snapshotServer, restoreBackup, validateBackup } = require('../src/main/backup');
const { createServerLogger, intentsFor, normalizeConfig, INTENTS } = require('../src/main/logs');
const { lockWithNotice } = require('../src/main/builder');
const ModLog = require('../src/shared/modlog');

const G = '100000000000000001';
const BOT = '200000000000000000';
const MEMBER = '200000000000000005';
const R = { mod: '400000000000000002', member: '400000000000000004', bot: '400000000000000005', helper: '400000000000000003' };
const C = { cat: '300000000000000010', general: '300000000000000011', rules: '300000000000000012', voice: '300000000000000013' };
const VIEW = String(1n << 10n);
const SEND = String(1n << 11n);

// A small server: roles, a category with two channels and a voice channel, and a bot that's admin.
function fakeServer() {
  let next = 900000000000000000n;
  const newId = () => String(next++);
  const state = {
    guild: { id: G, name: 'Main', owner_id: '200000000000000001', verification_level: 1, default_message_notifications: 1, explicit_content_filter: 0, afk_timeout: 300, system_channel_id: C.general },
    roles: [
      { id: G, name: '@everyone', position: 0, permissions: '104324673', color: 0, hoist: false, mentionable: false },
      { id: R.member, name: 'Member', position: 1, permissions: '0', color: 0x99aab5, hoist: false, mentionable: false },
      { id: R.helper, name: 'Helper', position: 2, permissions: String(1n << 40n), color: 0, hoist: false, mentionable: false },
      { id: R.mod, name: 'Mod', position: 3, permissions: String((1n << 1n) | (1n << 2n)), color: 0x0bbfbc, hoist: true, mentionable: true },
      { id: R.bot, name: 'Bot', position: 9, permissions: '8', managed: true, color: 0, hoist: false, mentionable: false },
    ],
    channels: [
      { id: C.cat, type: 4, name: 'Info', position: 0, parent_id: null, permission_overwrites: [] },
      { id: C.general, type: 0, name: 'general', position: 1, parent_id: C.cat, topic: 'Chat', permission_overwrites: [] },
      { id: C.rules, type: 0, name: 'rules', position: 2, parent_id: C.cat, permission_overwrites: [{ id: G, type: 0, allow: '0', deny: SEND }, { id: R.mod, type: 0, allow: SEND, deny: '0' }] },
      { id: C.voice, type: 2, name: 'Voice', position: 3, parent_id: null, bitrate: 64000, user_limit: 5, permission_overwrites: [] },
    ],
    messages: {},
  };
  const calls = [];
  const rest = {
    calls,
    state,
    async request(method, path, opts = {}) {
      calls.push({ method, path, ...opts });
      let m;
      if (path === '/users/@me') return { id: BOT };
      if (path === `/guilds/${G}` && method === 'GET') return { ...state.guild };
      if (path === `/guilds/${G}/members/${BOT}`) return { user: { id: BOT }, roles: [R.bot] };
      if (path === `/guilds/${G}/roles`) {
        if (method === 'GET') return state.roles.map((r) => ({ ...r }));
        if (method === 'POST') {
          const role = { id: newId(), position: 1, managed: false, ...opts.body };
          state.roles.push(role);
          return role;
        }
        return state.roles;
      }
      if ((m = path.match(/^\/guilds\/\d+\/roles\/(\d+)$/)) && method === 'PATCH') return Object.assign(state.roles.find((r) => r.id === m[1]), opts.body);
      if (path === `/guilds/${G}/channels`) {
        if (method === 'GET') return state.channels.map((c) => ({ ...c, permission_overwrites: c.permission_overwrites.map((o) => ({ ...o })) }));
        if (method === 'POST') {
          const ch = { id: newId(), position: 99, parent_id: null, permission_overwrites: [], ...opts.body };
          state.channels.push(ch);
          return ch;
        }
        return null;
      }
      if ((m = path.match(/^\/channels\/(\d+)$/)) && method === 'PATCH') return Object.assign(state.channels.find((c) => c.id === m[1]), opts.body);
      if ((m = path.match(/^\/channels\/(\d+)\/messages$/))) {
        const list = (state.messages[m[1]] ||= []);
        if (method === 'POST') {
          const msg = { id: newId(), author: { id: BOT }, timestamp: new Date().toISOString(), ...opts.body };
          list.unshift(msg);
          return msg;
        }
        return list.slice(0, opts.query?.limit || 50);
      }
      if (path === '/users/@me/channels') return { id: `9${opts.body.recipient_id.slice(1)}` };
      return null;
    },
  };
  return rest;
}

test('app moderation calls turn into the right cases', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  const at = (seconds) => new Date(now + seconds * 1000).toISOString();
  assert.deepEqual(caseFromCall('PUT', `/guilds/${G}/bans/${MEMBER}`, {}), { guildId: G, memberId: MEMBER, type: 'ban' });
  assert.deepEqual(caseFromCall('DELETE', `/guilds/${G}/bans/${MEMBER}`), { guildId: G, memberId: MEMBER, type: 'unban' });
  assert.deepEqual(caseFromCall('DELETE', `/guilds/${G}/members/${MEMBER}`), { guildId: G, memberId: MEMBER, type: 'kick' });
  assert.equal(caseFromCall('PATCH', `/guilds/${G}/members/${MEMBER}`, { communication_disabled_until: at(3600) }, now).duration, '1 hour');
  assert.equal(caseFromCall('PATCH', `/guilds/${G}/members/${MEMBER}`, { communication_disabled_until: at(599.9) }, now).duration, '10 minutes');
  assert.equal(caseFromCall('PATCH', `/guilds/${G}/members/${MEMBER}`, { communication_disabled_until: null }).type, 'untimeout');
  assert.equal(caseFromCall('PATCH', `/guilds/${G}/members/${MEMBER}`, { nick: 'x' }), null);
  assert.equal(caseFromCall('PUT', `/guilds/${G}/members/${MEMBER}/roles/${R.mod}`), null);
  assert.equal(caseFromCall('GET', `/guilds/${G}/bans/${MEMBER}`), null);
  assert.equal(durationLabel(2419200), '4 weeks');
  assert.equal(durationLabel(86400), '1 day');
  assert.equal(durationLabel(5400), '90 minutes');
  assert.equal(durationLabel(30), '30 seconds');
});

test('private log channels hide from everyone but let mod roles read', () => {
  const server = fakeServer();
  const body = privateChannel('server-logs', 'topic', server.state.guild, server.state.roles, BOT);
  const everyone = body.permission_overwrites.find((o) => o.id === G);
  assert.equal(everyone.deny, VIEW);
  assert.deepEqual(body.permission_overwrites.filter((o) => o.type === 0 && o.id !== G).map((o) => o.id).sort(), [R.helper, R.mod].sort());
  assert.ok(body.permission_overwrites.find((o) => o.id === BOT && o.type === 1).allow.length);
});

test('warnings from the app are numbered cases and DM the member', async () => {
  const server = fakeServer();
  const log = createCases(server, { botId: async () => BOT });
  const args = { guild: server.state.guild, roles: server.state.roles, member: { id: MEMBER, label: 'user5' }, moderator: { id: BOT }, reason: 'spam' };
  assert.deepEqual(await warnMember(server, log, args), { number: 1, warnings: 1, told: true });
  const second = await warnMember(server, log, { ...args, reason: 'again' });
  assert.equal(second.number, 2);
  assert.equal(second.warnings, 2);
  const [latest] = await log.list(server.state.guild, MEMBER);
  assert.equal(latest.reason, 'again');
});

test('a backup snapshot keeps exact roles, channels and overwrites', async () => {
  const server = fakeServer();
  const backup = validateBackup(await snapshotServer(server, G, { label: 'before' }));
  assert.equal(backup.label, 'before');
  assert.equal(backup.roles.length, 5);
  assert.deepEqual(backup.channels.find((c) => c.id === C.rules).permission_overwrites, server.state.channels.find((c) => c.id === C.rules).permission_overwrites);
  assert.throws(() => validateBackup({ format: 'nope' }), /isn't a Discord Server Builder backup/);
});

test('a backup of an unchanged server plans no changes', async () => {
  const server = fakeServer();
  const backup = await snapshotServer(server, G);
  const { planned } = await restoreBackup(server, G, backup, { settings: true, dryRun: true });
  assert.deepEqual(planned, []);
});

test('restoring after a nuke recreates roles and channels with mapped permissions, and deletes nothing', async () => {
  const server = fakeServer();
  const backup = await snapshotServer(server, G);
  // The "nuke": the Mod role, the Info category and #rules are deleted; #general's permissions are wiped and it's moved out.
  server.state.roles = server.state.roles.filter((r) => r.id !== R.mod);
  server.state.channels = server.state.channels.filter((c) => c.id !== C.cat && c.id !== C.rules);
  Object.assign(server.state.channels.find((c) => c.id === C.general), { parent_id: null, permission_overwrites: [{ id: G, type: 0, allow: '0', deny: VIEW }] });

  const { planned } = await restoreBackup(server, G, backup, { dryRun: true });
  assert.ok(planned.includes('Recreated role @Mod'));
  assert.ok(planned.includes('Recreated category Info'));
  assert.ok(planned.includes('Recreated #rules'));
  assert.ok(planned.some((p) => p.startsWith('#general:')));
  assert.equal(server.calls.filter((c) => c.method !== 'GET').length, 0, 'a dry run must not change anything');

  const events = [];
  const stats = await restoreBackup(server, G, backup, {}, (e) => events.push(e));
  assert.equal(stats.failed, 0, JSON.stringify(events));
  const mod = server.state.roles.find((r) => r.name === 'Mod');
  assert.ok(mod && mod.id !== R.mod, 'Mod was recreated with a new ID');
  assert.equal(mod.permissions, String((1n << 1n) | (1n << 2n)));
  const cat = server.state.channels.find((c) => c.type === 4 && c.name === 'Info');
  const rules = server.state.channels.find((c) => c.name === 'rules');
  assert.equal(rules.parent_id, cat.id);
  assert.deepEqual(rules.permission_overwrites.map((o) => o.id).sort(), [G, mod.id].sort(), 'overwrites point at the new Mod role');
  const general = server.state.channels.find((c) => c.id === C.general);
  assert.equal(general.parent_id, cat.id, '#general went back into its category');
  assert.deepEqual(general.permission_overwrites, []);
  assert.equal(server.calls.filter((c) => c.method === 'DELETE').length, 0);
});

test('restoring settings puts the welcome channel back on the recreated channel', async () => {
  const server = fakeServer();
  const backup = await snapshotServer(server, G);
  server.state.channels = server.state.channels.filter((c) => c.id !== C.general);
  server.state.guild.system_channel_id = null;
  server.state.guild.verification_level = 0;
  await restoreBackup(server, G, backup, { settings: true });
  const settings = server.calls.find((c) => c.method === 'PATCH' && c.path === `/guilds/${G}`);
  const general = server.state.channels.find((c) => c.name === 'general');
  assert.equal(settings.body.system_channel_id, general.id);
  assert.equal(settings.body.verification_level, 1);
});

test('log intents only include privileged ones the bot is allowed', () => {
  const all = normalizeConfig({ enabled: true, channelId: '300000000000000099' });
  assert.deepEqual(all.events, { members: true, moderation: true, messages: true, server: true });
  const full = intentsFor([all], { members: true, content: true });
  for (const bit of ['GUILDS', 'GUILD_MEMBERS', 'GUILD_MODERATION', 'GUILD_MESSAGES', 'MESSAGE_CONTENT']) assert.ok(full & INTENTS[bit], bit);
  const limited = intentsFor([all], {});
  assert.equal(limited & INTENTS.GUILD_MEMBERS, 0);
  assert.equal(limited & INTENTS.MESSAGE_CONTENT, 0);
  assert.equal(intentsFor([], { members: true }), 0);
  assert.equal(normalizeConfig({ channelId: 'nope' }).channelId, null);
});

test('server logs post batched embeds for joins, deletes and edits, and skip their own channel', async () => {
  const server = fakeServer();
  const LOG = '300000000000000099';
  const config = { ...normalizeConfig({ enabled: true, channelId: LOG }), content: true };
  const logger = createServerLogger({ rest: server, configFor: (g) => (g === G ? config : null), flushMs: 5 });
  const user = { id: MEMBER, username: 'user5', global_name: 'User Five' };
  const fresh = { id: String(((BigInt(Date.now()) - 1420070400000n) << 22n)), username: 'raider' };

  logger.handle('GUILD_CREATE', { id: G, channels: [{ id: C.general, name: 'general' }], roles: [], members: [] });
  logger.handle('GUILD_MEMBER_ADD', { guild_id: G, user: fresh, roles: [], joined_at: new Date().toISOString() });
  logger.handle('MESSAGE_CREATE', { guild_id: G, id: '500000000000000001', channel_id: C.general, author: user, content: 'hello there', attachments: [] });
  logger.handle('MESSAGE_UPDATE', { guild_id: G, id: '500000000000000001', channel_id: C.general, content: 'hello everyone' });
  logger.handle('MESSAGE_DELETE', { guild_id: G, id: '500000000000000001', channel_id: C.general });
  logger.handle('MESSAGE_DELETE', { guild_id: G, id: '500000000000000002', channel_id: LOG });
  logger.handle('MESSAGE_CREATE', { guild_id: G, id: '500000000000000003', channel_id: C.general, author: { ...user, bot: true }, content: 'beep', attachments: [] });
  logger.handle('MESSAGE_DELETE', { guild_id: '100000000000000777', id: '500000000000000004', channel_id: C.general });
  logger.handle('CHANNEL_UPDATE', { guild_id: G, id: C.general, name: 'chat', type: 0 });
  for (let i = 0; i < 12; i++) logger.handle('GUILD_BAN_ADD', { guild_id: G, user: { id: `2000000000000001${String(i).padStart(2, '0')}`, username: `r${i}` } });
  await new Promise((r) => setTimeout(r, 50));

  const posts = server.calls.filter((c) => c.method === 'POST' && c.path === `/channels/${LOG}/messages`);
  const embeds = posts.flatMap((p) => p.body.embeds);
  assert.ok(posts.every((p) => p.body.embeds.length <= 10), 'at most 10 embeds per message');
  assert.equal(posts.length, 2, 'events are batched');
  const titles = embeds.map((e) => e.title);
  assert.deepEqual(titles.slice(0, 4), ['Member joined', 'Message edited', 'Message deleted', 'Channel renamed']);
  assert.equal(titles.filter((t) => t === 'Member banned').length, 12);
  assert.match(embeds[0].description, /New account/);
  assert.equal(embeds[1].fields[0].value, 'hello there');
  assert.equal(embeds[1].fields[1].value, 'hello everyone');
  assert.equal(embeds[2].fields[0].value, 'hello everyone');
  assert.match(embeds[3].description, /general → chat/);
  assert.deepEqual(posts[0].body.allowed_mentions, { parse: [] });
});

test('member updates show nickname, role and timeout changes', async () => {
  const server = fakeServer();
  const LOG = '300000000000000099';
  const config = normalizeConfig({ enabled: true, channelId: LOG });
  const logger = createServerLogger({ rest: server, configFor: () => config, flushMs: 5 });
  const user = { id: MEMBER, username: 'user5' };
  logger.handle('GUILD_MEMBER_ADD', { guild_id: G, user, roles: [R.member], nick: null, joined_at: new Date().toISOString() });
  const until = new Date(Date.now() + 3600e3).toISOString();
  logger.handle('GUILD_MEMBER_UPDATE', { guild_id: G, user, roles: [R.member, R.helper], nick: 'Fiver', communication_disabled_until: until });
  logger.handle('GUILD_MEMBER_REMOVE', { guild_id: G, user });
  await new Promise((r) => setTimeout(r, 30));
  const embeds = server.calls.filter((c) => c.path === `/channels/${LOG}/messages`).flatMap((c) => c.body.embeds);
  const update = embeds.find((e) => e.title === 'Member updated');
  assert.match(update.description, /Nickname:\*\* \*none\* → Fiver/);
  assert.match(update.description, new RegExp(`Roles added:\\*\\* <@&${R.helper}>`));
  assert.match(update.description, /Timed out/);
  assert.match(embeds.find((e) => e.title === 'Member left').description, /Roles:/);
});

test('server logs show who locked or unlocked a channel, and why', async () => {
  const LOG = '300000000000000099';
  const posts = [];
  let audit = [];
  const rest = {
    async request(method, path, opts = {}) {
      if (path === `/guilds/${G}/audit-logs`) {
        if (!audit) throw Object.assign(new Error('Missing Access'), { code: 50013 });
        return { audit_log_entries: audit };
      }
      if (method === 'POST') posts.push(...opts.body.embeds);
      return {};
    },
  };
  const config = normalizeConfig({ enabled: true, channelId: LOG });
  const logger = createServerLogger({ rest, configFor: () => config, flushMs: 5, auditDelayMs: 1 });
  const general = { guild_id: G, id: C.general, name: 'general', type: 0, permission_overwrites: [] };
  const locked = [{ id: G, type: 0, allow: '0', deny: SEND }];
  const id = (ms) => String((BigInt(ms) - 1420070400000n) << 22n);
  logger.handle('GUILD_CREATE', { id: G, channels: [general], roles: [], members: [] });

  audit = [
    { id: id(Date.now() - 10 * 60e3), action_type: 14, target_id: C.general, user_id: BOT, options: { id: G }, reason: 'old', changes: [{ key: 'deny', old_value: '0', new_value: SEND }] },
    { id: id(Date.now()), action_type: 14, target_id: C.general, user_id: BOT, options: { id: G, type: '0' }, reason: 'Raid in progress — by Pixel (750867905226211388) via /lock', changes: [{ key: 'deny', old_value: '0', new_value: SEND }] },
  ];
  logger.handle('CHANNEL_UPDATE', { ...general, permission_overwrites: locked });
  logger.handle('CHANNEL_UPDATE', { ...general, topic: 'still locked', permission_overwrites: locked }); // not a lock change
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].title, '🔒 Channel locked');
  assert.equal(posts[0].description, `<#${C.general}> · general`);
  assert.deepEqual(posts[0].fields, [
    { name: 'By', value: '<@750867905226211388> · Pixel via `/lock`', inline: true },
    { name: 'Reason', value: 'Raid in progress' },
  ]);

  // Without View Audit Log it's still logged, just without who and why.
  audit = null;
  logger.handle('CHANNEL_UPDATE', { ...general, permission_overwrites: [] });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(posts[1].title, '🔓 Channel unlocked');
  assert.deepEqual(posts[1].fields, []);
});

test('a lock notice that went out is taken down when the lock itself fails', async () => {
  const calls = [];
  const rest = {
    async request(method, path) {
      calls.push(`${method} ${path}`);
      if (method === 'GET') return { id: C.general, type: 0, permission_overwrites: [] };
      if (method === 'POST') return { id: '700000000000000001' };
      if (method === 'PUT') throw Object.assign(new Error('Missing Permissions'), { code: 50013 });
      return null;
    },
  };
  await assert.rejects(lockWithNotice(rest, G, C.general, true, 'audit', 'why'), /Missing Permissions/);
  assert.ok(calls.includes(`DELETE /channels/${C.general}/messages/700000000000000001`));
});

test('reasons written through the bot name the moderator and the command', () => {
  assert.deepEqual(ModLog.parseAuditReason('test — by Pixel (750867905226211388) via /lock'), { reason: 'test', by: { name: 'Pixel', id: '750867905226211388' }, via: '/lock' });
  assert.deepEqual(ModLog.parseAuditReason('by Pixel (750867905226211388) via mod portal'), { reason: '', by: { name: 'Pixel', id: '750867905226211388' }, via: 'mod portal' });
  assert.deepEqual(ModLog.parseAuditReason('Spamming'), { reason: 'Spamming', by: null, via: null });
  const entry = (type, oldDeny, newDeny, target = G) => ({ action_type: type, options: { id: target }, changes: [{ key: 'deny', old_value: oldDeny, new_value: newDeny }] });
  assert.equal(ModLog.lockFromAudit(entry(14, '0', SEND), G, 0), 'locked');
  assert.equal(ModLog.lockFromAudit(entry(14, SEND, '0'), G, 0), 'unlocked');
  assert.equal(ModLog.lockFromAudit(entry(13, undefined, String(1n << 20n)), G, 2), 'locked', 'voice: joining');
  assert.equal(ModLog.lockFromAudit(entry(15, SEND, undefined), G), 'unlocked');
  assert.equal(ModLog.lockFromAudit(entry(14, '0', SEND, R.mod), G, 0), null, 'another role\'s permissions');
  assert.equal(ModLog.lockFromAudit(entry(14, '0', String(1n << 6n)), G, 0), null, 'other permissions');
});
