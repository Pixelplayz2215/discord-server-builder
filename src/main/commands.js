// Slash commands for moderators, plus /poll for everyone, answered by the mod portal
// (server/interactions.js). The app registers them on the owner's bot; the portal handles them with
// the same permission rules as the app.
const PERMS = {
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_MESSAGES: 1n << 13n,
  MODERATE_MEMBERS: 1n << 40n,
};
const OPTION = { STRING: 3, INTEGER: 4, USER: 6, CHANNEL: 7 };
const CHANNEL = { TEXT: 0, VOICE: 2, ANNOUNCEMENT: 5, STAGE: 13, FORUM: 15 };

const choices = (pairs) => pairs.map(([name, value]) => ({ name, value }));
const DURATIONS = choices([['60 seconds', 60], ['5 minutes', 300], ['10 minutes', 600], ['1 hour', 3600], ['6 hours', 21600], ['1 day', 86400], ['1 week', 604800]]);
const DELETE_WINDOWS = choices([["Don't delete any", 0], ['Last hour', 3600], ['Last 24 hours', 86400], ['Last 7 days', 604800]]);
const SLOWMODES = choices([['Off', 0], ['5 seconds', 5], ['10 seconds', 10], ['30 seconds', 30], ['1 minute', 60], ['5 minutes', 300], ['15 minutes', 900], ['1 hour', 3600], ['6 hours', 21600]]);
const labelFor = (list, value) => list.find((c) => c.value === Number(value))?.name || String(value);

const user = (name, description) => ({ type: OPTION.USER, name, description, required: true });
const reason = (description = 'Why (shown in the audit log and #mod-cases)', required = false) => ({ type: OPTION.STRING, name: 'reason', description, required, max_length: 400 });
const channel = (types) => ({ type: OPTION.CHANNEL, name: 'channel', description: 'Which channel (default: this one)', channel_types: types });
const LOCKABLE = [CHANNEL.TEXT, CHANNEL.VOICE, CHANNEL.ANNOUNCEMENT, CHANNEL.STAGE, CHANNEL.FORUM];
// /poll's emoji boxes suggest the server's own emojis and standard ones as you type.
const pollEmoji = (n, required) => ({ type: OPTION.STRING, name: `emoji${n}`, description: `Emoji for option ${n} (type to search, server emojis too)`, required, autocomplete: true, max_length: 100 });
const pollOption = (n, required) => ({ type: OPTION.STRING, name: `option${n}`, description: `Option ${n}`, required, max_length: 55 });

// default_member_permissions hides a command from members without that permission (null: everyone).
// Server admins can change who sees it under Server Settings → Integrations; the portal checks
// permissions either way.
const command = (name, description, need, options) => ({
  name,
  description,
  default_member_permissions: need == null ? null : String(need),
  contexts: [0],
  integration_types: [0],
  options,
});

const COMMANDS = [
  command('warn', 'Warn a member. They get the reason in a DM and it is recorded as a case.', PERMS.MODERATE_MEMBERS, [
    user('member', 'Who to warn'),
    reason('What they did (they will see this)', true),
  ]),
  command('timeout', "Time out a member so they can't chat or join voice", PERMS.MODERATE_MEMBERS, [
    user('member', 'Who to time out'),
    { type: OPTION.INTEGER, name: 'duration', description: 'How long', required: true, choices: DURATIONS },
    reason(),
  ]),
  command('untimeout', "End a member's timeout", PERMS.MODERATE_MEMBERS, [user('member', 'Whose timeout to end'), reason()]),
  command('kick', 'Kick a member from the server', PERMS.KICK_MEMBERS, [user('member', 'Who to kick'), reason()]),
  command('ban', 'Ban a member, or anyone by user ID', PERMS.BAN_MEMBERS, [
    user('member', 'Who to ban (you can paste a user ID)'),
    reason(),
    { type: OPTION.INTEGER, name: 'delete_messages', description: 'Also delete their recent messages', choices: DELETE_WINDOWS },
  ]),
  command('unban', 'Lift a ban', PERMS.BAN_MEMBERS, [user('user', 'Who to unban (paste their user ID)'), reason()]),
  command('cases', "Show a member's warnings and moderation history", PERMS.MODERATE_MEMBERS, [user('member', 'Whose history to show')]),
  command('purge', 'Delete recent messages in this channel', PERMS.MANAGE_MESSAGES, [
    { type: OPTION.INTEGER, name: 'count', description: 'How many messages (1-500)', required: true, min_value: 1, max_value: 500 },
    reason(),
  ]),
  command('lock', 'Stop members sending messages in a channel', PERMS.MANAGE_CHANNELS, [channel(LOCKABLE), reason()]),
  command('unlock', 'Let members send messages in a channel again', PERMS.MANAGE_CHANNELS, [channel(LOCKABLE), reason()]),
  command('slowmode', 'Set how often members can send messages in a channel', PERMS.MANAGE_CHANNELS, [
    { type: OPTION.INTEGER, name: 'interval', description: 'Time between messages', required: true, choices: SLOWMODES },
    channel([CHANNEL.TEXT, CHANNEL.VOICE, CHANNEL.FORUM]),
  ]),
  command('poll', 'Post a poll members vote on by reacting', null, [
    { type: OPTION.STRING, name: 'message', description: 'The question', required: true, max_length: 256 },
    pollEmoji(1, true),
    pollOption(1, true),
    pollEmoji(2, true),
    pollOption(2, true),
    pollEmoji(3, false),
    pollOption(3, false),
    pollEmoji(4, false),
    pollOption(4, false),
  ]),
];
const NAMES = new Set(COMMANDS.map((c) => c.name));

// Creating a command with an existing name updates it, so this adds or refreshes these commands
// without touching any other commands the bot has.
async function registerCommands(rest, appId) {
  for (const def of COMMANDS) await rest.request('POST', `/applications/${appId}/commands`, { body: def });
}

async function removeCommands(rest, appId) {
  const existing = await rest.request('GET', `/applications/${appId}/commands`);
  for (const c of existing) if (NAMES.has(c.name)) await rest.request('DELETE', `/applications/${appId}/commands/${c.id}`);
}

module.exports = { COMMANDS, NAMES, DURATIONS, DELETE_WINDOWS, SLOWMODES, labelFor, registerCommands, removeCommands };
