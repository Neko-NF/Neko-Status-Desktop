const { test } = require('node:test');
const assert = require('node:assert/strict');
const { IPC_CHANNELS, IPC_EVENTS } = require('../../src/shared/ipc-contracts');
const { registerDeveloperModeIpc } = require('../../src/main/ipc/developer-mode.ipc');

function createHarness() {
  const handlers = {};
  const mainSends = [];
  const panelSends = [];
  const mainActions = [];
  const panelActions = [];
  const screenshotActions = [];
  const deps = {
    ipcMain: {
      handle(channel, fn) { handlers[channel] = fn; },
    },
    getMainWindow: () => ({
      isDestroyed: () => false,
      show: () => mainActions.push('show'),
      focus: () => mainActions.push('focus'),
      webContents: {
        send: (channel, payload) => mainSends.push({ channel, payload }),
        openDevTools: (options) => mainActions.push(['openDevTools', options]),
        reloadIgnoringCache: () => mainActions.push('reloadIgnoringCache'),
      },
    }),
    getDeveloperModeWindow: () => ({
      isDestroyed: () => false,
      webContents: {
        send: (channel, payload) => panelSends.push({ channel, payload }),
        openDevTools: (options) => panelActions.push(['openDevTools', options]),
        reloadIgnoringCache: () => panelActions.push('reloadIgnoringCache'),
      },
    }),
    openDeveloperModeWindow: () => ({ id: 'panel' }),
    closeDeveloperModeWindow: () => { deps.closed = true; },
    statusService: {
      setScreenshotTuningToken: (token, value) => screenshotActions.push(['set', token, value]),
      resetScreenshotTuning: () => screenshotActions.push(['reset']),
    },
    closed: false,
  };
  registerDeveloperModeIpc(deps);
  return { handlers, deps, mainSends, panelSends, mainActions, panelActions, screenshotActions };
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
  const { handlers, mainSends, panelSends, screenshotActions } = createHarness();

  await handlers[IPC_CHANNELS.DEV_MODE_PANEL_COMMAND](null, { action: 'toggle-inspect' });
  await handlers[IPC_CHANNELS.DEV_MODE_PANEL_COMMAND](null, { action: 'set-uiux-token', token: 'radiusCard', value: 28 });
  await handlers[IPC_CHANNELS.DEV_MODE_PANEL_COMMAND](null, { action: 'set-screenshot-token', token: 'uploadFormat', value: 'png' });
  await handlers[IPC_CHANNELS.DEV_MODE_PANEL_COMMAND](null, { action: 'set-screenshot-token', token: 'targetKb', value: 2048 });
  await handlers[IPC_CHANNELS.DEV_MODE_PANEL_COMMAND](null, { action: 'reset-screenshot-tokens' });
  await handlers[IPC_CHANNELS.DEV_MODE_PANEL_STATE](null, { uiInspect: true });

  assert.deepEqual(mainSends, [
    {
      channel: IPC_EVENTS.DEV_MODE_PANEL_COMMAND,
      payload: { action: 'toggle-inspect' },
    },
    {
      channel: IPC_EVENTS.DEV_MODE_PANEL_COMMAND,
      payload: { action: 'set-uiux-token', token: 'radiusCard', value: 28 },
    },
    {
      channel: IPC_EVENTS.DEV_MODE_PANEL_COMMAND,
      payload: { action: 'set-screenshot-token', token: 'uploadFormat', value: 'png' },
    },
    {
      channel: IPC_EVENTS.DEV_MODE_PANEL_COMMAND,
      payload: { action: 'set-screenshot-token', token: 'targetKb', value: 2048 },
    },
    {
      channel: IPC_EVENTS.DEV_MODE_PANEL_COMMAND,
      payload: { action: 'reset-screenshot-tokens' },
    },
  ]);
  assert.deepEqual(screenshotActions, [['set', 'uploadFormat', 'png'], ['set', 'targetKb', 2048], ['reset']]);
  assert.deepEqual(panelSends, [{
    channel: IPC_EVENTS.DEV_MODE_PANEL_STATE,
    payload: { uiInspect: true },
  }]);
});

test('developer mode IPC handles Electron window debug actions in main process', async () => {
  const { handlers, mainSends, mainActions, panelActions } = createHarness();

  await handlers[IPC_CHANNELS.DEV_MODE_PANEL_COMMAND](null, { action: 'open-main-devtools' });
  await handlers[IPC_CHANNELS.DEV_MODE_PANEL_COMMAND](null, { action: 'reload-main-window' });
  await handlers[IPC_CHANNELS.DEV_MODE_PANEL_COMMAND](null, { action: 'focus-main-window' });
  await handlers[IPC_CHANNELS.DEV_MODE_PANEL_COMMAND](null, { action: 'open-panel-devtools' });
  await handlers[IPC_CHANNELS.DEV_MODE_PANEL_COMMAND](null, { action: 'reload-panel-window' });

  assert.deepEqual(mainSends, []);
  assert.equal(mainActions[0][0], 'openDevTools');
  assert.equal(mainActions[0][1].mode, 'detach');
  assert.deepEqual(mainActions.slice(1), ['reloadIgnoringCache', 'show', 'focus']);
  assert.equal(panelActions[0][0], 'openDevTools');
  assert.equal(panelActions[0][1].mode, 'detach');
  assert.equal(panelActions[1], 'reloadIgnoringCache');
});

test('developer mode IPC rejects unknown commands and malformed state', async () => {
  const { handlers, mainSends, panelSends } = createHarness();

  const badCommand = await handlers[IPC_CHANNELS.DEV_MODE_PANEL_COMMAND](null, { action: 'run-shell' });
  const badUiuxCommand = await handlers[IPC_CHANNELS.DEV_MODE_PANEL_COMMAND](null, { action: 'set-uiux-token', token: 'radiusCard', value: 999 });
  const badScreenshotCommand = await handlers[IPC_CHANNELS.DEV_MODE_PANEL_COMMAND](null, { action: 'set-screenshot-token', token: 'targetKb', value: 99 });
  const badFormatCommand = await handlers[IPC_CHANNELS.DEV_MODE_PANEL_COMMAND](null, { action: 'set-screenshot-token', token: 'uploadFormat', value: 'webp' });
  const badState = await handlers[IPC_CHANNELS.DEV_MODE_PANEL_STATE](null, { uiInspect: 'yes' });

  assert.equal(badCommand.ok, false);
  assert.equal(badCommand.error.code, 'INVALID_DEVELOPER_MODE_COMMAND');
  assert.equal(badUiuxCommand.ok, false);
  assert.equal(badUiuxCommand.error.code, 'INVALID_DEVELOPER_MODE_COMMAND');
  assert.equal(badScreenshotCommand.ok, false);
  assert.equal(badScreenshotCommand.error.code, 'INVALID_DEVELOPER_MODE_COMMAND');
  assert.equal(badFormatCommand.ok, false);
  assert.equal(badFormatCommand.error.code, 'INVALID_DEVELOPER_MODE_COMMAND');
  assert.equal(badState.ok, false);
  assert.equal(badState.error.code, 'INVALID_DEVELOPER_MODE_STATE');
  assert.deepEqual(mainSends, []);
  assert.deepEqual(panelSends, []);
});
