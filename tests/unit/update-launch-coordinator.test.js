const test = require('node:test');
const assert = require('node:assert/strict');

const { launchInstallerAfterAgentShutdown } = require('../../src/main/update-launch-coordinator');

test('a failed Agent shutdown aborts update installer launch', async () => {
  let launches = 0;
  const result = await launchInstallerAfterAgentShutdown({
    activityAgent: { shutdownForUpdateSync: () => ({ ok: false, status: 2 }) },
    launchInstaller: async () => { launches += 1; return ''; },
    filePath: 'C:\\Temp\\NekoStatus.exe',
    options: {},
  });

  assert.equal(launches, 0);
  assert.match(result, /已取消安装/);
  assert.match(result, /退出码 2/);
});

test('a successful Agent shutdown allows update installer launch', async () => {
  let launchedPath = '';
  const result = await launchInstallerAfterAgentShutdown({
    activityAgent: { shutdownForUpdateSync: () => ({ ok: true, status: 0 }) },
    launchInstaller: async (filePath) => { launchedPath = filePath; return ''; },
    filePath: 'C:\\Temp\\NekoStatus.exe',
    options: {},
  });

  assert.equal(result, '');
  assert.equal(launchedPath, 'C:\\Temp\\NekoStatus.exe');
});
