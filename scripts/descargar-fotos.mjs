// Descarga fotos de referencia de Wikimedia Commons a datos/fotos/<id>/ y guarda la fuente en datos/fuentes.csv.
// Uso: node scripts/descargar-fotos.mjs [porObjeto=30]
import fs from 'node:fs/promises';

const POR_OBJETO = +process.argv[2] || 30;
const SOLO = process.argv.slice(3); // ids a descargar; vacío = todos
const CONSULTAS = {
  ram: ['RAM module DDR4 DIMM', 'DDR3 SDRAM memory module'],
  cpu: ['Intel Core processor LGA', 'AMD Ryzen processor AM4', 'microprocessor CPU top view pins', 'Pentium processor chip'],
  gpu: ['GeForce GTX graphics card', 'Radeon graphics card', 'video card dual fan', 'PCI Express graphics card'],
  'placa-madre': ['computer motherboard ATX', 'motherboard socket'],
  ssd: ['SSD solid state drive', 'M.2 NVMe SSD'],
  hdd: ['hard disk drive 3.5 inch', 'HDD SATA internal'],
  fuente: ['ATX power supply unit computer', 'PC PSU'],
  cooler: ['CPU cooler heatsink fan', 'processor heatsink'],
  mouse: ['computer mouse optical', 'USB mouse'],
  teclado: ['computer keyboard', 'USB keyboard'],
  webcam: ['webcam USB', 'web camera'],
  pendrive: ['USB flash drive', 'pendrive'],
  hdmi: ['HDMI cable', 'HDMI connector'],
  'cable-red': ['Ethernet cable RJ45', 'network patch cable'],
  router: ['wireless router', 'Wi-Fi router'],
  arduino: ['Arduino Uno board', 'Arduino microcontroller board'],
  protoboard: ['breadboard electronics', 'solderless breadboard circuit'],
  resistencia: ['resistor through-hole', 'carbon film resistors'],
  led: ['LED diode 5mm', 'light emitting diode'],
  multimetro: ['digital multimeter', 'multimeter'],
  monitor: ['computer monitor LCD', 'desktop monitor display'],
  notebook: ['laptop computer', 'notebook computer open'],
  gabinete: ['ATX computer case', 'desktop computer tower PC', 'PC case side panel', 'personal computer tower'],
  impresora: ['inkjet printer', 'laser printer'],
  auriculares: ['headphones', 'headset with microphone'],
  parlantes: ['computer speakers', 'desktop speakers'],
  microfono: ['USB microphone', 'condenser microphone'],
  joystick: ['gamepad controller', 'game controller joystick'],
  'cable-usb': ['USB cable', 'USB-C cable'],
  switch: ['network switch ethernet', 'gigabit switch ports'],
  'tarjeta-sd': ['SD card', 'microSD card'],
  smartphone: ['smartphone', 'Android smartphone'],
  disquete: ['floppy disk 3.5', 'diskette'],
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
const csv = [['id', 'archivo', 'titulo', 'pagina']];

for (const [id, qs] of Object.entries(CONSULTAS)) {
  if (SOLO.length && !SOLO.includes(id)) continue;
  await fs.rm(`datos/fotos/${id}`, { recursive: true, force: true });
  await fs.mkdir(`datos/fotos/${id}`, { recursive: true });
  const vistos = new Set();
  let n = 0;
  for (const q of qs) {
    const u = new URL('https://commons.wikimedia.org/w/api.php');
    Object.entries({
      action: 'query', generator: 'search', gsrsearch: `${q} filetype:bitmap`, gsrnamespace: 6, gsrlimit: 40,
      prop: 'imageinfo', iiprop: 'url|mime', iiurlwidth: 400, format: 'json',
    }).forEach(([k, v]) => u.searchParams.set(k, v));
    const data = await (await fetch(u, { headers: H })).json();
    for (const p of Object.values(data.query?.pages ?? {}).sort((a, b) => a.index - b.index)) {
      const ii = p.imageinfo?.[0];
      if (n >= POR_OBJETO || !ii || vistos.has(p.title) || !/^image\/(jpeg|png)$/.test(ii.mime)) continue;
      vistos.add(p.title);
      const r = await fetch(ii.thumburl, { headers: H });
      if (!r.ok) continue;
      const file = `${id}_${String(++n).padStart(2, '0')}.jpg`;
      await fs.writeFile(`datos/fotos/${id}/${file}`, Buffer.from(await r.arrayBuffer()));
      csv.push([id, file, `"${p.title.replace(/"/g, "'")}"`, ii.descriptionurl]);
      await sleep(250);
    }
  }
  console.log(id, n);
}
const previas = SOLO.length
  ? (await fs.readFile('datos/fuentes.csv', 'utf8')).split('\n').slice(1).filter((l) => !SOLO.includes(l.split(',')[0]))
  : [];
await fs.writeFile('datos/fuentes.csv', [...csv.slice(0, 1), ...previas, ...csv.slice(1)].map((r) => (Array.isArray(r) ? r.join(',') : r)).join('\n'));
