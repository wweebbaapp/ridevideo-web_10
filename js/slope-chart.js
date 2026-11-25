// Grafico dell'altimetria: uno "zoom" del profilo altimetrico centrato sul
// rider. L'asse verticale e' in metri; la curva e' colorata per intensita' di
// pendenza (blu in discesa, verdi in pianura, giallo/arancio/rosso in salita).

import { buildProfile, bandIndex, bandColor, SLOPE_BANDS } from "./elevation.js";
import { uiScale } from "./ui-scale.js";

const FONT = "-apple-system, system-ui, sans-serif";
const PAD_LEFT = 42;
const PAD_RIGHT = 10;
const TITLE_H = 18;
const LEGEND_H = 16;
const BOTTOM_H = 16;

const DEFAULT_WINDOW_M = 50;
const MIN_WINDOW_M = 5;
const MAX_WINDOW_M = 50000;

export class SlopeChart {
  constructor(canvas, windowM = DEFAULT_WINDOW_M) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.windowM = windowM;
    this.route = null;
    this.profile = null;
    this.distance = 0;
    this.slopePct = 0;
    this.onSeek = null;
    this._w = 0;
    this._h = 0;
    this._plot = null;
    this._pointerId = null;
    this._seekRaf = 0;
    this._pendingSeek = null;
    this.bindPointer();
    this.resize();
  }

  setRoute(route) {
    this.route = route || null;
    this.profile = this.route
      ? buildProfile(this.route, this._profileSamples())
      : null;
    this.distance = 0;
    this.draw();
  }

  _profileSamples() {
    if (!this.route) return 2;
    return Math.max(2400, Math.min(30000, Math.ceil(this.route.totalDistance / 2)));
  }

  setWindowM(windowM) {
    const m = Number(windowM);
    if (!Number.isFinite(m)) return;
    this.windowM = Math.max(MIN_WINDOW_M, Math.min(MAX_WINDOW_M, m));
    this.draw();
  }

  clear() {
    this.setRoute(null);
  }

  setPosition(d, slopePct) {
    if (Number.isFinite(d)) this.distance = d;
    if (Number.isFinite(slopePct)) this.slopePct = slopePct;
    this.draw();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._w = rect.width;
    this._h = rect.height;
    if (this.route) {
      this.profile = buildProfile(this.route, this._profileSamples());
    }
    this.draw();
  }

  _elevationAt(d) {
    const prof = this.profile;
    if (!prof || prof.total <= 0) return null;
    const dd = Math.min(prof.total, Math.max(0, d));
    const f = prof.step > 0 ? dd / prof.step : 0;
    const i0 = Math.min(prof.n - 1, Math.max(0, Math.floor(f)));
    const i1 = Math.min(prof.n - 1, i0 + 1);
    const fr = f - i0;
    return prof.ele[i0] + (prof.ele[i1] - prof.ele[i0]) * fr;
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this._w || !this._h) this.resize();
    const W = this._w;
    const H = this._h;
    this._plot = null;
    ctx.clearRect(0, 0, W, H);
    ctx.textBaseline = "alphabetic";

    // Panel
    ctx.fillStyle = "rgba(10,15,30,0.9)";
    this._roundRect(ctx, 0, 0, W, H, 6);
    ctx.fill();

    // Title + zoom
    ctx.textAlign = "left";
    ctx.fillStyle = "#9696a0";
    ctx.font = `${uiScale.px(11)}px ${FONT}`;
    ctx.fillText("Altimetria", 10, 15);
    ctx.font = `${uiScale.px(9)}px ${FONT}`;
    ctx.fillStyle = "rgba(150,150,160,0.7)";
    ctx.fillText(this._windowLabel(), 60, 15);

    // Colour scale (no percentages: only descent / climb)
    this._drawScale(ctx, PAD_LEFT + 34, TITLE_H + 4, W - PAD_RIGHT - 116, 5);

    const p = {
      x0: PAD_LEFT,
      y0: TITLE_H + LEGEND_H + 2,
      x1: W - PAD_RIGHT,
      y1: H - BOTTOM_H,
    };
    if (p.x1 - p.x0 < 20 || p.y1 - p.y0 < 20) return;

    const prof = this.profile;
    if (!prof || prof.total <= 0) {
      ctx.fillStyle = "#6a6a78";
      ctx.font = `${uiScale.px(12)}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText("Zoom dell'altimetria — carica un GPX", W / 2, (p.y0 + p.y1) / 2 + 4);
      return;
    }

    // Current elevation (right side of the title row)
    const curEle = this.route
      ? this.route.elevationAt(this.distance)
      : this._elevationAt(this.distance);
    if (curEle !== null) {
      ctx.textAlign = "right";
      ctx.font = `bold ${uiScale.px(13)}px ${FONT}`;
      ctx.fillStyle = "#ffffff";
      ctx.fillText(`${Math.round(curEle)} m`, W - 10, 15);
    }

    // Window of the route around the rider
    const total = prof.total;
    const d0 = Math.max(0, this.distance - this.windowM);
    const d1 = Math.min(total, this.distance + this.windowM);
    if (d1 - d0 <= 0) return;
    this._plot = { x0: p.x0, x1: p.x1, y0: p.y0, y1: p.y1, d0, d1 };

    const cols = Math.max(2, Math.ceil(p.x1 - p.x0) + 1);
    const dist = new Float64Array(cols);
    const raw = new Float64Array(cols);
    for (let i = 0; i < cols; i++) {
      const d = d0 + (i / (cols - 1)) * (d1 - d0);
      dist[i] = d;
      raw[i] = this._elevationAt(d) ?? 0;
    }

    // Smooth the visible elevation with a window proportional to the zoom,
    // then derive the slope from the very same curve that is drawn. In this
    // way two sections with the same visible steepness always get the same
    // colour, and a colour can never imply a slope different from the line.
    const ds = (d1 - d0) / (cols - 1);
    const halfWinM = Math.max(1, Math.min(60, (d1 - d0) * 0.03));
    const k = Math.max(1, Math.round(halfWinM / Math.max(ds, 1e-9)));
    const pre = new Float64Array(cols + 1);
    for (let i = 0; i < cols; i++) pre[i + 1] = pre[i] + raw[i];
    const ele = new Float64Array(cols);
    for (let i = 0; i < cols; i++) {
      const a = Math.max(0, i - k);
      const b = Math.min(cols - 1, i + k);
      ele[i] = (pre[b + 1] - pre[a]) / (b - a + 1);
    }
    const slp = new Float64Array(cols);
    for (let i = 0; i < cols - 1; i++) {
      const dd = dist[i + 1] - dist[i];
      slp[i] = dd > 0 ? ((ele[i + 1] - ele[i]) / dd) * 100 : 0;
    }
    slp[cols - 1] = slp[cols - 2];

    let minE = Infinity;
    let maxE = -Infinity;
    for (let i = 0; i < cols; i++) {
      if (ele[i] < minE) minE = ele[i];
      if (ele[i] > maxE) maxE = ele[i];
    }
    if (!(maxE > minE)) maxE = minE + 1;
    const padE = (maxE - minE) * 0.15;
    const eMin = minE - padE;
    const eMax = maxE + padE;
    const xOf = (i) => p.x0 + (p.x1 - p.x0) * (i / (cols - 1));
    const yOf = (e) => p.y1 - ((e - eMin) / (eMax - eMin)) * (p.y1 - p.y0);

    // Grid
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x0, p.y0 + 0.5);
    ctx.lineTo(p.x1, p.y0 + 0.5);
    ctx.moveTo(p.x0, p.y1 + 0.5);
    ctx.lineTo(p.x1, p.y1 + 0.5);
    ctx.stroke();

    // Coloured profile: each drawn segment takes the colour of its own
    // slope, so the mapping colour <-> visible gradient is exact.
    const fillRun = (a, b) => {
      ctx.beginPath();
      ctx.moveTo(xOf(a), p.y1 + 1);
      for (let j = a; j <= b; j++) ctx.lineTo(xOf(j), yOf(ele[j]));
      ctx.lineTo(xOf(b), p.y1 + 1);
      ctx.closePath();
      ctx.fillStyle = SLOPE_BANDS[bandIndex(slp[a])].color;
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
    };
    let run = 0;
    for (let i = 1; i < cols; i++) {
      if (bandIndex(slp[i]) !== bandIndex(slp[run])) {
        fillRun(run, i);
        run = i;
      }
    }
    fillRun(run, cols - 1);

    // Outline
    ctx.beginPath();
    for (let i = 0; i < cols; i++) {
      const x = xOf(i);
      const y = yOf(ele[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Elevation scale (left gutter): metres, never negative
    ctx.font = `${uiScale.px(9)}px ${FONT}`;
    ctx.fillStyle = "rgba(160,160,175,0.95)";
    ctx.textAlign = "right";
    ctx.fillText(`${Math.round(maxE)} m`, PAD_LEFT - 6, p.y0 + 9);
    ctx.fillText(`${Math.round(minE)} m`, PAD_LEFT - 6, p.y1 - 2);

    // Rider position
    const t = (this.distance - d0) / (d1 - d0);
    const rx = p.x0 + Math.min(1, Math.max(0, t)) * (p.x1 - p.x0);
    const ri = Math.min(cols - 1, Math.max(0, Math.round(Math.min(1, Math.max(0, t)) * (cols - 1))));
    const ry = yOf(ele[ri]);

    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rx + 0.5, p.y0);
    ctx.lineTo(rx + 0.5, p.y1);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.shadowColor = "rgba(255,255,255,0.9)";
    ctx.shadowBlur = 7;
    ctx.beginPath();
    ctx.arc(rx, ry, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.restore();
    const localSlope = slp[ri];
    ctx.beginPath();
    ctx.arc(rx, ry, 4.5, 0, Math.PI * 2);
    ctx.strokeStyle = bandColor(localSlope);
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Numeric readout using the same slope as the colour of the curve:
    // this makes the colour <-> slope mapping directly verifiable.
    const lbl =
      `${Math.round(ele[ri])} m · ${localSlope >= 0 ? "+" : ""}` +
      `${localSlope.toFixed(1)}%`;
    ctx.font = `bold ${uiScale.px(10)}px ${FONT}`;
    const tw = ctx.measureText(lbl).width;
    const lw = tw + 12;
    const lh = 15;
    const lx = Math.min(Math.max(rx, p.x0 + lw / 2), p.x1 - lw / 2) - lw / 2;
    let ly = ry - 22;
    if (ly < p.y0 + 2) ly = ry + 8;
    ctx.fillStyle = "rgba(0,0,0,0.75)";
    this._roundRect(ctx, lx, ly, lw, lh, 7);
    ctx.fill();
    ctx.strokeStyle = bandColor(localSlope);
    ctx.lineWidth = 1;
    this._roundRect(ctx, lx, ly, lw, lh, 7);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.fillText(lbl, lx + lw / 2, ly + 11);

    // Distance axis, relative to the rider
    ctx.font = `${uiScale.px(9)}px ${FONT}`;
    ctx.fillStyle = "rgba(160,160,175,0.95)";
    ctx.textAlign = "center";
    const stepM = this._tickStepM();
    const meters = this.windowM < 1000;
    const first = -Math.floor(this.windowM / stepM) * stepM;
    for (let k = first; k <= this.windowM; k += stepM) {
      const d = this.distance + k;
      if (d < d0 - 1 || d > d1 + 1) continue;
      const x = p.x0 + ((d - d0) / (d1 - d0)) * (p.x1 - p.x0);
      const label =
        k === 0
          ? "0"
          : meters
            ? `${k > 0 ? "+" : ""}${Math.round(k)} m`
            : `${k > 0 ? "+" : ""}${Number.isInteger(k / 1000) ? (k / 1000).toFixed(0) : (k / 1000).toFixed(1)}`;
      if (x < p.x0 + 20) {
        ctx.textAlign = "left";
        ctx.fillText(label, p.x0, H - 5);
      } else if (x > p.x1 - 20) {
        ctx.textAlign = "right";
        ctx.fillText(label, p.x1, H - 5);
      } else {
        ctx.textAlign = "center";
        ctx.fillText(label, x, H - 5);
      }
    }
    ctx.textAlign = "left";
  }

  _windowLabel() {
    const m = this.windowM;
    if (m < 1000) return `zoom ±${Math.round(m)} m`;
    const km = m / 1000;
    return `zoom ±${Number.isInteger(km) ? km.toFixed(0) : km.toFixed(1)} km`;
  }

  _tickStepM() {
    const maxIntervals = this.windowM >= 1000 ? 3 : 2;
    const steps = [
      5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000,
      20000, 25000, 50000,
    ];
    for (const s of steps) if (this.windowM / s <= maxIntervals) return s;
    return 50000;
  }

  _distanceAtPointer(e) {
    const p = this._plot;
    if (!p || !this.route) return null;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const insideY = y >= p.y0 - 6 && y <= p.y1 + 6;
    if (!insideY) return null;
    const insideX = x >= p.x0 - 6 && x <= p.x1 + 6;
    if (!insideX && this._pointerId === null) return null;
    const t = Math.min(1, Math.max(0, (x - p.x0) / (p.x1 - p.x0)));
    return p.d0 + t * (p.d1 - p.d0);
  }

  _queueSeek(e) {
    const d = this._distanceAtPointer(e);
    if (d === null) return;
    this._pendingSeek = d;
    if (this._seekRaf) return;
    this._seekRaf = requestAnimationFrame(() => {
      this._seekRaf = 0;
      const dd = this._pendingSeek;
      if (dd === null) return;
      this.setPosition(dd);
      if (this.onSeek) this.onSeek(dd);
    });
  }

  bindPointer() {
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      if (this._distanceAtPointer(e) === null) return;
      e.preventDefault();
      this._pointerId = e.pointerId;
      try { c.setPointerCapture?.(e.pointerId); } catch (err) {}
      c.classList.add("dragging");
      this._queueSeek(e);
    });
    c.addEventListener("pointermove", (e) => {
      if (this._pointerId !== e.pointerId) return;
      e.preventDefault();
      this._queueSeek(e);
    });
    const end = (e) => {
      if (this._pointerId !== e.pointerId) return;
      this._pointerId = null;
      c.classList.remove("dragging");
      if (this._pendingSeek !== null) {
        const dd = this._pendingSeek;
        if (this._seekRaf) cancelAnimationFrame(this._seekRaf);
        this._seekRaf = 0;
        this._pendingSeek = null;
        this.setPosition(dd);
        if (this.onSeek) this.onSeek(dd);
      }
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
  }

  // Discrete colour scale: one block per slope band, exactly the same bands
  // (and thresholds) used to colour the profile. Blues = descent, greens =
  // flat, reds = climb.
  _drawScale(ctx, x, y, w, h) {
    if (w < 10) return;
    const n = SLOPE_BANDS.length;
    const bw = w / n;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = SLOPE_BANDS[i].color;
      ctx.fillRect(x + i * bw, y, bw + 0.5, h);
    }
    ctx.strokeStyle = "rgba(10,15,30,0.65)";
    ctx.lineWidth = 0.5;
    for (let i = 1; i < n; i++) {
      const bx = x + i * bw;
      ctx.beginPath();
      ctx.moveTo(bx, y);
      ctx.lineTo(bx, y + h);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.font = `${uiScale.px(8)}px ${FONT}`;
    ctx.fillStyle = "rgba(150,150,160,0.9)";
    ctx.textAlign = "right";
    ctx.fillText("discesa", x - 5, y + h);
    ctx.textAlign = "left";
    ctx.fillText("salita", x + w + 5, y + h);
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
