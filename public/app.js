'use strict';

const $ = s => document.querySelector(s);
const canvas = $('#map');
const ctx = canvas.getContext('2d');
const tooltip = $('#tooltip');

/* ===================================================================
   mundo en píxeles: cada casillero mide TILE px del mundo (no de pantalla).
   La cámara (cam) traduce y escala el mundo al canvas.
   =================================================================== */
const TILE = 100;
const TAU = Math.PI * 2;
const BASE_BUDGET = 20e6;           // píxeles del lienzo de terreno cacheado (memoria)
let BASE = 0.35;                    // píxeles cacheados por píxel de mundo (se calcula por mapa)
const MINI_W = 220;                 // ancho del minimapa en pantalla
const TASK_COLOR = { food: '#a8e08a', mat: '#d8c08a', build: '#e8a45c', explore: '#8ec7ff', rest: '#aab9c9' };

let META = null, MAP = null, ST = null, DEADLINE = null, KEYS = null;
let sel = null, hover = null;
let effects = [], anim = new Map(), lastTurn = null, overShown = false;
let toastTimer = null;

let DPR = 1, VW = 0, VH = 0;
const cam = { x: 0, y: 0, s: 1 };
let fitS = 1, maxZoom = 3;
let base = null, baseDirty = true;
let deco = [], WF = null, BCOLOR = {};
let bgGrad = null, bgKey = '';
let miniCtx = null, miniBase = null, miniDirty = true;

/* ----------------------------- red ----------------------------- */
async function jget(url) { const r = await fetch(url, { cache: 'no-store' }); return r.json(); }
async function jpost(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  return r.json();
}
function toast(msg, bad) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'on' + (bad ? ' bad' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = bad ? 'bad' : ''; }, 2600);
}
function esc(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ---------------------------- inicio ---------------------------- */
async function init() {
  META = await jget('/api/meta');
  KEYS = await jget('/api/keys');
  for (const [k, v] of Object.entries(META.BIOMES)) BCOLOR[k] = v.c;
  buildLegend();
  renderKeys();
  layout();
  await loadMap();
  await poll();
  setInterval(poll, 900);
  requestAnimationFrame(loop);

  let rt = null;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { layout(); baseDirty = true; }, 160);
  });
}

function layout() {
  const wrap = canvas.parentElement;
  VW = Math.max(320, Math.floor(wrap.clientWidth));
  VH = Math.round(clamp(window.innerHeight * 0.68, 420, 900));
  DPR = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(VW * DPR);
  canvas.height = Math.round(VH * DPR);
  canvas.style.width = VW + 'px';
  canvas.style.height = VH + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  sizeMini();
  if (MAP) { recomputeFit(); clampCam(); updateZoomLbl(); }
}

/* el lienzo cacheado del terreno se reparte en un presupuesto de píxeles:
   con un planeta gigante se cachea a menos resolución por píxel de mundo. */
function computeBaseScale() {
  if (!MAP) return 0.35;
  const worldPx = (MAP.w * TILE) * (MAP.h * TILE);
  return clamp(Math.sqrt(BASE_BUDGET / worldPx), 0.08, 1);
}

function recomputeFit() {
  if (!MAP || !VW) return;
  BASE = computeBaseScale();
  fitS = Math.min(VW / (MAP.w * TILE), VH / (MAP.h * TILE));
  maxZoom = Math.max(fitS * 1.2, Math.min(BASE * 2.2, fitS * 40));
  cam.s = clamp(cam.s || fitS, fitS, maxZoom);
  miniDirty = true;
}

function resetCam() {
  if (!MAP) return;
  BASE = computeBaseScale();
  fitS = Math.min(VW / (MAP.w * TILE), VH / (MAP.h * TILE));
  maxZoom = Math.max(fitS * 1.2, Math.min(BASE * 2.2, fitS * 40));
  cam.s = fitS;                                       // arranca con el planeta entero a la vista
  cam.x = VW / 2 - (MAP.w * TILE * cam.s) / 2;
  cam.y = VH / 2 - (MAP.h * TILE * cam.s) / 2;
  sizeMini();
  clampCam();
  updateZoomLbl();
}

function clampCam() {
  if (!MAP) return;
  const w = MAP.w * TILE * cam.s, h = MAP.h * TILE * cam.s;
  cam.x = w <= VW ? (VW - w) / 2 : clamp(cam.x, VW - w, 0);
  cam.y = h <= VH ? (VH - h) / 2 : clamp(cam.y, VH - h, 0);
  miniDirty = true;
}

function updateZoomLbl() {
  const el = $('#zoomlbl');
  if (el) el.textContent = Math.round((cam.s / (fitS || 1)) * 100) + '%';
}

/* ---------------------------- minimapa ---------------------------- */
function sizeMini() {
  const el = $('#mini');
  if (!el) return;
  const h = Math.round(MINI_W * (MAP ? MAP.h / MAP.w : 0.667));
  el.width = Math.round(MINI_W * DPR);
  el.height = Math.round(h * DPR);
  el.style.width = MINI_W + 'px';
  el.style.height = h + 'px';
  miniCtx = el.getContext('2d');
  miniCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
  miniDirty = true;
}

function drawMini() {
  const el = $('#mini');
  if (!miniCtx || !miniBase || !MAP || !el) return;
  const mw = MINI_W, mh = parseInt(el.style.height, 10) || 147;
  miniCtx.clearRect(0, 0, mw, mh);
  miniCtx.drawImage(miniBase, 0, 0, mw, mh);

  const fx = mw / (MAP.w * TILE), fy = mh / (MAP.h * TILE);
  const vx = (-cam.x / cam.s) * fx, vy = (-cam.y / cam.s) * fy;
  const vw = (VW / cam.s) * fx, vh = (VH / cam.s) * fy;
  miniCtx.strokeStyle = 'rgba(255,212,121,.85)';
  miniCtx.lineWidth = 1.3;
  miniCtx.strokeRect(clamp(vx, 1, mw - 2), clamp(vy, 1, mh - 2), clamp(vw, 2, mw - 2), clamp(vh, 2, mh - 2));

  if (ST) {
    for (const f of ST.factions) {
      const mx = (f.x + 0.5) * TILE * fx, my = (f.y + 0.5) * TILE * fy;
      miniCtx.beginPath();
      miniCtx.fillStyle = f.alive ? f.color : '#51606f';
      miniCtx.arc(mx, my, f.alive ? 3.4 : 2.4, 0, TAU);
      miniCtx.fill();
      miniCtx.strokeStyle = 'rgba(4,8,12,.8)'; miniCtx.lineWidth = 1; miniCtx.stroke();
    }
  }
  miniCtx.strokeStyle = 'rgba(34,48,63,1)';
  miniCtx.lineWidth = 1;
  miniCtx.strokeRect(0.5, 0.5, mw - 1, mh - 1);
}

function zoomAt(sx, sy, factor) {
  if (!MAP) return;
  const wx = (sx - cam.x) / cam.s, wy = (sy - cam.y) / cam.s;
  cam.s = clamp(cam.s * factor, fitS, maxZoom);
  cam.x = sx - wx * cam.s;
  cam.y = sy - wy * cam.s;
  clampCam();
  updateZoomLbl();
}

async function loadMap() {
  MAP = await jget('/api/map');
  baseDirty = true;
  resetCam();
}

async function poll() {
  try {
    const d = await jget('/api/state');
    ST = d.world;
    DEADLINE = d.deadline;
    if (!MAP || MAP.version !== ST.mapVersion) await loadMap();
    if (lastTurn !== null && ST.turn > lastTurn) {
      for (const fx of (ST.fx || [])) effects.push({ ...fx, age: 0, life: 1.9 });
      baseDirty = true;
    }
    lastTurn = ST.turn;
    miniDirty = true;
    render();
  } catch (e) {
    $('#conns').textContent = 'servidor sin respuesta';
  }
}

/* ---------------------------- DOM ---------------------------- */
function buildLegend() {
  $('#legend').innerHTML =
    Object.entries(META.BIOMES).map(([k, v]) => `<span><i style="background:${v.c}"></i>${v.n}</span>`).join('') +
    Object.values(META.HAZARDS).map(h => `<span>${h.g} ${h.n}</span>`).join('') +
    `<span>💎 veta</span><span style="color:#a8e08a">verde = comida</span><span style="color:#d8c08a">ocre = materiales</span>`;
}

function render() {
  if (!ST) return;
  $('#turn').textContent = `turno ${Math.min(ST.turn, ST.maxTurns)} / ${ST.maxTurns}`;
  const ph = $('#phase');
  if (ST.phase === 'over') { ph.className = 'badge over'; ph.textContent = 'partida terminada'; }
  else { ph.className = 'badge wait'; ph.textContent = 'esperando órdenes'; }
  $('#energy').textContent = `✨ ${ST.god.energy}/${ST.god.max}`;
  $('#planetinfo').textContent = `semilla ${ST.seed} · paridad del terreno ${ST.parity}% · mazo ${ST.deck} cartas`;

  const online = ST.factions.filter(f => f.alive && f.online).length;
  $('#conns').innerHTML = ST.factions.map(f =>
    `<span style="color:${f.alive ? (f.online ? f.color : '#4b5c70') : '#33414f'}">${f.alive ? (f.online ? '●' : '○') : '✕'}</span>`
  ).join(' ') + ` <span style="color:#5f7286">${online}/3 conectadas</span>`;

  renderCards();
  renderLog();
  renderSel();
  if (ST.phase === 'over' && !overShown) showOver();
}

function renderCards() {
  const energy = ST.god.energy;
  $('#cards').innerHTML = ST.factions.map(f => {
    const badge = !f.alive ? '<span class="badge over">extinta</span>'
      : f.submitted ? '<span class="badge ok">órdenes listas</span>'
        : '<span class="badge wait">esperando</span>';
    const orders = f.orders && Object.values(f.orders).some(v => v > 0)
      ? Object.entries(f.orders).filter(([, v]) => v > 0)
        .map(([k, v]) => `<span class="chip">${META.TASKS[k].icon} ${v}</span>`).join('')
      : '<span class="empty">—</span>';
    const rep = f.report;
    const eraPct = f.nextEraAt
      ? clamp((f.sci - f.eraBase) / Math.max(1, f.nextEraAt - f.eraBase) * 100, 0, 100)
      : 100;
    const eraLabel = f.nextEraName
      ? `${f.eraIcon} ${f.eraName} → ${f.nextEraName} · faltan ${f.nextEraIn} 🔬`
      : `${f.eraIcon} ${f.eraName} · era final`;
    const repLine = rep
      ? `T${rep.turn}: 🌾${rep.harvest.food >= 0 ? '+' : ''}${rep.harvest.food.toFixed(1)} ⛏+${rep.harvest.mat.toFixed(1)} 🔬+${rep.harvest.sci.toFixed(1)}`
        + (rep.deaths.length ? ` · 💀${rep.deaths.length}` : '')
        + (rep.births ? ` · 👶${rep.births}` : '')
      : 'sin reporte todavía';

    const powers = Object.entries(META.POWERS).filter(([, p]) => p.target === 'faction').map(([k, p]) => {
      const dis = !f.alive || energy < p.cost || ST.phase === 'over';
      return `<button class="pw" data-power="${k}" data-faction="${f.id}" ${dis ? 'disabled' : ''}
        title="${p.name} · ${p.desc} (${p.cost}✨)">${p.icon}<i>${p.cost}</i></button>`;
    }).join('');

    return `<div class="card ${f.alive ? '' : 'dead'}" style="--c:${f.color}">
      <div class="head">
        <span class="nm">${f.name}</span>
        <span class="tag">${f.style}</span>
        <span class="tag era">${f.eraIcon} ${f.eraName}</span>
        <span class="conn ${f.online ? 'on' : ''}" title="${f.online ? 'plataforma conectada' : 'sin señales'}">${f.online ? '●' : '○'}</span>
        <span class="pts">${f.score} pts</span>
      </div>
      <div style="margin-top:6px">${badge}</div>
      <div class="stats">
        <span title="población / techo de la era">👥 <b>${f.pop}</b><span class="det">/${f.eraPopMax}</span></span>
        <span>🌾 <b>${f.food}</b></span>
        <span>⛏ <b>${f.mat}</b></span>
        <span>🏠 <b>${f.shelters}</b></span>
        <span>🔬 <b>${f.sci}</b></span>
        <span>❤ <b>${f.morale}</b></span>
      </div>
      <div class="era" title="${esc(eraLabel)}"><i style="width:${eraPct}%"></i><span>${esc(eraLabel)}</span></div>
      <div class="morale"><i style="width:${clamp(f.morale, 0, 100)}%"></i></div>
      <div class="orow2">${orders}</div>
      <div class="report">${esc(repLine)}${f.fallback ? ' · ⚙ jugó el bot' : ''}</div>
      <div class="pwrow">${powers}</div>
    </div>`;
  }).join('');
}

function renderLog() {
  $('#log').innerHTML = ST.log.slice(0, 70).map(e =>
    `<div class="le${e.text.startsWith('✨') ? ' god' : ''}"><span class="t">T${e.turn}</span><span>${esc(e.text)}</span></div>`
  ).join('');
}

function renderSel() {
  const bar = $('#selbar');
  if (!sel || !MAP) {
    bar.innerHTML = '<span class="hint">hacé clic en el mapa para apuntar un poder divino · rueda = zoom · arrastrá = mover</span>';
    return;
  }
  const [b, , hazard, veta, food, mat] = MAP.grid[sel.y][sel.x];
  const def = META.BIOMES[b];
  const hz = hazard ? `<span class="tile">${META.HAZARDS[hazard].g} ${META.HAZARDS[hazard].n}</span>` : '';
  const vt = veta ? `<span class="tile">💎 veta de ${veta === 'food' ? 'comida' : 'material'}</span>` : '';
  const powers = Object.entries(META.POWERS).filter(([, p]) => p.target === 'tile').map(([k, p]) => {
    const dis = ST.god.energy < p.cost || ST.phase === 'over';
    return `<button class="pw" data-power="${k}" data-x="${sel.x}" data-y="${sel.y}" ${dis ? 'disabled' : ''}
      title="${p.name} · ${p.desc} (${p.cost}✨)">${p.icon} ${p.name}<i>${p.cost}</i></button>`;
  }).join('');
  bar.innerHTML = `<span class="tile">${def.n} · 🌾${food} ⛏${mat} · (${sel.x},${sel.y})</span>${hz}${vt}${powers}`;
}

function renderKeys() {
  $('#keylist').innerHTML = META.FACTIONS.map(f => `
    <div class="krow" style="--c:${f.color}">
      <span class="kn">${f.name}</span>
      <code>${esc(KEYS[f.id])}</code>
      <button data-copy="${esc(KEYS[f.id])}">copiar</button>
    </div>`).join('');
}

/* --------------------------- interacción --------------------------- */
function clientToWorld(cx, cy) {
  const r = canvas.getBoundingClientRect();
  return { x: ((cx - r.left) - cam.x) / cam.s, y: ((cy - r.top) - cam.y) / cam.s };
}
function tileAtWorld(w) {
  const x = Math.floor(w.x / TILE), y = Math.floor(w.y / TILE);
  if (x < 0 || y < 0 || x >= MAP.w || y >= MAP.h) return null;
  return { x, y };
}

let drag = null;
canvas.addEventListener('pointerdown', ev => {
  if (ev.button !== 0 || !MAP) return;
  drag = { px: ev.clientX, py: ev.clientY, cx: cam.x, cy: cam.y, moved: 0 };
  canvas.setPointerCapture(ev.pointerId);
  canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', ev => {
  const r = canvas.getBoundingClientRect();
  if (drag) {
    const dx = ev.clientX - drag.px, dy = ev.clientY - drag.py;
    drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
    cam.x = drag.cx + dx; cam.y = drag.cy + dy;
    clampCam();
    tooltip.classList.remove('on');
    return;
  }
  hover = tileAtWorld({ x: ((ev.clientX - r.left) - cam.x) / cam.s, y: ((ev.clientY - r.top) - cam.y) / cam.s });
  if (!hover) { tooltip.classList.remove('on'); return; }
  const [b, , hazard, veta, food, mat] = MAP.grid[hover.y][hover.x];
  const def = META.BIOMES[b];
  const fac = ST.factions.find(f => f.x === hover.x && f.y === hover.y && f.alive);
  let html = `<b>${def.n}</b> · (${hover.x},${hover.y})<br>`;
  if (def.land === false) html += 'nadie puede trabajar acá';
  else html += `comida <span style="color:#a8e08a">${food}</span> · materiales <span style="color:#d8c08a">${mat}</span>`;
  if (hazard) html += `<br><span style="color:#ef8a7a">${META.HAZARDS[hazard].g} ${META.HAZARDS[hazard].n}</span>`;
  if (veta) html += `<br><span style="color:#ffd479">💎 veta de ${veta === 'food' ? 'comida' : 'material'}</span>`;
  if (fac) html += `<br><span style="color:${fac.color}">🏠 aldea de ${fac.name}</span>`;
  tooltip.innerHTML = html;
  const wrapRect = canvas.parentElement.getBoundingClientRect();
  tooltip.style.left = (ev.clientX - wrapRect.left) + 'px';
  tooltip.style.top = (ev.clientY - wrapRect.top) + 'px';
  tooltip.classList.add('on');
});
canvas.addEventListener('pointerup', ev => {
  if (!drag) return;
  const moved = drag.moved;
  drag = null;
  canvas.classList.remove('dragging');
  if (moved < 5) {
    const t = tileAtWorld(clientToWorld(ev.clientX, ev.clientY));
    if (t) { sel = t; renderSel(); }
  }
});
canvas.addEventListener('pointercancel', () => { drag = null; canvas.classList.remove('dragging'); });
canvas.addEventListener('pointerleave', () => { hover = null; tooltip.classList.remove('on'); });

canvas.addEventListener('wheel', ev => {
  if (!MAP) return;
  ev.preventDefault();
  const r = canvas.getBoundingClientRect();
  const f = ev.deltaY < 0 ? 1.2 : 1 / 1.2;
  zoomAt(ev.clientX - r.left, ev.clientY - r.top, f);
}, { passive: false });

canvas.addEventListener('dblclick', ev => {
  const r = canvas.getBoundingClientRect();
  zoomAt(ev.clientX - r.left, ev.clientY - r.top, 1.7);
});

document.addEventListener('click', async ev => {
  const copy = ev.target.closest('button[data-copy]');
  if (copy) {
    try { await navigator.clipboard.writeText(copy.dataset.copy); toast('clave copiada'); }
    catch { toast('no pude copiar, seleccioná a mano', true); }
    return;
  }
  const b = ev.target.closest('button[data-power]');
  if (!b || b.disabled) return;
  const body = { power: b.dataset.power };
  if (b.dataset.faction) body.faction = b.dataset.faction;
  if (b.dataset.x !== undefined) { body.x = +b.dataset.x; body.y = +b.dataset.y; }
  const r = await jpost('/api/god', body);
  toast(r.ok ? '✨ ' + r.msg : r.error, !r.ok);
  poll();
});

function bindControls() {
  $('#force').onclick = async () => {
    const r = await jpost('/api/force');
    toast(r.ok ? `turno resuelto (${r.turn})` : r.error, !r.ok);
    poll();
  };
  $('#newmap').onclick = async () => {
    const seed = parseInt($('#seed').value, 10);
    const r = await jpost('/api/new', { seed: Number.isFinite(seed) ? seed : 0 });
    if (r.ok) {
      overShown = false;
      $('#over').classList.remove('on');
      effects = []; anim.clear(); lastTurn = null; sel = null;
      $('#seed').value = r.seed;
      toast(`planeta nuevo · semilla ${r.seed} · paridad ${r.parity}%`);
      await loadMap();
      poll();
    }
  };
  $('#autobots').onchange = async e => {
    await jpost('/api/settings', { autoBots: e.target.checked });
    toast(e.target.checked ? 'bots de respaldo activados' : 'la partida espera a las 3 IA sin límite');
    poll();
  };
  $('#zin').onclick = () => zoomAt(VW / 2, VH / 2, 1.35);
  $('#zout').onclick = () => zoomAt(VW / 2, VH / 2, 1 / 1.35);
  $('#zfit').onclick = () => { cam.s = fitS; clampCam(); updateZoomLbl(); };
  $('#yields').onchange = () => { };

  const mini = $('#mini');
  if (mini) mini.addEventListener('click', ev => {
    if (!MAP) return;
    const r = mini.getBoundingClientRect();
    const fx = (ev.clientX - r.left) / r.width, fy = (ev.clientY - r.top) / r.height;
    if (cam.s < 30 / TILE) cam.s = clamp(58 / TILE, fitS, maxZoom);   // si estaba en vista de planeta, acerca
    cam.x = VW / 2 - fx * MAP.w * TILE * cam.s;
    cam.y = VH / 2 - fy * MAP.h * TILE * cam.s;
    clampCam();
    updateZoomLbl();
  });
}
bindControls();

/* ---------------------------- cierre ---------------------------- */
function showOver() {
  overShown = true;
  const ranked = ST.factions.slice().sort((a, b) => b.score - a.score);
  const rows = ranked.map((f, i) => `
    <div class="rrow" style="--c:${f.color}">
      <span class="pos">${i + 1}°</span>
      <span><span class="who">${f.name}</span><br><span class="det">👥${f.pop} · 🏠${f.shelters} · 🌾${f.food} · ⛏${f.mat} · 🔬${f.sci}</span></span>
      <span class="sc">${f.score}</span>
    </div>`).join('');
  $('#mod').innerHTML = `
    <h2>🏆 ${ranked[0].name} dominó el planeta</h2>
    <div class="sub">${ST.turn - 1} turnos · semilla ${ST.seed} · paridad del terreno ${ST.parity}%</div>
    <div class="rank">${rows}</div>
    <div class="acts">
      <button id="closeover">ver el mapa</button>
      <button id="again" class="primary">planeta nuevo</button>
    </div>`;
  $('#over').classList.add('on');
  $('#closeover').onclick = () => $('#over').classList.remove('on');
  $('#again').onclick = () => $('#newmap').click();
}

/* ---------------------------- bucle ---------------------------- */
function loop(now) {
  const dt = Math.min(0.05, (now - (loop.last || now)) / 1000);
  loop.last = now;
  draw(dt);
  if (miniDirty) { drawMini(); miniDirty = false; }
  updateDeadline();
  requestAnimationFrame(loop);
}

function updateDeadline() {
  const fill = $('#deadlinefill');
  const lbl = $('#countdown');
  if (!ST || ST.phase === 'over') { fill.style.width = '100%'; lbl.textContent = '—'; return; }
  if (!DEADLINE) { fill.style.width = '100%'; fill.style.background = '#2b4258'; lbl.textContent = 'sin límite'; return; }
  const total = ST.settings.waitMs;
  const left = Math.max(0, DEADLINE - Date.now());
  fill.style.width = `${clamp(left / total * 100, 0, 100)}%`;
  fill.style.background = left < 15000 ? 'linear-gradient(90deg,#ef6a5a,#ffb35c)' : 'linear-gradient(90deg,#3ddc97,#7aa2ff)';
  lbl.textContent = `${Math.ceil(left / 1000)}s`;
}

/* ======================== terreno orgánico ======================== */
function hash(x, y, i) {
  const n = Math.sin(x * 127.1 + y * 311.7 + i * 74.7) * 43758.5453;
  return n - Math.floor(n);
}
function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, 11), b = hash(xi + 1, yi, 11);
  const c = hash(xi, yi + 1, 11), d = hash(xi + 1, yi + 1, 11);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
function fbm(x, y) {
  return noise2(x, y) * 0.58 + noise2(x * 2.3 + 5.1, y * 2.3 - 3.7) * 0.28 + noise2(x * 4.7 - 11.3, y * 4.7 + 8.9) * 0.14;
}

function hexRGB(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function lighten(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) + amt);
  const g = Math.min(255, ((n >> 8) & 255) + amt);
  const b = Math.min(255, (n & 255) + amt);
  return `rgb(${r},${g},${b})`;
}

/* textura de grano reutilizable */
let NT = null;
function noiseTex() {
  if (NT) return NT;
  NT = new Uint8Array(256 * 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const v = fbm(x * 0.055, y * 0.055) * 0.75 + hash(x, y, 3) * 0.25;
      NT[y * 256 + x] = Math.round(clamp(v, 0, 1) * 255);
    }
  }
  return NT;
}

/* desplazamiento orgánico: los bordes de bioma dejan de ser rectos */
const WF_RES = 7;                       // muestras de distorsión por casillero
function buildWarp() {
  const W = MAP.w, H = MAP.h;
  const GW = W * WF_RES, GH = H * WF_RES;
  const wx = new Float32Array((GW + 1) * (GH + 1));
  const wy = new Float32Array((GW + 1) * (GH + 1));
  for (let j = 0; j <= GH; j++) {
    const ty = (j / GH) * H;
    for (let i = 0; i <= GW; i++) {
      const tx = (i / GW) * W;
      const k = j * (GW + 1) + i;
      wx[k] = (fbm(tx * 0.9, ty * 0.9) * 2 - 1) * 0.52;
      wy[k] = (fbm(tx * 0.9 + 37.2, ty * 0.9 - 11.7) * 2 - 1) * 0.52;
    }
  }
  WF = { wx, wy, GW, GH };
}

/* bioma (y casillero) que corresponde a un punto del mundo, ya distorsionado */
function biomeAt(tx, ty) {
  const { wx, wy, GW, GH } = WF;
  const W = MAP.w, H = MAP.h;
  const gx = clamp(tx / W * GW, 0, GW - 0.001), gy = clamp(ty / H * GH, 0, GH - 0.001);
  const i = gx | 0, j = gy | 0, fx = gx - i, fy = gy - j;
  const k = j * (GW + 1) + i;
  const kx = 1 - fx, ky = 1 - fy;
  const dx = (wx[k] * kx + wx[k + 1] * fx) * ky + (wx[k + GW + 1] * kx + wx[k + GW + 2] * fx) * fy;
  const dy = (wy[k] * kx + wy[k + 1] * fx) * ky + (wy[k + GW + 1] * kx + wy[k + GW + 2] * fx) * fy;
  const cx = clamp(Math.floor(tx + dx), 0, W - 1);
  const cy = clamp(Math.floor(ty + dy), 0, H - 1);
  return { cell: MAP.grid[cy][cx], b: MAP.grid[cy][cx][0] };
}

function buildBase() {
  if (!MAP) return;
  buildWarp();
  const W = MAP.w, H = MAP.h;
  const bw = Math.max(8, Math.round(W * TILE * BASE));
  const bh = Math.max(8, Math.round(H * TILE * BASE));
  const c = document.createElement('canvas');
  c.width = bw; c.height = bh;
  const g = c.getContext('2d');
  const img = g.createImageData(bw, bh);
  const data = img.data;

  /* color por casillero, ya mezclado con los vecinos → transiciones suaves */
  const col = new Float32Array(W * H * 3);
  const glow = new Float32Array(W * H);
  const NB = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cell = MAP.grid[y][x];
      const own = hexRGB(cell[1]);
      let r = own[0], gg = own[1], bb = own[2], cnt = 0, sr = 0, sg = 0, sb = 0;
      let landNearby = false, waterNearby = false;
      for (const [dx, dy] of NB) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const nc = MAP.grid[ny][nx];
        const v = hexRGB(nc[1]);
        sr += v[0]; sg += v[1]; sb += v[2]; cnt++;
        if (nc[0] === 'agua') waterNearby = true; else landNearby = true;
      }
      const f = 0.12;
      if (cnt) { r = r * (1 - f) + (sr / cnt) * f; gg = gg * (1 - f) + (sg / cnt) * f; bb = bb * (1 - f) + (sb / cnt) * f; }
      if (cell[0] === 'agua' && landNearby) {                       // agua poco profunda junto a la costa
        r *= 1.5; gg *= 1.45; bb *= 1.28;
      }
      if (cell[0] === 'costa') {                                    // arena clara en la orilla
        r = r * 0.9 + 58; gg = gg * 0.9 + 50; bb = bb * 0.9 + 24;
      }
      const t = (y * W + x) * 3;
      col[t] = r; col[t + 1] = gg; col[t + 2] = bb;
      glow[y * W + x] = cell[0] === 'agua' && landNearby ? 0.16 : 0;
    }
  }

  const NT2 = noiseTex();
  const { wx, wy, GW, GH } = WF;
  const gxStep = GW / bw, gyStep = GH / bh;

  for (let py = 0; py < bh; py++) {
    const ty = (py / bh) * H;
    const gy = py * gyStep;
    const j = Math.min(GH - 1, gy | 0), fy = gy - j;
    const ky = 1 - fy;
    const rowA = j * (GW + 1), rowB = rowA + GW + 1;
    let p = py * bw * 4;
    for (let px = 0; px < bw; px++) {
      const tx = (px / bw) * W;
      const gx = px * gxStep;
      const i = Math.min(GW - 1, gx | 0), fx = gx - i;
      const kx = 1 - fx;
      const dx = (wx[rowA + i] * kx + wx[rowA + i + 1] * fx) * ky + (wx[rowB + i] * kx + wx[rowB + i + 1] * fx) * fy;
      const dy = (wy[rowA + i] * kx + wy[rowA + i + 1] * fx) * ky + (wy[rowB + i] * kx + wy[rowB + i + 1] * fx) * fy;
      let cx = (tx + dx) | 0, cy = (ty + dy) | 0;
      if (cx < 0) cx = 0; else if (cx >= W) cx = W - 1;
      if (cy < 0) cy = 0; else if (cy >= H) cy = H - 1;
      const ti = cy * W + cx;

      /* color interpolado entre los cuatro casilleros vecinos: así no se
         ven los cuadraditos ni de cerca ni en la vista de planeta */
      const qa = NT2[(px & 255) + ((py & 255) << 8)] * 0.00392;
      const qb = NT2[((px + 97) & 255) + (((py + 171) & 255) << 8)] * 0.00392;
      /* ondulación fina: rompe los escalones rectos de la costa */
      let fxT = tx + dx + (qa - 0.5) * 0.62 + (qb - 0.5) * 0.34;
      let fyT = ty + dy + (qb - 0.5) * 0.62 + (qa - 0.5) * 0.34;
      if (fxT < 0) fxT = 0; else if (fxT > W - 1.001) fxT = W - 1.001;
      if (fyT < 0) fyT = 0; else if (fyT > H - 1.001) fyT = H - 1.001;
      const x0 = fxT | 0, y0 = fyT | 0;
      const ux = fxT - x0, uy = fyT - y0;
      const i00 = (y0 * W + x0) * 3;
      const w00 = (1 - ux) * (1 - uy), w10 = ux * (1 - uy), w01 = (1 - ux) * uy, w11 = ux * uy;
      const row1 = i00 + W * 3;
      const cr = col[i00] * w00 + col[i00 + 3] * w10 + col[row1] * w01 + col[row1 + 3] * w11;
      const cg = col[i00 + 1] * w00 + col[i00 + 4] * w10 + col[row1 + 1] * w01 + col[row1 + 4] * w11;
      const cb = col[i00 + 2] * w00 + col[i00 + 5] * w10 + col[row1 + 2] * w01 + col[row1 + 5] * w11;
      const gl0 = y0 * W + x0;
      const gl = glow[gl0] * w00 + glow[gl0 + 1] * w10 + glow[gl0 + W] * w01 + glow[gl0 + W + 1] * w11;
      const t3 = ti * 3, sharp = 0.34;   // un poco del color propio del casillero, para que no se lave todo
      const fr = cr * (1 - sharp) + col[t3] * sharp;
      const fg = cg * (1 - sharp) + col[t3 + 1] * sharp;
      const fb = cb * (1 - sharp) + col[t3 + 2] * sharp;

      const n1 = qa;
      const n2 = NT2[((px >> 3) & 255) + (((py >> 3) & 255) << 8)] * 0.00392;
      const sh = 0.94 + n2 * 0.13 + (n1 - 0.5) * 0.05 + gl;

      data[p] = fr * sh;
      data[p + 1] = fg * sh;
      data[p + 2] = fb * sh;
      data[p + 3] = 255;
      p += 4;
    }
  }
  g.putImageData(img, 0, 0);

  base = c;
  baseDirty = false;

  /* copia chiquita para el minimapa */
  const mh = Math.round(MINI_W * (H / W));
  miniBase = document.createElement('canvas');
  miniBase.width = MINI_W * 2;
  miniBase.height = mh * 2;
  const mg = miniBase.getContext('2d');
  mg.imageSmoothingEnabled = true;
  mg.drawImage(c, 0, 0, miniBase.width, miniBase.height);

  buildDeco();
  miniDirty = true;
}

/* decoración: se reparte al azar y se dibuja según el bioma del punto,
   así los pinos caen dentro del bosque y no dentro de la pradera. */
function buildDeco() {
  deco = [];
  const W = MAP.w, H = MAP.h;
  const count = Math.round(W * H * 2.1);
  for (let i = 0; i < count; i++) {
    const tx = hash(i, 1, 21) * W;
    const ty = hash(i, 2, 22) * H;
    const hit = biomeAt(tx, ty);
    const b = hit.b;
    const def = META.BIOMES[b] || {};
    const r = hash(i, 5, 25);
    let keep = 0.92;
    if (def.land === false) keep = 0.30;                 // el mar lleva poca decoración
    else if (b === 'montana' || b === 'volcan') keep = 0.4;
    else if (b === 'pradera' || b === 'bosque') keep = 1;
    if (r > keep) continue;
    deco.push({
      x: tx * TILE, y: ty * TILE, b,
      r1: hash(i, 7, 27), r2: hash(i, 8, 28), r3: hash(i, 9, 29),
      s: 0.72 + hash(i, 11, 31) * 0.62
    });
  }
}

/* ---------------------------- dibujo ---------------------------- */
function draw(dt) {
  if (!MAP || !ST) return;
  if (baseDirty || !base) buildBase();

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (!bgGrad || bgKey !== VW + 'x' + VH) {
    bgGrad = ctx.createRadialGradient(VW * 0.5, VH * 0.45, VH * 0.12, VW * 0.5, VH * 0.5, Math.max(VW, VH) * 0.78);
    bgGrad.addColorStop(0, '#0a2431');
    bgGrad.addColorStop(0.55, '#071a25');
    bgGrad.addColorStop(1, '#05121a');
    bgKey = VW + 'x' + VH;
  }
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, VW, VH);

  ctx.save();
  ctx.translate(cam.x, cam.y);
  ctx.scale(cam.s, cam.s);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(base, 0, 0, MAP.w * TILE, MAP.h * TILE);

  drawDeco();
  drawDynamic(dt);
  ctx.restore();
}

function drawDeco() {
  const ts = cam.s * TILE;
  if (ts < 20) return;                 // vista de planeta entero: alcanza con el terreno cacheado
  const x0 = -cam.x / cam.s, y0 = -cam.y / cam.s;
  const x1 = x0 + VW / cam.s, y1 = y0 + VH / cam.s;
  const simple = ts < 26;
  for (let i = 0; i < deco.length; i++) {
    const d = deco[i];
    if (d.x < x0 - 80 || d.x > x1 + 80 || d.y < y0 - 80 || d.y > y1 + 80) continue;
    if (simple) {
      const col = BCOLOR[d.b] || '#556';
      ctx.fillStyle = d.b === 'agua' ? hexA('#bfe0ff', 0.22) : hexA(col, 0.55);
      ctx.fillRect(d.x, d.y, 3.2, 3.2);
    } else {
      decoShape(d);
    }
  }
}

function decoShape(d) {
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.lineCap = 'round';
  paintDeco(d);
  ctx.restore();
}

function paintDeco(d) {
  const b = d.b, s = d.s;

  if (b === 'bosque') {
    const h = 46 * s, w = 15 * s;
    ctx.fillStyle = 'rgba(12,34,24,.55)';
    ctx.beginPath(); ctx.ellipse(2 * s, 3 * s, w * 0.9, 5 * s, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(38,26,16,.9)';
    ctx.fillRect(-1.6 * s, -h * 0.2, 3.2 * s, h * 0.24);
    for (let k = 0; k < 3; k++) {
      const yy = -h * (0.22 + k * 0.26), ww = w * (1 - k * 0.22);
      ctx.fillStyle = k === 2 ? 'rgba(96,178,124,.95)' : 'rgba(58,132,92,.95)';
      ctx.beginPath();
      ctx.moveTo(0, yy - h * 0.42);
      ctx.lineTo(ww, yy);
      ctx.lineTo(-ww, yy);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(8,24,16,.55)'; ctx.lineWidth = 1; ctx.stroke();
    }
    return;
  }

  if (b === 'pradera') {
    ctx.strokeStyle = 'rgba(146,206,116,.75)';
    ctx.lineWidth = 2.1 * s;
    for (let k = 0; k < 4; k++) {
      const bx = (k - 1.5) * 5 * s, bh = (12 + d.r1 * 12) * s;
      ctx.beginPath();
      ctx.moveTo(bx, 0);
      ctx.quadraticCurveTo(bx - 2 * s, -bh * 0.6, bx + (k % 2 ? 4 : -4) * s, -bh);
      ctx.stroke();
    }
    return;
  }

  if (b === 'estepa') {
    ctx.strokeStyle = 'rgba(214,206,140,.6)';
    ctx.lineWidth = 1.8 * s;
    for (let k = 0; k < 3; k++) {
      const bx = (k - 1) * 6 * s, bh = (9 + d.r2 * 8) * s;
      ctx.beginPath();
      ctx.moveTo(bx, 0);
      ctx.lineTo(bx + 3 * s, -bh);
      ctx.stroke();
    }
    return;
  }

  if (b === 'desierto') {
    if (d.r1 > 0.55) {
      ctx.fillStyle = 'rgba(146,124,86,.75)';
      ctx.beginPath();
      ctx.moveTo(-6 * s, 0); ctx.lineTo(-2 * s, -7 * s); ctx.lineTo(4 * s, -3 * s); ctx.lineTo(6 * s, 0);
      ctx.closePath(); ctx.fill();
    } else {
      ctx.strokeStyle = 'rgba(255,240,190,.4)';
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.arc(0, 2 * s, 13 * s, Math.PI * 1.08, Math.PI * 1.62);
      ctx.stroke();
    }
    return;
  }

  if (b === 'costa') {
    ctx.fillStyle = 'rgba(255,248,214,.5)';
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.arc((hash(k, d.r2 * 90, 5) - 0.5) * 16 * s, (hash(k, d.r1 * 70, 6) - 0.5) * 12 * s, (1 + d.r3) * s, 0, TAU);
      ctx.fill();
    }
    return;
  }

  if (b === 'agua') {
    ctx.strokeStyle = 'rgba(190,225,255,.34)';
    ctx.lineWidth = 2 * s;
    const yy = (d.r1 - 0.5) * 20 * s;
    ctx.beginPath();
    ctx.moveTo(-14 * s, yy);
    ctx.quadraticCurveTo(-4 * s, yy - 5 * s, 6 * s, yy);
    ctx.quadraticCurveTo(13 * s, yy + 3 * s, 18 * s, yy - 1 * s);
    ctx.stroke();
    return;
  }

  if (b === 'tundra') {
    ctx.fillStyle = 'rgba(235,246,255,.5)';
    ctx.beginPath(); ctx.ellipse(0, 0, 10 * s, 5 * s, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(150,166,182,.65)';
    ctx.beginPath(); ctx.ellipse(6 * s, -2 * s, 3 * s, 2 * s, 0, 0, TAU); ctx.fill();
    return;
  }

  if (b === 'montana') {
    const h = 26 * s, w = 20 * s;
    ctx.fillStyle = 'rgba(196,206,220,.20)';
    ctx.beginPath();
    ctx.moveTo(0, -h); ctx.lineTo(w, 0); ctx.lineTo(-w, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(12,18,24,.4)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = 'rgba(245,250,255,.6)';
    ctx.beginPath();
    ctx.moveTo(0, -h); ctx.lineTo(w * 0.3, -h * 0.62); ctx.lineTo(-w * 0.3, -h * 0.62); ctx.closePath(); ctx.fill();
    return;
  }

  if (b === 'volcan') {
    const h = 24 * s, w = 16 * s;
    ctx.fillStyle = 'rgba(34,16,14,.6)';
    ctx.beginPath();
    ctx.moveTo(0, -h); ctx.lineTo(w, 0); ctx.lineTo(-w, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,140,60,.65)';
    ctx.beginPath(); ctx.arc(0, -h * 0.92, 2.6 * s, 0, TAU); ctx.fill();
    return;
  }
}

function drawDynamic(dt) {
  const now = performance.now();
  const W = MAP.w, H = MAP.h;
  const ts = cam.s * TILE;

  /* rango visible de casilleros */
  const tx0 = Math.max(0, Math.floor((-cam.x / cam.s) / TILE));
  const ty0 = Math.max(0, Math.floor((-cam.y / cam.s) / TILE));
  const tx1 = Math.min(W - 1, Math.ceil((VW - cam.x) / cam.s / TILE));
  const ty1 = Math.min(H - 1, Math.ceil((VH - cam.y) / cam.s / TILE));

  /* rindes */
  if (ts >= 48 && $('#yields').checked) {
    ctx.font = `700 ${Math.round(TILE * 0.25)}px ui-monospace, Consolas, monospace`;
    ctx.textBaseline = 'bottom';
    ctx.shadowColor = 'rgba(0,0,0,.9)';
    ctx.shadowBlur = 7;
    for (let y = ty0; y <= ty1; y++) {
      for (let x = tx0; x <= tx1; x++) {
        const cell = MAP.grid[y][x];
        if (cell[0] === 'agua') continue;
        const food = cell[4], mat = cell[5];
        if (!food && !mat) continue;
        const px = x * TILE, py = y * TILE;
        if (food) { ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(200,246,170,.95)'; ctx.fillText(food, px + 10, py + TILE - 9); }
        if (mat) { ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(238,214,158,.95)'; ctx.fillText(mat, px + TILE - 10, py + TILE - 9); }
      }
    }
    ctx.shadowBlur = 0;
  }

  /* peligros: halos que laten (se omiten en la vista de planeta) */
  for (let y = ty0; ts >= 16 && y <= ty1; y++) {
    for (let x = tx0; x <= tx1; x++) {
      const hz = MAP.grid[y][x][2];
      if (!hz) continue;
      const k = (Math.sin(now / 430 + (x + y) * 0.7) + 1) / 2;
      const cx = x * TILE + TILE / 2, cy = y * TILE + TILE * 0.45;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, TILE * (0.3 + k * 0.16));
      g.addColorStop(0, `rgba(180,40,30,${0.30 + k * 0.16})`);
      g.addColorStop(1, 'rgba(180,40,30,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, TILE * (0.3 + k * 0.16), 0, TAU); ctx.fill();
      ctx.beginPath();
      ctx.strokeStyle = `rgba(255,140,120,${0.25 + k * 0.45})`;
      ctx.lineWidth = Math.max(1, ts * 0.02);
      ctx.arc(cx, cy, TILE * (0.12 + k * 0.05), 0, TAU); ctx.stroke();
      if (ts >= 26) {
        ctx.fillStyle = 'rgba(255,214,206,.95)';
        ctx.font = `${Math.round(TILE * 0.19)}px serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(META.HAZARDS[hz].g, cx, cy + TILE * 0.01);
      }
    }
  }

  /* vetas */
  for (let y = ty0; y <= ty1; y++) {
    for (let x = tx0; x <= tx1; x++) {
      const veta = MAP.grid[y][x][3];
      if (!veta) continue;
      const cx = x * TILE + TILE * 0.74, cy = y * TILE + TILE * 0.3;
      if (ts < 22) { ctx.fillStyle = 'rgba(255,214,121,.8)'; ctx.beginPath(); ctx.arc(cx, cy, 2.4, 0, TAU); ctx.fill(); continue; }
      const r = TILE * 0.075;
      const pulse = 1 + Math.sin(now / 520 + x + y) * 0.12;
      ctx.beginPath();
      ctx.fillStyle = veta === 'food' ? '#b9f0a0' : '#ffd479';
      ctx.moveTo(cx, cy - r * pulse); ctx.lineTo(cx + r * pulse, cy);
      ctx.lineTo(cx, cy + r * pulse); ctx.lineTo(cx - r * pulse, cy);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(40,28,0,.6)'; ctx.lineWidth = 1; ctx.stroke();
    }
  }

  /* selección / hover: aro redondo, sin cuadros */
  const markRing = (t, color, fill, w) => {
    const cx = t.x * TILE + TILE / 2, cy = t.y * TILE + TILE / 2;
    ctx.beginPath();
    ctx.fillStyle = fill;
    ctx.arc(cx, cy, TILE * 0.44, 0, TAU); ctx.fill();
    ctx.beginPath();
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.4, ts * 0.03) * w;
    ctx.arc(cx, cy, TILE * 0.44, 0, TAU); ctx.stroke();
  };
  if (hover && (!sel || hover.x !== sel.x || hover.y !== sel.y)) markRing(hover, 'rgba(255,255,255,.5)', 'rgba(255,255,255,.06)', 0.7);

  /* aldeas */
  for (const f of ST.factions) {
    const cx = (f.x + 0.5) * TILE, cy = (f.y + 0.5) * TILE;
    if (!f.alive) {
      ctx.strokeStyle = '#51606f'; ctx.lineWidth = ts * 0.05;
      const s = TILE * 0.16;
      ctx.beginPath();
      ctx.moveTo(cx - s, cy - s); ctx.lineTo(cx + s, cy + s);
      ctx.moveTo(cx + s, cy - s); ctx.lineTo(cx - s, cy + s);
      ctx.stroke();
      continue;
    }
    const pulse = 1 + Math.sin(now / 620) * 0.06;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, TILE * 1.05 * pulse);
    g.addColorStop(0, hexA(f.color, 0.34));
    g.addColorStop(1, hexA(f.color, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, TILE * 1.05 * pulse, 0, TAU); ctx.fill();

    const w = TILE * 0.52, h = TILE * 0.4;
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, cy + h / 2 - 3);
    ctx.lineTo(cx - w / 2, cy - h * 0.15);
    ctx.lineTo(cx + w / 2, cy - h * 0.15);
    ctx.lineTo(cx + w / 2, cy + h / 2 - 3);
    ctx.closePath();
    ctx.fillStyle = f.color; ctx.fill();
    ctx.strokeStyle = 'rgba(6,10,14,.85)'; ctx.lineWidth = 2.4; ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.62, cy - h * 0.12);
    ctx.lineTo(cx, cy - h * 0.75);
    ctx.lineTo(cx + w * 0.62, cy - h * 0.12);
    ctx.closePath();
    ctx.fillStyle = hexA('#000000', 0.42); ctx.fill();

    /* la etiqueta nunca baja de 11 px en pantalla */
    const fs = Math.max(TILE * 0.22, 11 / cam.s);
    ctx.font = `bold ${fs}px ui-monospace, monospace`;
    const lw = ctx.measureText(f.name).width;
    const lh = fs + 8;
    const ly = cy - h * 0.85 - lh - 4;
    ctx.beginPath();
    const r = 5;
    const bx = cx - lw / 2 - 7, by = ly, bwid = lw + 14;
    ctx.moveTo(bx + r, by);
    ctx.lineTo(bx + bwid - r, by); ctx.quadraticCurveTo(bx + bwid, by, bx + bwid, by + r);
    ctx.lineTo(bx + bwid, by + lh - r); ctx.quadraticCurveTo(bx + bwid, by + lh, bx + bwid - r, by + lh);
    ctx.lineTo(bx + r, by + lh); ctx.quadraticCurveTo(bx, by + lh, bx, by + lh - r);
    ctx.lineTo(bx, by + r); ctx.quadraticCurveTo(bx, by, bx + r, by);
    ctx.closePath();
    ctx.fillStyle = 'rgba(4,8,12,.82)'; ctx.fill();
    ctx.strokeStyle = hexA(f.color, 0.8); ctx.lineWidth = 1.3; ctx.stroke();
    ctx.fillStyle = f.color;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(f.name, cx, ly + lh / 2 + 0.5);
  }

  /* personitas */
  for (const f of ST.factions) {
    for (const p of f.people) {
      let a = anim.get(p.id);
      if (!a) { a = { x: p.x, y: p.y }; anim.set(p.id, a); }
      const k = Math.min(1, dt * 8);
      a.x += (p.x - a.x) * k;
      a.y += (p.y - a.y) * k;
      const wob = Math.sin(now / 210 + p.id) * TILE * 0.022;
      drawPerson((a.x + 0.5) * TILE, (a.y + 0.5) * TILE + wob, f.color, p.task);
    }
  }

  if (sel) markRing(sel, 'rgba(255,212,121,.95)', 'rgba(255,212,121,.12)', 1);

  /* efectos */
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.age += dt;
    if (e.age > e.life) { effects.splice(i, 1); continue; }
    const k = e.age / e.life;
    ctx.globalAlpha = 1 - k;
    const ex = e.x * TILE + TILE / 2, ey = e.y * TILE + TILE / 2;
    if (e.type === 'death') {
      const s = TILE * (0.1 + k * 0.26);
      ctx.strokeStyle = '#ef6a5a'; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(ex - s, ey - s); ctx.lineTo(ex + s, ey + s);
      ctx.moveTo(ex + s, ey - s); ctx.lineTo(ex - s, ey + s);
      ctx.stroke();
    } else if (e.type === 'birth') {
      ctx.strokeStyle = '#8ef0b8'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(ex, ey, TILE * (0.12 + k * 0.4), 0, TAU); ctx.stroke();
    } else {
      ctx.strokeStyle = '#ffb35c'; ctx.lineWidth = 3.4;
      ctx.beginPath(); ctx.arc(ex, ey, TILE * (0.16 + k * 0.55), 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

function drawPerson(px, py, color, task) {
  const r = TILE * 0.115;
  ctx.beginPath();
  ctx.fillStyle = 'rgba(0,0,0,.38)';
  ctx.ellipse(px, py + r * 1.75, r * 1.15, r * 0.52, 0, 0, TAU);
  ctx.fill();

  ctx.beginPath();
  ctx.fillStyle = 'rgba(4,8,12,.5)';
  ctx.arc(px, py - r * 0.15, r * 1.3, 0, TAU);
  ctx.fill();

  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.arc(px, py, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(4,8,12,.85)'; ctx.lineWidth = 1.3; ctx.stroke();

  ctx.beginPath();
  ctx.fillStyle = lighten(color, 48);
  ctx.arc(px, py - r * 1.2, r * 0.66, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(4,8,12,.8)'; ctx.lineWidth = 1; ctx.stroke();

  ctx.beginPath();
  ctx.fillStyle = TASK_COLOR[task] || '#aab9c9';
  ctx.arc(px + r * 1.15, py + r * 0.68, Math.max(2, r * 0.42), 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(4,8,12,.6)'; ctx.lineWidth = 0.8; ctx.stroke();
}

init();













