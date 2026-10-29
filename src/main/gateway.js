// Keeps a bot "online" in Discord with an optional custom status, and (when server logs are on)
// receives the server events those logs need. Without logs no intents are requested.
const WebSocket = require('ws');

// Intents Discord only allows when they're switched on in the Developer Portal.
const PRIVILEGED = (1 << 1) | (1 << 8) | (1 << 15);

const GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';
const FATAL_CODES = {
  4004: 'Authentication failed — the token was rejected.',
  4010: 'Invalid shard.',
  4011: 'Sharding required — this bot is in too many servers for a single connection.',
  4012: 'Invalid gateway API version.',
  4013: 'Invalid intents.',
  4014: 'Disallowed intents.',
};

class PresenceConnection {
  // onEvent(type, data) receives every dispatched gateway event.
  constructor(token, onState, onEvent = null) {
    this.token = token;
    this.onState = onState;
    this.onEvent = onEvent;
    this.intents = 0;
    this.enabled = false;
    this.ws = null;
    this.heartbeat = null;
    this.retryTimer = null;
    this.seq = null;
    this.acked = true;
    this.ready = false;
    this.presence = { status: 'online', text: '' };
  }

  start(presence) {
    this.presence = { ...this.presence, ...presence };
    if (this.enabled && this.ready) return this.sendPresence();
    this.enabled = true;
    this.connect();
  }

  stop() {
    this.enabled = false;
    this.teardown();
    this.onState('offline');
  }

  update(presence) {
    this.presence = { ...this.presence, ...presence };
    if (this.ready) this.sendPresence();
  }

  // Changing intents needs a fresh connection.
  setIntents(intents) {
    if (intents === this.intents) return;
    this.intents = intents;
    if (this.enabled) this.connect();
  }

  presencePayload() {
    const { status, text } = this.presence;
    return {
      since: null,
      afk: false,
      status: status || 'online',
      activities: text ? [{ name: 'Custom Status', type: 4, state: text.slice(0, 128) }] : [],
    };
  }

  sendPresence() {
    this.send({ op: 3, d: this.presencePayload() });
  }

  send(payload) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
  }

  connect() {
    this.teardown();
    this.onState('connecting');
    const ws = new WebSocket(GATEWAY_URL);
    this.ws = ws;
    ws.on('message', (raw) => {
      try {
        this.handle(JSON.parse(raw.toString()));
      } catch {
        // ignore malformed frames
      }
    });
    ws.on('error', () => {});
    ws.on('close', (code) => {
      if (this.ws !== ws) return;
      this.teardown();
      // A privileged intent was switched off in the Developer Portal: keep going without them.
      if (code === 4014 && this.intents & PRIVILEGED) {
        this.intents &= ~PRIVILEGED;
        this.onState('connecting', 'Server Members or Message Content Intent is off; reconnecting without it.');
        this.connect();
        return;
      }
      if (FATAL_CODES[code]) {
        this.enabled = false;
        this.onState('error', FATAL_CODES[code]);
        return;
      }
      if (this.enabled) {
        this.onState('connecting', 'Reconnecting…');
        this.retryTimer = setTimeout(() => this.connect(), 5000);
      }
    });
  }

  handle(packet) {
    if (packet.s != null) this.seq = packet.s;
    switch (packet.op) {
      case 10: {
        const interval = packet.d.heartbeat_interval;
        this.acked = true;
        setTimeout(() => this.beat(), Math.random() * interval);
        this.heartbeat = setInterval(() => this.beat(), interval);
        this.send({
          op: 2,
          d: {
            token: this.token,
            intents: this.intents,
            properties: { os: 'windows', browser: 'DiscordServerBuilder', device: 'DiscordServerBuilder' },
            presence: this.presencePayload(),
          },
        });
        break;
      }
      case 11:
        this.acked = true;
        break;
      case 1:
        this.beat(true);
        break;
      case 7: // server asked us to reconnect
      case 9: // invalid session
        this.ws?.close(4000);
        break;
      case 0:
        if (packet.t === 'READY') {
          this.ready = true;
          this.onState('online');
        }
        if (this.onEvent) {
          try {
            this.onEvent(packet.t, packet.d);
          } catch {
            // a logging problem must never drop the connection
          }
        }
        break;
      default:
        break;
    }
  }

  beat(force = false) {
    if (!force && !this.acked) {
      this.ws?.close(4000); // zombie connection, reconnect
      return;
    }
    this.acked = false;
    this.send({ op: 1, d: this.seq });
  }

  teardown() {
    clearInterval(this.heartbeat);
    clearTimeout(this.retryTimer);
    this.heartbeat = null;
    this.retryTimer = null;
    this.ready = false;
    this.seq = null;
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState <= WebSocket.OPEN) {
      try {
        ws.close(1000);
      } catch {
        ws.terminate();
      }
    }
  }
}

module.exports = { PresenceConnection, PRIVILEGED };
