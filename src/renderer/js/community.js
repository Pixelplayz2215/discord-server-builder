// Community: the features that run in your servers (welcome cards, reaction roles, tickets, polls,
// server stats and social alerts) under one rail button, with a menu to move between them. Each
// keeps its own page.

const COMMUNITY_PAGES = [
  ['welcome', 'Welcome & goodbye', 'door', 'Cards when members join or leave'],
  ['reactionroles', 'Reaction roles', 'smile', 'Roles members pick by reacting'],
  ['tickets', 'Tickets', 'ticket', 'Private support channels'],
  ['polls', 'Polls', 'poll', 'Votes with coloured bars'],
  ['stats', 'Server stats', 'stats', 'Live member, bot and role counts'],
  ['social', 'Social alerts', 'megaphone', 'YouTube uploads and Twitch streams'],
];

const Community = {
  // The page the rail button opens: the one used last.
  get last() {
    try {
      const saved = localStorage.getItem('community-page');
      if (Community.has(saved)) return saved;
    } catch {
      // storage unavailable: start at the first page
    }
    return COMMUNITY_PAGES[0][0];
  },

  has(page) {
    return COMMUNITY_PAGES.some(([p]) => p === page);
  },

  label(page) {
    return COMMUNITY_PAGES.find(([p]) => p === page)?.[1] || '';
  },

  render(page) {
    try {
      localStorage.setItem('community-page', page);
    } catch {
      // not remembered this time
    }
    const pages = { welcome: WelcomePage, reactionroles: ReactionRolesPage, tickets: TicketsPage, polls: PollsPage, stats: StatsPage, social: SocialPage };
    return h(
      'div',
      { class: 'community' },
      h(
        'nav',
        { class: 'community-nav' },
        h('span', { class: 'eyebrow' }, 'Community'),
        COMMUNITY_PAGES.map(([p, label, ic, hint]) =>
          h('button', { class: `community-link ${p === page ? 'active' : ''}`, onclick: () => App.go({ page: p }) }, icon(ic), h('span', { class: 'grow' }, h('b', null, label), h('small', null, hint))),
        ),
      ),
      h('div', { class: 'community-page' }, pages[page].render()),
    );
  },
};
