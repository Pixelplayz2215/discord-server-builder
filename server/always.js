// 24/7 on the mod portal. Once the owner turns it on in the app, the portal reads each server's
// settings from its #bot-settings channel (src/main/always.js), connects the bot to Discord's gateway
// and runs the same engines the app does: welcome and goodbye cards, auto roles, reaction roles, poll
// bars, server logs, server stats, scheduled announcements and YouTube alerts. What it did (votes,
// announcements sent, videos seen) is saved back to the channel, and the app reads it with a signed
// request. While it runs it calls its own /health every 10 minutes, so Render's free plan doesn't put
// it to sleep. With 24/7 off it does none of this and only answers slash commands and buttons.
const crypto = require('crypto');
const { PresenceConnection } = require('../src/main/gateway');
const Always = require('../src/main/always');
const { createServerLogger, intentsFor: logIntents, normalizeConfig: normalizeLogConfig } = require('../src/main/logs');
const reactionRoles = require('../src/main/reactionroles');
const polls = require('../src/main/polls');
const welcome = require('../src/main/welcome');
const stats = require('../src/main/stats');
const autoRoles = require('../src/main/autoroles');
const announce = require('../src/main/announce');
const social = require('../src/main/social');
const WelcomeCard = require('../src/shared/welcomecard');

const EVERY = { announce: 30 * 1000, stats: 60 * 1000, social: 60 * 1000, reload: 10 * 60 * 1000, ping: 10 * 60 * 1000 };
const SAVE_DELAY_MS = 30 * 1000;
const CATCH_UP_DELAY_MS = 5000;
const MAX_FOUND_POLLS = 50;

const emptyState = () => ({ announcements: {}, polls: { found: [], counts: {}, forgotten: [] }, alerts: {} });
const withDefaults = (s) => ({ ...emptyState(), ...s, polls: { ...emptyState().polls, ...s?.polls } });

// connect(onState, onEvent): the gateway connection (tests pass a fake).
function createAlways({ rest, token, publicUrl = '', cards = null, fetchImpl = fetch, now = Date.now, connect = null, saveDelayMs = SAVE_DELAY_MS, catchUpDelayMs = CATCH_UP_DELAY_MS, every = EVERY, log = console }) {
  const servers = new Map(); // guildId -> { channelId, bundle, state, stateMessage, files, loadedAt, problem, dirty }
  const problems = new Map(); // `${guildId}:${what}` -> latest problem
  const statsState = new Map(); // guildId -> { counts, updatedAt, problem }
  const fileCache = new Map(); // picture name -> bytes
  let botUserId = null;
  let engines = null;
  let conn = null;
  let gateway = { state: 'off', detail: null };
  let startedAt = null;
  let loadedAt = null;
  let loading = Promise.resolve();
  let timers = [];
  let saveTimer = null;
  let index = { panels: new Map(), polls: new Map() };

  const active = () => [...servers.entries()].filter(([, s]) => s.bundle?.on && s.bundle.used);
  const bundleOf = (guildId) => {
    const b = servers.get(guildId)?.bundle;
    return b?.on ? b : null;
  };
  const setProblem = (key, problem) => (problem ? problems.set(key, problem) : problems.delete(key));
  const serverOf = (guildId) => {
    if (!servers.has(guildId)) servers.set(guildId, { channelId: null, bundle: null, state: emptyState(), stateMessage: null, files: new Map(), loadedAt: null, problem: null, dirty: false });
    return servers.get(guildId);
  };

  /* ---------- Saving what the portal did ---------- */
  function markDirty(guildId) {
    const s = servers.get(guildId);
    if (!s) return;
    s.dirty = true;
    if (!saveTimer) {
      saveTimer = setTimeout(() => {
        saveTimer = null;
        flush().catch(() => {});
      }, saveDelayMs);
      saveTimer.unref?.();
    }
  }

  async function flush() {
    for (const [guildId, s] of servers) {
      if (!s.dirty || !s.channelId) continue;
      s.dirty = false;
      try {
        s.stateMessage = await Always.saveState({ rest, token, channelId: s.channelId, existing: s.stateMessage, state: s.state });
        setProblem(`${guildId}:state`, null);
      } catch (err) {
        s.dirty = true;
        setProblem(`${guildId}:state`, `Couldn't save what the portal did: ${err.message}`);
      }
    }
  }

  /* ---------- Pictures (card backgrounds, announcement pictures) ---------- */
  async function fileData(name) {
    if (fileCache.has(name)) return fileCache.get(name);
    for (const s of servers.values()) {
      const f = s.files?.get(name);
      if (!f) continue;
      let data;
      try {
        data = await Always.download(f.url, fetchImpl);
      } catch {
        // The file link expired: ask for the message again for a fresh one.
        const m = await rest.request('GET', `/channels/${s.channelId}/messages/${f.messageId}`);
        data = await Always.download(m.attachments.find((a) => a.filename === name).url, fetchImpl);
      }
      fileCache.set(name, data);
      return data;
    }
    return null;
  }

  /* ---------- Engines' settings and what they report ---------- */
  function greetingsOf(guildId) {
    const b = bundleOf(guildId);
    if (!b?.greetings) return null;
    const kind = (k) => {
      const settings = WelcomeCard.normalizeKind(b.greetings[k], k);
      const bg = settings.card.background;
      if (bg.type === 'image') bg.image = b.files?.[bg.image] || '';
      return settings;
    };
    return { guildName: b.greetings.guildName || '', welcome: kind('welcome'), goodbye: kind('goodbye') };
  }

  function rebuildIndex() {
    const panels = new Map();
    const pollIndex = new Map();
    for (const [guildId, s] of servers) {
      const b = s.bundle?.on ? s.bundle : null;
      for (const p of b?.reactionRoles || []) if (p.messageId) panels.set(p.messageId, { ...p, guildId });
      const forgotten = new Set(s.state.polls.forgotten);
      for (const p of [...(b?.polls || []), ...s.state.polls.found]) {
        if (p.messageId && !forgotten.has(p.id) && !pollIndex.has(p.messageId)) pollIndex.set(p.messageId, { ...p, guildId });
      }
    }
    index = { panels, polls: pollIndex };
  }

  function savePoll(poll, counts) {
    const s = servers.get(poll.guildId);
    if (!s) return;
    const before = s.state.polls.counts[poll.id];
    const next = { counts, ended: !!poll.ended, endedAt: poll.ended ? before?.endedAt || now() : null };
    if (JSON.stringify(before) === JSON.stringify(next)) return;
    s.state.polls.counts[poll.id] = next;
    markDirty(poll.guildId);
  }

  function forgetPoll(poll) {
    const s = servers.get(poll.guildId);
    if (!s) return;
    s.state.polls.found = s.state.polls.found.filter((p) => p.id !== poll.id);
    delete s.state.polls.counts[poll.id];
    if (!s.state.polls.forgotten.includes(poll.id)) s.state.polls.forgotten.push(poll.id);
    setProblem(`${poll.guildId}:poll:${poll.id}`, null);
    rebuildIndex();
    markDirty(poll.guildId);
  }

  // Someone posted a poll with /poll: keep it, so its bars fill in and the app lists it.
  async function addFoundPoll(found) {
    if (index.polls.has(found.messageId)) return;
    const [channel, guild, options] = await Promise.all([
      rest.request('GET', `/channels/${found.channelId}`).catch(() => null),
      rest.request('GET', `/guilds/${found.guildId}`).catch(() => null),
      Promise.all(found.options.map(async (o, i) => ({ ...o, color: cards ? await cards.emojiColor(o.emoji, i) : polls.defaultColor(o.emoji, i) }))),
    ]);
    const s = serverOf(found.guildId);
    if (s.state.polls.found.some((p) => p.messageId === found.messageId)) return;
    const poll = { ...found, options, id: crypto.randomUUID(), source: 'command', guildName: guild?.name || '', channelName: channel?.name || '', counts: options.map(() => 0) };
    s.state.polls.found = [...s.state.polls.found, poll].slice(-MAX_FOUND_POLLS);
    rebuildIndex();
    markDirty(found.guildId);
  }

  function scheduledAnnouncements() {
    return active()
      .flatMap(([guildId, s]) =>
        s.bundle.announcements.map((a) => {
          const saved = s.state.announcements[a.id];
          return { ...(saved?.key === Always.announceKey(a) ? { ...a, ...saved.patch } : a), guildId };
        }),
      )
      .filter((a) => a.schedule?.on);
  }

  function updateAnnouncement(a, patch) {
    const s = servers.get(a.guildId);
    const original = s?.bundle?.announcements.find((x) => x.id === a.id);
    if (!original) return;
    const key = Always.announceKey(original);
    const saved = s.state.announcements[a.id];
    s.state.announcements[a.id] = { key, updatedAt: now(), patch: { ...(saved?.key === key ? saved.patch : {}), ...patch } };
    markDirty(a.guildId);
  }

  async function sendAnnouncement(a) {
    let image = null;
    const name = a.embed?.imageFile && bundleOf(a.guildId)?.files?.[a.embed.imageFile];
    if (name) {
      const data = await fileData(name);
      if (data) image = { name: a.embed.imageFile, data, type: Always.FILE_TYPES[name.split('.').pop()] || 'image/png' };
    }
    const { body, files } = announce.buildMessage(a, image);
    return rest.request('POST', `/channels/${a.channelId}/messages`, { body, files });
  }

  function youtubeAlerts() {
    return active().flatMap(([, s]) => s.bundle.alerts.map((a) => ({ ...a, state: s.state.alerts[a.id] || a.state })));
  }

  function updateAlert(id, state) {
    for (const [guildId, s] of servers) {
      if (!s.bundle?.alerts?.some((a) => a.id === id)) continue;
      const { checkedAt, ...before } = s.state.alerts[id] || {};
      const { checkedAt: when, ...after } = state;
      s.state.alerts[id] = state;
      // A check that found nothing new isn't worth saving.
      if (JSON.stringify(before) !== JSON.stringify(after)) markDirty(guildId);
      return;
    }
  }

  function makeEngines(botId) {
    return {
      logger: createServerLogger({
        rest,
        configFor: (guildId) => {
          const b = bundleOf(guildId);
          const c = b?.logs ? normalizeLogConfig(b.logs) : null;
          return c?.enabled && c.channelId ? { ...c, content: !!b.bot.intents?.content } : null;
        },
        onError: (guildId, err) => setProblem(`${guildId}:logs`, err.message),
      }),
      reactions: reactionRoles.createReactionRoles({ rest, botId, panelFor: (id) => index.panels.get(id) || null, report: (panel, p) => setProblem(`${panel.guildId}:panel:${panel.id}`, p) }),
      polls: polls.createPolls({
        rest,
        botId,
        pollFor: (id) => index.polls.get(id) || null,
        discover: addFoundPoll,
        saved: savePoll,
        forget: forgetPoll,
        report: (poll, p) => setProblem(`${poll.guildId}:poll:${poll.id}`, p),
      }),
      welcomer: welcome.createWelcomer({
        rest,
        settingsFor: greetingsOf,
        render: (card, vars, user) => {
          if (!cards) throw new Error("this portal can't draw cards.");
          return cards.render(card, vars, user);
        },
        report: (guildId, kind, p) => setProblem(`${guildId}:${kind}`, p),
      }),
      autoRoles: autoRoles.createAutoRoles({ rest, settingsFor: (guildId) => bundleOf(guildId)?.autoroles || null, report: (guildId, p) => setProblem(`${guildId}:autoroles`, p) }),
      stats: stats.createStats({
        rest,
        settingsFor: () => active().filter(([, s]) => s.bundle.stats).map(([guildId, s]) => ({ guildId, settings: s.bundle.stats })),
        report: (guildId, state) => statsState.set(guildId, state),
      }),
      announcer: announce.createScheduler({ list: scheduledAnnouncements, send: sendAnnouncement, update: updateAnnouncement, now }),
      social: social.createSocialWatcher({
        getAlerts: youtubeAlerts,
        updateState: updateAlert,
        post: (alert, message) => rest.request('POST', `/channels/${alert.channelId}/messages`, { body: message }),
        getTwitch: () => null, // Twitch alerts stay with the app
        fetchImpl,
        now,
        youtubeKey: () => active().map(([, s]) => s.bundle.youtubeKey).find(Boolean) || '',
      }),
    };
  }

  /* ---------- The gateway connection ---------- */
  function onEvent(type, d) {
    if (!engines) return;
    engines.logger.handle(type, d);
    engines.reactions.handle(type, d)?.catch?.(() => {});
    engines.polls.handle(type, d)?.catch?.(() => {});
    engines.welcomer.handle(type, d);
    engines.autoRoles.handle(type, d)?.catch?.(() => {});
    // Connected: hand out roles for reactions made while it was away, and redraw polls.
    if (type === 'READY') setTimeout(() => catchUp().catch(() => {}), catchUpDelayMs);
  }

  async function catchUp() {
    for (const panel of index.panels.values()) await engines.reactions.catchUp(panel);
    await engines.polls.catchUp([...index.polls.values()]);
  }

  const onState = (state, detail) => {
    gateway = { state, detail: detail || null };
  };

  function repeat(ms, job) {
    const timer = setInterval(() => job().catch((err) => log.error?.('24/7:', err.message)), ms);
    timer.unref?.(); // the web server keeps the portal running
    timers.push(timer);
  }

  function startTimers() {
    stopTimers();
    repeat(every.announce, () => engines.announcer.tick());
    repeat(every.stats, () => engines.stats.tick());
    repeat(every.social, () => engines.social.tick());
    repeat(every.reload, () => reload());
    // Render's free plan sleeps after 15 minutes without visitors; this keeps it awake while 24/7 is on.
    if (/^https:\/\//.test(publicUrl)) repeat(every.ping, () => fetchImpl(`${publicUrl}/health`).then(() => {}));
  }

  function stopTimers() {
    for (const t of timers) clearInterval(t);
    timers = [];
  }

  // Connects with the intents the servers' settings need, or disconnects when none have 24/7 on.
  function applyConnection() {
    const on = active();
    if (!on.length) {
      if (conn) conn.stop();
      conn = null;
      startedAt = null;
      gateway = { state: 'off', detail: null };
      stopTimers();
      return;
    }
    const newest = on.map(([, s]) => s.bundle).sort((a, b) => b.savedAt - a.savedAt)[0];
    const botIntents = newest.bot.intents || {};
    const logs = on.map(([, s]) => (s.bundle.logs ? normalizeLogConfig(s.bundle.logs) : null)).filter((c) => c?.enabled && c.channelId);
    const reactions = index.panels.size > 0 || [...index.polls.values()].some((p) => !p.ended) || on.some(([, s]) => s.bundle.bot.slashCommands);
    const members = on.some(([, s]) => s.bundle.greetings?.welcome?.enabled || s.bundle.greetings?.goodbye?.enabled || s.bundle.autoroles?.enabled);
    const intents =
      welcome.WELCOME_INTENTS.GUILDS |
      (logs.length ? logIntents(logs, botIntents) : 0) |
      (reactions ? reactionRoles.RR_INTENTS : 0) |
      (members && botIntents.members ? welcome.WELCOME_INTENTS.GUILD_MEMBERS : 0);
    if (!conn) {
      conn = connect ? connect(onState, onEvent) : new PresenceConnection(token, onState, onEvent);
      startedAt = now();
      startTimers();
    }
    conn.setIntents(intents);
    const presence = newest.bot.presence;
    conn.start(presence?.enabled ? presence : { status: 'invisible', text: '' });
  }

  /* ---------- Reading the settings ---------- */
  async function listGuilds() {
    const ids = [];
    let after;
    for (;;) {
      const page = await rest.request('GET', '/users/@me/guilds', { query: { limit: 200, after } });
      ids.push(...page.map((g) => g.id));
      if (page.length < 200) return ids;
      after = page[page.length - 1].id;
    }
  }

  // Drops what the portal kept for things the settings no longer have.
  function pruneState(bundle, state) {
    const keep = (obj, ids) => {
      for (const id of Object.keys(obj)) if (!ids.has(id)) delete obj[id];
    };
    keep(state.announcements, new Set(bundle.announcements.map((a) => a.id)));
    keep(state.alerts, new Set(bundle.alerts.map((a) => a.id)));
    const known = new Set(bundle.polls.map((p) => p.messageId));
    state.polls.found = state.polls.found.filter((p) => !known.has(p.messageId));
    keep(state.polls.counts, new Set([...bundle.polls, ...state.polls.found].map((p) => p.id)));
    state.polls.forgotten = state.polls.forgotten.filter((id) => bundle.polls.some((p) => p.id === id));
  }

  async function load(guildIds) {
    if (!botUserId) botUserId = (await rest.request('GET', '/users/@me')).id;
    engines ||= makeEngines(botUserId);
    const ids = guildIds?.length ? guildIds.map(String) : await listGuilds();
    for (const guildId of ids) {
      const s = serverOf(guildId);
      try {
        const loaded = await Always.loadBundle({ rest, token, guildId, botUserId, fetchImpl });
        s.loadedAt = now();
        s.problem = null;
        if (!loaded) {
          s.bundle = null;
          continue;
        }
        // What's in memory is newer than what was last saved.
        if (!s.channelId) {
          const found = s.state.polls.found;
          s.state = withDefaults(loaded.state);
          for (const p of found) if (!s.state.polls.found.some((q) => q.messageId === p.messageId)) s.state.polls.found.push(p);
        }
        pruneState(loaded.bundle, s.state);
        Object.assign(s, { channelId: loaded.channelId, bundle: loaded.bundle, stateMessage: s.stateMessage || loaded.stateMessage, files: loaded.files });
      } catch (err) {
        s.loadedAt = now();
        s.problem = err.code === 10004 || err.code === 50001 ? "The bot can't see this server's channels." : err.message; // keeps the last good settings
      }
    }
    if (!guildIds?.length) for (const id of [...servers.keys()]) if (!ids.includes(id)) servers.delete(id); // the bot left
    const used = new Set(active().flatMap(([, s]) => Object.values(s.bundle.files || {})));
    for (const name of [...fileCache.keys()]) if (!used.has(name)) fileCache.delete(name);
    for (const [guildId] of servers) if (!bundleOf(guildId)?.stats) engines.stats.forget(guildId);
    loadedAt = now();
    rebuildIndex();
    applyConnection();
  }

  // Reads the settings again (all servers, or just these), one read at a time.
  function reload(guildIds = null) {
    loading = loading.catch(() => {}).then(() => load(guildIds));
    return loading;
  }

  function status() {
    const out = {};
    for (const [guildId, s] of servers) {
      const prefix = `${guildId}:`;
      out[guildId] = {
        on: !!s.bundle?.on,
        savedAt: s.bundle?.savedAt || null,
        loadedAt: s.loadedAt,
        problem: s.problem,
        problems: Object.fromEntries([...problems].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v])),
        stats: statsState.get(guildId) || null,
        state: s.state,
      };
    }
    return { version: Always.VERSION, running: !!conn, gateway, startedAt, loadedAt, cards: !!cards?.available, servers: out };
  }

  async function close() {
    clearTimeout(saveTimer);
    saveTimer = null;
    stopTimers();
    if (conn) conn.stop();
    conn = null;
    await flush();
  }

  return { start: () => reload(), reload, status, flush, close, fileData, tick: () => Promise.all([engines?.announcer.tick(), engines?.stats.tick(), engines?.social.tick()]) };
}

module.exports = { createAlways, EVERY };
