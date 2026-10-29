# Mod portal: let your mods sign in with Discord

The mod portal is a small web server that keeps your bot token. Moderators open Discord Server Builder, click **Sign in with Discord** and approve on Discord's page. They never see or need the bot token.

## What mods can do

The portal checks every request against the mod's **own Discord permissions** in that server. It looks them up through your bot each time.

| Who | What they get |
| --- | --- |
| Anyone with **Kick**, **Ban** or **Timeout Members** in a server the bot is in | Access to that server in the app |
| Kick Members | Kick |
| Ban Members | Ban, unban, ban list |
| Timeout Members | Timeout / end timeout |
| Manage Messages | Purge messages |
| Manage Channels | Lock / unlock, slowmode |
| Manage Nicknames | Change nicknames |
| Manage Roles | Add / remove roles below their own highest role |
| View Audit Log | Audit log tab |
| Any of the above | Warn members and see their case history; the Raid tab's recent joins list |

Bulk actions in the Raid tab need the same permission as one at a time (ban, kick or timeout), and the lockdown needs Manage Channels. Bans, kicks, timeouts and warnings mods make in the app are recorded in `#mod-cases` with their name, like the slash commands' ones. AutoMod, Backups and server logs are owner-only.

These rules always apply:

- Mods can only act on members **ranked below them**, the same rule Discord uses. They can never act on the server owner, the bot, or themselves.
- **Owner-only** (refused for mods): the Builder, wiping channels or roles, creating or deleting channels and roles, renaming the server, sending messages or DMs as the bot, pruning, and making the bot leave.
- Every action shows in the server's audit log as `<reason> — by <mod> (<id>) via mod portal`.
- To remove someone's access, take away their mod permissions in Discord. They lose access within 30 seconds.

The optional [slash commands](#6-add-slash-commands-optional) follow the same rules.

## Set it up (about 10 minutes)

Each bot owner runs **their own** portal, because it holds their bot's token. You don't need permission from anyone, and you never share your token. You'll need a free [GitHub](https://github.com) account and a free [Render](https://render.com) account.

### 1. Get your app's OAuth details

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and pick **your bot's application**.
2. Go to **OAuth2** and copy the **Client ID**.
3. Press **Reset Secret** and copy the **Client Secret**. Keep it private, like the bot token.

### 2. Get your own copy of the code

Render deploys from a GitHub repository you can access, so make a copy (a "fork") of this one in your own account:

1. Sign in to GitHub and open [Pixelplayz2215/discord-server-builder](https://github.com/Pixelplayz2215/discord-server-builder).
2. Click **Fork** (top right), then **Create fork**. You now have `<your-name>/discord-server-builder`.

When the portal gets fixes later, open your fork on GitHub and click **Sync fork**. Render redeploys your portal on its own.

*If you own this repository, skip this step and use it directly.*

### 3. Deploy the portal on Render

1. Sign up at Render with **GitHub**. When GitHub asks which repositories Render may access, pick your `discord-server-builder` fork.
2. In Render, go to **New → Blueprint** and pick that repository. Render reads `render.yaml` from it.
3. Fill in the three values it asks for:
   - `DISCORD_BOT_TOKEN`: your bot token.
   - `DISCORD_CLIENT_ID`: from step 1.
   - `DISCORD_CLIENT_SECRET`: from step 1.

   `SESSION_SECRET` is generated for you.
4. Press **Deploy Blueprint** (or **Apply**) and wait for the deploy to finish. Copy the service URL, for example `https://discord-mod-portal-abcd.onrender.com`.
5. Open that URL in a browser. You should see **"Mod portal is running"**.

<details>
<summary>No GitHub account? Deploy straight from this public repo instead</summary>

In Render, go to **New → Web Service → Public Git Repository**, paste `https://github.com/Pixelplayz2215/discord-server-builder` and use these settings:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Build command | `npm ci --omit=dev` |
| Start command | `node server/index.js` |
| Health check path | `/health` |
| Instance type | Free |

Then add these environment variables:

- `NODE_VERSION`: `22`
- `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`: from step 1.
- `SESSION_SECRET`: a random password, at least 32 characters long. Use a password generator.

Render won't redeploy this kind of service on its own. To pick up portal fixes later, press **Manual Deploy → Deploy latest commit**.

</details>

### 4. Allow the sign-in redirect

In the Developer Portal, go to **OAuth2 → Redirects** and add the URL below (your Render URL plus `/auth/callback`), then press **Save Changes**:

```
https://discord-mod-portal-abcd.onrender.com/auth/callback
```

### 5. Give your mods the app

Mods download the regular app from the [latest release](https://github.com/Pixelplayz2215/discord-server-builder/releases/latest). They choose **Sign in with Discord** on the Home page and paste **your** portal URL, then see every server your bot is in where they are a mod.

To save them the pasting, you can build a private `mod-view` exe with your address already filled in. In your fork, create `mod-view.json` containing `{ "portalUrl": "https://your-mod-portal.onrender.com" }`. Then run `npm install` and `npm run dist:mod` on a Windows PC with Node.js installed. You'll find it at `dist/mod-view.exe`. `mod-view.json` is ignored by git, so your address stays private. Share the exe with your mods directly.

### 6. Add slash commands (optional)

Mods who don't use the app can moderate right in Discord. Your portal answers these commands:

| Command | Needs | What it does |
| --- | --- | --- |
| `/warn member reason` | Any mod permission | DMs the member the reason and records a warning |
| `/timeout member duration [reason]` | Timeout Members | Times them out, from 60 seconds to 1 week |
| `/untimeout member [reason]` | Timeout Members | Ends a timeout |
| `/kick member [reason]` | Kick Members | DMs them, then kicks |
| `/ban member [reason] [delete_messages]` | Ban Members | DMs them, then bans. Works with a pasted user ID too |
| `/unban user [reason]` | Ban Members | Lifts a ban |
| `/cases member` | Any mod permission | Shows their warnings and moderation history |
| `/purge count [reason]` | Manage Messages | Deletes up to 500 recent messages in the channel |
| `/lock`, `/unlock [channel] [reason]` | Manage Channels | Stops members sending messages, or lets them again |
| `/slowmode interval [channel]` | Manage Channels | Sets slowmode, from off to 6 hours |

- **Cases.** Warnings, timeouts, kicks, bans and unbans are recorded as numbered cases in a private `#mod-cases` channel. The bot creates it the first time. Only roles with Kick, Ban or Timeout permission can read it, and only the bot posts there. Don't rename it. `/cases` reads it back.
- **Same rules as the app.** Each command checks the mod's own Discord permissions and rank, and shows in the audit log as `<reason> — by <mod> (<id>) via /<command>`. Replies are only visible to the mod who ran the command.
- **Who sees them.** Discord only shows each command to members with the permission it needs. To change that, go to **Server Settings → Integrations → your bot**.

**Turn them on:** on the app's **Home** page, under **Give your mods & admins access**, paste your portal address, pick your bot in **Add slash commands** and press **Turn on**. The app points your bot's **Interactions Endpoint URL** at `<your portal>/interactions` and adds the commands. Discord checks the portal answers for your bot before it saves anything. **Turn off** removes them again.

> ⚠️ While this is on, Discord sends **all** of the bot's slash commands and buttons to your portal. If the bot also runs its own commands from other code, those stop working until you turn this off.

If your portal was set up before slash commands existed, update it first: open your fork on GitHub and press **Sync fork**, then wait for Render to finish deploying.

## Good to know

- **Free plan sleeps.** Render's free plan sleeps after 15 minutes without traffic, and the first request after that takes about a minute. Discord only waits 3 seconds for a slash command, so the first command after a quiet spell fails with "The application did not respond". To keep the portal awake, point a free uptime monitor at `<your portal>/health` every 10 minutes (the free plan's 750 hours a month cover one service running all month), or upgrade the service to a paid instance.
- **Signing everyone out.** Sessions last 7 days. To sign everyone out at once, change `SESSION_SECRET` in Render and redeploy.
- **Your token.** The bot token only lives in Render's environment settings. It is not in the repo or the app.
- **Mod privacy.** The portal only learns a mod's Discord ID, name and avatar (the `identify` scope).
- **Other hosts.** The portal runs on any host with Node 20+. Set the same environment variables plus `PUBLIC_URL` (your https address) and start it with `node server/index.js`.
