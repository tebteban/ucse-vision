# UCSE Vision

Reconocimiento de objetos con la cámara, pensado como una "Pokédex" universitaria por carreras
(hoy: Informática y Electrónica). Se hace clic sobre un objeto, el sistema lo recorta, lo sigue y muestra
su ficha con una descripción corta y una larga. Se pueden enseñar objetos nuevos en vivo, con unas pocas
muestras de la cámara y sin reentrenar la red. Todo corre local, sin internet.

## Cómo funciona

| Parte | Qué hace | Dónde |
|---|---|---|
| Reconocimiento | CLIP (ViT-B/32 cuantizado) convierte el recorte en un vector y se compara con las muestras de la biblioteca | `src/clip.worker.js`, `src/library.js` |
| Selección por clic | SlimSAM segmenta el objeto bajo el clic; analiza la escena en segundo plano | `src/sam.worker.js`, `src/segmentador.js` |
| Seguimiento | Coincidencia de plantilla sobre cuadros reducidos | `src/seguimiento.js`, `src/seguidor.worker.js` |
| Biblioteca | 43 fichas + 952 muestras base incluidas; lo propio se guarda en la PC y se puede exportar | `src/data/`, `src/library.js` |

Los tres modelos corren en Web Workers, así la interfaz y la cámara nunca se traban. La app de escritorio se sirve
desde `app://` con la página aislada (COOP/COEP): eso permite que la segmentación use varios núcleos de la CPU
en lugar de la GPU, que congelaba el video mientras calculaba.

### Descripciones con IA local (opcional)

En **Enseñar**, al escribir el nombre de un objeto nuevo, un LLM local escribe la descripción corta y la larga
(`src/descripciones.js`); quedan editables antes de guardar. Usa [Ollama](https://ollama.com) si está instalado
y abierto en la PC: elige `qwen2.5:3b` si lo tiene (entra en 4 GB de VRAM), si no otro modelo de texto instalado.
Para tenerlo: `ollama pull qwen2.5:3b`. Sin Ollama, las descripciones se completan a mano como siempre.
La app le habla por `app://ucse/ollama/` (lo reenvía `electron.js`; otra dirección con la variable `UCSE_OLLAMA`).

## Comandos

```bash
npm install
npm run dev            # interfaz en el navegador (http://localhost:5173)
npm run electron:dev   # app de escritorio contra el servidor de desarrollo
npm run build          # compila dist/
npx electron .         # app de escritorio con dist/
node scripts/empaquetar.mjs   # carpeta portable release/UCSE-Vision/ (copiar entera al pendrive)
```

## Pruebas

```bash
npm test                    # unitarias (Vitest)
npm run test:fixtures       # genera los videos de la cámara falsa (una vez)
npm run test:e2e            # funcionales, tolerancia a fallos y estrés sobre la app de escritorio real
npm run test:rendimiento    # fluidez de cámara e interfaz y latencias (3 repeticiones por escenario)
npm run test:informe        # arma docs/resultados-pruebas.md con las últimas corridas
```

Las pruebas E2E abren la app de escritorio con una cámara falsa de Chromium que reproduce videos generados
y un perfil temporal, así nunca tocan la biblioteca real. Resultados de la última corrida: [docs/resultados-pruebas.md](docs/resultados-pruebas.md).

## Regenerar las muestras base

```bash
node scripts/descargar-fotos.mjs 30   # fotos de Wikimedia Commons en datos/ (no se versionan)
node scripts/construir-semilla.mjs    # filtra con CLIP y escribe src/data/semilla.json
```
