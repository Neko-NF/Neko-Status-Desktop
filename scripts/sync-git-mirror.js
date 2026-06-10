const { spawnSync } = require('child_process');

const DEFAULT_SOURCE_REMOTE = 'origin';
const DEFAULT_TARGET_URL = 'https://git.koirin.com:39520/NF/Neko.git';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function mask(value) {
  if (!value || !process.env.GITHUB_ACTIONS) return;
  console.log(`::add-mask::${value}`);
}

function withCredentials(rawUrl, username, token) {
  if (!token) return rawUrl;

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  if (!/^https?:$/.test(url.protocol)) return rawUrl;
  url.username = username || url.username || 'git';
  url.password = token;
  return url.toString();
}

function sanitizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.password) url.password = '***';
    if (url.username && url.username.length > 24) url.username = '***';
    return url.toString();
  } catch {
    return String(rawUrl || '').replace(/:\/\/([^/@:]+):([^/@]+)@/, '://$1:***@');
  }
}

function runGit(args, options = {}) {
  const gitArgs = options.config ? [...options.config, ...args] : args;
  const result = spawnSync('git', gitArgs, {
    cwd: process.cwd(),
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });

  if (result.status !== 0) {
    const detail = options.capture ? `${result.stderr || result.stdout || ''}`.trim() : '';
    throw new Error(`git ${args[0]} failed${detail ? `: ${detail}` : ''}`);
  }

  return options.capture ? result.stdout : '';
}

function gitLines(args, options = {}) {
  return runGit(args, { ...options, capture: true })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function resolveRemoteBranches(sourceRemote) {
  return gitLines(['for-each-ref', '--format=%(refname:strip=3)', `refs/remotes/${sourceRemote}`])
    .filter((branch) => branch !== 'HEAD');
}

function resolveTargetBranches(targetUrl, config) {
  return gitLines(['ls-remote', '--heads', targetUrl], { config })
    .map((line) => line.match(/\srefs\/heads\/(.+)$/)?.[1])
    .filter(Boolean);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceRemote = firstValue(args.source, process.env.GIT_MIRROR_SOURCE_REMOTE, DEFAULT_SOURCE_REMOTE);
  const targetUrl = firstValue(args.target, process.env.GIT_MIRROR_URL, process.env.GITEA_MIRROR_URL, DEFAULT_TARGET_URL);
  const token = firstValue(args.token, process.env.GIT_MIRROR_TOKEN, process.env.GITEA_MIRROR_TOKEN);
  const username = firstValue(args.username, process.env.GIT_MIRROR_USERNAME, process.env.GITEA_MIRROR_USERNAME);
  const dryRun = Boolean(args['dry-run'] || process.env.DRY_RUN);
  const prune = args.prune !== false && process.env.GIT_MIRROR_PRUNE !== 'false';
  const useAuthHeader = Boolean(token && !username);
  const pushUrl = useAuthHeader ? targetUrl : withCredentials(targetUrl, username, token);
  const pushConfig = useAuthHeader ? ['-c', `http.extraHeader=Authorization: token ${token}`] : [];

  if (!targetUrl) throw new Error('Missing mirror target URL. Set GITEA_MIRROR_URL or pass --target.');
  mask(token);
  mask(pushUrl);
  if (useAuthHeader) mask(`Authorization: token ${token}`);

  console.log(`Mirror source: ${sourceRemote}`);
  console.log(`Mirror target: ${sanitizeUrl(pushUrl)}`);
  console.log(`Mirror mode:   ${dryRun ? 'dry-run' : 'push'}${prune ? ', prune' : ''}`);

  runGit(['fetch', '--prune', sourceRemote, `+refs/heads/*:refs/remotes/${sourceRemote}/*`, '+refs/tags/*:refs/tags/*']);

  const branches = resolveRemoteBranches(sourceRemote);
  if (!branches.length) throw new Error(`No branches found under refs/remotes/${sourceRemote}.`);

  const branchRefspecs = branches.map((branch) => `+refs/remotes/${sourceRemote}/${branch}:refs/heads/${branch}`);
  const deleteBranchRefspecs = prune
    ? resolveTargetBranches(pushUrl, pushConfig)
      .filter((branch) => !branches.includes(branch))
      .map((branch) => `:refs/heads/${branch}`)
    : [];
  const pushArgs = ['push'];
  if (dryRun) pushArgs.push('--dry-run');
  if (prune) pushArgs.push('--prune');
  pushArgs.push(pushUrl, ...branchRefspecs, ...deleteBranchRefspecs, '+refs/tags/*:refs/tags/*');

  runGit(pushArgs, { config: pushConfig });
  console.log(`Mirrored ${branches.length} branch(es) and all tags.`);
  if (deleteBranchRefspecs.length) {
    console.log(`Pruned ${deleteBranchRefspecs.length} target-only branch(es).`);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
