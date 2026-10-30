// test temporal: partida completa con bots, sin navegador
const engine = require('./engine');

let fails = 0;
for (const seed of [1234, 77, 55501, 909090, 31337]) {
  const w = engine.createWorld({ seed });
  const start = w.factions.map(f => f.potential);
  while (w.phase === 'orders') {
    engine.resolveTurn(w);
    // nadie tiene órdenes -> el bot de respaldo juega
  }
  const ranked = w.factions.slice().sort((a, b) => engine.totalScore(b) - engine.totalScore(a));
  console.log(`semilla ${seed} paridad ${w.parity}%  potenciales ${start.join('/')}`);
  for (const f of ranked) {
    const s = engine.scoreOf(f);
    console.log(`   ${f.id.padEnd(9)} pts=${String(engine.totalScore(f)).padStart(4)}  pop=${f.people.length} ref=${f.shelters} com=${f.food.toFixed(0)} mat=${f.mat.toFixed(0)} cie=${f.sci.toFixed(0)}`);
  }
  const alive = w.factions.filter(f => f.alive).length;
  if (alive === 0) { console.log('   !! todas extintas'); fails++; }
  if (ranked[0].people.length === 0) { console.log('   !! ganador sin gente'); fails++; }
  const spread = engine.totalScore(ranked[0]) - engine.totalScore(ranked[2]);
  console.log(`   diferencia 1°-3°: ${spread} pts  ·  turnos ${w.turn - 1}`);
}

// poderes
const w = engine.createWorld({ seed: 4242 });
const before = w.factions[0].food;
console.log('--- poderes ---');
console.log(engine.applyPower(w, { power: 'lluvia', faction: 'claude' }).msg, '| comida', before, '->', w.factions[0].food);
console.log(engine.applyPower(w, { power: 'meteorito', x: w.factions[1].x, y: w.factions[1].y }).msg);
console.log(engine.applyPower(w, { power: 'veta', x: 3, y: 3 }).msg);
console.log(engine.applyPower(w, { power: 'fertilidad', x: 4, y: 4 }).msg);
console.log(engine.applyPower(w, { power: 'nada', x: 4, y: 4 }).error);
w.god.energy = 0;
console.log(engine.applyPower(w, { power: 'plaga', faction: 'codex' }).error);

console.log(fails ? 'FALLOS: ' + fails : 'TODO OK');
process.exit(fails ? 1 : 0);
