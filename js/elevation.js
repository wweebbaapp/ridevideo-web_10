// Altimetria: full-route elevation profile with a live position marker.
// Colored by gradient category. Plain <canvas>, no external library.

import { uiScale } from "./ui-scale.js";

// Single source of truth for the slope colours. Every view (full elevation
// profile, zoom profile, rider marker) uses the same bands, so a given slope
// always has the same colour everywhere. `max` is the upper bound of the band.
export const SLOPE_BANDS = [
  { max: -12, color: "#0b3fa8", label: "< -12%" },
  { max: -8, color: "#1357d6", label: "-12% / -8%" },
  { max: -5, color: "#1f7ff0", label: "-8% / -5%" },
  { max: -2.5, color: "#4aa9f5", label: "-5% / -2,5%" },
  { max: -1.5, color: "#8fd0ff", label: "-2,5% / -1,5%" },
  { max: 1.5, color: "#3fa06b", label: "pianura" },
  { max: 3, color: "#e0d44a", label: "+1,5% / +3%" },
  { max: 5, color: "#f5b642", label: "+3% / +5%" },
  { max: 7, color: "#f98a2e", label: "+5% / +7%" },
  { max: 9, color: "#f4552a", label: "+7% / +9%" },
  { max: 12, color: "#e32a25", label: "+9% / +12%" },
  { max: Infinity, color: "#a70f1e", label: "> +12%" },
];

// Index of the graded band a given slope belongs to.
export function bandIndex(slope) {
  for (let i = 0; i < SLOPE_BANDS.length; i++) {
    if (slope < SLOPE_BANDS[i].max) return i;
  }
  return SLOPE_BANDS.length - 1;
}

export function bandColor(slope) {
  return SLOPE_BANDS[bandIndex(slope)].color;
}

// Uniform samples of the whole route: elevation + slope. The GPX slope is
// already smoothed, so by default no extra smoothing is applied: the colour
// therefore matches the slope value shown by the HUD.
export function buildProfile(route, n, colorWindowM = 0) {
  const N = Math.max(2, Math.round(n));
  const total = Math.max(0, route.totalDistance);
  const step = total / (N - 1);
  const ele = new Float64Array(N);
  const raw = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const d = i * step;
    ele[i] = route.elevationAt(d);
    raw[i] = route.slopeAt(d);
  }
  const win =
    step > 0 ? Math.min(64, Math.max(1, Math.round(colorWindowM / step))) : 1;
  const slope = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = Math.max(0, i - win);
    const b = Math.min(N - 1, i + win);
    let s = 0;
    for (let j = a; j <= b; j++) s += raw[j];
    slope[i] = s / (b - a + 1);
  }
  let minEle = Infinity;
  let maxEle = -Infinity;
  for (let i = 0; i < N; i++) {
    if (ele[i] < minEle) minEle = ele[i];
    if (ele[i] > maxEle) maxEle = ele[i];
  }
  if (!(maxEle > minEle)) maxEle = minEle + 1;
  return { n: N, ele, slope, total, step, minEle, maxEle };
}

function tickStep(totalKm) {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  for (const s of steps) if (totalKm / s <= 8) return s;
  return Math.ceil(totalKm / 8);
}

const PAD_X = 10;
const PAD_LEFT = 44;
const TOP_H = 22;
const BOTTOM_H = 17;
const FONT = "-apple-system, system-ui, sans-serif";

export class ElevationProfile {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.route = null;
    this.profile = null;
    this.distance = 0;
    this.onSeek = null;
    this._w = 0;
    this._h = 0;
    this._plot = null;
    this._pointerId = null;
    this._seekRaf = 0;
    this._pendingSeek = null;
    this._bg = document.createElement("canvas");
    this._bctx = this._bg.getContext("2d");
    this.bindPointer();
    this.resize();
  }

  setRoute(route) {
    this.route = route || null;
    this.profile = this.route ? buildProfile(this.route, this._samples()) : null;
    this.distance = 0;
    this._renderBg();
    this.draw();
  }

  clear() {
    this.setRoute(null);
  }

  setPosition(d) {
    if (!Number.isFinite(d)) return;
    this.distance = d;
    this.draw();
  }

  _distanceAtPointer(e) {
    const p = this._plot;
    if (!p || !this.profile || this.profile.total <= 0) return null;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const insideY = y >= p.y0 - 6 && y <= p.y1 + 6;
    if (!insideY) return null;
    const insideX = x >= p.x0 - 6 && x <= p.x1 + 6;
    if (!insideX && this._pointerId === null) return null;
    const t = Math.min(1, Math.max(0, (x - p.x0) / (p.x1 - p.x0)));
    return t * this.profile.total;
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

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    this.canvas.width = w;
    this.canvas.height = h;
    this._bg.width = w;
    this._bg.height = h;
    this._dpr = dpr;
    this._w = rect.width;
    this._h = rect.height;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.route) this.profile = buildProfile(this.route, this._samples());
    this._renderBg();
    this.draw();
  }

  _samples() {
    return Math.max(400, Math.min(2400, Math.round(this._w * 2)));
  }

  // ------------------------------------------------------- static layer

  _renderBg() {
    const ctx = this._bctx;
    const W = this._w;
    const H = this._h;
    this._plot = null;
    if (!ctx || !W || !H) return;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(10,15,30,0.9)";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    this._roundRect(ctx, 0, 0, W, H, 6);
    ctx.fill();

    if (!this.profile || this.profile.total <= 0) {
      ctx.fillStyle = "#6a6a78";
      ctx.font = `${uiScale.px(12)}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText("Altimetria del percorso — carica un GPX", W / 2, H / 2 + 4);
      return;
    }

    const prof = this.profile;
    const p = {
      x0: PAD_LEFT,
      y0: TOP_H + 4,
      x1: W - PAD_X,
      y1: H - BOTTOM_H,
    };
    if (p.x1 - p.x0 < 10 || p.y1 - p.y0 < 10) {
      this._plot = p;
      return;
    }
    this._plot = p;

    const yOf = (ele) =>
      p.y1 - ((ele - prof.minEle) / (prof.maxEle - prof.minEle)) * (p.y1 - p.y0);

    // Title
    ctx.textAlign = "left";
    ctx.fillStyle = "#9696a0";
    ctx.font = `${uiScale.px(11)}px ${FONT}`;
    ctx.fillText("Altimetria", 10, 15);
    const titleEnd = 10 + ctx.measureText("Altimetria").width;

    // Readout space reserved on the right (text itself is drawn live)
    const kmTot = (prof.total / 1000).toFixed(1);
    ctx.font = `${uiScale.px(11)}px ${FONT}`;
    const readoutW = ctx.measureText(`/ ${kmTot} km`).width + 8;

    // Discrete colour scale, only if it fits between title and readout.
    // Same bands as the zoom chart, so colours mean the same everywhere.
    const avail = W - titleEnd - readoutW - 50;
    const scaleW = Math.min(170, Math.max(0, avail * 0.55));
    if (scaleW >= 60) {
      const sx = titleEnd + 20 + Math.max(0, (avail - scaleW) / 2);
      this._drawSlopeScale(ctx, sx, 8, scaleW, 8);
    }

    // Grid
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.beginPath();
    ctx.moveTo(p.x0, p.y0 + 0.5);
    ctx.lineTo(p.x1, p.y0 + 0.5);
    ctx.moveTo(p.x0, p.y1 + 0.5);
    ctx.lineTo(p.x1, p.y1 + 0.5);
    ctx.stroke();

    const totalKm = prof.total / 1000;
    const stepKm = tickStep(totalKm);
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.beginPath();
    for (let km = stepKm; km < totalKm; km += stepKm) {
      const x = p.x0 + (km / totalKm) * (p.x1 - p.x0);
      ctx.moveTo(x + 0.5, p.y0);
      ctx.lineTo(x + 0.5, p.y1);
    }
    ctx.stroke();
    ctx.restore();

    // Colored profile
    const cols = Math.max(2, Math.ceil(p.x1 - p.x0) + 1);
    const N = prof.n;
    const colEle = new Float64Array(cols);
    const colCat = new Uint8Array(cols);
    const xOf = (i) => p.x0 + (p.x1 - p.x0) * (i / (cols - 1));
    for (let i = 0; i < cols; i++) {
      const t = i / (cols - 1);
      const f = t * (N - 1);
      const i0 = Math.floor(f);
      const i1 = Math.min(N - 1, i0 + 1);
      const fr = f - i0;
      colEle[i] = prof.ele[i0] + (prof.ele[i1] - prof.ele[i0]) * fr;
      colCat[i] = bandIndex(prof.slope[Math.min(N - 1, Math.round(f))]);
    }

    let run = 0;
    for (let i = 1; i <= cols; i++) {
      if (i === cols || colCat[i] !== colCat[run]) {
        const a = run;
        const b = i - 1;
        ctx.beginPath();
        ctx.moveTo(xOf(a), p.y1 + 1);
        for (let j = a; j <= b; j++) ctx.lineTo(xOf(j), yOf(colEle[j]));
        ctx.lineTo(xOf(b), p.y1 + 1);
        ctx.closePath();
        ctx.fillStyle = SLOPE_BANDS[colCat[a]].color;
        ctx.globalAlpha = 0.88;
        ctx.fill();
        ctx.globalAlpha = 1;
        run = i;
      }
    }

    // Outline
    ctx.beginPath();
    for (let i = 0; i < cols; i++) {
      const x = xOf(i);
      const y = yOf(colEle[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Elevation scale (left gutter)
    ctx.font = `${uiScale.px(9)}px ${FONT}`;
    ctx.fillStyle = "rgba(160,160,175,0.95)";
    ctx.textAlign = "right";
    ctx.fillText(`${Math.round(prof.maxEle)} m`, PAD_LEFT - 6, p.y0 + 9);
    ctx.fillText(`${Math.round(prof.minEle)} m`, PAD_LEFT - 6, p.y1 - 2);

    // Kilometre scale (bottom)
    ctx.textAlign = "center";
    for (let km = 0; km <= totalKm + 1e-6; km += stepKm) {
      const x = p.x0 + (km / totalKm) * (p.x1 - p.x0);
      ctx.fillStyle = "rgba(160,160,175,0.95)";
      const label = stepKm < 1 ? km.toFixed(1) : String(Math.round(km));
      if (km <= 1e-6) {
        ctx.textAlign = "left";
        ctx.fillText(label, p.x0, H - 5);
        ctx.textAlign = "center";
      } else if (km + stepKm > totalKm) {
        ctx.textAlign = "right";
        ctx.fillText(label, p.x1, H - 5);
        ctx.textAlign = "center";
      } else {
        ctx.fillText(label, x, H - 5);
      }
    }
    ctx.textAlign = "left";
  }

  _drawSlopeScale(ctx, x, y, w, h) {
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
  }

  // --------------------------------------------------------- live layer

  draw() {
    const ctx = this.ctx;
    if (!ctx || !this._w || !this._h) return;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this._bg, 0, 0);
    ctx.restore();

    const prof = this.profile;
    const p = this._plot;
    if (!prof || !p || prof.total <= 0) return;

    const t = Math.min(1, Math.max(0, this.distance / prof.total));
    const x = p.x0 + t * (p.x1 - p.x0);
    const idx = Math.min(
      prof.n - 1,
      Math.max(0, Math.round(t * (prof.n - 1)))
    );
    const cat = SLOPE_BANDS[bandIndex(prof.slope[idx])];
    const ele = this.route.elevationAt(this.distance);
    const y =
      p.y1 -
      ((ele - prof.minEle) / (prof.maxEle - prof.minEle)) * (p.y1 - p.y0);

    // Live readout (right)
    const kmNow = (this.distance / 1000).toFixed(1);
    const kmTot = (prof.total / 1000).toFixed(1);
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    ctx.font = `${uiScale.px(11)}px ${FONT}`;
    ctx.fillStyle = "#9696a0";
    ctx.fillText(`/ ${kmTot} km`, this._w - 10, 16);
    const tailW = ctx.measureText(`/ ${kmTot} km`).width;
    ctx.font = `bold ${uiScale.px(13)}px ${FONT}`;
    ctx.fillStyle = cat.color;
    ctx.fillText(`${kmNow} km`, this._w - 10 - tailW - 5, 16);

    // Vertical guide
    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, p.y0);
    ctx.lineTo(x + 0.5, p.y1);
    ctx.stroke();
    ctx.restore();

    // Elevation label pill
    const txt = `${Math.round(ele)} m`;
    ctx.font = `bold ${uiScale.px(10)}px ${FONT}`;
    const tw = ctx.measureText(txt).width;
    const lw = tw + 12;
    const lh = 15;
    const lx = Math.min(
      Math.max(x, p.x0 + lw / 2),
      p.x1 - lw / 2
    ) - lw / 2;
    let ly = y - 21;
    if (ly < p.y0 + 2) ly = y + 8;
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    this._roundRect(ctx, lx, ly, lw, lh, 7);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.fillText(txt, lx + lw / 2, ly + 11);

    // Marker dot
    ctx.save();
    ctx.shadowColor = "rgba(255,255,255,0.9)";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.strokeStyle = cat.color;
    ctx.lineWidth = 2.5;
    ctx.stroke();
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
