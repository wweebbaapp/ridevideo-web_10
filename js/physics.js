// Cycling physics model.
// Mirrors the Python implementation:
//   P = (m*g*sin(t) + Crr*m*g*cos(t) + 0.5*rho*CdA*v^2) * v

export class RiderConfig {
  constructor(opts = {}) {
    this.massKg = opts.massKg ?? 75.0;
    this.crr = opts.crr ?? 0.005;
    this.cda = opts.cda ?? 0.36;
    this.airDensity = opts.airDensity ?? 1.225;
    this.drivetrainLoss = opts.drivetrainLoss ?? 0.02;
    this.g = 9.81;
  }
}

export const ROAD_SURFACES = {
  asphalt: 0.005,
  rough_road: 0.008,
  smooth_concrete: 0.003,
  wooden_track: 0.002,
};

export function requiredPower(speedMs, slopePct, cfg) {
  if (speedMs <= 0) return 0.0;
  const theta = Math.atan(slopePct / 100.0);
  const load =
    cfg.massKg * cfg.g * Math.sin(theta) +
    cfg.crr * cfg.massKg * cfg.g * Math.cos(theta) +
    0.5 * cfg.airDensity * cfg.cda * speedMs * speedMs;
  let power = load * speedMs;
  if (power > 0) power /= 1.0 - cfg.drivetrainLoss;
  return Math.max(0.0, power);
}

// Robust bracketing bisection for c*v^3 + (a+b)*v - target = 0.
export function speedFromPower(powerW, slopePct, cfg) {
  if (powerW <= 0) return 0.0;
  const theta = Math.atan(slopePct / 100.0);
  const a = cfg.massKg * cfg.g * Math.sin(theta);
  const b = cfg.crr * cfg.massKg * cfg.g * Math.cos(theta);
  const c = 0.5 * cfg.airDensity * cfg.cda;
  const target = powerW * (1.0 - cfg.drivetrainLoss);

  const f = (v) => c * v * v * v + (a + b) * v - target;

  let lo = 0.0;
  let hi = 1.0;
  for (let i = 0; i < 60; i++) {
    if (f(hi) >= 0) break;
    hi *= 2.0;
    if (i === 59) return hi;
  }
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2.0;
    if (f(mid) < 0) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-6) break;
  }
  return Math.max(0.0, (lo + hi) / 2.0);
}

// Estimate the gradient the rider is actually working against, starting from
// measured power and speed. Useful with a smart trainer: in ERG mode the
// resistance changes on its own, so the returned value is the real gradient
// felt by the rider, not the one we asked the trainer to simulate.
export function slopeFromPowerSpeed(powerW, speedKmh, cfg) {
  const v = (Number(speedKmh) || 0) / 3.6;
  const p = Number(powerW);
  if (v < 1.5 || !Number.isFinite(p) || p <= 0) return null;

  const available = (p * (1.0 - cfg.drivetrainLoss)) / v;
  const drag = 0.5 * cfg.airDensity * cfg.cda * v * v;
  const needed = available - drag;
  const mg = cfg.massKg * cfg.g;
  const f = (theta) => mg * (Math.sin(theta) + cfg.crr * Math.cos(theta)) - needed;

  let lo = -0.35;
  let hi = 0.35;
  if (f(lo) > 0 || f(hi) < 0) return null;
  for (let i = 0; i < 70; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < 0) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-7) break;
  }
  return Math.tan((lo + hi) / 2) * 100;
}

export function virtualSpeed(currentMs, powerW, slopePct, cfg, dt, inertia = 1.0) {
  const target = speedFromPower(powerW, slopePct, cfg);
  const tau = 2.0 / Math.max(0.1, inertia);
  const alpha = Math.min(1.0, dt / tau);
  return currentMs + (target - currentMs) * alpha;
}
