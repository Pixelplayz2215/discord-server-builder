# Discord Server Builder

A Windows desktop app (Electron) in the Pixelplayz2215 theme for running Discord bots from one place:

- **Multiple bots.** Each bot you connect gets its own page in the left rail. Pages keep their state when you switch between bots. Drag bots to reorder them.
- **Bot dashboard.** Shows online presence (status plus custom status), whether privileged intents are on, an invite-link generator and the bot's servers.
- **Server details.** Overview with stats, owner, boosts, features and the bot's permissions. Also has a roles list, rename and leave.
- **Members.** Searchable list with a role filter. Click a member to toggle roles, change their nickname, send a DM, time them out, kick or ban.
- **Moderation.** Ban list with unban, quick ban / kick / timeout / unban by user ID, and prune of inactive members.
- **Channels.** Send a message as the bot, purge up to 1000 recent messages, lock or unlock, set slowmode, rename, delete, or create channels.
- **Audit log.** Recent actions, with filters.
- **Builder.** Start from a template (Content Creator, Gaming, Study, Dev Team, Blank) or clone an existing server. Edit roles (colour, permission preset, hoist, mentionable), categories and channels (type, topic, private-to-roles, read-only, welcome channel). You can optionally wipe existing channels and roles first, then build with a live progress log. Templates can be saved and exported or imported as JSON.

- **Settings** (gear icon at the bottom left). Includes 8 themes, some of them light. You can also edit the colours, upload your own logo (it also becomes the window and taskbar icon), rename the app, and set the UI scale, text size, corner roundness and font. Pixel-style labels and the animations and background glow can be switched off. The "by Pixelplayz2215" credit in the title bar can't be changed. Settings are saved in `settings.json` in the same folder as the bot tokens.

- **Updates.** Settings → **Check for updates** reads the latest GitHub release, and the app also checks on startup (this can be turned off). When a newer version is out, a "New version found" popup appears. In the portable .exe, **Reload to update** downloads the new .exe next to the current one and restarts into it.

- **Moderator sign-in.** Your mods can use the app without the bot token. They click **Sign in with Discord** and get the servers where they have Kick, Ban or Timeout permission, with moderation tools only. Each action is checked against their own Discord permissions. This needs the small mod portal server in `server/` running on a host. Setup steps are in [docs/MOD-PORTAL.md](docs/MOD-PORTAL.md).

## Your data stays on your PC

Bots, settings and saved templates are stored only in `%APPDATA%\Discord Server Builder` (`bots.json`, `settings.json`, `templates.json`). Bot tokens are encrypted with Windows DPAPI (Electron `safeStorage`). None of this is in the project folder, the GitHub repo or the built .exe, so every copy of the app starts empty. `.gitignore` also blocks those file names in case one gets copied into the project. The UI never sees a token, and every Discord call runs in the main process.

## Run it

**Just the app:** download `DiscordServerBuilder-<version>-portable.exe` from the [latest release](https://github.com/Pixelplayz2215/discord-server-builder/releases/latest) and run it. No install is needed. Windows may show a SmartScreen warning the first time because the app isn't code-signed. Click **More info → Run anyway**.

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
npm run release    # build + publish a GitHub release (see below)
```

## Publishing an update

The app's update check reads the latest release of the repository named in `package.json` → `updateRepo`. That repository's releases must be **public**, because GitHub doesn't show a private repository's releases to apps that aren't signed in.

1. Bump `version` in `package.json` (for example `1.0.0` → `1.1.0`).
2. Optionally, write release notes in `release-notes/v<version>.md`. Without that file, GitHub generates notes from the commits.
3. Commit and push.
4. Run `npm run release`, or in VS Code: Terminal → Run Task → **Publish GitHub release**. This builds `DiscordServerBuilder-<version>-portable.exe`, plus `mod-view-<version>.exe` when `modViewPortalUrl` is set. It creates the release `v<version>` with both attached and keeps copies in `releases\`. It stops if there are uncommitted or unpushed changes, or if the release already exists.

Running copies of the app will show the "New version found" popup the next time they check.

## Mod portal

`server/` is a small Node 20+ web server, with no dependencies, that keeps the bot token so moderators never need it. Deploy it with `render.yaml` (Render → New → Blueprint), or on any host with `npm run portal`. The full setup is in [docs/MOD-PORTAL.md](docs/MOD-PORTAL.md).

After it's deployed, put its address in `package.json` → `modViewPortalUrl`. `npm run dist:mod` (and every `npm run release`) then also builds `mod-view-<version>.exe`. That's the same app with your portal address already filled in on the sign-in box, ready to hand to your moderators. The regular build leaves the box empty, so people who download the app aren't sent to your portal. `npm run test:portal` runs the portal's permission tests.

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
  main.js         window + IPC handlers
  discord.js      REST client with rate-limit handling
  gateway.js      presence-only gateway connection (keeps bots "online")
  builder.js      template → server builder, clone, purge, lock, member paging
  updater.js      GitHub release check, download, restart into the new .exe
  portal.js       "Sign in with Discord" client for moderators (talks to server/)
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
  js/server.js    server header and Overview/Members/Moderation/Channels/Audit tabs
  js/builder.js   Builder tab
  js/templates.js built-in server templates
scripts/        make-icon.js (draws the logo → build/icon.png/.ico), copy-fonts.js, release.js
server/         mod portal (not part of the .exe)
  index.js        HTTP server: sign-in, moderation-only API
  auth.js         Discord OAuth sign-in + signed sessions
  guard.js        per-request permission and role-hierarchy checks
  portal.test.js  tests with a fake Discord
docs/MOD-PORTAL.md  how to deploy the portal and give mods access
render.yaml     Render blueprint for the portal
```

The theme colours come from pixelplayz.org: navy `#0f0c22`, teal `#0bbfbc`, coral `#fc354c` and magenta `#a41d70`, set in Poppins and Silkscreen.
