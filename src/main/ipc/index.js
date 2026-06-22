function registerInvokeHandlers(ipcMain, handlers) {
  Object.entries(handlers).forEach(([channel, handler]) => {
    ipcMain.handle(channel, handler);
  });
}

function registerEventHandlers(ipcMain, handlers) {
  Object.entries(handlers).forEach(([channel, handler]) => {
    ipcMain.on(channel, handler);
  });
}

const { registerConfigIpc } = require('./config.ipc');
const { registerStreamIpc } = require('./stream.ipc');
const { registerSystemIpc } = require('./system.ipc');
const { registerApiIpc } = require('./api.ipc');
const { registerAuthIpc } = require('./auth.ipc');
const { registerServiceIpc } = require('./service.ipc');
const { registerUpdateIpc } = require('./update.ipc');
const { registerDeveloperModeIpc } = require('./developer-mode.ipc');
const { registerAnnouncementIpc } = require('./announcement.ipc');
const { registerActivityIpc } = require('./activity.ipc');

module.exports = {
  registerInvokeHandlers,
  registerEventHandlers,
  registerConfigIpc,
  registerStreamIpc,
  registerSystemIpc,
  registerApiIpc,
  registerAuthIpc,
  registerServiceIpc,
  registerUpdateIpc,
  registerDeveloperModeIpc,
  registerAnnouncementIpc,
  registerActivityIpc,
};
