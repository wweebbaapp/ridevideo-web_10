const ACTIVITIES_KEY = "ridevideo_activities";
const SETTINGS_KEY = "ridevideo_settings";
const SESSION_KEY = "ridevideo_last_session";
const MAX_ACTIVITIES = 40;
const MAX_SAMPLES = 2000;
const MAX_TRACK = 800;

function round(v, digits = 0) {
  const f = 10 ** digits;
  return Math.round((Number(v) || 0) * f) / f;
}

export function downsample(list, max) {
  if (!Array.isArray(list)) return [];
  if (list.length <= max) return list.slice();
  const out = [];
  const step = list.length / max;
  for (let i = 0; i < max; i++) out.push(list[Math.floor(i * step)]);
  const last = list[list.length - 1];
  out[out.length - 1] = last;
  return out;
}

export function loadActivities() {
  try {
    const raw = JSON.parse(localStorage.getItem(ACTIVITIES_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    return [];
  }
}

function persistActivities(acts) {
  try {
    localStorage.setItem(ACTIVITIES_KEY, JSON.stringify(acts));
    return true;
  } catch (e) {
    while (acts.length > 1) {
      acts.pop();
      try {
        localStorage.setItem(ACTIVITIES_KEY, JSON.stringify(acts));
        return true;
      } catch (err) {
        // keep dropping the oldest entries
      }
    }
    return false;
  }
}

export function upsertActivity(record) {
  if (!record || !record.id) return null;
  const acts = loadActivities();
  const i = acts.findIndex((a) => a.id === record.id);
  if (i >= 0) acts[i] = record;
  else acts.unshift(record);
  if (acts.length > MAX_ACTIVITIES) acts.length = MAX_ACTIVITIES;
  persistActivities(acts);
  return record;
}

export function deleteActivity(id) {
  const acts = loadActivities().filter((a) => a.id !== id);
  persistActivities(acts);
  return acts;
}

export function clearActivities() {
  try {
    localStorage.removeItem(ACTIVITIES_KEY);
  } catch (e) {
    // storage unavailable
  }
}

export function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return s && typeof s === "object" ? s : {};
  } catch (e) {
    return {};
  }
}

export function saveSettings(patch) {
  try {
    const next = { ...loadSettings(), ...patch };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    return next;
  } catch (e) {
    return {};
  }
}

export function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    return s && s.gpx && s.routeName ? s : null;
  } catch (e) {
    return null;
  }
}

export function saveSession(snap) {
  try {
    const data = {
      ...snap,
      savedAt: Date.now(),
      samples: downsample(snap.samples, MAX_SAMPLES),
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch (e) {
    // session autosave is best effort
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (e) {
    // storage unavailable
  }
}

export function sampleTrack(route, maxPoints = MAX_TRACK) {
  if (!route || !Array.isArray(route.points) || !route.points.length) return [];
  const step = Math.max(1, Math.ceil(route.points.length / maxPoints));
  const out = [];
  for (let i = 0; i < route.points.length; i += step) {
    const p = route.points[i];
    out.push([round(p.lat, 6), round(p.lon, 6), round(p.ele ?? 0, 1), round(p.distance, 1)]);
  }
  const last = route.points[route.points.length - 1];
  out.push([round(last.lat, 6), round(last.lon, 6), round(last.ele ?? 0, 1), round(last.distance, 1)]);
  return out;
}

function csvCell(value) {
  if (value === null || value === undefined || value === "") return "";
  const s = typeof value === "number" ? String(round(value, 3)) : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function activityToCSV(activity) {
  const rows = [
    ["t_s", "dist_m", "speed_kmh", "power_w", "cadence_rpm", "heart_rate_bpm", "slope_pct", "elevation_m"],
  ];
  for (const s of activity.samples || []) {
    rows.push([
      s.t,
      s.distance,
      s.speed,
      s.power,
      s.cadence,
      s.heartRate,
      s.slope,
      s.elevation,
    ]);
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}

export function activitiesSummaryCSV(activities) {
  const rows = [
    [
      "data",
      "percorso",
      "durata_s",
      "distanza_m",
      "dislivello_m",
      "calorie_kcal",
      "potenza_media_w",
      "potenza_max_w",
      "velocita_media_kmh",
      "velocita_max_kmh",
      "cadenza_media_rpm",
      "completato",
    ],
  ];
  for (const a of activities || []) {
    rows.push([
      new Date(a.date || Date.now()).toLocaleString(),
      a.routeName || a.name || "",
      a.duration || 0,
      a.distance || 0,
      a.ascent || 0,
      a.calories || 0,
      a.avgPower || 0,
      a.maxPower || 0,
      a.avgSpeed || 0,
      a.maxSpeed || 0,
      a.avgCadence || 0,
      a.finished ? "si" : "no",
    ]);
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}

function xmlEscape(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function activityToGPX(activity) {
  const track = Array.isArray(activity.track) ? activity.track : [];
  if (!track.length) return null;
  const limit = Number.isFinite(activity.distance) && activity.distance > 0 ? activity.distance : Infinity;
  const points = track.filter((p) => Number(p[3]) <= limit + 0.5);
  const use = points.length > 1 ? points : track;
  const body = use
    .map(
      (p) =>
        `      <trkpt lat="${round(p[0], 6)}" lon="${round(p[1], 6)}"><ele>${round(p[2], 1)}</ele></trkpt>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RideVideo Web" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${xmlEscape(activity.routeName || "RideVideo")}</name>
  </metadata>
  <trk>
    <name>${xmlEscape(activity.routeName || "RideVideo")}</name>
    <trkseg>
${body}
    </trkseg>
  </trk>
</gpx>`;
}

export function safeFileName(text, fallback = "ridevideo") {
  const base = String(text || fallback)
    .normalize("NFKD")
    .replace(/[^\w\s.-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return base || fallback;
}

export function downloadText(filename, text, type = "text/plain") {
  try {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) {
    // download unavailable
  }
}
