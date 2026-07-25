const DEFAULT_SRS_HOST = 'rtmp1.koirin.com';
const DEFAULT_SRS_RTMP_PORT = 51935;
const DEFAULT_SRS_API_PORT = 51985;
const {
  DEVELOPER_SCREENSHOT_TUNING_DEFAULTS,
  normalizeDeveloperScreenshotTuning,
} = require('../shared/screenshot-tuning');

const DEVELOPER_UIUX_TUNING_DEFAULTS = Object.freeze({
  radiusCard: 24,
  radiusButton: 18,
  glassOpacity: 5,
  fontScale: 100,
  textOpacity: 60,
});

const DEFAULTS = {
  deviceKey: '',
  deviceId: null,
  reportInterval: 10,
  serverMode: 'production',
  serverUrlProd: 'https://nekostatus.koirin.com',
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
  seedColor: '#0ea5e9',
  customSeedColor: '',
  enableExperimentalFeatures: false,
  enableExperimentalActivityEntry: false,
  enableExperimentalStreamEntry: false,
  enableExperimentalUiLabEntry: false,
  enableExperimentalCurveLoaders: false,
  loadingCurveStyle: 'auto',
  uiAppearanceProfile: 'classic',
  enableActivityFeature: false,
  enableActivityPublishing: false,
  enableActivitySnapshots: false,
  enableActivityBackground: false,
  enableActivityAutoStart: true,
  activityInstallationId: '',
  activityDeviceBindings: { version: 1, entries: {} },
  activityBoundUserId: null,
  activityDeviceId: null,
  activityDeviceName: '',
  activityOnboardingSeen: false,
  activitySnapshotPrivacyPending: { version: 1, entries: {} },
  glassEffect: true,
  uiScale: 100,
  uiFont: '',
  debugEnabled: false,
  developerUiInspectEnabled: false,
  developerUiInspectIncludeHidden: false,
  developerUiuxTuning: { ...DEVELOPER_UIUX_TUNING_DEFAULTS },
  developerScreenshotTuning: { ...DEVELOPER_SCREENSHOT_TUNING_DEFAULTS },
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
  updateSourceType: 'github',
  updateSourceMode: 'selected',
  activeUpdateSourceId: 'github-default',
  updateSources: [],
  personalUpdateBaseUrl: 'https://git.koirin.com:39520',
  personalUpdateRepo: '',
  personalUpdateOwner: '',
  personalUpdateRepoName: '',
  personalUpdateToken: '',
  autoCheckUpdate: true,
  updateChannel: 'stable',
  autoDownload: true,
  skippedVersion: '',
  lastUpdateCheck: 0,
  changelogCache: [],
  pendingInstall: null,
  readAnnouncementIds: [],
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
  const hasStreamEntry = Object.prototype.hasOwnProperty.call(data, 'enableExperimentalStreamEntry');
  const merged = {
    ...DEFAULTS,
    ...data,
    developerUiuxTuning: {
      ...DEVELOPER_UIUX_TUNING_DEFAULTS,
      ...(data.developerUiuxTuning || {}),
    },
    developerScreenshotTuning: normalizeDeveloperScreenshotTuning({
      ...DEVELOPER_SCREENSHOT_TUNING_DEFAULTS,
      ...(data.developerScreenshotTuning || {}),
    }),
    streamConfig: {
      ...DEFAULTS.streamConfig,
      ...(data.streamConfig || {}),
    },
    activityDeviceBindings: {
      version: 1,
      entries: {
        ...(data.activityDeviceBindings?.entries || {}),
      },
    },
  };
  if (data.enableExperimentalFeatures === true) {
    if (!hasStreamEntry) merged.enableExperimentalStreamEntry = true;
  }
  if (typeof merged.loadingCurveStyle !== 'string' || !merged.loadingCurveStyle.trim()) {
    merged.loadingCurveStyle = 'auto';
  }
  merged.uiAppearanceProfile = normalizeUiAppearanceProfile(merged.uiAppearanceProfile);
  if (merged.enableExperimentalFeatures !== true) {
    merged.enableExperimentalUiLabEntry = false;
    merged.enableExperimentalCurveLoaders = false;
    merged.uiAppearanceProfile = 'classic';
  }
  merged.enableIncognito = false;

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

function normalizeUiAppearanceProfile(value) {
  return value === 'quiet' ? 'quiet' : 'classic';
}

module.exports = {
  DEFAULTS,
  DEFAULT_SRS_HOST,
  DEFAULT_SRS_RTMP_PORT,
  DEFAULT_SRS_API_PORT,
  normalizeUiAppearanceProfile,
  mergeDefaults,
};
