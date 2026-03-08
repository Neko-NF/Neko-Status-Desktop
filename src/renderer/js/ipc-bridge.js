/**
 * ipc-bridge.js
 * 渲染进程 IPC 封装，暴露为 window.nekoIPC
 * 所有与主进程的通信均通过此模块，便于统一管理
 */
const { ipcRenderer } = require('electron');

const nekoIPC = {
  // ── 配置 ────────────────────────────────────────────────────────────
  getConfig: (key) => ipcRenderer.invoke('config:get', key),
  setConfig: (key, value) => ipcRenderer.invoke('config:set', key, value),
  setManyConfig: (obj) => ipcRenderer.invoke('config:setMany', obj),
  getAllConfig: () => ipcRenderer.invoke('config:getAll'),

  // ── 上报服务 ─────────────────────────────────────────────────────────
  startService: () => ipcRenderer.invoke('service:start'),
  stopService:  () => ipcRenderer.invoke('service:stop'),
  isRunning:    () => ipcRenderer.invoke('service:isRunning'),
  restartService: () => ipcRenderer.invoke('service:restart'),
  getLastResult: () => ipcRenderer.invoke('service:lastResult'),

  // ── 开机自启 ─────────────────────────────────────────────────────────
  enableAutoStart:  () => ipcRenderer.invoke('autostart:enable'),
  disableAutoStart: () => ipcRenderer.invoke('autostart:disable'),
  isAutoStartEnabled: () => ipcRenderer.invoke('autostart:isEnabled'),

  // ── 截图 ─────────────────────────────────────────────────────────────
  captureScreen: () => ipcRenderer.invoke('screenshot:capture'),

  // ── 系统信息 ─────────────────────────────────────────────────────────
  getSystemInfo: () => ipcRenderer.invoke('system:info'),
  getBattery:    () => ipcRenderer.invoke('system:battery'),

  // ── 设备配对 ─────────────────────────────────────────────────────────
  handshake: (token, model) => ipcRenderer.invoke('pairing:handshake', { token, model }),

  // ── 连接测试 ─────────────────────────────────────────────────────────
  testConnection: (serverUrl) => ipcRenderer.invoke('api:testConnection', serverUrl),

  // ── 更新 ─────────────────────────────────────────────────────────────
  checkUpdate:      () => ipcRenderer.invoke('update:check'),
  getUpdateChannel: () => ipcRenderer.invoke('update:getChannel'),
  setUpdateChannel: (channel) => ipcRenderer.invoke('update:setChannel', channel),
  downloadUpdate:   (url) => ipcRenderer.invoke('update:download', { url }),
  installUpdate:    (filePath, expectedSha256) => ipcRenderer.invoke('update:install', { filePath, expectedSha256 }),

  // ── 应用控制 ─────────────────────────────────────────────────────────
  getVersion:    () => ipcRenderer.invoke('app:getVersion'),
  getDeviceName: () => ipcRenderer.invoke('app:getDeviceName'),
  quit:     () => ipcRenderer.invoke('app:quit'),
  hide:     () => ipcRenderer.invoke('app:hide'),
  minimize: () => ipcRenderer.invoke('app:minimize'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),

  // ── 系统通知 ─────────────────────────────────────────────────────────
  notify: (title, body) => ipcRenderer.invoke('notification:show', { title, body }),

  // ── 事件监听 ─────────────────────────────────────────────────────────
  /**
   * 监听主进程推送的事件
   * @param {string} channel
   * @param {Function} callback (data) => void
   * @returns {Function} 取消监听函数
   */
  on(channel, callback) {
    const handler = (_, data) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  /**
   * 监听一次性事件
   */
  once(channel, callback) {
    ipcRenderer.once(channel, (_, data) => callback(data));
  },
};

// 挂载到 window 全局，方便在 app.js 及其他脚本中访问
window.nekoIPC = nekoIPC;
