// Narrow bridge between the UI and the main process. Bot tokens never reach the renderer.
const { contextBridge, ipcRenderer } = require('electron');

const INVOKE = new Set([
  'bots:list', 'bots:add', 'bots:refresh', 'bots:update', 'bots:remove', 'bots:reorder',
  'presence:set', 'rest', 'members:all', 'channel:purge', 'channel:lock',
  'builder:run', 'builder:clone',
  'templates:list', 'templates:save', 'templates:delete', 'templates:export', 'templates:import',
  'settings:set', 'settings:pickLogo',
  'open:external', 'app:info',
]);
const EVENTS = new Set(['presence:state', 'builder:event']);

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
