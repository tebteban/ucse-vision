# UCSE Vision

Reconocimiento de objetos con la cámara, pensado como una "Pokédex" universitaria por carreras
(hoy: Informática; Electrónica vuelve más adelante). Se hace clic sobre un objeto, el sistema lo recorta, lo sigue y muestra
su ficha con una descripción corta y una larga. Se pueden enseñar objetos nuevos en vivo, con unas pocas
muestras de la cámara y sin reentrenar la red. Todo corre local, sin internet.

## Cómo funciona

| Parte | Qué hace | Dónde |
|---|---|---|
| Reconocimiento | CLIP (ViT-B/32 cuantizado) convierte el recorte en un vector y se compara con las muestras de la biblioteca | `src/clip.worker.js`, `src/library.js` |
| Selección por clic | SlimSAM segmenta el objeto bajo el clic; analiza la escena en segundo plano | `src/sam.worker.js`, `src/segmentador.js` |
| Seguimiento | Coincidencia de plantilla sobre cuadros reducidos | `src/seguimiento.js`, `src/seguidor.worker.js` |
| Biblioteca | 28 fichas + 2600 muestras base incluidas (hasta 100 fotos por objeto); lo propio se guarda en la PC y se puede exportar | `src/data/`, `src/library.js` |

Los tres modelos corren en Web Workers, así la interfaz y la cámara nunca se traban. La app de escritorio se sirve
desde `app://` con la página aislada (COOP/COEP): eso permite que la segmentación use varios núcleos de la CPU
en lugar de la GPU, que congelaba el video mientras calculaba.

### Ayudante con IA local (opcional)

Un LLM local en [Ollama](https://ollama.com) ayuda, sin reemplazar el reconocimiento (que sigue siendo CLIP con las
muestras). Todo está en `src/descripciones.js`:

- **Enseñar:** al escribir el nombre de un objeto nuevo, escribe la descripción corta y la larga (editables).
- **Con un modelo que ve imágenes** (`gemma3:4b`, el preferido; también `qwen2.5vl:3b`):
  - cuando CLIP duda (queda debajo del umbral), la IA dice qué objeto es y, solo con texto, se le pregunta por sí o
    por no si eso es cada uno de los 4 candidatos de CLIP ("¿Una cámara digital Nikon es un celular?"). Si confirma
    uno, se muestra como reconocido con un porcentaje combinado, `1 − (1 − CLIP) × (1 − 0,73)`, y la marca
    "Confirmado por la IA". El 0,73 es lo que acierta gemma3:4b cuando confirma (`FIABILIDAD_IA` en
    `src/library.js`): un 80 % de CLIP pasa a 95 %. Pedirle que eligiera de una lista no servía: casi nunca decía
    "ninguno", y una cámara de fotos terminaba como "Celular";
  - si CLIP estaba seguro, la IA igual lo verifica al escribir la descripción larga: si ve otra cosa (algo que no
    está en el catálogo), pasa a "No reconocido" con su opinión. Medido: mantiene el 95 % de los objetos del catálogo
    bien reconocidos y descarta el 76 % de los que no están (el 91 % de las cámaras de fotos);
  - con el objeto reconocido, la descripción corta es la del catálogo (genérica) y la larga la escribe la IA en el
    momento para ese objeto en particular: primero dice qué es exactamente ("Control de Xbox", "iPhone") y después
    escribe dos párrafos, con la marca "Escrito por la IA para este objeto". Sin IA que vea imágenes, o si falla,
    queda la del catálogo;
  - si la IA dice que no es ninguno, da su opinión ("Parece: …") y "Enseñar este objeto" abre el formulario ya
    completo;
  - en Enseñar, "Mirar el objeto" completa nombre, categoría y descripciones desde la cámara.

Primero aparece el nombre y después la ficha, que se va escribiendo en pantalla. Mientras la app está abierta, el
modelo queda cargado en la GPU, para que ninguna respuesta tenga que esperar la carga.

**Probar la PC antes de la demo:** abrir la app, hacer clic en un objeto, ir a Enseñar y tocar "Mirar el objeto".
Debajo de los botones dice si el modelo entró entero en la GPU y cuánto tardó la respuesta. Si dice que una parte
corre en la CPU, va a andar lento: cerrar otros programas que usen la GPU (u otro modelo cargado en Ollama).

Elige el primero que tenga instalado entre `gemma3:4b`, `qwen2.5vl:3b`, `qwen2.5:3b`, `llama3.2:3b` y
`qwen2.5:1.5b` (todos entran en 4 GB de VRAM); si no tiene ninguno, usa otro modelo de texto instalado. Para tenerlo:
`ollama pull gemma3:4b`. Sin Ollama, todo se completa a mano como siempre. La app le habla por `app://ucse/ollama/`
(lo reenvía `electron.js`; otra dirección con la variable `UCSE_OLLAMA`).

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
node scripts/descargar-fotos.mjs 150  # hasta 150 fotos por objeto de Wikimedia Commons en datos/ (no se versionan)
node scripts/construir-semilla.mjs    # filtra con CLIP, deja hasta 100 por objeto en src/data/semilla.json
node scripts/evaluar-base.mjs         # mide cuánto reconoce la base con fotos que no conoce
```

**Fotos propias:** las que saques vos (por ejemplo con el celular, al objeto real sobre una mesa) van en
`datos/propias/<id>/` (el id del objeto en `src/data/catalogo.json`, por ejemplo `datos/propias/cpu/`). La descarga
no toca esa carpeta, y `construir-semilla.mjs` las conserva siempre y antes que las de internet. Son las que más
ayudan, porque se parecen a lo que ve la cámara en la demo.
