// HUD overlay drawn on a canvas positioned above the video.
// The text size is adjustable at runtime (buttons A+ / A-): every value is
// drawn with the current scale and the boxes are measured, so nothing is
// clipped or overlapped when the text gets bigger.

const FONT = "-apple-system, system-ui, sans-serif";

export const MIN_SCALE = 0.8;
export const MAX_SCALE = 2.2;
export const DEFAULT_SCALE = 1.25;

export class Hud {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.scale = DEFAULT_SCALE;
    this.data = {
      speedKmh: 0,
      powerW: 0,
      cadenceRpm: 0,
      heartRate: 0,
      distanceKm: 0,
      ascentM: 0,
      totalAscentM: 0,
      slopePct: 0,
      slopeMax: false,
      calories: 0,
      elapsed: 0,
      totalDistanceKm: 0,
    };
    this.resize();
  }

  // Change the text size. Returns the effective (clamped) scale.
  setScale(v) {
    const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(v * 20) / 20));
    this.scale = s;
    this.draw();
    return s;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._w = rect.width;
    this._h = rect.height;
    this.draw();
  }

  set(data) {
    Object.assign(this.data, data);
    this.draw();
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this._w || !this._h) this.resize();
    const W = this._w;
    const H = this._h;
    ctx.clearRect(0, 0, W, H);
    const d = this.data;

    // ------------------------------------------------------------ rows
    const t = Math.max(0, Math.floor(d.elapsed));
    const hh = String(Math.floor(t / 3600)).padStart(2, "0");
    const mm = String(Math.floor((t % 3600) / 60)).padStart(2, "0");
    const ss = String(t % 60).padStart(2, "0");
    const remainingKm = Math.max(0, d.totalDistanceKm - d.distanceKm);

    const topRows = [
      { value: d.speedKmh.toFixed(1), label: "km/h", color: "#ffffff", base: 30 },
      { value: Math.round(d.powerW).toString(), label: "W", color: "#ffc832", base: 20 },
      { value: Math.round(d.cadenceRpm).toString(), label: "rpm", color: "#64c8ff", base: 20 },
    ];
    // Slope lives in the top-right block so it is always visible, even when
    // the text is enlarged and the bottom rows have to be trimmed.
    const slopeRow = {
      value: (d.slopePct >= 0 ? "+" : "") + d.slopePct.toFixed(1),
      label: "% pendenza",
      color: d.slopePct >= 0 ? "#ffb450" : "#64c8ff",
      badge: d.slopeMax ? "max" : "",
      base: 26,
    };
    const ascentRow = {
      value: `${Math.round(d.ascentM)} m / ${Math.round(d.totalAscentM)} m`,
      label: "dislivello",
      color: "#b4ffb4",
      base: 20,
    };
    const topRightRows = [slopeRow, ascentRow];
    const bottomRows = [
      { value: d.distanceKm.toFixed(2), label: "km percorsi", color: "#ffffff", base: 20 },
      { value: remainingKm.toFixed(2), label: "km rimanenti", color: "#9fe6ff", base: 20 },
    ];
    const timeRows = [
      { value: `${hh}:${mm}:${ss}`, label: "allenamento", color: "#ffffff", base: 20 },
    ];
    const caloriesRow = {
      value: Math.round(d.calories).toString(),
      label: "kcal",
      color: "#ff9f43",
      base: 20,
    };
    const bottomRightRows = [caloriesRow, ...timeRows];

    // ------------------------------------------------------------ fit
    const sizeOf = (base, sc) => Math.max(11, Math.round(base * sc));
    const gapOf = (sc) => Math.max(6, Math.round(9 * sc));
    const labelOf = (sc) => Math.max(11, Math.round(12 * sc));
    const badgeOf = (sc) => Math.max(9, Math.round(10 * sc));
    const measure = (rows, sc) => {
      let w = 0;
      for (const r of rows) {
        const vw = this._textWidth(r.value, sizeOf(r.base, sc), "bold");
        const lw = this._textWidth(r.label, labelOf(sc), "normal");
        const bw = r.badge ? this._textWidth(r.badge, badgeOf(sc), "bold") + 6 : 0;
        w = Math.max(w, vw + 8 + lw + bw);
      }
      const gap = gapOf(sc);
      const h = 20 + rows.reduce((a, r) => a + sizeOf(r.base, sc) + gap, 0) - gap;
      return { w: w + 28, h };
    };

    let s = this.scale;
    let bottomCount = bottomRows.length;
    const fits = (sc, cnt) => {
      const top = measure(topRows, sc);
      const bot = measure(bottomRows.slice(0, cnt), sc);
      const leftW = Math.max(top.w, bot.w);
      const tr = measure(topRightRows, sc);
      const br = measure(bottomRightRows, sc);
      return (
        top.h + bot.h + 32 <= H &&
        tr.h + br.h + 32 <= H &&
        leftW + tr.w + 48 <= W &&
        leftW + br.w + 48 <= W
      );
    };
    while (bottomCount > 2 && !fits(s, bottomCount)) bottomCount--;
    let guard = 0;
    while (!fits(s, bottomCount) && s > 0.85 && guard++ < 80) {
      s = Math.round((s - 0.05) * 100) / 100;
    }
    const bottom = bottomRows.slice(0, bottomCount);

    // ------------------------------------------------------------ paint
    const gap = gapOf(s);
    const labelSize = labelOf(s);
    const padX = 14;
    const padY = 10;

    const paintRows = (rows, x, y) => {
      let cy = y + padY + sizeOf(rows[0].base, s);
      for (const r of rows) {
        const size = sizeOf(r.base, s);
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = r.color;
        ctx.font = `bold ${size}px ${FONT}`;
        ctx.fillText(r.value, x + padX, cy);
        const vw = ctx.measureText(r.value).width;
        ctx.fillStyle = "#c8c8d0";
        ctx.font = `normal ${labelSize}px ${FONT}`;
        ctx.fillText(r.label, x + padX + vw + 8, cy - 2);
        if (r.badge) {
          const lw = ctx.measureText(r.label).width;
          ctx.fillStyle = "#ffb450";
          ctx.font = `bold ${badgeOf(s)}px ${FONT}`;
          ctx.fillText(r.badge, x + padX + vw + 8 + lw + 6, cy - 2);
        }
        cy += size + gap;
      }
    };

    const drawPanel = (x, y, w, h) => {
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      this._roundRect(ctx, x, y, w, h, 10);
      ctx.fill();
    };

    const block = (rows, anchor) => {
      if (!rows.length) return null;
      const m = measure(rows, s);
      const x = anchor.right ? W - 16 - m.w : 16;
      const y = anchor.bottom ? H - 16 - m.h : 16;
      drawPanel(x, y, m.w, m.h);
      paintRows(rows, x, y);
      return { x, y, w: m.w, h: m.h };
    };

    const topM = measure(topRows, s);
    const botM = measure(bottom, s);
    const leftW = Math.max(topM.w, botM.w);
    const leftX = 16;
    const leftY = 16;
    const leftH = H - 32;
    drawPanel(leftX, leftY, leftW, leftH);
    paintRows(topRows, leftX, leftY);
    const bottomY = H - 16 - botM.h;
    paintRows(bottom, leftX, bottomY);

    const rightTop = block(topRightRows, { right: true, bottom: false });
    const rightBottom = block(bottomRightRows, { right: true, bottom: true });

    this.lastLayout = {
      scale: s,
      left: { x: leftX, y: leftY, w: leftW, h: leftH },
      leftTop: { x: leftX, y: leftY, w: topM.w, h: topM.h },
      leftBottom: { x: leftX, y: bottomY, w: botM.w, h: botM.h },
      rightTop,
      rightBottom,
    };

    // Progress bar
    const barX = 16;
    const barY = H - 12;
    const barW = W - 32;
    const barH = 6;
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    this._roundRect(ctx, barX, barY, barW, barH, 3);
    ctx.fill();
    if (d.totalDistanceKm > 0) {
      const p = Math.min(1, d.distanceKm / d.totalDistanceKm);
      ctx.fillStyle = "#64c8ff";
      this._roundRect(ctx, barX, barY, Math.max(barH, barW * p), barH, 3);
      ctx.fill();
    }
  }

  _textWidth(text, size, weight) {
    const ctx = this.ctx;
    const prev = ctx.font;
    ctx.font = `${weight} ${size}px ${FONT}`;
    const w = ctx.measureText(text).width;
    ctx.font = prev;
    return w;
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
