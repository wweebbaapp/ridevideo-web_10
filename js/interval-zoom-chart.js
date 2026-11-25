import { formatClock } from "./intervals.js";
import { uiScale } from "./ui-scale.js";

const FONT = "-apple-system, system-ui, sans-serif";
const MIN_WINDOW = 5;
const MAX_WINDOW = 50000;

function windowLabel(sec) {
  if (sec >= 600) return `${Math.round(sec / 60)} min`;
  if (sec >= 120) return `${(sec / 60).toFixed(1).replace(".", ",")} min`;
  return `${Math.round(sec)} s`;
}

export class IntervalZoomChart {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext("2d") : null;
    this.plan = null;
    this.windowSec = 50;
    this.t = 0;
    this.live = {};
    this.trace = [];
    this._lastT = null;
    this._w = 0;
    this._h = 0;
    this.resize();
  }

  setPlan(plan) {
    this.plan = plan || null;
    this.trace = [];
    this._lastT = null;
    this.t = 0;
    this.live = {};
    this.draw();
  }

  setWindowM(windowM) {
    const m = Number(windowM);
    if (!Number.isFinite(m)) return;
    this.windowSec = Math.max(MIN_WINDOW, Math.min(MAX_WINDOW, m));
    this.draw();
  }

  setElapsed(seconds) {
    if (!Number.isFinite(seconds)) return;
    this.t = Math.max(0, seconds);
    this.draw();
  }

  setLive(data) {
    const d = data || {};
    this.live = { ...this.live, ...d };
    if (Number.isFinite(d.t)) this.t = d.t;
    if (Number.isFinite(d.t) && Number.isFinite(d.powerW) && d.powerW >= 0) {
      if (this._lastT === null || d.t >= this._lastT + 0.5) {
        this._lastT = d.t;
        this.trace.push({ t: d.t, w: d.powerW });
        if (this.trace.length > 4000) this.trace.shift();
      }
    }
    this.draw();
  }

  resize() {
    if (!this.canvas || !this.ctx) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (rect.width < 2 || rect.height < 2) return;
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._w = rect.width;
    this._h = rect.height;
    this.draw();
  }

  draw() {
    const ctx = this.ctx;
    const W = this._w;
    const H = this._h;
    if (!ctx || W < 40 || H < 40) return;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(10,15,30,0.92)";
    this._roundRect(ctx, 0, 0, W, H, 6);
    ctx.fill();

    const left = uiScale.line(42);
    const right = uiScale.line(10);
    const top = uiScale.line(34);
    const bottom = uiScale.line(18);
    const x0 = left;
    const x1 = W - right;
    const y0 = top;
    const y1 = H - bottom;

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillStyle = "#d8dbe8";
    ctx.font = `bold ${uiScale.px(12)}px ${FONT}`;
    ctx.fillText("Zoom profilo", uiScale.line(10), uiScale.line(15));
    ctx.fillStyle = "#7bd88f";
    ctx.font = `bold ${uiScale.px(12)}px ${FONT}`;
    ctx.textAlign = "right";
    ctx.fillText(`±${windowLabel(this.windowSec)}`, x1, uiScale.line(15));
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(150,150,160,0.8)";
    ctx.font = `${uiScale.px(9)}px ${FONT}`;
    ctx.fillText("potenza reale · target · Altimetria ±", uiScale.line(10), uiScale.line(27));

    const plan = this.plan;
    if (!plan || !plan.phases.length || plan.totalSec <= 0) {
      ctx.fillStyle = "#7f8aa3";
      ctx.font = `${uiScale.px(11)}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText("Configura l'allenamento per vedere lo zoom", W / 2, (y0 + y1) / 2);
      ctx.textAlign = "left";
      return;
    }
    if (x1 - x0 < 20 || y1 - y0 < 20) return;

    const total = plan.totalSec;
    const half = Math.max(1, Math.min(this.windowSec, total));
    let t0 = Math.max(0, this.t - half);
    let t1 = Math.min(total, this.t + half);
    if (t1 - t0 < half) {
      if (t0 <= 0) t1 = Math.min(total, t0 + 2 * half);
      else t0 = Math.max(0, t1 - 2 * half);
    }
    if (t1 <= t0) {
      t0 = 0;
      t1 = total;
    }
    const span = Math.max(1, t1 - t0);
    const xOf = (t) => x0 + ((Math.min(t1, Math.max(t0, t)) - t0) / span) * (x1 - x0);

    const ftpW = plan.ftpW || (plan.config && plan.config.ftpW) || 200;
    let maxW = ftpW * 1.15;
    for (const p of plan.phases) {
      if (p.end < t0 || p.start > t1) continue;
      maxW = Math.max(maxW, p.targetW * 1.1);
    }
    for (const s of this.trace) {
      if (s.t < t0 || s.t > t1) continue;
      maxW = Math.max(maxW, s.w * 1.1);
    }
    maxW = Math.max(50, maxW);
    const yOf = (w) => y1 - (Math.min(maxW, Math.max(0, w)) / maxW) * (y1 - y0);

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 2; i++) {
      const y = y0 + ((y1 - y0) * i) / 2;
      ctx.moveTo(x0, y + 0.5);
      ctx.lineTo(x1, y + 0.5);
    }
    ctx.stroke();
    ctx.restore();

    const ftpY = yOf(ftpW);
    ctx.save();
    ctx.setLineDash([uiScale.line(4), uiScale.line(4)]);
    ctx.strokeStyle = "rgba(255,226,120,0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, ftpY + 0.5);
    ctx.lineTo(x1, ftpY + 0.5);
    ctx.stroke();
    ctx.restore();

    for (const p of plan.phases) {
      const a = Math.max(t0, p.start);
      const b = Math.min(t1, p.end);
      if (b <= a) continue;
      const xa = xOf(a);
      const xb = xOf(b);
      const yp = yOf(p.targetW);
      const width = Math.max(1, xb - xa);
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = p.color;
      ctx.fillRect(xa, Math.min(yp, y1), width, Math.abs(y1 - yp));
      ctx.globalAlpha = 1;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = uiScale.line(2);
      ctx.beginPath();
      ctx.moveTo(xa, yp);
      ctx.lineTo(xb, yp);
      ctx.stroke();
    }

    const visible = this.trace.filter((s) => s.t >= t0 - 0.5 && s.t <= t1 + 0.5);
    if (visible.length > 1) {
      const stride = Math.max(1, Math.ceil(visible.length / Math.max(2, x1 - x0)));
      ctx.save();
      ctx.strokeStyle = "#eaffea";
      ctx.lineWidth = uiScale.line(2.4);
      ctx.shadowColor = "rgba(180,255,180,0.6)";
      ctx.shadowBlur = 5;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < visible.length; i += stride) {
        const s = visible[i];
        const x = xOf(s.t);
        const y = yOf(s.w);
        if (started) ctx.lineTo(x, y);
        else {
          ctx.moveTo(x, y);
          started = true;
        }
      }
      const last = visible[visible.length - 1];
      if (last) ctx.lineTo(xOf(last.t), yOf(last.w));
      ctx.stroke();
      ctx.restore();
    }

    ctx.textAlign = "right";
    ctx.font = `${uiScale.px(9)}px ${FONT}`;
    ctx.fillStyle = "rgba(160,168,188,0.95)";
    ctx.fillText(`${Math.round(maxW)} W`, x0 - uiScale.line(5), y0 + uiScale.line(8));
    ctx.fillStyle = "rgba(255,226,120,0.95)";
    ctx.fillText(`${Math.round(ftpW)} FTP`, x0 - uiScale.line(5), ftpY + uiScale.line(3));
    ctx.fillStyle = "rgba(160,168,188,0.95)";
    ctx.fillText("0", x0 - uiScale.line(5), y1);

    const actual = this.live.powerW;
    const target = this.live.targetW;
    ctx.textAlign = "right";
    ctx.font = `bold ${uiScale.px(12)}px ${FONT}`;
    if (Number.isFinite(target)) {
      ctx.fillStyle = "#ffd166";
      ctx.fillText(`target ${Math.round(target)} W`, x1 - uiScale.line(4), y0 + uiScale.line(13));
    }
    if (Number.isFinite(actual)) {
      ctx.fillStyle = "#a8ffbd";
      ctx.fillText(`reale ${Math.round(actual)} W`, x1 - uiScale.line(4), y0 + uiScale.line(28));
    }

    ctx.textAlign = "center";
    ctx.font = `${uiScale.px(9)}px ${FONT}`;
    ctx.fillStyle = "rgba(160,168,188,0.9)";
    for (let i = 0; i <= 4; i++) {
      const t = t0 + (span * i) / 4;
      const x = xOf(t);
      if (i === 0) ctx.textAlign = "left";
      else if (i === 4) ctx.textAlign = "right";
      else ctx.textAlign = "center";
      ctx.fillText(formatClock(t), x, H - uiScale.line(5));
    }

    const px = xOf(Math.min(total, this.t));
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 2;
    ctx.shadowColor = "rgba(255,255,255,0.8)";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(px, y0);
    ctx.lineTo(px, y1);
    ctx.stroke();
    ctx.restore();

    ctx.textAlign = "left";
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
