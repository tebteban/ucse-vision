// Cliente genérico de un Web Worker con pedido/respuesta, tiempo límite y reinicio automático.
// Si el worker se cae (error de carga, memoria, GPU perdida) o un pedido no responde a tiempo, se descarta,
// se rechazan los pedidos pendientes y el próximo pedido levanta uno nuevo y lo vuelve a inicializar.
export function crearTrabajador(crear, { limiteMs = 20000, alReiniciar } = {}) {
  let worker = null;
  let init = null; // [tipo, args] del pedido de inicialización, para repetirlo tras un reinicio
  let listo = null; // promesa de la inicialización del worker actual
  let contador = 0;
  const pendientes = new Map();

  function descartar(motivo) {
    worker?.terminate();
    worker = null;
    listo = null;
    for (const p of pendientes.values()) {
      clearTimeout(p.t);
      p.reject(new Error(motivo));
    }
    pendientes.clear();
  }

  function enviar(tipo, args, transfer, limite) {
    if (!worker) {
      worker = crear();
      worker.onmessage = ({ data: { id, resultado, error } }) => {
        const p = pendientes.get(id);
        if (!p) return; // respuesta de un pedido ya vencido
        pendientes.delete(id);
        clearTimeout(p.t);
        error ? p.reject(new Error(error)) : p.resolve(resultado);
      };
      worker.onerror = (e) => {
        e.preventDefault?.();
        descartar(`El proceso de fondo falló: ${e.message || 'error desconocido'}`);
        alReiniciar?.();
      };
    }
    return new Promise((resolve, reject) => {
      const id = ++contador;
      const t = setTimeout(() => {
        // un pedido colgado deja al worker en un estado desconocido: se descarta entero
        descartar(`"${tipo}" no respondió en ${Math.round(limite / 1000)} s`);
        alReiniciar?.();
      }, limite);
      pendientes.set(id, { resolve, reject, t });
      worker.postMessage({ id, tipo, ...args }, transfer);
    });
  }

  return {
    // Inicializa (y re-inicializa tras cada reinicio) con este pedido.
    iniciar(tipo, args = {}, limite = 120000) {
      init = [tipo, args, limite];
      const p = enviar(tipo, args, [], limite).catch((e) => {
        if (listo === p) listo = null; // solo si no la reemplazó una inicialización más nueva
        throw e;
      });
      p.catch(() => {}); // el error lo ve quien espere esta promesa; evita avisos de rechazo sin manejar
      listo = p;
      return p;
    },
    async llamar(tipo, args = {}, transfer = [], limite = limiteMs) {
      if (!listo) {
        if (!init) throw new Error('El proceso de fondo no fue inicializado');
        this.iniciar(...init);
      }
      await listo;
      return enviar(tipo, args, transfer, limite);
    },
    ocupado: () => pendientes.size > 0,
    // Solo para pruebas de tolerancia a fallos: mata el worker como si se hubiera caído.
    matar: () => {
      descartar('Proceso de fondo detenido');
      alReiniciar?.();
    },
  };
}
