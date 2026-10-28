// Built-in server layouts. Role `perms` presets: admin, manager, moderator, member, none, custom.
// Channel types: text, voice, announcement, forum, stage. `private` lists role keys that can see it.

const STAFF = ['admin', 'mod'];

const BUILTIN_TEMPLATES = [
  {
    id: 'builtin-creator',
    builtin: true,
    icon: '🎬',
    name: 'Content Creator',
    description: 'YouTuber / streamer community with uploads feed, clips, game nights and a staff area.',
    serverName: 'Pixel Squad',
    roles: [
      { key: 'owner', name: 'Creator', color: '#fc354c', hoist: true, mentionable: false, perms: 'admin' },
      { key: 'admin', name: 'Admin', color: '#a41d70', hoist: true, mentionable: false, perms: 'admin' },
      { key: 'mod', name: 'Moderator', color: '#0bbfbc', hoist: true, mentionable: true, perms: 'moderator' },
      { key: 'vip', name: 'VIP', color: '#f6c453', hoist: true, mentionable: false, perms: 'none' },
      { key: 'sub', name: 'Subscriber', color: '#e25aa8', hoist: true, mentionable: false, perms: 'none' },
      { key: 'member', name: 'Member', color: '#8fa6ff', hoist: false, mentionable: false, perms: 'member' },
      { key: 'notify', name: 'Upload Pings', color: '#7f8cf0', hoist: false, mentionable: true, perms: 'none' },
    ],
    categories: [
      {
        name: '📌 START HERE',
        channels: [
          { type: 'text', name: '👋・welcome', topic: 'Welcome to the squad! Read the rules and grab your roles.', readonly: true, system: true },
          { type: 'text', name: '📜・rules', topic: 'Be kind, no spam, keep it fun.', readonly: true },
          { type: 'announcement', name: '📢・announcements', topic: 'Big news and server updates.', readonly: true },
          { type: 'text', name: '🎭・roles', topic: 'Pick your notification roles.', readonly: true },
        ],
      },
      {
        name: '🎥 CONTENT',
        channels: [
          { type: 'announcement', name: '🔔・new-uploads', topic: 'Every new video, the moment it drops.', readonly: true },
          { type: 'text', name: '✂️・clips', topic: 'Share your favourite moments.' },
          { type: 'forum', name: '💡・video-ideas', topic: 'Pitch a video idea — one post per idea.' },
        ],
      },
      {
        name: '💬 HANGOUT',
        channels: [
          { type: 'text', name: '💬・general', topic: 'Talk about anything.' },
          { type: 'text', name: '🎵・music-reactions', topic: 'Songs you want reacted to.' },
          { type: 'text', name: '😂・memes', topic: 'Memes only.', slowmode: 5 },
          { type: 'text', name: '🤖・bot-commands', topic: 'Use bot commands here.' },
        ],
      },
      {
        name: '🎮 GAMING',
        channels: [
          { type: 'text', name: '🕹️・game-night', topic: 'Plan the next community game night.' },
          { type: 'text', name: '🔎・looking-for-group', topic: 'Find people to play with.' },
          { type: 'voice', name: '🎮 Game Night' },
          { type: 'voice', name: '🎧 Squad 1', userLimit: 4 },
          { type: 'voice', name: '🎧 Squad 2', userLimit: 4 },
        ],
      },
      {
        name: '🔊 VOICE',
        channels: [
          { type: 'voice', name: '🛋️ Hangout' },
          { type: 'voice', name: '📺 Watch Party' },
          { type: 'voice', name: '💤 AFK' },
        ],
      },
      {
        name: '🛡️ STAFF',
        private: ['owner', ...STAFF],
        channels: [
          { type: 'text', name: '🛡️・staff-chat' },
          { type: 'text', name: '📋・mod-log', readonly: true },
          { type: 'voice', name: '🛡️ Staff Room' },
        ],
      },
    ],
  },
  {
    id: 'builtin-gaming',
    builtin: true,
    icon: '🎮',
    name: 'Gaming Community',
    description: 'Classic gaming server: LFG, clips, per-game chats and squad voice rooms.',
    serverName: 'Gaming Hub',
    roles: [
      { key: 'admin', name: 'Admin', color: '#fc354c', hoist: true, mentionable: false, perms: 'admin' },
      { key: 'mod', name: 'Moderator', color: '#0bbfbc', hoist: true, mentionable: true, perms: 'moderator' },
      { key: 'events', name: 'Event Host', color: '#f6c453', hoist: true, mentionable: true, perms: 'none' },
      { key: 'veteran', name: 'Veteran', color: '#e25aa8', hoist: true, mentionable: false, perms: 'none' },
      { key: 'member', name: 'Gamer', color: '#8fa6ff', hoist: false, mentionable: false, perms: 'member' },
    ],
    categories: [
      {
        name: 'ℹ️ INFO',
        channels: [
          { type: 'text', name: 'welcome', topic: 'Welcome! Start here.', readonly: true, system: true },
          { type: 'text', name: 'rules', readonly: true },
          { type: 'announcement', name: 'announcements', readonly: true },
          { type: 'text', name: 'events', topic: 'Tournaments and community events.', readonly: true },
        ],
      },
      {
        name: '💬 COMMUNITY',
        channels: [
          { type: 'text', name: 'general' },
          { type: 'text', name: 'clips-and-screenshots' },
          { type: 'text', name: 'memes', slowmode: 5 },
          { type: 'forum', name: 'help-and-guides', topic: 'Ask for help or post a guide.' },
        ],
      },
      {
        name: '🎮 GAMES',
        channels: [
          { type: 'text', name: 'looking-for-group' },
          { type: 'text', name: 'fps-games' },
          { type: 'text', name: 'battle-royale' },
          { type: 'text', name: 'minecraft' },
          { type: 'text', name: 'indie-games' },
        ],
      },
      {
        name: '🔊 VOICE',
        channels: [
          { type: 'voice', name: 'Lobby' },
          { type: 'voice', name: 'Duo', userLimit: 2 },
          { type: 'voice', name: 'Squad', userLimit: 4 },
          { type: 'voice', name: 'Tournament', userLimit: 10 },
          { type: 'stage', name: 'Community Stage' },
        ],
      },
      {
        name: '🛡️ STAFF',
        private: STAFF,
        channels: [
          { type: 'text', name: 'staff-chat' },
          { type: 'text', name: 'reports' },
          { type: 'voice', name: 'Staff VC' },
        ],
      },
    ],
  },
  {
    id: 'builtin-study',
    builtin: true,
    icon: '📚',
    name: 'Study Group',
    description: 'Subjects, homework help forum, focus voice rooms and resources.',
    serverName: 'Study Hall',
    roles: [
      { key: 'admin', name: 'Organizer', color: '#a41d70', hoist: true, mentionable: false, perms: 'admin' },
      { key: 'mod', name: 'Tutor', color: '#0bbfbc', hoist: true, mentionable: true, perms: 'moderator' },
      { key: 'member', name: 'Student', color: '#8fa6ff', hoist: true, mentionable: false, perms: 'member' },
    ],
    categories: [
      {
        name: '📌 INFO',
        channels: [
          { type: 'text', name: 'welcome', readonly: true, system: true },
          { type: 'text', name: 'announcements', readonly: true },
          { type: 'text', name: 'schedule', topic: 'Study sessions and deadlines.', readonly: true },
        ],
      },
      {
        name: '📖 SUBJECTS',
        channels: [
          { type: 'text', name: 'math' },
          { type: 'text', name: 'science' },
          { type: 'text', name: 'history' },
          { type: 'text', name: 'languages' },
          { type: 'text', name: 'coding' },
          { type: 'forum', name: 'homework-help', topic: 'One post per question. Show your work!' },
        ],
      },
      {
        name: '🎧 STUDY ROOMS',
        channels: [
          { type: 'voice', name: 'Focus Room (silent)' },
          { type: 'voice', name: 'Pomodoro 1' },
          { type: 'voice', name: 'Pomodoro 2' },
          { type: 'voice', name: 'Group Study', userLimit: 8 },
        ],
      },
      {
        name: '🗂️ RESOURCES',
        channels: [
          { type: 'text', name: 'notes-and-links', slowmode: 30 },
          { type: 'text', name: 'off-topic' },
        ],
      },
    ],
  },
  {
    id: 'builtin-dev',
    builtin: true,
    icon: '💻',
    name: 'Dev Team',
    description: 'Engineering team workspace with code review forum, standups and a leads room.',
    serverName: 'Dev HQ',
    roles: [
      { key: 'admin', name: 'Lead', color: '#fc354c', hoist: true, mentionable: true, perms: 'admin' },
      { key: 'mod', name: 'Maintainer', color: '#0bbfbc', hoist: true, mentionable: true, perms: 'manager' },
      { key: 'dev', name: 'Developer', color: '#8fa6ff', hoist: true, mentionable: true, perms: 'member' },
      { key: 'design', name: 'Designer', color: '#e25aa8', hoist: true, mentionable: true, perms: 'member' },
      { key: 'guest', name: 'Guest', color: '#8a80a3', hoist: false, mentionable: false, perms: 'none' },
    ],
    categories: [
      {
        name: 'GENERAL',
        channels: [
          { type: 'text', name: 'announcements', readonly: true },
          { type: 'text', name: 'general', system: true },
          { type: 'text', name: 'random' },
        ],
      },
      {
        name: 'ENGINEERING',
        private: ['admin', 'mod', 'dev'],
        channels: [
          { type: 'text', name: 'frontend' },
          { type: 'text', name: 'backend' },
          { type: 'text', name: 'devops' },
          { type: 'text', name: 'deploys', readonly: true },
          { type: 'forum', name: 'code-review', topic: 'Link the PR and what to look at.' },
        ],
      },
      {
        name: 'DESIGN',
        channels: [
          { type: 'text', name: 'design' },
          { type: 'forum', name: 'design-feedback' },
        ],
      },
      {
        name: 'VOICE',
        channels: [
          { type: 'voice', name: 'Standup' },
          { type: 'voice', name: 'Pairing 1', userLimit: 2 },
          { type: 'voice', name: 'Pairing 2', userLimit: 2 },
        ],
      },
      {
        name: 'LEADS',
        private: ['admin'],
        channels: [{ type: 'text', name: 'leads-only' }],
      },
    ],
  },
  {
    id: 'builtin-blank',
    builtin: true,
    icon: '✨',
    name: 'Blank',
    description: 'Start from scratch and design every role and channel yourself.',
    serverName: '',
    roles: [],
    categories: [{ name: 'GENERAL', channels: [{ type: 'text', name: 'general', system: true }] }],
  },
];

const ROLE_PRESETS = [
  ['admin', 'Admin'],
  ['manager', 'Manager'],
  ['moderator', 'Moderator'],
  ['member', 'Member'],
  ['none', 'Cosmetic'],
  ['custom', 'Custom'],
];

const CHANNEL_TYPE_OPTIONS = [
  ['text', '# Text'],
  ['voice', '🔊 Voice'],
  ['announcement', '📢 Announcement'],
  ['forum', '💬 Forum'],
  ['stage', '🎙️ Stage'],
];

const cloneTemplate = (t) => JSON.parse(JSON.stringify(t));
