const FORBIDDEN = [
  'password', 'passwd', 'cookie', 'authorization', 'token', 'devicekey', 'streamkey',
  'updatekey', 'githubkey', 'secret', 'verification', 'screenshot', 'image', 'avatar',
  'clipboard', 'filecontent', 'email', 'accountprofile', 'userdata',
];

function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function redactString(value) {
  return String(value)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, '[REDACTED_AUTHORIZATION]')
    .replace(/\b(?:device[_-]?key|access[_-]?token|refresh[_-]?token|stream[_-]?key|update[_-]?key|github[_-]?token|authorization|cookie)\s*[=:]\s*["']?[^\s,"'&]+/gi, '[REDACTED_NAMED_SECRET]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_TOKEN]')
    .slice(0, 64 * 1024);
}

function redactDiagnostics(value, depth = 0) {
  if (depth > 24) return '[TRUNCATED_DEPTH]';
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 1000).map((item) => redactDiagnostics(item, depth + 1));
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    const normalized = normalizeKey(key);
    output[key] = FORBIDDEN.some((part) => normalized.includes(part))
      ? '[REDACTED]'
      : redactDiagnostics(child, depth + 1);
  }
  return output;
}

module.exports = { redactDiagnostics };
