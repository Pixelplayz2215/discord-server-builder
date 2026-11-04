// Mod portal configuration, read from environment variables (set them on your host).
// PUBLIC_URL can be left out on Render, which provides RENDER_EXTERNAL_URL.
// More bots can share the portal (optional): DISCORD_BOT_TOKEN_2, DISCORD_BOT_TOKEN_3… Each gets its
// own 24/7, slash commands and buttons; mods sign in through the first bot (DISCORD_BOT_TOKEN).
const REQUIRED = ['DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'SESSION_SECRET'];
const cleanToken = (value) => String(value || '').trim().replace(/^Bot\s+/i, '');

// The extra bots' tokens, in number order, each once and never the first bot's.
function extraTokens(env, first) {
  return Object.keys(env)
    .map((key) => key.match(/^DISCORD_BOT_TOKEN_(\d+)$/))
    .filter(Boolean)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((m) => cleanToken(env[m[0]]))
    .filter((token, i, all) => token && token !== first && all.indexOf(token) === i);
}

function loadConfig(env = process.env) {
  const missing = REQUIRED.filter((key) => !env[key]);
  if (!env.PUBLIC_URL && !env.RENDER_EXTERNAL_URL) missing.push('PUBLIC_URL');
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  if (env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters.');
  const publicUrl = (env.PUBLIC_URL || env.RENDER_EXTERNAL_URL).replace(/\/+$/, '');
  if (!/^https:\/\//.test(publicUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(publicUrl)) {
    throw new Error('PUBLIC_URL must start with https:// (http is only allowed for localhost testing).');
  }
  const botToken = cleanToken(env.DISCORD_BOT_TOKEN);
  return {
    botToken,
    extraBotTokens: extraTokens(env, botToken),
    clientId: env.DISCORD_CLIENT_ID.trim(),
    clientSecret: env.DISCORD_CLIENT_SECRET.trim(),
    publicUrl,
    redirectUri: `${publicUrl}/auth/callback`,
    sessionSecret: env.SESSION_SECRET,
    sessionDays: Number(env.SESSION_DAYS) || 7,
    port: Number(env.PORT) || 8787,
  };
}

module.exports = { loadConfig };
