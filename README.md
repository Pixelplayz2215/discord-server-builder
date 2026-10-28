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

Bot tokens are encrypted with Windows DPAPI (Electron `safeStorage`) and stored in `%APPDATA%\Discord Server Builder`. The UI never sees a token. Every Discord call runs in the main process.

## Run it

**Just the app:** run `dist\DiscordServerBuilder-<version>-portable.exe`. No install is needed.

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
```

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
  store.js        encrypted token + saved-template storage
  preload.js      narrow IPC bridge
src/renderer/   UI (plain HTML/CSS/JS, no bundler)
  js/core.js      element helper, icons, modals, toasts
  js/home.js      Home page / connect a bot
  js/bot.js       per-bot page + dashboard
  js/server.js    server header and Overview/Members/Moderation/Channels/Audit tabs
  js/builder.js   Builder tab
  js/templates.js built-in server templates
scripts/        make-icon.js (draws the logo → build/icon.png/.ico), copy-fonts.js
```

The theme colours come from pixelplayz.org: navy `#0f0c22`, teal `#0bbfbc`, coral `#fc354c` and magenta `#a41d70`, set in Poppins and Silkscreen.
