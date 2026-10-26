# Fuentes de los archivos de prueba

- `arduino.jpg`: "Arduino Uno - R3", SparkFun Electronics (Boulder, EE. UU.), licencia CC BY 2.0,
  https://commons.wikimedia.org/wiki/File:Arduino_Uno_-_R3.jpg (miniatura de 500 px). Solo se usa en la escena del recorte.
- `objeto.jpg`: "4th Generation Intel Core i7 Processor Front", Intel in Deutschland, licencia CC BY-SA 2.0,
  https://commons.wikimedia.org/wiki/File:4th_Generation_Intel%C2%AE_Core%E2%84%A2_i7_Processor_Front.jpg (miniatura de
  500 px). Se sacó de las fotos de entrenamiento: la app la ve por primera vez en las pruebas.

Los videos de la cámara falsa (`tests/.tmp/*.mjpeg`) se generan con `node tests/fixtures/generar.mjs`
a partir de estas fotos y de figuras sintéticas; no se guardan en el repositorio.
