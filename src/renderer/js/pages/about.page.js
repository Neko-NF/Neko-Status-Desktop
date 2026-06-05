(function () {
  window._nekoModules = window._nekoModules || {};
  window._nekoModules.pages = window._nekoModules.pages || {};

  const $ = (id) => document.getElementById(id);

  const installedChannelNameMap = {
    stable: '稳定版',
    beta: 'Beta 测试版',
    nightly: 'Nightly 开发版',
  };

  function getInstalledChannel(version) {
    const value = String(version || '').toLowerCase();
    if (value.includes('-nightly')) return 'nightly';
    if (value.includes('-beta')) return 'beta';
    return 'stable';
  }

  function defaultDeps() {
    return {
      openExternal: async () => {},
      fetchRepo: null,
    };
  }

  function getCardByLabel(keyword) {
    return Array.from(document.querySelectorAll('.about-info-card') || [])
      .find((card) => (card.querySelector('.about-info-label')?.textContent || '').includes(keyword));
  }

  function setCardValue(keyword, value, subText) {
    const card = getCardByLabel(keyword);
    const valueEl = card?.querySelector('.about-info-value');
    const subEl = card?.querySelector('.about-info-sub');
    if (valueEl && value != null) valueEl.textContent = value;
    if (subEl && subText != null) subEl.textContent = subText;
    return card || null;
  }

  const AboutPage = {
    _deps: defaultDeps(),
    _bound: false,

    init(deps = {}) {
      this._deps = { ...this._deps, ...deps };
      if (this._bound) return;
      this._bound = true;
      this.bindExternalLinks();
    },

    bindExternalLinks() {
      ['aboutGithubBtn', 'aboutReleaseBtn'].forEach((id) => {
        $(id)?.addEventListener('click', (event) => {
          event.preventDefault();
          const url = event.currentTarget.href || event.currentTarget.getAttribute('href');
          if (url && url !== '#') this._deps.openExternal(url);
        });
      });
    },

    sync({ version, cfg = {}, runtimeVersions = {} } = {}) {
      if (!version) return false;

      const versionEl = $('aboutVersionValue');
      if (versionEl) versionEl.textContent = `v${version}`;

      const subEl = $('aboutVersionSub');
      if (subEl) {
        const channel = getInstalledChannel(version);
        subEl.textContent = `${installedChannelNameMap[channel] || '稳定版'} · ${new Date().toLocaleDateString('zh-CN')}`;
      }

      setCardValue(
        '运行环境',
        `Electron ${runtimeVersions.electron || ''}`,
        `Node.js ${runtimeVersions.node || ''} · Chromium ${runtimeVersions.chrome || ''}`,
      );

      const owner = cfg.githubOwner || 'Neko-NF';
      const repo = cfg.githubRepo || 'Neko-Status-Desktop';
      const repoUrl = `https://github.com/${owner}/${repo}`;
      const githubBtn = $('aboutGithubBtn');
      const releaseBtn = $('aboutReleaseBtn');
      const developerCard = $('aboutDeveloperCard');

      if (githubBtn) githubBtn.href = repoUrl;
      if (releaseBtn) releaseBtn.href = `${repoUrl}/releases`;
      if (developerCard) {
        developerCard.classList.add('is-link');
        developerCard.dataset.href = `https://github.com/${owner}`;
        if (!developerCard.dataset.boundClick) {
          developerCard.dataset.boundClick = 'true';
          developerCard.addEventListener('click', () => {
            const href = developerCard.dataset.href;
            if (href) this._deps.openExternal(href);
          });
        }
      }

      this.loadRepoMetadata(owner, repo, developerCard);
      return true;
    },

    async loadRepoMetadata(owner, repo, developerCard) {
      const fetchRepo = this._deps.fetchRepo || (async (repoOwner, repoName) => {
        const response = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}`, {
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) return null;
        return response.json();
      });

      try {
        const repoData = await fetchRepo(owner, repo);
        if (!repoData) return;

        if (repoData.owner) {
          setCardValue(
            '开发者',
            repoData.owner.login || owner,
            repoData.organization?.login || repoData.owner.login || 'GitHub',
          );
          if (developerCard) {
            developerCard.dataset.href = repoData.owner.html_url || `https://github.com/${repoData.owner.login || owner}`;
          }
        }

        if (repoData.license?.spdx_id) {
          setCardValue('开源协议', repoData.license.spdx_id);
        }
      } catch {
        // Keep static about-page defaults when GitHub metadata is unavailable.
      }
    },
  };

  window._nekoModules.pages.AboutPage = AboutPage;
})();
