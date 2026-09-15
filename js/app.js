/* ─────────────────────────────────────────────
   Untitled Grid — app
   Input, panels, history, autoplay, sharing.
   ───────────────────────────────────────────── */
(function () {
  const UG = window.UG;
  const $ = (id) => document.getElementById(id);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const hooks = (UG.hooks = { commit: [], pointer: [] });

  const state = {
    cam: { x: (UG.FRAME * UG.CELL) / 2, y: (UG.FRAME * UG.CELL) / 2, z: 0.75 },
    tool: 'bond', palette: 'technical', construct: true, fuse: 60, sound: false,
    e: 35, rad: 3, per: 80, sp: 'r',
    hover: null, sel: null, focus: null, shift: false, clean: false, contain: false,
    anims: new Map(), bot: null, ghosts: [], echoes: [], peers: new Map()
  };
  let moves = [];
  let cursor = 0;
  let dirty = true;

  /* ───── Boot from URL ───── */
  function readHash() {
    const out = {};
    location.hash.slice(1).split('&').forEach((kv) => {
      const k = kv.indexOf('=');
      if (k > 0) out[kv.slice(0, k)] = kv.slice(k + 1);
    });
    return out;
  }
  function randomSeed() {
    const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let k = 0; k < 6; k++) s += a[Math.floor(Math.random() * a.length)];
    return s;
  }

  const hash = readHash();
  let seed = randomSeed();
  try { if (hash.seed) seed = decodeURIComponent(hash.seed).slice(0, 24); } catch (_) {}
  const world = new UG.World(seed);
  if (hash.m) { moves = UG.decodeMoves(hash.m); cursor = moves.length; world.rebuild(moves, cursor); }

  const canvas = $('canvas');
  const R = new UG.Renderer(canvas, world, state);
  R.resize();

  if (hash.v) {
    const [x, y, z] = hash.v.split(',').map(Number);
    if ([x, y, z].every(Number.isFinite)) state.cam = { x, y, z: clamp(z, 0.1, 8) };
  } else if (R.w < 600) state.cam.z = 0.45;
  if (hash.f && Number.isFinite(+hash.f)) state.fuse = clamp(+hash.f, 0, 100);
  if (hash.pal && UG.PALETTES[hash.pal]) state.palette = hash.pal;

  /* ───── Render loop ───── */
  new ResizeObserver(() => { R.resize(); dirty = true; }).observe($('stage'));
  let busy = false;
  function loop(now) {
    if (dirty || busy) { dirty = false; busy = R.draw(now); drawLeak(); }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  if (document.fonts) document.fonts.ready.then(() => { dirty = true; });

  /* ───── Sound ───── */
  let actx = null;
  const TONE = { B: 207.7, S: 220, R: 246.9, M: 261.6, I: 196, T: 293.7, X: 329.6, G: 174.6, E: 146.8 };
  const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19];
  function blip(code, distances, delay) {
    if (!state.sound || !TONE[code]) return;
    try {
      actx = actx || new AudioContext();
      const t0 = actx.currentTime + 0.01;
      for (const d of distances) {
        const o = actx.createOscillator(), g = actx.createGain();
        const st = t0 + (d * delay) / 1000;
        o.type = code === 'X' ? 'square' : 'triangle';
        o.frequency.value = TONE[code] * Math.pow(2, SCALE[d % SCALE.length] / 12);
        g.gain.setValueAtTime(0, st);
        g.gain.linearRampToValueAtTime(code === 'X' ? 0.03 : 0.07, st + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, st + 0.18);
        o.connect(g).connect(actx.destination);
        o.start(st); o.stop(st + 0.2);
      }
    } catch (_) {}
  }

  /* ───── Moves ───── */
  function params() { return { e: state.e, rad: state.rad, per: state.per, sp: state.sp }; }

  function applyAnimated(m) {
    const now = performance.now();
    const delay = reduced ? 0 : m.sp === 'w' ? 45 : 70;
    const ds = new Set();
    world.apply(m, (i, j, d, prev) => {
      const key = i + ',' + j;
      const ex = state.anims.get(key);
      const at = now + d * delay;
      if (ex && now < ex.at) ex.at = Math.max(ex.at, at);
      else state.anims.set(key, { prev, at });
      ds.add(d);
    });
    blip(m.t, ds, delay);
  }

  function commit(m) {
    if (cursor < moves.length) moves.length = cursor;
    moves.push(m);
    applyAnimated(m);
    cursor = moves.length;
    for (const f of hooks.commit) f(m);
    $('hint').classList.add('gone');
    afterChange(true);
  }

  function scrub(k) {
    cursor = clamp(k, 0, moves.length);
    world.rebuild(moves, cursor);
    state.anims.clear();
    afterChange();
  }
  function undo() { if (cursor > 0) scrub(cursor - 1); }
  function redo() {
    if (cursor >= moves.length) return;
    // Re-derive the state up to the cursor, then play the next move with animation.
    applyAnimated(moves[cursor]);
    cursor++;
    afterChange();
  }

  function afterChange(fresh) {
    dirty = true;
    renderLayers(fresh);
    renderStats();
    renderTimeline();
    updateSelection();
    scheduleHash();
    erode(!!fresh);
  }

  /* ───── Hit testing & acting ───── */
  function hit(wx, wy) {
    const i = UG.worldToCell(wx), j = UG.worldToCell(wy);
    if (i === null || j === null) return null;
    const node = world.node(i, j);
    const r = UG.hitPath(node, UG.cellToWorld(i), UG.cellToWorld(j), UG.CELL, UG.CELL, wx, wy);
    return { i, j, path: r.path };
  }
  const sameHit = (a, b) => (!a && !b) || (a && b && a.i === b.i && a.j === b.j && a.path === b.path);

  function act(t, noSpread) {
    if (!t) { state.sel = null; updateSelection(); dirty = true; return; }
    if (state.tool === 'select') { state.sel = t; updateSelection(); dirty = true; return; }
    const p = params();
    if (noSpread) p.rad = 0;
    commit({ t: UG.RULES[state.tool].code, i: t.i, j: t.j, p: t.path, ...p });
  }

  /* ───── Camera ───── */
  function zoomAt(x, y, f) {
    const [wx, wy] = R.toWorld(x, y);
    const z = clamp(state.cam.z * f, 0.1, 8);
    state.cam.z = z;
    state.cam.x = wx - (x - R.w / 2) / z;
    state.cam.y = wy - (y - R.h / 2) / z;
    afterCamera();
  }
  function setZoom(z) { zoomAt(R.w / 2, R.h / 2, z / state.cam.z); }
  function afterCamera() {
    $('zoomVal').textContent = Math.round(state.cam.z * 100) + '%';
    dirty = true;
    scheduleHash();
  }
  function fit() {
    if (!world.cells.size) {
      state.cam = { x: (UG.FRAME * UG.CELL) / 2, y: (UG.FRAME * UG.CELL) / 2, z: R.w < 600 ? 0.45 : 0.75 };
      afterCamera();
      return;
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const key of world.cells.keys()) {
      const [i, j] = key.split(',').map(Number);
      const x = UG.cellToWorld(i), y = UG.cellToWorld(j);
      x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + UG.CELL); y1 = Math.max(y1, y + UG.CELL);
    }
    const z = clamp(Math.min(R.w / (x1 - x0 + 160), R.h / (y1 - y0 + 160)), 0.1, 2);
    state.cam = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z };
    afterCamera();
  }
  function lookAt(i, j) {
    const x = UG.cellToWorld(i) + UG.CELL / 2, y = UG.cellToWorld(j) + UG.CELL / 2;
    const [sx, sy] = R.toScreen(x, y);
    const m = 60;
    if (sx < m || sy < m || sx > R.w - m || sy > R.h - m) { state.cam.x = x; state.cam.y = y; }
    afterCamera();
  }

  /* ───── Pointer input ───── */
  const pointers = new Map();
  let drag = null;
  const pos = (ev) => { const r = canvas.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };

  canvas.addEventListener('pointerdown', (ev) => {
    canvas.setPointerCapture(ev.pointerId);
    closeSheets();
    const [x, y] = pos(ev);
    pointers.set(ev.pointerId, { x, y });
    if (pointers.size === 1) {
      drag = { sx: x, sy: y, lx: x, ly: y, moved: false, button: ev.button, shift: ev.shiftKey || ev.altKey, pinch: null };
    } else if (drag) {
      drag.moved = true;
      drag.pinch = null;
    }
  });

  canvas.addEventListener('pointermove', (ev) => {
    const [x, y] = pos(ev);
    if (hooks.pointer.length) { const [pwx, pwy] = R.toWorld(x, y); for (const f of hooks.pointer) f(pwx, pwy); }
    if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x, y });

    if (pointers.size >= 2 && drag) {
      const [a, b] = [...pointers.values()];
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (drag.pinch) {
        state.cam.x -= (cx - drag.pinch.cx) / state.cam.z;
        state.cam.y -= (cy - drag.pinch.cy) / state.cam.z;
        zoomAt(cx, cy, dist / Math.max(1, drag.pinch.dist));
      }
      drag.pinch = { cx, cy, dist };
      return;
    }

    if (drag) {
      if (!drag.moved && Math.hypot(x - drag.sx, y - drag.sy) > 5) drag.moved = true;
      if (drag.moved) {
        state.cam.x -= (x - drag.lx) / state.cam.z;
        state.cam.y -= (y - drag.ly) / state.cam.z;
        canvas.classList.add('panning');
        afterCamera();
      }
      drag.lx = x; drag.ly = y;
      return;
    }

    if (ev.pointerType === 'mouse') {
      const [wx, wy] = R.toWorld(x, y);
      const t = hit(wx, wy);
      if (!sameHit(t, state.hover)) { state.hover = t; dirty = true; }
    }
  });

  function endPointer(ev, cancelled) {
    const [x, y] = pos(ev);
    pointers.delete(ev.pointerId);
    if (!drag) return;
    if (pointers.size === 1) {
      const rest = [...pointers.values()][0];
      drag.lx = rest.x; drag.ly = rest.y; drag.pinch = null;
      return;
    }
    if (pointers.size === 0) {
      if (!cancelled && !drag.moved && drag.button === 0) {
        const [wx, wy] = R.toWorld(x, y);
        act(hit(wx, wy), drag.shift);
      }
      drag = null;
      canvas.classList.remove('panning');
    }
  }
  canvas.addEventListener('pointerup', (ev) => endPointer(ev, false));
  canvas.addEventListener('pointercancel', (ev) => endPointer(ev, true));
  canvas.addEventListener('pointerleave', () => { if (state.hover) { state.hover = null; dirty = true; } });

  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const [x, y] = pos(ev);
    if (ev.ctrlKey || ev.metaKey) zoomAt(x, y, Math.exp(-ev.deltaY * 0.01));
    else {
      const k = ev.deltaMode === 1 ? 16 : 1;
      state.cam.x += (ev.deltaX * k) / state.cam.z;
      state.cam.y += (ev.deltaY * k) / state.cam.z;
      afterCamera();
    }
  }, { passive: false });

  /* ───── Keyboard ───── */
  addEventListener('keydown', (ev) => {
    if (ev.key === 'Shift' && !state.shift) { state.shift = true; dirty = true; }
    const tag = ev.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || document.querySelector('dialog[open]')) return;
    const mod = ev.metaKey || ev.ctrlKey;
    const k = ev.key.toLowerCase();

    if (mod) {
      if (k === 'z') { ev.preventDefault(); ev.shiftKey ? redo() : undo(); }
      else if (k === 'y') { ev.preventDefault(); redo(); }
      else if (k === '=' || k === '+') { ev.preventDefault(); setZoom(state.cam.z * 1.25); }
      else if (k === '-') { ev.preventDefault(); setZoom(state.cam.z / 1.25); }
      else if (k === '0') { ev.preventDefault(); setZoom(1); }
      return;
    }
    if (ev.shiftKey && ev.code === 'KeyG') { setConstruct(!state.construct); return; }
    if (ev.shiftKey && ev.code === 'Digit1') { fit(); return; }
    if (ev.key === '?') { openAbout(); return; }

    const arrows = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
    if (arrows[k]) {
      ev.preventDefault();
      if (!state.focus) {
        state.focus = {
          i: Math.floor(state.cam.x / UG.BLOCK) * UG.FRAME + UG.FRAME / 2,
          j: Math.floor(state.cam.y / UG.BLOCK) * UG.FRAME + UG.FRAME / 2
        };
      } else {
        state.focus.i += arrows[k][0];
        state.focus.j += arrows[k][1];
      }
      lookAt(state.focus.i, state.focus.j);
      return;
    }
    if (ev.key === 'Enter' && state.focus) { ev.preventDefault(); act({ ...state.focus, path: '' }, ev.shiftKey); return; }
    if (ev.key === 'Escape') { state.sel = null; state.focus = null; closeSheets(); updateSelection(); dirty = true; return; }
    if (k === 'p') { toggleAuto(); return; }
    if (k === '[' || k === ']') { setParam('rad', state.rad + (k === ']' ? 1 : -1)); return; }
    for (const t in UG.RULES) if (UG.RULES[t].key === k && !ev.shiftKey) { setTool(t); return; }
  });
  addEventListener('keyup', (ev) => { if (ev.key === 'Shift') { state.shift = false; dirty = true; } });

  /* ───── Toolbar & panels ───── */
  const ICONS = {};
  document.querySelectorAll('[data-tool]').forEach((b) => {
    const code = UG.RULES[b.dataset.tool].code;
    if (code) ICONS[code] = b.querySelector('svg').outerHTML;
    b.addEventListener('click', () => setTool(b.dataset.tool));
  });
  ICONS.W = ICONS.T;

  function setTool(t) {
    state.tool = t;
    document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    $('ruleName').textContent = UG.RULES[t].name;
    $('ruleDesc').textContent = UG.RULES[t].desc;
    $('ruleKey').textContent = UG.RULES[t].key.toUpperCase();
    canvas.style.cursor = t === 'select' ? 'default' : 'crosshair';
    dirty = true;
    erode(false);
  }

  const SLIDERS = { e: ['rngEntropy', 'valEntropy', 0, 100], rad: ['rngRadius', 'valRadius', 0, 8], per: ['rngPersist', 'valPersist', 0, 100], fuse: ['rngFuse', 'valFuse', 0, 100] };
  function setParam(name, v) {
    const [inp, out, lo, hi] = SLIDERS[name];
    state[name] = clamp(Math.round(v), lo, hi);
    $(inp).value = state[name];
    $(out).textContent = state[name];
    dirty = true;
  }
  for (const name in SLIDERS) {
    $(SLIDERS[name][0]).addEventListener('input', (ev) => setParam(name, +ev.target.value));
    setParam(name, state[name]);
  }

  function setSpread(sp) {
    state.sp = sp;
    document.querySelectorAll('#spread button').forEach((b) => b.classList.toggle('active', b.dataset.sp === sp));
    dirty = true;
  }
  document.querySelectorAll('#spread button').forEach((b) => b.addEventListener('click', () => setSpread(b.dataset.sp)));

  $('inputWord').addEventListener('change', (ev) => {
    const w = ev.target.value.replace(/\s+/g, ' ').trim().slice(0, 39);
    if (!w || w + ' ' === world.word) return;
    commit({ t: 'W', w: w + ' ' });
  });
  $('inputWord').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ev.target.blur(); });

  function newSeed(s) {
    s = String(s || randomSeed()).replace(/[^\w-]/g, '').slice(0, 24) || randomSeed();
    world.setSeed(s);
    moves = []; cursor = 0;
    state.anims.clear(); state.sel = null;
    $('inputSeed').value = s;
    $('seedBadge').textContent = s;
    afterChange();
  }
  $('inputSeed').addEventListener('change', (ev) => newSeed(ev.target.value));
  $('inputSeed').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ev.target.blur(); });
  $('btnReroll').addEventListener('click', () => newSeed());

  function setPalette(p) {
    state.palette = UG.PALETTES[p] ? p : 'technical';
    $('selPalette').value = state.palette;
    document.body.dataset.palette = state.palette;
    $('stage').style.background = UG.PALETTES[state.palette].canvas;
    dirty = true;
    scheduleHash();
  }
  $('selPalette').addEventListener('change', (ev) => setPalette(ev.target.value));
  function setConstruct(on) { state.construct = on; $('chkConstruct').checked = on; dirty = true; }
  $('chkConstruct').addEventListener('change', (ev) => setConstruct(ev.target.checked));
  $('chkSound').addEventListener('change', (ev) => { state.sound = ev.target.checked; if (state.sound) blip('S', [0, 2, 4], 60); });

  $('zoomIn').addEventListener('click', () => setZoom(state.cam.z * 1.25));
  $('zoomOut').addEventListener('click', () => setZoom(state.cam.z / 1.25));
  $('zoomVal').addEventListener('click', () => setZoom(1));

  $('btnUndo').addEventListener('click', undo);
  $('btnRedo').addEventListener('click', redo);
  $('rngTime').addEventListener('input', (ev) => { stopReplay(); scrub(+ev.target.value); });

  /* ───── Layers ───── */
  function renderLayers(fresh) {
    const list = $('layers');
    const from = Math.max(0, moves.length - 150);
    const frag = document.createDocumentFragment();
    for (let n = moves.length - 1; n >= from; n--) {
      const m = moves[n];
      const li = document.createElement('li');
      li.dataset.n = n;
      if (n >= cursor) li.classList.add('future');
      if (n === cursor - 1) li.classList.add('current');
      if (fresh && n === moves.length - 1) li.classList.add('new');
      li.innerHTML = `<span class="ico">${ICONS[m.t] || ''}</span><span class="nm"></span><span class="meta"></span>`;
      // User strings go in as text, never markup.
      li.children[1].textContent = m.t === 'W'
        ? `String “${m.w.trim()}”`
        : `${UG.RULES[UG.CODE_TO_RULE[m.t]].name} ${m.i}:${m.j}${m.p ? '/' + m.p : ''}`;
      li.children[2].textContent = m.t === 'W' ? '' : m.rad ? `${UG.SPREADS[m.sp].slice(0, 4).toLowerCase()} ${m.rad}` : 'solo';
      frag.appendChild(li);
    }
    list.replaceChildren(frag);
    $('layerCount').textContent = moves.length;
    $('layersEmpty').hidden = moves.length > 0;
  }
  $('layers').addEventListener('click', (ev) => {
    const li = ev.target.closest('li');
    if (!li) return;
    const m = moves[+li.dataset.n];
    if (m.t === 'W') return;
    state.sel = { i: m.i, j: m.j, path: m.p };
    state.cam.x = UG.cellToWorld(m.i) + UG.CELL / 2;
    state.cam.y = UG.cellToWorld(m.j) + UG.CELL / 2;
    updateSelection();
    afterCamera();
  });
  $('layers').addEventListener('dblclick', (ev) => {
    const li = ev.target.closest('li');
    if (li) scrub(+li.dataset.n + 1);
  });

  /* ───── Inspector ───── */
  function updateSelection() {
    const box = $('selSection');
    if (!state.sel) { box.hidden = true; return; }
    box.hidden = false;
    const { i, j, path } = state.sel;
    const r = UG.resolvePath(world.node(i, j), UG.cellToWorld(i), UG.cellToWorld(j), UG.CELL, UG.CELL, path);
    const n = r.node;
    $('selName').textContent = `Module ${i}:${j}${path ? ' / ' + path.slice(0, r.depth) : ''}`;
    $('selX').textContent = r.rect[0];
    $('selY').textContent = r.rect[1];
    $('selW').textContent = r.rect[2];
    $('selH').textContent = r.rect[3];
    $('selRot').textContent = n.r * 90 + '°';
    $('selDepth').textContent = r.depth;
    $('selGlyph').textContent = n.k ? 'Subdivision' : UG.GLYPHS[n.g] + (n.ch ? ` “${n.ch}”` : '');
    $('selFill').textContent = n.v ? 'Inverted' : 'Positive';
    $('selColor').textContent = ['Solid', 'Line', 'Hatch'][n.c] || 'Solid';
    $('selState').textContent = world.get(i, j) ? 'Written' : 'Unwritten';
  }

  function renderStats() {
    $('statMoves').textContent = cursor;
    $('statModules').textContent = world.cells.size;
    const frames = new Set();
    for (const key of world.cells.keys()) {
      const [i, j] = key.split(',').map(Number);
      frames.add(UG.frameOf(i) + ',' + UG.frameOf(j));
    }
    $('statFrames').textContent = frames.size;
    $('statSpecimens').textContent = `${world.specimens.size} / ${UG.SPECIMEN_TOTAL}`;
    $('inputWord').value = world.word.trim();
  }

  function renderTimeline() {
    const t = $('rngTime');
    t.max = moves.length;
    t.value = cursor;
    $('timeLabel').textContent = `${cursor} / ${moves.length}`;
    $('btnUndo').disabled = cursor === 0;
    $('btnRedo').disabled = cursor >= moves.length;
  }

  /* ───── Replay ───── */
  let replayTimer = null;
  function stopReplay() {
    if (!replayTimer) return;
    clearTimeout(replayTimer);
    replayTimer = null;
    $('btnReplay').classList.remove('active');
  }
  $('btnReplay').addEventListener('click', () => {
    if (replayTimer) { stopReplay(); return; }
    if (!moves.length) return;
    toggleAuto(false);
    scrub(0);
    $('btnReplay').classList.add('active');
    const gap = clamp(9000 / moves.length, 60, 400);
    const step = () => {
      if (cursor >= moves.length) { stopReplay(); return; }
      redo();
      replayTimer = setTimeout(step, gap);
    };
    replayTimer = setTimeout(step, 300);
  });

  /* ───── Autoplay ───── */
  let autoTimer = null;
  function toggleAuto(on) {
    on = on === undefined ? !autoTimer : on;
    if (on && !autoTimer) {
      stopReplay();
      state.bot = { x0: state.cam.x, y0: state.cam.y, x1: state.cam.x, y1: state.cam.y, t0: performance.now(), dur: 1, name: 'autoplay' };
      autoTimer = setTimeout(autoStep, 200);
    } else if (!on && autoTimer) {
      clearTimeout(autoTimer);
      autoTimer = null;
      state.bot = null;
      dirty = true;
    }
    $('btnAuto').classList.toggle('active', !!autoTimer);
  }
  function autoStep() {
    if (!autoTimer) return;
    const [wx0, wy0] = R.toWorld(R.w * 0.15, R.h * 0.15);
    const [wx1, wy1] = R.toWorld(R.w * 0.85, R.h * 0.85);
    let t = null, wx = 0, wy = 0;
    for (let k = 0; k < 16 && !t; k++) {
      wx = wx0 + Math.random() * (wx1 - wx0);
      wy = wy0 + Math.random() * (wy1 - wy0);
      t = hit(wx, wy);
    }
    if (t) {
      const pool = ['S', 'S', 'S', 'B', 'B', 'R', 'M', 'I', 'X', 'X', 'T', 'G'];
      const code = pool[Math.floor(Math.random() * pool.length)];
      const spreads = ['r', 'r', 'a', 'd', 'q', 'w'];
      const b = state.bot;
      const now = performance.now();
      const p = Math.min(1, (now - b.t0) / b.dur), e = 1 - Math.pow(1 - p, 3);
      state.bot = {
        x0: b.x0 + (b.x1 - b.x0) * e, y0: b.y0 + (b.y1 - b.y0) * e, x1: wx, y1: wy,
        t0: now, dur: 520, name: 'autoplay · ' + UG.RULES[UG.CODE_TO_RULE[code]].name.toLowerCase()
      };
      setTimeout(() => {
        if (!autoTimer) return;
        commit({
          t: code, i: t.i, j: t.j, p: t.path,
          e: state.e, rad: 1 + Math.floor(Math.random() * 4), per: 75,
          sp: spreads[Math.floor(Math.random() * spreads.length)]
        });
      }, 560);
    }
    autoTimer = setTimeout(autoStep, 1300);
  }
  $('btnAuto').addEventListener('click', () => toggleAuto());

  /* ───── Share & export ───── */
  let hashTimer = null;
  function scheduleHash() {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(writeHash, 400);
  }
  function writeHash() {
    const c = state.cam;
    const h = `#seed=${encodeURIComponent(world.seed)}&v=${Math.round(c.x)},${Math.round(c.y)},${c.z.toFixed(2)}&f=${state.fuse}&pal=${state.palette}` +
      (cursor ? `&m=${UG.encodeMoves(moves.slice(0, cursor))}` : '') +
      (UG.demoMode ? '&' + UG.demoMode : '');
    try { history.replaceState(null, '', h); } catch (_) { /* sandboxed host */ }
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  }

  async function copyLink() {
    writeHash();
    try { await navigator.clipboard.writeText(location.href); toast('Link copied. This exact state is reproducible.'); }
    catch (_) { toast('Copy the address bar — the URL is the state.'); }
  }
  $('btnShare').addEventListener('click', copyLink);
  $('btnLink').addEventListener('click', copyLink);

  $('btnPng').addEventListener('click', () => {
    state.clean = true;
    R.draw(performance.now());
    state.clean = false;
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const result = await UG.saveFile(`untitled-grid-${world.seed}-${cursor}.png`, blob);
      toast(result === 'saved' ? 'Exported.' : result === 'declined' ? 'Export cancelled.' : 'This view cannot save files.');
    });
    dirty = true;
  });

  /* ───── Mobile sheets ───── */
  function closeSheets() {
    document.body.classList.remove('sheet-left', 'sheet-right');
    $('btnLayers').classList.remove('active');
    $('btnDesign').classList.remove('active');
  }
  function toggleSheet(side) {
    const cls = 'sheet-' + side;
    const open = !document.body.classList.contains(cls);
    closeSheets();
    if (open) {
      document.body.classList.add(cls);
      $(side === 'left' ? 'btnLayers' : 'btnDesign').classList.add('active');
    }
  }
  $('btnLayers').addEventListener('click', () => toggleSheet('left'));
  $('btnDesign').addEventListener('click', () => toggleSheet('right'));

  /* ───── About ───── */
  function drawAboutArt() {
    const c = $('aboutArt'), ctx = c.getContext('2d');
    const P = UG.PALETTES.technical;
    const r = UG.rng(UG.hash(world.seed, 'about'));
    const cols = 14, rows = 5, s = c.width / cols;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = P.frame;
    ctx.fillRect(0, 0, c.width, c.height);
    UG.drawConstruction(ctx, 0, 0, cols, rows, s, P, c.width, c.height);
    const nodes = new Map();
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const n = world.ghost(i * 3 + 11, j * 5 - 7);
        const inBand = Math.abs(j - 2 + Math.sin(i * 0.7) * 1.2) < 1.1;
        if (!inBand) {
          if (n.g) { ctx.beginPath(); UG.addGlyph(ctx, n.g, n.r, n.f, i * s, j * s, s, s); ctx.strokeStyle = P.ghost; ctx.lineWidth = 1.5; ctx.stroke(); }
          continue;
        }
        if (r() < 0.45) { n.g = 3; n.r = 0; n.c = 0; n.v = false; }
        else { if (!n.g) n.g = 1 + Math.floor(r() * 10); n.c = r() < 0.15 ? 2 : r() < 0.1 ? 1 : 0; n.v = r() < 0.12; }
        UG.drawNode(ctx, n, i * s, j * s, s, s, P);
        nodes.set(i + ',' + j, n);
      }
    }
    ctx.fillStyle = P.ink;
    for (const [key, n] of nodes) {
      if (n.g !== 3 || n.v || n.c) continue;
      const [i, j] = key.split(',').map(Number);
      for (const [di, dj] of [[1, 0], [0, 1]]) {
        const m = nodes.get(i + di + ',' + (j + dj));
        if (m && m.g === 3 && !m.v && !m.c) UG.bridge(ctx, (i + 0.5) * s, (j + 0.5) * s, (i + di + 0.5) * s, (j + dj + 0.5) * s, s / 2, s * 0.55);
      }
    }
  }
  function openAbout() { drawAboutArt(); $('about').showModal(); }
  $('btnMenu').addEventListener('click', openAbout);
  $('btnEnter').addEventListener('click', () => $('about').close());
  $('about').addEventListener('click', (ev) => { if (ev.target === $('about')) $('about').close(); });
  $('about').addEventListener('close', () => { try { localStorage.setItem('ug-seen', '1'); } catch (_) {} });

  /* ───── Erosion — the grid leaks into the interface ───── */
  // Driven only by the history cursor, so rewinding heals the interface.
  const ERODE_SEL = [
    '.panel .tab', '.page-item', '.sec-title', '.rule-name', '.rule-desc', '.slider', '.segmented button',
    '.text-input', '.check', '.props dt', '.props dd', '.note', '.sub', '.field', '.layers li', '.empty',
    '.btn-light', '.tb-center .crumb', '.tb-center .filename', '.badge', '#btnAuto', '#btnShare'
  ].join(','); // the mobile Layers/Design toggles stay intact: on a phone they are the only way to the panels
  const EFFECT = { B: 'bond', S: 'split', R: 'rot', M: 'mir', I: 'inv', T: 'type', W: 'type', G: 'void' };
  const MUTANTS = ['bond', 'split', 'rot', 'mir', 'inv', 'void', 'type'];
  const MILESTONES = [
    [9, 'The grid has reached the edge of the canvas.'],
    [21, 'The interface is now part of the grid.'],
    [72, 'There is no longer an outside.']
  ];
  const ERODE_START = 20, ERODE_RATE = 1.2, COLLAPSE_AT = 72;
  let erodedCount = 0, pressureN = 0, leakDpr = 1, leakClear = true, integrity = '100%';

  function erode(live) {
    const prevN = pressureN;
    const n = state.contain ? 0 : cursor;
    pressureN = n;
    dirty = true;

    const els = [...document.querySelectorAll(ERODE_SEL)].filter((el) => !el.closest('.keep'));
    const target = Math.min(els.length, Math.max(0, Math.floor((n - ERODE_START) * ERODE_RATE)));

    // Measure before touching classes, so settled elements don't re-animate.
    let order = [];
    if (target > 0) {
      const sr = canvas.getBoundingClientRect();
      order = els.map((el, idx) => {
        const r = el.getBoundingClientRect();
        const dx = Math.max(sr.left - r.right, r.left - sr.right, 0);
        const dy = Math.max(sr.top - r.bottom, r.top - sr.bottom, 0);
        return { el, s: Math.hypot(dx, dy) + UG.rng(UG.hash(world.seed, 'ui', idx))() * 280 };
      }).sort((a, b) => a.s - b.s).map((o) => o.el);
    }

    for (const el of els) {
      if (!el.dataset.ug) continue;
      el.classList.remove('ug-e', 'ug-' + el.dataset.ug);
      if (el.dataset.ugTyped !== undefined) {
        if (el.textContent === el.dataset.ugTyped) el.textContent = el.dataset.ugText;
        delete el.dataset.ugText;
        delete el.dataset.ugTyped;
      }
      delete el.dataset.ug;
      el.style.transitionDelay = '';
    }

    const word = world.word.replace(/\s+/g, '') || 'GRID';
    for (let k = 0; k < target; k++) {
      const el = order[k];
      const m = moves[Math.min(cursor - 1, ERODE_START + Math.floor(k / ERODE_RATE))];
      let fx = m.t === 'X' ? MUTANTS[Math.floor(UG.rng(UG.hash(world.seed, 'fx', k))() * MUTANTS.length)] : EFFECT[m.t];
      if (!fx) continue; // a Reset move leaves its share of the interface intact
      const isField = el.tagName === 'INPUT' || el.tagName === 'SELECT';
      const isLeaf = !el.children.length && el.textContent.trim().length > 0;
      if (fx === 'type' && !isLeaf) fx = 'mir';
      if (isField && fx !== 'mir' && fx !== 'rot') fx = 'inv';
      if (fx === 'type') {
        const t = el.textContent;
        let out = '';
        for (let c = 0; c < t.length; c++) out += /\s/.test(t[c]) ? t[c] : word[(c + k) % word.length];
        el.dataset.ugText = t;
        el.dataset.ugTyped = out;
        el.textContent = out;
      }
      el.dataset.ug = fx;
      el.classList.add('ug-e', 'ug-' + fx);
      if (live && k >= erodedCount && !reduced) el.style.transitionDelay = (k - erodedCount) * 45 + 'ms';
    }

    const collapse = n >= COLLAPSE_AT;
    document.body.classList.toggle('ug-collapse', collapse);
    if (live) for (const [at, msg] of MILESTONES) if (prevN < at && n >= at) toast(msg);
    erodedCount = target;
    integrity = (collapse ? 0 : Math.round(100 * (1 - target / Math.max(1, els.length)))) + '%';
    $('statIntegrity').textContent = integrity;
  }

  $('chkContain').addEventListener('change', (ev) => { state.contain = ev.target.checked; erode(false); });

  function sizeLeak() {
    const c = $('leak');
    leakDpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(innerWidth * leakDpr);
    c.height = Math.round(innerHeight * leakDpr);
    leakClear = false;
    dirty = true;
  }
  addEventListener('resize', sizeLeak);

  // Construction lines continue past the canvas edge, in the world's own rhythm.
  function drawLeak() {
    const c = $('leak'), ctx = c.getContext('2d');
    const p = clamp((pressureN - 8) / 60, 0, 1);
    const z = state.cam.z, cs = UG.CELL * z;
    if (p <= 0 || cs < 10 || document.body.classList.contains('ug-collapse')) {
      if (!leakClear) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height); leakClear = true; }
      return;
    }
    leakClear = false;
    ctx.setTransform(leakDpr, 0, 0, leakDpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);

    const sr = canvas.getBoundingClientRect();
    const W = innerWidth, H = innerHeight;
    const reach = 60 + p * 1600;
    const a = Math.min(1, p * 2.5);
    const col = (al) => `rgba(88, 100, 240, ${al})`;
    const centres = (from, to, camC, size, origin) => {
      const out = [];
      let i = Math.floor(((from - origin - size / 2) / z + camC) / UG.BLOCK) * UG.FRAME - 1;
      for (let guard = 0; guard < 2000; guard++, i++) {
        const s = origin + size / 2 + (UG.cellToWorld(i) + UG.CELL / 2 - camC) * z;
        if (s > to) break;
        if (s >= from) out.push(s);
      }
      return out;
    };
    const regions = [
      [0, 0, sr.left, H, sr.left, 0, sr.left - reach, 0],
      [sr.right, 0, W - sr.right, H, sr.right, 0, sr.right + reach, 0],
      [sr.left, 0, sr.width, sr.top, 0, sr.top, 0, sr.top - reach],
      [sr.left, sr.bottom, sr.width, H - sr.bottom, 0, sr.bottom, 0, sr.bottom + reach]
    ];
    for (const [rx, ry, rw, rh, gx0, gy0, gx1, gy1] of regions) {
      if (rw <= 1 || rh <= 1) continue;
      const xs = centres(rx, rx + rw, state.cam.x, sr.width, sr.left);
      const ys = centres(ry, ry + rh, state.cam.y, sr.height, sr.top);
      ctx.save();
      ctx.beginPath();
      ctx.rect(rx, ry, rw, rh);
      ctx.clip();
      const lines = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
      lines.addColorStop(0, col(0.55 * a));
      lines.addColorStop(1, col(0));
      ctx.strokeStyle = lines;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const x of xs) { ctx.moveTo(Math.round(x) + 0.5, ry); ctx.lineTo(Math.round(x) + 0.5, ry + rh); }
      for (const y of ys) { ctx.moveTo(rx, Math.round(y) + 0.5); ctx.lineTo(rx + rw, Math.round(y) + 0.5); }
      ctx.stroke();
      if (p > 0.25 && cs >= 18 && xs.length * ys.length < 4000) {
        const rings = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
        rings.addColorStop(0, col(0.4 * a));
        rings.addColorStop(1, col(0));
        ctx.strokeStyle = rings;
        ctx.beginPath();
        for (const x of xs) for (const y of ys) { ctx.moveTo(x + cs / 2, y); ctx.arc(x, y, cs / 2, 0, Math.PI * 2); }
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  UG.app = {
    state, world, R, toast,
    commit, scrub, setTool, setParam, setSpread, setPalette, newSeed, toggleAuto,
    setCamera: (x, y, z) => { state.cam = { x, y, z }; afterCamera(); },
    get total() { return moves.length; },
    markDirty: () => { dirty = true; },
    get moves() { return moves.slice(0, cursor); },
    get integrity() { return integrity; }
  };

  /* ───── Init ───── */
  sizeLeak();
  $('inputSeed').value = world.seed;
  $('seedBadge').textContent = world.seed;
  setPalette(state.palette);
  setTool('bond');
  setSpread('r');
  afterCamera();
  afterChange();
  if (moves.length) $('hint').classList.add('gone');
  let seen = false;
  try { seen = !!localStorage.getItem('ug-seen'); } catch (_) {}
  if (!seen && !hash.m) openAbout();
})();
