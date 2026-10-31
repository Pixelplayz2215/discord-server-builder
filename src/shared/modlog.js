// Reading moderation back from Discord: whether a channel is locked (from the channel, or from an
// audit log entry), and the reasons the app, the mod portal and the slash commands write.
// Loaded with require() in main and the portal, and as a plain <script> in the renderer, where it
// defines window.ModLog.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ModLog = api;
})(typeof self !== 'undefined' ? self : this, () => {
  const SEND_MESSAGES = 1n << 11n;
  const CONNECT = 1n << 20n;
  const OVERWRITE_ACTIONS = [13, 14, 15]; // permission overwrite created, updated, removed

  const isVoiceType = (type) => type === 2 || type === 13;
  // The permission a lock takes from @everyone: joining for voice channels, sending for the rest.
  // With the type unknown, either one counts.
  const lockBits = (type) => (type == null ? SEND_MESSAGES | CONNECT : isVoiceType(type) ? CONNECT : SEND_MESSAGES);
  const bits = (value) => {
    try {
      return BigInt(value || 0);
    } catch {
      return 0n;
    }
  };

  function isLocked(channel, guildId) {
    const everyone = (channel?.permission_overwrites || []).find((o) => o.id === guildId);
    return !!everyone && (bits(everyone.deny) & lockBits(channel.type)) !== 0n;
  }

  // 'locked' or 'unlocked' when an audit log entry changed whether @everyone can send (or join) in a
  // channel, else null. channelType is the channel's type when it's known.
  function lockFromAudit(entry, guildId, channelType) {
    if (!OVERWRITE_ACTIONS.includes(entry?.action_type) || entry.options?.id !== guildId) return null;
    const deny = (entry.changes || []).find((c) => c.key === 'deny');
    const before = entry.action_type === 13 ? 0n : bits(deny?.old_value);
    const after = entry.action_type === 15 ? 0n : bits(deny?.new_value);
    const mask = lockBits(channelType);
    const was = (before & mask) !== 0n;
    const now = (after & mask) !== 0n;
    if (was === now) return null;
    return now ? 'locked' : 'unlocked';
  }

  // Actions taken through the bot keep who really did them in the reason:
  // "<reason> — by <name> (<id>) via <where>" (server/guard.js auditReason).
  const VIA = /^(?:([\s\S]*?) — )?by (.+) \((\d{15,21})\) via (.+)$/;
  function parseAuditReason(text) {
    const m = String(text || '').match(VIA);
    if (!m) return { reason: String(text || '').trim(), by: null, via: null };
    return { reason: (m[1] || '').trim(), by: { name: m[2], id: m[3] }, via: m[4].trim() };
  }

  return { isLocked, lockFromAudit, parseAuditReason, isVoiceType };
});
