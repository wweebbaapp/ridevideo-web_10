// Global UI text scale shared by the DOM (CSS variable --ui-scale) and by
// every canvas drawing routine. A+ / A- update this single source of truth.

export const MIN_UI_SCALE = 0.8;
export const MAX_UI_SCALE = 2.2;

export const uiScale = {
  value: 1,

  set(v) {
    const n = Number(v);
    const s = Number.isFinite(n)
      ? Math.min(MAX_UI_SCALE, Math.max(MIN_UI_SCALE, Math.round(n * 20) / 20))
      : 1;
    this.value = s;
    return s;
  },

  px(v) {
    return Math.max(8, Math.round(Number(v) * this.value));
  },

  line(v) {
    return Math.max(1, Math.round(Number(v) * this.value));
  },
};
