// Interval training model.
//
// Builds a repeatable workout from a compact configuration:
//   warm-up -> preparation mini-series -> main series/repetitions -> cool-down
//
// The plan is a flat list of phases with absolute start/end seconds. Every
// phase carries the slope, %FTP, target watts and cadence range used by the
// trainer and by the interval view.

export const INTERVAL_COLORS = {
  work: "#ff6b35",
  recovery: "#2e86de",
  seriesRecovery: "#1b6ca8",
  warmup: "#4fc3f7",
  prepWork: "#b06bff",
  prepRecovery: "#5a4fcf",
  cooldown: "#8d99ae",
  extraRecovery: "#3d5a80",
};

export const INTERVAL_DEFAULTS = {
  kind: "interval",
  totalMin: 60,
  seriesCount: 4,
  seriesRecoveryMin: 3,
  repsPerSeries: 3,
  repMin: 1,
  repRecoveryMin: 1,
  slopePct: 2.5,
  ftpPct: 90,
  ftpW: 200,
  warmupMin: 5,
  prepMin: 5,
  prepRepSec: 20,
  prepRecoverySec: 20,
  cooldownMin: 5,
  recoveryFtpPct: 55,
  recoverySlopePct: 0,
  autoFillReps: true,
  controlMode: "slope",
};

export const INTERVAL_PRESETS = [
  {
    id: "short",
    label: "30 min",
    config: { ...INTERVAL_DEFAULTS, totalMin: 30, seriesCount: 2 },
  },
  {
    id: "hour",
    label: "1 ora",
    config: { ...INTERVAL_DEFAULTS, totalMin: 60, seriesCount: 4 },
  },
  {
    id: "long",
    label: "1h 30",
    config: { ...INTERVAL_DEFAULTS, totalMin: 90, seriesCount: 8 },
  },
  {
    id: "ftptest",
    label: "🔥 Test FTP",
    config: {
      ...INTERVAL_DEFAULTS,
      kind: "ftptest",
      totalMin: 40,
      seriesCount: 1,
      warmupMin: 10,
      prepMin: 5,
      cooldownMin: 5,
      ftpPct: 95,
      recoveryFtpPct: 50,
      slopePct: 2,
      recoverySlopePct: 0,
      autoFillReps: false,
    },
  },
];

export const FTP_TEST_PRESET = INTERVAL_PRESETS[INTERVAL_PRESETS.length - 1];

function finite(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Height of every bar is the ratio between its %FTP and this ceiling.
// 100% FTP is always inside the chart, so the threshold line is visible and
// e.g. 90% vs 80% are drawn almost as tall as each other.
export function ftpScaleMax(config) {
  const highest = Math.max(
    finite(config && config.ftpPct, 90),
    finite(config && config.recoveryFtpPct, 55),
    100
  );
  return Math.max(100, Math.ceil((highest + 10) / 10) * 10);
}

export function normalizeIntervalConfig(raw = {}) {
  const src = raw && typeof raw === "object" ? raw : {};
  const d = INTERVAL_DEFAULTS;
  const config = {
    kind: src.kind === "ftptest" ? "ftptest" : "interval",
    totalMin: clamp(finite(src.totalMin, d.totalMin), 5, 300),
    seriesCount: Math.round(clamp(finite(src.seriesCount, d.seriesCount), 1, 30)),
    seriesRecoveryMin: clamp(finite(src.seriesRecoveryMin, d.seriesRecoveryMin), 0, 60),
    repsPerSeries: Math.round(clamp(finite(src.repsPerSeries, d.repsPerSeries), 1, 40)),
    repMin: clamp(finite(src.repMin, d.repMin), 0.1, 60),
    repRecoveryMin: clamp(finite(src.repRecoveryMin, d.repRecoveryMin), 0, 60),
    slopePct: clamp(finite(src.slopePct, d.slopePct), -20, 20),
    ftpPct: clamp(finite(src.ftpPct, d.ftpPct), 10, 200),
    ftpW: clamp(finite(src.ftpW, d.ftpW), 50, 1500),
    warmupMin: clamp(finite(src.warmupMin, d.warmupMin), 0, 120),
    prepMin: clamp(finite(src.prepMin, d.prepMin), 0, 120),
    prepRepSec: clamp(finite(src.prepRepSec, d.prepRepSec), 5, 600),
    prepRecoverySec: clamp(finite(src.prepRecoverySec, d.prepRecoverySec), 0, 600),
    cooldownMin: clamp(finite(src.cooldownMin, d.cooldownMin), 0, 120),
    recoveryFtpPct: clamp(finite(src.recoveryFtpPct, d.recoveryFtpPct), 10, 200),
    recoverySlopePct: clamp(finite(src.recoverySlopePct, d.recoverySlopePct), -20, 20),
    autoFillReps: src.autoFillReps !== false,
    controlMode: src.controlMode === "erg" ? "erg" : "slope",
  };
  return config;
}

function secFromMin(min) {
  return Math.max(0, Math.round(finite(min, 0) * 60));
}

export function formatClock(seconds, forceHours = false) {
  let total = Math.max(0, Math.ceil((Number(seconds) || 0) - 1e-6));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  if (h > 0 || forceHours) return `${h}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

export function intervalPlanName(config) {
  if (config && config.kind === "ftptest") return "Test FTP 20 min";
  const total = Math.round(finite(config && config.totalMin, 60));
  if (total === 30) return "Intervalli 30 min";
  if (total === 60) return "Intervalli 1 ora";
  if (total === 90) return "Intervalli 1h 30";
  return `Intervalli ${total} min`;
}

function distributeReps(totalReps, seriesCount) {
  const base = Math.floor(totalReps / seriesCount);
  const rest = totalReps % seriesCount;
  const out = [];
  for (let i = 0; i < seriesCount; i++) out.push(base + (i < rest ? 1 : 0));
  return out;
}

export function buildIntervalPlan(rawConfig = {}) {
  const config = normalizeIntervalConfig(rawConfig);
  if (config.kind === "ftptest") return buildFtpTestPlan(config);

  const targetSec = Math.max(60, secFromMin(config.totalMin));
  const scaleMax = ftpScaleMax(config);
  const warmupSec = secFromMin(config.warmupMin);
  const prepSec = secFromMin(config.prepMin);
  const cooldownSec = secFromMin(config.cooldownMin);
  const seriesRecSec = secFromMin(config.seriesRecoveryMin);
  const repSec = Math.max(5, secFromMin(config.repMin));
  const repRecSec = Math.max(0, secFromMin(config.repRecoveryMin));
  const seriesCount = Math.max(1, Math.round(config.seriesCount));
  const baseRepsPerSeries = Math.max(1, Math.round(config.repsPerSeries));

  const fixedSec = warmupSec + prepSec + cooldownSec;
  const seriesRecTotal = (seriesCount - 1) * seriesRecSec;
  const mainTarget = targetSec - fixedSec;
  const cycleSec = repSec + repRecSec;
  const neededTotalReps = Math.floor(
    (mainTarget + repRecSec * seriesCount - seriesRecTotal) / Math.max(1, cycleSec)
  );

  const baseTotalReps = seriesCount * baseRepsPerSeries;
  let totalReps;
  if (config.autoFillReps) {
    totalReps = Math.max(baseTotalReps, seriesCount, neededTotalReps);
  } else {
    totalReps = Math.max(seriesCount, baseTotalReps);
  }
  const repsPerSeries = distributeReps(totalReps, seriesCount);

  const phases = [];
  let cursor = 0;

  const addPhase = (type, duration, opts = {}) => {
    const dur = Math.max(0, Math.round(duration));
    if (dur <= 0) return null;
    const ftpPct = Number.isFinite(opts.ftpPct) ? opts.ftpPct : config.recoveryFtpPct;
    const slopePct = Number.isFinite(opts.slopePct) ? opts.slopePct : 0;
    const targetW = Math.round(config.ftpW * ftpPct / 100);
    const phase = {
      type,
      start: cursor,
      end: cursor + dur,
      duration: dur,
      phaseName: opts.phaseName || type.toUpperCase(),
      sub: opts.sub || "",
      detail: opts.detail || "",
      ftpPct,
      slopePct,
      targetW,
      rpmMin: opts.rpmMin ?? 80,
      rpmMax: opts.rpmMax ?? 90,
      color: opts.color || INTERVAL_COLORS.recovery,
      barHeight: Math.min(1, ftpPct / scaleMax),
      groupKey: opts.groupKey || type,
      groupLabel: opts.groupLabel || "",
      seriesIndex: Number.isFinite(opts.seriesIndex) ? opts.seriesIndex : null,
      seriesCount,
      repIndex: Number.isFinite(opts.repIndex) ? opts.repIndex : null,
      repsInSeries: Number.isFinite(opts.repsInSeries) ? opts.repsInSeries : null,
    };
    cursor += dur;
    phases.push(phase);
    return phase;
  };

  // Warm-up
  addPhase("warmup", warmupSec, {
    phaseName: "RISCALDAMENTO",
    sub: "Pedala facile e prepara le gambe",
    detail: "Riscaldamento",
    ftpPct: 50,
    slopePct: 0,
    rpmMin: 80,
    rpmMax: 90,
    color: INTERVAL_COLORS.warmup,
    groupKey: "warmup",
    groupLabel: "RISC",
  });

  // Preparation mini-series (small 20 s repetitions at 50% FTP by default).
  if (prepSec > 0) {
    const pattern = [];
    let rem = prepSec;
    const prepRep = Math.max(5, Math.round(config.prepRepSec));
    const prepRec = Math.max(0, Math.round(config.prepRecoverySec));
    while (rem > 0) {
      const work = Math.min(prepRep, rem);
      pattern.push({ type: "work", duration: work });
      rem -= work;
      if (rem <= 0) break;
      if (prepRec > 0) {
        const rec = Math.min(prepRec, rem);
        pattern.push({ type: "recovery", duration: rec });
        rem -= rec;
      }
    }
    const prepWorkCount = pattern.filter((p) => p.type === "work").length;
    let prepWorkIndex = 0;
    for (const p of pattern) {
      if (p.type === "work") {
        prepWorkIndex++;
        addPhase("prep-work", p.duration, {
          phaseName: "PREPARAZIONE",
          sub: `Mini-serie ${prepWorkIndex}/${prepWorkCount} · ${p.duration}s`,
          detail: "Preparazione",
          ftpPct: 50,
          slopePct: config.slopePct,
          rpmMin: 70,
          rpmMax: 80,
          color: INTERVAL_COLORS.prepWork,
          groupKey: "prep",
          groupLabel: "PREP",
        });
      } else {
        addPhase("prep-recovery", p.duration, {
          phaseName: "PREPARAZIONE",
          sub: "Recupero mini-serie",
          detail: "Recupero preparazione",
          ftpPct: 50,
          slopePct: 0,
          rpmMin: 80,
          rpmMax: 90,
          color: INTERVAL_COLORS.prepRecovery,
          groupKey: "prep",
          groupLabel: "PREP",
        });
      }
    }
  }

  // Main series
  for (let si = 0; si < seriesCount; si++) {
    const reps = repsPerSeries[si];
    for (let ri = 0; ri < reps; ri++) {
      addPhase("work", repSec, {
        phaseName: "RIPETIZIONE",
        sub: `Serie ${si + 1}/${seriesCount} · ripetizione ${ri + 1}/${reps}`,
        detail: "Ripetizione",
        ftpPct: config.ftpPct,
        slopePct: config.slopePct,
        rpmMin: 70,
        rpmMax: 80,
        color: INTERVAL_COLORS.work,
        groupKey: `series-${si}`,
        groupLabel: `S${si + 1}`,
        seriesIndex: si,
        repIndex: ri,
        repsInSeries: reps,
      });
      if (ri < reps - 1 && repRecSec > 0) {
        addPhase("recovery", repRecSec, {
          phaseName: "RECUPERO",
          sub: `Serie ${si + 1}/${seriesCount} · prima della ripetizione ${ri + 2}`,
          detail: "Recupero",
          ftpPct: config.recoveryFtpPct,
          slopePct: config.recoverySlopePct,
          rpmMin: 80,
          rpmMax: 90,
          color: INTERVAL_COLORS.recovery,
          groupKey: `series-${si}`,
          groupLabel: `S${si + 1}`,
          seriesIndex: si,
          repIndex: ri,
          repsInSeries: reps,
        });
      }
    }
    if (si < seriesCount - 1 && seriesRecSec > 0) {
      addPhase("series-recovery", seriesRecSec, {
        phaseName: "RECUPERO TRA SERIE",
        sub: `Serie ${si + 1}/${seriesCount} completata`,
        detail: "Recupero tra serie",
        ftpPct: config.recoveryFtpPct,
        slopePct: config.recoverySlopePct,
        rpmMin: 80,
        rpmMax: 90,
        color: INTERVAL_COLORS.seriesRecovery,
        groupKey: `series-${si}`,
        groupLabel: `S${si + 1}`,
        seriesIndex: si,
      });
    }
  }

  // Extra recovery before cool-down when the target is longer than the plan.
  const beforeCooldown = cursor;
  const extraRecoverySec = targetSec - (beforeCooldown + cooldownSec);
  if (extraRecoverySec > 0) {
    addPhase("extra-recovery", extraRecoverySec, {
      phaseName: "RECUPERO",
      sub: "Recupero prima del defaticamento",
      detail: "Recupero extra",
      ftpPct: config.recoveryFtpPct,
      slopePct: config.recoverySlopePct,
      rpmMin: 80,
      rpmMax: 90,
      color: INTERVAL_COLORS.extraRecovery,
      groupKey: "extra",
      groupLabel: "REC",
    });
  }

  // Cool-down
  addPhase("cooldown", cooldownSec, {
    phaseName: "DEFATICAMENTO",
    sub: "Pedala sciolto e recupera",
    detail: "Defaticamento",
    ftpPct: 50,
    slopePct: 0,
    rpmMin: 80,
    rpmMax: 90,
    color: INTERVAL_COLORS.cooldown,
    groupKey: "cooldown",
    groupLabel: "DEF",
  });

  const totalSec = phases.length ? phases[phases.length - 1].end : 0;
  const plan = {
    name: intervalPlanName(config),
    config,
    kind: config.kind,
    ftpW: config.ftpW,
    ftpScaleMax: scaleMax,
    targetSec,
    totalSec,
    phases,
    repsPerSeries,
    seriesCount,
    extraRecoverySec: Math.max(0, extraRecoverySec),
    warning: totalSec > targetSec + 1 ? totalSec - targetSec : 0,
  };
  return plan;
}

// 20-minute FTP test: 10' warm-up, 5' preparation, 20' all-out-but-steady at
// 95% FTP on a constant 2% climb, 5' cool-down. The 20' average power is used
// to estimate FTP (average × 0.95), the standard Coggan protocol.
function buildFtpTestPlan(config) {
  const scaleMax = ftpScaleMax(config);
  const phases = [];
  let cursor = 0;
  const addPhase = (type, duration, opts) => {
    const dur = Math.max(0, Math.round(duration));
    if (dur <= 0) return null;
    const ftpPct = opts.ftpPct;
    const phase = {
      type,
      start: cursor,
      end: cursor + dur,
      duration: dur,
      phaseName: opts.phaseName,
      sub: opts.sub,
      detail: opts.detail,
      ftpPct,
      slopePct: opts.slopePct || 0,
      targetW: Math.round(config.ftpW * ftpPct / 100),
      rpmMin: opts.rpmMin ?? 80,
      rpmMax: opts.rpmMax ?? 90,
      color: opts.color,
      barHeight: Math.min(1, ftpPct / scaleMax),
      groupKey: type,
      groupLabel: opts.groupLabel || "",
      seriesIndex: null,
      seriesCount: 1,
      repIndex: null,
      repsInSeries: null,
    };
    cursor += dur;
    phases.push(phase);
    return phase;
  };

  addPhase("warmup", secFromMin(10), {
    phaseName: "RISCALDAMENTO",
    sub: "10 min facili · pendenza 0%",
    detail: "Riscaldamento test FTP",
    ftpPct: 50,
    slopePct: 0,
    color: INTERVAL_COLORS.warmup,
    groupLabel: "RISC",
  });
  addPhase("prep", secFromMin(5), {
    phaseName: "PREPARAZIONE",
    sub: "5 min @60%FTP · pendenza +1%",
    detail: "Preparazione test FTP",
    ftpPct: 60,
    slopePct: 1,
    color: INTERVAL_COLORS.prepWork,
    groupLabel: "PREP",
  });
  const test = addPhase("ftp-test", secFromMin(20), {
    phaseName: "TEST FTP",
    sub: "20 min costanti @95%FTP · pendenza +2%",
    detail: "Test FTP 20 minuti",
    ftpPct: 95,
    slopePct: 2,
    rpmMin: 80,
    rpmMax: 90,
    color: INTERVAL_COLORS.work,
    groupLabel: "TEST",
  });
  addPhase("cooldown", secFromMin(5), {
    phaseName: "DEFATICAMENTO",
    sub: "5 min facili · pendenza 0%",
    detail: "Defaticamento test FTP",
    ftpPct: 50,
    slopePct: 0,
    color: INTERVAL_COLORS.cooldown,
    groupLabel: "DEF",
  });

  const totalSec = phases.length ? phases[phases.length - 1].end : 0;
  return {
    name: intervalPlanName(config),
    config,
    kind: "ftptest",
    ftpW: config.ftpW,
    ftpScaleMax: scaleMax,
    targetSec: totalSec,
    totalSec,
    phases,
    repsPerSeries: [1],
    seriesCount: 1,
    extraRecoverySec: 0,
    warning: 0,
    testWindow: test ? { start: test.start, end: test.end } : null,
  };
}

export function phaseAt(plan, elapsed) {
  if (!plan || !plan.phases || !plan.phases.length) return null;
  const t = Math.max(0, Math.min(plan.totalSec, Number(elapsed) || 0));
  let lo = 0;
  let hi = plan.phases.length - 1;
  let idx = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const p = plan.phases[mid];
    if (t < p.start) {
      hi = mid - 1;
    } else if (t >= p.end) {
      lo = mid + 1;
    } else {
      idx = mid;
      break;
    }
  }
  if (t >= plan.totalSec) idx = plan.phases.length - 1;
  if (t <= 0) idx = 0;
  const phase = plan.phases[idx];
  return {
    index: idx,
    phase,
    phaseElapsed: Math.max(0, Math.min(phase.duration, t - phase.start)),
    phaseRemaining: Math.max(0, phase.end - t),
    totalRemaining: Math.max(0, plan.totalSec - t),
    next: plan.phases[idx + 1] || null,
    done: t >= plan.totalSec,
    elapsed: t,
  };
}
