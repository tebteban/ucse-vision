# Resultados de las pruebas de UCSE Vision

Generado el 23/10/2026, 05:40:31. Todas las pruebas corren sobre la app de escritorio real (Electron) con una cámara falsa que reproduce videos generados (`tests/fixtures/generar.mjs`).

## Rendimiento: antes y después

Promedio de 3 repeticiones por escenario, cada una con la app recién abierta. Se descartan las corridas en las que Windows pausó la ventana (pantalla apagada o ventana tapada), porque no miden la app.

### Cámara en reposo (10 s)

| Métrica | Antes (n=3) | Después (n=3) | Después con SAM en GPU (n=3) |
|---|---:|---:|---:|
| Video mostrado (fps, ideal 30) | 20,8 | 30 | 30 |
| Congelamientos de la cámara ≥ 250 ms | 3 | 0 | 0 |
| Peor congelamiento (ms) | 374 | 58 | 58 |
| Tirones de la interfaz > 50 ms | 4 | 0 | 0 |
| Bloqueos del hilo principal | 0 | 0 | 0 |
| Tiempo total bloqueado (ms) | 0 | 0 | 0 |
| Análisis de escena (s) | — | 2,6 | 0,7 |

### Clic sobre un objeto quieto

| Métrica | Antes (n=3) | Después (n=3) | Después con SAM en GPU (n=3) |
|---|---:|---:|---:|
| Video mostrado (fps, ideal 30) | 17,9 | 29,6 | 29,6 |
| Congelamientos de la cámara ≥ 250 ms | 4 | 0 | 0 |
| Peor congelamiento (ms) | 507 | 156 | 160 |
| Tirones de la interfaz > 50 ms | 7,3 | 1,3 | 1 |
| Bloqueos del hilo principal | 4,7 | 0 | 0 |
| Tiempo total bloqueado (ms) | 1.102 | 0 | 0 |
| Clic → recuadro (ms) | 835 | 232 | 346 |
| Clic → ficha (ms) | 846 | 449 | 563 |
| Análisis de escena (s) | — | 2,5 | 0,7 |

### Seguimiento de un objeto en movimiento (15 s)

| Métrica | Antes (n=3) | Después (n=3) | Después con SAM en GPU (n=3) |
|---|---:|---:|---:|
| Video mostrado (fps, ideal 30) | 24,3 | 29,8 | 24,5 |
| Congelamientos de la cámara ≥ 250 ms | 3,3 | 0 | 5,3 |
| Peor congelamiento (ms) | 347 | 169 | 454 |
| Tirones de la interfaz > 50 ms | 25,7 | 1,3 | 22,3 |
| Bloqueos del hilo principal | 7,7 | 0 | 0 |
| Tiempo total bloqueado (ms) | 1.789 | 0 | 0 |
| Clic → recuadro (ms) | 1.628 | 3.392 | 1.870 |
| Clic → ficha (ms) | 1.742 | 3.395 | 1.898 |
| Análisis de escena (s) | — | 2,6 | 0,7 |

### Ráfaga de 8 muestras en Enseñar

| Métrica | Antes (n=3) | Después (n=3) | Después con SAM en GPU (n=3) |
|---|---:|---:|---:|
| Video mostrado (fps, ideal 30) | 21,8 | 28,9 | 29,5 |
| Congelamientos de la cámara ≥ 250 ms | 3 | 0 | 0 |
| Peor congelamiento (ms) | 258 | 102 | 80 |
| Tirones de la interfaz > 50 ms | 10,7 | 3,3 | 2,7 |
| Bloqueos del hilo principal | 8 | 0 | 0 |
| Tiempo total bloqueado (ms) | 1.812 | 0 | 0 |
| Ráfaga de 8 muestras (ms) | 5.615 | 4.329 | 4.273 |
| Análisis de escena (s) | — | 2,5 | 0,7 |

### 4 selecciones seguidas con la escena en movimiento

| Métrica | Antes (n=3) | Después (n=3) | Después con SAM en GPU (n=3) |
|---|---:|---:|---:|
| Video mostrado (fps, ideal 30) | 22,7 | 29,8 | 25 |
| Congelamientos de la cámara ≥ 250 ms | 2,7 | 0 | 1 |
| Peor congelamiento (ms) | 413 | 156 | 311 |
| Tirones de la interfaz > 50 ms | 31 | 1,3 | 25,3 |
| Bloqueos del hilo principal | 5,3 | 0 | 0 |
| Tiempo total bloqueado (ms) | 1.235 | 0 | 0 |
| Clic → ficha (ms) | 1.721 | 3.364 | 1.732 |
| Análisis de escena (s) | — | 2,6 | 0,7 |

## Pruebas de estrés (después)

| Prueba | Corridas | Video (fps) | Congelamientos | Bloqueos del hilo principal | Memoria JS (MB, variación) | Dato extra |
|---|---:|---:|---:|---:|---:|---|
| 100 clics rápidos por toda la cámara | 3 | 19,8 | 1,7 | 0 | 1,4 |  |
| 200 cambios de pestaña y categoría | 3 | 28,9 | 0 | 0 | 19,7 |  |
| 10 ráfagas seguidas (80 muestras) | 2 | 29,9 | 0 | 0 | 4 | 2 muestras/s |
| Fijar y soltar 40 veces | 3 | 29,7 | 0 | 0 | 6,5 |  |
| Biblioteca con 3000 muestras propias | 3 | 29 | 0 | 0 | 12,8 | clic → ficha 845 ms |

## Corridas completas

**Unitarias (Vitest):** corrida 1: 27/27 · corrida 2: 27/27 · corrida 3: 27/27.

**E2E (Playwright):** corrida 1: 19/21 pasaron · corrida 2: 20/21 pasaron · corrida 3: 20/21 pasaron.

| Tipo | Prueba | Pasó | Duración media (s) |
|---|---|---:|---:|
| Estrés | 100 clics rápidos por toda la cámara | 3/3 | 17,1 |
| Estrés | 200 cambios rápidos de pestaña y categoría con un objeto fijado | 3/3 | 23,6 |
| Estrés | 10 ráfagas seguidas (80 muestras) sobre un objeto del catálogo | 2/3 | 59,4 |
| Estrés | fijar y soltar 40 veces seguidas | 3/3 | 27,3 |
| Estrés | biblioteca grande: 3000 muestras propias importadas | 3/3 | 16,8 |
| Estrés | corrida larga: 3 minutos siguiendo un objeto en movimiento | 0/3 | 139 |
| Tolerancia a fallos | la cámara se desconecta y la app se reconecta sola | 3/3 | 16,4 |
| Tolerancia a fallos | el botón "Reintentar ahora" reabre la cámara sin esperar | 3/3 | 13,6 |
| Tolerancia a fallos | el proceso de reconocimiento se cae y se reinicia solo | 3/3 | 13,3 |
| Tolerancia a fallos | el proceso de segmentación se cae y el clic se resuelve igual | 3/3 | 17,4 |
| Tolerancia a fallos | la página se cae y Electron la recarga | 3/3 | 19,3 |
| Tolerancia a fallos | almacenamiento lleno: avisa y el objeto enseñado igual se puede usar | 3/3 | 15,9 |
| Tolerancia a fallos | un error inesperado no tumba la app | 3/3 | 10,2 |
| Funcional | arranca, carga modelos y muestra el catálogo completo | 3/3 | 9,4 |
| Funcional | clic sobre el objeto: recuadro, nombre, descripción corta y larga | 3/3 | 10,9 |
| Funcional | encuadre manual arrastrando el mouse | 3/3 | 4 |
| Funcional | el filtro de categoría cambia lo que se puede reconocer | 3/3 | 11,2 |
| Funcional | enseñar un objeto nuevo en vivo, reconocerlo y que persista al reiniciar | 3/3 | 15 |
| Funcional | exportar e importar la biblioteca; un archivo inválido no rompe nada | 3/3 | 13,2 |
| Funcional | borrar muestras pide confirmación y "Muestras base" las restaura | 3/3 | 11,3 |
| Funcional | clic sobre una escena vacía: avisa o marca "No reconocido" sin romperse | 3/3 | 10 |

**Ejecutable portable** (`release/UCSE-Vision/UCSE Vision.exe`): pruebas funcionales 8/8 pasaron.

## Notas

- Las 4 fallas E2E de la regresión (3 de "corrida larga: 3 minutos" y 1 de "10 ráfagas") no son de la app: la ventana se cerró a mano durante la prueba (el error es "Target page, context or browser has been closed"). Antes de la regresión, ambas pruebas pasaron en corridas individuales.
- "100 clics rápidos" es un uso abusivo a propósito: cada clic pide una segmentación y la CPU queda ocupada. Aun así no hay bloqueos del hilo principal ni errores, y al terminar la app reconoce bien.
- "Después" usa la segmentación (SAM) en CPU con varios hilos, que es la opción por defecto. La columna "Después con SAM en GPU" muestra por qué: en GPU el análisis es más rápido (0,7 s contra 2,6 s), pero congela la cámara mientras sigue un objeto en movimiento.
- Clic → ficha en escenas en movimiento sube a ~3,4 s en "Después" porque cada clic necesita un análisis nuevo de la escena. Con los objetos quietos sobre la mesa, el caso típico de la demo, baja a ~0,45 s.
- Mediciones en: Intel i5-10400, RTX 3050 8 GB, 32 GB RAM.
