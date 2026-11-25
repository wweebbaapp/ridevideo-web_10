// 3D map view used when no video is available.
//
// MapLibre GL JS (bundled locally in vendor/maplibre) draws the route on a
// free OpenStreetMap raster basemap with 3D terrain from the AWS Terrain
// Tiles dataset. No API key or Cesium ion account is required; the map tiles
// are downloaded from the internet while riding.

import * as maplibregl from "../vendor/maplibre/maplibre-gl.mjs";

const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const DEM_TILES =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

const ROUTE_COLOR = "#ffc832";

function bearingBetween(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function routeGeoJSON(route) {
  const coords = [];
  const step = Math.max(1, Math.ceil(route.points.length / 6000));
  for (let i = 0; i < route.points.length; i += step) {
    const p = route.points[i];
    coords.push([p.lon, p.lat]);
  }
  const last = route.points[route.points.length - 1];
  coords.push([last.lon, last.lat]);
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: coords },
  };
}

export class MapView {
  constructor(container, route, onError) {
    this.container = container;
    this.route = route;
    this.onError = onError || (() => {});
    this.loaded = false;
    this.follow = true;
    this.onFollowChange = null;
    this.lastBearing = 0;
    this.lastCameraAt = 0;
    this.errorShown = false;
    this.placeInfo = null;
    this.userZoom = null;

    this.map = new maplibregl.Map({
      container,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: [OSM_TILES],
            tileSize: 256,
            maxzoom: 19,
            attribution: "© OpenStreetMap contributors",
          },
          terrain: {
            type: "raster-dem",
            tiles: [DEM_TILES],
            tileSize: 256,
            encoding: "terrarium",
            maxzoom: 15,
          },
          hillshade: {
            type: "raster-dem",
            tiles: [DEM_TILES],
            tileSize: 256,
            encoding: "terrarium",
            maxzoom: 15,
          },
          route: { type: "geojson", data: routeGeoJSON(route) },
        },
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#dfe6e9" },
          },
          { id: "osm", type: "raster", source: "osm" },
          {
            id: "hillshade",
            type: "hillshade",
            source: "hillshade",
            paint: {
              "hillshade-exaggeration": 0.22,
              "hillshade-shadow-color": "#3a3f52",
              "hillshade-highlight-color": "#ffffff",
              "hillshade-accent-color": "#5a6070",
            },
          },
          {
            id: "route-casing",
            type: "line",
            source: "route",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": "#001018",
              "line-width": 9,
              "line-opacity": 0.85,
            },
          },
          {
            id: "route-line",
            type: "line",
            source: "route",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": ROUTE_COLOR, "line-width": 5 },
          },
        ],
        terrain: { source: "terrain", exaggeration: 1.3 },
        sky: {},
      },
      center: [route.points[0].lon, route.points[0].lat],
      zoom: 13,
      pitch: 55,
      bearing: 0,
      maxPitch: 85,
      attributionControl: false,
      antialias: true,
    });

    // Small place badge in the corner (the map itself has no names at the
    // high zoom used while riding).
    this.placeEl = document.createElement("div");
    this.placeEl.className = "map-place";
    this.placeEl.textContent = "—";
    container.appendChild(this.placeEl);

    // Dragging/rotating the map pauses the automatic follow camera; the
    // "Segui" button resumes it. Zoom is never forced by the follow mode, so
    // the user can choose any zoom level and keep it.
    this.map.on("dragstart", (e) => {
      if (e && e.originalEvent) this.setFollow(false);
    });
    this.map.on("rotatestart", (e) => {
      if (e && e.originalEvent) this.setFollow(false);
    });
    // Remember a zoom chosen by the user (wheel, pinch, double click…). The
    // follow camera below will no longer override it.
    this.map.on("zoom", (e) => {
      if (e && e.originalEvent) this.userZoom = this.map.getZoom();
    });

    this.bounds = new maplibregl.LngLatBounds();
    for (const p of route.points) this.bounds.extend([p.lon, p.lat]);

    const riderEl = document.createElement("div");
    riderEl.className = "map-rider";
    riderEl.setAttribute("aria-hidden", "true");
    this.riderMarker = new maplibregl.Marker({
      element: riderEl,
      anchor: "center",
    })
      .setLngLat([route.points[0].lon, route.points[0].lat])
      .addTo(this.map);

    // Fit the whole route immediately: this does not need the tiles, so the
    // map is already framed even on a slow connection (or offline).
    this.map.fitBounds(this.bounds, {
      padding: 36,
      pitch: 60,
      bearing: 0,
      maxZoom: 14,
      duration: 0,
    });

    this.map.on("load", () => {
      this.loaded = true;
      this.setPlace(this.placeInfo);
    });

    this.map.on("error", (e) => {
      if (this.errorShown) return;
      const msg = e && e.error ? e.error.message : "";
      if (/tile|fetch|network|Failed/i.test(msg)) {
        this.errorShown = true;
        this.onError("Mappa: impossibile scaricare le mappe (controlla internet)");
      }
    });

    this.setRider(0);
  }

  setRider(distance) {
    const p = this.route.latLonAt(distance);
    this.position = p;
    if (this.riderMarker) this.riderMarker.setLngLat([p.lon, p.lat]);
  }

  reset() {
    this.setRider(0);
    this.setFollow(true);
    this.userZoom = null;
    if (!this.map) return;
    this.map.fitBounds(this.bounds, {
      padding: 36,
      pitch: 60,
      bearing: 0,
      maxZoom: 14,
      duration: 400,
    });
  }

  setPlace(info) {
    this.placeInfo = info || null;
    if (!this.placeEl) return;
    this.placeEl.textContent =
      this.placeInfo && this.placeInfo.place ? this.placeInfo.place : "—";
  }

  setFollow(value) {
    const next = !!value;
    if (this.follow === next) return;
    this.follow = next;
    if (typeof this.onFollowChange === "function") {
      this.onFollowChange(next);
    }
  }

  zoomBy(delta) {
    if (!this.map) return;
    // Instant change: the follow camera keeps re-centering every 90 ms, so
    // an animated easeTo would be interrupted before reaching the new zoom.
    const z = Math.max(
      this.map.getMinZoom(),
      Math.min(this.map.getMaxZoom(), this.map.getZoom() + delta)
    );
    this.userZoom = z;
    this.map.setZoom(z);
  }

  recenter(duration = 400) {
    if (!this.map) return;
    const p = this.position || { lon: this.route.points[0].lon, lat: this.route.points[0].lat };
    this.map.easeTo({
      center: [p.lon, p.lat],
      bearing: this.lastBearing,
      pitch: 60,
      duration,
    });
  }

  update(distance, playing) {
    this.setRider(distance);
    if (!this.map || !playing || !this.follow) return;
    if (distance >= this.route.totalDistance - 1) return;
    const p = this.position;
    const aheadDistance = Math.min(distance + 40, this.route.totalDistance);
    const target = this.route.latLonAt(aheadDistance);
    const targetBearing = bearingBetween(p, target);

    // Smooth the bearing so the camera does not snap on sharp bends.
    let delta = targetBearing - this.lastBearing;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    this.lastBearing = (this.lastBearing + delta * 0.15 + 360) % 360;

    const now = performance.now();
    if (now - this.lastCameraAt < 90) return;
    this.lastCameraAt = now;
    // Once the user has chosen a zoom we keep it; before that we use the
    // default follow zoom instead of the whole-route fitBounds zoom.
    const camera = {
      center: [p.lon, p.lat],
      bearing: this.lastBearing,
      pitch: 65,
    };
    if (this.userZoom === null) camera.zoom = 14;
    this.map.jumpTo(camera);
  }

  resize() {
    if (this.map) this.map.resize();
  }

  destroy() {
    if (this.riderMarker) {
      this.riderMarker.remove();
      this.riderMarker = null;
    }
    if (this.placeEl) {
      this.placeEl.remove();
      this.placeEl = null;
    }
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
    this.loaded = false;
  }
}
