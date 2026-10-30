'use strict';
/*
 * Planeta Vivo — motor de simulación
 * Reglas deterministas, resolución simultánea. Sin dependencias.
 */

const W = 240, H = 160, MAX_TURNS = 60;

const BIOMES = {
  agua:     { n: 'océano',   c: '#0f344b', food: 0, mat: 0, land: false },
  costa:    { n: 'costa',    c: '#b09e70', food: 1, mat: 1 },
  pradera:  { n: 'pradera',  c: '#4f7d45', food: 3, mat: 0 },
  bosque:   { n: 'bosque',   c: '#24523a', food: 2, mat: 2 },
  estepa:   { n: 'estepa',   c: '#8a8b4e', food: 1, mat: 1 },
  desierto: { n: 'desierto', c: '#a2874f', food: 0, mat: 1 },
  tundra:   { n: 'tundra',   c: '#7b9398', food: 1, mat: 1 },
  montana:  { n: 'montaña',  c: '#5f6169', food: 0, mat: 2 },
  volcan:   { n: 'volcán',   c: '#523a3d', food: 0, mat: 3 }
};

const HAZARDS = {
  volcan: { n: 'respiradero volcánico', g: '🌋', risk: 0.13, pen: 0.55 },
  falla:  { n: 'falla sísmica',         g: '⚡', risk: 0.10, pen: 0.70 },
  nido:   { n: 'nido de depredadores',  g: '🦴', risk: 0.12, pen: 0.60 },
  bruma:  { n: 'bruma tóxica',          g: '☣',  risk: 0.09, pen: 0.65 }
};

const TASKS = {
  food:    { name: 'cosechar',  icon: '🌾', desc: 'junta comida según el terreno (pradera 3)' },
  mat:     { name: 'extraer',   icon: '⛏',  desc: 'junta materiales (montaña 3, volcán 4)' },
  build:   { name: 'construir', icon: '🏠', desc: 'gasta 2 materiales por persona; 3 de obra = 1 refugio' },
  explore: { name: 'explorar',  icon: '🧭', desc: 'da ciencia, revela vetas (+1 a un recurso)' },
  rest:    { name: 'descansar', icon: '😴', desc: 'recupera ánimo y no corre riesgos' }
};

const FACTIONS = [
  { id: 'claude',   name: 'Claude',   color: '#d97757', style: 'estratega' },
  { id: 'codex',    name: 'Codex',    color: '#3ddc97', style: 'ingeniero' },
  { id: 'opencode', name: 'OpenCode', color: '#7aa2ff', style: 'explorador' }
];

const POWERS = {
  lluvia:     { name: 'lluvia fértil', icon: '🌧', cost: 2, target: 'faction', desc: '+4 de comida y +3 de ánimo' },
  bendicion:  { name: 'bendición',     icon: '🕊', cost: 2, target: 'faction', desc: '+8 de ánimo' },
  plaga:      { name: 'plaga',         icon: '🦠', cost: 3, target: 'faction', desc: 'mata 1 persona si no hay 2 refugios' },
  terremoto:  { name: 'terremoto',     icon: '🌋', cost: 3, target: 'faction', desc: '−1 refugio y −6 de ánimo' },
  meteorito:  { name: 'meteorito',     icon: '☄️', cost: 4, target: 'tile',    desc: 'mata a quien esté trabajando cerca' },
  veta:       { name: 'veta oculta',   icon: '💎', cost: 3, target: 'tile',    desc: '+1 permanente a un recurso del casillero' },
  fertilidad: { name: 'fertilidad',    icon: '🌱', cost: 2, target: 'tile',    desc: '+1 comida permanente (máx 5)' }
};

/* Eras: el desarrollo va de la prehistoria al futuro y es lento a propósito.
   Cada era se paga con ciencia acumulada y abre radio de trabajo (espacio),
   capacidad por refugio y techo de población. Los rindes del terreno NO suben:
   lo que crece es el alcance, así el progreso es territorial, no inflacionario. */
const ERAS = [
  { n: 'prehistoria', icon: '🪨', sci: 0,   radius: 5.6,  cap: 4,  popMax: 20 },
  { n: 'neolítico',   icon: '🌾', sci: 30,  radius: 7.0,  cap: 5,  popMax: 26 },
  { n: 'clásica',     icon: '🏛', sci: 90,  radius: 8.5,  cap: 6,  popMax: 34 },
  { n: 'industrial',  icon: '⚙️', sci: 180, radius: 10.0, cap: 7,  popMax: 44 },
  { n: 'moderna',     icon: '🔌', sci: 300, radius: 12.5, cap: 8,  popMax: 56 },
  { n: 'futurista',   icon: '🚀', sci: 440, radius: 15.0, cap: 10, popMax: 72 }
];
const eraOf = f => ERAS[clamp(f.era || 0, 0, ERAS.length - 1)];
const nextEra = f => ERAS[(f.era || 0) + 1] || null;

/* Edificios: la salida de los materiales. Se construyen con la tarea `build` y un
   `blueprint` en las órdenes; si no hay blueprint se sigue haciendo refugios.
   Cada copia cuesta 60 % más materiales (el material no se acumula de gusto). */
const BUILDINGS = {
  granero:  { n: 'granero',  icon: '🌾', era: 1, cost: 8,  work: 6,  food: 2,  desc: '+2 comida por turno' },
  taller:   { n: 'taller',   icon: '🔧', era: 2, cost: 12, work: 8,  mat: 1,   desc: '+1 material por turno' },
  templo:   { n: 'templo',   icon: '🏛', era: 2, cost: 10, work: 8,  sci: 1,   desc: '+1 ciencia por turno' },
  muralla:  { n: 'muralla',  icon: '🧱', era: 3, cost: 16, work: 10, shield: 1, desc: '−40 % riesgo del terreno y plagas contenidas' },
  fabrica:  { n: 'fábrica',  icon: '🏭', era: 3, cost: 20, work: 12, mat: 3,   desc: '+3 materiales por turno' },
  academia: { n: 'academia', icon: '🔭', era: 4, cost: 22, work: 14, sci: 2,   desc: '+2 ciencia por turno' },
  cupula:   { n: 'cúpula',   icon: '🛰',  era: 5, cost: 28, work: 18, food: 3, sci: 2, desc: '+3 comida y +2 ciencia por turno' }
};
const buildingCost = (f, key) => Math.round(BUILDINGS[key].cost * (1 + 0.6 * ((f.buildings && f.buildings[key]) || 0)));
const buildingCount = f => Object.values(f.buildings || {}).reduce((a, b) => a + b, 0);
function projectTarget(f) {
  const bp = f.blueprint;
  if (bp && BUILDINGS[bp] && (f.era || 0) >= BUILDINGS[bp].era) return bp;
  return 'refugio';
}

/* ------------------------------- util ------------------------------- */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function quantile(sorted, q) { return sorted[clamp(Math.floor(q * (sorted.length - 1)), 0, sorted.length - 1)]; }

function valueNoise(rng, cols, rows) {
  const g = [];
  for (let y = 0; y <= rows; y++) { const row = []; for (let x = 0; x <= cols; x++) row.push(rng()); g.push(row); }
  return (u, v) => {
    const fx = u * cols, fy = v * rows;
    const x0 = Math.min(cols - 1, Math.floor(fx)), y0 = Math.min(rows - 1, Math.floor(fy));
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = g[y0][x0], b = g[y0][x0 + 1], c = g[y0 + 1][x0], d = g[y0 + 1][x0 + 1];
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
  };
}
function fbmField(rng, octaves) {
  const layers = [];
  let amp = 1, freq = 3.0;
  for (let o = 0; o < octaves; o++) {
    const cols = Math.max(2, Math.round(freq));
    const rows = Math.max(2, Math.round(freq * H / W));
    layers.push({ f: valueNoise(rng, cols, rows), amp });
    amp *= 0.52; freq *= 2.1;
  }
  const total = layers.reduce((s, l) => s + l.amp, 0);
  return (u, v) => { let s = 0; for (const l of layers) s += l.f(u, v) * l.amp; return s / total; };
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(Math.round(((n >> 16) & 255) + amt), 0, 255);
  const g = clamp(Math.round(((n >> 8) & 255) + amt), 0, 255);
  const b = clamp(Math.round((n & 255) + amt), 0, 255);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

/* ---------------------------- generación ---------------------------- */
function generatePlanet(seed) {
  const rng = mulberry32(seed);
  const elevF = fbmField(rng, 5);
  const moistF = fbmField(rng, 4);
  const e = [], m = [];

  for (let y = 0; y < H; y++) {
    const re = [], rm = [];
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1), v = y / (H - 1);
      const dx = (u - 0.5) * 2, dy = (v - 0.5) * 2;
      const d = Math.sqrt(dx * dx * 0.85 + dy * dy * 1.15);
      re.push(elevF(u, v) - Math.pow(clamp(d / 0.74, 0, 1.35), 2.25) * 0.78);
      rm.push(moistF(u, v));
    }
    e.push(re); m.push(rm);
  }
  const flat = e.flat().slice().sort((a, b) => a - b);
  const flatM = m.flat().slice().sort((a, b) => a - b);
  const waterT = quantile(flat, 0.42);
  const coastT = quantile(flat, 0.47);
  const montT = quantile(flat, 0.88);
  /* la humedad se corta por cuantiles, no por valores fijos: así secos y
     húmedos ocupan siempre una franja pareja del planeta y hay variedad. */
  const desT = quantile(flatM, 0.15);
  const estT = quantile(flatM, 0.38);
  const praT = quantile(flatM, 0.74);

  const grid = [];
  for (let y = 0; y < H; y++) {
    const row = [];
    for (let x = 0; x < W; x++) {
      const v = e[y][x], moi = m[y][x], lat = Math.abs(y / (H - 1) - 0.5) * 2;
      let b;
      if (v < waterT) b = 'agua';
      else if (v < coastT) b = 'costa';
      else if (v > montT) b = moi < desT ? 'volcan' : 'montana';
      else if (lat > 0.71 + (moi - 0.5) * 0.34) b = 'tundra';  // borde ondulado, no una franja recta
      else if (moi < desT) b = 'desierto';
      else if (moi < estT) b = 'estepa';
      else if (moi < praT) b = 'pradera';
      else b = 'bosque';

      const def = BIOMES[b];
      row.push({
        x, y, b,
        food: def.food, mat: def.mat,
        land: def.land !== false,
        c: shade(def.c, (rng() - 0.5) * 16),
        hazard: null, veta: null, vetaSeen: false, seen: false
      });
    }
    grid.push(row);
  }
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? null : grid[y][x];

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = grid[y][x];
    if (!t.land || t.b === 'agua' || t.b === 'costa') continue;
    const base = (t.b === 'montana' || t.b === 'volcan') ? 0.10 : (t.b === 'bosque' ? 0.06 : 0.045);
    if (rng() < base) {
      const pool = (t.b === 'montana' || t.b === 'volcan') ? ['volcan', 'falla', 'falla']
        : (t.b === 'bosque' || t.b === 'pradera') ? ['nido', 'bruma']
          : ['bruma', 'nido', 'falla'];
      t.hazard = pool[Math.floor(rng() * pool.length)];
    }
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = grid[y][x];
    if (!t.land || t.b === 'agua' || t.hazard) continue;
    if (rng() < 0.055) t.veta = rng() < 0.5 ? 'food' : 'mat';
  }

  const localScore = (x, y) => {
    let s = 0, food = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const t = at(x + dx, y + dy);
      if (!t || !t.land || t.b === 'agua') continue;
      const w = 1 - (Math.abs(dx) + Math.abs(dy)) / 8;
      if (w <= 0) continue;
      s += (t.food * 1.6 + t.mat * 0.7) * w;
      food += t.food * w;
    }
    return { s, food };
  };

  const cands = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = grid[y][x];
    if (!t.land || t.b === 'agua' || t.b === 'costa' || t.hazard || t.veta) continue;
    const ls = localScore(x, y);
    if (ls.food < 6.5) continue; // sin comida cerca no hay aldea viable
    cands.push({ x, y, s: ls.s });
  }
  if (cands.length < 3) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = grid[y][x];
      if (!t.land || t.b === 'agua' || t.hazard) continue;
      cands.push({ x, y, s: localScore(x, y).s });
    }
  }
  cands.sort((a, b) => a.s - b.s);
  const bandStart = Math.floor(cands.length * 0.30);
  const band = cands.slice(bandStart, Math.min(cands.length, bandStart + 260));

  /* los tres asentamientos tienen que quedar lejos entre sí: probamos
     distancias decrecientes hasta que entre un trío en la isla. */
  const lado = Math.min(W, H);
  const seps = [0.46, 0.36, 0.27, 0.18, 0.10].map(k => Math.max(6, Math.round(lado * k)));

  let best = null, bestErr = Infinity, bestSep = 0;
  for (const minSep of seps) {
    let found = null, err = Infinity;
    outer:
    for (let i = 0; i < band.length; i++) {
      for (let j = i + 1; j < band.length; j++) {
        if (Math.max(Math.abs(band[i].x - band[j].x), Math.abs(band[i].y - band[j].y)) < minSep) continue;
        for (let k = j + 1; k < band.length; k++) {
          const A = band[i], B = band[j], C = band[k];
          if (Math.max(Math.abs(A.x - C.x), Math.abs(A.y - C.y)) < minSep) continue;
          if (Math.max(Math.abs(B.x - C.x), Math.abs(B.y - C.y)) < minSep) continue;
          const mean = (A.s + B.s + C.s) / 3;
          const spread = (Math.max(A.s, B.s, C.s) - Math.min(A.s, B.s, C.s)) / Math.max(1, mean);
          if (spread < err) { err = spread; found = [A, B, C]; }
          if (err < 0.008) break outer;
        }
      }
    }
    if (found) { best = found; bestErr = err; bestSep = minSep; break; }
  }
  if (!best) {
    const land = cands[cands.length - 1] || { x: Math.floor(W / 2), y: Math.floor(H / 2), s: 1 };
    best = [land, land, land];
    bestErr = 0.35;
  }
  for (const sp of best) {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const t = at(sp.x + dx, sp.y + dy);
      if (t && t.land) t.hazard = null;
    }
  }

  return { grid, at, spawns: best, parity: Math.round(clamp(1 - bestErr, 0, 1) * 100) };
}

/* ----------------------------- mundo ----------------------------- */
let personSeq = 0;

function createWorld({ seed, maxTurns = MAX_TURNS, keys = {} }) {
  const planet = generatePlanet(seed);
  const world = {
    seed,
    turn: 1,
    maxTurns,
    phase: 'orders',
    parity: planet.parity,
    grid: planet.grid,
    spawns: planet.spawns,
    rng: mulberry32((seed ^ 0x9e3779b9) >>> 0),
    deck: [],
    log: [],
    fx: [],
    mapVersion: 1,
    turnStart: Date.now(),
    settings: { autoBots: true, waitMs: 90000 },
    god: { energy: 4, max: 10 },
    factions: []
  };

  const order = shuffle([0, 1, 2], world.rng);
  world.factions = FACTIONS.map((def, i) => {
    const sp = planet.spawns[order[i]];
    const f = {
      id: def.id, name: def.name, color: def.color, style: def.style,
      key: keys[def.id] || null,
      x: sp.x, y: sp.y,
      potential: Math.round(sp.s),
      people: [], food: 16, mat: 4, sci: 0, shelters: 0, morale: 70, progress: 0,
      era: 0, buildings: {}, project: null, blueprint: null,
      alive: true, submitted: false, fallback: false, lastSeen: 0, lastOrderAt: 0,
      orders: { food: 0, mat: 0, build: 0, explore: 0, rest: 0 },
      lastReport: null,
      _cache: null
    };
    for (let k = 0; k < 6; k++) addPerson(f, world.rng);
    f.orders = botOrders(f, 0);
    return f;
  });

  for (const f of world.factions) {
    revealCircle(world, f.x, f.y, 6);
    pushLog(world, 0, `🚩 ${f.name} se asienta en (${f.x},${f.y}) · potencial del terreno ${f.potential}`, f.id);
  }
  pushLog(world, 0, `🪐 Planeta generado · semilla ${seed} · paridad del terreno ${world.parity}%`, null);
  pushLog(world, 0, `⏳ Turno 1 abierto: esperando las órdenes de las 3 plataformas`, null);
  return world;
}

function pushLog(world, turn, text, fid) {
  world.log.unshift({ turn, text, fid: fid || null });
  if (world.log.length > 200) world.log.length = 200;
}

function addPerson(f, rng) {
  const p = {
    id: ++personSeq,
    x: f.x + 0.5 + (rng() - 0.5) * 0.9,
    y: f.y + 0.5 + (rng() - 0.5) * 0.9,
    tx: 0, ty: 0, task: 'rest'
  };
  p.tx = p.x; p.ty = p.y;
  f.people.push(p);
  return p;
}

function revealCircle(world, cx, cy, r) {
  let found = 0;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const t = (x < 0 || y < 0 || x >= W || y >= H) ? null : world.grid[y][x];
      if (!t) continue;
      if (Math.hypot(x - cx, y - cy) > r) continue;
      t.seen = true;
      if (t.veta && !t.vetaSeen) { t.vetaSeen = true; found++; }
    }
  }
  return found;
}

/* ------------------------------- IA ------------------------------- */
const AI_STYLE = {
  claude:   { food: 0.40, mat: 0.20, build: 0.22, explore: 0.14, rest: 0.04 },
  codex:    { food: 0.34, mat: 0.27, build: 0.24, explore: 0.11, rest: 0.04 },
  opencode: { food: 0.34, mat: 0.18, build: 0.14, explore: 0.30, rest: 0.04 }
};

/* a qué edificio va cada una cuando hay material de sobra */
const BUILD_PREF = {
  claude:   ['granero', 'templo', 'academia', 'cupula'],
  codex:    ['taller', 'muralla', 'fabrica', 'cupula'],
  opencode: ['templo', 'academia', 'cupula', 'granero']
};

function distribute(pop, weights) {
  const keys = Object.keys(weights);
  const sum = keys.reduce((s, k) => s + Math.max(0, weights[k] || 0), 0) || 1;
  const raw = keys.map(k => ({ k, v: Math.max(0, weights[k] || 0) / sum * pop }));
  const out = {};
  let used = 0;
  for (const r of raw) { out[r.k] = Math.floor(r.v); used += out[r.k]; }
  const rem = raw.slice().sort((a, b) => (b.v - Math.floor(b.v)) - (a.v - Math.floor(a.v)));
  let i = 0;
  while (used < pop && rem.length) { out[rem[i % rem.length].k]++; used++; i++; }
  return out;
}

function botOrders(f, turn) {
  const base = AI_STYLE[f.id] || AI_STYLE.claude;
  const w = { ...base };
  const pop = f.people.length || 1;
  const era = eraOf(f);
  const cap = f.shelters * era.cap;

  // emergencia: sin comida no hay nada
  if (f.food < pop * 0.8) return distribute(pop, { food: 0.92, mat: 0.03, build: 0, explore: 0.05, rest: 0 });
  if (f.food < pop * 1.6) { w.food += 0.55; w.explore *= 0.3; w.rest *= 0.5; w.build *= 0.6; }
  else w.food = Math.max(w.food, 0.34);

  const matNeed = 3 + Math.floor(f.shelters / 4);   // los refugios se encarecen con la cantidad
  const upkeep = buildingCount(f);
  // edificios: cada plataforma tiene su vocación; primero la casa, después la obra
  const pref = BUILD_PREF[f.id] || BUILD_PREF.claude;
  const roomy = f.shelters * era.cap >= pop + 2;
  const pick = roomy ? pref.find(k => (f.era || 0) >= BUILDINGS[k].era && (f.buildings[k] || 0) < 3) : null;
  f.blueprint = pick || null;

  if (f.mat < matNeed + upkeep) { w.build *= 0.25; w.mat += 0.14; }
  const needShelters = Math.ceil(pop / era.cap);
  if (cap < pop + 1) { w.build += 0.22; w.mat += 0.10; }
  else if (f.shelters >= needShelters + 1) { w.build = Math.min(w.build, 0.03); w.food += 0.06; w.explore += 0.03; }
  if (turn < 3) { w.explore *= 0.25; w.food += 0.10; }
  if (f.morale < 45) w.rest += 0.08;
  // empujón de investigación cuando falta poco para la próxima era
  const nx = nextEra(f);
  if (nx && nx.sci - f.sci < 20 && f.food > pop * 1.6) { w.explore += 0.18; w.build *= 0.8; }
  if (pick) w.build += 0.16;

  /* Material: sólo se junta lo que se va a gastar (mantenimiento de unos turnos +
     la próxima obra). Si ya hay de sobra, esas manos van a comida o a ciencia. */
  const reserve = upkeep * 6 + (pick ? buildingCost(f, pick) : matNeed * 3);
  if (f.mat > reserve) { const wm = w.mat; w.mat = 0; w.food += wm * 0.6; w.explore += wm * 0.4; }
  return distribute(pop, w);
}

/* --------------------------- resolución --------------------------- */
function workTiles(world, f, kind) {
  const cache = f._cache || (f._cache = {});
  if (cache[kind]) return cache[kind];
  const list = [];
  const reach = eraOf(f).radius;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = world.grid[y][x];
    if (!t.land || t.b === 'agua') continue;
    const dist = Math.hypot(x - f.x, y - f.y);
    if (dist > reach) continue;
    const val = kind === 'food'
      ? t.food + (t.veta === 'food' ? 1 : 0)
      : t.mat + (t.veta === 'mat' ? 1 : 0);
    if (val <= 0) continue;
    list.push({ t, val, dist });
  }
  list.sort((a, b) => (b.val - b.dist * 0.30) - (a.val - a.dist * 0.30));
  cache[kind] = list.slice(0, 5).map(o => o.t);
  if (!cache[kind].length) cache[kind] = [nearestLand(world, f)];
  return cache[kind];
}

function nearestLand(world, f) {
  let best = null, bd = Infinity;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = world.grid[y][x];
    if (!t.land || t.b === 'agua') continue;
    const d = Math.hypot(x - f.x, y - f.y);
    if (d < bd) { bd = d; best = t; }
  }
  return best || world.grid[Math.round(f.y)][Math.round(f.x)];
}

function hazardRisk(f, t) {
  const hz = HAZARDS[t.hazard];
  if (!hz) return 0;
  const wall = (f.buildings && f.buildings.muralla) ? 0.6 : 1;
  return hz.risk * wall * (1 - Math.min(0.35, f.shelters * 0.05));
}

function resolveFaction(world, f, rng) {
  const d = { food: 0, mat: 0, sci: 0, progress: 0, morale: 0, deaths: [], builds: [] };
  if (!f.people.length) return d;

  const tasks = [];
  for (const k of ['food', 'mat', 'build', 'explore', 'rest'])
    for (let i = 0; i < Math.max(0, f.orders[k] || 0); i++) tasks.push(k);

  const mul = 0.85 + (f.morale / 100) * 0.40;
  const foodTiles = workTiles(world, f, 'food');
  const matTiles = workTiles(world, f, 'mat');
  let fi = 0, mi = 0;

  for (let i = 0; i < f.people.length; i++) {
    const p = f.people[i];
    const task = tasks[i] || 'rest';
    p.task = task;

    if (task === 'rest') {
      d.morale += 1.6;
      p.tx = f.x + 0.5 + (rng() - 0.5) * 1.3;
      p.ty = f.y + 0.5 + (rng() - 0.5) * 1.3;
      continue;
    }

    if (task === 'explore') {
      d.sci += 1 + (f.era || 0) * 0.35;
      d.morale += 0.5;
      const ang = rng() * Math.PI * 2, r = 3.5 + rng() * 6.5;
      p.tx = clamp(f.x + Math.cos(ang) * r, 0.4, W - 0.4);
      p.ty = clamp(f.y + Math.sin(ang) * r, 0.4, H - 0.4);
      const found = revealCircle(world, p.tx, p.ty, 2.8);
      if (found) d.sci += found * 1.5;
      continue;
    }

    if (task === 'build') {
      const key = projectTarget(f);
      if (key === 'refugio') {
        const cost = 2 + Math.floor(f.shelters / 4);   // cada tanda de refugios cuesta más
        if (f.mat + d.mat >= cost) {
          d.mat -= cost;
          d.progress += mul;
          p.tx = f.x + 0.5 + (rng() - 0.5) * 1.6;
          p.ty = f.y + 0.5 + (rng() - 0.5) * 1.6;
        } else {
          const t = foodTiles[fi++ % foodTiles.length];
          p.tx = t.x + 0.5 + (rng() - 0.5) * 0.6;
          p.ty = t.y + 0.5 + (rng() - 0.5) * 0.6;
          if (t.hazard && rng() < hazardRisk(f, t)) { d.deaths.push(p.id); continue; }
          d.food += (t.food + (t.veta === 'food' ? 1 : 0)) * mul * 0.8;
        }
      } else {
        const b = BUILDINGS[key];
        if (!f.project || f.project.key !== key) {
          const cost = buildingCost(f, key);
          if (f.mat + d.mat >= cost) { f.project = { key, prog: 0 }; d.mat -= cost; }
          else {   // sin materiales: a cosechar mientras tanto
            const t = foodTiles[fi++ % foodTiles.length];
            p.tx = t.x + 0.5 + (rng() - 0.5) * 0.6;
            p.ty = t.y + 0.5 + (rng() - 0.5) * 0.6;
            if (t.hazard && rng() < hazardRisk(f, t)) { d.deaths.push(p.id); continue; }
            d.food += (t.food + (t.veta === 'food' ? 1 : 0)) * mul * 0.8;
            continue;
          }
        }
        f.project.prog += mul;
        p.tx = f.x + 0.5 + (rng() - 0.5) * 1.6;
        p.ty = f.y + 0.5 + (rng() - 0.5) * 1.6;
        if (f.project.prog >= b.work) {
          f.buildings[key] = (f.buildings[key] || 0) + 1;
          f.project = null;
          f.morale = clamp(f.morale + 4, 5, 100);
          d.builds.push(key);
        }
      }
      continue;
    }

    const kind = task === 'food' ? 'food' : 'mat';
    const list = kind === 'food' ? foodTiles : matTiles;
    const t = list[(kind === 'food' ? fi++ : mi++) % list.length];
    p.tx = t.x + 0.5 + (rng() - 0.5) * 0.6;
    p.ty = t.y + 0.5 + (rng() - 0.5) * 0.6;

    if (t.hazard && rng() < hazardRisk(f, t)) {
      d.deaths.push(p.id);
      world.fx.push({ x: t.x + 0.5, y: t.y + 0.5, type: 'death' });
      continue;
    }
    let g = (kind === 'food'
      ? t.food + (t.veta === 'food' ? 1 : 0)
      : t.mat + (t.veta === 'mat' ? 1 : 0)) * mul * (0.88 + rng() * 0.26);
    if (t.hazard) g *= HAZARDS[t.hazard].pen;
    if (kind === 'food') d.food += g; else d.mat += g;
  }
  return d;
}

function killPerson(world, f, id, cause, report, logs) {
  const idx = f.people.findIndex(p => p.id === id);
  if (idx < 0) return false;
  const p = f.people[idx];
  world.fx.push({ x: p.tx, y: p.ty, type: 'death' });
  f.people.splice(idx, 1);
  report.deaths.push(cause);
  logs.push(`${f.name}: perdió una persona por ${cause}`);
  return true;
}

function applyDeltas(world, f, d, rng, report, logs) {
  // mantenimiento: cada edificio pide 1 material por turno; si no alcanza, rinde en proporción
  const total = buildingCount(f);
  let upkeep = 1;
  if (total > 0) {
    const pay = Math.min(f.mat, total);
    upkeep = pay / total;
    f.mat -= pay;
    if (upkeep < 1) {
      report.events.push(`no pudo mantener ${Math.ceil(total - pay)} edificio(s)`);
      logs.push(`${f.name}: no pudo mantener ${Math.ceil(total - pay)} edificio(s)`);
    }
  }
  for (const key of Object.keys(f.buildings || {})) {
    const b = BUILDINGS[key], count = f.buildings[key] || 0;
    if (!b || !count) continue;
    const scale = count * upkeep;
    if (b.food) { f.food += b.food * scale; report.harvest.food += b.food * scale; }
    if (b.mat) { f.mat += b.mat * scale; report.harvest.mat += b.mat * scale; }
    if (b.sci) { f.sci += b.sci * scale; report.harvest.sci += b.sci * scale; }
  }

  f.food += d.food;
  f.mat += d.mat;
  f.sci += d.sci;
  f.progress += d.progress;
  f.morale = clamp(f.morale + d.morale, 5, 100);

  report.harvest.food += d.food;
  report.harvest.mat += d.mat;
  report.harvest.sci += d.sci;

  while (f.progress >= 3) {
    f.progress -= 3;
    f.shelters++;
    f.morale = clamp(f.morale + 6, 5, 100);
    report.events.push(`levantó un refugio (${f.shelters})`);
  }

  for (const id of d.deaths) killPerson(world, f, id, 'un peligro del terreno', report, logs);
  for (const key of d.builds || []) {
    report.events.push(`terminó ${BUILDINGS[key].icon} ${BUILDINGS[key].n}`);
    logs.push(`${f.name}: terminó ${BUILDINGS[key].icon} ${BUILDINGS[key].n}`);
  }

  if (f.people.length > 0) {
    const need = Math.round(f.people.length * (1 + f.people.length * 0.03));
    if (f.food >= need) {
      f.food -= need;
      f.morale = clamp(f.morale + 1.5, 5, 100);
      report.harvest.food -= need;
    } else {
      const deficit = need - f.food;
      f.food = 0;
      f.morale = clamp(f.morale - 10, 5, 100);
      report.events.push(`pasó hambre: faltaron ${deficit.toFixed(1)} de comida`);
      const hungry = Math.max(1, Math.ceil(deficit / 3));
      const maxDeaths = Math.min(2, hungry);
      for (let i = 0; i < maxDeaths && f.people.length; i++) {
        const victim = f.people[Math.floor(rng() * f.people.length)];
        if (victim) killPerson(world, f, victim.id, 'hambruna', report, logs);
      }
    }
  }

  const era = eraOf(f);
  const cap = f.shelters * era.cap;
  if (f.people.length > 0 && f.people.length < era.popMax && f.people.length < cap && f.food > f.people.length * 2.6 + 5) {
    const cost = 3 + f.people.length * 0.35;   // cada persona nueva sale más cara: desarrollo lento
    if (f.food >= cost) {
      f.food -= cost;
      const p = addPerson(f, rng);
      report.births++;
      report.events.push(`nació una persona (${f.people.length} en total)`);
      world.fx.push({ x: p.x, y: p.y, type: 'birth' });
    }
  }

  if (f.shelters * era.cap < f.people.length) f.morale = clamp(f.morale - 3, 5, 100);
  f.morale = clamp(f.morale, 5, 100);
}

/* ---------------------------- eventos ---------------------------- */
const GLOBAL_EVENTS = [
  { n: 'lluvia fértil', run(w, logs) { for (const fa of alive(w)) { fa.food += 3; fa.morale = clamp(fa.morale + 3, 5, 100); } logs.push('lluvia fértil: +3 comida y +3 ánimo para todos'); } },
  { n: 'tormenta solar', run(w, logs) { for (const fa of alive(w)) { fa.mat = Math.max(0, fa.mat - 2); fa.progress = Math.max(0, fa.progress - 1); } logs.push('tormenta solar: −2 materiales y −1 obra para todos'); } },
  { n: 'feria de trueque', run(w, logs) { for (const fa of alive(w)) { fa.mat += 2; fa.sci += 1; } logs.push('feria de trueque: +2 materiales y +1 ciencia para todos'); } },
  { n: 'plaga global', run(w, logs, rng) { for (const fa of alive(w)) { if ((fa.buildings && fa.buildings.muralla) || fa.shelters >= 2) { fa.morale = clamp(fa.morale - 3, 5, 100); } else { const v = fa.people[Math.floor(rng() * fa.people.length)]; if (v) { const rep = fa.lastReport || emptyReport(w.turn); killPerson(w, fa, v.id, 'la plaga global', rep, logs); } } } logs.push('plaga global: castiga a quien no tiene refugios'); } },
  { n: 'eclipse', run(w, logs) { for (const fa of alive(w)) { fa.morale = clamp(fa.morale - 4, 5, 100); fa.sci += 2; } logs.push('eclipse: −4 ánimo y +2 ciencia para todos'); } },
  { n: 'ola de calor', run(w, logs) { for (const fa of alive(w)) fa.food = Math.max(0, fa.food - 3); logs.push('ola de calor: −3 comida para todos'); } }
];
function world_fxdeath(w, p) { w.fx.push({ x: p.tx, y: p.ty, type: 'death' }); }

const PERSONAL_EVENTS = [
  { n: 'sequía', run: (w, f) => { f.food = Math.max(0, f.food - 2); f.morale = clamp(f.morale - 4, 5, 100); return 'sequía: −3 comida'; } },
  { n: 'veta nueva', run: (w, f) => { f.mat += 3; return 'hallazgo de una veta: +3 materiales'; } },
  { n: 'enfermedad', run: (w, f, rng, rep, logs) => { if ((f.buildings && f.buildings.muralla) || f.shelters >= 2) { f.morale = clamp(f.morale - 5, 5, 100); return 'enfermedad contenida por los refugios'; } const v = f.people[Math.floor(rng() * f.people.length)]; if (v) killPerson(w, f, v.id, 'una enfermedad', rep, logs); return 'enfermedad: −1 persona'; } },
  { n: 'caravana', run: (w, f) => { f.food += 2; f.mat += 2; return 'caravana de paso: +2 comida y +2 materiales'; } },
  { n: 'temblor', run: (w, f) => { if (f.shelters > 0 && f.progress < 1.5) { f.shelters--; f.morale = clamp(f.morale - 6, 5, 100); return 'un temblor derribó un refugio'; } f.progress = Math.max(0, f.progress - 1.5); return 'temblor: obra retrasada'; } },
  { n: 'inspiración', run: (w, f) => { f.sci += 2; f.morale = clamp(f.morale + 4, 5, 100); return 'inspiración: +2 ciencia'; } },
  { n: 'migración', run: (w, f) => { if (f.shelters * 4 > f.people.length && f.food > 5 && f.people.length < 20) { f.food -= 2; addPerson(f, w.rng); return 'gente nueva se suma'; } return 'pasó una migración sin quedarse'; } }
];

function alive(w) { return w.factions.filter(f => f.alive); }

function roundEvents(world, rng, logs) {
  if (rng() < 0.45) {
    const pool = GLOBAL_EVENTS.filter(e => !(e.n === 'plaga global' && world.turn < 3));
    const g = pool[Math.floor(rng() * pool.length)];
    g.run(world, logs, rng);
  }
  for (const f of shuffle(alive(world), rng)) {
    if (!world.deck.length) world.deck = shuffle(PERSONAL_EVENTS, rng);
    const card = world.deck.pop();
    const rep = f.lastReport || (f.lastReport = emptyReport(world.turn));
    const txt = card.run(world, f, rng, rep, logs);
    rep.events.push(`${card.n}: ${txt}`);
    logs.push(`${f.name}: ${card.n} — ${txt}`);
  }
  if (rng() < 0.30) {
    const hz = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (world.grid[y][x].hazard) hz.push(world.grid[y][x]);
    if (hz.length) {
      const t = hz[Math.floor(rng() * hz.length)];
      t.seen = true;
      world.fx.push({ x: t.x + 0.5, y: t.y + 0.5, type: 'hazard' });
      let victim = null, victimFac = null;
      for (const f of alive(world)) for (const p of f.people) {
        if (Math.hypot(p.tx - (t.x + 0.5), p.ty - (t.y + 0.5)) < 1.6) { victim = p; victimFac = f; break; }
      }
      if (victim && victimFac) {
        const rep = victimFac.lastReport || (victimFac.lastReport = emptyReport(world.turn));
        killPerson(world, victimFac, victim.id, HAZARDS[t.hazard].n, rep, logs);
      }
      logs.push(`${HAZARDS[t.hazard].n} en (${t.x},${t.y})${victim ? '' : ': sin víctimas'}`);
    }
  }
}

function checkEra(world, f, logs) {
  let nx = nextEra(f);
  while (nx && f.sci >= nx.sci) {
    f.era = (f.era || 0) + 1;
    f._cache = null;
    f.morale = clamp(f.morale + 10, 5, 100);
    logs.push(`${eraOf(f).icon} ${f.name} entra en la era ${eraOf(f).n} (${f.sci.toFixed(0)} de ciencia)`);
    nx = nextEra(f);
  }
}

function emptyReport(turn) {  return {
    turn,
    harvest: { food: 0, mat: 0, sci: 0 },
    deaths: [],
    births: 0,
    events: [],
    popStart: 0,
    popEnd: 0
  };
}

/* ---------------------------- turno ---------------------------- */
function resolveTurn(world) {
  if (world.phase !== 'orders') return { ok: false, error: 'la partida terminó' };
  const rng = world.rng;
  world.fx = [];
  const logs = [];
  const turn = world.turn;

  for (const f of world.factions) f._cache = null;

  for (const f of alive(world)) {
    if (!f.submitted || !f.orders) { f.orders = botOrders(f, turn); f.fallback = true; }
    else { f.orders = distribute(f.people.length, f.orders); f.fallback = false; }
    f.lastReport = emptyReport(turn);
    f.lastReport.popStart = f.people.length;
    f.lastReport.orders = { ...f.orders };
  }

  const results = alive(world).map(f => ({ f, d: resolveFaction(world, f, rng) }));
  for (const { f, d } of results) { applyDeltas(world, f, d, rng, f.lastReport, logs); checkEra(world, f, logs); }

  roundEvents(world, rng, logs);

  for (const f of world.factions) {
    if (f.alive && f.people.length === 0) {
      f.alive = false;
      logs.push(`${f.name} se extinguió en el turno ${turn}`);
    }
    if (f.lastReport) f.lastReport.popEnd = f.people.length;
  }

  world.god.energy = clamp(world.god.energy + 1, 0, world.god.max);

  for (const t of logs) pushLog(world, turn, t, null);
  world.turn++;
  world.turnStart = Date.now();
  for (const f of world.factions) f.submitted = false;

  if (world.turn > world.maxTurns || world.factions.every(f => !f.alive)) {
    world.phase = 'over';
    const ranked = world.factions.slice().sort((a, b) => totalScore(b) - totalScore(a));
    pushLog(world, turn, `🏆 Fin de la partida: gana ${ranked[0].name} con ${totalScore(ranked[0])} puntos`, null);
  } else {
    pushLog(world, world.turn, `⏳ Turno ${world.turn} abierto: esperando las órdenes de las 3 plataformas`, null);
  }
  return { ok: true, turn, logs };
}

function setOrders(world, fid, orders) {
  const f = world.factions.find(x => x.id === fid);
  if (!f) return { ok: false, error: 'facción desconocida' };
  if (!f.alive) return { ok: false, error: 'tu facción se extinguió' };
  if (world.phase !== 'orders') return { ok: false, error: 'la partida terminó' };

  const clean = { food: 0, mat: 0, build: 0, explore: 0, rest: 0 };
  for (const k of Object.keys(clean)) {
    const v = Number(orders[k]);
    if (Number.isFinite(v) && v > 0) clean[k] = Math.floor(v);
  }
  const total = Object.values(clean).reduce((s, v) => s + v, 0);
  const pop = f.people.length;
  if (total === 0) return { ok: false, error: 'órdenes vacías: asigná al menos una persona' };
  if (total > pop) return { ok: false, error: `asignaste ${total} personas y tenés ${pop}` };

  f.orders = clean;
  if (orders.blueprint !== undefined) {
    const bp = orders.blueprint === null || orders.blueprint === '' || orders.blueprint === 'refugio' ? null : String(orders.blueprint);
    if (bp && !BUILDINGS[bp]) return { ok: false, error: 'edificio desconocido: ' + Object.keys(BUILDINGS).join(', ') };
    if (bp && (f.era || 0) < BUILDINGS[bp].era) return { ok: false, error: `${BUILDINGS[bp].n} necesita la era ${ERAS[BUILDINGS[bp].era].n}` };
    f.blueprint = bp;
  }
  f.submitted = true;
  f.fallback = false;
  f.lastOrderAt = Date.now();
  f.lastSeen = Date.now();
  return { ok: true, faction: f.id, orders: clean, blueprint: f.blueprint, turn: world.turn, waiting: alive(world).filter(x => !x.submitted).map(x => x.id) };
}

/* ---------------------------- poderes ---------------------------- */
function applyPower(world, { power, faction, x, y }) {
  const p = POWERS[power];
  if (!p) return { ok: false, error: 'poder desconocido' };
  if (world.phase === 'over') return { ok: false, error: 'la partida terminó' };
  if (world.god.energy < p.cost) return { ok: false, error: `necesitás ${p.cost} de energía` };

  const f = faction ? world.factions.find(x2 => x2.id === faction) : null;
  const t = (Number.isInteger(x) && Number.isInteger(y)) ? world.grid[y] && world.grid[y][x] : null;

  if (p.target === 'faction' && (!f || !f.alive)) return { ok: false, error: 'facción inválida' };
  if (p.target === 'tile' && !t) return { ok: false, error: 'casillero inválido' };

  let msg = '';
  switch (power) {
    case 'lluvia':
      f.food += 4; f.morale = clamp(f.morale + 3, 5, 100);
      msg = `lluvia fértil sobre ${f.name}: +4 comida`;
      break;
    case 'bendicion':
      f.morale = clamp(f.morale + 8, 5, 100);
      msg = `bendición sobre ${f.name}: +8 ánimo`;
      break;
    case 'plaga': {
      if (f.shelters >= 2) { f.morale = clamp(f.morale - 4, 5, 100); msg = `plaga sobre ${f.name}: contenida por los refugios`; }
      else {
        const v = f.people[Math.floor(world.rng() * f.people.length)];
        if (v) {
          world.fx.push({ x: v.tx, y: v.ty, type: 'death' });
          const rep = f.lastReport || emptyReport(world.turn);
          killPerson(world, f, v.id, 'la plaga divina', rep, []);
        }
        msg = `plaga sobre ${f.name}: −1 persona`;
      }
      break;
    }
    case 'terremoto':
      if (f.shelters > 0) f.shelters--;
      f.morale = clamp(f.morale - 6, 5, 100);
      f.progress = Math.max(0, f.progress - 1);
      msg = `terremoto sobre ${f.name}: −1 refugio`;
      break;
    case 'meteorito': {
      let killed = 0;
      for (const fa of alive(world)) {
        for (const person of fa.people.slice()) {
          if (Math.hypot(person.tx - (x + 0.5), person.ty - (y + 0.5)) < 1.4) {
            const rep = fa.lastReport || emptyReport(world.turn);
            killPerson(world, fa, person.id, 'un meteorito', rep, []);
            killed++;
          }
        }
      }
      world.fx.push({ x: x + 0.5, y: y + 0.5, type: 'hazard' });
      msg = `meteorito en (${x},${y}): ${killed} muerte(s)`;
      break;
    }
    case 'veta': {
      t.veta = world.rng() < 0.5 ? 'food' : 'mat';
      t.vetaSeen = true; t.seen = true;
      t.food = t.veta === 'food' ? t.food + 1 : t.food;
      t.mat = t.veta === 'mat' ? t.mat + 1 : t.mat;
      world.mapVersion++;
      msg = `veta de ${t.veta === 'food' ? 'comida' : 'material'} en (${x},${y})`;
      break;
    }
    case 'fertilidad':
      t.food = Math.min(5, t.food + 1);
      t.seen = true;
      t.c = shade(t.c, 6);
      world.mapVersion++;
      msg = `fertilidad en (${x},${y}): comida ${t.food}`;
      break;
    default:
      return { ok: false, error: 'poder desconocido' };
  }

  world.god.energy -= p.cost;
  world.mapVersion++;
  pushLog(world, world.turn, `✨ Dios: ${msg}`, null);
  return { ok: true, msg };
}

/* ---------------------------- puntajes ---------------------------- */
function scoreOf(f) {
  const pop = f.people.length;
  const huts = Math.min(f.shelters, Math.ceil(pop / 4));
  return {
    pop: pop * 12,
    refugios: huts * 8,
    comida: Math.round(Math.sqrt(Math.max(0, f.food)) * 6),
    material: Math.round(Math.sqrt(Math.max(0, f.mat)) * 7),
    ciencia: Math.round(f.sci * 1.6),
    era: (f.era || 0) * 18,
    edificios: buildingCount(f) * 10
  };
}
function totalScore(f) {
  const s = scoreOf(f);
  return s.pop + s.refugios + s.comida + s.material + s.ciencia + s.era + s.edificios;
}

/* ---------------------------- snapshot ---------------------------- */
function snapshot(world, god) {
  return {
    seed: world.seed,
    turn: world.turn,
    maxTurns: world.maxTurns,
    phase: world.phase,
    parity: world.parity,
    mapVersion: world.mapVersion,
    turnStart: world.turnStart,
    now: Date.now(),
    settings: world.settings,
    god: world.god,
    deck: world.deck.length,
    factions: world.factions.map(f => ({
      id: f.id, name: f.name, color: f.color, style: f.style,
      x: f.x, y: f.y, alive: f.alive, potential: f.potential,
      pop: f.people.length, food: Math.round(f.food * 10) / 10, mat: Math.round(f.mat * 10) / 10,
      sci: Math.round(f.sci * 10) / 10, shelters: f.shelters, morale: Math.round(f.morale),
      progress: Math.round(f.progress * 10) / 10,
      era: f.era || 0, eraName: eraOf(f).n, eraIcon: eraOf(f).icon, eraRadius: eraOf(f).radius,
      eraCap: eraOf(f).cap, eraPopMax: eraOf(f).popMax, eraBase: eraOf(f).sci,
      nextEraName: nextEra(f) ? nextEra(f).n : null,
      nextEraAt: nextEra(f) ? nextEra(f).sci : null,
      nextEraIn: nextEra(f) ? Math.max(0, Math.ceil(nextEra(f).sci - f.sci)) : null,
      buildings: f.buildings || {}, buildingCount: buildingCount(f),
      project: f.project || null, blueprint: f.blueprint || null,
      submitted: f.submitted, fallback: f.fallback,
      online: Date.now() - f.lastSeen < 90000,
      lastSeenAgo: f.lastSeen ? Date.now() - f.lastSeen : null,
      score: totalScore(f),
      orders: (god || world.phase === 'over') ? f.orders : null,
      report: f.lastReport,
      people: f.people.map(p => ({ id: p.id, x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, task: p.task }))
    })),
    log: world.log.slice(0, 120),
    fx: world.fx
  };
}

function mapSnapshot(world) {
  return {
    version: world.mapVersion,
    w: W, h: H,
    grid: world.grid.map(row => row.map(t => [t.b, t.c, t.hazard || '', t.vetaSeen ? t.veta : '', t.food, t.mat]))
  };
}

module.exports = {
  W, H, MAX_TURNS, BIOMES, HAZARDS, TASKS, FACTIONS, POWERS, ERAS, BUILDINGS,
  createWorld, resolveTurn, setOrders, applyPower, snapshot, mapSnapshot,
  scoreOf, totalScore, botOrders, distribute, alive
};









