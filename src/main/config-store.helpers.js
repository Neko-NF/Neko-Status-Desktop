const DEFAULT_SRS_HOST = 'rtmp1.koirin.com';
const DEFAULT_SRS_RTMP_PORT = 51935;
const DEFAULT_SRS_API_PORT = 51985;

const DEFAULTS = {
  deviceKey: '',
  deviceId: null,
  reportInterval: 10,
  serverMode: 'production',
  serverUrlProd: 'https://nf.koirin.com',
  serverUrlLocal: 'http://127.0.0.1:3000',
  enableScreenshot: false,
  screenshotInterval: 60,
  screenshotMode: 'auto',
  syncScreenshotInterval: true,
  enableAutoStart: false,
  minimizeOnAutoStart: false,
  startupDelayMs: 5000,
  enableAutoServiceStart: false,
  closeAction: 'ask',
  themeMode: 'light',
  darkModeStart: '18:00',
  darkModeEnd: '07:00',
  seedColor: '#06b6d4',
  customSeedColor: '',
  enableExperimentalFeatures: false,
  glassEffect: true,
  uiScale: 100,
  uiFont: '',
  debugEnabled: false,
  enableNotification: true,
  doNotDisturb: false,
  enableIncognito: false,
  incognitoScope: 'screenshot',
  blurAllScreenshots: false,
  privacyRules: [],
  enable2FA: false,
  restoreLastState: false,
  authListCollapsed: false,
  reportIntervalMode: 'auto',
  dashboardLayout: null,
  enableAutoRestart: true,
  maxRestarts: 3,
  restartIntervalSec: 30,
  watchdogTimeoutSec: 60,
  githubOwner: 'Neko-NF',
  githubRepo: 'Neko-Status-Desktop',
  githubToken: '',
  autoCheckUpdate: true,
  updateChannel: 'stable',
  autoDownload: true,
  skippedVersion: '',
  lastUpdateCheck: 0,
  changelogCache: [],
  pendingInstall: null,
  authToken: '',
  authUser: null,
  authPromptDismissed: false,
  serverConfigured: false,
  localTestAccounts: [],
  streamConfig: {
    srsHost: DEFAULT_SRS_HOST,
    srsRtmpPort: DEFAULT_SRS_RTMP_PORT,
    srsApp: 'live',
    srsApiPort: DEFAULT_SRS_API_PORT,
    streamKey: '',
    obsWsHost: '127.0.0.1',
    obsWsPort: 4455,
    obsWsPasswordEncrypted: '',
  },
};

function mergeDefaults(data = {}) {
  const merged = {
    ...DEFAULTS,
    ...data,
    streamConfig: {
      ...DEFAULTS.streamConfig,
      ...(data.streamConfig || {}),
    },
  };

  const streamConfig = merged.streamConfig || {};
  const srsHost = String(streamConfig.srsHost || '').trim().toLowerCase();
  if (
    srsHost === DEFAULT_SRS_HOST &&
    Number(streamConfig.srsRtmpPort) === DEFAULT_SRS_RTMP_PORT &&
    Number(streamConfig.srsApiPort) === DEFAULT_SRS_RTMP_PORT
  ) {
    streamConfig.srsApiPort = DEFAULT_SRS_API_PORT;
  }

  return merged;
}

module.exports = {
  DEFAULTS,
  DEFAULT_SRS_HOST,
  DEFAULT_SRS_RTMP_PORT,
  DEFAULT_SRS_API_PORT,
  mergeDefaults,
};
