// Descarga fotos de referencia de Wikimedia Commons a datos/fotos/<id>/ y guarda la fuente en datos/fuentes.csv.
// Solo baja los objetos que están en el catálogo (las búsquedas de los demás quedan para sumarlos más adelante).
// Uso: node scripts/descargar-fotos.mjs [porObjeto=150] [ids...]
import fs from 'node:fs/promises';

const POR_OBJETO = +process.argv[2] || 150;
const SOLO = process.argv.slice(3); // ids a descargar; vacío = todos los del catálogo
const PAGINAS = 4; // de 50 resultados cada una, por búsqueda
const A_LA_VEZ = 3; // objetos descargándose en paralelo
const CONSULTAS = {
  ram: ['RAM module DDR4 DIMM', 'DDR3 SDRAM memory module', 'SO-DIMM laptop memory', 'DDR2 RAM stick', 'computer memory module', 'DIMM memory', 'DDR5 RAM', 'RAM memory stick'],
  cpu: ['Intel Core processor LGA', 'AMD Ryzen processor AM4', 'microprocessor CPU top view pins', 'Pentium processor chip', 'Intel Core i7 processor', 'AMD Athlon processor', 'Intel Xeon processor', 'Intel Pentium 4'],
  gpu: ['GeForce GTX graphics card', 'Radeon graphics card', 'video card dual fan', 'PCI Express graphics card', 'NVIDIA graphics card', 'AGP graphics card', 'GeForce RTX', 'graphics card'],
  'placa-madre': ['computer motherboard ATX', 'motherboard socket', 'mainboard computer', 'motherboard Asus', 'motherboard Gigabyte', 'micro ATX motherboard', 'Mini-ITX motherboard', 'motherboard MSI'],
  ssd: ['SSD solid state drive', 'M.2 NVMe SSD', '2.5 inch SSD', 'Samsung SSD', 'solid-state drive SATA', 'mSATA SSD', 'Kingston SSD', 'Crucial SSD'],
  hdd: ['hard disk drive 3.5 inch', 'HDD SATA internal', 'hard disk drive opened platter', 'Seagate hard drive', 'Western Digital hard disk', 'laptop hard drive 2.5', 'IDE hard drive', 'hard drive'],
  fuente: ['ATX power supply unit computer', 'PC PSU', 'computer power supply', 'modular power supply PC', 'switching power supply computer', 'Corsair power supply', 'PSU fan'],
  cooler: ['CPU cooler heatsink fan', 'processor heatsink', 'CPU fan heatsink', 'tower CPU cooler', 'heat sink fan computer', 'Intel stock cooler', 'AIO liquid CPU cooler'],
  mouse: ['computer mouse optical', 'USB mouse', 'wireless mouse', 'gaming mouse', 'ball mouse computer', 'Logitech mouse', 'Microsoft mouse'],
  teclado: ['computer keyboard', 'USB keyboard', 'mechanical keyboard', 'wireless keyboard', 'QWERTY keyboard', 'PS/2 keyboard', 'Logitech keyboard'],
  webcam: ['webcam USB', 'web camera', 'Logitech webcam', 'webcam computer', 'USB camera video conference', 'webcam on monitor'],
  pendrive: ['USB flash drive', 'pendrive', 'USB stick', 'USB memory stick', 'Kingston DataTraveler', 'SanDisk USB flash', 'thumb drive'],
  hdmi: ['HDMI cable', 'HDMI connector', 'HDMI plug', 'HDMI cable connector', 'High-Definition Multimedia Interface', 'mini HDMI cable'],
  'cable-red': ['Ethernet cable RJ45', 'network patch cable', 'RJ45 connector', 'Cat5e cable', 'Cat6 cable', 'LAN cable', 'Ethernet cable'],
  router: ['wireless router', 'Wi-Fi router', 'TP-Link router', 'Linksys router', 'broadband router', 'router antennas', 'Netgear router'],
  monitor: ['computer monitor LCD', 'desktop monitor display', 'LCD monitor', 'CRT monitor', 'flat panel monitor', 'Dell monitor', 'widescreen computer monitor'],
  notebook: ['laptop computer', 'notebook computer open', 'laptop', 'ThinkPad laptop', 'MacBook', 'netbook', 'Dell laptop'],
  gabinete: ['ATX computer case', 'desktop computer tower PC', 'PC case side panel', 'personal computer tower', 'computer case', 'PC tower case', 'desktop computer case open'],
  impresora: ['inkjet printer', 'laser printer', 'HP printer', 'Epson printer', 'computer printer', 'dot matrix printer', 'multifunction printer'],
  auriculares: ['headphones', 'headset with microphone', 'over-ear headphones', 'gaming headset', 'earphones', 'Sennheiser headphones', 'Sony headphones'],
  parlantes: ['computer speakers', 'desktop speakers', 'PC speakers', 'multimedia speakers', 'Logitech speakers', 'loudspeakers computer', 'bookshelf speakers'],
  microfono: ['USB microphone', 'condenser microphone', 'microphone', 'dynamic microphone', 'microphone on stand', 'studio microphone', 'Shure microphone'],
  joystick: ['gamepad controller', 'game controller joystick', 'gamepad', 'Xbox controller', 'PlayStation controller', 'joystick', 'USB gamepad'],
  'cable-usb': ['USB cable', 'USB-C cable', 'USB cable connector', 'USB Type-A cable', 'micro USB cable', 'USB plug', 'USB Type-C connector'],
  switch: ['network switch ethernet', 'gigabit switch ports', 'Ethernet switch', 'network switch rack', 'Cisco switch', 'unmanaged switch', 'switch RJ45 ports'],
  'tarjeta-sd': ['SD card', 'microSD card', 'Secure Digital card', 'SDHC card', 'memory card SD', 'SanDisk SD card', 'microSD adapter'],
  smartphone: ['smartphone', 'Android smartphone', 'mobile phone', 'iPhone', 'Samsung Galaxy phone', 'cell phone touchscreen', 'smartphone on table'],
  disquete: ['floppy disk 3.5', 'diskette', 'floppy disk', '5.25-inch floppy disk', 'diskettes', 'floppy disks', '3.5-inch floppy'],
  // Electrónica (fuera del catálogo por ahora)
  arduino: ['Arduino Uno board', 'Arduino microcontroller board'],
  protoboard: ['breadboard electronics', 'solderless breadboard circuit'],
  resistencia: ['resistor through-hole', 'carbon film resistors'],
  led: ['LED diode 5mm', 'light emitting diode'],
  multimetro: ['digital multimeter', 'multimeter'],
  capacitor: ['electrolytic capacitor', 'capacitors electronic components'],
  transistor: ['transistor TO-92', 'bipolar transistor'],
  potenciometro: ['potentiometer', 'rotary potentiometer knob'],
  servo: ['servo motor SG90', 'RC servo motor', 'micro servo', 'servo motor robotics', 'SG90', 'servo motor Arduino'],
  'sensor-ultrasonico': ['HC-SR04 ultrasonic sensor', 'ultrasonic distance sensor module'],
  lcd: ['LCD 16x2 display module', 'character LCD HD44780', 'LCD display Arduino', 'alphanumeric LCD module'],
  'bateria-9v': ['9V battery', 'PP3 battery'],
  soldador: ['soldering iron', 'soldering iron station'],
  rele: ['relay module', 'electromechanical relay'],
  'raspberry-pi': ['Raspberry Pi board', 'Raspberry Pi 4'],
};

const H = { 'User-Agent': 'ucse-vision-demo/1.0 (proyecto universitario)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Wikimedia responde 429 si se le pide muy rápido: se espera y se reintenta.
async function pedir(url) {
  for (let intento = 0; ; intento++) {
    const r = await fetch(url, { headers: H });
    if (r.status !== 429 || intento === 4) return r;
    await sleep(5000 * (intento + 1));
  }
}

async function descargar(id) {
  await fs.rm(`datos/fotos/${id}`, { recursive: true, force: true });
  await fs.mkdir(`datos/fotos/${id}`, { recursive: true });
  const filas = [];
  const vistos = new Set();
  let n = 0;
  for (const q of CONSULTAS[id]) {
    for (let pagina = 0, offset = 0; pagina < PAGINAS && n < POR_OBJETO && offset !== undefined; pagina++) {
      const u = new URL('https://commons.wikimedia.org/w/api.php');
      Object.entries({
        action: 'query', generator: 'search', gsrsearch: `${q} filetype:bitmap`, gsrnamespace: 6, gsrlimit: 50, gsroffset: offset,
        prop: 'imageinfo', iiprop: 'url|mime', iiurlwidth: 400, format: 'json',
      }).forEach(([k, v]) => u.searchParams.set(k, v));
      const data = await (await pedir(u)).json();
      offset = data.continue?.gsroffset;
      for (const p of Object.values(data.query?.pages ?? {}).sort((a, b) => a.index - b.index)) {
        const ii = p.imageinfo?.[0];
        if (n >= POR_OBJETO || !ii || vistos.has(p.title) || !/^image\/(jpeg|png)$/.test(ii.mime)) continue;
        vistos.add(p.title);
        const r = await pedir(ii.thumburl);
        if (!r.ok) continue;
        const file = `${id}_${String(++n).padStart(3, '0')}.jpg`;
        await fs.writeFile(`datos/fotos/${id}/${file}`, Buffer.from(await r.arrayBuffer()));
        filas.push([id, file, `"${p.title.replace(/"/g, "'")}"`, ii.descriptionurl]);
        await sleep(150);
      }
    }
  }
  console.log(id, n);
  return filas;
}

const catalogo = JSON.parse(await fs.readFile('src/data/catalogo.json', 'utf8')).map((o) => o.id);
const ids = (SOLO.length ? SOLO : catalogo).filter((id) => CONSULTAS[id]);
const pendientes = [...ids];
const filas = [];
await Promise.all(Array.from({ length: A_LA_VEZ }, async () => {
  for (let id; (id = pendientes.shift()); ) filas.push(...(await descargar(id)));
}));
const previas = (await fs.readFile('datos/fuentes.csv', 'utf8').catch(() => '')).split('\n').slice(1).filter((l) => l && !ids.includes(l.split(',')[0]));
await fs.writeFile('datos/fuentes.csv', [['id', 'archivo', 'titulo', 'pagina'].join(','), ...previas, ...filas.map((r) => r.join(','))].join('\n'));
