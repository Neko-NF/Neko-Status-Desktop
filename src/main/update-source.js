const DEFAULT_GITHUB_OWNER = 'Neko-NF';
const DEFAULT_GITHUB_REPO = 'Neko-Status-Desktop';
const DEFAULT_PERSONAL_BASE_URL = 'https://git.koirin.com:39520/';

function trimSlash(value) {
  return String(value || '').replace(/\/+$/g, '');
}

function stripGitSuffix(value) {
  return String(value || '').replace(/\.git$/i, '');
}

function parseRepoInput(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repo = stripGitSuffix(parts[1]);
    const isGithub = /(^|\.)github\.com$/i.test(url.hostname);
    return {
      type: isGithub ? 'github' : 'personal',
      owner,
      repo,
      baseUrl: isGithub ? 'https://github.com' : `${url.protocol}//${url.host}`,
      repoUrl: isGithub ? `https://github.com/${owner}/${repo}` : `${trimSlash(`${url.protocol}//${url.host}`)}/${owner}/${repo}`,
    };
  } catch {
    const parts = raw.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    if (parts.length !== 2) return null;
    return {
      type: 'github',
      owner: parts[0],
      repo: stripGitSuffix(parts[1]),
      baseUrl: 'https://github.com',
      repoUrl: `https://github.com/${parts[0]}/${stripGitSuffix(parts[1])}`,
    };
  }
}

function normalizeSource(source, fallback = {}) {
  const type = source?.type === 'personal' ? 'personal' : 'github';
  const id = String(source?.id || fallback.id || `${type}-${source?.owner || fallback.owner || 'default'}-${source?.repo || fallback.repo || 'repo'}`).trim();
  const parsed = parseRepoInput(source?.repoUrl || source?.url || source?.personalUpdateRepo || '');
  const owner = source?.owner || parsed?.owner || fallback.owner || '';
  const repo = source?.repo || parsed?.repo || fallback.repo || '';
  const baseUrl = trimSlash(source?.baseUrl || parsed?.baseUrl || fallback.baseUrl || (type === 'github' ? 'https://github.com' : DEFAULT_PERSONAL_BASE_URL));
  const token = source?.token || fallback.token || '';
  const label = source?.label || (type === 'github' ? `GitHub: ${owner}/${repo}` : `Personal: ${owner}/${repo}`);
  const repoUrl = type === 'github'
    ? `https://github.com/${owner}/${repo}`
    : `${baseUrl}/${owner}/${repo}`;

  return {
    id,
    type,
    label,
    owner,
    repo,
    baseUrl,
    repoUrl,
    token,
    enabled: source?.enabled !== false,
    priority: Number(source?.priority) || 0,
    releasesUrl: owner && repo
      ? (type === 'github'
        ? `https://api.github.com/repos/${owner}/${repo}/releases`
        : `${baseUrl}/api/v1/repos/${owner}/${repo}/releases`)
      : '',
    contentsUrl: owner && repo && type === 'personal'
      ? `${baseUrl}/api/v1/repos/${owner}/${repo}/contents`
      : '',
    releasePageUrl: owner && repo
      ? (type === 'github'
        ? `https://github.com/${owner}/${repo}/releases`
        : `${baseUrl}/${owner}/${repo}/releases`)
      : baseUrl,
  };
}

function getLegacySources(configStore) {
  const githubOwner = configStore.get('githubOwner') || DEFAULT_GITHUB_OWNER;
  const githubRepo = configStore.get('githubRepo') || DEFAULT_GITHUB_REPO;
  const sources = [
    normalizeSource({
      id: 'github-default',
      type: 'github',
      label: 'GitHub',
      owner: githubOwner,
      repo: githubRepo,
      token: configStore.get('githubToken') || '',
    }),
  ];

  const repoInput = configStore.get('personalUpdateRepo') || '';
  const parsed = parseRepoInput(repoInput);
  const personalOwner = parsed?.owner || configStore.get('personalUpdateOwner') || '';
  const personalRepo = parsed?.repo || configStore.get('personalUpdateRepoName') || '';
  if (personalOwner && personalRepo) {
    sources.push(normalizeSource({
      id: 'personal-default',
      type: 'personal',
      label: 'Personal',
      baseUrl: configStore.get('personalUpdateBaseUrl') || parsed?.baseUrl || DEFAULT_PERSONAL_BASE_URL,
      owner: personalOwner,
      repo: personalRepo,
      token: configStore.get('personalUpdateToken') || '',
    }));
  }

  return sources;
}

function getSavedUpdateSources(configStore) {
  const explicit = configStore.get('updateSources');
  const sources = Array.isArray(explicit)
    ? explicit.map((source) => normalizeSource(source)).filter((source) => source.owner && source.repo)
    : [];

  const byId = new Map();
  for (const source of [...getLegacySources(configStore), ...sources]) {
    if (!source.enabled) {
      byId.delete(source.id);
      continue;
    }
    byId.set(source.id, source);
  }
  return Array.from(byId.values()).sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label));
}

function getUpdateSourceMode(configStore) {
  return configStore.get('updateSourceMode') === 'smart' ? 'smart' : 'selected';
}

function getSelectedUpdateSource(configStore) {
  const sources = getSavedUpdateSources(configStore);
  const selectedId = configStore.get('activeUpdateSourceId');
  const selected = sources.find((source) => source.id === selectedId);
  if (selected) return selected;

  const legacyType = configStore.get('updateSourceType') === 'personal' ? 'personal' : 'github';
  return sources.find((source) => source.type === legacyType) || sources[0] || normalizeSource({
    id: 'github-default',
    type: 'github',
    label: 'GitHub',
    owner: DEFAULT_GITHUB_OWNER,
    repo: DEFAULT_GITHUB_REPO,
  });
}

function getActiveUpdateSource(configStore) {
  return getSelectedUpdateSource(configStore);
}

function createSourceConfigFromParsed(parsed, overrides = {}) {
  if (!parsed) return null;
  return normalizeSource({
    id: overrides.id || `${parsed.type}-${parsed.owner}-${parsed.repo}`.toLowerCase(),
    type: parsed.type,
    label: overrides.label || (parsed.type === 'github' ? 'GitHub' : 'Personal'),
    baseUrl: parsed.baseUrl,
    owner: parsed.owner,
    repo: parsed.repo,
    repoUrl: parsed.repoUrl,
    token: overrides.token || '',
    priority: overrides.priority,
  });
}

function getLegacyActiveUpdateSource(configStore) {
  const type = configStore.get('updateSourceType') === 'personal' ? 'personal' : 'github';

  if (type === 'personal') {
    const repoInput = configStore.get('personalUpdateRepo') || '';
    const parsed = parseRepoInput(repoInput);
    const baseUrl = trimSlash(configStore.get('personalUpdateBaseUrl') || parsed?.baseUrl || DEFAULT_PERSONAL_BASE_URL);
    const owner = parsed?.owner || configStore.get('personalUpdateOwner') || '';
    const repo = parsed?.repo || configStore.get('personalUpdateRepoName') || '';
    return {
      type: 'personal',
      owner,
      repo,
      baseUrl,
      token: configStore.get('personalUpdateToken') || '',
      label: owner && repo ? `${baseUrl}/${owner}/${repo}` : baseUrl,
      releasesUrl: owner && repo ? `${baseUrl}/api/v1/repos/${owner}/${repo}/releases` : '',
      contentsUrl: owner && repo ? `${baseUrl}/api/v1/repos/${owner}/${repo}/contents` : '',
      releasePageUrl: owner && repo ? `${baseUrl}/${owner}/${repo}/releases` : baseUrl,
    };
  }

  const owner = configStore.get('githubOwner') || DEFAULT_GITHUB_OWNER;
  const repo = configStore.get('githubRepo') || DEFAULT_GITHUB_REPO;
  return {
    type: 'github',
    owner,
    repo,
    baseUrl: 'https://github.com',
    token: configStore.get('githubToken') || '',
    label: `github.com/${owner}/${repo}`,
    releasesUrl: `https://api.github.com/repos/${owner}/${repo}/releases`,
    contentsUrl: '',
    releasePageUrl: `https://github.com/${owner}/${repo}/releases`,
  };
}

function buildReleaseHeaders(source, forAsset = false) {
  const headers = source.type === 'github'
    ? { Accept: 'application/vnd.github.v3+json' }
    : { Accept: 'application/json' };
  if (source.token) {
    headers.Authorization = source.type === 'github' ? `token ${source.token}` : `token ${source.token}`;
  }
  if (forAsset) headers.Accept = 'application/octet-stream';
  return headers;
}

function buildDownloadHeadersForUrl(url, configStore) {
  const rawUrl = String(url || '');
  const sources = getSavedUpdateSources(configStore);
  const source = sources.find((item) => {
    if (item.type === 'github') {
      return rawUrl.includes('api.github.com') || rawUrl.includes('github.com') || rawUrl.includes('githubusercontent.com');
    }
    return item.baseUrl && rawUrl.startsWith(item.baseUrl);
  }) || getSelectedUpdateSource(configStore);

  return buildReleaseHeaders(source, true);
}

function pickAssetDownloadUrl(asset, source) {
  if (!asset) return null;
  if (source.type === 'github' && source.token && asset.url) return asset.url;
  const url = asset.browser_download_url || asset.download_url || asset.url || null;
  if (source.type === 'personal' && source.baseUrl && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(url || '')) {
    try {
      const parsedUrl = new URL(url);
      const parsedBase = new URL(source.baseUrl);
      parsedUrl.protocol = parsedBase.protocol;
      parsedUrl.host = parsedBase.host;
      return parsedUrl.toString();
    } catch {
      return url;
    }
  }
  return url;
}

module.exports = {
  DEFAULT_GITHUB_OWNER,
  DEFAULT_GITHUB_REPO,
  DEFAULT_PERSONAL_BASE_URL,
  parseRepoInput,
  normalizeSource,
  getSavedUpdateSources,
  getSelectedUpdateSource,
  getUpdateSourceMode,
  getActiveUpdateSource,
  createSourceConfigFromParsed,
  getLegacyActiveUpdateSource,
  buildReleaseHeaders,
  buildDownloadHeadersForUrl,
  pickAssetDownloadUrl,
};
