# Changelog

What changed in each version of Discord Server Builder, newest first. Every version from 1.0.6 on also has its own page on [GitHub Releases](https://github.com/Pixelplayz2215/discord-server-builder/releases).

To release: add your changes as `- ` lines under **Unreleased**, then run `npm run release`. The script turns them into the new version's section and its release page.

## Unreleased

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
