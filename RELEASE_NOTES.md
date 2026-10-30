**Discord Server Builder** is a desktop app for running your Discord bots from one place. Build whole server layouts, moderate members and channels, and let your mods sign in with Discord.

## Download

Pick one, both are the same app by **Pixelplayz2215**:

| File | What it is |
| --- | --- |
| **DiscordServerBuilder-setup.exe** | **Installer.** Adds Start menu and desktop shortcuts and an uninstaller. Recommended. |
| **DiscordServerBuilder-portable.exe** | **Portable.** No install; run it from any folder or a USB stick. |

Bot owners paste their bot token. Moderators click **Sign in with Discord** and paste the portal address their server owner gave them. This release always has the newest build, and both versions tell you when there's an update and install it in one click.

> ⚠️ **The only official download is this GitHub page:** https://github.com/Pixelplayz2215/discord-server-builder/releases/latest
> Copies from anywhere else could be changed to steal your bot token. Never share your token with anyone, including people claiming to be Pixelplayz2215.

Windows may show a SmartScreen warning the first time because the app isn't code-signed. Click **More info → Run anyway**.

## What's new

- **Social alerts.** A new Social page (megaphone in the left rail) posts in the channel you pick when a YouTube channel uploads or a Twitch channel goes live, with an optional ping and your own message. Paste any YouTube channel's link (no login needed), and use **Log in with Twitch** for Twitch.
- **Stays running in the tray.** The close button now hides the app to the tray, so your bots stay online. Quit from the tray icon, or turn this off in Settings.
- **Warnings and case history.** Warn members from the app, and see each member's warnings, timeouts, kicks and bans in their panel. Actions from the app and the slash commands go into the same private `#mod-cases` log.
- **Raid tools.** One-click lockdown of every public channel, pause invites and DMs, and a list of recent joins (new accounts flagged) to ban, kick or time out in bulk.
- **AutoMod manager.** Set up Discord's built-in AutoMod (blocked words, bad words, spam, mass mentions) without leaving the app. Discord enforces it even when the app is closed.
- **Server backups.** Back up roles, channels, permissions and settings by hand or every day, preview what a restore would change, and restore. Nothing is ever deleted by a restore.
- **Server logs.** Joins, leaves, bans, timeouts, role changes, deleted and edited messages and channel changes are posted to a log channel while the app runs.
- **Slash commands for mods.** Mods can moderate right in Discord with `/warn`, `/timeout`, `/kick`, `/ban`, `/unban`, `/cases`, `/purge`, `/lock` and `/slowmode`, checked against their own permissions like in the app. Warnings and actions are recorded as numbered cases in a private `#mod-cases` channel. Turn them on from the Home page (needs an up-to-date mod portal).
- **Fixed: the installed app could go back to the old version after updating.** On PCs with two copies installed, an update could land in one copy while your shortcut opened the other. Updates now install into the copy you're running, reopen that copy, and fix Start menu and desktop shortcuts that point somewhere else.
- **Installer version.** You can now install the app properly (Start menu, desktop shortcut, uninstaller) or keep using the portable exe. Both update themselves.

- **Channel permissions.** In the Channels tab, the new **Permissions** button shows every role and member override on a channel, the way Discord does. You can change them, add roles or members, and sync the channel with its category. Mods get a view-only version.
- **Mod access guide on the Home page.** It walks owners through setting up a mod portal. It works out the exact sign-in redirect for you and checks that your portal is running.

## Everything in the app

- **Multiple bots.** Each bot gets its own page with its servers, an online status and an invite link.
- **Server details.** Stats, owner, boosts, roles and the bot's permissions.
- **Members and moderation.** Search members, then time out, kick, ban or unban them. You can also change nicknames and roles, prune inactive members, and view the audit log.
- **Channels.** Send messages as the bot, purge, lock, set slowmode, edit permissions, rename, create and delete.
- **Builder.** Build a server's roles, categories, channels and permissions from templates, or clone an existing server. Templates can be saved, imported and exported.
- **Settings.** 8 themes (including light ones), custom colours, your own logo and app name, UI scale, text size, corner roundness and fonts.
- **Mod sign-in.** Moderators sign in with Discord instead of using the bot token, and only get the moderation tools their Discord permissions allow. See [docs/MOD-PORTAL.md](https://github.com/Pixelplayz2215/discord-server-builder/blob/main/docs/MOD-PORTAL.md) to set up a portal for your own bot.

Your bots, tokens and settings are stored only on your PC (`%APPDATA%\Discord Server Builder`). Tokens are encrypted with Windows DPAPI.
