function launchInstallerAfterAgentShutdown({
  activityAgent,
  launchInstaller,
  filePath,
  options,
}) {
  let shutdown;
  try {
    shutdown = activityAgent.shutdownForUpdateSync();
  } catch (error) {
    return Promise.resolve(`无法停止上线提醒服务：${error.message}`);
  }
  if (!shutdown?.ok) {
    const detail = shutdown?.message || (shutdown?.status !== undefined ? `退出码 ${shutdown.status}` : '未知错误');
    return Promise.resolve(`无法停止上线提醒服务，已取消安装：${detail}`);
  }
  return launchInstaller(filePath, options);
}

module.exports = { launchInstallerAfterAgentShutdown };
