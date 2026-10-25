import { app, BrowserWindow, powerSaveBlocker, protocol, net } from 'electron';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST = path.join(__dirname, 'dist');

// Las pruebas usan un perfil propio para no tocar la biblioteca guardada del usuario.
if (process.env.UCSE_USER_DATA) app.setPath('userData', process.env.UCSE_USER_DATA);

const MAX_RECARGAS = 3; // si la página se cae más veces seguidas, se deja el error a la vista

// La app se sirve desde app://ucse/ en vez de file:// para poder mandar los encabezados COOP/COEP:
// con la página "aislada" el navegador habilita SharedArrayBuffer y la segmentación usa varios núcleos.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const TIPOS = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
};

// Ollama (el LLM local que escribe descripciones) se pide como app://ucse/ollama/...: al ser el mismo origen no
// choca con COOP/COEP ni depende de que Ollama acepte el origen app://.
const OLLAMA = process.env.UCSE_OLLAMA ?? 'http://127.0.0.1:11434';

async function servir(pedido) {
  const { pathname } = new URL(pedido.url);
  if (pathname.startsWith('/ollama/')) {
    try {
      const r = await net.fetch(OLLAMA + pathname.slice('/ollama'.length), { method: pedido.method, headers: { 'Content-Type': 'application/json' }, body: pedido.method === 'POST' ? await pedido.text() : undefined });
      return new Response(r.body, { status: r.status, headers: { 'Content-Type': 'application/json', 'Cross-Origin-Resource-Policy': 'same-origin' } });
    } catch {
      return new Response('Ollama no responde', { status: 502 });
    }
  }
  const ruta =path.normalize(path.join(DIST, decodeURIComponent(new URL(pedido.url).pathname)));
  if (!ruta.startsWith(DIST + path.sep)) return new Response('Prohibido', { status: 403 }); // nada fuera de dist/
  try {
    const r = await net.fetch(pathToFileURL(ruta).toString());
    const h = new Headers(r.headers);
    h.set('Content-Type', TIPOS[path.extname(ruta).toLowerCase()] ?? 'application/octet-stream');
    h.set('Cross-Origin-Opener-Policy', 'same-origin');
    h.set('Cross-Origin-Embedder-Policy', 'require-corp');
    h.set('Cross-Origin-Resource-Policy', 'same-origin');
    return new Response(r.body, { status: r.status, headers: h });
  } catch {
    return new Response('No encontrado', { status: 404 });
  }
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'UCSE Vision',
    icon: path.join(DIST, 'favicon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Sin esto, si otra ventana tapa la app Chromium la baja a ~1 cuadro por segundo (la cámara "se congela").
      backgroundThrottling: false,
    }
  });

  // Habilitar permisos de cámara automáticamente sin prompt emergente
  mainWindow.webContents.session.setPermissionCheckHandler(() => true);
  mainWindow.webContents.session.setDevicePermissionHandler(() => true);
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, _permiso, responder) => responder(true));

  const cargar = () => {
    if (process.env.NODE_ENV === 'development') return mainWindow.loadURL('http://localhost:5173');
    const q = new URLSearchParams();
    if (process.env.UCSE_TEST) q.set('test', '1');
    if (process.env.UCSE_SAM) q.set('sam', process.env.UCSE_SAM);
    return mainWindow.loadURL(`app://ucse/index.html${q.size ? `?${q}` : ''}`);
  };

  // Si el proceso de la página se cae (memoria, GPU, etc.), se recarga solo en vez de quedar en blanco.
  let recargas = 0;
  mainWindow.webContents.on('render-process-gone', (_e, detalles) => {
    console.error('La página se cerró:', detalles.reason);
    if (detalles.reason === 'clean-exit' || recargas >= MAX_RECARGAS) return;
    recargas++;
    setTimeout(cargar, 1000);
  });
  mainWindow.webContents.on('did-finish-load', () => setTimeout(() => (recargas = 0), 60000));
  cargar();
  mainWindow.setMenuBarVisibility(false);

  // Que la pantalla no se apague ni se suspenda en medio de una demostración.
  const bloqueo = powerSaveBlocker.start('prevent-display-sleep');
  mainWindow.on('closed', () => powerSaveBlocker.stop(bloqueo));
}

app.whenReady().then(() => {
  protocol.handle('app', servir);
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
