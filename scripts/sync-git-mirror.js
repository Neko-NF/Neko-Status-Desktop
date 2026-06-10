const { spawnSync } = require('child_process');

const DEFAULT_SOURCE_REMOTE = 'origin';
const DEFAULT_TARGET_URL = 'https://git.koirin.com:39520/NF/Neko.git';
const TARGET_REF_NAMESPACE = 'refs/neko-sync-target';

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

function sanitizeUrl(rawUrl) {
  return String(rawUrl || '').replace(/:\/\/([^/@:]+):([^/@]+)@/, '://$1:***@');
}

function gitAuthEnv(token) {
  if (!token) return {};
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.extraHeader',
    GIT_CONFIG_VALUE_0: `Authorization: token ${token}`,
  };
}

function runGit(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...options.env,
      GIT_TERMINAL_PROMPT: '0',
    },
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });

  if (result.status !== 0) {
    const detail = options.capture ? `${result.stderr || result.stdout || ''}`.trim() : '';
    throw new Error(`git ${args[0]} failed${detail ? `: ${detail}` : ''}`);
  }

  return options.capture ? result.stdout : '';
}

function tryGit(args, options = {}) {
  return spawnSync('git', args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...options.env,
      GIT_TERMINAL_PROMPT: '0',
    },
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'ignore',
  });
}

function gitLines(args, options = {}) {
  return runGit(args, { ...options, capture: true })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function refMapFromForEach(refRoot, stripPrefix) {
  const refs = new Map();
  for (const line of gitLines(['for-each-ref', '--format=%(objectname) %(refname)', refRoot])) {
    const match = line.match(/^([0-9a-f]{40})\s+(.+)$/i);
    if (!match) continue;
    const [, hash, refName] = match;
    const shortName = refName.startsWith(stripPrefix) ? refName.slice(stripPrefix.length) : refName;
    if (!shortName || shortName === 'HEAD') continue;
    refs.set(shortName, hash);
  }
  return refs;
}

function parseLsRemote(output) {
  const heads = new Map();
  const tags = new Map();

  for (const line of output.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    const match = line.match(/^([0-9a-f]{40})\s+refs\/(heads|tags)\/(.+)$/i);
    if (!match) continue;
    const [, hash, type, name] = match;
    if (name.endsWith('^{}')) continue;
    (type === 'heads' ? heads : tags).set(name, hash);
  }

  return { heads, tags };
}

function isAncestor(ancestor, descendant) {
  return tryGit(['merge-base', '--is-ancestor', ancestor, descendant]).status === 0;
}

function pushRefspecs({ targetUrl, authEnv, dryRun, refspecs }) {
  if (!refspecs.length) return;
  const pushArgs = ['push'];
  if (dryRun) pushArgs.push('--dry-run');
  pushArgs.push(targetUrl, ...refspecs);
  runGit(pushArgs, { env: authEnv });
}

function logList(title, items) {
  if (!items.length) return;
  console.log(`${title}:`);
  for (const item of items) console.log(`- ${item}`);
}

function buildSmartPlan({ sourceRemote, targetUrl, authEnv }) {
  runGit(['fetch', '--prune', sourceRemote, `+refs/heads/*:refs/remotes/${sourceRemote}/*`, '+refs/tags/*:refs/tags/*']);
  runGit(['fetch', '--prune', '--no-tags', targetUrl, `+refs/heads/*:${TARGET_REF_NAMESPACE}/heads/*`], { env: authEnv });

  const sourceRemoteRefs = parseLsRemote(runGit(['ls-remote', '--heads', '--tags', sourceRemote], { capture: true }));
  const targetRemote = parseLsRemote(runGit(['ls-remote', '--heads', '--tags', targetUrl], { env: authEnv, capture: true }));
  const sourceBranches = refMapFromForEach(`refs/remotes/${sourceRemote}`, `refs/remotes/${sourceRemote}/`);
  const sourceTags = sourceRemoteRefs.tags;
  const targetBranches = refMapFromForEach(`${TARGET_REF_NAMESPACE}/heads`, `${TARGET_REF_NAMESPACE}/heads/`);
  const targetTags = targetRemote.tags;

  const branchRefspecs = [];
  const tagRefspecs = [];
  const skipped = [];
  const conflicts = [];

  for (const [branch, sourceHash] of sourceBranches) {
    const targetHash = targetBranches.get(branch);
    if (!targetHash) {
      branchRefspecs.push(`refs/remotes/${sourceRemote}/${branch}:refs/heads/${branch}`);
      continue;
    }

    if (targetHash === sourceHash) continue;
    if (isAncestor(targetHash, sourceHash)) {
      branchRefspecs.push(`refs/remotes/${sourceRemote}/${branch}:refs/heads/${branch}`);
    } else if (isAncestor(sourceHash, targetHash)) {
      skipped.push(`branch ${branch}: target is ahead of source (${targetHash.slice(0, 7)} > ${sourceHash.slice(0, 7)})`);
    } else {
      conflicts.push(`branch ${branch}: diverged (${sourceHash.slice(0, 7)} vs ${targetHash.slice(0, 7)})`);
    }
  }

  for (const [tag, sourceHash] of sourceTags) {
    const targetHash = targetTags.get(tag);
    if (!targetHash) {
      tagRefspecs.push(`refs/tags/${tag}:refs/tags/${tag}`);
    } else if (targetHash !== sourceHash) {
      conflicts.push(`tag ${tag}: differs (${sourceHash.slice(0, 7)} vs ${targetHash.slice(0, 7)})`);
    }
  }

  const targetOnlyBranches = [...targetRemote.heads.keys()].filter((branch) => !sourceBranches.has(branch));
  const targetOnlyTags = [...targetTags.keys()].filter((tag) => !sourceTags.has(tag));

  return {
    branchRefspecs,
    tagRefspecs,
    skipped,
    conflicts,
    targetOnlyBranches,
    targetOnlyTags,
  };
}

function runSmartSync({ sourceRemote, targetUrl, authEnv, dryRun }) {
  const plan = buildSmartPlan({ sourceRemote, targetUrl, authEnv });

  logList('Skipped because target has newer history', plan.skipped);
  logList('Preserved target-only branches', plan.targetOnlyBranches);
  logList('Preserved target-only tags', plan.targetOnlyTags);

  if (plan.conflicts.length) {
    logList('Sync conflicts that need manual review', plan.conflicts);
    throw new Error('Smart sync stopped because one or more refs diverged.');
  }

  pushRefspecs({ targetUrl, authEnv, dryRun, refspecs: plan.branchRefspecs });
  pushRefspecs({ targetUrl, authEnv, dryRun, refspecs: plan.tagRefspecs });

  console.log(`Smart sync complete: ${plan.branchRefspecs.length} branch update(s), ${plan.tagRefspecs.length} new tag(s).`);
}

function runMirrorSync({ sourceRemote, targetUrl, authEnv, dryRun }) {
  runGit(['fetch', '--prune', sourceRemote, `+refs/heads/*:refs/remotes/${sourceRemote}/*`, '+refs/tags/*:refs/tags/*']);

  const sourceBranches = [...refMapFromForEach(`refs/remotes/${sourceRemote}`, `refs/remotes/${sourceRemote}/`).keys()];
  if (!sourceBranches.length) throw new Error(`No branches found under refs/remotes/${sourceRemote}.`);

  const targetRemote = parseLsRemote(runGit(['ls-remote', '--heads', targetUrl], { env: authEnv, capture: true }));
  const branchRefspecs = sourceBranches.map((branch) => `+refs/remotes/${sourceRemote}/${branch}:refs/heads/${branch}`);
  const deleteBranchRefspecs = [...targetRemote.heads.keys()]
    .filter((branch) => !sourceBranches.includes(branch))
    .map((branch) => `:refs/heads/${branch}`);
  const refspecs = [...branchRefspecs, ...deleteBranchRefspecs, '+refs/tags/*:refs/tags/*'];

  const pushArgs = ['push'];
  if (dryRun) pushArgs.push('--dry-run');
  pushArgs.push('--prune', targetUrl, ...refspecs);
  runGit(pushArgs, { env: authEnv });
  console.log(`Mirror sync complete: forced ${sourceBranches.length} branch(es) and all tags.`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceRemote = firstValue(args.source, process.env.GIT_SYNC_SOURCE_REMOTE, process.env.GIT_MIRROR_SOURCE_REMOTE, DEFAULT_SOURCE_REMOTE);
  const targetUrl = firstValue(args.target, process.env.GIT_SYNC_URL, process.env.GIT_MIRROR_URL, process.env.GITEA_MIRROR_URL, DEFAULT_TARGET_URL);
  const token = firstValue(args.token, process.env.GIT_SYNC_TOKEN, process.env.GIT_MIRROR_TOKEN, process.env.GITEA_MIRROR_TOKEN);
  const dryRun = Boolean(args['dry-run'] || process.env.DRY_RUN);
  const mode = String(firstValue(args.mode, process.env.GIT_SYNC_MODE, 'smart')).toLowerCase();
  const authEnv = gitAuthEnv(token);

  if (!targetUrl) throw new Error('Missing sync target URL. Set GITEA_MIRROR_URL or pass --target.');
  mask(token);
  if (token) mask(`Authorization: token ${token}`);

  console.log(`Sync source: ${sourceRemote}`);
  console.log(`Sync target: ${sanitizeUrl(targetUrl)}`);
  console.log(`Sync mode:   ${mode}${dryRun ? ' dry-run' : ''}`);

  if (mode === 'mirror' || args.force) {
    runMirrorSync({ sourceRemote, targetUrl, authEnv, dryRun });
    return;
  }

  if (mode !== 'smart') throw new Error(`Unsupported sync mode: ${mode}`);
  runSmartSync({ sourceRemote, targetUrl, authEnv, dryRun });
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
