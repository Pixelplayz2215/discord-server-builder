# Discord Server Builder

A Windows desktop app (Electron) in the Pixelplayz2215 theme for running Discord bots from one place:

- **Multiple bots.** Each bot you connect gets its own page in the left rail. Pages keep their state when you switch between bots. Drag bots to reorder them.
- **Bot dashboard.** Shows online presence (status plus custom status), whether privileged intents are on, an invite-link generator and the bot's servers.
- **Server details.** Overview with stats, owner, boosts, features and the bot's permissions. Also has a roles list, rename and leave.
- **Members.** Searchable list with a role filter. Click a member to toggle roles, change their nickname, send a DM, time them out, kick or ban.
- **Moderation.** Ban list with unban, quick ban / kick / timeout / unban / warn by user ID, and prune of inactive members.
- **Warnings and case history.** Warn a member (they get the reason in a DM), and see everyone's history in their member panel. Warnings, timeouts, kicks, bans and unbans made in the app or with the slash commands are recorded as numbered cases in a private `#mod-cases` channel, so every mod sees the same history.
- **Raid tools.** Lock down every public channel at once (ending the lockdown only unlocks what it locked), pause invites and DMs with Discord's own raid switches, and list recent joins with new accounts flagged, then ban, kick or time them out in bulk.
- **AutoMod.** Add and edit Discord's built-in AutoMod rules: blocked words, common bad words, spam and mass mentions, with block, alert and timeout actions and exempt roles and channels. Discord enforces them itself, even when the app is closed.
- **Backups.** Save an exact copy of a server's roles, channels, permissions and settings to your PC, by hand or automatically every day. Restoring recreates what was deleted and puts permissions, layout and (optionally) settings back, without deleting anything. Preview the changes first, and export or import backups as files.
- **Server logs.** The bot posts joins (new accounts flagged), leaves, bans, timeouts, role and nickname changes, deleted and edited messages, and channel and role changes to a log channel while the app runs.
- **Social alerts** (megaphone in the left rail). Post in a channel of your choice when a YouTube channel uploads (or starts a stream) or a Twitch channel goes live, with an optional @everyone, @here or role ping and your own message. YouTube needs no login: paste any channel's link. Twitch uses **Log in with Twitch**. Checks run while the app is open or in the tray (YouTube every 5 minutes, Twitch every minute). X / Twitter isn't supported, because X charges for every API read since February 2026.
- **Keeps running in the tray.** The close button hides the app to the tray so bots stay online and logs and backups keep going. Quit from the tray icon. This can be turned off in Settings.
- **Channels.** Send a message as the bot, purge up to 1000 recent messages, lock or unlock, set slowmode, rename, delete, or create channels.
- **Audit log.** Recent actions, with filters.
- **Builder.** Start from a template (Content Creator, Gaming, Study, Dev Team, Blank) or clone an existing server. Edit roles (colour, permission preset, hoist, mentionable), categories and channels (type, topic, private-to-roles, read-only, welcome channel). You can optionally wipe existing channels and roles first, then build with a live progress log. Templates can be saved and exported or imported as JSON.

- **Settings** (gear icon at the bottom left). Includes 8 themes, some of them light. You can also edit the colours, upload your own logo (it also becomes the window and taskbar icon), rename the app, and set the UI scale, text size, corner roundness and font. Pixel-style labels and the animations and background glow can be switched off. The "by Pixelplayz2215" credit in the title bar can't be changed. Settings are saved in `settings.json` in the same folder as the bot tokens.

- **Updates.** Settings → **Check for updates** reads the latest GitHub release, and the app also checks on startup (this can be turned off). When a newer version is out, a "New version found" popup appears and **Reload to update** installs it in one click. The installed app runs the new installer silently in the same folder, keeping your shortcuts. The portable .exe swaps the new file in place under the same name. Both then restart.

- **Moderator sign-in.** Your mods can use the app without the bot token. They click **Sign in with Discord** and get the servers where they have Kick, Ban or Timeout permission, with moderation tools only. Each action is checked against their own Discord permissions. This needs the small mod portal server in `server/` running on a host. Setup steps are in [docs/MOD-PORTAL.md](docs/MOD-PORTAL.md).

- **Slash commands for mods (optional).** Mods who don't use the app can moderate right in Discord with `/warn`, `/timeout`, `/untimeout`, `/kick`, `/ban`, `/unban`, `/cases`, `/purge`, `/lock`, `/unlock` and `/slowmode`. The mod portal answers them, with the same permission checks as the app. Warnings and member actions are recorded as numbered cases in a private `#mod-cases` channel the bot creates, and `/cases` looks a member up. The owner turns them on from the Home page in one click.

## Your data stays on your PC

Bots, settings, saved templates, per-server settings, social alerts and backups are stored only in `%APPDATA%\Discord Server Builder` (`bots.json`, `settings.json`, `templates.json`, `servers.json`, `social.json` and the `backups` folder). The Twitch login is encrypted the same way as bot tokens. Bot tokens are encrypted with Windows DPAPI (Electron `safeStorage`). None of this is in the project folder, the GitHub repo or the built .exe, so every copy of the app starts empty. `.gitignore` also blocks those file names in case one gets copied into the project. The UI never sees a token, and every Discord call runs in the main process.

## Run it

**Just the app:** from the [release page](https://github.com/Pixelplayz2215/discord-server-builder/releases/latest) (always the newest build), download either:

- [DiscordServerBuilder-setup.exe](https://github.com/Pixelplayz2215/discord-server-builder/releases/latest/download/DiscordServerBuilder-setup.exe), the **installer** (Start menu and desktop shortcuts, plus an uninstaller), or
- [DiscordServerBuilder-portable.exe](https://github.com/Pixelplayz2215/discord-server-builder/releases/latest/download/DiscordServerBuilder-portable.exe), the **portable** version (no install needed).

> ⚠️ The only official download is the GitHub release page above. Copies from anywhere else could be changed to steal your bot token. Windows may show a SmartScreen warning the first time because the app isn't code-signed. Click **More info → Run anyway**.

**From VS Code:** open this folder (`File → Open Folder…`), then:

| What | How |
| --- | --- |
| Run the app | Run and Debug → **Run App** (F5). It installs dependencies first. |
| Debug main and UI | Run and Debug → **Debug Main + Renderer** |
| Build the portable .exe | `Ctrl+Shift+B` (task **Build portable EXE**) → `dist\` |
| Build an installer | Terminal → Run Task → **Build installer EXE** |

**From a terminal:**

```bash
npm install
npm start          # run the app
npm run dev        # run with DevTools open
npm run dist       # portable .exe in dist/
npm run release    # build + publish a new GitHub release (see below)
```

## Publishing an update

Every version gets **its own GitHub release** (tag `v1.0.7` and so on), whose page starts with that version's changes from [CHANGELOG.md](CHANGELOG.md). The newest one is marked latest, so the `releases/latest` links and download links always give the newest build. The app's update check reads the latest release from the repository named in `package.json` → `updateRepo`, which must be public. Its `version.json` tells the app which version the files are and what changed lately, which the "New version found" popup lists.

1. Add what changed as `- ` lines under **Unreleased** in `CHANGELOG.md`. Commit and push.
2. Run `npm run release`, or in VS Code: Terminal → Run Task → **Publish GitHub release**.

The script:
- stops if there are uncommitted or unpushed changes, or nothing under **Unreleased**
- bumps the patch version in `package.json` if the current one is already published, moves the **Unreleased** lines into that version's section, and commits and pushes both as "Release x.y.z"
- builds `DiscordServerBuilder-setup.exe` (installer) and `DiscordServerBuilder-portable.exe`, plus a private `mod-view.exe` when you have a `mod-view.json` (see below)
- tags the commit `vx.y.z` and creates its release with the installer, the portable exe and `version.json`. The notes are the version's changes followed by `RELEASE_NOTES.md`, the standing description.
- keeps copies in `releases\`

If a run stops partway (for example the build fails), run it again: it carries on with the same version.

Running copies of the app show the "New version found" popup the next time they check. **Reload to update** then updates them in place.

The installer's own pages (credit to Pixelplayz2215, the official-download warning, the finish and uninstall text) are in `build/installer.nsh`.

## Mod portal

`server/` is a small Node 20+ web server, with no dependencies, that keeps the bot token so moderators never need it. Each bot owner runs their own: fork this repo, then deploy your fork with `render.yaml` (Render → New → Blueprint), or run it on any host with `npm run portal`. The full setup is in [docs/MOD-PORTAL.md](docs/MOD-PORTAL.md).

**Private build for your mods (optional).** Create `mod-view.json` in the project folder:

```json
{ "portalUrl": "https://your-mod-portal.onrender.com" }
```

`npm run dist:mod` (and every `npm run release`) then also builds `mod-view.exe`. That's the same app with your portal address already filled in on the sign-in box. It only goes into your local `releases\` folder, never to GitHub, so share it with your mods yourself. `mod-view.json` is ignored by git, so your address stays out of the repo. The public download leaves the box empty.

`npm test` runs all the tests (portal permissions, slash commands, cases, backups, server logs and social alerts, against a fake Discord, YouTube and Twitch). `npm run test:portal` runs only the portal's.

## Twitch Client ID

"Log in with Twitch" needs a Twitch app's Client ID. Without one built in, each owner pastes their own on the Social page (the page walks them through it). To build one into the app instead:

1. Open the [Twitch developer console](https://dev.twitch.tv/console/apps) (Twitch requires two-factor authentication).
2. **Register Your Application**: any name, OAuth Redirect URL `http://localhost`, category **Application Integration**, Client Type **Public**.
3. Copy the Client ID into `"twitchClientId"` in `package.json` and run `npm run release`. A public client has no secret, so the ID is safe to ship.

## Bot setup

1. In the [Developer Portal](https://discord.com/developers/applications), create an application and open **Bot**.
2. Press **Reset Token** and copy the token. Paste it into the app's Home page.
3. Turn on **Server Members Intent** on the same Bot page. The Members tab needs it.
4. On the bot's page in the app, press **Invite to a server**. Administrator is recommended so the builder can create roles and channels.

Notes:

- Announcement and Stage channels need a **Community** server. When the server isn't one, the builder creates them as text and voice channels instead, and the log says so.
- A bot can only manage roles and members below its own highest role.
- Bulk delete skips pinned messages and messages older than 14 days, because Discord does not allow deleting those in bulk.

## Project layout

```
src/main/       Electron main process
  main.js         window, tray + IPC handlers
  discord.js      REST client with rate-limit handling
  gateway.js      gateway connection (keeps bots "online", receives events for server logs)
  logs.js         server logs: gateway events → batched embeds in a log channel
  social.js       social alerts: YouTube feeds, Log in with Twitch, the watcher
  backup.js       server snapshots and restore
  cases.js        #mod-cases case log, warnings (shared with server/)
  builder.js      template → server builder, clone, purge, lock, member paging
  updater.js      GitHub release check, download, restart into the new .exe
  portal.js       "Sign in with Discord" client for moderators (talks to server/)
  commands.js     mod slash command definitions + registering them on a bot (shared with server/)
  store.js        encrypted token/session, settings and saved-template storage
  preload.js      narrow IPC bridge
src/shared/
  appearance.js   theme presets + settings defaults/validation (used by main and UI)
src/renderer/   UI (plain HTML/CSS/JS, no bundler)
  js/theme.js     applies appearance settings as CSS variables (loaded in <head>)
  js/settings.js  Settings page
  js/updates.js   update check + "New version found" popup
  js/core.js      element helper, icons, modals, toasts
  js/home.js      Home page / connect a bot
  js/bot.js       per-bot page + dashboard
  js/server.js    server header and Overview/Members/Moderation/Channels/Logs tabs, cases
  js/raid.js      Raid tab (lockdown, pause invites/DMs, recent joins)
  js/automod.js   AutoMod tab
  js/backups.js   Backups tab
  js/serverlogs.js server logs settings (Logs tab)
  js/social.js    Social alerts page
  js/builder.js   Builder tab
  js/templates.js built-in server templates
scripts/        make-icon.js (draws the logo → build/icon.png/.ico), copy-fonts.js, release.js + changelog.js
CHANGELOG.md    what changed in each version (feeds the release pages and the update popup)
server/         mod portal (not part of the .exe)
  index.js        HTTP server: sign-in, moderation-only API, /interactions
  auth.js         Discord OAuth sign-in + signed sessions
  guard.js        per-request permission and role-hierarchy checks
  interactions.js signed slash command endpoint and the command handlers
  portal.test.js  tests with a fake Discord
  interactions.test.js  slash command tests with a fake Discord
test/features.test.js  cases, backups and server logs tests (not packaged)
test/social.test.js    social alerts tests (not packaged)
docs/MOD-PORTAL.md  how to deploy the portal and give mods access
render.yaml     Render blueprint for the portal
```

The theme colours come from pixelplayz.org: navy `#0f0c22`, teal `#0bbfbc`, coral `#fc354c` and magenta `#a41d70`, set in Poppins and Silkscreen.
