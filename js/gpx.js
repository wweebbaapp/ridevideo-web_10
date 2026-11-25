// GPX parser and route model. Works in browser and Node (via DOMParser shim).
//
// Mirrors gpx_track.py: cumulative distances (haversine), smoothed slopes,
// interpolation helpers.

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000.0;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export class Route {
  constructor(name = "Route") {
    this.name = name;
    this.points = []; // {lat, lon, ele, distance, slope}
    this.totalDistance = 0.0;
    this.totalAscent = 0.0;
    this.totalDescent = 0.0;
    this._distances = null; // cached arrays
    this._eles = null;
    this._slopes = null;
    this._lats = null;
    this._lons = null;
    this._ascents = null;
  }

  _ensureCache() {
    if (this._distances) return;
    this._distances = this.points.map((p) => p.distance);
    this._eles = this.points.map((p) => p.ele);
    this._slopes = this.points.map((p) => p.slope);
    this._lats = this.points.map((p) => p.lat);
    this._lons = this.points.map((p) => p.lon);
    this._ascents = this.points.map((p) => p.ascent ?? 0);
  }

  _interp(x, xs, ys) {
    if (!this.points.length) return 0.0;
    const d = Math.min(Math.max(x, 0), this.totalDistance);
    // binary search
    let lo = 0;
    let hi = xs.length - 1;
    if (d <= xs[0]) return ys[0];
    if (d >= xs[hi]) return ys[hi];
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= d) lo = mid;
      else hi = mid;
    }
    const span = xs[hi] - xs[lo];
    const t = span > 0 ? (d - xs[lo]) / span : 0;
    return ys[lo] + (ys[hi] - ys[lo]) * t;
  }

  elevationAt(distance) {
    this._ensureCache();
    return this._interp(distance, this._distances, this._eles);
  }

  slopeAt(distance) {
    this._ensureCache();
    return this._interp(distance, this._distances, this._slopes);
  }

  ascentAt(distance) {
    this._ensureCache();
    return this._interp(distance, this._distances, this._ascents);
  }

  latLonAt(distance) {
    this._ensureCache();
    return {
      lat: this._interp(distance, this._distances, this._lats),
      lon: this._interp(distance, this._distances, this._lons),
    };
  }
}

export function buildRouteFromPoints(name, rawPoints) {
  // rawPoints: [{lat, lon, ele}]
  const route = new Route(name);
  if (rawPoints.length < 2) throw new Error("Servono almeno 2 punti traccia");

  let cumulative = 0.0;
  for (let i = 0; i < rawPoints.length; i++) {
    const p = rawPoints[i];
    if (i > 0) {
      const prev = rawPoints[i - 1];
      cumulative += haversine(prev.lat, prev.lon, p.lat, p.lon);
    }
    route.points.push({
      lat: p.lat,
      lon: p.lon,
      ele: p.ele ?? 0,
      distance: cumulative,
      slope: 0,
    });
  }
  route.totalDistance = cumulative;

  // Smoothed slopes
  const n = route.points.length;
  const window = Math.max(1, Math.floor(n / 100));
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - window);
    const end = Math.min(n - 1, i + window);
    const dSpan = route.points[end].distance - route.points[start].distance;
    const eSpan = route.points[end].ele - route.points[start].ele;
    route.points[i].slope = dSpan > 0 ? (eSpan / dSpan) * 100.0 : 0;
  }

  let ascent = 0;
  route.points[0].ascent = 0;
  for (let i = 1; i < n; i++) {
    const delta = route.points[i].ele - route.points[i - 1].ele;
    if (delta > 0) ascent += delta;
    else route.totalDescent += Math.abs(delta);
    route.points[i].ascent = ascent;
  }
  route.totalAscent = ascent;
  return route;
}

// Parse GPX XML text into a Route.
export function parseGPX(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const nameEl = doc.querySelector("trk > name") || doc.querySelector("metadata > name");
  const name = nameEl ? nameEl.textContent : "Percorso";

  const rawPoints = [];
  const trkpts = doc.querySelectorAll("trkpt");
  const rtepts = doc.querySelectorAll("rtept");
  const nodes = trkpts.length ? trkpts : rtepts;
  nodes.forEach((pt) => {
    const lat = parseFloat(pt.getAttribute("lat"));
    const lon = parseFloat(pt.getAttribute("lon"));
    const eleEl = pt.querySelector("ele");
    const ele = eleEl ? parseFloat(eleEl.textContent) : 0;
    if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
      rawPoints.push({ lat, lon, ele });
    }
  });

  return buildRouteFromPoints(name, rawPoints);
}
