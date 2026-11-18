/*
 * 水墨绘画引擎：用 Canvas 2D 程序化地“画”出一幅水墨画。
 * 所有坐标都在 300 × 400 的逻辑画布里，渲染时按实际像素缩放。
 */
window.Ink = (() => {
  const W = 300, H = 400;
  const INK = '#18171b';
  const PAPER = '#f2ead8';
  const RED = '#b8352a';
  const FONT = '"InkBrush", "STKaiti", "KaiTi", "Kaiti SC", serif';

  // ---------- 随机与噪声 ----------
  function mulberry(a) {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(s) {
    let h = 2166136261;
    for (const c of s) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // ---------- 曲线采样 ----------
  function spline(pts, step) {
    const p = [pts[0], ...pts, pts[pts.length - 1]];
    const raw = [];
    for (let i = 1; i < p.length - 2; i++) {
      const [a, b, c, d] = [p[i - 1], p[i], p[i + 1], p[i + 2]];
      const n = Math.max(2, Math.ceil(Math.hypot(c[0] - b[0], c[1] - b[1]) / step));
      for (let k = 0; k < n; k++) {
        const t = k / n, t2 = t * t, t3 = t2 * t;
        const f = (j) => 0.5 * (2 * b[j] + (-a[j] + c[j]) * t + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * t2 + (-a[j] + 3 * b[j] - 3 * c[j] + d[j]) * t3);
        raw.push([f(0), f(1)]);
      }
    }
    raw.push(pts[pts.length - 1]);
    let len = 0;
    const out = raw.map((q, i) => {
      if (i) len += Math.hypot(q[0] - raw[i - 1][0], q[1] - raw[i - 1][1]);
      const A = raw[Math.max(0, i - 1)], B = raw[Math.min(raw.length - 1, i + 1)];
      let dx = B[0] - A[0], dy = B[1] - A[1];
      const m = Math.hypot(dx, dy) || 1;
      return { x: q[0], y: q[1], nx: -dy / m, ny: dx / m, s: len };
    });
    out.forEach((q) => (q.t = len ? q.s / len : 0));
    return { pts: out, len };
  }

  // 笔压曲线
  const PROFILES = {
    taper: (t) => Math.max(0.08, Math.min(1, (t / 0.12) ** 0.6) * Math.min(1, ((1 - t) / 0.4) ** 0.8)),
    head: (t) => Math.max(0.06, (1 - t) ** 0.7 * Math.min(1, (t / 0.05 + 0.4))),
    leaf: (t) => Math.max(0.05, Math.sin(Math.PI * t) ** 0.8),
    flat: (t) => Math.min(1, t / 0.04 + 0.5, (1 - t) / 0.04 + 0.5),
    tail: (t) => Math.max(0.1, t ** 0.7),
    fish: (t) => (t < 0.3 ? 0.45 + 0.55 * Math.sin((t / 0.3) * Math.PI / 2) : 0.1 + 0.9 * Math.cos(((t - 0.3) / 0.7) * Math.PI / 2)),
  };

  // ---------- 画师 ----------
  class Painter {
    constructor(seed) { this.r = mulberry(seed); this.ops = []; this.ins = { side: 'right' }; }
    R(a = 0, b = 1) { return a + (b - a) * this.r(); }
    I(a, b) { return Math.floor(this.R(a, b + 1)); }
    pick(a) { return a[Math.floor(this.r() * a.length)]; }
    op(f) { this.ops.push(f); }
    noise() {
      const v = Array.from({ length: 66 }, () => this.r());
      return (x) => {
        x = Math.abs(x) % 64;
        const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
        return v[i] * (1 - u) + v[i + 1] * u;
      };
    }

    // 毛笔：多根笔毫沿路径行进，自然产生枯笔飞白
    stroke(pts, o = {}) {
      const w = o.w ?? 3, a = o.a ?? 0.75, dry = o.dry ?? 0.2, col = o.c || INK;
      const nb = o.nb ?? Math.max(2, Math.min(14, Math.round(w * 1.4)));
      const prof = typeof o.p === 'function' ? o.p : PROFILES[o.p || 'taper'];
      const bs = Array.from({ length: nb }, (_, i) => ({
        off: (nb === 1 ? 0 : (i / (nb - 1)) * 2 - 1) * 0.9 + this.R(-0.12, 0.12),
        a: this.R(0.55, 1), n: this.noise(), k: this.R(0, 40), r: this.R(0.75, 1.25),
      }));
      this.op((c) => {
        const S = spline(pts, Math.max(0.5, (w / nb) * 0.9));
        c.fillStyle = col;
        // 墨的“湿”底：一个连续的笔形
        if (o.body !== false && w > 1.2) {
          const P = S.pts;
          c.globalAlpha = a * (o.bodyA ?? 0.5) * (1 - Math.min(0.8, dry));
          c.beginPath();
          P.forEach((q, i) => { const ww = w * prof(q.t) * 0.85; i ? c.lineTo(q.x + q.nx * ww, q.y + q.ny * ww) : c.moveTo(q.x + q.nx * ww, q.y + q.ny * ww); });
          for (let i = P.length - 1; i >= 0; i--) { const q = P[i], ww = w * prof(q.t) * 0.85; c.lineTo(q.x - q.nx * ww, q.y - q.ny * ww); }
          c.closePath(); c.fill();
        }
        const ba = o.body !== false && w > 1.2 ? 0.55 : 1;
        for (const q of S.pts) {
          const ww = w * prof(q.t);
          for (const b of bs) {
            if (dry && b.n(b.k + q.s * 0.09) < dry * (0.35 + q.t)) continue;
            c.globalAlpha = a * b.a * ba;
            c.beginPath();
            c.arc(q.x + q.nx * b.off * ww, q.y + q.ny * b.off * ww, Math.max(0.35, (ww / nb) * 1.3 * b.r + 0.2), 0, 6.2832);
            c.fill();
          }
        }
        c.globalAlpha = 1;
      });
    }

    // 平滑的线（细线条、轮廓用）
    line(pts, o = {}) {
      this.op((c) => {
        const S = spline(pts, 1);
        c.save();
        c.globalAlpha = o.a ?? 0.7; c.strokeStyle = o.c || INK;
        c.lineWidth = o.w ?? 1; c.lineCap = 'round'; c.lineJoin = 'round';
        c.beginPath();
        S.pts.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)));
        c.stroke(); c.restore();
      });
    }

    // 晕染
    wash(x, y, rx, ry, a, col = '24,23,27', rot = 0, hard = 0) {
      this.op((c) => {
        c.save(); c.translate(x, y); c.rotate(rot); c.scale(rx, ry);
        const g = c.createRadialGradient(0, 0, 0, 0, 0, 1);
        g.addColorStop(0, `rgba(${col},${a})`);
        g.addColorStop(Math.min(0.95, hard), `rgba(${col},${a * 0.92})`);
        g.addColorStop(1, `rgba(${col},0)`);
        c.fillStyle = g; c.beginPath(); c.arc(0, 0, 1, 0, 6.2832); c.fill(); c.restore();
      });
    }

    // 不规则墨点
    blob(x, y, r, a = 0.8, col = INK, soft = true) {
      const n = 11, rs = Array.from({ length: n }, () => r * this.R(0.78, 1.18)), rot = this.R(0, 6.28);
      this.op((c) => {
        c.save(); c.fillStyle = col;
        if (soft) { c.globalAlpha = a * 0.12; c.beginPath(); c.arc(x, y, r * 1.25, 0, 6.2832); c.fill(); }
        c.globalAlpha = a; c.beginPath();
        for (let i = 0; i <= n; i++) {
          const ang = rot + (i / n) * 6.2832, rr = rs[i % n];
          const px = x + Math.cos(ang) * rr, py = y + Math.sin(ang) * rr;
          i ? c.lineTo(px, py) : c.moveTo(px, py);
        }
        c.fill(); c.restore();
      });
    }

    poly(pts, fill, a = 1) {
      this.op((c) => {
        c.save(); c.globalAlpha = a; c.fillStyle = fill; c.beginPath();
        pts.forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])));
        c.closePath(); c.fill(); c.restore();
      });
    }

    // 云雾：用纸色把画面“留白”
    mist(y, h, a = 0.9) {
      this.op((c) => {
        const g = c.createLinearGradient(0, y - h, 0, y + h);
        g.addColorStop(0, 'rgba(242,234,216,0)');
        g.addColorStop(0.5, `rgba(242,234,216,${a})`);
        g.addColorStop(1, 'rgba(242,234,216,0)');
        c.fillStyle = g; c.fillRect(-10, y - h, W + 20, h * 2);
      });
    }

    sky(y0, y1, a, col = '24,23,27') {
      this.op((c) => {
        const g = c.createLinearGradient(0, y0, 0, y1);
        g.addColorStop(0, `rgba(${col},${a})`);
        g.addColorStop(1, `rgba(${col},0)`);
        c.fillStyle = g; c.fillRect(-10, y0, W + 20, y1 - y0);
      });
    }

    // ---------- 山 ----------
    mountain(cx, by, h, wd, o = {}) {
      const a = o.a ?? 0.55, n = this.noise(), N = 44, pts = [], sk = this.R(-0.35, 0.35), k0 = this.R(0, 30);
      for (let i = 0; i <= N; i++) {
        const u = (i / N) * 2 - 1, uu = u - sk * (1 - u * u);
        const base = Math.max(0, 1 - Math.abs(uu)) ** (o.sharp ?? 1.5);
        const y = by - h * base * (0.8 + 0.35 * n(k0 + i * 0.3)) - h * 0.06 * (n(k0 + 20 + i * 1.3) - 0.5);
        pts.push([cx + u * wd, Math.min(by, y)]);
      }
      const top = Math.min(...pts.map((q) => q[1]));
      const col = o.col || '24,23,27';
      this.op((c) => {
        const g = c.createLinearGradient(0, top, 0, by);
        g.addColorStop(0, `rgba(${col},${a})`);
        g.addColorStop(0.55, `rgba(${col},${a * 0.45})`);
        g.addColorStop(1, `rgba(${col},${a * 0.05})`);
        c.fillStyle = g; c.beginPath();
        pts.forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])));
        c.lineTo(cx + wd, by + 4); c.lineTo(cx - wd, by + 4); c.closePath(); c.fill();
      });
      if (o.line !== false) this.stroke(pts.filter((q) => q[1] < by - 2), { w: o.lw ?? 1.8, a: Math.min(0.9, a * 1.3), dry: 0.45, p: 'flat' });
      // 皴法
      const cun = o.cun ?? Math.round(h / 12);
      for (let j = 0; j < cun; j++) {
        const q = pts[this.I(6, N - 6)];
        if (q[1] > by - 8) continue;
        const dir = q[0] < cx ? -1 : 1, len = this.R(8, 22);
        this.stroke([q, [q[0] + dir * len * 0.25, q[1] + len * 0.5], [q[0] + dir * len * 0.15, q[1] + len]], { w: this.R(1, 2.2), a: a * 0.7, dry: 0.55 });
      }
      // 苔点
      if (o.moss !== false) {
        for (let j = 0; j < (o.mossN ?? 5); j++) {
          const q = pts[this.I(10, N - 10)];
          if (q[1] < by - 10) this.blob(q[0] + this.R(-3, 3), q[1] + this.R(-1, 3), this.R(0.8, 1.8), Math.min(0.95, a * 1.5), INK, false);
        }
      }
      return pts;
    }

    farHills(y, a = 0.16, n = 3) {
      for (let i = 0; i < n; i++) {
        this.mountain(this.R(0, W), y, this.R(40, 90), this.R(70, 130), { a, line: false, cun: 0, moss: false, col: '60,70,80' });
      }
    }

    waterLines(y0, y1, n = 14, a = 0.3) {
      for (let i = 0; i < n; i++) {
        const y = this.R(y0, y1), x = this.R(-20, W), len = this.R(15, 70) * (0.6 + (y - y0) / (y1 - y0 + 1));
        this.stroke([[x, y], [x + len * 0.5, y + this.R(-1, 1)], [x + len, y]], { w: this.R(0.6, 1.3), a, dry: 0.35, p: 'leaf' });
      }
    }

    // ---------- 树 ----------
    branch(x, y, ang, len, w, depth, leaf) {
      const bend = this.R(-0.35, 0.35);
      const x1 = x + Math.cos(ang) * len, y1 = y + Math.sin(ang) * len;
      const mx = (x + x1) / 2 + Math.cos(ang + 1.57) * len * bend * 0.3, my = (y + y1) / 2 + Math.sin(ang + 1.57) * len * bend * 0.3;
      this.stroke([[x, y], [mx, my], [x1, y1]], { w, a: 0.85, dry: 0.35, p: (t) => 1 - t * 0.35 });
      if (depth >= 2 && this.r() < 0.5) leaf && leaf(mx + this.R(-6, 6), my);
      if (depth <= 0) { leaf && leaf(x1, y1); return; }
      const k = this.I(2, 3);
      for (let i = 0; i < k; i++) {
        this.branch(x1, y1, ang + this.R(-0.7, 0.7) * (i ? 1 : 0.5), len * this.R(0.55, 0.75), w * 0.6, depth - 1, leaf);
      }
    }

    tree(x, by, h, o = {}) {
      const leafCol = o.leafCol || INK;
      const k = h / 120, style = o.dots || 'dot';
      const leaf = (lx, ly) => {
        this.wash(lx, ly, 13 * k, 9 * k, 0.1, leafCol === INK ? '24,23,27' : '160,70,40');
        const n = this.I(6, 10);
        for (let i = 0; i < n; i++) {
          const px = lx + this.R(-13, 13) * k, py = ly + this.R(-10, 7) * k;
          if (style === 'stroke') {
            const L = this.R(3, 5.5) * k, ang = this.R(0.6, 1.4);
            this.stroke([[px, py], [px + Math.cos(ang) * L, py + Math.sin(ang) * L]], { w: 1.5 * k, a: this.R(0.4, 0.85), dry: 0, p: 'leaf', c: leafCol, body: false, nb: 3 });
          } else this.blob(px, py, this.R(1, 2.2) * k, this.R(0.35, 0.85), leafCol);
        }
      };
      this.branch(x, by, -Math.PI / 2 + this.R(-0.12, 0.12), h * 0.36, h * 0.042, o.depth ?? 4, leaf);
      this.stroke([[x - h * 0.08, by + 1], [x + h * 0.08, by]], { w: 1.4, a: 0.6, dry: 0.4 });
    }

    pine(x, by, h, dir = 1) {
      const pts = [[x, by], [x + dir * h * 0.08, by - h * 0.3], [x - dir * h * 0.05, by - h * 0.6], [x + dir * h * 0.06, by - h]];
      this.stroke(pts, { w: h * 0.07, a: 0.7, dry: 0.55, p: 'flat' });
      for (let i = 0; i < 5; i++) this.stroke([[x + this.R(-2, 2), by - h * this.R(0.1, 0.8)], [x + this.R(-4, 4), by - h * this.R(0.1, 0.8)]], { w: 1, a: 0.5, dry: 0.4 });
      for (let i = 0; i < 6; i++) {
        const t = 0.35 + i * 0.12, yy = by - h * t, d = i % 2 ? dir : -dir, L = h * this.R(0.18, 0.32) * (1.1 - t * 0.5);
        const ex = x + d * L, ey = yy - this.R(2, 10);
        this.stroke([[x, yy], [x + d * L * 0.5, yy + 3], [ex, ey]], { w: 2, a: 0.75, dry: 0.3, p: 'flat' });
        this.needles(ex, ey, h * 0.09);
        if (this.r() < 0.6) this.needles(x + d * L * 0.5, yy - 2, h * 0.07);
      }
      this.needles(x + dir * h * 0.06, by - h - 3, h * 0.1);
    }

    needles(x, y, r) {
      this.wash(x, y, r * 1.3, r * 0.65, 0.18);
      const n = 12;
      for (let i = 0; i < n; i++) {
        const ang = Math.PI + (i / (n - 1)) * Math.PI + this.R(-0.1, 0.1);
        this.line([[x, y + r * 0.2], [x + Math.cos(ang) * r, y + Math.sin(ang) * r * 0.6]], { w: 0.7, a: 0.75 });
      }
    }

    bambooStalk(x, by, h, lean = 0) {
      const seg = this.R(30, 46);
      let y = by, xx = x;
      while (y > by - h) {
        const y2 = Math.max(by - h, y - seg), x2 = xx + lean * (y - y2);
        this.stroke([[xx, y - 2], [x2, y2 + 2]], { w: 5.5, a: 0.5, dry: 0.12, p: 'flat', nb: 8, bodyA: 0.7 });
        this.stroke([[x2 - 5, y2 + 1.5], [x2, y2 - 0.5], [x2 + 5, y2 + 1]], { w: 1.5, a: 0.95, dry: 0, p: 'leaf' });
        y = y2; xx = x2;
      }
      return [xx, y];
    }

    bambooLeaves(x, y, n, dir = 1, s = 1) {
      const base = this.R(-0.4, 0.6);
      for (let i = 0; i < n; i++) {
        const ang = base + dir * (0.3 + i * 0.45) + this.R(-0.2, 0.2), L = this.R(26, 40) * s;
        const ex = x + Math.cos(ang) * L * dir, ey = y + Math.sin(ang) * L * 0.8 + 6;
        this.stroke([[x, y], [(x + ex) / 2, (y + ey) / 2 - 3], [ex, ey]], { w: this.R(4.5, 6) * s, a: this.R(0.65, 0.9), dry: 0.05, p: 'leaf' });
      }
    }

    // ---------- 动物与器物 ----------
    flyBird(x, y, s, a = 0.85) {
      this.stroke([[x - s, y - s * 0.25], [x - s * 0.45, y - s * 0.4], [x, y]], { w: s * 0.22, a, dry: 0, p: 'tail' });
      this.stroke([[x, y], [x + s * 0.4, y - s * 0.45], [x + s * 1.05, y - s * 0.3]], { w: s * 0.22, a, dry: 0, p: 'head' });
      this.blob(x, y + s * 0.03, s * 0.12, a, INK, false);
    }

    bird(x, y, s, d = -1, col = INK) {
      const X = (u) => x + u * s * d, Y = (v) => y + v * s;
      this.wash(X(0.35), Y(0.08), s * 0.85, s * 0.5, 0.35, '24,23,27', d * 0.3, 0.55);
      this.stroke([[X(-0.25), Y(-0.38)], [X(0.45), Y(-0.25)], [X(1.15), Y(0.15)]], { w: s * 0.38, a: 0.85, p: 'head', dry: 0.25, c: col });
      this.blob(X(-0.45), Y(-0.38), s * 0.3, 0.9, col);
      this.stroke([[X(-0.68), Y(-0.4)], [X(-0.98), Y(-0.33)]], { w: s * 0.1, a: 0.95, p: 'head', dry: 0 });
      this.blob(X(-0.52), Y(-0.45), s * 0.075, 1, PAPER, false);
      this.blob(X(-0.52), Y(-0.45), s * 0.035, 1, INK, false);
      this.stroke([[X(1.05), Y(0.15)], [X(1.8), Y(0.38)]], { w: s * 0.16, a: 0.85, dry: 0.2, p: 'head' });
      this.stroke([[X(1.05), Y(0.2)], [X(1.75), Y(0.55)]], { w: s * 0.14, a: 0.85, dry: 0.2, p: 'head' });
      this.stroke([[X(-0.3), Y(-0.12)], [X(0.0), Y(0.38)], [X(0.6), Y(0.42)]], { w: s * 0.07, a: 0.45, dry: 0.2 });
      this.line([[X(0.15), Y(0.42)], [X(0.12), Y(0.85)]], { w: 0.9, a: 0.8 });
      this.line([[X(0.32), Y(0.42)], [X(0.36), Y(0.85)]], { w: 0.9, a: 0.8 });
    }

    fish(x, y, s, ang, col = INK, a = 0.75) {
      const T = (u, v) => [x + (u * Math.cos(ang) - v * Math.sin(ang)) * s, y + (u * Math.sin(ang) + v * Math.cos(ang)) * s];
      const bend = this.R(-0.15, 0.15);
      this.stroke([T(0, 0), T(0.6, bend * 0.5), T(1.25, bend)], { w: s * 0.4, a, dry: 0.04, p: 'fish', c: col, nb: 12, bodyA: 0.75 });
      this.stroke([T(1.2, bend), T(1.55, bend - 0.22)], { w: s * 0.2, a: a * 0.9, dry: 0.3, p: 'head', c: col });
      this.stroke([T(1.2, bend), T(1.55, bend + 0.22)], { w: s * 0.2, a: a * 0.9, dry: 0.3, p: 'head', c: col });
      this.stroke([T(0.35, -0.18), T(0.7, -0.28 + bend * 0.3)], { w: s * 0.1, a: a * 0.8, dry: 0.3, p: 'head', c: col });
      this.blob(...T(0.1, -0.05), s * 0.045, 0.95, INK, false);
    }

    hut(x, by, s) {
      this.poly([[x - s, by], [x - s, by - s * 0.8], [x + s, by - s * 0.8], [x + s, by]], PAPER, 1);
      this.stroke([[x - s, by], [x - s, by - s * 0.8]], { w: 1.4, a: 0.8, p: 'flat' });
      this.stroke([[x + s, by], [x + s, by - s * 0.8]], { w: 1.4, a: 0.8, p: 'flat' });
      this.poly([[x - s * 1.45, by - s * 0.72], [x - s * 0.7, by - s * 1.45], [x + s * 0.8, by - s * 1.45], [x + s * 1.45, by - s * 0.72]], INK, 0.55);
      this.stroke([[x - s * 1.5, by - s * 0.7], [x - s * 0.7, by - s * 1.48], [x + s * 0.8, by - s * 1.48], [x + s * 1.5, by - s * 0.7]], { w: 1.8, a: 0.85, dry: 0.4, p: 'flat' });
      this.poly([[x - s * 0.25, by], [x - s * 0.25, by - s * 0.55], [x + s * 0.25, by - s * 0.55], [x + s * 0.25, by]], INK, 0.7);
      this.stroke([[x - s * 1.3, by + 1], [x + s * 1.3, by]], { w: 1.5, a: 0.6, dry: 0.4 });
    }

    boat(x, y, s, man = true) {
      this.stroke([[x - s, y - s * 0.22], [x - s * 0.4, y + s * 0.1], [x + s * 0.5, y + s * 0.1], [x + s, y - s * 0.25]], { w: s * 0.14, a: 0.85, p: 'flat', dry: 0.15 });
      this.wash(x, y + s * 0.18, s * 1.1, s * 0.08, 0.2);
      if (man) {
        this.blob(x - s * 0.05, y - s * 0.15, s * 0.16, 0.75);
        this.poly([[x - s * 0.3, y - s * 0.3], [x - s * 0.05, y - s * 0.52], [x + s * 0.2, y - s * 0.3]], INK, 0.85);
        this.line([[x + s * 0.05, y - s * 0.2], [x + s * 0.9, y - s * 0.9], [x + s * 1.7, y - s * 1.1]], { w: 0.8, a: 0.8 });
        this.line([[x + s * 1.7, y - s * 1.1], [x + s * 1.72, y + s * 0.2]], { w: 0.3, a: 0.6 });
      }
    }

    cloud(x, y, s) {
      const cs = [[0, 0, 1], [-0.9, 0.25, 0.7], [0.9, 0.2, 0.75], [-0.4, -0.45, 0.65], [0.45, -0.4, 0.6]].map(([u, v, r]) => [x + u * s, y + v * s, r * s * 0.75]);
      this.op((c) => { c.fillStyle = PAPER; cs.forEach(([cx, cy, r]) => { c.beginPath(); c.arc(cx, cy, r, 0, 6.2832); c.fill(); }); });
      cs.forEach(([cx, cy, r]) => {
        const pts = [];
        for (let k = 0; k <= 10; k++) { const a = Math.PI * (1.05 + k * 0.09); pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
        this.stroke(pts, { w: 1.6, a: 0.55, dry: 0.3 });
      });
      const sp = [];
      for (let k = 0; k < 14; k++) { const a = k * 0.5, r = s * 0.42 * (1 - k / 16); sp.push([x + s * 1.15 + Math.cos(a) * r, y + s * 0.3 + Math.sin(a) * r]); }
      this.stroke(sp, { w: 1.4, a: 0.5, dry: 0.2 });
    }

    blossom(x, y, r, col = '205,70,80') {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * 6.2832 + this.R(-0.2, 0.2);
        this.wash(x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7, r * 0.62, r * 0.62, 0.75, col, 0, 0.6);
      }
      for (let i = 0; i < 5; i++) {
        const a = this.R(0, 6.28);
        this.line([[x, y], [x + Math.cos(a) * r * 0.75, y + Math.sin(a) * r * 0.75]], { w: 0.4, a: 0.8 });
      }
      this.blob(x, y, r * 0.18, 0.9, '#c9a43b', false);
    }

    butterfly(x, y, s, col = '200,110,50') {
      [[-1, -1], [1, -1]].forEach(([d]) => {
        this.wash(x + d * s * 0.55, y - s * 0.35, s * 0.6, s * 0.42, 0.75, col, d * 0.5, 0.65);
        this.wash(x + d * s * 0.42, y + s * 0.3, s * 0.38, s * 0.3, 0.7, col, -d * 0.4, 0.6);
        this.blob(x + d * s * 0.7, y - s * 0.45, s * 0.1, 0.8);
      });
      this.stroke([[x, y - s * 0.4], [x, y + s * 0.5]], { w: s * 0.16, a: 0.9, p: 'head', dry: 0 });
      this.line([[x, y - s * 0.4], [x - s * 0.2, y - s * 0.85], [x - s * 0.35, y - s * 1]], { w: 0.6, a: 0.8 });
      this.line([[x, y - s * 0.4], [x + s * 0.2, y - s * 0.85], [x + s * 0.35, y - s * 1]], { w: 0.6, a: 0.8 });
    }

    dragonfly(x, y, s) {
      this.stroke([[x, y], [x + s * 1.6, y + s * 0.15]], { w: s * 0.12, a: 0.85, p: 'head', dry: 0 });
      [-1, 1].forEach((d) => {
        this.wash(x + s * 0.25, y + d * s * 0.45, s * 0.5, s * 0.14, 0.18, '24,23,27', d * 0.25, 0.7);
        this.wash(x + s * 0.4, y + d * s * 0.4, s * 0.45, s * 0.12, 0.15, '24,23,27', d * 0.6, 0.7);
      });
      this.blob(x - s * 0.05, y, s * 0.1, 0.9);
    }

    grassClump(x, by, n = 8, h = 30, col = INK) {
      for (let i = 0; i < n; i++) {
        const lean = this.R(-0.7, 0.7), L = h * this.R(0.5, 1.1);
        this.stroke([[x + this.R(-4, 4), by], [x + lean * L * 0.3, by - L * 0.55], [x + lean * L * 0.8, by - L]], { w: this.R(1.4, 2.4), a: this.R(0.5, 0.85), dry: 0.15, p: 'head', c: col });
      }
    }

    ground(y, a = 0.35) {
      this.stroke([[-5, y + this.R(-3, 3)], [W * 0.3, y + this.R(-4, 2)], [W * 0.7, y + this.R(-2, 4)], [W + 5, y]], { w: 2, a, dry: 0.5, p: 'flat' });
      this.wash(W / 2, y + 30, W * 0.7, 35, 0.08);
    }

    rock(x, by, s) {
      const pts = [[x - s, by], [x - s * 1.02, by - s * 0.35], [x - s * 0.8, by - s * 0.75], [x - s * 0.35, by - s * this.R(0.95, 1.1)], [x + s * 0.1, by - s * 0.85], [x + s * 0.5, by - s * this.R(0.85, 1)], [x + s * 0.92, by - s * 0.5], [x + s, by]];
      this.poly(pts, PAPER, 1);
      this.op((c) => {
        const g = c.createLinearGradient(x - s, by - s, x + s, by);
        g.addColorStop(0, 'rgba(24,23,27,0.42)'); g.addColorStop(0.5, 'rgba(24,23,27,0.12)'); g.addColorStop(1, 'rgba(24,23,27,0.35)');
        c.fillStyle = g; c.beginPath(); pts.forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]))); c.closePath(); c.fill();
      });
      this.stroke(pts, { w: Math.max(2, s * 0.04), a: 0.9, dry: 0.45, p: 'flat' });
      this.stroke([[x - s * 0.35, by - s * 1.0], [x - s * 0.2, by - s * 0.55], [x - s * 0.45, by - s * 0.15]], { w: Math.max(1.5, s * 0.03), a: 0.75, dry: 0.5 });
      this.stroke([[x + s * 0.5, by - s * 0.92], [x + s * 0.35, by - s * 0.5], [x + s * 0.55, by - s * 0.1]], { w: Math.max(1.5, s * 0.03), a: 0.7, dry: 0.5 });
      for (let i = 0; i < 10; i++) {
        const sx = x + this.R(-0.7, 0.7) * s, sy = by - this.R(0.15, 0.75) * s;
        this.stroke([[sx, sy], [sx + this.R(-4, 6), sy + this.R(5, 14)]], { w: 1.4, a: 0.55, dry: 0.6 });
      }
      for (let i = 0; i < 4; i++) this.blob(x + this.R(-0.6, 0.6) * s, by - s * this.R(0.6, 0.95), this.R(1, 1.8), 0.9, INK, false);
    }

    lotusLeaf(x, y, rx, ry) {
      this.wash(x, y, rx, ry, 0.55, '28,34,30', 0, 0.75);
      this.wash(x + this.R(-5, 5), y, rx * 0.6, ry * 0.6, 0.3, '20,22,20');
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * 6.28;
        this.line([[x, y], [x + Math.cos(a) * rx * 0.85, y + Math.sin(a) * ry * 0.85]], { w: 0.6, a: 0.5 });
      }
    }

    lotusFlower(x, y, s) {
      const col = '#d0607a';
      [[-0.9, -0.2], [0.9, -0.2], [-0.45, -0.8], [0.45, -0.8], [0, -1.05]].forEach(([u, v]) => {
        this.stroke([[x, y], [x + u * s * 0.6, y + v * s * 0.6], [x + u * s, y + v * s]], { w: s * 0.42, a: 0.7, dry: 0, p: 'leaf', c: col });
        this.line([[x, y], [x + u * s * 0.55, y + v * s * 0.65], [x + u * s, y + v * s]], { w: 0.5, a: 0.5 });
      });
      this.blob(x, y - s * 0.15, s * 0.14, 0.9, '#c9a43b', false);
    }

    calligraphy(ch, x, y, size, a = 0.9) {
      this.op((c) => {
        c.save(); c.globalAlpha = a; c.fillStyle = INK; c.font = `${size}px ${FONT}`;
        c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(ch, x, y); c.restore();
      });
    }

    seal(x, y, s, text) {
      const dots = Array.from({ length: 14 }, () => [this.R(0, s), this.R(0, s), this.R(0.3, 0.9)]);
      this.op((c) => {
        c.save(); c.fillStyle = RED; c.globalAlpha = 0.88;
        c.beginPath(); c.roundRect ? c.roundRect(x, y, s, s, 2) : c.rect(x, y, s, s); c.fill();
        c.globalAlpha = 1; c.fillStyle = PAPER; c.font = `${s * 0.78}px ${FONT}`;
        c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, x + s / 2, y + s * 0.54);
        dots.forEach(([dx, dy, r]) => { c.beginPath(); c.arc(x + dx, y + dy, r, 0, 6.2832); c.fill(); });
        c.restore();
      });
    }
  }

  // ---------- 各种画题 ----------
  const S = {};

  S.mountain = (p) => {
    p.farHills(210, 0.14, 3);
    p.mist(205, 30);
    p.mountain(80, 280, 150, 110, { a: 0.32 });
    p.mountain(240, 290, 120, 90, { a: 0.3 });
    p.mist(275, 22);
    const pts = p.mountain(150, 360, 250, 120, { a: 0.62, sharp: 1.3, cun: 26, mossN: 9 });
    p.mist(345, 25, 0.95);
    const q = pts[14];
    p.pine(q[0] + 4, q[1] + 30, 52, -1);
    p.hut(215, 372, 9);
    p.waterLines(378, 398, 6, 0.25);
    p.ins.side = 'left';
  };

  S.water = (p) => {
    p.farHills(150, 0.15, 3);
    p.mist(148, 20);
    p.mountain(50, 210, 70, 80, { a: 0.35 });
    p.mountain(265, 200, 55, 70, { a: 0.3 });
    p.waterLines(170, 330, 34, 0.32);
    for (let i = 0; i < 4; i++) p.stroke([[20 + i * 70, 250 + i * 18], [50 + i * 70, 246 + i * 18], [80 + i * 70, 251 + i * 18]], { w: 1.4, a: 0.4, p: 'leaf' });
    p.boat(170, 245, 16, false);
    p.stroke([[160, 245], [163, 205]], { w: 1, a: 0.8, p: 'flat' });
    p.poly([[164, 207], [164, 240], [185, 240]], '#e7dcc4', 1);
    p.line([[164, 207], [185, 240], [164, 240]], { w: 0.8, a: 0.7 });
    for (let i = 0; i < 18; i++) {
      const x = p.R(0, 90), L = p.R(30, 70);
      p.stroke([[x, 400], [x + p.R(-5, 10), 400 - L]], { w: 1.6, a: 0.6, p: 'head', dry: 0.2 });
    }
    p.flyBird(230, 120, 8); p.flyBird(250, 110, 6);
    p.ins.side = 'right';
  };

  S.sun = (p) => {
    p.farHills(240, 0.12, 3);
    p.wash(190, 120, 70, 70, 0.18, '214,96,60');
    p.wash(190, 120, 30, 30, 0.92, '200,58,40', 0, 0.82);
    p.mist(235, 25);
    p.mountain(60, 290, 110, 100, { a: 0.5 });
    p.mountain(270, 300, 90, 90, { a: 0.42 });
    p.mist(290, 15);
    p.waterLines(300, 390, 22, 0.3);
    for (let i = 0; i < 7; i++) {
      const y = 305 + i * 11, L = 26 - i * 2.5;
      p.stroke([[190 - L, y], [190 + L, y + 1]], { w: 2.4, a: 0.55 - i * 0.05, c: '#c8432e', p: 'leaf', dry: 0.3 });
    }
    p.flyBird(120, 150, 9); p.flyBird(95, 170, 7);
    p.ins.side = 'left';
  };

  S.moon = (p) => {
    p.sky(0, 260, 0.55);
    for (let i = 0; i < 6; i++) p.wash(p.R(0, W), p.R(40, 200), p.R(60, 120), p.R(30, 60), 0.12);
    p.wash(185, 110, 62, 62, 0.85, '242,234,216', 0, 0.55);
    p.wash(185, 110, 36, 36, 1, '246,240,226', 0, 0.9);
    p.wash(178, 104, 14, 10, 0.06);
    p.mountain(70, 330, 110, 120, { a: 0.75 });
    p.mountain(250, 340, 80, 100, { a: 0.6 });
    p.mist(330, 18, 0.8);
    p.waterLines(345, 398, 10, 0.3);
    p.wash(185, 370, 18, 4, 0.9, '246,240,226');
    const x = -5, y = 70;
    p.stroke([[x, y], [60, y + 18], [100, y + 6]], { w: 5, a: 0.85, p: 'flat', dry: 0.4 });
    p.needles(70, y + 4, 16); p.needles(100, y + 4, 13); p.needles(40, y + 10, 14);
    p.ins.side = 'left';
  };

  S.star = (p) => {
    p.sky(0, 330, 0.7);
    for (let i = 0; i < 5; i++) p.wash(p.R(0, W), p.R(30, 220), p.R(60, 120), p.R(30, 60), 0.15);
    for (let i = 0; i < 40; i++) p.blob(p.R(10, 290), p.R(10, 250), p.R(0.6, 1.6), 0.95, '#f6efdc', false);
    [[90, 80], [150, 60], [210, 95], [240, 150]].forEach(([x, y], i, a) => {
      p.wash(x, y, 8, 8, 0.6, '246,238,215'); p.blob(x, y, 2.4, 1, '#fbf5e3', false);
      if (i) p.line([a[i - 1], [x, y]], { w: 0.5, a: 0.4, c: '#f6efdc' });
    });
    p.mountain(80, 360, 90, 130, { a: 0.85 });
    p.mountain(240, 370, 70, 110, { a: 0.75 });
    p.wash(200, 336, 6, 6, 0.8, '230,170,70');
    p.hut(200, 346, 8);
    p.ins.side = 'left';
  };

  S.cloud = (p) => {
    p.farHills(260, 0.12, 2);
    const a = p.mountain(90, 330, 220, 70, { a: 0.6, sharp: 1.1 });
    p.mountain(220, 320, 170, 65, { a: 0.48, sharp: 1.2 });
    p.cloud(70, 250, 32); p.cloud(220, 230, 26); p.cloud(150, 300, 36);
    p.cloud(250, 330, 30);
    p.mist(370, 40, 0.95);
    p.flyBird(190, 90, 8);
    p.ins.side = 'right';
  };

  S.rain = (p) => {
    for (let i = 0; i < 7; i++) p.wash(p.R(-20, 320), p.R(10, 90), p.R(60, 110), p.R(25, 50), 0.28);
    p.farHills(240, 0.2, 3);
    p.mist(230, 30, 0.6);
    p.mountain(70, 300, 110, 100, { a: 0.4 });
    p.mountain(250, 310, 80, 90, { a: 0.35 });
    p.waterLines(300, 390, 16, 0.3);
    p.boat(120, 330, 14);
    for (let i = 0; i < 10; i++) {
      const x = p.R(20, 280), y = p.R(310, 390);
      p.op((c) => { c.save(); c.globalAlpha = 0.4; c.strokeStyle = INK; c.lineWidth = 0.6; c.beginPath(); c.ellipse(x, y, 7, 1.8, 0, 0, 6.28); c.stroke(); c.restore(); });
    }
    for (let i = 0; i < 140; i++) {
      const x = p.R(-40, 320), y = p.R(30, 380), L = p.R(10, 22);
      p.line([[x, y], [x - L * 0.3, y + L]], { w: 0.55, a: p.R(0.25, 0.5) });
    }
    p.ins.side = 'right';
  };

  S.snow = (p) => {
    p.sky(0, 300, 0.35);
    for (let i = 0; i < 5; i++) p.wash(p.R(0, W), p.R(20, 180), p.R(60, 120), p.R(30, 60), 0.1);
    p.mountain(90, 300, 160, 120, { a: 0.18, line: true, cun: 6 });
    p.mountain(240, 310, 120, 100, { a: 0.15, cun: 5 });
    p.mist(305, 20);
    p.pine(240, 370, 120, -1);
    p.hut(110, 372, 12);
    p.waterLines(378, 400, 5, 0.3);
    p.op((c) => {}); // 停顿
    for (let i = 0; i < 90; i++) p.blob(p.R(0, W), p.R(0, 380), p.R(0.8, 2.2), 0.95, '#fbf7ec', false);
    p.ins.side = 'left';
  };

  S.wind = (p) => {
    p.farHills(260, 0.12, 2);
    p.ground(340, 0.3);
    for (let i = 0; i < 3; i++) {
      const [tx, ty] = p.bambooStalk(70 + i * 22, 345, 230 - i * 40, 0.12 + i * 0.03);
      p.bambooLeaves(tx, ty + 30, 5, 1); p.bambooLeaves(tx - 10, ty + 90, 4, 1);
    }
    for (let i = 0; i < 6; i++) {
      const y = p.R(80, 300), x = p.R(-20, 120);
      p.stroke([[x, y], [x + 60, y - 12], [x + 140, y + 4], [x + 210, y - 10]], { w: 1.1, a: 0.28, dry: 0.4 });
    }
    for (let i = 0; i < 6; i++) { const x = p.R(160, 290), y = p.R(70, 260); p.stroke([[x, y], [x + 12, y - 4]], { w: 4, a: 0.75, p: 'leaf' }); }
    p.ins.side = 'right';
  };

  S.sky = (p) => {
    p.farHills(330, 0.16, 4);
    p.mist(325, 20);
    p.waterLines(340, 395, 10, 0.25);
    p.cloud(80, 120, 26); p.cloud(220, 180, 22);
    p.op((c) => {
      ['200,60,50', '220,140,50', '210,190,70', '90,150,90', '70,110,170', '110,80,150'].forEach((col, i) => {
        c.save(); c.globalAlpha = 0.28; c.strokeStyle = `rgb(${col})`; c.lineWidth = 6;
        c.beginPath(); c.arc(150, 340, 170 - i * 6, Math.PI * 1.1, Math.PI * 1.9); c.stroke(); c.restore();
      });
    });
    for (let i = 0; i < 4; i++) p.flyBird(150 + i * 22, 90 + Math.abs(i - 1.5) * 12, 7);
    p.ins.side = 'left';
  };

  S.stone = (p) => {
    p.farHills(260, 0.12, 2);
    p.ground(355, 0.3);
    p.rock(150, 358, 95);
    p.rock(250, 362, 35);
    p.grassClump(60, 360, 12, 40);
    p.grassClump(220, 362, 8, 28);
    p.ins.side = 'left';
  };

  S.field = (p) => {
    p.farHills(150, 0.16, 3);
    p.wash(230, 70, 14, 14, 0.85, '200,58,40', 0, 0.8);
    p.mist(150, 18);
    let y = 165;
    for (let i = 0; i < 9; i++) {
      const gap = 10 + i * 4.5;
      p.wash(150, y + gap / 2, 180, gap / 2, 0.06 + (i % 2) * 0.05, '60,90,60', 0, 0.6);
      p.stroke([[-10, y + p.R(-3, 3)], [80, y + p.R(-6, 6)], [200, y + p.R(-6, 6)], [310, y]], { w: 1.2 + i * 0.15, a: 0.55, dry: 0.4, p: 'flat' });
      if (i > 3) for (let k = 0; k < 9; k++) {
        const sx = 20 + k * 32 + p.R(-5, 5), sy = y + gap * 0.6;
        p.stroke([[sx, sy], [sx - 2, sy - 6 - i * 0.6]], { w: 1.4, a: 0.7, c: '#3b5c33', p: 'head' });
        p.stroke([[sx, sy], [sx + 3, sy - 5 - i * 0.6]], { w: 1.4, a: 0.7, c: '#3b5c33', p: 'head' });
      }
      y += gap;
    }
    p.hut(250, 168, 7);
    p.ins.side = 'left';
  };

  const treesScene = (n) => (p) => {
    p.farHills(260, 0.12, 3);
    p.mist(255, 20);
    p.ground(355, 0.3);
    const xs = n === 1 ? [[150, 355, 230]] : n === 2 ? [[95, 355, 200], [205, 352, 220]] : [[150, 300, 160], [80, 360, 190], [220, 362, 200]];
    xs.forEach(([x, by, h]) => p.tree(x, by, h, { depth: 3 }));
    p.grassClump(40, 358, 6, 22); p.grassClump(270, 358, 6, 22);
    p.ins.side = n === 2 ? 'right' : 'left';
  };
  S.trees1 = treesScene(1); S.trees2 = treesScene(2); S.trees3 = treesScene(3);

  S.pine = (p) => {
    p.farHills(250, 0.14, 3);
    p.mist(245, 20);
    p.rock(120, 372, 55);
    p.pine(130, 345, 250, 1);
    p.ins.side = 'left';
  };

  S.bamboo = (p) => {
    p.rock(80, 385, 40);
    const tops = [[110, 0.05, 330], [150, -0.02, 300], [200, 0.08, 280]].map(([x, l, h]) => p.bambooStalk(x, 400, h, l));
    tops.forEach(([x, y], i) => { p.bambooLeaves(x, y + 40, 5, i % 2 ? 1 : -1); p.bambooLeaves(x, y + 120, 4, i % 2 ? -1 : 1); });
    p.bambooLeaves(230, 200, 4, 1, 0.9);
    p.ins.side = 'right';
  };

  S.flower = (p) => {
    p.rock(220, 390, 45);
    p.stroke([[150, 400], [140, 320], [150, 250]], { w: 3, a: 0.7, p: 'flat' });
    [[90, 290, 1], [190, 300, -1], [110, 340, 1], [185, 350, -1], [130, 255, 1]].forEach(([x, y, d]) => {
      p.wash(x, y, 26, 14, 0.55, '30,40,32', d * 0.4, 0.7);
      p.line([[x - d * 20, y + 4], [x + d * 18, y - 4]], { w: 0.7, a: 0.6 });
    });
    const flower = (x, y, s) => {
      for (let k = 0; k < 3; k++) {
        const r = s * (1 - k * 0.28);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * 6.28 + k * 0.4;
          p.wash(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.42, r * 0.5, r * 0.4, 0.45 + k * 0.12, k === 2 ? '170,40,70' : '210,90,120', a, 0.5);
        }
      }
      p.blob(x, y, s * 0.12, 0.9, '#c9a43b', false);
    };
    flower(150, 215, 46);
    flower(215, 260, 30);
    p.butterfly(70, 150, 14);
    p.ins.side = 'left';
  };

  S.grass = (p) => {
    p.farHills(250, 0.12, 3);
    p.mist(245, 20);
    p.ground(340, 0.25);
    for (let i = 0; i < 9; i++) p.grassClump(p.R(10, 290), p.R(330, 395), p.I(6, 12), p.R(30, 70), p.pick([INK, '#33503a']));
    [[70, 320], [230, 335], [160, 360]].forEach(([x, y]) => p.blossom(x, y, 4, '220,170,60'));
    p.butterfly(170, 230, 12, '180,120,170');
    p.ins.side = 'left';
  };

  const plumScene = (col) => (p) => {
    p.stroke([[300, 90], [230, 130], [190, 200], [120, 250], [40, 340]], { w: 13, a: 0.8, dry: 0.5, p: 'flat' });
    p.stroke([[190, 200], [150, 160], [130, 90]], { w: 6, a: 0.8, dry: 0.45, p: 'taper' });
    p.stroke([[120, 250], [70, 230], [30, 200]], { w: 5, a: 0.75, dry: 0.45 });
    p.stroke([[230, 130], [220, 70], [240, 30]], { w: 4, a: 0.75, dry: 0.4 });
    p.stroke([[160, 225], [190, 270], [180, 320]], { w: 3.5, a: 0.75, dry: 0.4 });
    for (let i = 0; i < 12; i++) p.blob(p.R(40, 290), p.R(100, 330), p.R(1, 2), 0.9, INK, false);
    [[130, 95], [145, 140], [215, 75], [238, 35], [70, 230], [35, 200], [185, 300], [180, 270], [250, 120], [100, 260], [200, 200], [165, 180]]
      .forEach(([x, y]) => p.blossom(x + p.R(-4, 4), y + p.R(-4, 4), p.R(6, 9), col));
    p.ins.side = 'left';
  };
  S.plum = plumScene('200,55,70');

  S.lotus = (p) => {
    p.waterLines(250, 400, 20, 0.25);
    p.stroke([[150, 400], [148, 300], [155, 200]], { w: 2.2, a: 0.7, p: 'flat', dry: 0.3 });
    p.stroke([[90, 400], [85, 330], [80, 290]], { w: 2, a: 0.7, p: 'flat', dry: 0.3 });
    p.stroke([[220, 400], [225, 330], [230, 270]], { w: 2, a: 0.7, p: 'flat', dry: 0.3 });
    p.lotusLeaf(80, 290, 60, 26);
    p.lotusLeaf(232, 268, 52, 22);
    p.lotusFlower(155, 200, 45);
    p.stroke([[250, 400], [255, 260], [262, 170]], { w: 1.6, a: 0.7, p: 'flat' });
    p.stroke([[262, 168], [262, 140]], { w: 12, a: 0.75, p: 'leaf', c: '#d0607a', dry: 0 });
    p.dragonfly(195, 110, 18);
    p.ins.side = 'left';
  };

  S.orchid = (p) => {
    p.rock(210, 390, 55);
    for (let i = 0; i < 9; i++) {
      const d = i % 2 ? 1 : -1, L = p.R(110, 230), lean = p.R(0.1, 0.9);
      p.stroke([[120, 385], [120 + d * L * lean * 0.3, 385 - L * 0.75], [120 + d * L * (0.25 + lean * 0.6), 385 - L * (0.85 - lean * 0.35)]], { w: p.R(2.5, 3.8), a: 0.82, dry: 0.15, p: 'leaf', body: false });
    }
    [[140, 240], [100, 210], [165, 200]].forEach(([x, y]) => p.line([[122, 385], [(x + 122) / 2 + 6, (y + 385) / 2], [x, y]], { w: 0.8, a: 0.55 }));
    [[140, 240], [100, 210], [165, 200]].forEach(([x, y]) => {
      for (let k = 0; k < 4; k++) { const a = -1.4 + k * 0.9; p.stroke([[x, y], [x + Math.cos(a) * 12, y + Math.sin(a) * 12]], { w: 4, a: 0.4, p: 'leaf' }); }
      p.blob(x, y, 1.4, 0.95);
    });
    p.ins.side = 'right';
  };

  S.willow = (p) => {
    p.farHills(260, 0.12, 2);
    p.waterLines(290, 395, 18, 0.28);
    p.stroke([[30, 400], [40, 260], [20, 150], [50, 30]], { w: 16, a: 0.75, dry: 0.5, p: 'flat' });
    p.stroke([[40, 160], [120, 100], [210, 70]], { w: 5, a: 0.75, dry: 0.4 });
    p.stroke([[35, 230], [110, 200], [170, 180]], { w: 4, a: 0.75, dry: 0.4 });
    for (let i = 0; i < 30; i++) {
      const x = p.R(30, 220), y = 60 + (x - 30) * -0.15 + p.R(30, 160), L = p.R(70, 180);
      p.line([[x, y - 20], [x + 4, y + L * 0.4], [x + p.R(6, 14), y + L]], { w: 0.7, a: 0.55, c: '#3e6a3a' });
      for (let k = 0; k < 5; k++) { const yy = y + (k / 5) * L; p.stroke([[x + 3, yy], [x + 6, yy + 4]], { w: 2, a: 0.5, c: '#4a7a3c', p: 'leaf', dry: 0 }); }
    }
    p.ins.side = 'right';
  };

  S.fruit = (p) => {
    p.stroke([[300, 60], [200, 100], [120, 150], [40, 160]], { w: 6, a: 0.8, dry: 0.45 });
    [[220, 70, 1], [90, 140, -1], [160, 110, 1]].forEach(([x, y, d]) => { p.wash(x, y, 30, 15, 0.6, '30,38,30', d * 0.6, 0.6); });
    [[175, 210, 38], [110, 245, 30], [230, 270, 32]].forEach(([x, y, r]) => {
      p.line([[x, y - r], [x + 4, y - r - 30]], { w: 1.4, a: 0.8 });
      p.wash(x, y, r, r * 0.88, 0.85, '225,120,40', 0, 0.75);
      p.wash(x - r * 0.3, y - r * 0.3, r * 0.3, r * 0.25, 0.3, '252,220,160');
      for (let k = 0; k < 4; k++) { const a = -Math.PI / 2 + (k - 1.5) * 0.7; p.stroke([[x, y - r * 0.85], [x + Math.cos(a) * 12, y - r * 0.85 + Math.sin(a) * 6 + 5]], { w: 4.5, a: 0.85, p: 'leaf' }); }
    });
    p.ins.side = 'left';
  };

  S.bird = (p) => {
    p.stroke([[0, 280], [100, 250], [190, 240], [300, 200]], { w: 7, a: 0.8, dry: 0.45, p: 'flat' });
    p.stroke([[190, 240], [230, 280], [250, 330]], { w: 3, a: 0.75, dry: 0.4 });
    for (let i = 0; i < 6; i++) { const x = p.R(20, 280); p.blossom(x, 260 - x * 0.2 + p.R(-15, 15), p.R(5, 7), '205,80,90'); }
    p.bird(130, 220, 22, -1);
    p.bird(210, 205, 15, 1);
    p.ins.side = 'right';
  };

  S.duck = (p) => {
    p.waterLines(230, 390, 24, 0.28);
    for (let i = 0; i < 12; i++) { const x = p.R(200, 300); p.stroke([[x, 260], [x + p.R(-8, 8), 140]], { w: 2, a: 0.6, p: 'head' }); }
    [[110, 280, 1], [190, 330, 0.75]].forEach(([x, y, s]) => {
      const k = 34 * s;
      p.op((c) => {
        c.save(); c.fillStyle = PAPER; c.beginPath(); c.ellipse(x, y, k, k * 0.45, 0, 0, 6.28); c.fill(); c.restore();
      });
      p.stroke([[x - k, y - k * 0.1], [x - k * 0.4, y + k * 0.45], [x + k * 0.6, y + k * 0.38], [x + k * 1.15, y - k * 0.35]], { w: 2.2, a: 0.8, p: 'flat', dry: 0.3 });
      p.stroke([[x + k * 1.15, y - k * 0.35], [x + k * 0.5, y - k * 0.4], [x - k * 0.45, y - k * 0.35], [x - k * 0.55, y - k * 0.9], [x - k * 0.35, y - k * 1.6]], { w: 2, a: 0.8, p: 'flat', dry: 0.25 });
      p.stroke([[x - k * 0.75, y - k * 0.05], [x - k * 0.82, y - k * 0.95], [x - k * 0.55, y - k * 1.65]], { w: 2, a: 0.8, p: 'flat', dry: 0.25 });
      p.blob(x - k * 0.48, y - k * 1.7, k * 0.2, 0.25);
      p.stroke([[x - k * 0.6, y - k * 1.62], [x - k * 0.95, y - k * 1.5]], { w: k * 0.13, a: 0.95, c: '#d9822b', p: 'head', dry: 0 });
      p.blob(x - k * 0.55, y - k * 1.72, k * 0.09, 0.95, '#d9822b', false);
      p.blob(x - k * 0.42, y - k * 1.75, 1.3, 1);
      p.stroke([[x + k * 0.1, y - k * 0.1], [x + k * 0.6, y - k * 0.05], [x + k * 0.95, y - k * 0.3]], { w: 1.3, a: 0.6 });
      p.stroke([[x - k * 1.2, y + k * 0.6], [x + k * 1.3, y + k * 0.58]], { w: 1.2, a: 0.4, p: 'leaf' });
    });
    p.ins.side = 'right';
  };

  S.swallow = (p) => {
    p.farHills(300, 0.12, 2);
    p.waterLines(320, 395, 14, 0.25);
    S.willowBranch(p);
    const sw = (x, y, s, d) => {
      p.stroke([[x, y], [x - d * s * 0.5, y - s * 0.6], [x - d * s * 1.4, y - s * 0.7]], { w: s * 0.25, a: 0.9, p: 'head', dry: 0 });
      p.stroke([[x, y], [x + d * s * 0.3, y - s * 0.55], [x + d * s * 1.1, y - s * 0.9]], { w: s * 0.22, a: 0.9, p: 'head', dry: 0 });
      p.stroke([[x + d * s * 0.35, y + 1], [x - d * s * 0.5, y + s * 0.1]], { w: s * 0.3, a: 0.95, p: 'head', dry: 0 });
      p.stroke([[x - d * s * 0.4, y + s * 0.1], [x - d * s * 1.0, y + s * 0.45]], { w: s * 0.08, a: 0.9, p: 'head' });
      p.stroke([[x - d * s * 0.4, y + s * 0.1], [x - d * s * 1.05, y + s * 0.15]], { w: s * 0.08, a: 0.9, p: 'head' });
      p.blob(x + d * s * 0.4, y + s * 0.05, s * 0.06, 1, '#b8352a', false);
    };
    sw(150, 200, 22, 1); sw(210, 150, 16, 1); sw(110, 270, 13, -1);
    p.ins.side = 'right';
  };
  S.willowBranch = (p) => {
    for (let i = 0; i < 14; i++) {
      const x = p.R(-10, 90), y = p.R(-10, 30), L = p.R(100, 230);
      p.line([[x, y], [x + 6, y + L * 0.4], [x + p.R(8, 20), y + L]], { w: 0.7, a: 0.55, c: '#3e6a3a' });
      for (let k = 1; k < 6; k++) { const yy = y + (k / 6) * L; p.stroke([[x + 4 + k, yy], [x + 8 + k, yy + 5]], { w: 2, a: 0.5, c: '#4a7a3c', p: 'leaf', dry: 0 }); }
    }
  };

  S.geese = (p) => {
    p.farHills(300, 0.14, 4);
    p.mist(295, 20);
    p.waterLines(320, 395, 12, 0.25);
    const n = p.count || p.I(5, 7);
    for (let i = 0; i < n; i++) {
      const k = i - (n - 1) / 2;
      p.flyBird(150 + k * 26, 120 + Math.abs(k) * 16, 9);
    }
    p.ins.side = 'right';
  };

  S.count = (p) => {
    p.farHills(310, 0.13, 3);
    p.mist(305, 20);
    p.waterLines(325, 395, 12, 0.25);
    p.wash(60, 80, 16, 16, 0.85, '200,58,40', 0, 0.8);
    const n = p.count;
    const cols = n <= 5 ? n : Math.ceil(n / 2), rows = n <= 5 ? 1 : 2;
    let k = 0;
    for (let r = 0; r < rows; r++) for (let i = 0; i < cols && k < n; i++, k++) {
      const x = 150 + (i - (cols - 1) / 2) * 48 + (r ? 18 : 0), y = 150 + r * 70 + (i % 2) * 10;
      p.flyBird(x, y, 15);
    }
    p.ins.side = 'right';
  };

  S.crane = (p) => {
    p.farHills(270, 0.12, 2);
    p.rock(170, 380, 60);
    p.pine(260, 330, 220, -1);
    const x = 120, y = 230;
    p.op((c) => { c.save(); c.fillStyle = PAPER; c.beginPath(); c.ellipse(x, y, 34, 18, -0.2, 0, 6.28); c.fill(); c.restore(); });
    p.stroke([[x - 30, y + 8], [x, y + 18], [x + 34, y - 4]], { w: 1.6, a: 0.75 });
    p.stroke([[x - 32, y + 6], [x - 20, y - 14], [x + 10, y - 18]], { w: 1.4, a: 0.65 });
    p.stroke([[x + 18, y - 10], [x + 48, y - 2], [x + 62, y + 14]], { w: 9, a: 0.9, p: 'head', dry: 0.35 });
    p.stroke([[x - 28, y - 4], [x - 40, y - 40], [x - 26, y - 80], [x - 34, y - 100]], { w: 4.2, a: 0.92, p: 'flat', dry: 0.1 });
    p.blob(x - 36, y - 104, 5.5, 0.15);
    p.line([[x - 34, y - 106], [x - 30, y - 102], [x - 38, y - 100]], { w: 1, a: 0.6 });
    p.blob(x - 36, y - 108, 2.6, 0.95, '#c7352b', false);
    p.stroke([[x - 40, y - 102], [x - 66, y - 96]], { w: 2.2, a: 0.85, p: 'head', dry: 0, c: '#5c4a2a' });
    p.line([[x - 4, y + 16], [x - 6, y + 70], [x - 5, y + 120]], { w: 1.2, a: 0.85 });
    p.line([[x + 6, y + 15], [x + 10, y + 50], [x - 4, y + 64]], { w: 1.2, a: 0.85 });
    p.ins.side = 'left';
  };

  S.fish = (p) => {
    p.waterLines(30, 380, 10, 0.18);
    p.lotusLeaf(250, 60, 70, 40);
    for (let i = 0; i < 6; i++) { const x = p.R(10, 290); p.stroke([[x, 400], [x + p.R(-20, 20), 400 - p.R(40, 90)]], { w: 1.4, a: 0.35, p: 'head', c: '#35553a' }); }
    p.fish(70, 160, 70, 0.25);
    p.fish(150, 250, 55, -0.3, '#d1592f', 0.8);
    p.fish(60, 300, 45, 0.1);
    p.ins.side = 'right';
  };

  S.shrimp = (p) => {
    const sh = (x, y, s, ang) => {
      const T = (u, v) => [x + (u * Math.cos(ang) - v * Math.sin(ang)) * s, y + (u * Math.sin(ang) + v * Math.cos(ang)) * s];
      p.wash(...T(0.1, 0), s * 0.25, s * 0.14, 0.35, '24,23,27', ang, 0.5);
      p.stroke([T(-0.15, 0), T(0.3, 0.02)], { w: s * 0.22, a: 0.35, p: 'head', dry: 0 });
      p.blob(...T(0.1, -0.05), s * 0.05, 0.9, INK, false);
      for (let i = 0; i < 6; i++) {
        const u = 0.35 + i * 0.13, v = (i * i) * 0.018;
        p.stroke([T(u, v - 0.06), T(u + 0.06, v), T(u, v + 0.08)], { w: s * (0.16 - i * 0.015), a: 0.45, p: 'leaf', dry: 0 });
      }
      p.stroke([T(1.05, 0.5), T(1.15, 0.65)], { w: s * 0.1, a: 0.55, p: 'leaf' });
      p.stroke([T(1.0, 0.52), T(0.95, 0.68)], { w: s * 0.1, a: 0.55, p: 'leaf' });
      p.line([T(-0.15, -0.02), T(-0.8, -0.4), T(-1.6, -0.2)], { w: 0.5, a: 0.6 });
      p.line([T(-0.15, 0.02), T(-0.9, 0.1), T(-1.5, 0.5)], { w: 0.5, a: 0.6 });
      p.line([T(0.05, 0.06), T(-0.35, 0.25), T(-0.7, 0.2)], { w: 1.1, a: 0.75 });
      p.stroke([T(-0.7, 0.2), T(-0.95, 0.12)], { w: s * 0.08, a: 0.8, p: 'leaf' });
      for (let i = 0; i < 4; i++) p.line([T(0.45 + i * 0.12, 0.08 + i * 0.03), T(0.42 + i * 0.12, 0.22 + i * 0.03)], { w: 0.5, a: 0.6 });
    };
    sh(150, 120, 90, 0.4); sh(110, 260, 75, -0.1); sh(200, 300, 60, 0.9);
    p.ins.side = 'left';
  };

  const beast = (p, x, by, s, kind) => {
    const X = (u) => x + u * s, Y = (v) => by + v * s;
    if (kind === 'horse') {
      p.wash(X(0), Y(-1.05), s * 0.75, s * 0.36, 0.75, '24,23,27', -0.05, 0.6);
      p.wash(X(-0.5), Y(-1.02), s * 0.42, s * 0.38, 0.78, '24,23,27', 0, 0.6);
      p.wash(X(0.5), Y(-1.08), s * 0.4, s * 0.38, 0.82, '24,23,27', 0, 0.6);
      p.stroke([[X(0.5), Y(-1.2)], [X(0.78), Y(-1.6)], [X(0.95), Y(-1.85)]], { w: s * 0.42, a: 0.8, p: 'flat', dry: 0.15 });
      p.stroke([[X(0.92), Y(-1.9)], [X(1.15), Y(-1.68)], [X(1.38), Y(-1.5)]], { w: s * 0.24, a: 0.85, p: 'head', dry: 0.1 });
      p.stroke([[X(0.92), Y(-1.95)], [X(0.88), Y(-2.12)]], { w: s * 0.08, a: 0.9, p: 'head', dry: 0 });
      p.blob(X(1.06), Y(-1.82), s * 0.035, 1, PAPER, false);
      for (let i = 0; i < 7; i++) p.stroke([[X(0.9 - i * 0.07), Y(-1.92 + i * 0.1)], [X(0.55 - i * 0.08), Y(-1.86 + i * 0.12)], [X(0.25 - i * 0.07), Y(-1.7 + i * 0.12)]], { w: s * 0.06, a: 0.75, dry: 0.4 });
      p.stroke([[X(0.65), Y(-0.85)], [X(0.95), Y(-0.55)], [X(0.85), Y(-0.08)]], { w: s * 0.065, a: 0.85, p: (t) => 1 - t * 0.45, dry: 0.15 });
      p.stroke([[X(0.45), Y(-0.85)], [X(0.55), Y(-0.45)], [X(0.4), Y(-0.05)]], { w: s * 0.06, a: 0.8, p: (t) => 1 - t * 0.45, dry: 0.15 });
      p.stroke([[X(-0.55), Y(-0.85)], [X(-0.8), Y(-0.45)], [X(-1.1), Y(-0.12)]], { w: s * 0.07, a: 0.85, p: (t) => 1 - t * 0.45, dry: 0.15 });
      p.stroke([[X(-0.4), Y(-0.85)], [X(-0.35), Y(-0.45)], [X(-0.5), Y(-0.02)]], { w: s * 0.06, a: 0.8, p: (t) => 1 - t * 0.45, dry: 0.15 });
      for (let i = 0; i < 5; i++) p.stroke([[X(-0.85), Y(-1.15)], [X(-1.25), Y(-1.15 + i * 0.07)], [X(-1.65), Y(-0.9 + i * 0.1)]], { w: s * 0.07, a: 0.7, dry: 0.5 });
    } else if (kind === 'ox') {
      p.wash(X(0), Y(-0.9), s * 0.95, s * 0.42, 0.7, '24,23,27', 0, 0.65);
      p.wash(X(-0.55), Y(-0.95), s * 0.45, s * 0.42, 0.72, '24,23,27', 0, 0.6);
      p.wash(X(0.75), Y(-0.85), s * 0.32, s * 0.25, 0.85, '24,23,27', 0.4, 0.6);
      p.blob(X(1.0), Y(-0.65), s * 0.12, 0.6);
      p.stroke([[X(0.72), Y(-1.05)], [X(0.55), Y(-1.3)], [X(0.75), Y(-1.42)]], { w: s * 0.07, a: 0.9, p: 'head', dry: 0 });
      p.stroke([[X(0.88), Y(-1.0)], [X(1.05), Y(-1.25)], [X(0.92), Y(-1.4)]], { w: s * 0.07, a: 0.9, p: 'head', dry: 0 });
      p.blob(X(0.85), Y(-0.9), s * 0.035, 1, PAPER, false);
      [[0.55, 0.6], [0.35, 0.3], [-0.65, -0.75], [-0.4, -0.45]].forEach(([a, b]) => p.stroke([[X(a), Y(-0.6)], [X(b), Y(-0.02)]], { w: s * 0.08, a: 0.85, p: (t) => 1 - t * 0.4, dry: 0.15 }));
      p.line([[X(-0.98), Y(-1.0)], [X(-1.1), Y(-0.6)], [X(-1.05), Y(-0.3)]], { w: 1.2, a: 0.8 });
      p.stroke([[X(-1.05), Y(-0.35)], [X(-1.05), Y(-0.2)]], { w: 3, a: 0.8, dry: 0.5 });
    } else if (kind === 'sheep') {
      for (let i = 0; i < 16; i++) {
        const u = p.R(-0.7, 0.6), v = p.R(-1.25, -0.65);
        p.op((c) => { c.save(); c.fillStyle = PAPER; c.beginPath(); c.arc(X(u), Y(v), s * 0.22, 0, 6.28); c.fill(); c.globalAlpha = 0.6; c.strokeStyle = INK; c.lineWidth = 1; c.beginPath(); c.arc(X(u), Y(v), s * 0.22, Math.PI * 0.9, Math.PI * 2.1); c.stroke(); c.restore(); });
      }
      p.wash(X(-0.05), Y(-0.95), s * 0.7, s * 0.35, 0.08);
      p.stroke([[X(0.6), Y(-1.15)], [X(0.95), Y(-1.0)]], { w: s * 0.3, a: 0.85, p: 'head', dry: 0 });
      p.stroke([[X(0.62), Y(-1.2)], [X(0.45), Y(-1.08)]], { w: s * 0.12, a: 0.8, p: 'head', dry: 0 });
      p.blob(X(0.72), Y(-1.18), s * 0.035, 1, PAPER, false);
      [0.4, 0.25, -0.45, -0.6].forEach((u) => p.stroke([[X(u), Y(-0.65)], [X(u), Y(0)]], { w: s * 0.035, a: 0.9, p: (t) => 1 - t * 0.4, dry: 0 }));
    }
  };

  S.horse = (p) => {
    p.farHills(240, 0.13, 3);
    p.ground(330, 0.3);
    beast(p, 150, 332, 70, 'horse');
    for (let i = 0; i < 6; i++) p.grassClump(p.R(10, 290), p.R(330, 380), 5, 20);
    p.ins.side = 'left';
  };
  S.ox = (p) => {
    p.farHills(230, 0.13, 3);
    S.willowBranch(p);
    p.ground(335, 0.3);
    beast(p, 150, 335, 70, 'ox');
    for (let i = 0; i < 5; i++) p.grassClump(p.R(10, 290), p.R(335, 380), 5, 20);
    p.ins.side = 'right';
  };
  S.sheep = (p) => {
    p.farHills(240, 0.14, 3);
    p.mist(240, 20);
    p.ground(320, 0.25);
    beast(p, 110, 340, 55, 'sheep');
    beast(p, 220, 300, 38, 'sheep');
    for (let i = 0; i < 8; i++) p.grassClump(p.R(10, 290), p.R(320, 390), 6, 22);
    p.ins.side = 'right';
  };

  S.insect = (p) => {
    p.ground(360, 0.25);
    for (let i = 0; i < 6; i++) p.grassClump(p.R(20, 280), 365, 7, p.R(60, 120), '#33503a');
    p.dragonfly(110, 150, 24);
    // 瓢虫
    p.wash(200, 250, 11, 9, 0.9, '200,50,40', 0, 0.8);
    p.line([[200, 241], [200, 259]], { w: 0.8, a: 0.9 });
    p.blob(191, 249, 4, 0.9);
    [[196, 246], [205, 253], [203, 245]].forEach(([x, y]) => p.blob(x, y, 1.6, 0.9, INK, false));
    p.ins.side = 'right';
  };

  S.butterfly = (p) => {
    p.ground(370, 0.25);
    p.grassClump(60, 372, 10, 70);
    [[80, 300], [120, 330], [220, 320], [260, 345]].forEach(([x, y]) => { p.line([[x, 372], [x, y]], { w: 1, a: 0.6 }); p.blossom(x, y, 8, '210,110,140'); });
    p.butterfly(150, 160, 30, '210,120,40');
    p.butterfly(220, 230, 18, '120,110,190');
    p.ins.side = 'left';
  };

  S.cat = (p) => {
    p.ground(340, 0.25);
    S.willowBranch(p);
    const x = 150, y = 340;
    p.wash(x, y - 50, 48, 55, 0.65, '24,23,27', 0, 0.6);
    p.wash(x, y - 120, 34, 30, 0.75, '24,23,27', 0, 0.65);
    p.poly([[x - 32, y - 128], [x - 28, y - 165], [x - 10, y - 145]], INK, 0.8);
    p.poly([[x + 32, y - 128], [x + 28, y - 165], [x + 10, y - 145]], INK, 0.8);
    [-13, 13].forEach((d) => { p.blob(x + d, y - 122, 6, 1, '#d9b64a', false); p.stroke([[x + d, y - 127], [x + d, y - 117]], { w: 2.2, a: 0.95, p: 'leaf', dry: 0 }); });
    p.blob(x, y - 110, 2.2, 0.9, '#c86f6f', false);
    [-1, 1].forEach((d) => { for (let k = 0; k < 3; k++) p.line([[x + d * 8, y - 108], [x + d * 45, y - 115 + k * 7]], { w: 0.5, a: 0.7, c: '#f2ead8' }); });
    p.stroke([[x + 40, y - 10], [x + 75, y - 20], [x + 80, y - 55], [x + 65, y - 70]], { w: 9, a: 0.75, p: 'head', dry: 0.3 });
    p.ins.side = 'right';
  };

  S.turtle = (p) => {
    p.waterLines(300, 395, 16, 0.28);
    p.rock(170, 320, 90);
    const x = 160, y = 230;
    p.wash(x, y, 50, 30, 0.65, '40,50,40', 0, 0.75);
    p.op((c) => {
      c.save(); c.strokeStyle = PAPER; c.globalAlpha = 0.55; c.lineWidth = 1.4;
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { c.beginPath(); c.arc(x + i * 26 + j * 4, y + j * 15, 7, 0, 6.28); c.stroke(); }
      c.restore();
    });
    p.stroke([[x + 48, y + 4], [x + 75, y - 6]], { w: 12, a: 0.75, p: 'head', dry: 0 });
    p.blob(x + 68, y - 9, 1.6, 1, PAPER, false);
    [[-34, 26], [30, 28], [-46, -10], [40, -18]].forEach(([dx, dy]) => p.blob(x + dx, y + dy, 7, 0.7));
    p.ins.side = 'left';
  };

  S.frog = (p) => {
    p.waterLines(250, 395, 18, 0.25);
    p.lotusLeaf(150, 300, 100, 38);
    const x = 150, y = 270;
    p.wash(x, y, 30, 22, 0.8, '60,96,50', 0, 0.7);
    [-14, 14].forEach((d) => { p.blob(x + d, y - 22, 7, 0.85, '#3c6032', false); p.blob(x + d, y - 23, 3.2, 1, PAPER, false); p.blob(x + d, y - 23, 1.6, 1, INK, false); });
    p.line([[x - 12, y - 6], [x, y - 2], [x + 12, y - 6]], { w: 1, a: 0.7 });
    [-1, 1].forEach((d) => { p.stroke([[x + d * 22, y + 8], [x + d * 40, y + 4], [x + d * 34, y + 20]], { w: 7, a: 0.75, p: 'flat', c: '#3c6032', dry: 0.2 }); });
    p.lotusFlower(250, 210, 30);
    p.stroke([[250, 210], [252, 300]], { w: 1.6, a: 0.7 });
    p.ins.side = 'left';
  };

  S.fisher = (p) => {
    p.farHills(150, 0.08, 2);
    p.waterLines(200, 390, 10, 0.2);
    p.boat(120, 270, 44);
    p.stroke([[55, 282], [200, 284]], { w: 1, a: 0.3, p: 'leaf' });
    p.ins.side = 'right';
  };

  S.boat = (p) => {
    p.mountain(30, 400, 380, 70, { a: 0.7, sharp: 0.9, cun: 30 });
    p.mountain(280, 400, 340, 70, { a: 0.6, sharp: 0.9, cun: 26 });
    p.mountain(150, 210, 90, 70, { a: 0.18, line: false, moss: false });
    p.mist(240, 40);
    p.waterLines(250, 395, 20, 0.28);
    p.boat(150, 300, 22);
    p.flyBird(170, 160, 6);
    p.ins.side = 'right';
  };

  S.house = (p) => {
    p.mountain(150, 260, 200, 150, { a: 0.4 });
    p.mist(255, 26);
    p.ground(330, 0.3);
    p.tree(70, 330, 140, { depth: 3 });
    p.hut(170, 332, 26);
    p.tree(250, 332, 110, { depth: 2, dots: 'stroke' });
    for (let i = 0; i < 6; i++) p.line([[120 + i * 9, 345], [120 + i * 9, 328]], { w: 1, a: 0.6 });
    p.line([[118, 336], [168, 337]], { w: 0.8, a: 0.6 });
    p.waterLines(360, 398, 6, 0.25);
    p.ins.side = 'right';
  };

  S.fire = (p) => {
    p.farHills(250, 0.1, 2);
    p.ground(330, 0.25);
    p.wash(150, 270, 90, 80, 0.25, '230,140,60');
    p.stroke([[95, 335], [205, 310]], { w: 9, a: 0.85, p: 'flat', dry: 0.4 });
    p.stroke([[100, 310], [205, 337]], { w: 9, a: 0.85, p: 'flat', dry: 0.4 });
    const layers = [['#b8352a', 1, 0.8], ['#e0632f', 0.75, 0.85], ['#efb043', 0.45, 0.9]];
    layers.forEach(([col, k, a]) => {
      for (let i = 0; i < 5; i++) {
        const x = 150 + (i - 2) * 16 * k, h = (110 - Math.abs(i - 2) * 25) * k;
        p.stroke([[x, 320], [x + p.R(-8, 8), 320 - h * 0.5], [x + p.R(-12, 12), 320 - h]], { w: 26 * k, a, p: 'head', dry: 0, c: col });
      }
    });
    for (let i = 0; i < 12; i++) p.blob(150 + p.R(-50, 50), p.R(110, 200), p.R(0.8, 1.8), 0.9, '#e0632f', false);
    for (let i = 0; i < 3; i++) { const x = 140 + i * 15; p.stroke([[x, 170], [x - 10, 130], [x + 8, 90], [x - 6, 40]], { w: 3, a: 0.18, dry: 0.4 }); }
    p.ins.side = 'right';
  };

  S.lantern = (p) => {
    p.stroke([[0, 40], [150, 55], [300, 45]], { w: 6, a: 0.85, p: 'flat', dry: 0.45 });
    [[100, 160, 1], [210, 200, 0.8]].forEach(([x, y, s]) => {
      p.line([[x, 50], [x, y - 52 * s]], { w: 1, a: 0.8 });
      p.poly([[x - 16 * s, y - 52 * s], [x + 16 * s, y - 52 * s], [x + 18 * s, y - 44 * s], [x - 18 * s, y - 44 * s]], INK, 0.85);
      p.wash(x, y, 48 * s, 46 * s, 0.92, '200,45,35', 0, 0.82);
      p.wash(x - 10 * s, y - 10 * s, 18 * s, 22 * s, 0.35, '240,120,80');
      for (let k = -2; k <= 2; k++) p.line([[x + k * 6 * s, y - 44 * s], [x + k * 18 * s, y], [x + k * 6 * s, y + 44 * s]], { w: 0.8, a: 0.35, c: '#7a1a12' });
      p.poly([[x - 18 * s, y + 44 * s], [x + 18 * s, y + 44 * s], [x + 16 * s, y + 52 * s], [x - 16 * s, y + 52 * s]], INK, 0.85);
      for (let k = -3; k <= 3; k++) p.line([[x, y + 52 * s], [x + k * 2 * s, y + 90 * s]], { w: 0.8, a: 0.85, c: '#b8352a' });
      p.calligraphy('福', x, y + 2 * s, 34 * s, 0.85);
    });
    [[40, 60], [260, 60], [160, 70]].forEach(([x, y]) => p.blossom(x, y, 6, '205,60,70'));
    p.ins.side = 'left'; p.ins.y = 270;
  };

  S.spring = (p) => {
    S.willowBranch(p);
    p.farHills(270, 0.12, 3);
    p.waterLines(300, 395, 14, 0.25);
    p.stroke([[300, 330], [240, 300], [200, 250]], { w: 4, a: 0.75, dry: 0.45 });
    [[240, 300], [215, 270], [200, 250], [260, 315]].forEach(([x, y]) => p.blossom(x, y, 7, '225,120,140'));
    p.flyBird(150, 140, 10); p.flyBird(190, 120, 8);
    p.ins.side = 'right';
  };
  S.summer = S.lotus;
  S.autumn = (p) => {
    p.farHills(260, 0.14, 3);
    p.mist(255, 20);
    p.ground(340, 0.3);
    p.tree(90, 345, 200, { depth: 3, leafCol: '#b8452a', dots: 'stroke' });
    p.tree(220, 345, 150, { depth: 3, leafCol: '#d0782f', dots: 'stroke' });
    for (let i = 0; i < 5; i++) p.flyBird(170 + i * 18, 80 + i * 10, 6);
    for (let i = 0; i < 8; i++) p.blob(p.R(30, 270), p.R(350, 390), 2.5, 0.7, '#b8452a', false);
    p.ins.side = 'right';
  };
  S.winter = (p) => { S.snow(p); [[60, 120], [90, 160], [40, 190]].forEach(([x, y]) => p.blossom(x, y, 6, '200,40,50')); };

  S.scholar = (p) => {
    p.farHills(230, 0.13, 3);
    p.mist(225, 20);
    p.mountain(110, 380, 150, 110, { a: 0.55, cun: 16 });
    p.pine(70, 260, 120, 1);
    const x = 160, by = 245;
    p.stroke([[x - 30, by], [x + 30, by]], { w: 3, a: 0.85, p: 'flat' });
    [-22, 22].forEach((d) => p.line([[x + d, by], [x + d, by - 30]], { w: 1.4, a: 0.85 }));
    p.poly([[x - 40, by - 28], [x, by - 52], [x + 40, by - 28]], INK, 0.6);
    p.stroke([[x - 44, by - 34], [x - 36, by - 28], [x, by - 52], [x + 36, by - 28], [x + 44, by - 34]], { w: 2, a: 0.85, p: 'flat', dry: 0.2 });
    p.blob(x, by - 12, 4, 0.9);
    p.poly([[x - 7, by - 1], [x, by - 10], [x + 7, by - 1]], INK, 0.4);
    p.ins.side = 'right';
  };

  S.tea = (p) => {
    p.ground(320, 0.25);
    const x = 140, y = 260;
    p.wash(x, y, 55, 45, 0.45, '120,80,50', 0, 0.75);
    p.op((c) => { c.save(); c.strokeStyle = INK; c.globalAlpha = 0.8; c.lineWidth = 2.2; c.beginPath(); c.ellipse(x, y, 55, 45, 0, 0, 6.28); c.stroke(); c.restore(); });
    p.stroke([[x - 20, y - 46], [x + 20, y - 46]], { w: 5, a: 0.8, p: 'flat' });
    p.blob(x, y - 54, 5, 0.85);
    p.stroke([[x + 52, y - 4], [x + 75, y - 15], [x + 88, y - 40]], { w: 9, a: 0.6, p: 'head', dry: 0.1, c: '#5a3d26' });
    p.op((c) => { c.save(); c.strokeStyle = INK; c.globalAlpha = 0.8; c.lineWidth = 4; c.beginPath(); c.ellipse(x - 50, y - 2, 20, 24, 0, Math.PI * 0.55, Math.PI * 1.45); c.stroke(); c.restore(); });
    p.wash(230, 300, 22, 14, 0.45, '120,80,50', 0, 0.75);
    p.stroke([[208, 290], [252, 290]], { w: 2, a: 0.8, p: 'flat' });
    for (let i = 0; i < 3; i++) { const sx = 222 + i * 8; p.stroke([[sx, 280], [sx - 6, 260], [sx + 4, 240], [sx - 2, 220]], { w: 1.6, a: 0.25, dry: 0.3 }); }
    p.bambooLeaves(40, 90, 5, 1);
    p.stroke([[0, 70], [40, 90]], { w: 2, a: 0.8 });
    p.ins.side = 'right';
  };

  S.dragon = (p) => {
    p.cloud(60, 330, 30);
    const pts = [[40, 110], [110, 80], [170, 140], [140, 230], [200, 290], [270, 260]];
    p.stroke(pts, { w: 24, a: 0.82, p: (t) => Math.max(0.15, 1 - t * 0.8), dry: 0.3, nb: 14 });
    const S2 = spline(pts, 4).pts;
    S2.forEach((q, i) => {
      if (i % 3) return;
      p.line([[q.x - q.nx * 10, q.y - q.ny * 10], [q.x - q.nx * 18 * (1 - q.t * 0.6), q.y - q.ny * 18 * (1 - q.t * 0.6)]], { w: 1.4, a: 0.85 });
      p.op((c) => { c.save(); c.strokeStyle = PAPER; c.globalAlpha = 0.6; c.lineWidth = 0.8; c.beginPath(); c.arc(q.x, q.y, 4 * (1 - q.t * 0.6), 0, Math.PI); c.stroke(); c.restore(); });
    });
    const hx = 35, hy = 112;
    p.wash(hx, hy, 24, 16, 0.85, '24,23,27', -0.3, 0.6);
    p.blob(hx - 6, hy - 6, 3, 1, '#e8c25a', false);
    p.stroke([[hx + 4, hy - 12], [hx + 20, hy - 40], [hx + 34, hy - 46]], { w: 4, a: 0.85, p: 'head' });
    p.stroke([[hx - 4, hy - 12], [hx + 2, hy - 44]], { w: 3.5, a: 0.85, p: 'head' });
    p.line([[hx - 20, hy + 2], [hx - 40, hy + 30], [hx - 20, hy + 60], [hx - 30, hy + 90]], { w: 0.9, a: 0.7 });
    p.line([[hx - 18, hy - 2], [hx - 10, hy - 40], [hx - 26, hy - 70]], { w: 0.9, a: 0.7 });
    p.line([[hx - 22, hy + 8], [hx - 6, hy + 14]], { w: 1.4, a: 0.9, c: '#b8352a' });
    [[150, 175], [190, 270]].forEach(([x, y]) => { p.stroke([[x, y], [x + 20, y + 14], [x + 30, y + 8]], { w: 3, a: 0.85, p: 'head' }); });
    p.cloud(150, 190, 28);
    p.cloud(230, 320, 26);
    p.ins.side = 'right';
  };

  // 通用：字入山水
  S.generic = (p) => {
    const v = p.I(0, 3);
    p.farHills(300, 0.14, 3);
    p.mist(295, 18);
    p.waterLines(320, 395, 12, 0.25);
    if (v === 0) p.wash(230, 80, 16, 16, 0.85, '200,58,40', 0, 0.8);
    if (v === 1) { p.flyBird(220, 90, 8); p.flyBird(245, 75, 6); }
    if (v === 2) { p.stroke([[300, 40], [250, 70], [210, 75]], { w: 4, a: 0.75, dry: 0.4 }); [[250, 70], [225, 76], [270, 52]].forEach(([x, y]) => p.blossom(x, y, 6)); }
    if (v === 3) p.boat(210, 340, 14);
    const ch = p.ch;
    const streaks = Array.from({ length: 70 }, () => [p.R(0, 1), p.R(0, 1), p.R(10, 50), p.R(0.4, 1.4)]);
    p.op((c) => {
      const k = c.getTransform().a;
      const off = document.createElement('canvas');
      off.width = W * k; off.height = H * k;
      const o = off.getContext('2d');
      o.scale(k, k);
      o.font = `190px ${FONT}`; o.textAlign = 'center'; o.textBaseline = 'middle'; o.fillStyle = INK;
      o.fillText(ch, 150, 190);
      o.globalCompositeOperation = 'destination-out';
      streaks.forEach(([u, v, L, w]) => {
        o.globalAlpha = 0.55; o.lineWidth = w; o.beginPath();
        const x = 40 + u * 220, y = 80 + v * 220; o.moveTo(x, y); o.lineTo(x + L, y + L * 0.12); o.stroke();
      });
      c.save();
      c.shadowColor = 'rgba(24,23,27,0.45)'; c.shadowBlur = 7 * k; c.globalAlpha = 0.9;
      c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(off, 0, 0); c.restore();
    });
    p.ins.side = 'left';
  };

  // ---------- 纸 ----------
  let paperTex = null;
  function paperPattern(c) {
    if (!paperTex) {
      paperTex = document.createElement('canvas');
      paperTex.width = paperTex.height = 256;
      const t = paperTex.getContext('2d'), r = mulberry(7);
      t.fillStyle = PAPER; t.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 2600; i++) {
        t.fillStyle = r() < 0.5 ? 'rgba(120,100,70,0.06)' : 'rgba(255,255,250,0.10)';
        t.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1 + r() * 2);
      }
      t.strokeStyle = 'rgba(150,125,90,0.08)';
      for (let i = 0; i < 70; i++) { const x = r() * 256, y = r() * 256, a = r() * 6.28, l = 5 + r() * 18; t.beginPath(); t.moveTo(x, y); t.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 3, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); t.stroke(); }
    }
    return c.createPattern(paperTex, 'repeat');
  }
  function paper(c) {
    c.fillStyle = paperPattern(c); c.fillRect(0, 0, W, H);
    const g = c.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
    g.addColorStop(0, 'rgba(140,110,70,0)'); g.addColorStop(1, 'rgba(140,110,70,0.16)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
  }

  // 题画诗 + 印章
  function inscribe(p, ch, line) {
    const text = (line || '').split(/[，。！？、,]/)[0].slice(0, 8);
    const left = p.ins.side === 'left';
    const x = left ? 22 : W - 22;
    let y = p.ins.y ?? 30;
    const size = 15;
    [...text].forEach((t) => { p.calligraphy(t, x, y, size, 0.8); y += size + 2; });
    p.seal(x - 9, y + 4, 18, ch);
  }

  const jobs = new WeakMap();

  /**
   * 在 canvas 上为一个汉字作画。
   * opts: { seed, instant, onDone }
   */
  function render(canvas, ch, opts = {}) {
    const rect = canvas.getBoundingClientRect();
    const cssW = rect.width || canvas.clientWidth || 300;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const k = (cssW * dpr) / W;
    canvas.width = Math.round(W * k); canvas.height = Math.round(H * k);
    const c = canvas.getContext('2d');
    c.setTransform(k, 0, 0, k, 0, 0);
    paper(c);

    const entry = window.LEXICON[ch];
    const theme = entry ? entry[0] : 'generic';
    const p = new Painter((opts.seed ?? 0) * 7919 + hash(ch));
    p.ch = ch; p.count = entry && entry.count;
    try { (S[theme] || S.generic)(p); } catch (e) { console.error(e); }
    inscribe(p, ch, entry ? entry[2] : '');

    const job = {};
    jobs.set(canvas, job);
    if (opts.instant) { p.ops.forEach((f) => f(c)); opts.onDone && opts.onDone(); return; }
    let i = 0;
    const step = () => {
      if (jobs.get(canvas) !== job) return;
      const t0 = performance.now();
      const end = Math.min(p.ops.length, i + Math.max(2, Math.ceil(p.ops.length / 55)));
      while (i < end && performance.now() - t0 < 12) p.ops[i++](c);
      if (i < p.ops.length) requestAnimationFrame(step);
      else opts.onDone && opts.onDone();
    };
    requestAnimationFrame(step);
  }

  return { render, themeOf: (ch) => (window.LEXICON[ch] ? window.LEXICON[ch][0] : 'generic'), FONT };
})();
