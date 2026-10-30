'use strict';
/*
 * Planeta Vivo — simulador de comportamientos
 *
 * Juega partidas enteras sin servidor, sin navegador y sin conectar ninguna IA:
 * cada facción la maneja su bot de respaldo (AI_STYLE en engine.js), que es el
 * que juega cuando una plataforma no manda órdenes.
 *
 * Uso:
 *   node simular.js                     -> 30 partidas y una crónica
 *   node simular.js --partidas 100      -> más partidas
 *   node simular.js --desde 1234        -> semilla inicial (las siguientes van +7919)
 *   node simular.js --semillas 7,77     -> semillas exactas
 *   node simular.js --cronica 55501     -> crónica turno por turno de esa semilla
 *   node simular.js --json salida.json  -> guarda todas las partidas
 */

const engine = require('./engine');
const fs = require('fs');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const N = Math.max(1, Number(opt('partidas', 30)));
const base = Number(opt('desde', 1234));
const seeds = opt('semillas')
  ? opt('semillas').split(',').map(s => Number(s.trim())).filter(Number.isFinite)
  : Array.from({ length: N }, (_, i) => base + i * 7919);
const cronicaSeed = opt('cronica') ? Number(opt('cronica')) : null;

const TASKS = ['food', 'mat', 'build', 'explore', 'rest'];
const IDS = ['claude', 'codex', 'opencode'];

const stat = () => ({
  partidas: 0, victorias: 0, extintas: 0,
  pts: 0, pop: 0, ref: 0, com: 0, mat: 0, cie: 0,
  era: 0, eraTurnos: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  edif: 0, tipos: {},
  ordenes: { food: 0, mat: 0, build: 0, explore: 0, rest: 0 },
  turnosConOrdenes: 0,
  muertesPeligro: 0, muertesHambre: 0, muertesEvento: 0, nacimientos: 0,
  compas: 0
});
const acc = Object.fromEntries(IDS.map(id => [id, stat()]));
const partidas = [];

let turnosTotales = 0;

for (const seed of seeds) {
  const w = engine.createWorld({ seed });
  let turnos = 0;

  while (w.phase === 'orders') {
    engine.resolveTurn(w);
    turnos++;
    for (const f of w.factions) {
      const s = acc[f.id];
      s.eraTurnos[f.era] = (s.eraTurnos[f.era] || 0) + 1;
      const rep = f.lastReport;
      if (!rep || !rep.orders) continue;
      const total = TASKS.reduce((a, k) => a + (rep.orders[k] || 0), 0) || 1;
      for (const k of TASKS) s.ordenes[k] += (rep.orders[k] || 0) / total;
      s.turnosConOrdenes++;
      for (const d of rep.deaths) {
        if (d === 'hambruna') s.muertesHambre++;
        else if (d === 'un peligro del terreno') s.muertesPeligro++;
        else s.muertesEvento++;
      }
      s.nacimientos += rep.births;
    }
  }

  const ranked = w.factions.slice().sort((a, b) => engine.totalScore(b) - engine.totalScore(a));
  turnosTotales += turnos;
  partidas.push({
    seed, turnos, paridad: w.parity,
    ranking: ranked.map((f, i) => ({
      puesto: i + 1, id: f.id, pts: engine.totalScore(f),
      pop: f.people.length, ref: f.shelters,
      com: +f.food.toFixed(0), mat: +f.mat.toFixed(0), cie: +f.sci.toFixed(0)
    }))
  });

  for (const f of w.factions) {
    const s = acc[f.id];
    s.partidas++;
    if (ranked[0].id === f.id) s.victorias++;
    if (!f.alive) s.extintas++;
    s.pts += engine.totalScore(f);
    s.pop += f.people.length;
    s.ref += f.shelters;
    s.com += f.food; s.mat += f.mat; s.cie += f.sci;
    s.era += f.era || 0;
    const bs = Object.values(f.buildings || {});
    s.edif += bs.reduce((a, b) => a + b, 0);
    for (const [k, c] of Object.entries(f.buildings || {})) s.tipos[k] = (s.tipos[k] || 0) + c;
  }
  const scores = ranked.map(f => engine.totalScore(f));
  for (const id of IDS) acc[id].compas += scores[0] - scores[2];
}

/* --------------------------- informe --------------------------- */
const n = partidas.length;
const f1 = v => v.toFixed(1);
const f2 = v => v.toFixed(2);
const pad = (s, len) => String(s).padEnd(len);
const num = (v, len = 6) => String(v).padStart(len);

console.log(`PLANETA VIVO — simulacion de comportamientos (sin conectar nada)`);
console.log(`${n} partida(s) de ${turnosTotales / n} turnos promedio · semillas ${seeds[0]}..${seeds[seeds.length - 1]}`);

console.log(`\nRESULTADO`);
console.log(pad('plataforma', 12) + num('victorias', 10) + num('pts prom', 10) + num('pop', 6) + num('ref', 6) + num('com', 7) + num('mat', 7) + num('cie', 6) + num('extinc', 8));
for (const id of IDS) {
  const s = acc[id], p = s.partidas || 1;
  console.log(pad(id, 12) + num(`${s.victorias}/${s.partidas}`, 10) + num(f1(s.pts / p), 10) +
    num(f1(s.pop / p), 6) + num(f1(s.ref / p), 6) + num(f1(s.com / p), 7) + num(f1(s.mat / p), 7) +
    num(f1(s.cie / p), 6) + num(s.extintas, 8));
}
console.log(`diferencia 1°-3° promedio: ${f1(acc.claude.compas / n)} pts`);

console.log(`\nESTILO OBSERVADO (reparto medio de las ordenes)`);
console.log(pad('plataforma', 12) + num('cosechar', 10) + num('extraer', 9) + num('construir', 11) + num('explorar', 10) + num('descansar', 11));
for (const id of IDS) {
  const s = acc[id], t = s.turnosConOrdenes || 1;
  console.log(pad(id, 12) + num(f1(s.ordenes.food / t * 100) + '%', 10) + num(f1(s.ordenes.mat / t * 100) + '%', 9) +
    num(f1(s.ordenes.build / t * 100) + '%', 11) + num(f1(s.ordenes.explore / t * 100) + '%', 10) +
    num(f1(s.ordenes.rest / t * 100) + '%', 11));
}

console.log(`\nVIDA Y MUERTE (por partida)`);
console.log(pad('plataforma', 12) + num('nacim.', 8) + num('peligro', 9) + num('hambre', 8) + num('eventos', 9));
for (const id of IDS) {
  const s = acc[id], p = s.partidas || 1;
  console.log(pad(id, 12) + num(f2(s.nacimientos / p), 8) + num(f2(s.muertesPeligro / p), 9) +
    num(f2(s.muertesHambre / p), 8) + num(f2(s.muertesEvento / p), 9));
}

console.log(`\nDESARROLLO (eras)`);
console.log(pad('plataforma', 12) + num('era fin', 9) + num('prehist.', 10) + num('neolít.', 9) + num('clásica', 9) + num('industr.', 10) + num('moderna', 9) + num('futuro', 8));
for (const id of IDS) {
  const s = acc[id], p = s.partidas || 1;
  console.log(pad(id, 12) + num(f2(s.era / p), 9) +
    [0, 1, 2, 3, 4, 5].map(e => num(f1((s.eraTurnos[e] || 0) / p), e === 0 ? 10 : e === 3 ? 10 : 9)).join(''));
}

console.log(`\nEDIFICIOS (por partida)`);
console.log(pad('plataforma', 12) + num('total', 7) + '   ' + Object.keys(engine.BUILDINGS).map(k => pad(k, 9)).join(''));
for (const id of IDS) {
  const s = acc[id], p = s.partidas || 1;
  console.log(pad(id, 12) + num(f2(s.edif / p), 7) + '   ' + Object.keys(engine.BUILDINGS).map(k => pad(f1((s.tipos[k] || 0) / p), 9)).join(''));
}

/* --------------------------- crónica --------------------------- */
const seedCronica = cronicaSeed ?? seeds[0];
const w = engine.createWorld({ seed: seedCronica });
console.log(`\nCRONICA — semilla ${seedCronica} (paridad ${w.parity}%)`);
const corto = t => t.replace(/^[^:]+:\s*/, '');
const sigla = { claude: 'Cl', codex: 'Cx', opencode: 'Op' };
while (w.phase === 'orders') {
  const r = engine.resolveTurn(w);
  if (!r.ok) break;
  const marcas = ['nació', 'refugio', 'hambruna', 'extinguió', 'plaga', 'enfermedad', 'meteorito', 'temblor', 'era'];
  const notas = r.logs.filter(l => marcas.some(m => l.includes(m))).map(corto).slice(0, 3);
  const ordenes = w.factions.map(f => {
    const o = f.lastReport && f.lastReport.orders;
    if (!o) return '';
    return `${sigla[f.id]} ${f.people.length}p ${o.food}/${o.mat}/${o.build}/${o.explore}/${o.rest}`;
  }).join('  ');
  console.log(`T${String(r.turn).padStart(2)}  ${ordenes}${notas.length ? '  · ' + notas.join(' · ') : ''}`);
}
const ranked = w.factions.slice().sort((a, b) => engine.totalScore(b) - engine.totalScore(a));
console.log(`FIN: ${ranked.map((f, i) => `${i + 1}° ${f.name} ${engine.totalScore(f)}`).join(' · ')}`);
console.log('cada turno: cosechar/extraer/construir/explorar/descansar · Cl Claude, Cx Codex, Op OpenCode');

if (opt('json')) {
  const salida = opt('json');
  fs.writeFileSync(salida, JSON.stringify({ partidas, resumen: Object.fromEntries(IDS.map(id => [id, acc[id]])) }, null, 2));
  console.log(`\nJSON: ${salida}`);
}
