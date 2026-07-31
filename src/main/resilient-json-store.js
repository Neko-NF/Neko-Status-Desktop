const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function parseJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('config root must be a JSON object');
  }
  return value;
}

function isolateCorruptFile(filePath, suffix) {
  if (!fs.existsSync(filePath)) return null;
  const isolatedPath = `${filePath}.corrupt-${suffix}`;
  fs.renameSync(filePath, isolatedPath);
  return isolatedPath;
}

function atomicWriteJson(filePath, value, { backup = true } = {}) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`,
  );
  const serialized = `${JSON.stringify(value, null, 2)}\n`;

  try {
    fs.writeFileSync(temporaryPath, serialized, { encoding: 'utf8', flag: 'wx' });
    const verified = parseJsonFile(temporaryPath);
    if (JSON.stringify(verified) !== JSON.stringify(value)) {
      throw new Error('temporary config verification failed');
    }
    if (backup && fs.existsSync(filePath)) {
      try {
        parseJsonFile(filePath);
        fs.copyFileSync(filePath, `${filePath}.bak`);
      } catch {
        // A corrupt primary must never replace a known-good backup.
      }
    }
    fs.renameSync(temporaryPath, filePath);
    return true;
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

function readResilientJson(filePath) {
  const backupPath = `${filePath}.bak`;
  const primaryExists = fs.existsSync(filePath);
  const backupExists = fs.existsSync(backupPath);
  try {
    return { value: parseJsonFile(filePath), source: 'primary', warning: null, isolated: [] };
  } catch (primaryError) {
    try {
      const value = parseJsonFile(backupPath);
      atomicWriteJson(filePath, value, { backup: false });
      return {
        value,
        source: 'backup',
        warning: `主配置损坏，已从备份恢复：${primaryError.message}`,
        isolated: [],
      };
    } catch (backupError) {
      if (!primaryExists && !backupExists) {
        return { value: null, source: 'missing', warning: null, isolated: [] };
      }
      const suffix = `${Date.now()}-${process.pid}`;
      const isolated = [];
      try {
        const primary = isolateCorruptFile(filePath, suffix);
        if (primary) isolated.push(primary);
      } catch (error) {
        isolated.push(`隔离主配置失败：${error.message}`);
      }
      try {
        const backup = isolateCorruptFile(backupPath, suffix);
        if (backup) isolated.push(backup);
      } catch (error) {
        isolated.push(`隔离备份失败：${error.message}`);
      }
      return {
        value: null,
        source: 'corrupt',
        warning: `主配置和备份均损坏，已停止自动覆盖。主文件：${primaryError.message}；备份：${backupError.message}`,
        isolated,
      };
    }
  }
}

module.exports = {
  atomicWriteJson,
  parseJsonFile,
  readResilientJson,
};
