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

These rules always apply:

- Mods can only act on members **ranked below them**, the same rule Discord uses. They can never act on the server owner, the bot, or themselves.
- **Owner-only** (refused for mods): the Builder, wiping channels or roles, creating or deleting channels and roles, renaming the server, sending messages or DMs as the bot, pruning, and making the bot leave.
- Every action shows in the server's audit log as `<reason> — by <mod> (<id>) via mod portal`.
- To remove someone's access, take away their mod permissions in Discord. They lose access within 30 seconds.

## Set it up (about 10 minutes)

You need a free [Render](https://render.com) account, connected to the GitHub account that holds this repo.

### 1. Get your app's OAuth details

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and pick **your bot's application**.
2. Go to **OAuth2** and copy the **Client ID**.
3. Press **Reset Secret** and copy the **Client Secret**. Keep it private, like the bot token.

### 2. Deploy the portal on Render

1. In Render, go to **New → Blueprint** and pick the `discord-server-builder` repository. Render reads `render.yaml` from it.
2. Fill in the three values it asks for:
   - `DISCORD_BOT_TOKEN`: your bot token.
   - `DISCORD_CLIENT_ID`: from step 1.
   - `DISCORD_CLIENT_SECRET`: from step 1.

   `SESSION_SECRET` is generated for you.
3. Press **Apply** and wait for the deploy to finish. Copy the service URL, for example `https://discord-mod-portal-abcd.onrender.com`.
4. Open that URL in a browser. You should see **"Mod portal is running"**.

### 3. Allow the sign-in redirect

In the Developer Portal, go to **OAuth2 → Redirects** and add the URL below (your Render URL plus `/auth/callback`), then press **Save Changes**:

```
https://discord-mod-portal-abcd.onrender.com/auth/callback
```

### 4. Give your mods the app

Mods use the same app. They choose **Sign in with Discord** on the Home page and paste the portal URL. They'll see every server the bot is in where they are a mod.

To skip the pasting, put your portal URL in `package.json` → `modViewPortalUrl` and run `npm run dist:mod`. This builds `mod-view-<version>.exe` with the address already filled in. `npm run release` also attaches it to the GitHub release, so mods can download it from there.

## Good to know

- **Free plan sleeps.** Render's free plan sleeps after 15 minutes without traffic, and the first request after that takes about a minute. Upgrade the service to a paid instance if you want it always awake.
- **Signing everyone out.** Sessions last 7 days. To sign everyone out at once, change `SESSION_SECRET` in Render and redeploy.
- **Your token.** The bot token only lives in Render's environment settings. It is not in the repo or the app.
- **Mod privacy.** The portal only learns a mod's Discord ID, name and avatar (the `identify` scope).
- **Other hosts.** The portal runs on any host with Node 20+. Set the same environment variables plus `PUBLIC_URL` (your https address) and start it with `node server/index.js`.
