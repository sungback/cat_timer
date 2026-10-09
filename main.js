const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const updater = require('./updater');
const selfupdate = require('./selfupdate');

let mainWindow = null;
let isQuitting = false;

// 대기 중인 업데이트 정보 (확인 후 다운로드 전)
let pending = null; // { tag, version, html_url, assetUrl, shaUrl }
let staged = null; // { kind: 'mac-app'|'win-exe', dir, target, script }

function sendStatus(status) {
  try { mainWindow?.webContents.send('update:status', status); } catch {}
}

function assetNameForPlatform() {
  if (process.platform === 'darwin') return updater.MAC_ZIP;
  if (process.platform === 'win32') return updater.WIN_EXE;
  return null;
}

async function checkForUpdates(isManual = false) {
  if (!app.isPackaged) {
    if (isManual) sendStatus({ state: 'up-to-date', version: app.getVersion(), message: '개발 모드에서는 확인을 건너뜁니다.' });
    return;
  }
  const assetName = assetNameForPlatform();
  if (!assetName) {
    if (isManual) sendStatus({ state: 'error', message: '이 플랫폼은 자동 업데이트를 지원하지 않습니다.' });
    return;
  }
  if (!isManual) sendStatus({ state: 'checking' });
  else sendStatus({ state: 'checking' });

  const latest = await updater.fetchLatest();
  if (!latest) {
    // 오프라인·API 실패는 조용히 스킵 (수동일 때만 알림)
    sendStatus(isManual
      ? { state: 'error', message: '업데이트 확인에 실패했습니다. 네트워크 후 다시 시도해 주세요.' }
      : { state: 'idle' });
    return;
  }
  const current = app.getVersion();
  const latestVer = latest.tag.replace(/^[vV]/, '');
  if (!updater.isNewer(latest.tag, current)) {
    pending = null;
    sendStatus({ state: 'up-to-date', version: current });
    return;
  }
  // 건너뛰기한 버전이면 조용히 유지 (renderer가 localStorage로 1차 필터, 여긴念のため)
  const directUrl = updater.findAssetDownloadUrl(latest, assetName) || updater.assetUrl(latest.tag, assetName);
  pending = {
    tag: latest.tag, version: latestVer,
    html_url: latest.html_url || `https://github.com/${updater.REPO}/releases/latest`,
    assetUrl: directUrl,
    shaUrl: `${directUrl}.sha256`,
  };
  sendStatus({ state: 'available', version: latestVer });
}

async function startDownload() {
  if (!pending) throw new Error('다운로드할 업데이트가 없습니다.');
  if (!app.isPackaged) throw new Error('개발 모드에서는 다운로드하지 않습니다.');
  const dir = selfupdate.stagingDir();
  try {
    if (process.platform === 'darwin') {
      sendStatus({ state: 'downloading', percent: 0, version: pending.version });
      const zipPath = path.join(dir, updater.MAC_ZIP);
      await selfupdate.downloadFile(pending.assetUrl, zipPath, (got, total) => {
        sendStatus({ state: 'downloading', percent: Math.min(100, Math.round((got / total) * 100)), version: pending.version });
      });
      const shaText = await updater.fetchText(pending.shaUrl);
      const expected = selfupdate.parseChecksum(shaText || '');
      if (expected && !selfupdate.verifySha256(zipPath, expected)) throw new Error('다운로드 파일 해시가 일치하지 않습니다.');
      const outDir = path.join(dir, 'out');
      const newApp = await selfupdate.extractMacApp(zipPath, outDir);
      const exePath = app.getPath('exe');
      const target = selfupdate.currentMacApp(exePath);
      if (!target) throw new Error('설치된 .app 경로를 찾지 못했습니다.');
      try { fs.accessSync(path.dirname(target), fs.constants.W_OK); }
      catch { throw new Error('NO_WRITE'); }
      const script = selfupdate.writeMacUpdateScript(
        path.join(dir, 'kff_self_update.sh'), process.pid, target, newApp, [zipPath],
      );
      staged = { kind: 'mac-app', dir, target, script };
      sendStatus({ state: 'downloaded', version: pending.version });
      return;
    }
    if (process.platform === 'win32') {
      sendStatus({ state: 'downloading', percent: 0, version: pending.version });
      const tmpExe = path.join(dir, updater.WIN_EXE);
      await selfupdate.downloadFile(pending.assetUrl, tmpExe, (got, total) => {
        sendStatus({ state: 'downloading', percent: Math.min(100, Math.round((got / total) * 100)), version: pending.version });
      });
      const shaText = await updater.fetchText(pending.shaUrl);
      const expected = selfupdate.parseChecksum(shaText || '');
      if (expected && !selfupdate.verifySha256(tmpExe, expected)) throw new Error('다운로드 파일 해시가 일치하지 않습니다.');
      staged = { kind: 'win-exe', dir, target: app.getPath('exe'), tmpExe };
      sendStatus({ state: 'downloaded', version: pending.version });
      return;
    }
    throw new Error('이 플랫폼은 자동 업데이트를 지원하지 않습니다.');
  } catch (e) {
    selfupdate.cleanup(dir);
    if (e && e.message === 'NO_WRITE') {
      sendStatus({ state: 'error', message: 'NO_WRITE' });
    } else {
      sendStatus({ state: 'error', message: e.message || '다운로드 중 오류가 발생했습니다.' });
    }
    throw e;
  }
}

function restartToApply() {
  if (!staged) {
    if (pending) shell.openExternal(pending.html_url);
    return;
  }
  if (staged.kind === 'mac-app') {
    selfupdate.spawnDetached('/bin/sh', [staged.script]);
    isQuitting = true;
    app.quit();
    return;
  }
  if (staged.kind === 'win-exe') {
    const image = path.basename(staged.target);
    const bat = path.join(staged.dir, 'kff_self_update.bat');
    selfupdate.writeWinUpdateBatch(bat, process.pid, image, staged.target, staged.tmpExe, []);
    selfupdate.spawnDetached('cmd.exe', ['/c', bat]);
    isQuitting = true;
    app.quit();
    return;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 720, backgroundColor: '#000',
    title: 'CatTimer v' + app.getVersion(),
    webPreferences: { preload: __dirname + '/preload.js', sandbox: false }, // preload에서 fs 사용
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('index.html');
}

ipcMain.handle('update:getInfo', () => ({
  version: app.getVersion(),
  platform: process.platform,
  packaged: app.isPackaged,
  pending: pending ? { version: pending.version } : null,
}));
ipcMain.handle('update:check', (_e, isManual) => checkForUpdates(isManual !== false));
ipcMain.handle('update:startDownload', async () => startDownload());
ipcMain.handle('update:restart', () => restartToApply());
ipcMain.handle('update:openDownloadPage', () => {
  const url = (pending && pending.html_url) || `https://github.com/${updater.REPO}/releases/latest`;
  shell.openExternal(url);
});

app.whenReady().then(() => {
  createWindow();
  // 시작 직후 타이머 UI를 가리지 않게 5초 뒤 조용히 확인
  setTimeout(() => checkForUpdates(false).catch(() => {}), 5000);
});

app.on('before-quit', () => { isQuitting = true; });
app.on('window-all-closed', () => app.quit());
