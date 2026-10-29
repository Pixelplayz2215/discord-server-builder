// Narrow bridge between the UI and the main process. Bot tokens never reach the renderer.
const { contextBridge, ipcRenderer } = require('electron');

const INVOKE = new Set([
  'bots:list', 'bots:add', 'bots:refresh', 'bots:update', 'bots:remove', 'bots:reorder',
  'mod:signIn', 'mod:cancelSignIn', 'mod:checkPortal',
  'commands:status', 'commands:enable', 'commands:disable',
  'cases:list', 'cases:warn',
  'servers:config', 'raid:saveLockdown', 'raid:ban',
  'backups:list', 'backups:create', 'backups:delete', 'backups:setAuto', 'backups:plan', 'backups:restore', 'backups:export', 'backups:import',
  'logs:get', 'logs:set', 'logs:createChannel', 'logs:test',
  'presence:set', 'rest', 'members:all', 'channel:purge', 'channel:lock',
  'builder:run', 'builder:clone',
  'templates:list', 'templates:save', 'templates:delete', 'templates:export', 'templates:import',
  'settings:set', 'settings:pickLogo',
  'update:check', 'update:install',
  'open:external', 'app:info',
]);
const EVENTS = new Set(['presence:state', 'builder:event', 'update:progress', 'cases:error', 'raid:progress', 'backup:event', 'backups:changed']);

contextBridge.exposeInMainWorld('bridge', {
  // Read synchronously so theme.js can style the page before its first paint.
  initialSettings: ipcRenderer.sendSync('settings:initial'),
  // Resolves to { ok, data } or { ok: false, error } — unwrapped by api() in the renderer.
  invoke: (channel, ...args) => {
    if (!INVOKE.has(channel)) return Promise.resolve({ ok: false, error: { message: `Blocked channel ${channel}` } });
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel, callback) => {
    if (!EVENTS.has(channel)) return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
