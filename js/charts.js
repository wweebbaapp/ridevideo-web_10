// Real-time line charts on <canvas>. No external library.

import { uiScale } from "./ui-scale.js";

export class RideChart {
  constructor(canvas, title, unit, color, maxPoints = 600) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.title = title;
    this.unit = unit;
    this.color = color;
    this.values = [];
    this.maxPoints = maxPoints;
    this.maxValue = 1.0;
    this._resize();
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._w = rect.width;
    this._h = rect.height;
  }

  addValue(v) {
    this.values.push(v);
    if (this.values.length > this.maxPoints) this.values.shift();
    if (v > this.maxValue) this.maxValue = v * 1.1;
    this.draw();
  }

  clear() {
    this.values = [];
    this.maxValue = 1.0;
    this.draw();
  }

  get current() {
    return this.values.length ? this.values[this.values.length - 1] : 0;
  }

  draw() {
    const ctx = this.ctx;
    const w = this._w;
    const h = this._h;
    if (ctx && !w) this._resize();
    const W = this._w;
    const H = this._h;

    // Background
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(10,15,30,0.9)";
    this._roundRect(ctx, 0, 0, W, H, 6);
    ctx.fill();

    // Title
    ctx.fillStyle = "#9696a0";
    ctx.font = `${uiScale.px(11)}px -apple-system, system-ui, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(this.title, 10, 16);

    // Current value
    ctx.fillStyle = this.color;
    ctx.font = `bold ${uiScale.px(13)}px -apple-system, system-ui, sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText(`${Math.round(this.current)} ${this.unit}`, W - 10, 16);

    const ml = uiScale.line(6), mr = uiScale.line(6);
    const mt = uiScale.line(24), mb = uiScale.line(6);
    const cw = W - ml - mr;
    const ch = H - mt - mb;
    if (cw <= 1 || ch <= 1 || this.values.length < 2) return;

    const vmax = Math.max(this.maxValue, 1.0);
    const n = this.values.length;
    const step = cw / (n - 1);

    // Fill
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = ml + i * step;
      const y = mt + ch * (1 - Math.min(1, this.values[i] / vmax));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(ml + (n - 1) * step, mt + ch);
    ctx.lineTo(ml, mt + ch);
    ctx.closePath();
    ctx.fillStyle = this._alpha(this.color, 0.18);
    ctx.fill();

    // Line
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = ml + i * step;
      const y = mt + ch * (1 - Math.min(1, this.values[i] / vmax));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2;
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

  _alpha(hex, a) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
}
