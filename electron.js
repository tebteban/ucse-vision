const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'UCSE VISION — Arcade IA',
    icon: path.join(__dirname, 'public', 'favicon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false // Permite acceso a cámara y WASM local sin restricciones CORS
    }
  });

  // Habilitar permisos de cámara automáticamente sin prompt emergente
  mainWindow.webContents.session.setPermissionCheckHandler(() => true);
  mainWindow.webContents.session.setDevicePermissionHandler(() => true);

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
