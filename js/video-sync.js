// Video <-> GPS synchronization engine for the browser.
//
// In the browser the natural time unit is video.currentTime (seconds), not
// frame indices. We map route distance <-> video time, and drive playback
// speed so the video advances at the rider's speed (like Rouvy).
//
//   referenceSpeed = totalDistance / videoDuration   (m/s of the original film)
//   playbackRate   = riderSpeedMs / referenceSpeed

export class VideoSync {
  constructor(videoEl, route) {
    this.video = videoEl;
    this.route = route;
    this.videoDuration = 0;
    this.totalDistance = route.totalDistance;
    this.referenceSpeed = 0;
    this.lastSeekDistance = -1e9;
  }

  // Call when video metadata is loaded.
  onMetadata() {
    this.videoDuration = this.video.duration || 0;
    this.referenceSpeed =
      this.videoDuration > 0 ? this.totalDistance / this.videoDuration : 1.0;
  }

  get ready() {
    return this.videoDuration > 0;
  }

  timeForDistance(distance) {
    if (this.videoDuration <= 0) return 0;
    const d = Math.min(Math.max(distance, 0), this.totalDistance);
    return (d / this.totalDistance) * this.videoDuration;
  }

  distanceForTime(t) {
    if (this.videoDuration <= 0) return 0;
    return (t / this.videoDuration) * this.totalDistance;
  }

  // Playback speed of the video (in m/s of route) at a given distance,
  // modulated slightly by slope so uphill sections (filmed slower) stay smooth.
  videoSpeedAtDistance(distance) {
    const slope = this.route.slopeAt(distance);
    const multiplier = 1.0 + Math.max(0, slope) * 0.03;
    return this.referenceSpeed * Math.min(multiplier, 2.0);
  }

  seekToDistance(distance) {
    if (!this.ready) return;
    this.video.currentTime = Math.min(
      Math.max(this.timeForDistance(distance), 0),
      this.videoDuration - 0.05
    );
    this.lastSeekDistance = distance;
  }

  // Main per-frame sync. Drift correction + playback rate.
  sync(riderDistance, riderSpeedMs) {
    if (!this.ready) return;

    const targetTime = this.timeForDistance(riderDistance);
    const drift = Math.abs(this.video.currentTime - targetTime);

    // Large drift (seek, reset, big jump) -> hard seek
    if (drift > 0.5) {
      this.seekToDistance(riderDistance);
      this.video.playbackRate = 1.0;
      return;
    }

    // Small drift -> nudge playback rate to catch up smoothly
    const localSpeed = this.videoSpeedAtDistance(riderDistance);
    if (localSpeed > 0.1) {
      let rate = riderSpeedMs / localSpeed;
      // Correct residual drift
      rate += (targetTime - this.video.currentTime) * 0.5;
      // Clamp to sane range (HTML5 video supports ~0.0625..16, browsers vary)
      rate = Math.min(Math.max(rate, 0.1), 4.0);
      this.video.playbackRate = rate;
    }
  }

  play() {
    if (this.video.paused) this.video.play().catch(() => {});
  }

  pause() {
    if (!this.video.paused) this.video.pause();
  }
}
