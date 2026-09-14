/* ─────────────────────────────────────────────
   Untitled Grid — visitors
   Earlier sessions return as ghost cursors that replay their moves.
   People here right now appear as live cursors.
   Both only echo over the grid: they never write the viewer's world,
   so every history stays private and deterministic.

   Where ghosts come from:
   · data/ghosts.json — an archive of recorded sessions shipped with the site
   · Claude           — inside a claude.ai artifact (shared db + live room)
   · local            — this browser's own earlier sessions
   ───────────────────────────────────────────── */
(function () {
  const UG = window.UG;
  const app = UG.app;
  if (!app) return;
  const { state } = app;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(+v) ? +v : lo));

  const MAX_MOVES = 160;       // recorded per session
  const WINDOW = 24;           // replayed per appearance
  const MAX_ECHOES = 40;
  const PEER_TIMEOUT = 20000;  // an idle live cursor fades out

  const sid = (() => {
    const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let k = 0; k < 10; k++) s += a[Math.floor(Math.random() * a.length)];
    return s;
  })();
  const started = Date.now();

  /* ───── Backends ─────
     Each one: { own, load() → raw sessions, save(body), cursor(x, y), echo(move) }.
     Incoming live data goes through peerCursor / peerEcho / peerLeave. */

  const local = {
    own: true,
    async load() {
      try { return JSON.parse(localStorage.getItem('ug-ghosts') || '[]'); } catch (_) { return []; }
    },
    async save(body) {
      try {
        const all = JSON.parse(localStorage.getItem('ug-ghosts') || '[]').filter((g) => g && g.sid !== body.sid);
        all.unshift(body);
        localStorage.setItem('ug-ghosts', JSON.stringify(all.slice(0, 16)));
      } catch (_) {}
    },
    cursor() {},
    echo() {}
  };

  function claudeBackend(db, room) {
    let echoN = 0;
    if (room) {
      const seen = new Map();
      room.onPeers(({ peers }) => {
        const here = new Set();
        for (const p of peers) {
          if (p.isMe || p.kind !== 'viewer') continue;
          here.add(p.peer);
          const pr = p.presence || {};
          if (Number.isFinite(pr.x) && Number.isFinite(pr.y)) peerCursor(p.peer, pr.x, pr.y);
          const e = pr.echo;
          if (e && typeof e === 'object' && Number.isFinite(e.n) && seen.get(p.peer) !== e.n) {
            const first = !seen.has(p.peer);
            seen.set(p.peer, e.n);
            if (!first) peerEcho(e);
          }
        }
        for (const id of [...state.peers.keys()]) if (!here.has(id)) { peerLeave(id); seen.delete(id); }
      }, () => { for (const id of [...state.peers.keys()]) peerLeave(id); });
    }
    return {
      own: !db,
      async load() {
        if (!db) return local.load();
        const snap = await db.collection('ghosts').orderBy('u', 'desc').limit(30).get();
        return snap.docs.map((d) => d.data());
      },
      async save(body) {
        if (!db) return local.save(body);
        await db.collection('ghosts').doc(body.sid).set(body);
      },
      cursor(x, y) {
        if (room) room.presence({ x, y }).catch(() => {});
      },
      echo(m) {
        if (!room) return;
        echoN++;
        room.presence({ echo: { n: echoN, t: m.t, i: m.i, j: m.j, sp: m.sp, rad: m.rad, per: m.per } }).catch(() => {});
      }
    };
  }

  async function loadArchive() {
    try {
      const res = await fetch('data/ghosts.json', { cache: 'no-cache' });
      if (!res.ok) return [];
      const list = await res.json();
      return Array.isArray(list) ? list.slice(0, 200) : [];
    } catch (_) {
      return [];
    }
  }

  let backend = local;

  /* ───── Recording this session ───── */
  const rec = { moves: [], gaps: [], last: started };
  let saveTimer = null;

  UG.hooks.commit.push((m) => {
    if (m.t === 'W') return;
    const now = Date.now();
    rec.moves.push(m);
    rec.gaps.push(Math.min(99, Math.round((now - rec.last) / 100)));
    rec.last = now;
    if (rec.moves.length > MAX_MOVES) { rec.moves.shift(); rec.gaps.shift(); }
    if (rec.moves.length >= 3) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(persist, 4000);
    }
    backend.echo(m);
  });

  UG.hooks.pointer.push((wx, wy) => backend.cursor(Math.round(wx), Math.round(wy)));

  function persist() {
    if (rec.moves.length < 3) return;
    const body = { sid, t: started, u: Date.now(), n: rec.moves.length, m: UG.encodeMoves(rec.moves), d: rec.gaps.slice() };
    Promise.resolve().then(() => backend.save(body)).catch(() => local.save(body));
  }
  addEventListener('pagehide', persist);

  /* ───── Reading other sessions (untrusted) ───── */
  function sanitize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.sid !== 'string' || raw.sid === sid) return null;
    if (typeof raw.m !== 'string' || raw.m.length > 16000) return null;
    const moves = UG.decodeMoves(raw.m).filter((m) => m.t !== 'W').slice(0, MAX_MOVES);
    if (moves.length < 3) return null;
    const gaps = Array.isArray(raw.d) ? raw.d.slice(0, moves.length).map((g) => clamp(g, 0, 99)) : [];
    const t = Number.isFinite(raw.u) ? raw.u : Number.isFinite(raw.t) ? raw.t : Date.now();
    return { sid: raw.sid.replace(/[^A-Za-z0-9]/g, '').slice(0, 10).toUpperCase(), moves, gaps, t: Math.min(t, Date.now()) };
  }

  function ago(t) {
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 90) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    if (s < 86400 * 30) return Math.round(s / 86400) + ' d ago';
    return new Date(t).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function makeEcho(i, j, m, color, now) {
    const targets = UG.spreadTargets(m.sp, m.rad, UG.rng(UG.hash(i, j, m.t, m.rad)));
    let maxD = 0;
    for (const t of targets) maxD = Math.max(maxD, t.d);
    if (state.echoes.length >= MAX_ECHOES) state.echoes.shift();
    return { i, j, per: m.sp === 'w' ? 100 : m.per, color, t0: now, targets, life: 1150 + maxD * 70 };
  }

  /* ───── Live viewers ───── */
  const peerSeen = new Map();
  const peerId = (id) => String(id == null ? '' : id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24);

  function peerCursor(rawId, x, y) {
    const id = peerId(rawId);
    if (!id || !Number.isFinite(+x) || !Number.isFinite(+y)) return;
    const tx = clamp(x, -1e8, 1e8), ty = clamp(y, -1e8, 1e8);
    let v = state.peers.get(id);
    const isNew = !v;
    if (isNew) {
      v = { x: tx, y: ty, tx, ty, name: 'live · ' + id.slice(0, 4).toUpperCase() };
      state.peers.set(id, v);
    }
    v.tx = tx;
    v.ty = ty;
    peerSeen.set(id, Date.now());
    app.markDirty();
    if (isNew) renderAvatars();
  }

  function peerEcho(e) {
    if (!e || !UG.CODE_TO_RULE[e.t] || !UG.SPREADS[e.sp] || !Number.isFinite(+e.i) || !Number.isFinite(+e.j)) return;
    const m = { t: e.t, sp: e.sp, rad: clamp(e.rad, 0, 8), per: clamp(e.per, 0, 100) };
    state.echoes.push(makeEcho(clamp(Math.round(+e.i), -1e7, 1e7), clamp(Math.round(+e.j), -1e7, 1e7), m, 'ink', performance.now()));
    app.markDirty();
  }

  function peerLeave(rawId) {
    const id = peerId(rawId);
    peerSeen.delete(id);
    if (state.peers.delete(id)) { app.markDirty(); renderAvatars(); }
  }

  setInterval(() => {
    const now = Date.now();
    for (const [id, t] of peerSeen) if (now - t > PEER_TIMEOUT) peerLeave(id);
  }, 5000);

  /* ───── Ghost scheduler ───── */
  let pool = [];
  let next = 0;
  let enabled = true;
  const active = [];
  const maxActive = () => (innerWidth < 820 ? 1 : 2);
  const cellNear = (w) => Math.floor(w / (UG.BLOCK / UG.FRAME));
  const centre = (m, g) => [UG.cellToWorld(m.i + g.di) + UG.CELL / 2, UG.cellToWorld(m.j + g.dj) + UG.CELL / 2];

  function spawn() {
    if (!enabled || !pool.length || active.length >= maxActive()) return;
    const src = pool[next++ % pool.length];
    if (active.some((g) => g.src === src)) return;

    const start = src.moves.length > WINDOW ? Math.floor(Math.random() * (src.moves.length - WINDOW)) : 0;
    const moves = src.moves.slice(start, start + WINDOW);
    const gaps = src.gaps.slice(start, start + WINDOW);
    // Replay near where the viewer is looking, keeping the session's own shape.
    const di = cellNear(state.cam.x) + Math.round((Math.random() - 0.5) * 8) - moves[0].i;
    const dj = cellNear(state.cam.y) + Math.round((Math.random() - 0.5) * 6) - moves[0].j;
    const g = { src, moves, gaps, di, dj, k: 0, name: src.label, timer: null, x0: 0, y0: 0, x1: 0, y1: 0, t0: 0, dur: 1 };
    const [wx, wy] = centre(moves[0], g);
    Object.assign(g, { x0: wx - 140, y0: wy - 90, x1: wx, y1: wy, t0: performance.now(), dur: 700 });

    active.push(g);
    state.ghosts.push(g);
    app.markDirty();
    renderAvatars();
    g.timer = setTimeout(() => step(g), 800);
  }

  function step(g) {
    if (!enabled) return;
    const now = performance.now();
    const m = g.moves[g.k];
    state.echoes.push(makeEcho(m.i + g.di, m.j + g.dj, m, UG.GHOST, now));
    g.name = `${g.src.label} · ${UG.RULES[UG.CODE_TO_RULE[m.t]].name.toLowerCase()}`;
    app.markDirty();

    g.k++;
    if (g.k >= g.moves.length) { g.timer = setTimeout(() => retire(g), 1400); return; }

    const gap = Math.max(700, Math.min(3200, (g.gaps[g.k] || 12) * 100));
    const [nx, ny] = centre(g.moves[g.k], g);
    const p = Math.min(1, Math.max(0, (now - g.t0) / g.dur));
    const e = 1 - Math.pow(1 - p, 3);
    Object.assign(g, {
      x0: g.x0 + (g.x1 - g.x0) * e, y0: g.y0 + (g.y1 - g.y0) * e,
      x1: nx, y1: ny, t0: now + gap * 0.25, dur: gap * 0.55
    });
    g.timer = setTimeout(() => step(g), gap);
  }

  function retire(g) {
    clearTimeout(g.timer);
    const a = active.indexOf(g);
    if (a < 0) return;
    active.splice(a, 1);
    const at = state.ghosts.indexOf(g);
    if (at >= 0) state.ghosts.splice(at, 1);
    app.markDirty();
    renderAvatars();
    setTimeout(spawn, 2500 + Math.random() * 4000);
  }

  function setEnabled(on) {
    enabled = on;
    if (!on) for (const g of active.slice()) retire(g);
    else { spawn(); setTimeout(spawn, 3000); }
    renderAvatars();
  }
  $('chkGhosts').addEventListener('change', (ev) => setEnabled(ev.target.checked));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) spawn(); });

  /* ───── Avatars in the top bar ───── */
  function renderAvatars() {
    const frag = document.createDocumentFragment();
    const add = (cls, text, title) => {
      const el = document.createElement('span');
      el.className = cls;
      el.textContent = text;
      el.title = title;
      frag.appendChild(el);
    };
    for (const [id, v] of state.peers) add('av live', id.slice(0, 2).toUpperCase(), v.name);
    for (const g of active) add('av ghost', g.src.sid.slice(0, 2), g.src.label);
    const waiting = enabled ? pool.length - active.length : 0;
    if (waiting > 0) add('av-count', '+' + waiting, `${waiting} more recorded ${waiting === 1 ? 'session' : 'sessions'}`);
    $('presence').replaceChildren(frag);
  }

  /* ───── Boot ───── */
  async function boot() {
    if (window.claude && typeof window.claude.use === 'function') {
      const [db, room] = await Promise.all([
        window.claude.use('db').catch(() => null),
        window.claude.use('room').catch(() => null)
      ]);
      if (db || room) backend = claudeBackend(db, room);
    }

    let raw = [];
    let own = backend.own;
    try {
      raw = await backend.load();
    } catch (_) {
      raw = await local.load();
      own = true;
      const live = backend;
      backend = { ...local, cursor: live.cursor, echo: live.echo };
    }
    const archive = await loadArchive();

    const label = (p, mine) => `${mine ? 'earlier you' : 'visitor ' + p.sid.slice(0, 4)} · ${ago(p.t)}`;
    const recent = raw.map(sanitize).filter(Boolean).sort((a, b) => b.t - a.t).slice(0, 20);
    const seen = new Set(recent.map((p) => p.sid));
    for (const p of recent) p.label = label(p, own);
    const archived = archive.map(sanitize).filter((p) => p && !seen.has(p.sid));
    for (const p of archived) p.label = label(p, false);
    // Shuffle the archive so each visit meets different ghosts.
    for (let k = archived.length - 1; k > 0; k--) {
      const r = Math.floor(Math.random() * (k + 1));
      [archived[k], archived[r]] = [archived[r], archived[k]];
    }

    pool = recent.concat(archived.slice(0, 30));
    renderAvatars();
    setTimeout(spawn, 2500);
    setTimeout(spawn, 9000);
  }
  setTimeout(boot, 1200);
})();
