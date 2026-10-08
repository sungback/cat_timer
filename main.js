const { app, BrowserWindow } = require('electron');

app.whenReady().then(() => {
  const w = new BrowserWindow({
    width: 1280, height: 720, backgroundColor: '#000',
    webPreferences: { preload: __dirname + '/preload.js', sandbox: false }, // preload에서 fs 사용
  });
  w.setMenuBarVisibility(false);
  w.loadFile('index.html');
});

app.on('window-all-closed', () => app.quit());
