// Arma una carpeta portable para Windows sin instalador: release/UCSE-Vision/UCSE Vision.exe
// (el runtime de Electron con la app en resources/app). Alternativa a electron-builder cuando el antivirus
// bloquea su carpeta temporal (error EPERM). Uso: npm run build && node scripts/empaquetar.mjs
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = process.cwd();
const ORIGEN = path.join(RAIZ, 'node_modules/electron/dist');
const DESTINO = path.join(RAIZ, 'release/UCSE-Vision');

if (!fs.existsSync(path.join(RAIZ, 'dist/index.html'))) throw new Error('Falta dist/: corré "npm run build" primero');
fs.rmSync(DESTINO, { recursive: true, force: true });
fs.cpSync(ORIGEN, DESTINO, { recursive: true });
fs.renameSync(path.join(DESTINO, 'electron.exe'), path.join(DESTINO, 'UCSE Vision.exe'));
fs.rmSync(path.join(DESTINO, 'resources/default_app.asar'), { force: true });

const app = path.join(DESTINO, 'resources/app');
fs.mkdirSync(app, { recursive: true });
const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: pkg.name, productName: 'UCSE Vision', version: pkg.version, main: 'electron.js', type: 'module' }, null, 2));
fs.copyFileSync(path.join(RAIZ, 'electron.js'), path.join(app, 'electron.js'));
fs.cpSync(path.join(RAIZ, 'dist'), path.join(app, 'dist'), { recursive: true });

const tam = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? tam(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
console.log(`Listo: ${path.relative(RAIZ, DESTINO)}\\UCSE Vision.exe (${Math.round(tam(DESTINO) / 1e6)} MB). Copiá la carpeta entera al pendrive.`);
