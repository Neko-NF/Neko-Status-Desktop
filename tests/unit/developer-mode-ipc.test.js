const { test } = require('node:test');
const assert = require('node:assert/strict');
const { IPC_CHANNELS, IPC_EVENTS } = require('../../src/shared/ipc-contracts');
const { registerDeveloperModeIpc } = require('../../src/main/ipc/developer-mode.ipc');

function createHarness() {
  const handlers = {};
  const mainSends = [];
  const panelSends = [];
  const deps = {
    ipcMain: {
      handle(channel, fn) { handlers[channel] = fn; },
    },
    getMainWindow: () => ({
      isDestroyed: () => false,
      webContents: {
        send: (channel, payload) => mainSends.push({ channel, payload }),
      },
    }),
    getDeveloperModeWindow: () => ({
      isDestroyed: () => false,
      webContents: {
        send: (channel, payload) => panelSends.push({ channel, payload }),
      },
    }),
    openDeveloperModeWindow: () => ({ id: 'panel' }),
    closeDeveloperModeWindow: () => { deps.closed = true; },
    closed: false,
  };
  registerDeveloperModeIpc(deps);
  return { handlers, deps, mainSends, panelSends };
}

test('developer mode IPC opens and closes the external panel through controlled handlers', async () => {
  const { handlers, deps } = createHarness();

  assert.equal(typeof handlers[IPC_CHANNELS.DEV_MODE_PANEL_OPEN], 'function');
  assert.equal(typeof handlers[IPC_CHANNELS.DEV_MODE_PANEL_CLOSE], 'function');
  assert.deepEqual(await handlers[IPC_CHANNELS.DEV_MODE_PANEL_OPEN](), {
    ok: true,
    data: { opened: true },
  });
  assert.deepEqual(await handlers[IPC_CHANNELS.DEV_MODE_PANEL_CLOSE](), {
    ok: true,
    data: { closed: true },
  });
  assert.equal(deps.closed, true);
});

test('developer mode IPC forwards commands to main window and state to sidecar only', async () => {
  const { handlers, mainSends, panelSends } = createHarness();

  await handlers[IPC_CHANNELS.DEV_MODE_PANEL_COMMAND](null, { action: 'toggle-inspect' });
  await handlers[IPC_CHANNELS.DEV_MODE_PANEL_STATE](null, { uiInspect: true });

  assert.deepEqual(mainSends, [{
    channel: IPC_EVENTS.DEV_MODE_PANEL_COMMAND,
    payload: { action: 'toggle-inspect' },
  }]);
  assert.deepEqual(panelSends, [{
    channel: IPC_EVENTS.DEV_MODE_PANEL_STATE,
    payload: { uiInspect: true },
  }]);
});
