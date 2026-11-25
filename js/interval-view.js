// Interval training view: full-workout histogram + live countdown HUD.
//
// Bar heights are proportional to %FTP (100% FTP is always on the scale, so a
// 90% repetition and an 80% recovery are almost as tall). A thin dashed line
// marks the FTP threshold and the real rider power is drawn on top of the bars.

import {
  INTERVAL_COLORS,
  formatClock,
  phaseAt,
} from "./intervals.js";
import { uiScale } from "./ui-scale.js";

const FONT = "-apple-system, system-ui, sans-serif";

function byId(id) {
  return typeof document !== "undefined" ? document.getElementById(id) : null;
}

export class IntervalView {
  constructor(canvas, root) {
    this.canvas = canvas;
    this.root = root || byId("intervalView");
    this.ctx = canvas ? canvas.getContext("2d") : null;
    this.plan = null;
    this.elapsed = 0;
    this.live = {};
    this._w = 0;
    this._h = 0;
    this.powerTrace = [];
    this._lastSampleT = null;
    this._alerts = {};
    this._warnSince = {};
    this._currentPhase = null;
    this.els = {
      phase: byId("ivPhase"),
      sub: byId("ivSub"),
      timer: byId("ivTimer"),
      timerLabel: byId("ivTimerLabel"),
      total: byId("ivTotal"),
      phaseFill: byId("ivPhaseFill"),
      next: byId("ivNext"),
      targets: byId("ivTargets"),
      live: byId("ivLive"),
      bigPower: byId("ivBigPower"),
      bigTarget: byId("ivBigTarget"),
      bigRpm: byId("ivBigRpm"),
      bigSlope: byId("ivBigSlope"),
      powerDelta: byId("ivPowerDelta"),
      powerTargetPct: byId("ivPowerTargetPct"),
      rpmTarget: byId("ivRpmTarget"),
      slopeTarget: byId("ivSlopeTarget"),
      powerCard: byId("ivBigPower") ? byId("ivBigPower").closest(".iv-big-stat") : null,
      alert: byId("ivAlert"),
    };
    if (this.root) this.root.style.setProperty("--phase-color", INTERVAL_COLORS.work);
    this._setText(this.els.phase, "INTERVALLI");
    this._setText(this.els.sub, "Configura o avvia l'allenamento");
  }

  setPlan(plan) {
    this.plan = plan || null;
    this.elapsed = 0;
    this.powerTrace = [];
    this._lastSampleT = null;
    this._alerts = {};
    this._warnSince = {};
    this._updateAlert();
    this.resize();
    this._updateHud();
    this.draw();
  }

  setElapsed(seconds) {
    if (!Number.isFinite(seconds)) return;
    this.elapsed = Math.max(0, seconds);
    this._updateHud();
    this._updateAlerts();
    this.draw();
  }

  setLive(data) {
    this.live = { ...this.live, ...(data || {}) };
    const t = this.live.t;
    const w = this.live.powerW;
    if (Number.isFinite(t) && Number.isFinite(w) && w >= 0) {
      if (this._lastSampleT === null || t >= this._lastSampleT + 0.5) {
        this._lastSampleT = t;
        this.powerTrace.push({ t, w });
        if (this.powerTrace.length > 4000) this.powerTrace.shift();
      }
    }
    this._updateLive();
  }

  resize() {
    if (!this.canvas || !this.ctx) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (rect.width < 2 || rect.height < 2) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._w = rect.width;
    this._h = rect.height;
    this.draw();
  }

  refreshLayout() {
    this.resize();
    this._updateHud();
  }

  draw() {
    const ctx = this.ctx;
    const W = this._w;
    const H = this._h;
    if (!ctx || W < 10 || H < 10) return;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(10,15,30,0.72)";
    this._roundRect(ctx, 0, 0, W, H, 10);
    ctx.fill();

    const plan = this.plan;
    if (!plan || !plan.phases.length || plan.totalSec <= 0) {
      ctx.fillStyle = "#7f8aa3";
      ctx.font = `${uiScale.px(13)}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Configura l'allenamento a intervalli per vedere il profilo", W / 2, H / 2);
      return;
    }

    const headerH = uiScale.line(24);
    const labelH = uiScale.line(16);
    const axisH = uiScale.line(18);
    const plotX = uiScale.line(14);
    const plotW = Math.max(10, W - 2 * plotX);
    const plotTop = headerH + labelH;
    const plotBottom = Math.max(plotTop + 8, H - axisH);
    const plotH = plotBottom - plotTop;
    const baseY = plotBottom;
    const total = plan.totalSec;
    const yMax = plan.ftpScaleMax || Math.max(100, plan.config.ftpPct || 90);
    const ftpW = plan.ftpW || plan.config.ftpW || 200;
    const yOfPct = (pct) =>
      baseY - Math.min(1, Math.max(0, pct / yMax)) * plotH;

    // ---------------------------------------------------------- header
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillStyle = "#d8dbe8";
    ctx.font = `bold ${uiScale.px(12)}px ${FONT}`;
    ctx.fillText("Profilo allenamento · potenza reale", plotX, headerH - uiScale.line(8));

    if (W > uiScale.line(620)) this._drawLegend(ctx, W - plotX, uiScale.line(8));

    // ------------------------------------------------------- time grid
    const totalMin = total / 60;
    const stepMin = totalMin <= 35 ? 5 : totalMin <= 75 ? 10 : 15;
    const stepSec = stepMin * 60;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.beginPath();
    for (let t = 0; t <= total + 0.5; t += stepSec) {
      const x = plotX + (t / total) * plotW;
      ctx.moveTo(x + 0.5, plotTop);
      ctx.lineTo(x + 0.5, baseY);
    }
    ctx.stroke();
    ctx.restore();

    // ------------------------------------------------------------- bars
    for (const p of plan.phases) {
      const x0 = plotX + (p.start / total) * plotW;
      const x1 = plotX + (p.end / total) * plotW;
      const w = Math.max(1, x1 - x0 - 0.7);
      const h = Math.max(2, yOfPct(p.ftpPct) === baseY ? 2 : baseY - yOfPct(p.ftpPct));
      const y = baseY - h;
      const done = p.end <= this.elapsed + 1e-6;
      const current =
        this.elapsed >= p.start - 1e-6 && this.elapsed < p.end - 1e-6;

      ctx.globalAlpha = done ? 0.33 : 0.88;
      ctx.fillStyle = p.color;
      ctx.fillRect(x0, y, w, h);

      if (current) {
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 16;
        ctx.fillStyle = p.color;
        ctx.fillRect(x0, y, w, h);
        ctx.restore();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.6;
        ctx.strokeRect(x0 + 0.8, y + 0.8, Math.max(0, w - 1.6), Math.max(0, h - 1.6));
      }
      ctx.globalAlpha = 1;
    }

    // --------------------------------------------- 100% FTP threshold
    const ftpY = yOfPct(100);
    ctx.save();
    ctx.setLineDash([uiScale.line(4), uiScale.line(4)]);
    ctx.strokeStyle = "rgba(255,226,120,0.75)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plotX, ftpY + 0.5);
    ctx.lineTo(plotX + plotW, ftpY + 0.5);
    ctx.stroke();
    ctx.restore();
    ctx.font = `${uiScale.px(9)}px ${FONT}`;
    ctx.fillStyle = "rgba(255,226,120,0.95)";
    ctx.textAlign = "right";
    ctx.fillText(`FTP 100% · ${Math.round(ftpW)} W`, plotX + plotW - 2, ftpY - uiScale.line(3));
    ctx.textAlign = "left";

    // ---------------------------------------------------- real power
    if (this.powerTrace.length > 1) {
      const stride = Math.max(1, Math.ceil(this.powerTrace.length / Math.max(2, plotW)));
      ctx.save();
      ctx.strokeStyle = "#eaffea";
      ctx.lineWidth = uiScale.line(2);
      ctx.shadowColor = "rgba(180,255,180,0.55)";
      ctx.shadowBlur = 5;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < this.powerTrace.length; i += stride) {
        const s = this.powerTrace[i];
        const x = plotX + (Math.min(total, Math.max(0, s.t)) / total) * plotW;
        const y = yOfPct((s.w / ftpW) * 100);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      const last = this.powerTrace[this.powerTrace.length - 1];
      if (last) {
        const x = plotX + (Math.min(total, Math.max(0, last.t)) / total) * plotW;
        ctx.lineTo(x, yOfPct((last.w / ftpW) * 100));
      }
      ctx.stroke();
      ctx.restore();
    }

    // Baseline
    ctx.strokeStyle = "rgba(255,255,255,0.24)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plotX, baseY + 0.5);
    ctx.lineTo(plotX + plotW, baseY + 0.5);
    ctx.stroke();

    // ------------------------------------------------------ series labels
    const segments = [];
    let seg = null;
    for (const p of plan.phases) {
      if (!seg || seg.key !== p.groupKey) {
        if (seg) segments.push(seg);
        seg = {
          key: p.groupKey,
          label: p.groupLabel || p.groupKey,
          start: p.start,
          end: p.end,
        };
      } else {
        seg.end = p.end;
      }
    }
    if (seg) segments.push(seg);

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = `bold ${uiScale.px(10)}px ${FONT}`;
    ctx.fillStyle = "rgba(210,218,238,0.86)";
    let lastCenter = -Infinity;
    for (const s of segments) {
      if (!s.label) continue;
      const sx0 = plotX + (s.start / total) * plotW;
      const sx1 = plotX + (s.end / total) * plotW;
      const sw = sx1 - sx0;
      if (sw < uiScale.line(18)) continue;
      const center = (sx0 + sx1) / 2;
      if (center - lastCenter < uiScale.line(24)) continue;
      ctx.fillText(s.label, center, headerH + uiScale.line(11));
      lastCenter = center;
    }

    // --------------------------------------------------------- axis labels
    ctx.textAlign = "center";
    ctx.font = `${uiScale.px(9)}px ${FONT}`;
    ctx.fillStyle = "rgba(160,168,188,0.9)";
    for (let t = 0; t <= total + 0.5; t += stepSec) {
      const x = plotX + (t / total) * plotW;
      const label = `${Math.round(t / 60)}'`;
      if (t <= 0.5) {
        ctx.textAlign = "left";
        ctx.fillText(label, plotX, H - uiScale.line(5));
        ctx.textAlign = "center";
      } else if (t + stepSec > total + 0.5) {
        ctx.textAlign = "right";
        ctx.fillText(label, plotX + plotW, H - uiScale.line(5));
        ctx.textAlign = "center";
      } else {
        ctx.fillText(label, x, H - uiScale.line(5));
      }
    }

    // ----------------------------------------------------------- playhead
    const tNow = Math.max(0, Math.min(total, this.elapsed));
    const px = plotX + (tNow / total) * plotW;
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 2;
    ctx.shadowColor = "rgba(255,255,255,0.8)";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(px, plotTop - 4);
    ctx.lineTo(px, baseY + 1);
    ctx.stroke();
    ctx.restore();

    const tick = uiScale.line(5);
    ctx.beginPath();
    ctx.moveTo(px, plotTop - tick);
    ctx.lineTo(px - tick, plotTop - 2 * tick);
    ctx.lineTo(px + tick, plotTop - 2 * tick);
    ctx.closePath();
    ctx.fillStyle = "#ffffff";
    ctx.fill();
  }

  _drawLegend(ctx, right, y) {
    const items = [
      { label: "Rip", color: INTERVAL_COLORS.work },
      { label: "Rec", color: INTERVAL_COLORS.recovery },
      { label: "Risc", color: INTERVAL_COLORS.warmup },
      { label: "Prep", color: INTERVAL_COLORS.prepWork },
      { label: "Def", color: INTERVAL_COLORS.cooldown },
      { label: "Reale", color: "#eaffea" },
    ];
    ctx.font = `${uiScale.px(10)}px ${FONT}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const widths = items.map((it) => uiScale.line(8) + 4 + ctx.measureText(it.label).width + 12);
    const totalW = widths.reduce((a, b) => a + b, 0) - 12;
    let x = right - totalW;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const midY = y + uiScale.line(7);
      ctx.fillStyle = it.color;
      ctx.fillRect(x, midY - 4, uiScale.line(8), uiScale.line(8));
      ctx.fillStyle = "rgba(210,218,238,0.9)";
      ctx.fillText(it.label, x + uiScale.line(12), midY + 0.5);
      x += widths[i];
    }
    ctx.textBaseline = "alphabetic";
  }

  _updateHud() {
    const plan = this.plan;
    if (!plan) return;
    const info = phaseAt(plan, this.elapsed);
    if (!info) return;
    const p = info.phase;
    this._currentPhase = p;
    const color = info.done ? "#7bd88f" : p.color;

    if (this.root) this.root.style.setProperty("--phase-color", color);
    this._setText(this.els.phase, info.done ? "ALLENAMENTO COMPLETATO" : p.phaseName);
    this._setText(this.els.sub, info.done ? plan.name : p.sub);

    const timer = info.done ? "00:00" : formatClock(info.phaseRemaining);
    this._setText(this.els.timer, timer);
    this._setText(
      this.els.timerLabel,
      info.done ? "ottimo lavoro" : "rimanenti nella fase"
    );
    this._setText(this.els.total, formatClock(info.totalRemaining, true));

    if (this.els.phaseFill) {
      const pct = p.duration > 0 ? (info.phaseElapsed / p.duration) * 100 : 0;
      this.els.phaseFill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    }

    if (info.done) {
      this._setText(this.els.next, "Allenamento completato");
      this._setText(this.els.targets, "Target: —");
    } else {
      if (info.next) {
        this._setText(
          this.els.next,
          `Poi: ${info.next.phaseName} · ${formatClock(info.next.duration)}`
        );
      } else {
        this._setText(this.els.next, "Ultima fase");
      }
      const sign = p.slopePct >= 0 ? "+" : "";
      this._setText(
        this.els.targets,
        `Target: ${p.targetW} W · ${p.ftpPct}% FTP · ${sign}${p.slopePct.toFixed(1)}% · ${p.rpmMin}-${p.rpmMax} rpm`
      );
    }
    this._updateLive();
  }

  _updateLive() {
    const d = this.live || {};
    const p = this._currentPhase;
    const targetW = Number.isFinite(d.targetW) ? d.targetW : p ? p.targetW : null;
    const rpmMin = Number.isFinite(d.rpmMin) ? d.rpmMin : p ? p.rpmMin : null;
    const rpmMax = Number.isFinite(d.rpmMax) ? d.rpmMax : p ? p.rpmMax : null;
    const targetSlope = Number.isFinite(d.targetSlopePct)
      ? d.targetSlopePct
      : p
        ? p.slopePct
        : null;
    const ftpPct = Number.isFinite(d.ftpPct) ? d.ftpPct : p ? p.ftpPct : null;
    const hasPower = Number.isFinite(d.powerW);
    const hasCadence = Number.isFinite(d.cadence);
    const hasSlope = Number.isFinite(d.slopePct);
    const sign = (v) => (v >= 0 ? "+" : "");

    this._setText(this.els.bigPower, hasPower ? `${Math.round(d.powerW)} W` : "—");
    this._setText(this.els.bigTarget, targetW !== null ? `${Math.round(targetW)} W` : "—");
    this._setText(this.els.bigRpm, hasCadence ? `${Math.round(d.cadence)} rpm` : "—");
    this._setText(this.els.bigSlope, hasSlope ? `${sign(d.slopePct)}${d.slopePct.toFixed(1)}%` : "—");
    this._setText(this.els.powerTargetPct, ftpPct !== null ? `${Math.round(ftpPct)}% FTP` : "—");
    this._setText(
      this.els.rpmTarget,
      rpmMin !== null && rpmMax !== null ? `target ${rpmMin}-${rpmMax} rpm` : "—"
    );
    this._setText(
      this.els.slopeTarget,
      targetSlope !== null ? `target ${sign(targetSlope)}${targetSlope.toFixed(1)}%` : "—"
    );

    let high = false;
    let low = false;
    if (hasPower && Number.isFinite(targetW) && targetW > 0) {
      const delta = Math.round(d.powerW - targetW);
      const pct = Math.round((d.powerW / targetW) * 100);
      this._setText(this.els.powerDelta, `${delta >= 0 ? "+" : ""}${delta} W · ${pct}% target`);
      high = delta > targetW * 0.08;
      low = delta < -targetW * 0.08;
    } else {
      this._setText(this.els.powerDelta, targetW ? "in attesa del trainer" : "—");
    }
    if (this.els.powerCard) {
      this.els.powerCard.classList.toggle("is-high", high);
      this.els.powerCard.classList.toggle("is-low", low);
    }

    if (!hasPower) {
      this._setText(this.els.live, "Attuale: —");
      return;
    }
    let text = `Attuale: ${Math.round(d.powerW)} W · ${hasCadence ? Math.round(d.cadence) : 0} rpm`;
    if (hasSlope) text += ` · ${sign(d.slopePct)}${d.slopePct.toFixed(1)}%`;
    if (Number.isFinite(d.heartRate) && d.heartRate > 0) {
      text += ` · ${Math.round(d.heartRate)} bpm`;
    }
    this._setText(this.els.live, text);
  }

  _updateAlerts() {
    const p = this._currentPhase;
    const d = this.live || {};
    if (!p || !Number.isFinite(d.powerW) || d.powerW <= 0) {
      this._alerts = {};
      this._warnSince = {};
      this._updateAlert();
      return;
    }
    const now = this.elapsed;
    const check = (key, bad, text) => {
      if (bad) {
        if (!Number.isFinite(this._warnSince[key])) this._warnSince[key] = now;
        if (now - this._warnSince[key] >= 1.5) this._alerts[key] = text;
      } else {
        this._warnSince[key] = null;
        delete this._alerts[key];
      }
    };
    const w = d.powerW;
    const target = Number.isFinite(d.targetW) ? d.targetW : p.targetW;
    check(
      "powerHigh",
      w > target * 1.12,
      `⚠ Potenza alta: ${Math.round(w)} W (target ${Math.round(target)} W)`
    );
    check(
      "powerLow",
      w < target * 0.88,
      `⚠ Potenza bassa: ${Math.round(w)} W (target ${Math.round(target)} W)`
    );
    const cad = Number(d.cadence) || 0;
    check(
      "rpmHigh",
      cad > p.rpmMax + 8,
      `⚠ RPM alti: ${Math.round(cad)} (target ${p.rpmMin}-${p.rpmMax})`
    );
    check(
      "rpmLow",
      cad > 0 && cad < p.rpmMin - 8,
      `⚠ RPM bassi: ${Math.round(cad)} (target ${p.rpmMin}-${p.rpmMax})`
    );
    this._updateAlert();
  }

  _updateAlert() {
    const node = this.els.alert;
    if (!node) return;
    const keys = Object.keys(this._alerts);
    const text = keys.slice(0, 2).map((k) => this._alerts[k]).join(" · ");
    this._setText(node, text);
    node.hidden = !text;
  }

  _setText(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
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
