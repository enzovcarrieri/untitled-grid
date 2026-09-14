/* ─────────────────────────────────────────────
   Untitled Grid — core
   Seeded world, modules, rules and propagation.
   Everything here is deterministic: the same seed
   and the same list of moves always yield the same state.
   ───────────────────────────────────────────── */
(function () {
  const UG = (window.UG = window.UG || {});

  UG.CELL = 64;      // module size, world px
  UG.FRAME = 8;      // modules per frame side
  UG.GAP = 64;       // gutter between frames
  UG.MAXDEPTH = 4;   // deepest subdivision
  UG.BLOCK = UG.FRAME * UG.CELL + UG.GAP;

  /* ───── Randomness ───── */
  UG.hash = function () {
    let h = 2166136261 >>> 0;
    for (const a of arguments) {
      const s = String(a);
      for (let k = 0; k < s.length; k++) {
        h ^= s.charCodeAt(k);
        h = Math.imul(h, 16777619);
      }
      h ^= 124;
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };

  UG.rng = function (a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /* ───── Vocabulary ───── */
  UG.GLYPHS = ['void', 'quarter', 'half', 'disc', 'wedge', 'arch', 'bars', 'ring', 'dot', 'steps', 'cross', 'letter'];
  UG.LETTER = 11;
  UG.SPECIMEN_TOTAL = UG.GLYPHS.length * 2 * 3; // glyph × fill × colour

  UG.RULES = {
    select: { code: null, key: 'v', name: 'Select', desc: 'Inspect a module. Nothing changes. Drag anywhere to move around.' },
    split:  { code: 'S', key: 's', name: 'Split',  desc: 'Divides a module in two. Its neighbours divide too.' },
    rotate: { code: 'R', key: 'r', name: 'Rotate', desc: 'Turns a module 90°. The turn travels outward.' },
    mirror: { code: 'M', key: 'm', name: 'Mirror', desc: 'Flips a module across its vertical axis.' },
    invert: { code: 'I', key: 'i', name: 'Invert', desc: 'Swaps figure and ground.' },
    type:   { code: 'T', key: 't', name: 'Type',   desc: 'Turns modules into letters. The string is spelled outward, one ring at a time.' },
    bond:   { code: 'B', key: 'b', name: 'Bond',   desc: 'Turns modules into nodes. Neighbouring nodes fuse into a single body.' },
    mutate: { code: 'X', key: 'x', name: 'Mutate', desc: 'Rewrites a module at random. Entropy decides how much.' },
    merge:  { code: 'G', key: 'g', name: 'Merge',  desc: 'Collapses a subdivision back into a single module.' },
    reset:  { code: 'E', key: 'e', name: 'Reset',  desc: 'Returns modules to their untouched, unwritten state.' }
  };
  UG.CODE_TO_RULE = {};
  for (const k in UG.RULES) if (UG.RULES[k].code) UG.CODE_TO_RULE[UG.RULES[k].code] = k;

  UG.SPREADS = { r: 'Ripple', a: 'Axis', d: 'Diagonal', q: 'Field', w: 'Walk' };

  /* ───── Geometry ───── */
  UG.cellToWorld = (i) => i * UG.CELL + Math.floor(i / UG.FRAME) * UG.GAP;
  UG.worldToCell = (w) => {
    const b = Math.floor(w / UG.BLOCK);
    const l = w - b * UG.BLOCK;
    if (l >= UG.FRAME * UG.CELL) return null; // gutter
    return b * UG.FRAME + Math.floor(l / UG.CELL);
  };
  UG.frameOf = (i) => Math.floor(i / UG.FRAME);

  UG.childRects = (x, y, w, h, d) =>
    d === 'v'
      ? [[x, y, w / 2, h], [x + w / 2, y, w / 2, h]]
      : [[x, y, w, h / 2], [x, y + h / 2, w, h / 2]];

  // Leaf under a world point → its path ("0101") and rect.
  UG.hitPath = function (node, x, y, w, h, px, py) {
    let path = '';
    while (node.k) {
      const idx = node.d === 'v' ? (px < x + w / 2 ? 0 : 1) : (py < y + h / 2 ? 0 : 1);
      [x, y, w, h] = UG.childRects(x, y, w, h, node.d)[idx];
      node = node.k[idx];
      path += idx;
    }
    return { path, node, rect: [x, y, w, h] };
  };

  // Follow a path as far as the tree allows.
  UG.resolvePath = function (node, x, y, w, h, path) {
    let depth = 0;
    for (const ch of path || '') {
      if (!node.k) break;
      const idx = +ch;
      [x, y, w, h] = UG.childRects(x, y, w, h, node.d)[idx];
      node = node.k[idx];
      depth++;
    }
    return { node, rect: [x, y, w, h], depth };
  };

  /* ───── Propagation ───── */
  UG.spreadTargets = function (sp, rad, rng) {
    const out = [{ di: 0, dj: 0, d: 0 }];
    if (rad <= 0) return out;
    if (sp === 'w') {
      const seen = new Set(['0,0']);
      let x = 0, y = 0;
      for (let s = 1; s <= rad * 4; s++) {
        const k = Math.floor(rng() * 4);
        x += k === 0 ? 1 : k === 1 ? -1 : 0;
        y += k === 2 ? 1 : k === 3 ? -1 : 0;
        const key = x + ',' + y;
        if (!seen.has(key)) { seen.add(key); out.push({ di: x, dj: y, d: s }); }
      }
      return out;
    }
    for (let d = 1; d <= rad; d++) {
      for (let di = -d; di <= d; di++) {
        for (let dj = -d; dj <= d; dj++) {
          const ai = Math.abs(di), aj = Math.abs(dj);
          let dist;
          if (sp === 'r') dist = ai + aj;
          else if (sp === 'a') dist = ai === 0 || aj === 0 ? ai + aj : -1;
          else if (sp === 'd') dist = ai === aj ? ai : -1;
          else dist = Math.max(ai, aj);
          if (dist === d) out.push({ di, dj, d });
        }
      }
    }
    return out;
  };

  /* ───── Node operations ───── */
  const leafCopy = (n) => ({ g: n.g || 1, r: n.r, f: n.f, v: n.v, c: n.c, ch: n.ch, k: null, d: 'v' });
  const firstLeaf = (n) => { while (n.k) n = n.k[0]; return n; };

  function mutate(n, rng, e) {
    if (rng() < e) { n.g = 1 + Math.floor(rng() * 10); n.ch = ''; }
    if (rng() < e) n.r = Math.floor(rng() * 4);
    if (rng() < e * 0.25) n.v = !n.v;
    if (rng() < e * 0.3) n.c = n.c ? 0 : rng() < 0.75 ? 1 : 2;
    if (rng() < e * 0.2) n.f = !n.f;
  }
  function mutateDeep(n, rng, e, depth) {
    if (n.k) { n.k.forEach((c) => mutateDeep(c, rng, e, depth + 1)); return; }
    mutate(n, rng, e);
    if (rng() < e * 0.25 && depth < UG.MAXDEPTH - 1) {
      n.d = rng() < 0.5 ? 'v' : 'h';
      const a = leafCopy(n), b = leafCopy(n);
      mutate(b, rng, e);
      n.k = [a, b];
    }
  }
  // Clockwise quarter turn of a whole subtree.
  function rotate(n) {
    n.r = (n.r + 1) % 4;
    if (n.k) {
      if (n.d === 'h') { n.d = 'v'; n.k.reverse(); } else n.d = 'h';
      n.k.forEach(rotate);
    }
  }
  // Horizontal flip of a whole subtree (flip ∘ rotation = rotation⁻¹ ∘ flip).
  function mirror(n) {
    n.f = !n.f;
    n.r = (4 - n.r) % 4;
    if (n.k) { if (n.d === 'v') n.k.reverse(); n.k.forEach(mirror); }
  }
  function invert(n) { n.v = !n.v; if (n.k) n.k.forEach(invert); }
  function collect(n, set) {
    if (n.k) { n.k.forEach((c) => collect(c, set)); return; }
    set.add(n.g + '.' + (n.v ? 1 : 0) + '.' + n.c);
  }

  /* ───── World ───── */
  class World {
    constructor(seed) { this.setSeed(seed); }

    setSeed(seed) {
      this.seed = String(seed);
      this.seedInt = UG.hash('ug', this.seed);
      this.frames = new Map();
      this.reset();
    }

    reset() {
      this.cells = new Map();
      this.specimens = new Set();
      this.word = 'UNTITLED GRID ';
      this.step = 0;
    }

    // Every frame has its own character: density, a family of three glyphs, an orientation bias.
    frameParams(fi, fj) {
      const key = fi + ',' + fj;
      let p = this.frames.get(key);
      if (!p) {
        if (this.frames.size > 4000) this.frames.clear();
        const r = UG.rng(UG.hash(this.seedInt, 'f', fi, fj));
        const fam = [];
        while (fam.length < 3) {
          const g = 1 + Math.floor(r() * 10);
          if (!fam.includes(g)) fam.push(g);
        }
        p = { density: 0.18 + r() * 0.6, fam, bias: Math.floor(r() * 4), order: r() };
        this.frames.set(key, p);
      }
      return p;
    }

    // The unwritten module at (i, j). Never stored.
    ghost(i, j) {
      const p = this.frameParams(UG.frameOf(i), UG.frameOf(j));
      const r = UG.rng(UG.hash(this.seedInt, i, j));
      const on = r() < p.density;
      const g = on ? p.fam[Math.floor(r() * 3)] : 0;
      const rot = r() < p.order ? p.bias : Math.floor(r() * 4);
      return { g, r: rot, f: false, v: false, c: 0, ch: '', k: null, d: 'v' };
    }

    get(i, j) { return this.cells.get(i + ',' + j) || null; }
    node(i, j) { return this.get(i, j) || this.ghost(i, j); }

    // Apply one move. onChange(i, j, distance, previousSnapshot) fires per affected module.
    apply(m, onChange) {
      const s = this.step++;
      if (m.t === 'W') { this.word = m.w || ' '; return; }
      const rng = UG.rng(UG.hash(this.seedInt, 'm', s, m.t, m.i, m.j));
      const keep = m.per / 100;
      const e = m.e / 100;
      for (const t of UG.spreadTargets(m.sp, m.rad, rng)) {
        if (t.d > 0 && m.sp !== 'w' && rng() > Math.pow(keep, t.d)) continue;
        const i = m.i + t.di, j = m.j + t.dj;
        const prev = this.cells.get(i + ',' + j);
        const snapshot = prev ? structuredClone(prev) : null;
        this.rule(m.t, i, j, m.p, t.d, rng, e);
        if (onChange) onChange(i, j, t.d, snapshot);
      }
    }

    rule(t, i, j, path, d, rng, e) {
      const key = i + ',' + j;
      if (t === 'E') { this.cells.delete(key); return; }

      let root = this.cells.get(key);
      if (!root) {
        root = this.ghost(i, j);
        if (root.g === 0 && t !== 'T') root.g = 1 + Math.floor(rng() * 10);
      }

      let node = root, parent = null, depth = 0;
      for (const ch of path || '') {
        if (!node.k) break;
        parent = node; node = node.k[+ch]; depth++;
      }

      switch (t) {
        case 'S': {
          while (node.k) { parent = node; node = node.k[rng() < 0.5 ? 0 : 1]; depth++; }
          if (depth >= UG.MAXDEPTH) { mutate(node, rng, Math.max(e, 0.5)); break; }
          node.d = rng() < e * 0.5 ? (rng() < 0.5 ? 'v' : 'h') : depth % 2 === 0 ? 'v' : 'h';
          const a = leafCopy(node), b = leafCopy(node);
          if (rng() < e) mutate(a, rng, e);
          mutate(b, rng, Math.max(e, 0.45));
          if (rng() < 0.5) b.r = (b.r + 2) % 4;
          node.k = [a, b];
          break;
        }
        case 'R': rotate(node); break;
        case 'M': mirror(node); break;
        case 'I': invert(node); break;
        case 'T': {
          const w = this.word || ' ';
          const ch = w[d % w.length];
          node.k = null;
          if (ch === ' ') { node.g = 0; node.ch = ''; }
          else { node.g = UG.LETTER; node.ch = ch; }
          if (rng() < e * 0.4) node.c = rng() < 0.7 ? 1 : 2;
          break;
        }
        case 'B': {
          root.k = null;
          root.g = rng() < e * 0.3 ? 8 : 3;
          root.r = 0; root.f = false; root.v = false; root.ch = '';
          root.c = rng() < e * 0.25 ? 2 : 0;
          break;
        }
        case 'X': mutateDeep(node, rng, Math.max(e, 0.35), depth); break;
        case 'G': {
          const target = node.k ? node : parent || node;
          if (target.k) {
            const src = firstLeaf(target);
            target.k = null;
            target.g = src.g; target.ch = src.ch; target.c = src.c; target.v = src.v;
            target.r = src.r; target.f = src.f;
          } else mutate(target, rng, 0.8);
          break;
        }
      }

      this.cells.set(key, root);
      collect(root, this.specimens);
    }

    rebuild(moves, k) {
      this.reset();
      for (let n = 0; n < k && n < moves.length; n++) this.apply(moves[n]);
    }
  }
  UG.World = World;

  /* ───── Serialisation (for shareable URLs) ───── */
  const esc = (s) => encodeURIComponent(s).replace(/\./g, '%2E').replace(/~/g, '%7E');

  UG.encodeMoves = (moves) =>
    moves
      .map((m) =>
        m.t === 'W'
          ? 'W' + esc(m.w)
          : [m.t + m.i.toString(36), m.j.toString(36), m.p || '_', m.e.toString(36), m.rad.toString(36), m.per.toString(36), m.sp].join('.')
      )
      .join('~');

  UG.decodeMoves = (str) => {
    const out = [];
    for (const s of (str || '').split('~')) {
      if (!s) continue;
      try {
        if (s[0] === 'W') { out.push({ t: 'W', w: decodeURIComponent(s.slice(1)).slice(0, 40) }); continue; }
        const p = s.split('.');
        const t = p[0][0];
        if (!UG.CODE_TO_RULE[t] || p.length < 7) continue;
        const int = (x, lo, hi) => Math.max(lo, Math.min(hi, parseInt(x, 36) || 0));
        out.push({
          t,
          i: int(p[0].slice(1), -1e7, 1e7),
          j: int(p[1], -1e7, 1e7),
          p: p[2] === '_' ? '' : p[2].replace(/[^01]/g, '').slice(0, UG.MAXDEPTH),
          e: int(p[3], 0, 100),
          rad: int(p[4], 0, 8),
          per: int(p[5], 0, 100),
          sp: UG.SPREADS[p[6]] ? p[6] : 'r'
        });
      } catch (_) { /* skip malformed */ }
    }
    return out;
  };
})();
