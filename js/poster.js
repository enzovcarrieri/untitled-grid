/* ─────────────────────────────────────────────
   Untitled Grid — poster
   The current state as an A2 technical sheet: the written frames,
   registration marks, a title block with the state's figures, and the
   move list that rebuilds it printed along the edge.
   One drawing routine feeds the preview, the PNG and the SVG.
   ───────────────────────────────────────────── */
(function () {
  const UG = window.UG;
  const app = UG.app;
  if (!app) return;
  const { state, world } = app;
  const $ = (id) => document.getElementById(id);

  const W = 4200, H = 5940;     // A2 portrait; 1 unit = 0.1 mm
  const M = 220;                // outer margin
  const TITLE_H = 1160;
  const GAP = 120;              // between art and title block
  const ART = { x: M, y: M, w: W - 2 * M, h: H - 2 * M - TITLE_H - GAP };
  const MAX_COLS = 5, MAX_ROWS = 6;
  const PNG_WIDTH = 3276;       // ≈200 dpi, under mobile Safari's canvas limit
  const MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';
  const SANS = 'Inter, Helvetica, Arial, sans-serif';

  /* ───── Saving files: the downloads capability inside claude.ai, a link elsewhere ───── */
  UG.saveFile = async function (filename, blob) {
    if (window.claude && typeof window.claude.use === 'function') {
      const downloads = await window.claude.use('downloads');
      if (downloads) {
        try { await downloads.save({ filename, data: blob }); return 'saved'; }
        catch (e) { return e && e.code === 'declined' ? 'declined' : 'failed'; }
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return 'saved';
  };

  /* ───── What goes on the sheet ───── */
  // Whole frames around everything written (the view when nothing is), grown toward the sheet's proportion.
  function region() {
    let fi0 = Infinity, fj0 = Infinity, fi1 = -Infinity, fj1 = -Infinity;
    for (const key of world.cells.keys()) {
      const [i, j] = key.split(',').map(Number);
      const fi = UG.frameOf(i), fj = UG.frameOf(j);
      fi0 = Math.min(fi0, fi); fi1 = Math.max(fi1, fi);
      fj0 = Math.min(fj0, fj); fj1 = Math.max(fj1, fj);
    }
    if (!Number.isFinite(fi0)) {
      fi0 = fi1 = Math.floor(state.cam.x / UG.BLOCK);
      fj0 = fj1 = Math.floor(state.cam.y / UG.BLOCK);
    }
    const cap = (a0, a1, max) => {
      if (a1 - a0 + 1 <= max) return [a0, a1];
      const c = Math.floor((a0 + a1) / 2) - Math.floor(max / 2);
      return [c, c + max - 1];
    };
    [fi0, fi1] = cap(fi0, fi1, MAX_COLS);
    [fj0, fj1] = cap(fj0, fj1, MAX_ROWS);

    const target = ART.w / ART.h;
    for (let k = 0; k < 12; k++) {
      const cols = fi1 - fi0 + 1, rows = fj1 - fj0 + 1;
      const ratio = (cols * UG.BLOCK - UG.GAP) / (rows * UG.BLOCK - UG.GAP);
      if (ratio > target * 1.2 && rows < MAX_ROWS) { if (k % 2) fj0--; else fj1++; }
      else if (ratio < target / 1.2 && cols < MAX_COLS) { if (k % 2) fi0--; else fi1++; }
      else break;
    }
    return { fi0, fj0, cols: fi1 - fi0 + 1, rows: fj1 - fj0 + 1 };
  }

  function figures() {
    const moves = app.moves;
    const counts = {};
    for (const m of moves) if (m.t !== 'W') counts[m.t] = (counts[m.t] || 0) + 1;
    const frames = new Set();
    for (const key of world.cells.keys()) {
      const [i, j] = key.split(',').map(Number);
      frames.add(UG.frameOf(i) + ',' + UG.frameOf(j));
    }
    const d = new Date();
    const pad2 = (v) => String(v).padStart(2, '0');
    const host = /^https?:$/.test(location.protocol) && !/claude|localhost|127\.0\.0\.1/.test(location.host)
      ? (location.host + location.pathname).replace(/index\.html$/, '').replace(/\/$/, '')
      : '';
    return {
      seed: world.seed,
      state: moves.length,
      modules: world.cells.size,
      frames: frames.size,
      specimens: `${world.specimens.size}/${UG.SPECIMEN_TOTAL}`,
      integrity: app.integrity,
      date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
      counts,
      host,
      source: `seed=${world.seed}` + (moves.length ? `&m=${UG.encodeMoves(moves)}` : '')
    };
  }

  /* ───── Drawing (any 2D context: canvas or UG.SVGContext) ───── */
  function drawArt(ctx, reg, P) {
    const B = UG.BLOCK, F = UG.FRAME, C = UG.CELL, FS = F * C;
    ctx.fillStyle = P.frame;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = P.canvas;
    ctx.fillRect(ART.x, ART.y, ART.w, ART.h);

    const worldW = reg.cols * B - UG.GAP, worldH = reg.rows * B - UG.GAP;
    const pad = 160;
    const s = Math.min((ART.w - 2 * pad) / worldW, (ART.h - 2 * pad) / worldH);
    const ox = ART.x + (ART.w - worldW * s) / 2;
    const oy = ART.y + (ART.h - worldH * s) / 2;
    const cs = C * s;
    const rf = state.fuse > 0 ? cs * (0.08 + 1.3 * Math.pow(state.fuse / 100, 2)) : 0;
    const labelSize = Math.max(22, Math.min(44, cs * 0.2));

    for (let r = 0; r < reg.rows; r++) {
      for (let c = 0; c < reg.cols; c++) {
        const fi = reg.fi0 + c, fj = reg.fj0 + r;
        const sx = ox + c * B * s, sy = oy + r * B * s, sw = FS * s;

        ctx.fillStyle = P.frame;
        ctx.fillRect(sx, sy, sw, sw);
        ctx.fillStyle = P.label;
        ctx.font = `400 ${labelSize}px ${MONO}`;
        ctx.textBaseline = 'bottom';
        ctx.textAlign = 'left';
        ctx.fillText(`FRAME ${fi}:${fj}`, sx, sy - labelSize * 0.5);
        ctx.textAlign = 'right';
        ctx.fillText(`${FS}×${FS}`, sx + sw, sy - labelSize * 0.5);

        if (state.construct) UG.drawConstruction(ctx, sx, sy, F, F, cs, P, Infinity, Infinity);

        const written = new Map();
        ctx.beginPath();
        for (let cj = 0; cj < F; cj++) {
          for (let ci = 0; ci < F; ci++) {
            const i = fi * F + ci, j = fj * F + cj;
            const node = world.cells.get(i + ',' + j);
            if (node) { written.set(ci + ',' + cj, node); continue; }
            const g = world.ghost(i, j);
            if (g.g) UG.addGlyph(ctx, g.g, g.r, g.f, sx + ci * cs, sy + cj * cs, cs, cs);
          }
        }
        ctx.strokeStyle = P.ghost;
        ctx.lineWidth = 1;
        ctx.stroke();

        for (const [key, node] of written) {
          const [ci, cj] = key.split(',').map(Number);
          UG.drawNode(ctx, node, sx + ci * cs, sy + cj * cs, cs, cs, P);
        }
        if (rf > 0) fuse(ctx, written, sx, sy, cs, rf, P);
      }
    }
    return s;
  }

  function fuse(ctx, written, sx, sy, cs, rf, P) {
    const ok = (n) => n && !n.k && !n.v && n.c !== 1 && (n.g === 3 || n.g === 8);
    for (const [key, n] of written) {
      if (!ok(n)) continue;
      const [ci, cj] = key.split(',').map(Number);
      const same = (di, dj) => {
        const o = written.get(ci + di + ',' + (cj + dj));
        return ok(o) && o.g === n.g && o.c === n.c;
      };
      const R = cs * (n.g === 3 ? 0.5 : 0.17);
      const x = sx + (ci + 0.5) * cs, y = sy + (cj + 0.5) * cs;
      ctx.fillStyle = n.c === 2 ? UG.hatch(ctx, P.ink) : P.ink;
      if (same(1, 0)) UG.bridge(ctx, x, y, x + cs, y, R, rf);
      if (same(0, 1)) UG.bridge(ctx, x, y, x, y + cs, R, rf);
      if (n.g === 3 && same(1, 0) && same(0, 1) && same(1, 1)) ctx.fillRect(x, y, cs, cs);
    }
  }

  function drawMarks(ctx, P) {
    const { x, y, w, h } = ART;
    const L = 110, o = 40, r = 34;
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    // crop marks
    for (const [cx, cy, dx, dy] of [[x, y, -1, -1], [x + w, y, 1, -1], [x, y + h, -1, 1], [x + w, y + h, 1, 1]]) {
      ctx.moveTo(cx + dx * o, cy); ctx.lineTo(cx + dx * (o + L), cy);
      ctx.moveTo(cx, cy + dy * o); ctx.lineTo(cx, cy + dy * (o + L));
    }
    // registration targets
    for (const [cx, cy] of [[x + w / 2, M / 2], [M / 2, y + h / 2]]) {
      ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.moveTo(cx - r * 1.7, cy); ctx.lineTo(cx + r * 1.7, cy);
      ctx.moveTo(cx, cy - r * 1.7); ctx.lineTo(cx, cy + r * 1.7);
    }
    ctx.stroke();
  }

  function drawTitleBlock(ctx, P, fig, s) {
    const x = M, y = ART.y + ART.h + GAP, w = W - 2 * M, h = TITLE_H;
    const row1 = 520, row2 = 280, pad = 70;

    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + row1); ctx.lineTo(x + w, y + row1);
    ctx.moveTo(x, y + row1 + row2); ctx.lineTo(x + w, y + row1 + row2);

    // Row 1 — name, thesis, state number
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = P.ink;
    ctx.font = `500 250px ${SANS}`;
    ctx.fillText('Untitled Grid', x + pad, y + 300);
    ctx.fillStyle = UG.SIGNAL;
    ctx.font = `400 46px ${MONO}`;
    ctx.fillText('A DESIGN TOOL WITH NO USER.', x + pad, y + 420);

    ctx.textAlign = 'right';
    ctx.fillStyle = P.label;
    ctx.font = `400 34px ${MONO}`;
    ctx.fillText('STATE', x + w - pad, y + 110);
    ctx.fillStyle = P.ink;
    ctx.font = `500 330px ${SANS}`;
    ctx.fillText(String(fig.state).padStart(3, '0'), x + w - pad, y + 430);

    // Row 2 — figures
    const fields = [
      ['Seed', fig.seed], ['Modules', fig.modules], ['Frames', fig.frames], ['Specimens', fig.specimens],
      ['Integrity', fig.integrity], ['Module', `${(UG.CELL * s * 0.1).toFixed(1)} mm`], ['Date', fig.date]
    ];
    const cw = w / fields.length;
    for (let k = 1; k < fields.length; k++) { ctx.moveTo(x + k * cw, y + row1); ctx.lineTo(x + k * cw, y + row1 + row2); }
    ctx.stroke();
    fields.forEach(([label, value], k) => {
      const fx = x + k * cw + 40;
      const text = String(value);
      ctx.textAlign = 'left';
      ctx.fillStyle = P.label;
      ctx.font = `400 30px ${MONO}`;
      ctx.fillText(label.toUpperCase(), fx, y + row1 + 80);
      ctx.fillStyle = P.ink;
      ctx.font = `500 ${Math.min(62, (cw - 80) / (text.length * 0.6))}px ${MONO}`;
      ctx.fillText(text, fx, y + row1 + 200);
    });

    // Row 3 — rules applied, credit
    const y3 = y + row1 + row2;
    ctx.textAlign = 'left';
    ctx.fillStyle = P.label;
    ctx.font = `400 30px ${MONO}`;
    ctx.fillText('RULES APPLIED', x + pad, y3 + 90);
    ctx.font = `500 48px ${MONO}`;
    let rx = x + pad;
    for (const code of ['B', 'S', 'R', 'M', 'I', 'T', 'X', 'G', 'E']) {
      const count = fig.counts[code] || 0;
      const label = `${UG.RULES[UG.CODE_TO_RULE[code]].name} ${count}`;
      ctx.fillStyle = count ? P.ink : P.label;
      ctx.fillText(label, rx, y3 + 180);
      rx += (label.length + 2) * 48 * 0.6;
    }
    ctx.fillStyle = P.label;
    ctx.font = `400 32px ${MONO}`;
    ctx.fillText('Every mark on this sheet was produced by rules. None of it was drawn.', x + pad, y3 + 300);
    if (fig.host) {
      ctx.textAlign = 'right';
      ctx.fillText(fig.host, x + w - pad, y3 + 300);
    }
  }

  // The move list that rebuilds this exact state, running up the right margin.
  function drawSource(ctx, P, fig) {
    const size = 20, lineH = 30, maxLines = 5;
    const perLine = Math.floor((H - 2 * M) / (size * 0.6));
    const text = 'STATE SOURCE  ' + fig.source;
    const lines = [];
    for (let k = 0; k < text.length && lines.length < maxLines; k += perLine) lines.push(text.slice(k, k + perLine));
    if (text.length > perLine * maxLines) lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…';
    ctx.save();
    ctx.translate(W - M + 50, H - M);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = P.label;
    ctx.font = `400 ${size}px ${MONO}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    lines.forEach((line, k) => ctx.fillText(line, 0, k * lineH));
    ctx.restore();
  }

  function drawSheet(ctx, sheet) {
    const P = UG.PALETTES[state.palette] || UG.PALETTES.technical;
    const s = drawArt(ctx, sheet.reg, P);
    drawMarks(ctx, P);
    drawTitleBlock(ctx, P, sheet.fig, s);
    drawSource(ctx, P, sheet.fig);
  }

  function renderCanvas(canvas, width, sheet) {
    const k = width / W;
    canvas.width = Math.round(W * k);
    canvas.height = Math.round(H * k);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(k, 0, 0, k, 0, 0);
    drawSheet(ctx, sheet);
  }

  /* ───── Dialog ───── */
  let sheet = null;
  const filename = (ext) => `untitled-grid-${world.seed}-state-${String(sheet.fig.state).padStart(3, '0')}.${ext}`;
  const status = (msg) => { $('posterStatus').textContent = msg; };
  const report = (result) => status(
    result === 'saved' ? 'Saved.' : result === 'declined' ? 'Download cancelled.' : 'This view cannot save files.'
  );

  function openPoster() {
    sheet = { reg: region(), fig: figures() };
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderCanvas($('posterCanvas'), Math.round(Math.min(420, innerWidth - 72) * dpr), sheet);
    $('posterMeta').textContent = `A2 · 420 × 594 mm · ${sheet.reg.cols} × ${sheet.reg.rows} frames · state ${sheet.fig.state}`;
    status('Vector for print. The move list that rebuilds this state runs up the right edge.');
    $('posterDlg').showModal();
  }

  $('btnPoster').addEventListener('click', openPoster);
  $('btnPosterClose').addEventListener('click', () => $('posterDlg').close());
  $('posterDlg').addEventListener('click', (ev) => { if (ev.target === $('posterDlg')) $('posterDlg').close(); });

  $('btnPosterSvg').addEventListener('click', async () => {
    status('Drawing vectors…');
    const ctx = new UG.SVGContext(W, H, { unitMM: 0.1 });
    drawSheet(ctx, sheet);
    report(await UG.saveFile(filename('svg'), new Blob([ctx.toString()], { type: 'image/svg+xml' })));
  });

  $('btnPosterPng').addEventListener('click', () => {
    status('Rendering PNG…');
    const canvas = document.createElement('canvas');
    renderCanvas(canvas, PNG_WIDTH, sheet);
    canvas.toBlob(async (blob) => {
      if (!blob) { status('This browser could not render the PNG. Download the SVG instead.'); return; }
      report(await UG.saveFile(filename('png'), blob));
    }, 'image/png');
  });
})();
