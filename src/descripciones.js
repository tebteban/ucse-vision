// Ayudante con un LLM local (Ollama): escribe la ficha de un objeto nuevo a partir del nombre y, si el modelo ve
// imágenes, también dice qué objeto hay en la foto. Es opcional: el reconocimiento lo sigue haciendo CLIP con las
// muestras, y sin Ollama todo se completa a mano. Las rutas ollama/... las reenvía electron.js (o vite en desarrollo).
const PREFERIDOS = ['gemma3:4b', 'qwen2.5vl:3b', 'qwen2.5:3b', 'llama3.2:3b', 'qwen2.5:1.5b']; // entran en 4 GB de VRAM; los dos primeros ven imágenes

// {nombre, vision} del modelo a usar, o null si Ollama no está o no tiene modelos de texto.
export async function modeloDisponible() {
  try {
    const r = await fetch('ollama/api/tags', { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    const nombres = ((await r.json()).models ?? []).map((m) => m.name);
    const nombre = PREFERIDOS.find((p) => nombres.includes(p)) ?? nombres.find((n) => !/embed/i.test(n));
    if (!nombre) return null;
    const info = await fetch('ollama/api/show', { method: 'POST', body: JSON.stringify({ model: nombre }), signal: AbortSignal.timeout(3000) })
      .then((s) => (s.ok ? s.json() : {}))
      .catch(() => ({})); // sin ese dato se usa solo para texto
    return { nombre, vision: (info.capabilities ?? []).includes('vision') };
  } catch {
    return null;
  }
}

// Carga el modelo en la VRAM (o renueva sus 30 minutos de vida) para que la próxima consulta no espere la carga.
export const precargar = (modelo) => fetch('ollama/api/generate', { method: 'POST', body: JSON.stringify({ model: modelo, keep_alive: '30m' }) }).catch(() => {});

// Qué porcentaje del modelo cargado está en la GPU (100 = todo; menos, una parte corre en la CPU y es mucho más
// lento), o null si no está cargado o no se sabe.
export async function enGPU(modelo) {
  try {
    const { models = [] } = await (await fetch('ollama/api/ps', { signal: AbortSignal.timeout(3000) })).json();
    const m = models.find((x) => x.name === modelo);
    return m?.size ? Math.round((100 * (m.size_vram ?? 0)) / m.size) : null;
  } catch {
    return null;
  }
}

// Se pide texto común y se separa acá: forzando JSON (el "format" de Ollama), gemma3 entra en bucles y lo deja roto.
// La respuesta llega de a pedazos; alEscribir(textoHastaAhora) permite mostrarla mientras se escribe.
async function pedir(modelo, prompt, imagen, alEscribir) {
  const r = await fetch('ollama/api/generate', {
    method: 'POST',
    // num_predict acota el tiempo si el modelo se pone a repetir
    body: JSON.stringify({ model: modelo, prompt, ...(imagen && { images: [imagen] }), stream: true, think: false, keep_alive: '30m', options: { temperature: 0.3, num_predict: 400 } }),
    signal: AbortSignal.timeout(120_000), // si no se precargó, Ollama primero carga el modelo en la VRAM
  });
  if (!r.ok) throw new Error(`Ollama respondió ${r.status}`);
  const lector = r.body.pipeThrough(new TextDecoderStream()).getReader();
  let texto = '';
  let resto = ''; // una línea JSON puede llegar partida entre dos pedazos
  for (let fin = false; !fin; ) {
    const { value = '', done } = await lector.read();
    fin = done;
    const lineas = (resto + value).split('\n');
    resto = fin ? '' : lineas.pop();
    for (const l of lineas.filter((x) => x.trim())) {
      const j = JSON.parse(l);
      if (j.error) throw new Error(j.error);
      texto += j.response ?? '';
    }
    alEscribir?.(texto);
  }
  return texto;
}

// Saca numeración, rótulos ("Resumen:") y negritas que a veces agrega el modelo.
const limpiar = (s) => s.replace(/\*\*/g, '').replace(/^\s*\d[.)]\s*/, '').replace(/^(resumen|detalle|nombre|categor[ií]a|p[aá]rrafo \d)\s*:\s*/i, '').trim();
const texto = (s, max) => (s ?? '').trim().slice(0, max); // los maxLength del formulario

// {resumen, detalle} de una respuesta "oración\n\npárrafo\n\npárrafo". parcial: la respuesta todavía se está
// escribiendo, así que puede faltar el detalle.
export function separarFicha(respuesta, parcial = false) {
  const bloques = respuesta.split(respuesta.includes('\n\n') ? /\n\s*\n/ : '\n').map(limpiar).filter(Boolean);
  const f = { resumen: texto(bloques[0], 300), detalle: texto(bloques.slice(1).join('\n'), 2000) };
  if (!parcial && (!f.resumen || !f.detalle)) throw new Error('Respuesta incompleta del modelo');
  return f;
}

// {resumen, detalle} para el objeto; ejemplo: una ficha del catálogo de la misma categoría, para copiar el estilo.
// alEscribir({resumen, detalle}) recibe la ficha a medio escribir.
export async function describir(modelo, nombre, categoria, ejemplo, alEscribir) {
  const prompt = `Sos docente universitario de ${categoria}. Escribí la ficha de un objeto para una exposición, en español, sin markdown ni títulos.
Respondé con exactamente tres bloques separados por una línea en blanco:
1. Una sola oración (máximo 25 palabras) que diga qué es.
2. Un párrafo de 2 o 3 oraciones: cómo funciona.
3. Un párrafo de 2 o 3 oraciones: para qué se usa y datos clave.
No repitas ideas. Si no estás seguro de un dato, no lo inventes.
Ejemplo:
${ejemplo.resumen}

${ejemplo.detalle.split('\n').join('\n\n')}

Objeto: ${nombre}`;
  return separarFicha(await pedir(modelo, prompt, null, alEscribir && ((t) => alEscribir(separarFicha(t, true)))));
}

// {nombre, categoria} del objeto en la foto (JPEG en base64), para un modelo que ve imágenes. La ficha se pide
// después con describir(), así el nombre se puede mostrar apenas está.
export async function nombrar(modelo, imagen) {
  const prompt = `La foto muestra un objeto de informática o electrónica frente a una cámara. Respondé con exactamente dos líneas, sin nada más:
1. Su nombre común en español, de 1 a 4 palabras, sin número de modelo. Si es una placa o producto conocido (como Arduino o Raspberry Pi), usá ese nombre.
2. Su categoría: Informática (computadoras, sus partes y periféricos, almacenamiento, redes) o Electrónica (componentes, placas y herramientas para armar circuitos).
Si no se distingue ningún objeto, respondé solo: NINGUNO`;
  const [primera, segunda = ''] = (await pedir(modelo, prompt, imagen)).split('\n').map(limpiar).filter(Boolean);
  const nombre = texto(primera?.replace(/\.$/, ''), 120);
  if (!nombre || /^ninguno/i.test(nombre)) throw new Error('La IA no distinguió ningún objeto');
  return { nombre, categoria: /electr/i.test(segunda) ? 'Electrónica' : 'Informática' };
}

// Cuál de los candidatos de CLIP es el objeto de la foto (índice), o null si ninguno. Elegir entre opciones es más
// confiable y rápido que nombrar libre: la respuesta es un número.
export async function elegir(modelo, imagen, nombres) {
  const opciones = [...nombres, 'Ninguno de estos'].map((n, i) => `${i + 1}. ${n}`).join('\n');
  const prompt = `La foto muestra un objeto frente a una cámara. ¿Cuál de estos es?\n${opciones}\nRespondé solo con el número.`;
  const n = Number((await pedir(modelo, prompt, imagen)).match(/\d+/)?.[0]);
  return n >= 1 && n <= nombres.length ? n - 1 : null;
}
