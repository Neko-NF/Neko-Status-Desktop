const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseRepoInput,
  getActiveUpdateSource,
  getSavedUpdateSources,
  getUpdateSourceMode,
  getUpdateSourceKind,
  buildDownloadHeadersForUrl,
  pickAssetDownloadUrl,
} = require('../../src/main/update-source');

function createConfig(data) {
  return {
    get(key) { return data[key]; },
  };
}

describe('update source helpers', () => {
  it('parses GitHub repository URLs', () => {
    const parsed = parseRepoInput('https://github.com/Neko-NF/Neko-Status-Desktop.git');
    assert.equal(parsed.type, 'github');
    assert.equal(parsed.owner, 'Neko-NF');
    assert.equal(parsed.repo, 'Neko-Status-Desktop');
  });

  it('parses personal server repository URLs', () => {
    const parsed = parseRepoInput('https://git.koirin.com:39520/team/neko-status');
    assert.equal(parsed.type, 'personal');
    assert.equal(parsed.baseUrl, 'https://git.koirin.com:39520');
    assert.equal(parsed.owner, 'team');
    assert.equal(parsed.repo, 'neko-status');
  });

  it('builds a Gitea-compatible personal release API URL', () => {
    const source = getActiveUpdateSource(createConfig({
      updateSourceType: 'personal',
      personalUpdateBaseUrl: 'https://git.koirin.com:39520',
      personalUpdateRepo: 'https://git.koirin.com:39520/team/neko-status',
    }));
    assert.equal(source.type, 'personal');
    assert.equal(source.releasesUrl, 'https://git.koirin.com:39520/api/v1/repos/team/neko-status/releases');
  });

  it('returns saved GitHub and personal sources and honors selected id', () => {
    const config = createConfig({
      githubOwner: 'Neko-NF',
      githubRepo: 'Neko-Status-Desktop',
      personalUpdateRepo: 'https://git.koirin.com:39520/NF/Neko',
      activeUpdateSourceId: 'personal-default',
    });
    const sources = getSavedUpdateSources(config);
    assert.deepEqual(sources.map((source) => source.id), ['github-default', 'personal-default']);
    assert.equal(getActiveUpdateSource(config).type, 'personal');
  });

  it('classifies the built-in GitHub source separately from personal repositories', () => {
    assert.equal(getUpdateSourceKind({ type: 'github', owner: 'Neko-NF', repo: 'Neko-Status-Desktop' }), 'official');
    assert.equal(getUpdateSourceKind({ type: 'github', owner: 'someone', repo: 'fork' }), 'github');
    assert.equal(getUpdateSourceKind({ type: 'personal', owner: 'NF', repo: 'Neko' }), 'personal');
  });

  it('lets saved disabled sources hide legacy defaults', () => {
    const config = createConfig({
      githubOwner: 'Neko-NF',
      githubRepo: 'Neko-Status-Desktop',
      updateSources: [{ id: 'github-default', type: 'github', owner: 'Neko-NF', repo: 'Neko-Status-Desktop', enabled: false }],
    });
    assert.deepEqual(getSavedUpdateSources(config).map((source) => source.id), []);
  });

  it('normalizes smart mode and keeps download headers URL-scoped', () => {
    const config = createConfig({
      updateSourceMode: 'smart',
      githubToken: 'gh-token',
      personalUpdateRepo: 'https://git.koirin.com:39520/NF/Neko',
      personalUpdateToken: 'personal-token',
    });
    assert.equal(getUpdateSourceMode(config), 'smart');
    assert.equal(
      buildDownloadHeadersForUrl('https://git.koirin.com:39520/NF/Neko/raw/branch/main/app.exe', config).Authorization,
      'token personal-token'
    );
    assert.equal(
      buildDownloadHeadersForUrl('https://api.github.com/repos/Neko-NF/Neko-Status-Desktop/releases/assets/1', config).Authorization,
      'token gh-token'
    );
  });

  it('uses GitHub asset API URLs only when a GitHub token is present', () => {
    const asset = {
      url: 'https://api.github.com/repos/o/r/releases/assets/1',
      browser_download_url: 'https://github.com/o/r/releases/download/v1/app.exe',
    };
    assert.equal(pickAssetDownloadUrl(asset, { type: 'github', token: '' }), asset.browser_download_url);
    assert.equal(pickAssetDownloadUrl(asset, { type: 'github', token: 'secret' }), asset.url);
  });

  it('keeps personal download URLs direct when present', () => {
    const asset = {
      download_url: 'https://git.koirin.com:39520/NF/Neko/raw/branch/main/NekoStatus-Setup-1.2.7.exe',
    };
    assert.equal(pickAssetDownloadUrl(asset, { type: 'personal' }), asset.download_url);
  });

  it('rewrites personal release asset localhost URLs to the configured public base URL', () => {
    const asset = {
      browser_download_url: 'http://localhost:30910/NF/Neko/releases/download/v1.2.8/NekoStatus-Setup-1.2.8.exe',
    };
    assert.equal(
      pickAssetDownloadUrl(asset, { type: 'personal', baseUrl: 'https://git.koirin.com:39520' }),
      'https://git.koirin.com:39520/NF/Neko/releases/download/v1.2.8/NekoStatus-Setup-1.2.8.exe'
    );
  });
});
