# Changelog

What changed in each version of Discord Server Builder, newest first. Every version from 1.0.6 on also has its own page on [GitHub Releases](https://github.com/Pixelplayz2215/discord-server-builder/releases).

To release: add your changes as `- ` lines under **Unreleased**, then run `npm run release`. The script turns them into the new version's section and its release page.

## Unreleased

- **Previews show Discord's formatting.** The previews on Announcements, Giveaways, Reaction roles, Polls, Tickets, the Verify button and Welcome & goodbye now show text the way Discord does: `#`, `##` and `###` headings, `-#` small text, `>` quotes, lists, code blocks, *italics*, __underline__, ~~strikethrough~~, spoilers, links, role and channel mentions, server emojis and timestamps. Before, only **bold** and `code` showed, so a `# Rules` heading looked like plain text.
- **Lock behind Verify.** On the Auto roles page, one button sets up a Verify button's permissions instead of changing every channel by hand. @everyone stops seeing your channels except the Verify channel (and any you keep open, like #rules), and the role the button gives sees everything @everyone could see before. Channels that let @everyone in by name let that role in instead, private channels stay private, and the Verify channel can disappear once members verify. Bots whose roles relied on @everyone get View Channels on their own role, so they keep working. You can give the role to everyone already in the server first, so nobody's locked out. It shows exactly what will change before doing anything, makes a backup first, and **Unlock** puts it back.

## 1.2.10 (2026-11-04)

- **Several bots on one portal.** Your mod portal can now run more than one of your bots, each with its own slash commands, buttons and 24/7, on the same free Render service. On Render, add each extra bot's token as `DISCORD_BOT_TOKEN_2`, `DISCORD_BOT_TOKEN_3` and so on, then turn on that bot's slash commands and 24/7 on the Home page with the same portal address. With one bot, nothing changes. Mods still sign in through the first bot. Update your portal with **Sync fork** first.

## 1.2.9 (2026-11-03)

- **Pixel's Sysbot stand-in.** Optional: with `SYSBOT_BOT_TOKEN` set, the portal posts a Pixel's Sysbot trade bot's offline status report when its PC stops checking in (a power cut, no internet) and answers its basic commands until it's back. See the mod portal guide, step 10.
- **Fixed: deleted messages showed as "sent before the bot started watching".** Server logs now remember bots' and webhooks' posts too, so deleting one logs who posted it and its text (or its card's title), marked as a bot. They also remember the last 50 messages in each channel when the bot connects, so a message posted before the app or your portal restarted is still known when it's deleted. Bots' own edits still aren't logged, since bots edit their posts all the time.

## 1.2.8 (2026-11-03)

- **/announce, /giveaway and /reactionroles.** Staff can post announcements, giveaways and reaction roles right from Discord, in the same formats as the app, kept simple (no link buttons or author pictures). `/announce` posts a card with a title, text, a ping and two fields (side by side or not). `/giveaway` takes the prize, how long members can enter (like `2h` or `1d 12h`), how many win, text, the entry emoji (server emojis too), a role needed to win, a ping and two fields, and says who ran it. `/reactionroles` takes a message and up to 8 emoji and role pairs, each with its own text. Giveaways and reaction roles made this way need **Run 24/7** for the server: your portal draws the winners and hands out the roles around the clock, and they show up on the Giveaways and Reaction roles pages. `/poll` already works this way. Update your portal with **Sync fork**, then press **Turn on** under **Add slash commands** on the Home page again to add the new commands.

## 1.2.7 (2026-11-02)

- **More on giveaway cards.** A giveaway can say who runs it: **Ran by** shows at the top of the card, with a small round picture if you give a link. Like announcements, the card can also have fields (each side by side or full width), a small picture at the top right and a footer. All of them stay on the card after the winners are picked.
- **Fixed:** a giveaway with no text started its card with an empty line.

## 1.2.6 (2026-11-02)

- **Giveaways.** A new Giveaways page (on the Community page) posts a prize with a live preview: your text, a picture, a colour and an optional ping. Pick how many win, the date and time members can **enter by**, and if you like a role members need to win. Post it now or schedule it. Members enter by reacting with 🎉, or any emoji you pick (your server's own included), and at the enter-by time the bot picks the winners at random from them, pings them in a reply and lists them on the post. Bots, members who have left and members without the role can't win. The page shows how many have entered so far, **End now** picks the winners early, and **Pick again** replaces a winner (say, one who never claimed the prize) with someone who hasn't won it yet. Giveaways run while the app is open or in the tray, or around the clock with **Run 24/7** once your portal is updated with **Sync fork** (until then, the app runs them).

## 1.2.5 (2026-11-01)

- **"While the app was closed" is easy to find.** What your mod portal did while the app was closed now shows in a card at the top of the Home page, under Your bots, instead of in small print at the bottom of the **Run 24/7** card. It says how long the app was closed, whether the portal kept your bot online the whole time, and what it did in each server. A quiet night says exactly what wasn't needed instead of "nothing happened". Press **Got it** to put it away.
- **The time away is right after a shutdown.** When Windows shuts down or restarts with the app still open, the card now counts from then, not from the last time something happened.

## 1.2.4 (2026-10-31)

- **Copy user ID on bans and kicks.** Each row in Safety → Moderation's Bans and Kicks lists has a **Copy user ID** button, handy for looking someone up or banning them in another server.

## 1.2.3 (2026-10-31)

- **Select several at once.** Channels, roles and members each have a **Select** button. Pick channels and categories to lock, unlock, set slowmode on, move to another category, clone (with their settings and permissions; a category is copied with the channels picked in it) or delete. Pick roles to clone or delete. Pick members, or all that match a search, to give or take a role, time out, kick or ban. Deleting 5 or more asks you to type "delete" first.
- **Delete is at the top.** A channel's **Delete** button now sits next to its name, so you don't have to scroll down for it.

## 1.2.2 (2026-10-31)

- **New versions show up sooner.** The background check now looks every 2 minutes, at GitHub's release page instead of its API (whose answers could be a minute old, and which limits how often it's asked), so the "new version" popup appears within about 2 minutes of a release.
- **Pages stop flickering.** Social alerts, Announcements, Polls and Server stats no longer redraw every minute when nothing changed, and when something does change, the page updates in place instead of fading in again as if it had reloaded.

## 1.2.1 (2026-10-31)

- **What 24/7 did while you were away.** When you open the app, the Home page's **Run 24/7** card shows what your mod portal did for each server while the app was closed: welcomes, goodbyes, members given auto roles, reaction roles, votes, announcements, YouTube posts and log entries. Update your portal with **Sync fork** to start counting.
- **Scheduled announcements on time.** They now go out within a few seconds of their time, instead of up to 30 seconds late, from the app and from your portal.
- **Bots and Users counters keep up.** When a bot joins or leaves, the Bots and Users counters change at the next update instead of up to half an hour later, and a new bot is no longer counted as a user in the meantime. Counters also update about a minute after anyone joins or leaves, though Discord still lets each counter channel be renamed only about once every 5 minutes.

## 1.2.0 (2026-10-31)

- **Safer connection library.** The library the bot uses to stay connected to Discord (ws) is updated to fix two security advisories.
- **Run 24/7.** Your mod portal can now run welcome & goodbye cards, auto roles, reaction roles, polls, server logs, server stats, scheduled announcements and YouTube alerts around the clock, so they keep going when your PC is off. Turn it on from the Home page (**Run 24/7**, under slash commands) in one click; there's nothing new to set up on Render beyond **Sync fork**. Each server gets a private #bot-settings channel where the app keeps the settings for the portal, encrypted with your bot token. While 24/7 is on, the portal keeps itself awake on Render's free plan (one service fits in the free hours), and the app shows what it did: votes, posts sent and any problems. Twitch alerts and automatic backups still run in the app.
- **Auto roles.** A new Auto roles page (on the Community page) gives roles to everyone who joins, right away or after a wait you pick (1 minute to 1 hour), with separate roles for bots if you like. If your server uses Discord's rules screening, the roles wait until the member accepts the rules. **Give to existing members** hands the roles to everyone who joined before. Needs the Server Members Intent; works while the app is open or in the tray.
- **Verify button.** Post a message with a Verify button (your title, text, colour, label, emoji and button colour) in any channel. Members who press it get the roles you picked, up to 4, and only they see the reply. With slash commands on, your mod portal answers it around the clock (update it first with **Sync fork**); otherwise the app does while it runs.
- **Announcements.** A new Announcements page builds a message with a live preview: text with an optional @everyone, @here or role ping, a card with a title, link, author, picture (from your PC or a link), thumbnail, fields, footer and colour, and up to 5 link buttons. Send it now, or schedule it for a date and time, once or every day, week or month. Edit a sent announcement and update it in Discord in place. Scheduled posts go out while the app is open or in the tray; one missed by less than an hour still goes out when the app starts, and an older one is marked missed so you can send it yourself.

## 1.1.1 (2026-10-30)

- **Kicks show up.** Safety → Moderation now has **Bans** and **Kicks**: kicks come from Discord's audit log (kept for 45 days) with who kicked them (the real moderator, also for `/kick` and the mod portal), the reason, when, and a button to ban them if they come back.
- **Kicks in server logs.** A kick is now logged as **Member kicked** with who did it and why, instead of "Member left". **Member banned** shows who banned and why too, and a ban is no longer also logged as a leave.

## 1.1.0 (2026-10-30)

- **Server stats.** A new Server stats page (on the Community page) shows live counts as channels at the top of your server: members, users, bots, channels and roles. Name each counter however you like (put {count} where the number goes), show numbers in full or short (1.2K), and turn counters on or off. They're voice channels members can see but not join, and the bot updates them about every 5 minutes while the app is open or in the tray, which is as often as Discord lets a bot rename a channel. Users and Bots need the Server Members Intent.
- **New versions are noticed right away.** The app now checks GitHub every few minutes while it runs, in the tray too, instead of only when it starts. A small popup says when a new version is out, and clicking it opens the usual update screen. In the tray, a Windows notification and an **Update to…** item in the tray menu do the same.

## 1.0.10 (2026-10-30)

- **Tickets.** A new Tickets page posts a panel with your own text and an "open a ticket" button. Pressing it gives the member a private channel that only they, your support roles and admins can see, with your own message asking what they need. Staff press **Claim** to take the ticket, and **Close** asks for a reason, saves the whole conversation (images included) as a transcript in a private ticket log channel with a **View transcript** link, and deletes the channel. Open tickets and every transcript are listed in the app too. With slash commands on, your mod portal answers the buttons around the clock (update it first with **Sync fork**); otherwise the app does while it runs.
- **A tidier app.** Welcome & goodbye, Reaction roles, Tickets, Polls and Social alerts now share one **Community** button in the left rail, with a menu inside. A server's tabs are grouped so they fit without scrolling: **Safety** holds Moderation, Raid tools and AutoMod, and **Build** holds Builder and Backups.
- **YouTube alerts say what's wrong.** When YouTube's free feeds are down, the Social alerts page now says so at the top of your alerts, with a button to set up the API key, and the error badge is short enough to read.
- **Welcome & goodbye cards.** A new Welcome & goodbye page posts your message with a card when someone joins or leaves, like MEE6 but free and fully yours to design. The card shows their avatar and name over a gradient, a colour or your own background image (with a darken slider). Pick the layout, the font (including a pixel font), the avatar ring and the shadow, and write up to three lines of text, each with its own colour and size. Quick styles give you a head start. {user}, {server}, {count} and more fill in, the welcome can ping the new member, and **Send a test** posts one with your bot as the member. Needs the Server Members Intent turned on for your bot.
- **YouTube API key.** YouTube's free channel feeds have been down for every channel at times, which broke YouTube alerts and the Test button. You can now add a free YouTube Data API key under **Social alerts → Accounts** (the steps are in the app). With a key, checks, **Test** and **Check** go through YouTube's API instead of the feed, and **Include Shorts** still works. The key is checked before it's saved and kept encrypted on your PC. Without a key, the app keeps using the feed.

## 1.0.9 (2026-10-30)

- **Locks are announced.** `/lock`, `/unlock` and the Lock button on the Channels tab now post a card in the channel saying it's locked (or open again) and why, so everyone knows. Raid lockdowns stay quiet.
- **Locks in the logs.** Server logs post when a channel is locked or unlocked, with the moderator, the command and the reason. In the Audit log tab, a lock now reads "Pixel locked #channel" instead of "changed permissions", and actions from slash commands and the mod portal show the moderator who did them, the command as a badge, and the reason on its own line.

## 1.0.8 (2026-10-30)

- **Polls.** A new Polls page (bars in the left rail) posts a question with 2 to 4 answers, each with a server emoji or a standard one. Members vote by reacting, and the bot draws a coloured bar under each answer like Discord's own polls: the bar matches its emoji's colour, or pick your own, and the card colour is yours too. Let members pick one answer or several, and end a poll to show the final results with the winner marked.
- **/poll.** Anyone who can post polls in a channel can run `/poll message emoji1 option1 emoji2 option2` (up to 4 options) in Discord. The emoji boxes suggest the server's own emojis and standard ones as you type. Polls posted this way show up on the Polls page, and their bars fill in while the app is open or in the tray. Press **Turn on** under **Add slash commands** on the Home page again to add it (update your portal first with **Sync fork**).
- **Fixed: YouTube alerts failing with "HTTP 500" or "didn't return this channel's videos".** YouTube's channel feeds often fail for a moment, even for channels that exist. The app now tries again before giving up, **Check** works while the feed is down, and an alert only shows a problem after it has failed for 15 minutes. Videos posted during a failure are still announced when the feed comes back.
- **Fixed:** the "log in with Twitch" warning showed when adding or editing a YouTube alert.

## 1.0.7 (2026-10-30)

- **Reaction roles.** A new Reaction roles page (smiley in the left rail) posts a message members react to, to give themselves roles. Pick any of the server's own emojis or a standard one for each role, write your own message as a card or plain text, and put up to 20 reaction roles on one message. Choose whether members can pick any number of roles, only one, or add-only (for rules or verification). The bot hands roles out while the app is open or in the tray, and catches up on reactions it missed when it starts.

## 1.0.6 (2026-10-30)

- **Social alerts.** A new Social page (megaphone in the left rail) posts in the channel you pick when a YouTube channel uploads or a Twitch channel goes live, with an optional ping and your own message. Paste any YouTube channel's link (no login needed), and use **Log in with Twitch** for Twitch.

## 1.0.5 (2026-10-28)

- **Stays running in the tray.** The close button now hides the app to the tray, so your bots stay online. Quit from the tray icon, or turn this off in Settings.
- **Warnings and case history.** Warn members from the app, and see each member's warnings, timeouts, kicks and bans in their panel. Actions from the app and the slash commands go into the same private `#mod-cases` log.
- **Raid tools.** One-click lockdown of every public channel, pause invites and DMs, and a list of recent joins (new accounts flagged) to ban, kick or time out in bulk.
- **AutoMod manager.** Set up Discord's built-in AutoMod (blocked words, bad words, spam, mass mentions) without leaving the app. Discord enforces it even when the app is closed.
- **Server backups.** Back up roles, channels, permissions and settings by hand or every day, preview what a restore would change, and restore. Nothing is ever deleted by a restore.
- **Server logs.** Joins, leaves, bans, timeouts, role changes, deleted and edited messages and channel changes are posted to a log channel while the app runs.

## 1.0.4 (2026-10-28)

- **Slash commands for mods.** Mods can moderate right in Discord with `/warn`, `/timeout`, `/kick`, `/ban`, `/unban`, `/cases`, `/purge`, `/lock` and `/slowmode`, checked against their own permissions like in the app. Warnings and actions are recorded as numbered cases in a private `#mod-cases` channel. Turn them on from the Home page (needs an up-to-date mod portal).

## 1.0.3 (2026-10-28)

- **Fixed: the installed app could go back to the old version after updating.** On PCs with two copies installed, an update could land in one copy while your shortcut opened the other. Updates now install into the copy you're running, reopen that copy, and fix Start menu and desktop shortcuts that point somewhere else.

## 1.0.2 (2026-10-28)

- **Installer version.** You can now install the app properly (Start menu, desktop shortcut, uninstaller) or keep using the portable exe. Both update themselves.

## 1.0.1 (2026-10-28)

- **Channel permissions.** In the Channels tab, the new **Permissions** button shows every role and member override on a channel, the way Discord does. You can change them, add roles or members, and sync the channel with its category. Mods get a view-only version.
- **Mod access guide on the Home page.** It walks owners through setting up a mod portal. It works out the exact sign-in redirect for you and checks that your portal is running.

## 1.0.0 (2026-10-28)

- **First public release.** Multiple bots with their own pages, server details, members and moderation, channel tools, the server Builder with templates and cloning, Settings with 8 themes and custom colours, logo and name, the update checker, and mod sign-in through a mod portal.
