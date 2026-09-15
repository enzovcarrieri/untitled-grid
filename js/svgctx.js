/* ─────────────────────────────────────────────
   Untitled Grid — SVG context
   The slice of CanvasRenderingContext2D the renderer uses, recorded as
   vector markup. Arcs become cubic Béziers, which stay exact under any
   affine transform, so stretched and rotated glyphs remain true curves.
   ───────────────────────────────────────────── */
(function () {
  const UG = window.UG;
  const TAU = Math.PI * 2;
  const num = (v) => +v.toFixed(2);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // rgba() is not portable to print tools: split it into colour + opacity.
  function colour(c) {
    const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(String(c));
    if (!m) return [String(c), 1];
    return [`rgb(${m[1]},${m[2]},${m[3]})`, m[4] === undefined ? 1 : +m[4]];
  }

  class SVGContext {
    constructor(width, height, opts = {}) {
      this.width = width;
      this.height = height;
      this.unitMM = opts.unitMM || 0.1;
      this.hatchSize = opts.hatchSize || 6;
      this.isSVG = true;
      this.body = [];
      this.defs = [];
      this.patterns = new Map();
      this.stack = [];
      this.m = [1, 0, 0, 1, 0, 0];
      this.d = '';
      this.last = null;
      this.first = null;
      this.fillStyle = '#000';
      this.strokeStyle = '#000';
      this.lineWidth = 1;
      this.globalAlpha = 1;
      this.dash = [];
      this.font = '10px sans-serif';
      this.textAlign = 'start';
      this.textBaseline = 'alphabetic';
    }

    /* State */
    save() {
      const { m, fillStyle, strokeStyle, lineWidth, globalAlpha, dash, font, textAlign, textBaseline } = this;
      this.stack.push({ m: m.slice(), fillStyle, strokeStyle, lineWidth, globalAlpha, dash: dash.slice(), font, textAlign, textBaseline });
    }
    restore() {
      const s = this.stack.pop();
      if (s) Object.assign(this, s);
    }
    transform(a, b, c, d, e, f) {
      const m = this.m;
      this.m = [
        m[0] * a + m[2] * b, m[1] * a + m[3] * b,
        m[0] * c + m[2] * d, m[1] * c + m[3] * d,
        m[0] * e + m[2] * f + m[4], m[1] * e + m[3] * f + m[5]
      ];
    }
    setTransform(a, b, c, d, e, f) { this.m = [a, b, c, d, e, f]; }
    translate(x, y) { this.transform(1, 0, 0, 1, x, y); }
    scale(x, y) { this.transform(x, 0, 0, y, 0, 0); }
    rotate(r) { const c = Math.cos(r), s = Math.sin(r); this.transform(c, s, -s, c, 0, 0); }
    setLineDash(d) { this.dash = d.slice(); }

    /* Paths — points are transformed when added, exactly like canvas */
    pt(x, y) {
      const m = this.m;
      return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    }
    beginPath() { this.d = ''; this.last = null; this.first = null; }
    moveTo(x, y) {
      const p = this.pt(x, y);
      this.d += `M${num(p[0])} ${num(p[1])}`;
      this.last = this.first = p;
    }
    lineTo(x, y) {
      if (!this.last) { this.moveTo(x, y); return; }
      const p = this.pt(x, y);
      this.d += `L${num(p[0])} ${num(p[1])}`;
      this.last = p;
    }
    closePath() {
      if (!this.last) return;
      this.d += 'Z';
      this.last = this.first;
    }
    rect(x, y, w, h) {
      this.moveTo(x, y);
      this.lineTo(x + w, y);
      this.lineTo(x + w, y + h);
      this.lineTo(x, y + h);
      this.closePath();
    }
    arc(cx, cy, r, a0, a1, ccw) {
      const span = ccw ? a0 - a1 : a1 - a0;
      let sweep = span >= TAU ? TAU : ((span % TAU) + TAU) % TAU;
      if (ccw) sweep = -sweep;

      const start = this.pt(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
      if (!this.last) {
        this.d += `M${num(start[0])} ${num(start[1])}`;
        this.first = start;
      } else if (Math.hypot(start[0] - this.last[0], start[1] - this.last[1]) > 0.01) {
        this.d += `L${num(start[0])} ${num(start[1])}`;
      }

      const segs = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
      const step = sweep / segs;
      const k = (4 / 3) * Math.tan(step / 4);
      let a = a0, end = start;
      for (let s = 0; s < segs; s++) {
        const b = a + step;
        const c1 = this.pt(cx + r * (Math.cos(a) - k * Math.sin(a)), cy + r * (Math.sin(a) + k * Math.cos(a)));
        const c2 = this.pt(cx + r * (Math.cos(b) + k * Math.sin(b)), cy + r * (Math.sin(b) - k * Math.cos(b)));
        end = this.pt(cx + r * Math.cos(b), cy + r * Math.sin(b));
        this.d += `C${num(c1[0])} ${num(c1[1])} ${num(c2[0])} ${num(c2[1])} ${num(end[0])} ${num(end[1])}`;
        a = b;
      }
      this.last = end;
    }

    /* Paint */
    hatch(color) {
      let id = this.patterns.get(color);
      if (!id) {
        id = 'hatch' + this.patterns.size;
        this.patterns.set(color, id);
        const [c, o] = colour(color);
        const s = this.hatchSize, t = s / 6;
        this.defs.push(
          `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${s}" height="${s}">` +
          `<path d="M${-t} ${7 * t}L${7 * t} ${-t}M${-t} ${t}L${t} ${-t}M${5 * t} ${7 * t}L${7 * t} ${5 * t}" ` +
          `fill="none" stroke="${c}" stroke-opacity="${o}" stroke-width="${num(1.1 * t)}"/></pattern>`
        );
      }
      return { svgPattern: id };
    }
    paint(kind, style) {
      if (style && style.svgPattern) return `${kind}="url(#${style.svgPattern})"`;
      const [c, o] = colour(style);
      const a = o * this.globalAlpha;
      return `${kind}="${esc(c)}"` + (a < 1 ? ` ${kind}-opacity="${num(a)}"` : '');
    }
    widthScale() {
      const m = this.m;
      return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
    }
    fill(rule) {
      if (!this.d) return;
      this.body.push(`<path d="${this.d}" ${this.paint('fill', this.fillStyle)}${rule === 'evenodd' ? ' fill-rule="evenodd"' : ''}/>`);
    }
    stroke() {
      if (!this.d) return;
      const ws = this.widthScale();
      const dash = this.dash.length ? ` stroke-dasharray="${this.dash.map((v) => num(v * ws)).join(' ')}"` : '';
      this.body.push(`<path d="${this.d}" fill="none" ${this.paint('stroke', this.strokeStyle)} stroke-width="${num(this.lineWidth * ws)}"${dash}/>`);
    }
    withPath(build, paint) {
      const { d, last, first } = this;
      this.beginPath();
      build();
      paint();
      Object.assign(this, { d, last, first });
    }
    fillRect(x, y, w, h) { this.withPath(() => this.rect(x, y, w, h), () => this.fill()); }
    strokeRect(x, y, w, h) { this.withPath(() => this.rect(x, y, w, h), () => this.stroke()); }
    clearRect() {}

    /* Text */
    fontParts() {
      const m = /^\s*(?:(normal|bold|\d{3})\s+)?([\d.]+)px\s+(.+)$/.exec(this.font) || [];
      return { weight: m[1] || '400', size: +(m[2] || 10), family: (m[3] || 'sans-serif').replace(/"/g, "'") };
    }
    measureText(t) {
      return { width: String(t).length * this.fontParts().size * 0.6 };
    }
    text(t, x, y, kind) {
      const f = this.fontParts();
      const anchor = { center: 'middle', right: 'end', end: 'end' }[this.textAlign] || 'start';
      const base = { middle: 'central', top: 'hanging', hanging: 'hanging', bottom: 'text-after-edge' }[this.textBaseline];
      const paint = kind === 'fill'
        ? this.paint('fill', this.fillStyle)
        : `fill="none" ${this.paint('stroke', this.strokeStyle)} stroke-width="${num(this.lineWidth)}"`;
      this.body.push(
        `<text transform="matrix(${this.m.map(num).join(' ')})" x="${num(x)}" y="${num(y)}" ` +
        `font-family="${esc(f.family)}" font-size="${num(f.size)}" font-weight="${f.weight}" ` +
        `text-anchor="${anchor}"${base ? ` dominant-baseline="${base}"` : ''} ${paint}>${esc(t)}</text>`
      );
    }
    fillText(t, x, y) { this.text(t, x, y, 'fill'); }
    strokeText(t, x, y) { this.text(t, x, y, 'stroke'); }

    toString() {
      return (
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        `<svg xmlns="http://www.w3.org/2000/svg" width="${num(this.width * this.unitMM)}mm" height="${num(this.height * this.unitMM)}mm" viewBox="0 0 ${this.width} ${this.height}">\n` +
        `<defs><style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500&amp;family=JetBrains+Mono:wght@400;500&amp;display=swap');</style>${this.defs.join('')}</defs>\n` +
        this.body.join('\n') +
        '\n</svg>\n'
      );
    }
  }

  UG.SVGContext = SVGContext;
})();
