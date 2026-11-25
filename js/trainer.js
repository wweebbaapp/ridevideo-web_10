// Smart trainer connection over Web Bluetooth (FTMS protocol).
//
// Web Bluetooth is available in Chrome on Android and requires a secure
// context (https or http://localhost). Bluetooth is local - no internet.

const FTMS_SERVICE = "fitness_machine";
const INDOOR_BIKE_DATA = "indoor_bike_data";
const CONTROL_POINT = "fitness_machine_control_point";
const FTMS_STATUS = "fitness_machine_status";
const HEART_RATE_SERVICE = "heart_rate";
const HEART_RATE_MEASUREMENT = "heart_rate_measurement";

export const WEB_BLUETOOTH_AVAILABLE =
  typeof navigator !== "undefined" && !!navigator.bluetooth;

export class TrainerData {
  constructor() {
    this.connected = false;
    this.speedKmh = 0;
    this.cadenceRpm = 0;
    this.powerW = 0;
    this.heartRate = 0;
  }
}

export class TrainerConnection {
  constructor(onData) {
    this.data = new TrainerData();
    this.onData = onData || (() => {});
    this.device = null;
    this.server = null;
    this.controlPoint = null;
    this.status = "disconnesso";
    this._lastSlope = null;
    this._lastTargetW = null;
  }

  static get available() {
    return WEB_BLUETOOTH_AVAILABLE;
  }

  async connect() {
    if (!WEB_BLUETOOTH_AVAILABLE) {
      throw new Error("Web Bluetooth non disponibile");
    }
    this.status = "ricerca dispositivo...";
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [FTMS_SERVICE] }],
      optionalServices: [HEART_RATE_SERVICE],
    });
    this.device.addEventListener("gattserverdisconnected", () => {
      this.data.connected = false;
      this.status = "disconnesso";
      this.onData(this.data);
    });

    this.status = "connessione...";
    this.server = await this.device.gatt.connect();
    this._lastSlope = null; // force the first gradient to be sent
    this._lastTargetW = null;

    // Indoor Bike Data notifications
    try {
      const svc = await this.server.getPrimaryService(FTMS_SERVICE);
      const ibd = await svc.getCharacteristic(INDOOR_BIKE_DATA);
      await ibd.startNotifications();
      ibd.addEventListener("characteristicvaluechanged", (e) =>
        this._onIndoorBikeData(e.target.value)
      );
      this.controlPoint = await svc.getCharacteristic(CONTROL_POINT);
      // Listen to control-point responses (opcode 0x80 + request opcode +
      // result code) so we can tell whether the trainer accepted each command.
      try {
        await this.controlPoint.startNotifications();
        this.controlPoint.addEventListener("characteristicvaluechanged", (e) =>
          this._onControlResponse(e.target.value)
        );
      } catch (e) {
        // Response indications are optional
      }
      // Request control + start
      await this._writeControl(0x00); // request control
      await this._writeControl(0x07); // start/resume
    } catch (e) {
      // Some trainers may not expose all characteristics
    }

    // Heart rate (optional, separate service)
    try {
      const hrSvc = await this.server.getPrimaryService(HEART_RATE_SERVICE);
      const hrChar = await hrSvc.getCharacteristic(HEART_RATE_MEASUREMENT);
      await hrChar.startNotifications();
      hrChar.addEventListener("characteristicvaluechanged", (e) =>
        this._onHeartRate(e.target.value)
      );
    } catch (e) {
      // No HR sensor paired - fine
    }

    this.data.connected = true;
    this.status = `connesso a ${this.device.name || "trainer"}`;
    this.onData(this.data);
    return this.device.name;
  }

  disconnect() {
    if (this.device && this.device.gatt && this.device.gatt.connected) {
      this.device.gatt.disconnect();
    }
    this.data.connected = false;
    this.status = "disconnesso";
    this._lastTargetW = null;
  }

  async _writeControl(opcode, payload = new Uint8Array()) {
    if (!this.controlPoint) return;
    const buf = new Uint8Array(1 + payload.length);
    buf[0] = opcode;
    buf.set(payload, 1);
    try {
      await this.controlPoint.writeValue(buf);
    } catch (e) {
      // ignore write errors
    }
  }

  async setTargetPower(watts) {
    const w = Math.round(Math.max(0, watts));
    if (this._lastTargetW === w) return;
    this._lastTargetW = w;
    this._lastSlope = null;
    const b = new Uint8Array(2);
    b[0] = w & 0xff;
    b[1] = (w >> 8) & 0xff;
    await this._writeControl(0x05, b); // set target power
  }

  async setSimulationSlope(slopePct) {
    // Avoid spamming identical values
    if (this._lastSlope !== null && Math.abs(this._lastSlope - slopePct) < 0.1) {
      return;
    }
    this._lastSlope = slopePct;
    this._lastTargetW = null;
    // FTMS "Set Indoor Bike Simulation Parameters" (opcode 0x11) payload order
    // is fixed by the Bluetooth SIG spec:
    //   bytes 0-1: wind speed (sint16, 0.001 m/s)
    //   bytes 2-3: grade      (sint16, 0.01 %)
    //   byte  4:   rolling resistance coefficient (uint8, 0.0001)
    //   byte  5:   wind resistance coefficient     (uint8, 0.01)
    const b = new Uint8Array(6);
    const grade = Math.round(slopePct * 100);
    const wind = 0;
    b[0] = wind & 0xff;
    b[1] = (wind >> 8) & 0xff;
    b[2] = grade & 0xff;
    b[3] = (grade >> 8) & 0xff;
    b[4] = 40; // crr = 0.0040
    b[5] = 0; // cw = 0.00
    await this._writeControl(0x11, b); // set simulation params
  }

  _onControlResponse(dv) {
    // Response format: 0x80, request opcode, result code, [data...]
    if (dv.byteLength < 3 || dv.getUint8(0) !== 0x80) return;
    this.lastResponse = { op: dv.getUint8(1), result: dv.getUint8(2) };
  }

  _onIndoorBikeData(dv) {
    if (dv.byteLength < 2) return;
    const flags = dv.getUint16(0, true);
    let idx = 2;
    // bit0 = 0 -> instantaneous speed present (0.01 km/h)
    if ((flags & 0x0001) === 0) {
      if (dv.byteLength >= idx + 2) {
        this.data.speedKmh = dv.getUint16(idx, true) / 100.0;
        idx += 2;
      }
    }
    if (flags & 0x0002) idx += 2; // avg speed
    if (flags & 0x0004) {
      if (dv.byteLength >= idx + 2) {
        this.data.cadenceRpm = dv.getUint16(idx, true) / 2.0;
        idx += 2;
      }
    }
    if (flags & 0x0008) idx += 2; // avg cadence
    if (flags & 0x0010) idx += 3; // total distance
    if (flags & 0x0020) idx += 2; // resistance level
    if (flags & 0x0040) {
      if (dv.byteLength >= idx + 2) {
        this.data.powerW = dv.getInt16(idx, true);
        idx += 2;
      }
    }
    this.onData(this.data);
  }

  _onHeartRate(dv) {
    if (dv.byteLength < 2) return;
    const flags = dv.getUint8(0);
    if (flags & 0x01) this.data.heartRate = dv.getUint16(1, true);
    else this.data.heartRate = dv.getUint8(1);
    this.onData(this.data);
  }
}
