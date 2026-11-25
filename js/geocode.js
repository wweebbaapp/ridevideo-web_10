// Reverse geocoding: which town / locality is the rider crossing?
//
// The map tiles already need an internet connection, so a lightweight reverse
// geocoder is acceptable here. We use the free BigDataCloud client endpoint
// first (no API key, CORS enabled) and fall back to Nominatim. Requests are
// cached per geographic cell and throttled, so we never hammer the services:
// the town is only looked up again after moving a few hundred metres.

const BDC_URL = "https://api.bigdatacloud.net/data/reverse-geocode-client";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";

const CELL_DEG = 0.02; // ~2 km grid: one request per cell
const MIN_INTERVAL_MS = 4000;

function cellKey(lat, lon) {
  return `${Math.round(lat / CELL_DEG)}:${Math.round(lon / CELL_DEG)}`;
}

// Best-effort town / municipality name from a BigDataCloud response.
function bdcTown(d) {
  const admin =
    d.localityInfo && Array.isArray(d.localityInfo.administrative)
      ? d.localityInfo.administrative
      : [];
  const byLevel = (level) => {
    const hit = admin.find((a) => Number(a.adminLevel) === level);
    return (hit && hit.name) || "";
  };
  // city/locality are the town for most places; the admin levels cover small
  // comuni where both are empty.
  return d.city || d.locality || byLevel(8) || byLevel(7) || "";
}

export class PlaceTracker {
  constructor(onChange) {
    this.onChange = typeof onChange === "function" ? onChange : () => {};
    this.info = null;
    this._cache = new Map();
    this._lastCell = "";
    this._pending = null;
    this._inflight = false;
    this._lastRequestAt = 0;
    this._timer = 0;
  }

  get current() {
    return this.info;
  }

  // Called with the rider position (usually once per second). It returns the
  // last known town immediately and schedules a lookup when needed.
  update(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return this.info;
    const key = cellKey(lat, lon);
    if (key === this._lastCell) return this.info;
    this._lastCell = key;
    if (this._cache.has(key)) {
      this._set(this._cache.get(key));
      return this.info;
    }
    this._pending = { lat, lon, key };
    this._flush();
    return this.info;
  }

  _set(info) {
    if (!info) return;
    const prev = this.info;
    this.info = info;
    if (!prev || prev.place !== info.place || prev.region !== info.region) {
      this.onChange(info);
    }
  }

  _flush() {
    if (this._inflight || !this._pending) return;
    const wait = Math.max(
      0,
      MIN_INTERVAL_MS - (Date.now() - this._lastRequestAt)
    );
    if (wait > 0) {
      if (!this._timer) {
        this._timer = setTimeout(() => {
          this._timer = 0;
          this._flush();
        }, wait);
      }
      return;
    }
    const job = this._pending;
    this._pending = null;
    this._lastRequestAt = Date.now();
    this._inflight = true;
    this._lookup(job.lat, job.lon)
      .then((info) => {
        if (info && info.place) {
          this._cache.set(job.key, info);
          this._set(info);
        } else if (this._lastCell === job.key) {
          // Allow a retry on the next call, still rate-limited.
          this._lastCell = "";
        }
      })
      .catch(() => {
        if (this._lastCell === job.key) this._lastCell = "";
      })
      .then(() => {
        this._inflight = false;
        if (this._pending) this._flush();
      });
  }

  async _lookup(lat, lon) {
    const bdc = await this._lookupBigDataCloud(lat, lon);
    if (bdc) return bdc;
    return this._lookupNominatim(lat, lon);
  }

  async _lookupBigDataCloud(lat, lon) {
    try {
      const url = new URL(BDC_URL);
      url.searchParams.set("latitude", lat.toFixed(5));
      url.searchParams.set("longitude", lon.toFixed(5));
      url.searchParams.set("localityLanguage", "it");
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) return null;
      const d = await res.json();
      const place = bdcTown(d) || d.principalSubdivision || "";
      if (!place) return null;
      return {
        place,
        region: d.principalSubdivision || d.countryName || "",
        country: d.countryName || "",
        countryCode: String(d.countryCode || "").toUpperCase(),
        source: "bigdatacloud",
      };
    } catch (e) {
      return null;
    }
  }

  async _lookupNominatim(lat, lon) {
    try {
      const url = new URL(NOMINATIM_URL);
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("lat", lat.toFixed(5));
      url.searchParams.set("lon", lon.toFixed(5));
      url.searchParams.set("zoom", "14");
      url.searchParams.set("addressdetails", "1");
      url.searchParams.set("accept-language", "it");
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) return null;
      const d = await res.json();
      const a = d.address || {};
      const place =
        a.city ||
        a.town ||
        a.village ||
        a.municipality ||
        a.hamlet ||
        a.suburb ||
        a.county ||
        a.state ||
        "";
      if (!place) return null;
      return {
        place,
        region: a.state || a.region || a.county || a.country || "",
        country: a.country || "",
        countryCode: String(a.country_code || "").toUpperCase(),
        source: "nominatim",
      };
    } catch (e) {
      return null;
    }
  }
}
