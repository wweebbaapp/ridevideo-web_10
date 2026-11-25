// RideVideo Web - main application logic.
// Local-only indoor cycling app: video <-> GPS sync, HUD, charts, trainer BLE.

import { RiderConfig, virtualSpeed, slopeFromPowerSpeed } from "./physics.js";
import { uiScale } from "./ui-scale.js";
import { parseGPX } from "./gpx.js";
import { VideoSync } from "./video-sync.js";
import { Hud, DEFAULT_SCALE, MIN_SCALE, MAX_SCALE } from "./hud.js";
import { RideChart } from "./charts.js";
import { ElevationProfile } from "./elevation.js";
import { SlopeChart } from "./slope-chart.js";
import { MapView } from "./map-view.js";
import { PlaceTracker } from "./geocode.js";
import { TrainerConnection, WEB_BLUETOOTH_AVAILABLE } from "./trainer.js";
import { IntervalView } from "./interval-view.js";
import { IntervalZoomChart } from "./interval-zoom-chart.js";
import {
  INTERVAL_DEFAULTS,
  INTERVAL_PRESETS,
  FTP_TEST_PRESET,
  normalizeIntervalConfig,
  buildIntervalPlan,
  phaseAt,
  formatClock,
} from "./intervals.js";
import {
  loadActivities,
  upsertActivity,
  deleteActivity,
  clearActivities,
  loadSettings,
  saveSettings,
  loadSession,
  saveSession,
  clearSession,
  sampleTrack,
  downsample,
  activityToCSV,
  activitiesSummaryCSV,
  activityToGPX,
  safeFileName,
  downloadText,
} from "./storage.js";

const FONT_KEY = "ridevideo_hud_scale";
const MAX_SLOPE_PCT = 20;
const MAX_POWER_W = 500;
const MIN_MASS_KG = 50;
const MAX_MASS_KG = 130;

const state = {
  route: null,
  sync: null,
  routeName: "",
  playing: false,
  paused: false,
  riderDistance: 0,
  riderSpeedKmh: 0,
  calories: 0,
  fixedPower: 180,
  useAutoSlope: true,
  trainerMode: false,
  elapsed: 0,
  startWall: 0,
  samples: [],
  lastSampleTime: 0,
  lastFrameTime: 0,
  lastTrainerStatusTime: 0,
  hasVideo: false,
  mapVisible: false,
  mapView: null,
  placeInfo: null,
  cfg: new RiderConfig(),
  gpxText: "",
  sessionSaved: false,
  lastActivity: null,
  lastPersistTime: 0,
  modalOpen: false,
  pendingSession: null,
  intervalMode: false,
  intervalConfig: null,
  intervalPlan: null,
  intervalTargetW: 0,
  ftpTestResult: null,
};

let hud, chartPower, slopeChart, elevChart, trainer, placeTracker, intervalView, intervalZoomChart;
let wakeLock = null;

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- init

function init() {
  hud = new Hud($("hudCanvas"));
  if (location.search.includes("debugmap")) {
    window.__rv = state;
    window.__hud = hud;
  }

  chartPower = new RideChart($("chartPower"), "Potenza", "W", "#ffc832");
  slopeChart = new SlopeChart($("chartSlope"));
  elevChart = new ElevationProfile($("elevCanvas"));
  slopeChart.onSeek = (d) => seekToDistance(d);
  elevChart.onSeek = (d) => seekToDistance(d);

  intervalView = new IntervalView($("intervalCanvas"), $("intervalView"));
  intervalZoomChart = new IntervalZoomChart($("ivZoomCanvas"));
  intervalZoomChart.setWindowM(Number($("zoomM").value) || 50);
  state.intervalConfig = normalizeIntervalConfig(
    loadSettings().intervalConfig || INTERVAL_DEFAULTS
  );
  state.intervalPlan = buildIntervalPlan(state.intervalConfig);
  intervalView.setPlan(state.intervalPlan);
  intervalZoomChart.setPlan(state.intervalPlan);

  trainer = new TrainerConnection(() => {});
  placeTracker = new PlaceTracker((info) => {
    state.placeInfo = info;
    renderPlace(info);
  });

  applyFontScale(loadFontScale());
  applySavedSettings();

  wireEvents();
  layoutVideoBox();
  updateTrainerAvailability();
  updateModeControls();
  updateReady();
  setupResume();
  window.addEventListener("resize", onResize);
  window.addEventListener("pagehide", persistLastSession);
  document.addEventListener("visibilitychange", onVisibilityChange);

  // Register service worker for offline/PWA install
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

function onResize() {
  hud.resize();
  layoutVideoBox();
  if (chartPower && chartPower._resize) chartPower._resize();
  if (slopeChart) slopeChart.resize();
  if (elevChart) elevChart.resize();
  if (intervalView) intervalView.resize();
  if (intervalZoomChart) intervalZoomChart.resize();
  if (state.mapView) state.mapView.resize();
}

function layoutVideoBox() {
  const wrap = $("videoWrap");
  const box = $("videoBox");
  if (!wrap || !box) return;
  const ww = wrap.clientWidth;
  const wh = wrap.clientHeight;
  if (!ww || !wh) return;
  const ar = 16 / 9;
  let bw = ww;
  let bh = bw / ar;
  if (bh > wh) {
    bh = wh;
    bw = bh * ar;
  }
  box.style.width = `${bw}px`;
  box.style.height = `${bh}px`;
}

function updateVideoFit() {
  const video = $("video");
  if (!video || !video.videoWidth || !video.videoHeight) return;
  const wide = video.videoWidth / video.videoHeight > 16 / 9 + 0.005;
  video.style.objectFit = wide ? "cover" : "contain";
  video.style.objectPosition = wide ? "left center" : "center center";
}

// ---------------------------------------------------------------- events

function wireEvents() {
  $("videoInput").addEventListener("change", onVideoChosen);
  $("gpxInput").addEventListener("change", onGpxChosen);
  $("btnIntervals").addEventListener("click", toggleIntervalMode);
  $("btnIntervalConfig").addEventListener("click", openIntervalConfig);
  $("btnFtpTest").addEventListener("click", startFtpTest);
  $("btnPlay").addEventListener("click", togglePlay);
  $("btnReset").addEventListener("click", resetRide);
  $("seekKm").addEventListener("focus", () => {
    $("seekKm").value = (state.riderDistance / 1000).toFixed(2);
  });
  $("seekKm").addEventListener("change", seekFromInput);
  $("seekKm").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      seekFromInput();
      e.target.blur();
    }
  });
  $("zoomM").addEventListener("input", () => applyZoomInput(false));
  $("zoomM").addEventListener("change", () => applyZoomInput(true));
  $("powerSlider").addEventListener("input", (e) => {
    state.fixedPower = Number(e.target.value);
    $("powerVal").textContent = `${e.target.value} W`;
  });
  $("massSlider").addEventListener("input", (e) => {
    state.cfg.massKg = Number(e.target.value);
    $("massVal").textContent = `${e.target.value} kg`;
  });
  $("slopeSlider").addEventListener("input", (e) => {
    if (state.intervalMode) return;
    updateSlopeReadout(Number(e.target.value) / 10);
  });
  $("btnSlopeMode").addEventListener("click", (e) => {
    if (state.intervalMode) return;
    state.useAutoSlope = !state.useAutoSlope;
    e.target.textContent = state.useAutoSlope
      ? "Pendenza: Auto da GPX"
      : "Pendenza: Manuale";
    $("slopeSlider").disabled = state.useAutoSlope;
    saveSettings({ autoSlope: state.useAutoSlope });
  });
  $("btnTrainer").addEventListener("click", toggleTrainer);
  $("btnMapMode").addEventListener("click", toggleMapMode);
  $("btnMapZoomIn").addEventListener("click", () => {
    if (state.mapView) state.mapView.zoomBy(1);
  });
  $("btnMapZoomOut").addEventListener("click", () => {
    if (state.mapView) state.mapView.zoomBy(-1);
  });
  $("btnMapFollow").addEventListener("click", toggleMapFollow);
  $("btnFontBigger").addEventListener("click", () => changeFontSize(+0.1));
  $("btnFontSmaller").addEventListener("click", () => changeFontSize(-0.1));
  $("video").addEventListener("loadedmetadata", () => {
    if (state.sync) {
      state.sync.onMetadata();
      state.sync.seekToDistance(state.riderDistance);
    }
    updateVideoFit();
    layoutVideoBox();
    if (!state.mapVisible) {
      $("videoBox").style.display = "block";
      $("placeholder").style.display = "none";
    }
  });
  $("btnSave").addEventListener("click", () => saveCurrentActivity(false, true));
  $("btnHistory").addEventListener("click", openHistory);
  $("modalClose").addEventListener("click", closeModal);
  $("modalBackdrop").addEventListener("click", (e) => {
    if (e.target === $("modalBackdrop")) closeModal();
  });
  $("resumeBtn").addEventListener("click", resumeSession);
  $("resumeDismiss").addEventListener("click", dismissResume);
  $("powerSlider").addEventListener("change", (e) => {
    saveSettings({ power: Number(e.target.value) });
  });
  $("massSlider").addEventListener("change", (e) => {
    saveSettings({ mass: Number(e.target.value) });
  });
  document.addEventListener("keydown", onKeyDown);
}

function onKeyDown(e) {
  if (e.key === "Escape" && state.modalOpen) {
    closeModal();
    return;
  }
  if (state.modalOpen) return;
  const tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : "";
  if (tag === "input" || tag === "textarea" || tag === "select") return;
  if (e.code === "Space") {
    e.preventDefault();
    togglePlay();
  } else if (e.key === "ArrowLeft" && !state.intervalMode) {
    e.preventDefault();
    seekToDistance(state.riderDistance - 100);
  } else if (e.key === "ArrowRight" && !state.intervalMode) {
    e.preventDefault();
    seekToDistance(state.riderDistance + 100);
  } else if (e.key.toLowerCase() === "r") {
    resetRide();
  } else if (e.key.toLowerCase() === "h") {
    openHistory();
  } else if (e.key.toLowerCase() === "i") {
    toggleIntervalMode();
  }
}

// ------------------------------------------------- HUD text size

function loadFontScale() {
  try {
    const v = Number(localStorage.getItem(FONT_KEY));
    if (Number.isFinite(v) && v >= MIN_SCALE && v <= MAX_SCALE) return v;
  } catch (e) {
    // storage unavailable (private mode)
  }
  return DEFAULT_SCALE;
}

function saveFontScale(v) {
  try {
    localStorage.setItem(FONT_KEY, String(v));
  } catch (e) {
    // storage unavailable (private mode)
  }
}

function redrawCanvases() {
  if (chartPower) chartPower.draw();
  if (!state.intervalMode && slopeChart) slopeChart.draw();
  if (elevChart) elevChart.draw();
  if (intervalView) intervalView.draw();
  if (intervalZoomChart) intervalZoomChart.draw();
}

function refreshIntervalLayouts() {
  if (!state.intervalMode) return;
  if (intervalView) intervalView.refreshLayout();
  if (intervalZoomChart) intervalZoomChart.resize();
}

// A+ / A- resize the HUD and every piece of text in the interface: the CSS
// variable handles the DOM, uiScale handles all canvas drawings.
function applyFontScale(v) {
  const s = hud.setScale(v);
  uiScale.set(s);
  document.documentElement.style.setProperty("--ui-scale", String(s));
  redrawCanvases();
  refreshIntervalLayouts();
  requestAnimationFrame(refreshIntervalLayouts);
  return s;
}

function changeFontSize(delta) {
  const s = applyFontScale(uiScale.value + delta);
  saveFontScale(s);
  setStatus(`Testo interfaccia: ${Math.round(s * 100)}%`);
}

function applySavedSettings() {
  const s = loadSettings();
  if (Number.isFinite(s.power)) {
    state.fixedPower = Math.max(0, Math.min(MAX_POWER_W, s.power));
    $("powerSlider").value = String(state.fixedPower);
    $("powerVal").textContent = `${state.fixedPower} W`;
  }
  if (Number.isFinite(s.mass)) {
    state.cfg.massKg = Math.max(MIN_MASS_KG, Math.min(MAX_MASS_KG, s.mass));
    $("massSlider").value = String(state.cfg.massKg);
    $("massVal").textContent = `${state.cfg.massKg} kg`;
  }
  if (Number.isFinite(s.zoomM)) {
    slopeChart.setWindowM(s.zoomM);
    intervalZoomChart.setWindowM(slopeChart.windowM);
    $("zoomM").value = String(Math.round(slopeChart.windowM));
  }
  if (typeof s.autoSlope === "boolean") {
    state.useAutoSlope = s.autoSlope;
    $("btnSlopeMode").textContent = state.useAutoSlope
      ? "Pendenza: Auto da GPX"
      : "Pendenza: Manuale";
    $("slopeSlider").disabled = state.useAutoSlope;
  }
}

// ------------------------------------------------------------- 3D map

function updateMapButton() {
  const btn = $("btnMapMode");
  if (state.intervalMode) {
    btn.disabled = true;
    btn.textContent = "⏱ Intervalli";
    return;
  }
  if (!state.route) {
    btn.disabled = true;
    return;
  }
  btn.disabled = !state.hasVideo;
  if (!state.hasVideo) {
    btn.textContent = "🗺 Mappa 3D";
  } else {
    btn.textContent = state.mapVisible ? "🎬 Video" : "🗺 Mappa 3D";
  }
}

function showMap(show) {
  if (state.intervalMode) {
    state.mapVisible = show;
    return;
  }
  if (!state.route) return;
  const mapEl = $("map");
  const videoBox = $("videoBox");
  const placeholder = $("placeholder");

  if (show) {
    mapEl.hidden = false;
    if (!state.mapView) {
      try {
        state.mapView = new MapView(mapEl, state.route, (msg) => setStatus(msg));
        state.mapView.onFollowChange = updateMapFollowButton;
      } catch (err) {
        // WebGL2 may be unavailable (old browser / webview): keep the app
        // usable even if the 3D map cannot start.
        state.mapView = null;
        state.mapVisible = false;
        mapEl.hidden = true;
        $("mapAttribution").hidden = true;
        $("mapControls").hidden = true;
        if (!state.hasVideo) {
          videoBox.style.display = "none";
          placeholder.style.display = "flex";
          placeholder.textContent = "Mappa 3D non disponibile su questo browser";
        }
        setStatus(`Mappa 3D non disponibile: ${err.message}`);
        updateMapButton();
        return;
      }
    } else {
      state.mapView.resize();
    }
    state.mapVisible = true;
    state.mapView.setPlace(state.placeInfo);
    updateMapFollowButton(state.mapView.follow);
    state.mapView.update(state.riderDistance, false);
    videoBox.style.display = "none";
    placeholder.style.display = "none";
    $("mapAttribution").hidden = false;
    $("mapControls").hidden = false;
  } else {
    state.mapVisible = false;
    mapEl.hidden = true;
    $("mapAttribution").hidden = true;
    $("mapControls").hidden = true;
    if (state.hasVideo) {
      videoBox.style.display = "block";
      placeholder.style.display = "none";
      layoutVideoBox();
      updateVideoFit();
    } else {
      videoBox.style.display = "none";
      placeholder.style.display = "flex";
      placeholder.textContent = "Carica un video oppure usa la mappa 3D";
    }
  }
  updateMapButton();
}

function toggleMapMode() {
  if (!state.route || state.intervalMode) return;
  showMap(!state.mapVisible);
  if (state.mapVisible) {
    setStatus("Mappa 3D attiva — le mappe si scaricano da internet");
  }
}

function updateMapFollowButton(follow) {
  const btn = $("btnMapFollow");
  if (!btn) return;
  btn.textContent = follow ? "🎯 Segui" : "🎯 Recentra";
  btn.classList.toggle("active", !!follow);
}

function toggleMapFollow() {
  if (!state.mapVisible || !state.mapView) return;
  const next = !state.mapView.follow;
  state.mapView.setFollow(next);
  if (next) state.mapView.recenter();
  updateMapFollowButton(next);
}

function renderPlace(info) {
  const name = info && info.place ? info.place : "—";
  $("placeText").textContent = name;
  $("placeBadge").title = info && info.region ? `Località attuale · ${info.region}` : "Località attuale";
  if (state.mapView) state.mapView.setPlace(info);
}

function trackPlace() {
  if (!state.route || !placeTracker) return;
  const p = state.route.latLonAt(state.riderDistance);
  placeTracker.update(p.lat, p.lon);
}

function onVideoChosen(e) {
  const file = e.target.files[0];
  if (!file) return;
  const video = $("video");
  if (video.src) URL.revokeObjectURL(video.src);
  video.src = URL.createObjectURL(file);
  video.load();
  if (!state.sync && state.route) {
    state.sync = new VideoSync(video, state.route);
  } else if (state.sync) {
    state.sync.video = video;
  }
  state.hasVideo = true;
  if (state.intervalMode) {
    state.mapVisible = false;
    updateStageVisibility();
  } else if (state.route) {
    showMap(false);
  } else {
    $("videoBox").style.display = "block";
    $("placeholder").style.display = "none";
    layoutVideoBox();
  }
  updateMapButton();
  setStatus(`Video: ${file.name}${state.intervalMode ? " (intervalli attivi)" : ""}`);
  updateReady();
}

function onGpxChosen(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const route = parseGPX(reader.result);
      applyRoute(route, reader.result, route.name);
      persistLastSession();
      setStatus(`GPX: ${file.name}`);
    } catch (err) {
      setStatus(`Errore GPX: ${err.message}`);
    }
  };
  reader.readAsText(file);
}

function applyRoute(route, gpxText, routeName) {
  const keepIntervalElapsed = state.intervalMode ? state.elapsed : 0;
  state.route = route;
  state.routeName = routeName || route.name;
  state.gpxText = gpxText || "";
  state.riderDistance = 0;
  state.riderSpeedKmh = 0;
  state.elapsed = keepIntervalElapsed;
  state.calories = 0;
  state.samples = [];
  state.lastSampleTime = keepIntervalElapsed;
  state.lastFrameTime = 0;
  state.lastPersistTime = keepIntervalElapsed;
  if (keepIntervalElapsed > 0) {
    state.startWall = performance.now() - keepIntervalElapsed * 1000;
  }
  state.sessionSaved = false;
  state.lastActivity = null;
  state.pendingSession = null;
  $("resumeBar").hidden = true;
  resetCharts();
  elevChart.setRoute(route);
  slopeChart.setRoute(route);
  $("seekKm").max = (route.totalDistance / 1000).toFixed(2);
  setSeekInput(0);
  $("routeInfo").textContent =
    `${route.name} — ${(route.totalDistance / 1000).toFixed(2)} km, ` +
    `+${Math.round(route.totalAscent)}m`;
  if (state.mapView) {
    state.mapView.destroy();
    state.mapView = null;
  }
  if (!state.sync) {
    state.sync = new VideoSync($("video"), state.route);
  } else {
    state.sync.route = route;
    state.sync.totalDistance = route.totalDistance;
  }
  if (state.sync.video.readyState >= 1) {
    state.sync.onMetadata();
    state.sync.seekToDistance(state.riderDistance);
  }
  showMap(!state.hasVideo);
  updateHudStatic();
  updateReady();
}

function updateReady() {
  const ready = !!state.route || (state.intervalMode && !!state.intervalPlan);
  $("btnPlay").disabled = !ready;
  $("btnReset").disabled = !ready;
  $("btnSave").disabled = !ready;
  $("seekKm").disabled = !ready || state.intervalMode || !state.route;
  updateMapButton();
  updateModeControls();
}

function updateModeControls() {
  const iv = state.intervalMode;
  const intervalsBtn = $("btnIntervals");
  if (intervalsBtn) intervalsBtn.classList.toggle("active", iv);
  const ftpBtn = $("btnFtpTest");
  if (ftpBtn) {
    ftpBtn.classList.toggle(
      "active",
      !!state.intervalPlan && state.intervalPlan.kind === "ftptest"
    );
  }
  const powerSlider = $("powerSlider");
  if (powerSlider) powerSlider.disabled = iv;
  const slopeBtn = $("btnSlopeMode");
  const slopeSlider = $("slopeSlider");
  if (slopeBtn) slopeBtn.disabled = iv;
  if (slopeBtn) {
    slopeBtn.textContent = iv
      ? "Pendenza: intervalli"
      : state.useAutoSlope
        ? "Pendenza: Auto da GPX"
        : "Pendenza: Manuale";
  }
  if (slopeSlider) slopeSlider.disabled = iv || state.useAutoSlope;
  const charts = $("charts");
  if (charts) charts.classList.toggle("interval-mode", iv);
  const slopeCanvas = $("chartSlope");
  const zoomCanvas = $("ivZoomCanvas");
  if (slopeCanvas) slopeCanvas.hidden = iv;
  if (zoomCanvas) zoomCanvas.hidden = !iv;
  const zoomLabel = $("zoomLabelText");
  const zoomUnit = $("zoomUnit");
  const zoomInput = $("zoomM");
  if (zoomLabel) zoomLabel.textContent = iv ? "Zoom profilo ±" : "Altimetria ±";
  if (zoomUnit) zoomUnit.textContent = iv ? "s" : "m";
  if (zoomInput) {
    zoomInput.title = iv
      ? "Ampiezza dello zoom del profilo intervalli, in secondi"
      : "Ampiezza dello zoom altimetrico, in metri";
  }
}

// ------------------------------------------------------- interval mode

function updateStageVisibility() {
  const iv = $("intervalView");
  const mapEl = $("map");
  const videoBox = $("videoBox");
  const placeholder = $("placeholder");
  const hudCanvas = $("hudCanvas");

  if (state.intervalMode) {
    iv.hidden = false;
    mapEl.hidden = true;
    videoBox.style.display = "none";
    placeholder.style.display = "none";
    hudCanvas.style.display = "none";
    $("elevBar").hidden = true;
    $("mapAttribution").hidden = true;
    $("mapControls").hidden = true;
    requestAnimationFrame(() => {
      intervalZoomChart.resize();
      intervalView.refreshLayout();
    });
    return;
  }

  iv.hidden = true;
  hudCanvas.style.display = "";
  $("elevBar").hidden = false;
  if (state.mapVisible && state.route) {
    mapEl.hidden = false;
    videoBox.style.display = "none";
    placeholder.style.display = "none";
    $("mapAttribution").hidden = false;
    $("mapControls").hidden = false;
  } else if (state.hasVideo) {
    mapEl.hidden = true;
    videoBox.style.display = "block";
    placeholder.style.display = "none";
    $("mapAttribution").hidden = true;
    $("mapControls").hidden = true;
    layoutVideoBox();
    updateVideoFit();
  } else {
    mapEl.hidden = true;
    videoBox.style.display = "none";
    placeholder.style.display = "flex";
    placeholder.textContent = state.route
      ? "Carica un video oppure usa la mappa 3D"
      : "Carica un GPX e un video";
    $("mapAttribution").hidden = true;
    $("mapControls").hidden = true;
  }
}

function toggleIntervalMode() {
  if (state.intervalMode) exitIntervalMode();
  else enterIntervalMode();
}

function enterIntervalMode() {
  if (!state.intervalConfig) {
    state.intervalConfig = normalizeIntervalConfig(INTERVAL_DEFAULTS);
  }
  if (!state.intervalPlan) {
    state.intervalPlan = buildIntervalPlan(state.intervalConfig);
  }
  state.intervalMode = true;
  intervalView.setPlan(state.intervalPlan);
  intervalZoomChart.setPlan(state.intervalPlan);
  resetRide();
  updateStageVisibility();
  intervalView.resize();
  intervalZoomChart.resize();
  requestAnimationFrame(() => {
    intervalView.resize();
    intervalZoomChart.resize();
  });
  intervalView.setElapsed(0);
  updateModeControls();
  updateReady();
  setStatus(`Allenamento a intervalli: ${state.intervalPlan.name} — premi Play`);
}

function exitIntervalMode() {
  state.intervalMode = false;
  state.playing = false;
  releaseWakeLock();
  $("btnPlay").textContent = "▶  Play";
  state.elapsed = 0;
  state.riderDistance = 0;
  state.riderSpeedKmh = 0;
  state.calories = 0;
  state.samples = [];
  state.lastSampleTime = 0;
  state.lastFrameTime = 0;
  state.lastPersistTime = 0;
  state.sessionSaved = false;
  state.lastActivity = null;
  state.ftpTestResult = null;
  resetCharts();
  $("elevBar").hidden = false;
  intervalZoomChart.setPlan(state.intervalPlan);
  elevChart.resize();
  if (state.sync) {
    state.sync.pause();
    state.sync.seekToDistance(0);
  }
  if (state.mapView) state.mapView.reset();
  clearSession();
  updateHudStatic();
  setSeekInput(0);
  elevChart.setPosition(0);
  if (state.mapVisible && state.route) {
    showMap(true);
  } else {
    updateStageVisibility();
  }
  updateModeControls();
  updateReady();
  setStatus("Modalità percorso");
}

function startFtpTest() {
  if (!FTP_TEST_PRESET) return;
  const cfg = normalizeIntervalConfig(FTP_TEST_PRESET.config);
  saveSettings({ intervalConfig: cfg });
  state.intervalConfig = cfg;
  state.intervalPlan = buildIntervalPlan(cfg);
  state.ftpTestResult = null;
  intervalView.setPlan(state.intervalPlan);
  intervalZoomChart.setPlan(state.intervalPlan);
  if (!state.intervalMode) {
    enterIntervalMode();
  } else {
    state.playing = false;
    releaseWakeLock();
    $("btnPlay").textContent = "▶  Play";
    resetRide();
    updateModeControls();
    updateReady();
  }
  setStatus("Test FTP 20 min pronto — premi Play");
}

function intervalField(label, id, value, opts = {}) {
  const wrap = el("label", "interval-field");
  wrap.append(el("span", null, label));
  const input = document.createElement("input");
  input.type = "number";
  input.id = id;
  input.value = String(value);
  if (opts.min !== undefined) input.min = String(opts.min);
  if (opts.max !== undefined) input.max = String(opts.max);
  input.step = String(opts.step ?? 1);
  input.inputMode = "decimal";
  wrap.append(input);
  return wrap;
}

function intervalSelect(label, id, value, options) {
  const wrap = el("label", "interval-field");
  wrap.append(el("span", null, label));
  const select = document.createElement("select");
  select.id = id;
  for (const opt of options) {
    const node = document.createElement("option");
    node.value = opt.value;
    node.textContent = opt.label;
    if (opt.value === value) node.selected = true;
    select.append(node);
  }
  wrap.append(select);
  return wrap;
}

function fillIntervalForm(rawConfig) {
  const cfg = normalizeIntervalConfig(rawConfig);
  const set = (id, value) => {
    const node = $(id);
    if (node) node.value = String(value);
  };
  set("ivTotalMin", cfg.totalMin);
  set("ivSeriesCount", cfg.seriesCount);
  set("ivSeriesRecoveryMin", cfg.seriesRecoveryMin);
  set("ivRepsPerSeries", cfg.repsPerSeries);
  set("ivRepMin", cfg.repMin);
  set("ivRepRecoveryMin", cfg.repRecoveryMin);
  set("ivSlopePct", cfg.slopePct);
  set("ivFtpPct", cfg.ftpPct);
  set("ivFtpW", cfg.ftpW);
  set("ivWarmupMin", cfg.warmupMin);
  set("ivPrepMin", cfg.prepMin);
  set("ivPrepRepSec", cfg.prepRepSec);
  set("ivPrepRecoverySec", cfg.prepRecoverySec);
  set("ivCooldownMin", cfg.cooldownMin);
  set("ivRecoveryFtpPct", cfg.recoveryFtpPct);
  set("ivRecoverySlopePct", cfg.recoverySlopePct);
  const auto = $("ivAutoFillReps");
  if (auto) auto.checked = cfg.autoFillReps;
  const mode = $("ivControlMode");
  if (mode) mode.value = cfg.controlMode;
}

function readIntervalConfigForm() {
  const num = (id) => {
    const node = $(id);
    return node ? Number(node.value) : NaN;
  };
  const auto = $("ivAutoFillReps");
  const mode = $("ivControlMode");
  return normalizeIntervalConfig({
    totalMin: num("ivTotalMin"),
    seriesCount: num("ivSeriesCount"),
    seriesRecoveryMin: num("ivSeriesRecoveryMin"),
    repsPerSeries: num("ivRepsPerSeries"),
    repMin: num("ivRepMin"),
    repRecoveryMin: num("ivRepRecoveryMin"),
    slopePct: num("ivSlopePct"),
    ftpPct: num("ivFtpPct"),
    ftpW: num("ivFtpW"),
    warmupMin: num("ivWarmupMin"),
    prepMin: num("ivPrepMin"),
    prepRepSec: num("ivPrepRepSec"),
    prepRecoverySec: num("ivPrepRecoverySec"),
    cooldownMin: num("ivCooldownMin"),
    recoveryFtpPct: num("ivRecoveryFtpPct"),
    recoverySlopePct: num("ivRecoverySlopePct"),
    autoFillReps: auto ? auto.checked : true,
    controlMode: mode ? mode.value : "slope",
  });
}

function updateIntervalSummary() {
  const node = $("ivSummary");
  if (!node) return;
  const cfg = readIntervalConfigForm();
  const plan = buildIntervalPlan(cfg);
  const targetSec = plan.targetSec;
  const diff = plan.totalSec - targetSec;
  const lines = [
    `Durata effettiva: ${formatClock(plan.totalSec, true)}`,
    `Serie: ${cfg.seriesCount} · Ripetizioni per serie: ${plan.repsPerSeries.join(" + ")}`,
    `FTP ${Math.round(cfg.ftpW)} W · ripetizioni ${Math.round(cfg.ftpPct)}% = ${Math.round((cfg.ftpW * cfg.ftpPct) / 100)} W · pendenza ${cfg.slopePct.toFixed(1)}%`,
    `Riscaldamento ${formatClock(cfg.warmupMin * 60)} · preparazione ${formatClock(cfg.prepMin * 60)} · defaticamento ${formatClock(cfg.cooldownMin * 60)}`,
  ];
  if (diff > 1) {
    lines.push(`⚠ Il piano supera la durata configurata di ${formatClock(diff)}`);
  } else if (!cfg.autoFillReps && diff < -1) {
    lines.push(`Recupero extra prima del defaticamento: ${formatClock(-diff)}`);
  }
  node.textContent = lines.join("\n");
}

function applyIntervalConfigFromForm() {
  const cfg = readIntervalConfigForm();
  saveSettings({ intervalConfig: cfg });
  state.intervalConfig = cfg;
  state.intervalPlan = buildIntervalPlan(cfg);
  intervalView.setPlan(state.intervalPlan);
  intervalZoomChart.setPlan(state.intervalPlan);
  closeModal();
  if (!state.intervalMode) {
    enterIntervalMode();
  } else {
    state.playing = false;
    releaseWakeLock();
    $("btnPlay").textContent = "▶  Play";
    resetRide();
    intervalView.resize();
    intervalZoomChart.resize();
    requestAnimationFrame(() => {
      intervalView.resize();
      intervalZoomChart.resize();
    });
    intervalView.setElapsed(0);
    updateModeControls();
    updateReady();
    setStatus(`Allenamento aggiornato: ${state.intervalPlan.name}`);
  }
}

function openIntervalConfig() {
  const cfg = normalizeIntervalConfig(state.intervalConfig || INTERVAL_DEFAULTS);
  const body = el("div", "interval-editor");

  const presets = el("div", "interval-presets");
  presets.append(el("span", "interval-presets-label", "Preset:"));
  for (const preset of INTERVAL_PRESETS) {
    presets.append(
      mkButton(preset.label, "btn blue", () => {
        fillIntervalForm(normalizeIntervalConfig(preset.config));
        updateIntervalSummary();
      })
    );
  }
  body.append(presets);

  const structure = el("div", "interval-section");
  structure.append(el("h3", null, "Struttura"));
  const structureGrid = el("div", "interval-form");
  structureGrid.append(
    intervalField("Durata totale (min)", "ivTotalMin", cfg.totalMin, { min: 5, max: 300, step: 1 }),
    intervalField("Numero serie", "ivSeriesCount", cfg.seriesCount, { min: 1, max: 30, step: 1 }),
    intervalField("Recupero tra serie (min)", "ivSeriesRecoveryMin", cfg.seriesRecoveryMin, { min: 0, max: 60, step: 0.5 }),
    intervalField("Ripetizioni per serie", "ivRepsPerSeries", cfg.repsPerSeries, { min: 1, max: 40, step: 1 }),
    intervalField("Durata ripetizione (min)", "ivRepMin", cfg.repMin, { min: 0.1, max: 60, step: 0.5 }),
    intervalField("Recupero tra ripetizioni (min)", "ivRepRecoveryMin", cfg.repRecoveryMin, { min: 0, max: 60, step: 0.5 })
  );
  structure.append(structureGrid);
  body.append(structure);

  const options = el("div", "interval-section");
  options.append(el("h3", null, "Opzioni"));
  const autoWrap = el("label", "interval-check");
  const auto = document.createElement("input");
  auto.type = "checkbox";
  auto.id = "ivAutoFillReps";
  auto.checked = cfg.autoFillReps;
  autoWrap.append(auto, el("span", null, "Aggiungi ripetizioni extra per raggiungere la durata totale"));
  options.append(autoWrap);
  const optionsGrid = el("div", "interval-form");
  optionsGrid.append(
    intervalSelect("Controllo trainer", "ivControlMode", cfg.controlMode, [
      { value: "slope", label: "Pendenza (simulazione)" },
      { value: "erg", label: "ERG (potenza target)" },
    ]),
    intervalField("FTP (W)", "ivFtpW", cfg.ftpW, { min: 50, max: 1500, step: 1 })
  );
  options.append(optionsGrid);
  body.append(options);

  const reps = el("div", "interval-section");
  reps.append(el("h3", null, "Ripetizioni e recuperi"));
  const repsGrid = el("div", "interval-form");
  repsGrid.append(
    intervalField("Pendenza ripetizioni (%)", "ivSlopePct", cfg.slopePct, { min: -20, max: 20, step: 0.1 }),
    intervalField("%FTP ripetizioni", "ivFtpPct", cfg.ftpPct, { min: 10, max: 200, step: 1 }),
    intervalField("Pendenza recuperi (%)", "ivRecoverySlopePct", cfg.recoverySlopePct, { min: -20, max: 20, step: 0.1 }),
    intervalField("%FTP recuperi", "ivRecoveryFtpPct", cfg.recoveryFtpPct, { min: 10, max: 200, step: 1 })
  );
  reps.append(repsGrid);
  body.append(reps);

  const warm = el("div", "interval-section");
  warm.append(el("h3", null, "Riscaldamento · preparazione · defaticamento"));
  const warmGrid = el("div", "interval-form");
  warmGrid.append(
    intervalField("Riscaldamento (min)", "ivWarmupMin", cfg.warmupMin, { min: 0, max: 120, step: 0.5 }),
    intervalField("Preparazione (min)", "ivPrepMin", cfg.prepMin, { min: 0, max: 120, step: 0.5 }),
    intervalField("Ripetizione preparazione (sec)", "ivPrepRepSec", cfg.prepRepSec, { min: 5, max: 600, step: 5 }),
    intervalField("Recupero preparazione (sec)", "ivPrepRecoverySec", cfg.prepRecoverySec, { min: 0, max: 600, step: 5 }),
    intervalField("Defaticamento (min)", "ivCooldownMin", cfg.cooldownMin, { min: 0, max: 120, step: 0.5 })
  );
  warm.append(warmGrid);
  body.append(warm);

  const summary = el("div", "interval-summary");
  summary.id = "ivSummary";
  body.append(summary);

  body.addEventListener("input", updateIntervalSummary);
  body.addEventListener("change", updateIntervalSummary);

  const foot = [
    mkButton("Applica", "btn green", applyIntervalConfigFromForm),
    mkButton("Ripristina 1 ora", "btn gray", () => {
      fillIntervalForm(normalizeIntervalConfig(INTERVAL_DEFAULTS));
      updateIntervalSummary();
    }),
    mkButton("Annulla", "btn gray", closeModal),
  ];
  openModal("Allenamento a intervalli", body, foot);
  updateIntervalSummary();
}

function setSeekInput(km) {
  const el = $("seekKm");
  if (!el) return;
  if (document.activeElement !== el) el.value = Number(km).toFixed(2);
}

function seekFromInput() {
  if (!state.route) return;
  const raw = String($("seekKm").value).trim();
  const km = Number(raw.replace(",", "."));
  if (!raw || !Number.isFinite(km)) {
    $("seekKm").value = (state.riderDistance / 1000).toFixed(2);
    return;
  }
  seekToDistance(km * 1000);
  $("seekKm").value = (state.riderDistance / 1000).toFixed(2);
}

function applyZoomInput(normalize) {
  const el = $("zoomM");
  const m = Number(el.value);
  if (!Number.isFinite(m)) return;
  slopeChart.setWindowM(m);
  intervalZoomChart.setWindowM(slopeChart.windowM);
  if (normalize) {
    el.value = String(Math.round(slopeChart.windowM));
    saveSettings({ zoomM: slopeChart.windowM });
  }
}

function seekToDistance(distance) {
  if (state.intervalMode) return;
  if (!state.route) return;
  const total = state.route.totalDistance;
  const d = Math.max(0, Math.min(total, Number(distance) || 0));
  state.riderDistance = d;
  if (state.sync) state.sync.seekToDistance(d);
  updateHudStatic();
  if (state.mapVisible && state.mapView) state.mapView.update(d, false);
  setSeekInput(d / 1000);
  setStatus(`Posizione: ${(d / 1000).toFixed(2)} km`);
}

// ------------------------------------------------------- screen wake lock
// Keep the screen on while the ride is running (same behaviour as before).

async function requestWakeLock() {
  if (!("wakeLock" in navigator) || wakeLock) return;
  try {
    const lock = await navigator.wakeLock.request("screen");
    // The ride may have been paused while the request was pending.
    if (!state.playing) {
      lock.release().catch(() => {});
      return;
    }
    wakeLock = lock;
    lock.addEventListener("release", () => {
      if (wakeLock === lock) wakeLock = null;
    });
  } catch (e) {
    wakeLock = null;
  }
}

function releaseWakeLock() {
  if (!wakeLock) return;
  const lock = wakeLock;
  wakeLock = null;
  lock.release().catch(() => {});
}

function onVisibilityChange() {
  if (document.visibilityState === "visible" && state.playing) {
    requestWakeLock();
  } else if (document.visibilityState === "hidden") {
    persistLastSession();
  }
}

// ---------------------------------------------------------------- play

function togglePlay() {
  const ready = state.intervalMode ? !!state.intervalPlan : !!state.route;
  if (!ready) return;
  if (!state.playing) {
    if (state.intervalMode) {
      if (state.elapsed >= state.intervalPlan.totalSec - 0.5) resetRide();
    } else if (state.riderDistance >= state.route.totalDistance - 0.5) {
      resetRide();
    }
  }
  if (state.playing) {
    state.playing = false;
    $("btnPlay").textContent = "▶  Play";
    if (!state.intervalMode && state.sync) state.sync.pause();
    releaseWakeLock();
    persistLastSession();
    setStatus("In pausa");
  } else {
    state.playing = true;
    $("btnPlay").textContent = "⏸  Pausa";
    if (!state.intervalMode && state.sync) state.sync.play();
    state.startWall = performance.now() - state.elapsed * 1000;
    state.lastFrameTime = performance.now();
    requestWakeLock();
    setStatus(state.intervalMode ? "Allenamento a intervalli in corso" : "In riproduzione");
    requestAnimationFrame(loop);
  }
}

function resetRide() {
  state.playing = false;
  releaseWakeLock();
  $("btnPlay").textContent = "▶  Play";
  state.riderDistance = 0;
  state.riderSpeedKmh = 0;
  state.calories = 0;
  state.elapsed = 0;
  state.samples = [];
  state.lastSampleTime = 0;
  state.lastFrameTime = 0;
  state.lastPersistTime = 0;
  state.sessionSaved = false;
  state.lastActivity = null;
  state.ftpTestResult = null;
  resetCharts();
  if (state.sync) {
    state.sync.pause();
    state.sync.seekToDistance(0);
  }
  if (intervalView) {
    intervalView.setPlan(state.intervalPlan);
    intervalView.setElapsed(0);
  }
  if (intervalZoomChart) intervalZoomChart.setPlan(state.intervalPlan);
  updateHudStatic();
  setSeekInput(0);
  elevChart.setPosition(0);
  if (state.mapView) state.mapView.reset();
  clearSession();
  setStatus("Reset");
}

function resetCharts() {
  chartPower.clear();
}

function clampSlope(rawSlopePct) {
  return Math.max(-MAX_SLOPE_PCT, Math.min(MAX_SLOPE_PCT, rawSlopePct));
}

function updateSlopeReadout(rawSlopePct) {
  const slopePct = clampSlope(rawSlopePct);
  const slopeMax = rawSlopePct > MAX_SLOPE_PCT;
  $("slopeVal").textContent = `${slopePct.toFixed(1)}%${slopeMax ? " (max)" : ""}`;
  $("slopeVal").classList.toggle("max", slopeMax);
  return { slopePct, slopeMax };
}

// ---------------------------------------------------------------- loop

function loop(now) {
  if (!state.playing) return;
  const dt = Math.min(0.1, (now - (state.lastFrameTime || now)) / 1000);
  state.lastFrameTime = now;
  state.elapsed = (now - state.startWall) / 1000;

  if (state.intervalMode) {
    runIntervalLoop(dt);
    return;
  }

  // Slope
  let rawSlopePct;
  if (state.useAutoSlope) {
    rawSlopePct = state.route.slopeAt(state.riderDistance);
  } else {
    rawSlopePct = Number($("slopeSlider").value) / 10;
  }
  const { slopePct, slopeMax } = updateSlopeReadout(rawSlopePct);

  // Power
  let powerW, cadence, hr;
  if (state.trainerMode && trainer.data.connected) {
    powerW = trainer.data.powerW;
    cadence = trainer.data.cadenceRpm;
    hr = trainer.data.heartRate;
  } else {
    powerW = state.fixedPower;
    cadence = Math.max(50, 90 - slopePct * 3);
    hr = Math.max(90, 100 + powerW * 0.35);
  }

  state.calories += (powerW * dt) / 1000;

  // Speed from physics
  const currentMs = state.riderSpeedKmh / 3.6;
  const newMs = virtualSpeed(currentMs, powerW, slopePct, state.cfg, dt);
  state.riderSpeedKmh = newMs * 3.6;
  state.riderDistance += newMs * dt;

  // Trainer slope
  if (state.trainerMode && trainer.data.connected) {
    trainer.setSimulationSlope(slopePct).catch(() => {});
    if (state.elapsed - state.lastTrainerStatusTime >= 1.0) {
      state.lastTrainerStatusTime = state.elapsed;
      const r = trainer.lastResponse;
      const warn =
        r && r.op === 0x11 && r.result !== 0x01 ? ` — trainer err ${r.result}` : "";
      $("trainerStatus").textContent =
        `pendenza inviata: ${slopePct >= 0 ? "+" : ""}${slopePct.toFixed(1)}%${warn}`;
    }
  }

  // End of route
  let finished = false;
  if (state.riderDistance >= state.route.totalDistance) {
    state.riderDistance = state.route.totalDistance;
    finished = true;
  }

  // Video sync
  if (state.sync) {
    state.sync.sync(state.riderDistance, newMs);
  }

  // 3D map fallback follows the rider while playing
  if (state.mapVisible && state.mapView) {
    state.mapView.update(state.riderDistance, true);
  }

  // HUD + charts
  const elevation = state.route.elevationAt(state.riderDistance);
  hud.set({
    speedKmh: state.riderSpeedKmh,
    powerW,
    cadenceRpm: cadence,
    heartRate: hr,
    distanceKm: state.riderDistance / 1000,
    ascentM: state.route.ascentAt(state.riderDistance),
    totalAscentM: state.route.totalAscent,
    slopePct,
    slopeMax,
    calories: state.calories,
    elapsed: state.elapsed,
    totalDistanceKm: state.route.totalDistance / 1000,
  });
  chartPower.addValue(powerW);
  slopeChart.setPosition(state.riderDistance, slopePct, slopeMax);
  elevChart.setPosition(state.riderDistance);

  // Sample ~1Hz
  if (state.elapsed - state.lastSampleTime >= 1.0) {
    state.lastSampleTime = state.elapsed;
    state.samples.push({
      t: state.elapsed,
      distance: state.riderDistance,
      speed: state.riderSpeedKmh,
      power: powerW,
      cadence,
      heartRate: hr,
      slope: slopePct,
      elevation,
    });
    setSeekInput(state.riderDistance / 1000);
    trackPlace();
    if (state.elapsed - state.lastPersistTime >= 10.0) {
      state.lastPersistTime = state.elapsed;
      persistLastSession();
    }
  }

  if (finished) {
    state.playing = false;
    releaseWakeLock();
    $("btnPlay").textContent = "▶  Play";
    if (state.sync) state.sync.pause();
    saveCurrentActivity(true, true);
    setStatus("🏁 Percorso completato!");
    return;
  }

  requestAnimationFrame(loop);
}

function runIntervalLoop(dt) {
  const plan = state.intervalPlan;
  if (!plan) {
    state.playing = false;
    $("btnPlay").textContent = "▶  Play";
    return;
  }
  const info = phaseAt(plan, state.elapsed);
  const phase = info.phase;
  const slopePct = phase.slopePct;
  const targetW = phase.targetW;
  state.intervalTargetW = targetW;

  let powerW, cadence, hr;
  if (state.trainerMode && trainer.data.connected) {
    powerW = trainer.data.powerW;
    cadence = trainer.data.cadenceRpm;
    hr = trainer.data.heartRate;
  } else {
    powerW = targetW;
    cadence = Math.round((phase.rpmMin + phase.rpmMax) / 2);
    hr = Math.max(90, Math.round(100 + powerW * 0.35));
  }

  state.calories += (powerW * dt) / 1000;

  const currentMs = state.riderSpeedKmh / 3.6;
  const newMs = virtualSpeed(currentMs, powerW, slopePct, state.cfg, dt);
  state.riderSpeedKmh = newMs * 3.6;
  state.riderDistance += newMs * dt;
  if (state.route) {
    state.riderDistance = Math.min(state.route.totalDistance, state.riderDistance);
  }

  // With a real trainer the resistance is the source of truth: estimate the
  // gradient actually felt from power and speed, so the rider can check that
  // repetitions and recoveries really happen at the programmed gradient.
  let actualSlopePct = slopePct;
  if (state.trainerMode && trainer.data.connected) {
    const estimated = slopeFromPowerSpeed(powerW, state.riderSpeedKmh, state.cfg);
    if (Number.isFinite(estimated)) actualSlopePct = clampSlope(estimated);
  }
  const { slopeMax } = updateSlopeReadout(actualSlopePct);

  if (state.trainerMode && trainer.data.connected) {
    if (plan.config.controlMode === "erg") {
      trainer.setTargetPower(targetW).catch(() => {});
    } else {
      trainer.setSimulationSlope(slopePct).catch(() => {});
    }
    if (state.elapsed - state.lastTrainerStatusTime >= 1.0) {
      state.lastTrainerStatusTime = state.elapsed;
      const modeText =
        plan.config.controlMode === "erg"
          ? `${targetW} W target`
          : `pendenza ${slopePct >= 0 ? "+" : ""}${slopePct.toFixed(1)}%`;
      $("trainerStatus").textContent = `intervalli: ${modeText}`;
    }
  }

  const elevation = state.route ? state.route.elevationAt(state.riderDistance) : 0;
  hud.set({
    speedKmh: state.riderSpeedKmh,
    powerW,
    cadenceRpm: cadence,
    heartRate: hr,
    distanceKm: state.riderDistance / 1000,
    ascentM: state.route ? state.route.ascentAt(state.riderDistance) : 0,
    totalAscentM: state.route ? state.route.totalAscent : 0,
    slopePct: actualSlopePct,
    slopeMax,
    calories: state.calories,
    elapsed: state.elapsed,
    totalDistanceKm: state.route ? state.route.totalDistance / 1000 : 0,
  });
  chartPower.addValue(powerW);
  if (state.route) {
    slopeChart.setPosition(state.riderDistance, actualSlopePct, slopeMax);
    elevChart.setPosition(state.riderDistance);
  }
  const intervalElapsed = Math.min(state.elapsed, plan.totalSec);
  const intervalLive = {
    powerW,
    cadence,
    heartRate: hr,
    targetW,
    ftpPct: phase.ftpPct,
    rpmMin: phase.rpmMin,
    rpmMax: phase.rpmMax,
    slopePct: actualSlopePct,
    targetSlopePct: slopePct,
    t: state.elapsed,
  };
  intervalView.setElapsed(intervalElapsed);
  intervalView.setLive(intervalLive);
  intervalZoomChart.setElapsed(intervalElapsed);
  intervalZoomChart.setLive(intervalLive);

  if (state.elapsed - state.lastSampleTime >= 1.0) {
    state.lastSampleTime = state.elapsed;
    state.samples.push({
      t: state.elapsed,
      distance: state.riderDistance,
      speed: state.riderSpeedKmh,
      power: powerW,
      cadence,
      heartRate: hr,
      slope: actualSlopePct,
      targetSlope: slopePct,
      targetW,
      ftpPct: phase.ftpPct,
      elevation,
      interval: phase.phaseName,
      series: phase.seriesIndex,
    });
    if (state.route) {
      setSeekInput(state.riderDistance / 1000);
      trackPlace();
    }
    if (state.elapsed - state.lastPersistTime >= 10.0) {
      state.lastPersistTime = state.elapsed;
      persistLastSession();
    }
  }

  if (state.elapsed >= plan.totalSec) {
    state.elapsed = plan.totalSec;
    state.playing = false;
    releaseWakeLock();
    $("btnPlay").textContent = "▶  Play";
    intervalView.setElapsed(plan.totalSec);
    const ftpResult = plan.kind === "ftptest" ? computeFtpTestResult(plan) : null;
    state.ftpTestResult = ftpResult;
    saveCurrentActivity(true, !ftpResult);
    if (ftpResult) showFtpTestSummary(ftpResult);
    setStatus(
      ftpResult
        ? `🏁 Test FTP completato — stimato ${ftpResult.ftpW} W`
        : "🏁 Allenamento a intervalli completato!"
    );
    return;
  }

  requestAnimationFrame(loop);
}

function computeFtpTestResult(plan) {
  if (!plan || !plan.testWindow) return null;
  const { start, end } = plan.testWindow;
  const values = (state.samples || [])
    .filter((s) => s.t >= start - 1 && s.t <= end + 1)
    .map((s) => Number(s.power))
    .filter((w) => Number.isFinite(w) && w > 0);
  if (!values.length) return null;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return { avg20W: Math.round(avg), ftpW: Math.round(avg * 0.95) };
}

function applyFtpResult(watts) {
  const w = Math.max(50, Math.round(Number(watts) || 0));
  const cfg = normalizeIntervalConfig({ ...state.intervalConfig, ftpW: w, kind: "interval" });
  saveSettings({ intervalConfig: cfg, ftpW: w });
  state.intervalConfig = cfg;
  state.intervalPlan = buildIntervalPlan(cfg);
  intervalView.setPlan(state.intervalPlan);
  intervalZoomChart.setPlan(state.intervalPlan);
  state.fixedPower = Math.min(MAX_POWER_W, w);
  $("powerSlider").value = String(state.fixedPower);
  $("powerVal").textContent = `${state.fixedPower} W`;
  updateModeControls();
  setStatus(`FTP impostato: ${w} W`);
}

function showFtpTestSummary(result) {
  const body = el("div");
  const grid = el("div", "stat-grid");
  grid.append(
    statCard("Potenza media 20 min", `${result.avg20W} W`),
    statCard("FTP stimato (95%)", `${result.ftpW} W`)
  );
  body.append(grid);
  body.append(
    el(
      "p",
      "empty",
      "Il test usa la media della potenza nei 20 minuti di sforzo costante " +
        "sul 2% di pendenza. FTP stimato = media × 0,95."
    )
  );
  const foot = [
    mkButton(`Imposta FTP ${result.ftpW} W`, "btn green", () => {
      applyFtpResult(result.ftpW);
      closeModal();
    }),
    mkButton("Ripeti test", "btn blue", () => {
      closeModal();
      startFtpTest();
    }),
    mkButton("Chiudi", "btn gray", closeModal),
  ];
  openModal("Risultato test FTP", body, foot);
}

function updateHudStatic() {
  if (state.intervalMode) {
    updateIntervalHudStatic();
    return;
  }
  if (!state.route) return;
  const { slopePct, slopeMax } = updateSlopeReadout(
    state.route.slopeAt(state.riderDistance)
  );
  hud.set({
    speedKmh: state.riderSpeedKmh,
    powerW: state.trainerMode && trainer.data.connected ? trainer.data.powerW : state.fixedPower,
    cadenceRpm: state.trainerMode && trainer.data.connected ? trainer.data.cadenceRpm : 0,
    distanceKm: state.riderDistance / 1000,
    ascentM: state.route.ascentAt(state.riderDistance),
    totalAscentM: state.route.totalAscent,
    slopePct,
    slopeMax,
    calories: state.calories,
    elapsed: state.elapsed,
    totalDistanceKm: state.route.totalDistance / 1000,
  });
  elevChart.setPosition(state.riderDistance);
  slopeChart.setPosition(state.riderDistance, slopePct, slopeMax);
  trackPlace();
}

function updateIntervalHudStatic() {
  const plan = state.intervalPlan;
  if (!plan) return;
  const info = phaseAt(plan, state.elapsed);
  if (!info) return;
  const phase = info.phase;
  const slopePct = phase.slopePct;
  const { slopeMax } = updateSlopeReadout(slopePct);
  const powerW =
    state.trainerMode && trainer.data.connected ? trainer.data.powerW : phase.targetW;
  const cadence =
    state.trainerMode && trainer.data.connected
      ? trainer.data.cadenceRpm
      : Math.round((phase.rpmMin + phase.rpmMax) / 2);
  const hr =
    state.trainerMode && trainer.data.connected
      ? trainer.data.heartRate
      : Math.max(90, Math.round(100 + powerW * 0.35));
  hud.set({
    speedKmh: state.riderSpeedKmh,
    powerW,
    cadenceRpm: cadence,
    heartRate: hr,
    distanceKm: state.riderDistance / 1000,
    ascentM: state.route ? state.route.ascentAt(state.riderDistance) : 0,
    totalAscentM: state.route ? state.route.totalAscent : 0,
    slopePct,
    slopeMax,
    calories: state.calories,
    elapsed: state.elapsed,
    totalDistanceKm: state.route ? state.route.totalDistance / 1000 : 0,
  });
  if (state.route) {
    elevChart.setPosition(state.riderDistance);
    slopeChart.setPosition(state.riderDistance, slopePct, slopeMax);
    trackPlace();
  }
  intervalView.setElapsed(Math.min(state.elapsed, plan.totalSec));
  intervalView.setLive({
    powerW,
    cadence,
    heartRate: hr,
    targetW: phase.targetW,
    ftpPct: phase.ftpPct,
    rpmMin: phase.rpmMin,
    rpmMax: phase.rpmMax,
    slopePct,
    targetSlopePct: slopePct,
  });
}

// ------------------------------------------------------------- trainer

function updateTrainerAvailability() {
  if (!WEB_BLUETOOTH_AVAILABLE) {
    $("btnTrainer").disabled = true;
    $("btnTrainer").textContent = "BLE non disponibile";
    $("trainerStatus").textContent =
      "Web Bluetooth non disponibile (serve Chrome e http://localhost)";
  }
}

async function toggleTrainer() {
  if (trainer.data.connected) {
    trainer.disconnect();
    state.trainerMode = false;
    $("btnTrainer").textContent = "Connetti trainer";
    $("trainerStatus").textContent = "disconnesso";
    return;
  }
  try {
    $("trainerStatus").textContent = "ricerca...";
    const name = await trainer.connect();
    state.trainerMode = true;
    $("btnTrainer").textContent = "Disconnetti";
    $("trainerStatus").textContent = `connesso a ${name || "trainer"}`;
  } catch (e) {
    $("trainerStatus").textContent = `errore: ${e.message}`;
  }
}

// ---------------------------------------------------------------- saving

function average(list) {
  if (!list.length) return 0;
  return list.reduce((a, b) => a + b, 0) / list.length;
}

function buildActivity(finished) {
  const samples = state.samples || [];
  const powers = samples.map((s) => s.power).filter(Number.isFinite);
  const speeds = samples.map((s) => s.speed).filter(Number.isFinite);
  const cadences = samples.map((s) => s.cadence).filter(Number.isFinite);
  const isInterval = state.intervalMode;
  const plan = state.intervalPlan;
  const routeName = isInterval
    ? (plan ? plan.name : "Intervalli")
    : state.routeName || "Percorso";
  return {
    id:
      state.lastActivity && state.lastActivity.id
        ? state.lastActivity.id
        : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: `${routeName} ${new Date().toLocaleString()}`,
    routeName,
    type: isInterval ? "interval" : "route",
    interval: isInterval && plan
      ? {
          totalSec: plan.totalSec,
          config: plan.config,
          repsPerSeries: plan.repsPerSeries,
        }
      : null,
    ftpTest:
      isInterval && plan && plan.kind === "ftptest" ? computeFtpTestResult(plan) : null,
    date: Date.now(),
    duration: state.elapsed,
    distance: state.riderDistance,
    ascent: state.route ? state.route.ascentAt(state.riderDistance) : 0,
    totalAscent: state.route ? state.route.totalAscent : 0,
    calories: state.calories,
    avgPower: average(powers),
    maxPower: powers.length ? Math.max(...powers) : 0,
    avgSpeed: average(speeds),
    maxSpeed: speeds.length ? Math.max(...speeds) : 0,
    avgCadence: average(cadences),
    finished: !!finished,
    samples: downsample(samples, 2000),
    track: state.route ? sampleTrack(state.route) : [],
  };
}

function saveCurrentActivity(finished, showSummary) {
  if (!state.route && !state.intervalMode) return null;
  if (state.elapsed < 1 && state.samples.length === 0) {
    setStatus("Niente da salvare: avvia l'allenamento");
    return null;
  }
  const rec = buildActivity(finished);
  upsertActivity(rec);
  state.sessionSaved = true;
  state.lastActivity = rec;
  if (finished) clearSession();
  $("resumeBar").hidden = true;
  setStatus("Attività salvata nello storico");
  if (showSummary) showSummaryModal(rec);
  return rec;
}

function persistLastSession() {
  if (state.intervalMode) return;
  if (!state.route || !state.gpxText || state.sessionSaved) return;
  saveSession({
    routeName: state.routeName,
    gpx: state.gpxText,
    riderDistance: state.riderDistance,
    elapsed: state.elapsed,
    calories: state.calories,
    samples: state.samples,
    power: state.fixedPower,
    mass: state.cfg.massKg,
    useAutoSlope: state.useAutoSlope,
  });
}

function fmtDuration(seconds) {
  const t = Math.max(0, Math.floor(Number(seconds) || 0));
  const hh = String(Math.floor(t / 3600)).padStart(2, "0");
  const mm = String(Math.floor((t % 3600) / 60)).padStart(2, "0");
  const ss = String(t % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function fmtDistance(meters) {
  return `${((Number(meters) || 0) / 1000).toFixed(2)} km`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function mkButton(label, className, handler, disabled) {
  const btn = el("button", className || "btn gray", label);
  btn.type = "button";
  btn.disabled = !!disabled;
  if (handler) btn.addEventListener("click", handler);
  return btn;
}

function statCard(label, value) {
  const card = el("div", "stat");
  card.append(el("b", null, value), el("span", null, label));
  return card;
}

function openModal(title, body, foot) {
  $("modalTitle").textContent = title;
  $("modalBody").replaceChildren(body || document.createDocumentFragment());
  $("modalFoot").replaceChildren(...(Array.isArray(foot) ? foot : foot ? [foot] : []));
  $("modalBackdrop").hidden = false;
  state.modalOpen = true;
  $("modalClose").focus();
}

function closeModal() {
  $("modalBackdrop").hidden = true;
  state.modalOpen = false;
}

function showSummaryModal(rec) {
  const body = el("div");
  const grid = el("div", "stat-grid");
  grid.append(
    statCard("Distanza", fmtDistance(rec.distance)),
    statCard("Tempo", fmtDuration(rec.duration)),
    statCard("Dislivello", `${Math.round(rec.ascent)} m`),
    statCard("Calorie", `${Math.round(rec.calories)} kcal`),
    statCard("Potenza media", `${Math.round(rec.avgPower)} W`),
    statCard("Potenza max", `${Math.round(rec.maxPower)} W`),
    statCard("Velocità media", `${Number(rec.avgSpeed || 0).toFixed(1)} km/h`),
    statCard("Velocità max", `${Number(rec.maxSpeed || 0).toFixed(1)} km/h`),
    statCard("Cadenza media", `${Math.round(rec.avgCadence || 0)} rpm`)
  );
  body.append(grid);
  const foot = [
    mkButton("Esporta CSV", "btn green", () => exportActivityCSV(rec)),
    mkButton(
      "Esporta GPX",
      "btn blue",
      () => exportActivityGPX(rec),
      !rec.track || rec.track.length < 2
    ),
    mkButton("Chiudi", "btn gray", closeModal),
  ];
  openModal("Riepilogo attività", body, foot);
}

function openHistory() {
  const acts = loadActivities();
  const body = el("div", "activity-list");
  if (!acts.length) {
    body.append(
      el("p", "empty", "Nessuna attività salvata. Pedala e premi Salva (o completa un percorso).")
    );
  } else {
    for (const a of acts) body.append(activityCard(a));
  }
  const foot = [
    mkButton("Esporta riepilogo CSV", "btn green", () => exportSummaryCSV(acts), !acts.length),
    mkButton(
      "Svuota storico",
      "btn red",
      () => {
        if (confirm("Eliminare tutte le attività salvate?")) {
          clearActivities();
          openHistory();
        }
      },
      !acts.length
    ),
    mkButton("Chiudi", "btn gray", closeModal),
  ];
  openModal("Storico attività", body, foot);
}

function activityCard(a) {
  const card = el("div", "activity");
  const head = el("div", "activity-head");
  head.append(el("b", null, a.routeName || a.name || "Percorso"));
  head.append(el("span", "activity-date", new Date(a.date || Date.now()).toLocaleString()));
  card.append(head);
  const meta = [
    fmtDistance(a.distance || 0),
    fmtDuration(a.duration || 0),
    `${Math.round(a.avgPower || 0)} W medi`,
    `${Math.round(a.maxPower || 0)} W max`,
    `${Number(a.avgSpeed || 0).toFixed(1)} km/h`,
    `${Math.round(a.ascent || 0)} m D+`,
  ].join(" · ");
  card.append(el("div", "activity-meta", meta));
  const actions = el("div", "activity-actions");
  actions.append(mkButton("CSV", "btn green", () => exportActivityCSV(a)));
  actions.append(mkButton("GPX", "btn blue", () => exportActivityGPX(a), !a.track || a.track.length < 2));
  actions.append(
    mkButton("Elimina", "btn red", () => {
      if (confirm("Eliminare questa attività?")) {
        deleteActivity(a.id);
        openHistory();
      }
    })
  );
  card.append(actions);
  return card;
}

function fileStamp(act) {
  const d = new Date(act && act.date ? act.date : Date.now());
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function exportActivityCSV(act) {
  const name = `ridevideo-${safeFileName(act.routeName || "giro")}-${fileStamp(act)}.csv`;
  downloadText(name, activityToCSV(act), "text/csv;charset=utf-8");
  setStatus("CSV esportato");
}

function exportActivityGPX(act) {
  const gpx = activityToGPX(act);
  if (!gpx) {
    setStatus("GPX non disponibile per questa attività");
    return;
  }
  const name = `ridevideo-${safeFileName(act.routeName || "giro")}-${fileStamp(act)}.gpx`;
  downloadText(name, gpx, "application/gpx+xml");
  setStatus("GPX esportato");
}

function exportSummaryCSV(acts) {
  const name = `ridevideo-attivita-${fileStamp({ date: Date.now() })}.csv`;
  downloadText(name, activitiesSummaryCSV(acts), "text/csv;charset=utf-8");
  setStatus("Riepilogo CSV esportato");
}

function setupResume() {
  const snap = loadSession();
  if (!snap || !(snap.riderDistance > 1)) {
    $("resumeBar").hidden = true;
    return;
  }
  state.pendingSession = snap;
  const when = new Date(snap.savedAt || Date.now()).toLocaleString();
  $("resumeText").textContent =
    `Sessione interrotta: ${snap.routeName} · ${fmtDistance(snap.riderDistance)} · ${when}`;
  $("resumeBar").hidden = false;
}

function dismissResume() {
  state.pendingSession = null;
  $("resumeBar").hidden = true;
  clearSession();
  setStatus("Sessione precedente ignorata");
}

function resumeSession() {
  const snap = state.pendingSession;
  if (!snap) return;
  try {
    const route = parseGPX(snap.gpx);
    applyRoute(route, snap.gpx, snap.routeName || route.name);
    state.riderDistance = Math.max(0, Math.min(route.totalDistance, Number(snap.riderDistance) || 0));
    state.elapsed = Math.max(0, Number(snap.elapsed) || 0);
    state.calories = Math.max(0, Number(snap.calories) || 0);
    state.samples = Array.isArray(snap.samples) ? snap.samples : [];
    state.lastActivity = null;
    state.sessionSaved = false;
    state.lastSampleTime = state.elapsed;
    state.lastFrameTime = 0;
    state.lastPersistTime = state.elapsed;
    if (Number.isFinite(snap.power)) {
      state.fixedPower = Math.max(0, Math.min(MAX_POWER_W, snap.power));
      $("powerSlider").value = String(state.fixedPower);
      $("powerVal").textContent = `${state.fixedPower} W`;
    }
    if (Number.isFinite(snap.mass)) {
      state.cfg.massKg = Math.max(MIN_MASS_KG, Math.min(MAX_MASS_KG, snap.mass));
      $("massSlider").value = String(state.cfg.massKg);
      $("massVal").textContent = `${state.cfg.massKg} kg`;
    }
    if (typeof snap.useAutoSlope === "boolean") {
      state.useAutoSlope = snap.useAutoSlope;
      $("btnSlopeMode").textContent = state.useAutoSlope
        ? "Pendenza: Auto da GPX"
        : "Pendenza: Manuale";
      $("slopeSlider").disabled = state.useAutoSlope;
    }
    state.pendingSession = null;
    $("resumeBar").hidden = true;
    seekToDistance(state.riderDistance);
    updateHudStatic();
    persistLastSession();
    setStatus(`Sessione ripristinata: ${state.routeName}`);
  } catch (err) {
    setStatus(`Ripresa non riuscita: ${err.message}`);
  }
}

// ---------------------------------------------------------------- utils

function setStatus(msg) {
  $("status").textContent = msg;
}

window.addEventListener("DOMContentLoaded", init);
