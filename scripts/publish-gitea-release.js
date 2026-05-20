const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

const DEFAULT_BASE_URL = 'https://git.koirin.com:39520';
const DEFAULT_OWNER = 'NF';
const DEFAULT_REPO = 'Neko';

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

function trimSlash(value) {
  return String(value || '').replace(/\/+$/g, '');
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readPackageVersion() {
  const pkg = readJson(path.join(process.cwd(), 'package.json'));
  if (!pkg?.version) throw new Error('Cannot read version from package.json.');
  return pkg.version;
}

function resolveToken(args) {
  return args.token
    || process.env.GITEA_TOKEN
    || process.env.PERSONAL_UPDATE_TOKEN;
}

function readReleaseNotes(args) {
  const notesPath = args.notes || process.env.RELEASE_NOTES_FILE || 'release_notes.txt';
  if (!fs.existsSync(notesPath)) return '';
  return fs.readFileSync(notesPath, 'utf8').trimEnd();
}

function expandVersionPlaceholders(value, version) {
  return String(value || '')
    .replace(/\$\{VERSION\}/g, version)
    .replace(/\$VERSION/g, version)
    .replace(/\{version\}/g, version);
}

function resolveFiles(version, args) {
  const fromArgs = args.files || process.env.GITEA_RELEASE_FILES;
  const files = fromArgs
    ? fromArgs.split(',').map((item) => expandVersionPlaceholders(item.trim(), version)).filter(Boolean)
    : [
      `dist/NekoStatus-Setup-${version}.exe`,
      `dist/NekoStatus-${version}-win.zip`,
      'dist/SHA256SUMS.txt',
    ];

  return files.map((file) => path.resolve(process.cwd(), file));
}

function assertFilesExist(files) {
  const missing = files.filter((file) => !fs.existsSync(file));
  if (missing.length) {
    throw new Error(`Missing release asset(s):\n${missing.map((file) => `- ${file}`).join('\n')}`);
  }
}

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function ensureSha256Sums(files) {
  const sumsPath = files.find((file) => path.basename(file).toLowerCase() === 'sha256sums.txt');
  if (!sumsPath || fs.existsSync(sumsPath)) return;

  const assetFiles = files.filter((file) => /\.(exe|zip|7z)$/i.test(file) && fs.existsSync(file));
  if (!assetFiles.length) return;

  const content = assetFiles
    .map((file) => `${sha256(file)}  ${path.basename(file)}`)
    .join('\n');
  fs.writeFileSync(sumsPath, `${content}\n`, 'utf8');
  console.log(`Generated: ${path.relative(process.cwd(), sumsPath)}`);
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const message = body?.message || body?.errors?.[0]?.message || text || res.statusText;
    const error = new Error(`HTTP ${res.status}: ${message}`);
    error.status = res.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function requestText(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  return text;
}

function authHeaders(token, extra = {}) {
  return {
    Authorization: `token ${token}`,
    ...extra,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'unknown size';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function parseUploadTimeout() {
  const timeout = Number.parseInt(process.env.GITEA_UPLOAD_TIMEOUT_MS || '900000', 10);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : 900000;
}

function escapeMultipartValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function findRelease(baseUrl, owner, repo, tag, token) {
  const url = `${baseUrl}/api/v1/repos/${owner}/${repo}/releases?limit=50`;
  const releases = await requestJson(url, { headers: authHeaders(token) });
  return Array.isArray(releases) ? releases.find((release) => release.tag_name === tag) : null;
}

async function createOrUpdateRelease({ baseUrl, owner, repo, token, tag, notes, prerelease }) {
  const releasesUrl = `${baseUrl}/api/v1/repos/${owner}/${repo}/releases`;
  const payload = {
    tag_name: tag,
    target_commitish: 'main',
    name: `Neko Status ${tag}`,
    body: notes || `Neko Status ${tag}`,
    draft: false,
    prerelease,
  };

  try {
    return await requestJson(releasesUrl, {
      method: 'POST',
      headers: authHeaders(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (error.status !== 409 && error.status !== 422) throw error;
    const existing = await findRelease(baseUrl, owner, repo, tag, token);
    if (!existing) throw error;
    return await requestJson(`${releasesUrl}/${existing.id}`, {
      method: 'PATCH',
      headers: authHeaders(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
  }
}

async function deleteExistingAsset(baseUrl, owner, repo, release, fileName, token) {
  const asset = Array.isArray(release.assets)
    ? release.assets.find((item) => item.name === fileName)
    : null;
  if (!asset) return;
  await requestText(`${baseUrl}/api/v1/repos/${owner}/${repo}/releases/${release.id}/assets/${asset.id}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
}

async function uploadMultipartFile(url, filePath, fileName, token) {
  const boundary = `----neko-status-${crypto.randomBytes(12).toString('hex')}`;
  const fileSize = fs.statSync(filePath).size;
  const header = Buffer.from([
    `--${boundary}`,
    `Content-Disposition: form-data; name="attachment"; filename="${escapeMultipartValue(fileName)}"`,
    'Content-Type: application/octet-stream',
    '',
    '',
  ].join('\r\n'));
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const target = new URL(url);
  const transport = target.protocol === 'http:' ? http : https;
  const timeoutMs = parseUploadTimeout();

  return await new Promise((resolve, reject) => {
    const req = transport.request(target, {
      method: 'POST',
      headers: authHeaders(token, {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': header.length + fileSize + footer.length,
      }),
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body = null;
        if (text) {
          try {
            body = JSON.parse(text);
          } catch {
            body = text;
          }
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          const message = body?.message || body?.errors?.[0]?.message || text || res.statusMessage;
          const error = new Error(`HTTP ${res.statusCode}: ${message}`);
          error.status = res.statusCode;
          error.body = body;
          reject(error);
          return;
        }

        resolve(body);
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Upload timed out after ${Math.round(timeoutMs / 1000)}s`));
    });
    req.on('error', reject);
    req.write(header);

    const fileStream = fs.createReadStream(filePath);
    fileStream.on('error', (error) => req.destroy(error));
    fileStream.on('end', () => req.end(footer));
    fileStream.pipe(req, { end: false });
  });
}

async function uploadAsset(baseUrl, owner, repo, release, filePath, token) {
  const fileName = path.basename(filePath);
  await deleteExistingAsset(baseUrl, owner, repo, release, fileName, token);

  return await uploadMultipartFile(
    `${baseUrl}/api/v1/repos/${owner}/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(fileName)}`,
    filePath,
    fileName,
    token
  );
}

async function findUploadedAsset(baseUrl, owner, repo, tag, token, filePath) {
  const latestRelease = await findRelease(baseUrl, owner, repo, tag, token);
  const fileName = path.basename(filePath);
  return latestRelease?.assets?.find((asset) => (
    asset.name === fileName
    && (!asset.size || asset.size === fs.statSync(filePath).size)
  ));
}

async function uploadAssetWithRetry(baseUrl, owner, repo, tag, release, filePath, token) {
  const fileName = path.basename(filePath);
  const size = fs.statSync(filePath).size;
  const retries = Number.parseInt(process.env.GITEA_UPLOAD_RETRIES || '2', 10);
  const maxAttempts = Math.max(1, retries + 1);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      console.log(`Uploading: ${fileName} (${formatBytes(size)}), attempt ${attempt}/${maxAttempts}`);
      return await uploadAsset(baseUrl, owner, repo, release, filePath, token);
    } catch (error) {
      const uploaded = await findUploadedAsset(baseUrl, owner, repo, tag, token, filePath).catch(() => null);
      if (uploaded) {
        console.log(`Upload confirmed after interrupted response: ${fileName}`);
        return uploaded;
      }

      if (attempt >= maxAttempts) {
        throw new Error(`Upload failed for ${fileName}: ${error.message}`);
      }

      const delayMs = 5000 * attempt;
      console.warn(`Upload failed for ${fileName}: ${error.message}. Retrying in ${delayMs / 1000}s...`);
      await sleep(delayMs);
    }
  }

  throw new Error(`Upload failed for ${fileName}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const version = args.version || process.env.VERSION || readPackageVersion();
  const tag = args.tag || process.env.RELEASE_TAG || `v${version}`;
  const baseUrl = trimSlash(args.baseUrl || process.env.GITEA_BASE_URL || DEFAULT_BASE_URL);
  const owner = args.owner || process.env.GITEA_OWNER || DEFAULT_OWNER;
  const repo = args.repo || process.env.GITEA_REPO || DEFAULT_REPO;
  const token = resolveToken(args);
  const notes = readReleaseNotes(args);
  const prerelease = /-(beta|nightly)\./i.test(tag);
  const files = resolveFiles(version, args);
  const dryRun = Boolean(args['dry-run'] || process.env.DRY_RUN);

  ensureSha256Sums(files);
  assertFilesExist(files);

  console.log(`Gitea target: ${baseUrl}/${owner}/${repo}`);
  console.log(`Release tag:  ${tag}`);
  console.log('Assets:');
  files.forEach((file) => console.log(`- ${path.relative(process.cwd(), file)}`));

  if (dryRun) {
    console.log('Dry run complete. No release was created or modified.');
    return;
  }

  if (!token) {
    throw new Error('Missing Gitea token. Set GITEA_TOKEN in CI secrets or the local shell environment.');
  }

  let release = await createOrUpdateRelease({ baseUrl, owner, repo, token, tag, notes, prerelease });
  console.log(`Release ready: ${release.html_url || `${baseUrl}/${owner}/${repo}/releases/tag/${tag}`}`);

  for (const file of files) {
    release = await findRelease(baseUrl, owner, repo, tag, token) || release;
    const asset = await uploadAssetWithRetry(baseUrl, owner, repo, tag, release, file, token);
    console.log(`Uploaded: ${asset.name || path.basename(file)}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
