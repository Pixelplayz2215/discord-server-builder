// Tests for announcements and their schedules. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const an = require('../src/main/announce');

const G = '100000000000000001';
const CH = '300000000000000001';
const ROLE = '400000000000000001';
const base = (extra = {}) => ({ guildId: G, channelId: CH, content: 'Big news!', ...extra });

test('announcements are checked: something to send, real links, and a card that fits', () => {
  assert.throws(() => an.normalize(base({ content: '' })), /Write a message/);
  assert.throws(() => an.normalize(base({ embed: { on: true, url: 'javascript:alert(1)', title: 'x' } })), /title link must be a web address/);
  assert.throws(() => an.normalize(base({ buttons: [{ label: 'Site' }] })), /Every button needs its text and a link/);
  assert.throws(() => an.normalize(base({ embed: { on: true, description: 'x'.repeat(4000), fields: [{ name: 'a', value: 'y'.repeat(1024) }, { name: 'b', value: 'y'.repeat(1024) }] } })), /6,000 characters/);
  const a = an.normalize(base({ ping: 'nope', embed: { on: true, title: 'Patch notes', fields: [{ name: '', value: '' }, { name: 'New', value: 'Stuff', inline: true }] } }));
  assert.equal(a.ping, 'none');
  assert.equal(a.name, 'Patch notes', 'named after the card title');
  assert.deepEqual(a.embed.fields, [{ name: 'New', value: 'Stuff', inline: true }]);
});

test('the message pings only what was picked, and puts the picked image in the card', () => {
  const a = an.normalize(base({ ping: ROLE, embed: { on: true, title: 'Event', url: 'https://example.com', description: 'Join us', color: 0xff0000, author: { name: 'Staff', icon: 'https://example.com/a.png' }, imageFile: 'abc.png', thumbnail: 'https://example.com/t.png', footer: 'See you', timestamp: true, fields: [{ name: 'When', value: 'Friday', inline: true }] }, buttons: [{ label: 'Sign up', url: 'https://example.com/signup' }] }));
  const image = { name: 'abc.png', data: Buffer.from('png'), type: 'image/png' };
  const { body, files } = an.buildMessage(a, image, Date.UTC(2026, 10, 1, 12));
  assert.equal(body.content, `<@&${ROLE}> Big news!`);
  assert.deepEqual(body.allowed_mentions, { parse: [], roles: [ROLE] });
  assert.deepEqual(body.embeds[0], {
    color: 0xff0000,
    title: 'Event',
    url: 'https://example.com',
    description: 'Join us',
    author: { name: 'Staff', icon_url: 'https://example.com/a.png' },
    image: { url: 'attachment://abc.png' },
    thumbnail: { url: 'https://example.com/t.png' },
    footer: { text: 'See you' },
    timestamp: '2026-11-01T12:00:00.000Z',
    fields: [{ name: 'When', value: 'Friday', inline: true }],
  });
  assert.deepEqual(body.components, [{ type: 1, components: [{ type: 2, style: 5, label: 'Sign up', url: 'https://example.com/signup' }] }]);
  assert.deepEqual(files, [image]);

  assert.deepEqual(an.buildMessage(an.normalize(base({ ping: 'everyone' }))).body.allowed_mentions, { parse: ['everyone'] });
  const quiet = an.buildMessage(an.normalize(base({ content: 'hi <@&400000000000000001> @everyone' }))).body;
  assert.deepEqual(quiet.allowed_mentions, { parse: [] }, 'mentions typed in the text never ping');
});

test('schedules repeat by the calendar: daily, weekly and monthly (the 31st stays the 31st)', () => {
  const at = (y, m, d, h = 9) => new Date(y, m, d, h).getTime();
  assert.equal(an.nextRun({ at: at(2026, 0, 31), repeat: 'monthly' }, at(2026, 0, 31)), at(2026, 1, 28), 'February has no 31st');
  assert.equal(an.nextRun({ at: at(2026, 0, 31), repeat: 'monthly' }, at(2026, 1, 28)), at(2026, 2, 31), 'and March is back on the 31st');
  assert.equal(an.nextRun({ at: at(2026, 9, 30), repeat: 'weekly' }, at(2026, 10, 1)), at(2026, 10, 6));
  assert.equal(an.nextRun({ at: at(2026, 9, 30), repeat: 'daily' }, at(2026, 9, 30, 10)), at(2026, 9, 31));
  assert.equal(new Date(an.nextRun({ at: at(2026, 2, 1, 9), repeat: 'daily' }, at(2026, 2, 29, 12))).getHours(), 9, 'the same clock time across a daylight-saving change');
  assert.throws(() => an.normalize(base({ schedule: { on: true, at: at(2020, 0, 1), repeat: 'once' } }), at(2026, 0, 1)), /already passed/);
  assert.equal(an.normalize(base({ schedule: { on: true, at: at(2026, 0, 1), repeat: 'daily' } }), at(2026, 0, 5, 12)).schedule.nextAt, at(2026, 0, 6), 'a repeating start in the past begins at its next time');
});

test('the scheduler sends what is due, catches up a little, and skips what is long gone', async () => {
  let clock = new Date(2026, 10, 1, 12).getTime();
  const sent = [];
  const items = [
    { id: 'due', channelId: CH, schedule: { on: true, at: clock - 60e3, repeat: 'once', nextAt: clock - 60e3 } },
    { id: 'weekly', channelId: CH, schedule: { on: true, at: clock - 30 * 60e3, repeat: 'weekly', nextAt: clock - 30 * 60e3 } },
    { id: 'old-once', channelId: CH, schedule: { on: true, at: clock - 5 * 3600e3, repeat: 'once', nextAt: clock - 5 * 3600e3 } },
    { id: 'old-daily', channelId: CH, schedule: { on: true, at: clock - 5 * 3600e3, repeat: 'daily', nextAt: clock - 5 * 3600e3 } },
    { id: 'later', channelId: CH, schedule: { on: true, at: clock + 3600e3, repeat: 'once', nextAt: clock + 3600e3 } },
    { id: 'broken', channelId: CH, schedule: { on: true, at: clock - 1000, repeat: 'once', nextAt: clock - 1000 } },
  ];
  const scheduler = an.createScheduler({
    list: () => items,
    send: async (a) => {
      if (a.id === 'broken') throw new Error('Missing Access');
      sent.push(a.id);
      return { id: `msg-${a.id}` };
    },
    update: (a, patch) => Object.assign(a, patch),
    now: () => clock,
  });
  await scheduler.tick();
  const byId = Object.fromEntries(items.map((a) => [a.id, a]));
  assert.deepEqual(sent, ['due', 'weekly'], 'up to an hour late is still sent');
  assert.equal(byId.due.schedule.on, false);
  assert.equal(byId.due.lastMessageId, 'msg-due');
  assert.equal(byId.weekly.schedule.nextAt, clock - 30 * 60e3 + 7 * 86400e3);
  assert.equal(byId['old-once'].schedule.on, false);
  assert.equal(byId['old-once'].missedAt, clock - 5 * 3600e3, 'a one-off that is hours late waits for you');
  assert.ok(byId['old-daily'].schedule.nextAt > clock, 'a repeating one moves on');
  assert.equal(byId.later.schedule.nextAt, clock + 3600e3);
  assert.match(byId.broken.problem, /Couldn't send it on time: Missing Access/);

  await scheduler.tick();
  assert.deepEqual(sent, ['due', 'weekly'], 'nothing is sent twice');
});
