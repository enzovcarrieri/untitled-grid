/* ─────────────────────────────────────────────
   Untitled Grid — demo
   Open the site with #demo to play a scripted performance (~35 s) for
   screen recording: rules spreading, the interface being written,
   history healing it, and the poster. #demo=auto starts without a click.
   ───────────────────────────────────────────── */
(function () {
  const UG = window.UG;
  const app = UG.app;
  const flag = /(?:^|[#&])(demo(?:=auto)?)(?=&|$)/.exec(location.hash);
  if (!app || !flag) return;
  UG.demoMode = flag[1];

  const { state } = app;
  const $ = (id) => document.getElementById(id);
  const SEED = 'PXSLUR';
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const isMobile = () => innerWidth < 820;

  /* ───── A visible pointer: the real one never shows up in a recording ───── */
  const pointer = document.createElement('div');
  pointer.id = 'demoPointer';
  pointer.setAttribute('aria-hidden', 'true');
  pointer.innerHTML =
    '<svg viewBox="0 0 24 24" width="26" height="26">' +
    '<path d="M5 3l14 8-6.2 1.6 3.6 6.6-2.6 1.4-3.6-6.6L5 18.6z" fill="#0A0A0A" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  const canLayer = typeof pointer.showPopover === 'function';
  if (canLayer) pointer.setAttribute('popover', 'manual');
  document.body.appendChild(pointer);

  const pos = { x: innerWidth * 0.62, y: innerHeight * 0.72 };
  const place = () => { pointer.style.transform = `translate(${pos.x - 5}px, ${pos.y - 3}px)`; };
  place();

  // Re-enter the top layer so the pointer stays above any dialog opened after it.
  function raise() {
    if (!canLayer) return;
    try {
      if (pointer.matches(':popover-open')) pointer.hidePopover();
      pointer.showPopover();
    } catch (_) {}
  }

  function move(x, y, ms = 650) {
    const x0 = pos.x, y0 = pos.y, t0 = performance.now();
    return new Promise((resolve) => {
      const tick = (now) => {
        const p = Math.min(1, (now - t0) / ms);
        const e = ease(p);
        pos.x = x0 + (x - x0) * e;
        pos.y = y0 + (y - y0) * e;
        place();
        if (p < 1) requestAnimationFrame(tick); else resolve();
      };
      requestAnimationFrame(tick);
    });
  }

  async function press() {
    pointer.classList.remove('press');
    void pointer.offsetWidth;
    pointer.classList.add('press');
    const ring = document.createElement('div');
    ring.className = 'demo-ring';
    pointer.appendChild(ring);
    setTimeout(() => ring.remove(), 650);
    await sleep(160);
  }

  async function clickEl(el, ms = 750) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    await move(r.left + r.width / 2, r.top + r.height / 2, ms);
    await press();
    el.click();
  }

  function cellPoint(i, j) {
    const c = $('canvas').getBoundingClientRect();
    const [sx, sy] = app.R.toScreen(UG.cellToWorld(i) + UG.CELL / 2, UG.cellToWorld(j) + UG.CELL / 2);
    return [c.left + sx, c.top + sy];
  }

  // Point at a module, show where the rule will travel, then apply it.
  async function apply(t, i, j, rad, sp) {
    app.setParam('rad', rad);
    app.setSpread(sp);
    const [x, y] = cellPoint(i, j);
    await move(x, y, 600);
    state.hover = { i, j, path: '' };
    app.markDirty();
    await sleep(420);
    await press();
    state.hover = null;
    app.commit({ t, i, j, p: '', e: state.e, rad, per: state.per, sp });
  }

  // Many moves in quick succession, seeded so every take matches.
  async function burst(count, every) {
    const rng = UG.rng(UG.hash('demo-burst', SEED));
    const rules = ['B', 'B', 'S', 'S', 'R', 'M', 'I', 'T', 'X', 'X', 'G'];
    const spreads = ['r', 'r', 'a', 'd', 'q'];
    const ci = Math.floor(state.cam.x / (UG.BLOCK / UG.FRAME));
    const cj = Math.floor(state.cam.y / (UG.BLOCK / UG.FRAME));
    for (let k = 0; k < count; k++) {
      app.commit({
        t: rules[Math.floor(rng() * rules.length)],
        i: ci + Math.floor(rng() * 12) - 6,
        j: cj + Math.floor(rng() * 10) - 5,
        p: '', e: 45, rad: 1 + Math.floor(rng() * 3), per: 75,
        sp: spreads[Math.floor(rng() * spreads.length)]
      });
      await sleep(every);
    }
  }

  // Drag the history slider between two steps, rebuilding the state on the way.
  async function scrubTo(from, to, ms) {
    const r = $('rngTime').getBoundingClientRect();
    const total = Math.max(1, app.total);
    const xAt = (k) => r.left + 7 + (r.width - 14) * (k / total);
    const y = r.top + r.height / 2;
    await move(xAt(from), y, 550);
    pointer.classList.add('hold');
    const t0 = performance.now();
    await new Promise((resolve) => {
      let last = -1;
      const tick = (now) => {
        const p = Math.min(1, (now - t0) / ms);
        const at = from + (to - from) * ease(p);
        pos.x = xAt(at);
        pos.y = y;
        place();
        const k = Math.round(at);
        if (k !== last) { app.scrub(k); last = k; }
        if (p < 1) requestAnimationFrame(tick); else resolve();
      };
      requestAnimationFrame(tick);
    });
    pointer.classList.remove('hold');
  }

  function setChecked(id, on) {
    const el = $(id);
    if (el.checked === on) return;
    el.checked = on;
    el.dispatchEvent(new Event('change'));
  }

  function setup() {
    if ($('about').open) $('about').close();
    if ($('posterDlg').open) $('posterDlg').close();
    setChecked('chkGhosts', false);
    setChecked('chkContain', false);
    app.toggleAuto(false);
    app.newSeed(SEED);
    app.setPalette('technical');
    app.setTool('bond');
    app.setParam('e', 35);
    app.setParam('per', 80);
    app.setSpread('r');
    const stage = $('stage').getBoundingClientRect();
    const z = Math.min(1.1, Math.min(stage.width, stage.height) / (UG.FRAME * UG.CELL * 1.2));
    app.setCamera((UG.FRAME * UG.CELL) / 2, (UG.FRAME * UG.CELL) / 2, z);
    $('hint').classList.remove('gone');
  }

  let running = false;

  async function play() {
    if (running) return;
    running = true;
    setup();
    raise();

    // 1 · The thesis
    $('about').showModal();
    raise();
    await sleep(2800);
    await clickEl($('btnEnter'), 900);
    await sleep(500);

    // 2 · Bond: modules become nodes and fuse
    await apply('B', 3, 3, 2, 'r');
    await sleep(700);
    await apply('B', 4, 4, 2, 'r');
    await sleep(600);
    await apply('B', 2, 5, 1, 'r');
    await sleep(900);

    // 3 · Other rules, chosen from the toolbar
    await clickEl(document.querySelector('[data-tool="split"]'), 800);
    await apply('S', 6, 1, 2, 'q');
    await sleep(600);
    await clickEl(document.querySelector('[data-tool="type"]'), 700);
    await apply('T', 1, 1, 4, 'a');
    await sleep(800);
    await clickEl(document.querySelector('[data-tool="invert"]'), 700);
    await apply('I', 6, 6, 2, 'd');
    await sleep(900);

    // 4 · Let it run until the interface is written
    await clickEl($('btnAuto'), 900);
    await burst(66, 110);
    await sleep(2400);
    await clickEl($('btnAuto'), 700);
    await sleep(400);

    // 5 · History heals it, then brings it back
    const total = app.total;
    await scrubTo(total, 0, 3200);
    await sleep(1300);
    await scrubTo(0, total, 1600);
    await sleep(900);

    // 6 · The poster
    if (isMobile()) { await clickEl($('btnDesign'), 700); await sleep(500); }
    const btn = $('btnPoster');
    btn.scrollIntoView({ block: 'center' });
    await sleep(400);
    await clickEl(btn, 800);
    raise();

    running = false;
  }

  /* ───── Start ───── */
  raise();
  if (flag[1] === 'demo=auto') {
    setTimeout(play, 1200);
  } else {
    const gate = document.createElement('button');
    gate.id = 'demoStart';
    gate.innerHTML = '<span>Click to play the demo</span>';
    gate.addEventListener('click', () => { gate.remove(); play(); });
    document.body.appendChild(gate);
    if ($('about').open) $('about').close();
  }
})();
