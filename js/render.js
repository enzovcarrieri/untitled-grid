/* ─────────────────────────────────────────────
   Untitled Grid — renderer
   Canvas 2D, only what is on screen.
   Three layers of meaning:
   construction (system colour) · written matter (ink) · attention (signal).
   ───────────────────────────────────────────── */
(function () {
  const UG = window.UG;
  const TAU = Math.PI * 2;

  // Eased position of a moving cursor {x0,y0,x1,y1,t0,dur}.
  function tween(b, now) {
    const p = Math.min(1, Math.max(0, (now - b.t0) / b.dur));
    const e = 1 - Math.pow(1 - p, 3);
    return [b.x0 + (b.x1 - b.x0) * e, b.y0 + (b.y1 - b.y0) * e];
  }

  UG.SYS = '#4B57F5';     // selection, focus
  UG.SIGNAL = '#D4157D';  // hover, propagation, measurement
  UG.GHOST = '#7A83F2';   // earlier sessions

  UG.PALETTES = {
    technical: {
      canvas: '#E6E6EA', frame: '#F4F4F6', paper: '#F4F4F6',
      construct: 'rgba(88, 100, 240, 0.30)', circle: 'rgba(88, 100, 240, 0.22)', dot: 'rgba(30, 30, 50, 0.30)',
      ghost: 'rgba(88, 100, 240, 0.50)', label: '#8C8C96', ink: '#0A0A0A'
    },
    blueprint: {
      canvas: '#141F63', frame: '#1A287C', paper: '#1A287C',
      construct: 'rgba(255, 255, 255, 0.16)', circle: 'rgba(255, 255, 255, 0.11)', dot: 'rgba(255, 255, 255, 0.35)',
      ghost: 'rgba(255, 255, 255, 0.36)', label: 'rgba(255, 255, 255, 0.55)', ink: '#FFFFFF'
    },
    print: {
      canvas: '#E3E0D8', frame: '#F2F0EA', paper: '#F2F0EA',
      construct: 'rgba(40, 40, 40, 0.14)', circle: 'rgba(40, 40, 40, 0.10)', dot: 'rgba(40, 40, 40, 0.35)',
      ghost: 'rgba(255, 79, 0, 0.55)', label: '#8A857A', ink: '#111111'
    },
    negative: {
      canvas: '#050505', frame: '#0F0F11', paper: '#0F0F11',
      construct: 'rgba(140, 150, 255, 0.20)', circle: 'rgba(140, 150, 255, 0.13)', dot: 'rgba(255, 255, 255, 0.25)',
      ghost: 'rgba(140, 150, 255, 0.45)', label: '#6A6A72', ink: '#F2F2F2'
    }
  };

  /* ───── Glyphs (unit square, centred) ───── */
  // Every curve starts with moveTo so glyphs can be batched into one path.
  UG.glyphPath = function (ctx, g) {
    switch (g) {
      case 1: ctx.moveTo(-0.5, -0.5); ctx.arc(-0.5, -0.5, 1, 0, Math.PI / 2); ctx.closePath(); break;
      case 2: ctx.rect(-0.5, -0.5, 0.5, 1); break;
      case 3: ctx.moveTo(0.5, 0); ctx.arc(0, 0, 0.5, 0, TAU); break;
      case 4: ctx.moveTo(-0.5, -0.5); ctx.lineTo(0.5, -0.5); ctx.lineTo(-0.5, 0.5); ctx.closePath(); break;
      case 5: ctx.moveTo(-0.5, 0.5); ctx.lineTo(-0.5, 0); ctx.arc(0, 0, 0.5, Math.PI, TAU); ctx.lineTo(0.5, 0.5); ctx.closePath(); break;
      case 6: ctx.rect(-0.5, -0.5, 1, 0.2); ctx.rect(-0.5, -0.1, 1, 0.2); ctx.rect(-0.5, 0.3, 1, 0.2); break;
      case 7: ctx.moveTo(0.5, 0); ctx.arc(0, 0, 0.5, 0, TAU); ctx.moveTo(0.25, 0); ctx.arc(0, 0, 0.25, 0, TAU); break;
      case 8: ctx.moveTo(0.17, 0); ctx.arc(0, 0, 0.17, 0, TAU); break;
      case 9:
        ctx.moveTo(-0.5, 0.5); ctx.lineTo(-0.5, -0.5); ctx.lineTo(-1 / 6, -0.5); ctx.lineTo(-1 / 6, -1 / 6);
        ctx.lineTo(1 / 6, -1 / 6); ctx.lineTo(1 / 6, 1 / 6); ctx.lineTo(0.5, 1 / 6); ctx.lineTo(0.5, 0.5); ctx.closePath();
        break;
      case 10: ctx.rect(-0.5, -0.125, 1, 0.25); ctx.rect(-0.125, -0.5, 0.25, 0.375); ctx.rect(-0.125, 0.125, 0.25, 0.375); break;
    }
  };

  // Append a glyph to the current path in screen space. The path keeps its
  // transformed coordinates after restore(), so strokes stay hairline and
  // patterns stay unscaled.
  function addGlyph(ctx, g, r, f, x, y, w, h) {
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.scale(w, h);
    ctx.rotate((r * Math.PI) / 2);
    if (f) ctx.scale(-1, 1);
    UG.glyphPath(ctx, g);
    ctx.restore();
  }
  UG.addGlyph = addGlyph;

  const hatches = new Map();
  function hatch(ctx, color) {
    let p = hatches.get(color);
    if (!p) {
      const c = document.createElement('canvas');
      c.width = c.height = 6;
      const g = c.getContext('2d');
      g.strokeStyle = color;
      g.lineWidth = 1.1;
      g.beginPath();
      g.moveTo(-1, 7); g.lineTo(7, -1);
      g.moveTo(-1, 1); g.lineTo(1, -1);
      g.moveTo(5, 7); g.lineTo(7, 5);
      g.stroke();
      p = ctx.createPattern(c, 'repeat');
      hatches.set(color, p);
    }
    return p;
  }

  function letter(ctx, n, x, y, w, h, style, outline) {
    const odd = n.r % 2 === 1;
    const bw = odd ? h : w, bh = odd ? w : h;
    const fs = bh * 1.02;
    if (fs < 4) return;
    const sx = Math.max(0.4, Math.min(3, (bw / bh) * 1.3));
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate((n.r * Math.PI) / 2);
    ctx.scale((n.f ? -1 : 1) * sx, 1);
    ctx.font = `500 ${fs}px "JetBrains Mono", ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (outline) {
      ctx.strokeStyle = style;
      ctx.lineWidth = 1.2 / sx;
      ctx.strokeText(n.ch, 0, fs * 0.05);
    } else {
      ctx.fillStyle = style;
      ctx.fillText(n.ch, 0, fs * 0.05);
    }
    ctx.restore();
  }

  /* ───── Written matter ───── */
  // Colour index becomes a rendering mode: 0 solid, 1 line, 2 hatch.
  UG.drawNode = function (ctx, n, x, y, w, h, P) {
    if (n.k) {
      const rs = UG.childRects(x, y, w, h, n.d);
      UG.drawNode(ctx, n.k[0], rs[0][0], rs[0][1], rs[0][2], rs[0][3], P);
      UG.drawNode(ctx, n.k[1], rs[1][0], rs[1][1], rs[1][2], rs[1][3], P);
      return;
    }
    const mode = n.c === 1 ? 'line' : n.c === 2 ? 'hatch' : 'solid';
    const fill = mode === 'hatch' ? hatch(ctx, P.ink) : P.ink;
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = P.ink;

    if (n.v) {
      if (mode === 'line') ctx.strokeRect(x + 0.6, y + 0.6, w - 1.2, h - 1.2);
      else { ctx.fillStyle = fill; ctx.fillRect(x, y, w + 0.6, h + 0.6); }
    }
    if (n.g === 0) return;

    const outline = !n.v && mode === 'line';
    const glyphFill = n.v ? (mode === 'line' ? P.ink : P.paper) : fill;

    if (n.g === UG.LETTER) { letter(ctx, n, x, y, w, h, outline ? P.ink : glyphFill, outline); return; }

    ctx.beginPath();
    addGlyph(ctx, n.g, n.r, n.f, x, y, w, h);
    if (outline) ctx.stroke();
    else { ctx.fillStyle = glyphFill; ctx.fill(n.g === 7 ? 'evenodd' : 'nonzero'); }
  };

  /* ───── Fusion ───── */
  // Fill the neck between two circles with concave fillets of radius rf.
  UG.bridge = function (ctx, x1, y1, x2, y2, R, rf) {
    const dx = x2 - x1, dy = y2 - y1, D = Math.hypot(dx, dy), half = D / 2;
    if (!D || R + rf <= half) return;
    const h = Math.sqrt((R + rf) * (R + rf) - half * half);
    if (h - rf < 0.03 * R) return;
    const nx = -dy / D, ny = dx / D, mx = x1 + dx / 2, my = y1 + dy / 2;
    const k = R / (R + rf);
    const c1x = mx + nx * h, c1y = my + ny * h, c2x = mx - nx * h, c2y = my - ny * h;
    const arc = (cx, cy, ax, ay, bx, by) => {
      const a0 = Math.atan2(ay - cy, ax - cx);
      let d = Math.atan2(by - cy, bx - cx) - a0;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      for (let s = 1; s <= 12; s++) {
        const a = a0 + (d * s) / 12;
        ctx.lineTo(cx + Math.cos(a) * rf, cy + Math.sin(a) * rf);
      }
    };
    const a1x = x1 + (c1x - x1) * k, a1y = y1 + (c1y - y1) * k;
    const a2x = x2 + (c1x - x2) * k, a2y = y2 + (c1y - y2) * k;
    const b2x = x2 + (c2x - x2) * k, b2y = y2 + (c2y - y2) * k;
    const b1x = x1 + (c2x - x1) * k, b1y = y1 + (c2y - y1) * k;
    ctx.beginPath();
    ctx.moveTo(a1x, a1y);
    arc(c1x, c1y, a1x, a1y, a2x, a2y);
    ctx.lineTo(b2x, b2y);
    arc(c2x, c2y, b2x, b2y, b1x, b1y);
    ctx.closePath();
    ctx.fill();
  };

  const fusible = (n) => n && !n.k && !n.v && n.c !== 1 && (n.g === 3 || n.g === 8);

  /* ───── Construction ───── */
  // Axes through module centres, inscribed circles, registration dots at corners.
  UG.drawConstruction = function (ctx, x0, y0, cols, rows, cs, P, vw, vh) {
    if (cs < 10) return;
    const W = cols * cs, H = rows * cs;
    ctx.lineWidth = 1;

    ctx.strokeStyle = P.construct;
    ctx.beginPath();
    for (let k = 0; k < cols; k++) {
      const x = Math.round(x0 + (k + 0.5) * cs) + 0.5;
      if (x < 0 || x > vw) continue;
      ctx.moveTo(x, Math.max(0, y0)); ctx.lineTo(x, Math.min(vh, y0 + H));
    }
    for (let k = 0; k < rows; k++) {
      const y = Math.round(y0 + (k + 0.5) * cs) + 0.5;
      if (y < 0 || y > vh) continue;
      ctx.moveTo(Math.max(0, x0), y); ctx.lineTo(Math.min(vw, x0 + W), y);
    }
    ctx.stroke();

    if (cs >= 18) {
      ctx.strokeStyle = P.circle;
      ctx.beginPath();
      const r = cs * 0.5;
      for (let j = 0; j < rows; j++) {
        const cy = y0 + (j + 0.5) * cs;
        if (cy + r < 0 || cy - r > vh) continue;
        for (let i = 0; i < cols; i++) {
          const cx = x0 + (i + 0.5) * cs;
          if (cx + r < 0 || cx - r > vw) continue;
          ctx.moveTo(cx + r, cy);
          ctx.arc(cx, cy, r, 0, TAU);
        }
      }
      ctx.stroke();
    }

    if (cs >= 14) {
      ctx.fillStyle = P.dot;
      ctx.beginPath();
      for (let j = 0; j <= rows; j++) {
        const y = Math.round(y0 + j * cs);
        if (y < -2 || y > vh + 2) continue;
        for (let i = 0; i <= cols; i++) {
          const x = Math.round(x0 + i * cs);
          if (x < -2 || x > vw + 2) continue;
          ctx.rect(x - 1, y - 1, 2, 2);
        }
      }
      ctx.fill();
    }
  };

  function pill(ctx, text, cx, cy, bg, fg) {
    ctx.font = '500 10px "JetBrains Mono", ui-monospace, monospace';
    const w = ctx.measureText(text).width + 10, h = 16;
    ctx.fillStyle = bg;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(cx - w / 2, cy - h / 2, w, h, 8);
    else ctx.rect(cx - w / 2, cy - h / 2, w, h);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, cy + 0.5);
  }

  class Renderer {
    constructor(canvas, world, state) {
      this.c = canvas;
      this.ctx = canvas.getContext('2d');
      this.world = world;
      this.s = state;
      this.w = 1; this.h = 1; this.dpr = 1;
    }

    resize() {
      const r = this.c.parentElement.getBoundingClientRect();
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = Math.max(1, r.width);
      this.h = Math.max(1, r.height);
      this.c.width = Math.round(this.w * this.dpr);
      this.c.height = Math.round(this.h * this.dpr);
    }

    toScreen(wx, wy) {
      const c = this.s.cam;
      return [(wx - c.x) * c.z + this.w / 2, (wy - c.y) * c.z + this.h / 2];
    }
    toWorld(sx, sy) {
      const c = this.s.cam;
      return [(sx - this.w / 2) / c.z + c.x, (sy - this.h / 2) / c.z + c.y];
    }

    rectFor(i, j, path) {
      const node = this.world.node(i, j);
      return UG.resolvePath(node, UG.cellToWorld(i), UG.cellToWorld(j), UG.CELL, UG.CELL, path).rect;
    }

    draw(now) {
      const { ctx, s } = this;
      const z = s.cam.z;
      const P = UG.PALETTES[s.palette] || UG.PALETTES.technical;
      const F = UG.FRAME, C = UG.CELL, B = UG.BLOCK, FS = F * C;

      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = P.canvas;
      ctx.fillRect(0, 0, this.w, this.h);

      const [wx0, wy0] = this.toWorld(0, 0);
      const [wx1, wy1] = this.toWorld(this.w, this.h);
      const fi0 = Math.floor(wx0 / B), fi1 = Math.floor(wx1 / B);
      const fj0 = Math.floor(wy0 / B), fj1 = Math.floor(wy1 / B);
      const cs = C * z;
      const ghosts = cs >= 12;
      const rf = s.fuse > 0 ? cs * (0.08 + 1.3 * Math.pow(s.fuse / 100, 2)) : 0;

      for (let fj = fj0; fj <= fj1; fj++) {
        for (let fi = fi0; fi <= fi1; fi++) {
          const [sx, sy] = this.toScreen(fi * B, fj * B);
          const sw = FS * z;

          ctx.fillStyle = P.frame;
          ctx.fillRect(sx, sy, sw, sw);

          if (z > 0.32) {
            ctx.fillStyle = P.label;
            ctx.font = '400 10px "JetBrains Mono", ui-monospace, monospace';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            ctx.fillText(`FRAME ${fi}:${fj}`, sx, sy - 6);
            ctx.textAlign = 'right';
            ctx.fillText(`${FS}×${FS}`, sx + sw, sy - 6);
          }

          if (s.construct) UG.drawConstruction(ctx, sx, sy, F, F, cs, P, this.w, this.h);

          // Pass 1 — unwritten modules as one hairline path; collect written ones.
          const written = [];
          if (ghosts) ctx.beginPath();
          for (let cj = 0; cj < F; cj++) {
            const y = sy + cj * cs;
            if (y > this.h || y + cs < 0) continue;
            for (let ci = 0; ci < F; ci++) {
              const x = sx + ci * cs;
              if (x > this.w || x + cs < 0) continue;
              const i = fi * F + ci, j = fj * F + cj, key = i + ',' + j;

              let node = this.world.cells.get(key) || null;
              let scale = 1, flash = 0, settled = true;
              const a = s.anims.get(key);
              if (a) {
                if (now < a.at) { node = a.prev; settled = false; }
                else {
                  const p = (now - a.at) / 240;
                  if (p >= 1) s.anims.delete(key);
                  else { const q = Math.floor(p * 4) / 4; scale = 0.72 + 0.28 * q; flash = 1 - q; settled = false; }
                }
              }
              if (!node) {
                if (!ghosts) continue;
                const g = this.world.ghost(i, j);
                if (g.g) addGlyph(ctx, g.g, g.r, g.f, x, y, cs, cs);
                continue;
              }
              written.push({ node, x, y, scale, flash, settled, ci, cj });
            }
          }
          if (ghosts) { ctx.strokeStyle = P.ghost; ctx.lineWidth = 1; ctx.stroke(); }

          if (cs >= 110 && !s.clean) {
            ctx.fillStyle = P.label;
            ctx.font = '400 9px "JetBrains Mono", ui-monospace, monospace';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            for (let cj = 0; cj < F; cj++) for (let ci = 0; ci < F; ci++) {
              const x = sx + ci * cs + 4, y = sy + cj * cs + 4;
              if (x > this.w || y > this.h || x + cs < 0 || y + cs < 0) continue;
              ctx.fillText(`${fi * F + ci},${fj * F + cj}`, x, y);
            }
          }

          // Pass 2 — written matter.
          const grid = new Map();
          for (const it of written) {
            const pad = (cs * (1 - it.scale)) / 2;
            UG.drawNode(ctx, it.node, it.x + pad, it.y + pad, cs - 2 * pad, cs - 2 * pad, P);
            if (it.settled && fusible(it.node)) grid.set(it.ci + ',' + it.cj, it);
          }

          // Pass 3 — neighbouring nodes fuse.
          if (rf > 0 && grid.size > 1) {
            for (const it of grid.values()) {
              const n = it.node;
              const R = cs * (n.g === 3 ? 0.5 : 0.17);
              ctx.fillStyle = n.c === 2 ? hatch(ctx, P.ink) : P.ink;
              const same = (di, dj) => {
                const o = grid.get(it.ci + di + ',' + (it.cj + dj));
                return o && o.node.g === n.g && o.node.c === n.c ? o : null;
              };
              for (const [di, dj] of [[1, 0], [0, 1]]) {
                const o = same(di, dj);
                if (o) UG.bridge(ctx, it.x + cs / 2, it.y + cs / 2, o.x + cs / 2, o.y + cs / 2, R, rf);
              }
              // A closed 2×2 cluster of discs becomes one continuous mass.
              if (n.g === 3 && same(1, 0) && same(0, 1) && same(1, 1)) {
                ctx.fillRect(it.x + cs / 2, it.y + cs / 2, cs, cs);
              }
            }
          }

          // Pass 4 — attention.
          if (!s.clean) {
            ctx.strokeStyle = UG.SIGNAL;
            ctx.lineWidth = 1;
            for (const it of written) {
              if (!it.flash) continue;
              ctx.globalAlpha = it.flash;
              ctx.beginPath();
              ctx.arc(it.x + cs / 2, it.y + cs / 2, cs * 0.5, 0, TAU);
              ctx.stroke();
            }
            ctx.globalAlpha = 1;
          }
        }
      }

      let busy = s.anims.size > 0;
      if (!s.clean) busy = this.drawOverlays(now) || busy;
      return busy;
    }

    drawOverlays(now) {
      const { ctx, s } = this;
      const z = s.cam.z, cs = UG.CELL * z;
      const P = UG.PALETTES[s.palette] || UG.PALETTES.technical;
      let busy = s.echoes.length ? this.drawEchoes(now, P) : false;

      if (s.hover) {
        const h = s.hover;
        if (s.tool !== 'select' && s.sp !== 'w' && s.rad > 0 && !s.shift) {
          ctx.strokeStyle = UG.SIGNAL;
          ctx.lineWidth = 1;
          for (const t of UG.spreadTargets(s.sp, s.rad, () => 0.5)) {
            if (!t.d) continue;
            const [x, y] = this.toScreen(UG.cellToWorld(h.i + t.di), UG.cellToWorld(h.j + t.dj));
            ctx.globalAlpha = Math.max(0.12, Math.pow(s.per / 100, t.d)) * 0.9;
            ctx.beginPath();
            ctx.arc(x + cs / 2, y + cs / 2, cs * 0.5 - 0.5, 0, TAU);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
        const r = this.rectFor(h.i, h.j, h.path);
        const [x, y] = this.toScreen(r[0], r[1]);
        const w = r[2] * z, hh = r[3] * z;
        ctx.strokeStyle = UG.SIGNAL;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 0.75, y + 0.75, w - 1.5, hh - 1.5);
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + hh / 2, w / 2 - 0.75, hh / 2 - 0.75, 0, 0, TAU);
        ctx.stroke();
      }

      if (s.sel) this.drawSelection(s.sel);

      if (s.focus) {
        const [x, y] = this.toScreen(UG.cellToWorld(s.focus.i), UG.cellToWorld(s.focus.j));
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = UG.SYS;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 1, y + 1, cs - 2, cs - 2);
        ctx.setLineDash([]);
      }

      for (const g of s.ghosts) {
        const [wx, wy] = tween(g, now);
        this.drawReticle(wx, wy, g.name, UG.GHOST, true);
        busy = true;
      }
      for (const p of s.peers.values()) busy = this.drawPeer(p, P) || busy;
      if (s.bot) {
        const [wx, wy] = tween(s.bot, now);
        this.drawReticle(wx, wy, s.bot.name, UG.SIGNAL, false);
        busy = true;
      }
      return busy;
    }

    drawSelection(sel) {
      const { ctx } = this;
      const z = this.s.cam.z;
      const r = this.rectFor(sel.i, sel.j, sel.path);
      const [x, y] = this.toScreen(r[0], r[1]);
      const w = r[2] * z, h = r[3] * z;

      if (z > 0.3) {
        const FS = UG.FRAME * UG.CELL;
        const fx = UG.frameOf(sel.i) * UG.BLOCK, fy = UG.frameOf(sel.j) * UG.BLOCK;
        const [fsx, fsy] = this.toScreen(fx, fy);
        const fsw = FS * z;
        const cx = x + w / 2, cy = y + h / 2;
        const lines = [
          [r[0] - fx, fsx, cy, x, cy],
          [fx + FS - r[0] - r[2], x + w, cy, fsx + fsw, cy],
          [r[1] - fy, cx, fsy, cx, y],
          [fy + FS - r[1] - r[3], cx, y + h, cx, fsy + fsw]
        ];
        ctx.strokeStyle = UG.SIGNAL;
        ctx.lineWidth = 1;
        for (const [dist, x1, y1, x2, y2] of lines) {
          if (dist <= 0) continue;
          ctx.beginPath();
          ctx.moveTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
          ctx.lineTo(Math.round(x2) + 0.5, Math.round(y2) + 0.5);
          // end ticks
          const vert = x1 === x2;
          for (const [px, py] of [[x1, y1], [x2, y2]]) {
            if (vert) { ctx.moveTo(Math.round(px) - 3, Math.round(py) + 0.5); ctx.lineTo(Math.round(px) + 4, Math.round(py) + 0.5); }
            else { ctx.moveTo(Math.round(px) + 0.5, Math.round(py) - 3); ctx.lineTo(Math.round(px) + 0.5, Math.round(py) + 4); }
          }
          ctx.stroke();
          pill(ctx, String(Math.round(dist)), (x1 + x2) / 2, (y1 + y2) / 2, UG.SIGNAL, '#fff');
        }
      }

      ctx.strokeStyle = UG.SYS;
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
      ctx.fillStyle = '#fff';
      for (const [hx, hy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
        ctx.fillRect(Math.round(hx) - 3, Math.round(hy) - 3, 7, 7);
        ctx.strokeRect(Math.round(hx) - 2.5, Math.round(hy) - 2.5, 6, 6);
      }
      pill(ctx, `${r[2]} × ${r[3]}`, x + w / 2, y + h + 14, UG.SYS, '#fff');
    }

    // Echo of a rule someone else applied: rings travel the spread, nothing is written.
    drawEchoes(now, P) {
      const { ctx, s } = this;
      const cs = UG.CELL * s.cam.z;
      s.echoes = s.echoes.filter((e) => now - e.t0 < e.life);
      ctx.lineWidth = 1.5;
      for (const e of s.echoes) {
        ctx.strokeStyle = e.color === 'ink' ? P.ink : e.color;
        for (const t of e.targets) {
          const lt = now - e.t0 - t.d * 70;
          if (lt < 0 || lt > 1100) continue;
          const [x, y] = this.toScreen(UG.cellToWorld(e.i + t.di) + UG.CELL / 2, UG.cellToWorld(e.j + t.dj) + UG.CELL / 2);
          if (x < -cs || y < -cs || x > this.w + cs || y > this.h + cs) continue;
          const q = lt / 1100;
          ctx.globalAlpha = Math.max(0, 1 - q) * Math.max(0.35, Math.pow(e.per / 100, t.d));
          ctx.beginPath();
          ctx.arc(x, y, cs * (0.18 + 0.36 * q), 0, TAU);
          if (!t.d) { ctx.moveTo(x - cs * 0.5, y); ctx.lineTo(x + cs * 0.5, y); ctx.moveTo(x, y - cs * 0.5); ctx.lineTo(x, y + cs * 0.5); }
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      return s.echoes.length > 0;
    }

    drawReticle(wx, wy, name, color, dashed) {
      const { ctx } = this;
      const [x, y] = this.toScreen(wx, wy);
      if (x < -220 || y < -60 || x > this.w + 40 || y > this.h + 40) return;
      ctx.save();
      ctx.translate(Math.round(x), Math.round(y));
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      if (dashed) ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(-15, 0.5); ctx.lineTo(-4, 0.5); ctx.moveTo(4, 0.5); ctx.lineTo(15, 0.5);
      ctx.moveTo(0.5, -15); ctx.lineTo(0.5, -4); ctx.moveTo(0.5, 4); ctx.lineTo(0.5, 15);
      ctx.stroke();
      ctx.font = '500 10px "JetBrains Mono", ui-monospace, monospace';
      const tw = ctx.measureText(name).width;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(14.5, 12.5, tw + 12, 18, 9); else ctx.rect(14.5, 12.5, tw + 12, 18);
      if (dashed) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.fill();
        ctx.setLineDash([2, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = color;
      } else {
        ctx.fillStyle = color;
        ctx.fill();
        ctx.fillStyle = '#fff';
      }
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(name, 20.5, 22);
      ctx.restore();
    }

    // A person here right now: a plain pointer, eased toward their last position.
    drawPeer(p, P) {
      const { ctx } = this;
      p.x += (p.tx - p.x) * 0.35;
      p.y += (p.ty - p.y) * 0.35;
      const moving = Math.abs(p.tx - p.x) + Math.abs(p.ty - p.y) > 0.5;
      const [x, y] = this.toScreen(p.x, p.y);
      if (x < -220 || y < -60 || x > this.w + 40 || y > this.h + 40) return moving;
      ctx.save();
      ctx.translate(Math.round(x), Math.round(y));
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(0, 15); ctx.lineTo(4, 11.5); ctx.lineTo(7, 18);
      ctx.lineTo(9.5, 17); ctx.lineTo(6.5, 10.5); ctx.lineTo(11.5, 10.5); ctx.closePath();
      ctx.fillStyle = P.ink;
      ctx.strokeStyle = P.paper;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fill();
      ctx.font = '500 10px "JetBrains Mono", ui-monospace, monospace';
      const tw = ctx.measureText(p.name).width;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(12, 18, tw + 12, 18, [2, 9, 9, 9]); else ctx.rect(12, 18, tw + 12, 18);
      ctx.fill();
      ctx.fillStyle = P.paper;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.name, 18, 27.5);
      ctx.restore();
      return moving;
    }
  }
  UG.Renderer = Renderer;
})();
