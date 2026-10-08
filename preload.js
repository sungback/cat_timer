const { contextBridge } = require('electron');
const fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');

// 개발: 프로젝트의 photos/. 패키징: CatTimer.app/Contents/Resources/photos/
const dev = path.join(__dirname, 'photos');
const dir = fs.existsSync(dev) ? dev : path.join(process.resourcesPath, 'photos');
contextBridge.exposeInMainWorld('photoList', fs.existsSync(dir)
  ? fs.readdirSync(dir).filter(f => /\.(jpe?g|png|gif|webp)$/i.test(f)).sort().map(f => pathToFileURL(path.join(dir, f)).href)
  : []);
