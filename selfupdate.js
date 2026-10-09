// selfupdate.js — KFF selfupdate.py + MyCap stageMacUpdate/applyMacUpdate의 Electron판.
// 실행 중인 앱은 자신을 덮어쓸 수 없으므로, 도우미 스크립트를 만들어
// 앱 종료 후 교체한다. macOS는 .app 번들 단위, Win portable은 단일 exe 단위다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const DOWNLOAD_TIMEOUT_MS = 120000;

function stagingDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'CatTimer-update-'));
}

function cleanup(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

// --- 다운로드·검증 (KFF download_update/verify_sha256) ---
async function downloadFile(url, destPath, onProgress) {
  const dir = path.dirname(destPath);
  if (dir) fs.mkdirSync(dir, { recursive: true });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/octet-stream', 'User-Agent': 'CatTimer-updater' },
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) throw new Error(`다운로드 실패 (HTTP ${res.status})`);
    const total = Number(res.headers.get('content-length')) || 0;
    let received = 0;
    const file = fs.createWriteStream(destPath);
    try {
      for await (const chunk of res.body) {
        file.write(chunk);
        received += chunk.length;
        if (onProgress && total > 0) onProgress(received, total);
      }
    } finally {
      await new Promise((resolve) => file.end(resolve));
    }
    return destPath;
  } finally {
    clearTimeout(t);
  }
}

function parseChecksum(text) {
  if (!text) return '';
  const tok = text.trim().split(/\s+/)[0];
  return tok || '';
}

function verifySha256(filePath, expectedHex) {
  if (!expectedHex) return false;
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(65536);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex').toLowerCase() === String(expectedHex).trim().toLowerCase();
}

// --- macOS (.app 번들) — KFF extract_mac_app/write_mac_update_script 그대로 ---
function currentMacApp(exePath) {
  const target = path.resolve(exePath, '../../..');
  return target.endsWith('.app') && fs.existsSync(target) ? target : null;
}

async function extractMacApp(zipPath, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  // Python zipfile은 심링크를 풀어 서명을 깨뜨리므로 ditto 필수 (KFF와 동일 이유)
  const r = await execFileAsync('/usr/bin/ditto', ['-x', '-k', zipPath, outDir], { timeout: 300000 }).catch((e) => e);
  if (r && r.code) throw new Error(`압축 해제 실패: ${zipPath}`);
  const found = [];
  const walk = (d) => {
    for (const name of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, name.name);
      if (name.isDirectory()) {
        if (name.name.endsWith('.app')) found.push(p);
        else walk(p);
      }
    }
  };
  walk(outDir);
  if (!found.length) throw new Error(`업데이트 압축본에 .app 없음: ${zipPath}`);
  found.sort((a, b) => a.split(path.sep).length - b.split(path.sep).length);
  return found[0];
}

function writeMacUpdateScript(scriptPath, pid, currentApp, newApp, cleanupPaths = []) {
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const cleanLines = cleanupPaths.map((p) => `rm -rf ${q(p)} 2>/dev/null`).join('\n');
  const logPath = `${scriptPath}.log`;
  const lines = [
    '#!/bin/bash',
    `KFF_PID=${Number(pid)}`,
    `KFF_CURRENT=${q(currentApp)}`,
    `KFF_NEW=${q(newApp)}`,
    `KFF_LOG=${q(logPath)}`,
    '',
    'echo "$(date) self-update start pid=$KFF_PID" > "$KFF_LOG"',
    'KFF_TRIES=0',
    'while kill -0 "$KFF_PID" 2>/dev/null; do',
    '  KFF_TRIES=$((KFF_TRIES + 1))',
    '  if [ "$KFF_TRIES" -ge 900 ]; then echo "$(date) wait cap reached, abort" >> "$KFF_LOG"; rm -f "$0"; exit 1; fi',
    '  sleep 0.2',
    'done',
    'sleep 0.5',
    'echo "$(date) swap start" >> "$KFF_LOG"',
    'KFF_BAK="${KFF_CURRENT}.bak"',
    'rm -rf "$KFF_BAK"',
    'mv "$KFF_CURRENT" "$KFF_BAK" || { echo "move-aside failed" >> "$KFF_LOG"; open "$KFF_CURRENT"; exit 1; }',
    'mv "$KFF_NEW" "$KFF_CURRENT" || { echo "move-in failed, restoring" >> "$KFF_LOG"; mv "$KFF_BAK" "$KFF_CURRENT"; open "$KFF_CURRENT"; exit 1; }',
    'xattr -dr com.apple.quarantine "$KFF_CURRENT" 2>/dev/null || true',
    'open "$KFF_CURRENT"',
    'rm -rf "$KFF_BAK"',
    cleanLines,
    'echo "$(date) done" >> "$KFF_LOG"',
    'rm -f "$0"',
  ].filter((l) => l !== '');
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.writeFileSync(scriptPath, lines.join('\n') + '\n', 'utf8');
  fs.chmodSync(scriptPath, 0o755);
  return scriptPath;
}

// --- Win portable (단일 exe) — KFF write_update_batch의 최소판 ---
function writeWinUpdateBatch(batchPath, pid, imageName, currentExe, newExe, cleanupPaths = []) {
  const cleanLines = cleanupPaths.map((p) => (fs.existsSync(p) && fs.statSync(p).isDirectory()
    ? `rmdir /s /q "${p}" 2>nul`
    : `del /f /q "${p}" 2>nul`)).join('\r\n');
  const lines = [
    '@echo off',
    'chcp 65001 >nul',
    'cd /d "%TEMP%"',
    'setlocal',
    `set "KFF_PID=${Number(pid)}"`,
    `set "KFF_IMAGE=${imageName}"`,
    `set "KFF_CURRENT=${currentExe}"`,
    `set "KFF_NEW=${newExe}"`,
    'set "KFF_TRIES=0"',
    ':waitloop',
    'tasklist /FI "PID eq %KFF_PID%" /FI "IMAGENAME eq %KFF_IMAGE%" 2>nul | find "%KFF_PID%" >nul 2>&1',
    'if errorlevel 1 goto swap',
    'set /a KFF_TRIES+=1',
    'if %KFF_TRIES% GEQ 180 goto swap',
    'ping -n 2 127.0.0.1 >nul',
    'goto waitloop',
    ':swap',
    'ping -n 2 127.0.0.1 >nul',
    'move /y "%KFF_NEW%" "%KFF_CURRENT%" >nul 2>&1',
    'if not exist "%KFF_CURRENT%" exit /b 1',
    `start "" "%KFF_CURRENT%"`,
    cleanLines,
    'del "%~f0"',
    'exit /b 0',
  ];
  fs.mkdirSync(path.dirname(batchPath), { recursive: true });
  fs.writeFileSync(batchPath, lines.join('\r\n') + '\r\n', 'utf8');
  return batchPath;
}

module.exports = {
  stagingDir, cleanup,
  downloadFile, parseChecksum, verifySha256,
  currentMacApp, extractMacApp, writeMacUpdateScript,
  writeWinUpdateBatch,
  spawnDetached: (cmd, args) => spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref(),
};
