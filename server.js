'use strict';
/*
 * Planeta Vivo — servidor multijugador
 * Un mundo, tres plataformas conectadas por HTTP. Sin dependencias.
 *
 *   node server.js [puerto]
 *
 * Endpoints para las plataformas (ver README.md):
 *   GET  /api/state?key=...        estado completo del planeta
 *   GET  /api/rules                reglas en texto plano
 *   GET|POST /api/orders           enviar las órdenes del turno
 *   GET  /api/state/:key           alias cómodo
 *
 * Endpoints del dios (navegador):
 *   GET  /api/map                  terreno
 *   GET  /api/keys                 claves de las tres plataformas
 *   POST /api/god                  lanzar un poder
 *   POST /api/force                resolver el turno ya
 *   POST /api/new                  planeta nuevo
 *   POST /api/settings             bots de respaldo / espera
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const engine = require('./engine');

const PORT = parseInt(process.argv[2], 10) || 7788;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const KEYS_FILE = path.join(ROOT, 'keys.json');

/* ---------------------------- claves ---------------------------- */
function loadKeys() {
  try {
    const raw = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
    if (raw && raw.claude && raw.codex && raw.opencode) return raw;
  } catch (_) { /* se genera */ }
  const mk = p => p + '-' + crypto.randomBytes(4).toString('hex');
  const keys = { claude: mk('clv'), codex: mk('cdx'), opencode: mk('opc') };
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
  return keys;
}
const KEYS = loadKeys();
const keyToFaction = {};
for (const [id, k] of Object.entries(KEYS)) keyToFaction[k] = id;

/* ---------------------------- mundo ---------------------------- */
let world = engine.createWorld({ seed: 1234, keys: KEYS });
let lastSaved = 0;

function newWorld(seed) {
  world = engine.createWorld({ seed: seed >>> 0 || 1, keys: KEYS });
  lastSaved = Date.now();
  console.log(`[planeta] nuevo mundo semilla=${world.seed} paridad=${world.parity}%`);
}

/* ---------------------------- helpers ---------------------------- */
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  });
  res.end(body);
}
function text(res, code, str) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(str);
}
function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      const clean = data.replace(/^\uFEFF/, '').trim();
      if (!clean) return resolve({});
      try { resolve(JSON.parse(clean)); } catch (_) { resolve(Object.fromEntries(new URLSearchParams(clean))); }
    });
    req.on('error', () => resolve({}));
  });
}

function deadline() {
  if (world.phase !== 'orders') return null;
  if (!world.settings.autoBots) return null;
  return world.turnStart + world.settings.waitMs;
}

function tick() {
  if (world.phase !== 'orders') return;
  const aliveList = engine.alive(world);
  const allIn = aliveList.length > 0 && aliveList.every(f => f.submitted);
  const dl = deadline();
  const expired = dl !== null && Date.now() > dl;
  if (allIn || expired) {
    const res = engine.resolveTurn(world);
    if (res.ok) {
      const winner = world.phase === 'over' ? ' · FIN' : '';
      console.log(`[turno ${res.turn}] resuelto${winner}`);
      if (expired && !allIn) console.log('  (por tiempo: los que no mandaron jugaron con el bot de respaldo)');
    }
  }
}
setInterval(tick, 400);

/* ---------------------------- rutas ---------------------------- */
function serveStatic(res, file) {
  const full = path.join(PUBLIC, file);
  if (!full.startsWith(PUBLIC)) return text(res, 403, 'no');
  fs.readFile(full, (err, buf) => {
    if (err) return text(res, 404, 'no encontrado');
    const ext = path.extname(full).toLowerCase();
    const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

const RULES = () => `PLANETA VIVO — reglas
========================================
Objetivo: terminar con el mayor puntaje después de ${engine.MAX_TURNS} turnos.
Puntaje = población*12 + refugios útiles*8 + raíz(comida)*6 + raíz(materiales)*7 + ciencia*1.6 + era*18
(los refugios cuentan hasta 1 por cada 4 personas: los que sobran no suman).

Arranque idéntico para las tres: 6 personas, 16 comida, 4 materiales, 0 refugios, ánimo 70.
El planeta se genera buscando tres regiones de potencial casi igual (índice de paridad en el panel).

ERAS (el desarrollo es lento a propósito; se paga con ciencia acumulada, no se gasta):
  ${engine.ERAS.map((e, i) => `${i}: ${e.icon} ${e.n} · ${e.sci} 🔬 · radio de trabajo ${e.radius} · ${e.cap}/refugio · techo ${e.popMax}`).join('\n  ')}
  Cada era amplía el radio de trabajo (más casilleros a mano), la capacidad de los refugios
  y el techo de población. Los rindes del terreno NO cambian: el progreso es territorial.

Cada turno repartís a tus personas entre cinco tareas (la suma no puede pasar tu población):
  food    cosechar   -> +comida según el terreno (pradera 3, bosque 2, costa/estepa/tundra 1)
  mat     extraer    -> +materiales (montaña 2, bosque 2, desierto/costa/estepa 1)
  build   construir  -> gasta 2 materiales +1 cada 4 refugios; 3 de obra = 1 refugio
  explore explorar   -> +1 ciencia (+0.35 por era), revela vetas (+1 al recurso del casillero, +1.5 ciencia)
  rest    descansar  -> +ánimo, sin riesgo

Reglas del terreno:
  - Comer: cada persona consume 1 comida, y el hacinamiento suma 3% por persona (pop 20 = 1.6 cada una).
    Sin comida suficiente muere gente.
  - Refugios: capacidad ${engine.ERAS[0].cap} personas por refugio en la prehistoria (más en cada era),
    suben el ánimo y protegen de eventos.
  - Crecimiento: si sobra comida, hay lugar y no llegaste al techo de la era, nace una persona
    (máx 1 por turno) y cuesta cada vez más comida: el desarrollo es lento.
  - Peligros: los casilleros con peligro matan gente al azar (9-13% por turno) y rinden menos.
  - Ánimo: multiplica el rendimiento (×0.87 a ×1.25) y filtra eventos.
  - Eventos: uno personal por facción por turno, sacado del mismo mazo (reparto parejo),
    más a veces uno global que afecta a todos por igual.
  - PODERES DIVINOS: el humano (dios) puede intervenir cuando quiera (lluvia, plaga, meteorito, vetas…).

Es información pública: todas ven el mismo estado. El orden de las órdenes no importa,
la resolución es simultánea y no hay ventaja por jugar primero.
`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }); return res.end(); }

  /* ---------- estáticos ---------- */
  if (p === '/' || p === '/index.html') return serveStatic(res, 'index.html');
  if (p === '/app.js' || p === '/style.css' || p === '/favicon.svg') return serveStatic(res, p.slice(1));

  /* ---------- API para las plataformas ---------- */
  if (p === '/api/rules') return text(res, 200, RULES());

  if (p === '/api/state' || p.startsWith('/api/state/')) {
    const key = url.searchParams.get('key') || (p.startsWith('/api/state/') ? decodeURIComponent(p.split('/')[3] || '') : '') || req.headers['x-key'] || '';
    const fid = keyToFaction[key];
    if (key && !fid) return json(res, 401, { ok: false, error: 'clave inválida' });
    if (fid) {
      const f = world.factions.find(x => x.id === fid);
      f.lastSeen = Date.now();
    }
    const god = !fid;
    return json(res, 200, {
      ok: true,
      you: fid || null,
      deadline: deadline(),
      world: engine.snapshot(world, god)
    });
  }

  if (p === '/api/orders') {
    const body = req.method === 'POST' ? await readBody(req) : {};
    const key = url.searchParams.get('key') || body.key || req.headers['x-key'] || '';
    const fid = keyToFaction[key];
    if (!fid) return json(res, 401, { ok: false, error: 'clave inválida: pasá ?key=tu-clave' });

    const orders = req.method === 'POST'
      ? (body.orders || body)
      : { food: url.searchParams.get('food'), mat: url.searchParams.get('mat'), build: url.searchParams.get('build'), explore: url.searchParams.get('explore'), rest: url.searchParams.get('rest') };

    if (body.note) {
      const f = world.factions.find(x => x.id === fid);
      world.log.unshift({ turn: world.turn, text: `${f ? f.name : fid} dejó una nota: “${String(body.note).slice(0, 160)}”`, fid: null });
      if (world.log.length > 200) world.log.length = 200;
    }

    const r = engine.setOrders(world, fid, orders);
    if (r.ok) {
      const f = world.factions.find(x => x.id === fid);
      world.log.unshift({ turn: world.turn, text: `📨 ${f.name} envió sus órdenes: ${Object.entries(r.orders).filter(([, v]) => v > 0).map(([k, v]) => `${engine.TASKS[k].icon}${v}`).join(' ')}`, fid: fid });
      if (world.log.length > 200) world.log.length = 200;
      tick();
    }
    return json(res, r.ok ? 200 : 400, r);
  }

  /* ---------- API del dios ---------- */
  if (p === '/api/map') return json(res, 200, engine.mapSnapshot(world));
  if (p === '/api/keys') return json(res, 200, KEYS);
  if (p === '/api/meta') {
    return json(res, 200, {
      W: engine.W, H: engine.H, MAX_TURNS: engine.MAX_TURNS,
      BIOMES: engine.BIOMES, HAZARDS: engine.HAZARDS,
      TASKS: engine.TASKS, FACTIONS: engine.FACTIONS, POWERS: engine.POWERS
    });
  }
  if (p === '/api/god') {
    const body = await readBody(req);
    const r = engine.applyPower(world, {
      power: body.power,
      faction: body.faction,
      x: Number.isInteger(body.x) ? body.x : parseInt(body.x, 10),
      y: Number.isInteger(body.y) ? body.y : parseInt(body.y, 10)
    });
    return json(res, r.ok ? 200 : 400, r);
  }
  if (p === '/api/force') {
    const r = engine.resolveTurn(world);
    return json(res, 200, r);
  }
  if (p === '/api/new') {
    const body = await readBody(req);
    const seed = Number.isFinite(+body.seed) && +body.seed > 0 ? (+body.seed) >>> 0 : Math.floor(Math.random() * 999999) + 1;
    newWorld(seed);
    return json(res, 200, { ok: true, seed: world.seed, parity: world.parity });
  }
  if (p === '/api/settings') {
    const body = await readBody(req);
    if (typeof body.autoBots === 'boolean') {
      world.settings.autoBots = body.autoBots;
      world.turnStart = Date.now();
    }
    if (Number.isFinite(+body.waitMs) && +body.waitMs >= 10000) world.settings.waitMs = Math.min(600000, +body.waitMs);
    return json(res, 200, { ok: true, settings: world.settings });
  }

  return text(res, 404, 'no encontrado');
});

server.listen(PORT, '0.0.0.0', () => {
  const nets = require('os').networkInterfaces();
  const lan = Object.values(nets).flat().filter(n => n && n.family === 'IPv4' && !n.internal).map(n => n.address);
  console.log('');
  console.log('  🌍 Planeta Vivo corriendo');
  console.log('  ---------------------------------------------');
  console.log(`  Panel del dios : http://localhost:${PORT}`);
  if (lan.length) console.log(`  Red local      : http://${lan[0]}:${PORT}`);
  console.log('  ---------------------------------------------');
  console.log('  Claves de las plataformas:');
  for (const [id, k] of Object.entries(KEYS)) console.log(`    ${id.padEnd(9)} ${k}`);
  console.log('  ---------------------------------------------');
  console.log(`  Reglas para las IA: http://localhost:${PORT}/api/rules`);
  console.log('');
});
