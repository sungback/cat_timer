const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');

// 개발: 프로젝트의 photos/. 패키징: CatTimer.app/Contents/Resources/photos/
const dev = path.join(__dirname, 'photos');
const dir = fs.existsSync(dev) ? dev : path.join(process.resourcesPath, 'photos');
contextBridge.exposeInMainWorld('photoList', fs.existsSync(dir)
  ? fs.readdirSync(dir).filter(f => /\.(jpe?g|png|gif|webp)$/i.test(f)).sort().map(f => pathToFileURL(path.join(dir, f)).href)
  : []);

// 자동 업데이트 브릿지 (KFF updater + selfupdate를 main.js가 수행, 여긴 통로만)
contextBridge.exposeInMainWorld('updateAPI', {
  getInfo: () => ipcRenderer.invoke('update:getInfo'),
  check: (isManual = true) => ipcRenderer.invoke('update:check', isManual),
  startDownload: () => ipcRenderer.invoke('update:startDownload'),
  restart: () => ipcRenderer.invoke('update:restart'),
  openDownloadPage: () => ipcRenderer.invoke('update:openDownloadPage'),
  onStatus: (cb) => ipcRenderer.on('update:status', (_e, s) => cb(s)),
});
