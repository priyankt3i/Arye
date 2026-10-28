// WebHID transport + high-level operations for the ARYE vendor collection.
import {
  VID, PIDS, USAGE_PAGE, USAGE, REPORT_ID, CID, CMD, ADDR, CONFIG_SIZE, SHORTCUT_SIZE, MACRO_SIZE,
  BUTTON_COUNT, DPI_SLOTS, KEY_TYPE, check, decodeDpi, encodeDpi, keyMapToFunction, functionToKeyMap,
  encodeShortcut, encodeMacro, comboEvents, mediaEvents,
} from './protocol.js';

const MIN_GAP_MS = 8; // HIDUsb.dll waits >= 8 ms between commands
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const webHidSupported = () => 'hid' in navigator;

class HidTransport {
  constructor(hid) {
    this.hid = hid;
    this.pending = null;
    this.onEvent = null;
    hid.addEventListener('inputreport', (e) => this.#onReport(e));
  }

  get name() { return this.hid.productName || 'ARYE Mouse'; }
  get pid() { return this.hid.productId; }

  async open() { if (!this.hid.opened) await this.hid.open(); }
  async close() { if (this.hid.opened) await this.hid.close(); }

  #onReport(e) {
    if (e.reportId !== REPORT_ID) return;
    const d = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
    if (d.length < 16 || check([REPORT_ID, ...d.slice(0, 15)]) !== d[15]) return;
    if (this.pending && d[0] === this.pending.cmd) {
      const p = this.pending;
      this.pending = null;
      clearTimeout(p.timer);
      p.resolve(d);
    } else if (d[0] === CMD.EVENT) {
      this.onEvent?.(d);
    }
  }

  async send(packet16, cmd, timeout) {
    const reply = new Promise((resolve, reject) => {
      this.pending = { cmd, resolve, timer: setTimeout(() => { this.pending = null; reject(new Error('timeout')); }, timeout) };
    });
    await this.hid.sendReport(REPORT_ID, new Uint8Array(packet16));
    return reply;
  }
}

// Replays the flash dump read from a real receiver so the UI can be explored offline.
class DemoTransport {
  constructor(flash) {
    this.flash = flash;
    this.onEvent = null;
  }
  get name() { return 'Demo · ARYE 8K Receiver'; }
  get pid() { return 0xf517; }
  async open() {}
  async close() {}
  async send(p, cmd) {
    await sleep(2);
    const addr = (p[2] << 8) | p[3];
    const len = p[4] & 0x7f;
    const r = new Uint8Array(16);
    r.set(p.slice(0, 5));
    const replies = {
      [CMD.ONLINE]: [1, 1, 0xae, 0x7c, 0x86],
      [CMD.VERSION]: [2, 0x19],
      [CMD.DONGLE_VERSION]: [2, 0x20],
      [CMD.BATTERY]: [0x4b, 0, 0x0f, 0xad],
      [CMD.GET_LONG_RANGE]: [this.longRange ?? 0],
      [CMD.GET_DONGLE_LED]: this.dongleLed ?? [2, 0, 0xff, 0, 0xff, 0xff, 0, 0xff, 0, 0],
    };
    if (cmd === CMD.READ_FLASH) r.set(this.flash.slice(addr, addr + len), 5);
    else if (cmd === CMD.WRITE_FLASH) this.flash.set(p.slice(5, 5 + len), addr);
    else if (cmd === CMD.SET_LONG_RANGE) this.longRange = p[5];
    else if (cmd === CMD.SET_DONGLE_LED) this.dongleLed = [...p.slice(5, 15)];
    else if (replies[cmd]) r.set(replies[cmd], 5);
    r[15] = check([REPORT_ID, ...r.slice(0, 15)]);
    return r;
  }
}

export class Mouse {
  constructor(transport) {
    this.t = transport;
    this.queue = Promise.resolve();
    this.lastSend = 0;
    this.config = new Uint8Array(CONFIG_SIZE);
    this.shortcuts = [];
    this.macros = [];
    this.listeners = new Set();
    transport.onEvent = (d) => this.listeners.forEach((fn) => fn(d));
  }

  static async request() {
    const [hid] = await navigator.hid.requestDevice({ filters: [{ vendorId: VID, usagePage: USAGE_PAGE, usage: USAGE }] });
    if (!hid) return null;
    return Mouse.#wrap(hid);
  }

  static async reconnect() {
    const devices = await navigator.hid.getDevices();
    const hid = devices.find((d) => d.vendorId === VID && d.collections.some((c) => c.usagePage === USAGE_PAGE && c.usage === USAGE));
    return hid ? Mouse.#wrap(hid) : null;
  }

  static async #wrap(hid) {
    const m = new Mouse(new HidTransport(hid));
    await m.t.open();
    return m;
  }

  static demo(flash) {
    const buf = new Uint8Array(ADDR.macro + MACRO_SIZE * 16).fill(0xff);
    buf.set(flash);
    return new Mouse(new DemoTransport(buf));
  }

  get name() { return this.t.name; }
  get isDemo() { return this.t instanceof DemoTransport; }
  get isReceiver() { return this.t.pid === 0xf517; }
  get connection() { return PIDS[this.t.pid] ?? 'USB'; }
  onEvent(fn) { this.listeners.add(fn); }
  close() { return this.t.close(); }

  // Serialised command: [cmd, 0, addrHi, addrLo, len, data x10, checksum]
  cmd(cmd, { addr = 0, len = 0, data = [], timeout = 1000, retries = 3 } = {}) {
    const run = async () => {
      const p = new Array(16).fill(0);
      p[0] = cmd;
      p[2] = (addr >> 8) & 0xff;
      p[3] = addr & 0xff;
      p[4] = len;
      data.slice(0, 10).forEach((b, i) => (p[5 + i] = b & 0xff));
      p[15] = check([REPORT_ID, ...p.slice(0, 15)]);
      let lastErr;
      for (let i = 0; i < retries; i++) {
        const wait = this.lastSend + MIN_GAP_MS - performance.now();
        if (wait > 0) await sleep(wait);
        this.lastSend = performance.now();
        try {
          return await this.t.send(p, cmd, timeout);
        } catch (e) {
          lastErr = e;
        }
      }
      throw new Error(`Command 0x${cmd.toString(16)} failed: ${lastErr?.message}`);
    };
    const res = this.queue.then(run, run);
    this.queue = res.catch(() => {});
    return res;
  }

  async readFlash(addr, n) {
    const out = [];
    for (let o = 0; o < n; o += 10) {
      const len = Math.min(10, n - o);
      const r = await this.cmd(CMD.READ_FLASH, { addr: addr + o, len });
      out.push(...r.slice(5, 5 + len));
    }
    return out;
  }

  async writeFlash(addr, bytes) {
    for (let o = 0; o < bytes.length; o += 10) {
      const chunk = bytes.slice(o, o + 10);
      const r = await this.cmd(CMD.WRITE_FLASH, { addr: addr + o, len: chunk.length, data: chunk });
      if (r[1] !== 0) throw new Error(`Device rejected write at 0x${(addr + o).toString(16)} (status ${r[1]})`);
    }
    if (addr + bytes.length <= CONFIG_SIZE) this.config.set(bytes, addr);
  }

  // --- status -------------------------------------------------------------------
  async online() {
    if (!this.isReceiver) return true; // the online query reports the wireless link
    const r = await this.cmd(CMD.ONLINE);
    return r[5] === 1;
  }
  async versions() {
    const v = await this.cmd(CMD.VERSION);
    const out = { mouse: `${v[5]}.${v[6].toString(16).padStart(2, '0')}` };
    if (this.isReceiver) {
      const d = await this.cmd(CMD.DONGLE_VERSION);
      out.dongle = `${d[5]}.${d[6].toString(16).padStart(2, '0')}`;
    }
    return out;
  }
  async battery() {
    try {
      const r = await this.cmd(CMD.BATTERY, { retries: 1 });
      return { percent: Math.min(100, r[5]), charging: r[6] === 1, millivolts: (r[7] << 8) | r[8] };
    } catch {
      return null;
    }
  }

  // --- full read ------------------------------------------------------------------
  async load(progress = () => {}) {
    this.config = new Uint8Array(await this.readFlash(0, CONFIG_SIZE));
    progress(0.4);
    this.shortcuts = [];
    this.macros = [];
    for (let b = 0; b < BUTTON_COUNT; b++) {
      const [type] = this.keyMap(b);
      this.shortcuts[b] = type === KEY_TYPE.SHORTCUT ? await this.readFlash(ADDR.shortcut + b * SHORTCUT_SIZE, SHORTCUT_SIZE) : null;
      if (type === KEY_TYPE.MACRO) {
        const head = await this.readFlash(ADDR.macro + b * MACRO_SIZE, 0x20);
        const n = Math.min(70, head[0x1f]);
        const rest = n >= 2 ? await this.readFlash(ADDR.macro + b * MACRO_SIZE + 0x20, 5 * n + 1) : [];
        this.macros[b] = [...head, ...rest];
      } else {
        this.macros[b] = null;
      }
      progress(0.4 + (0.6 * (b + 1)) / BUTTON_COUNT);
    }
  }

  // --- config getters --------------------------------------------------------------
  byte(addr) { return this.config[addr]; }
  valid(addr) { return ((this.config[addr] + this.config[addr + 1]) & 0xff) === 0x55; }
  get dpiStages() {
    const out = [];
    for (let i = 0; i < DPI_SLOTS; i++) {
      const o = ADDR.dpi + 4 * i;
      const c = ADDR.dpiColor + 4 * i;
      out.push({ dpi: decodeDpi(this.config[o], this.config[o + 2]), color: [...this.config.slice(c, c + 3)] });
    }
    return out;
  }
  keyMap(b) {
    const o = ADDR.keys + 4 * b;
    return [...this.config.slice(o, o + 3)];
  }
  buttonFunction(b) { return keyMapToFunction(this.keyMap(b), this.shortcuts[b], this.macros[b]); }

  // --- setters ---------------------------------------------------------------------
  setByte(addr, v) {
    v &= 0xff;
    return this.writeFlash(addr, [v, check([v])]);
  }
  setDpi(i, dpi) {
    const v = encodeDpi(dpi);
    return this.writeFlash(ADDR.dpi + 4 * i, [...v, check(v)]);
  }
  setDpiColor(i, rgb) {
    return this.writeFlash(ADDR.dpiColor + 4 * i, [...rgb, check(rgb)]);
  }
  async setDpiEffect(mode) {
    if (mode === 0) return this.setByte(ADDR.dpiLedEnable, 0);
    await this.setByte(ADDR.dpiLedMode, mode);
    return this.setByte(ADDR.dpiLedEnable, 1);
  }
  async setAngleTune(deg) {
    await this.setByte(ADDR.angleTune, deg & 0xff);
    return this.setByte(ADDR.angleTuneEnable, 1);
  }

  async setButton(b, fn) {
    if (fn.kind === 'combo' || fn.kind === 'media') {
      const evs = fn.kind === 'media' ? mediaEvents(fn.usage) : comboEvents(fn.keys);
      const block = encodeShortcut(evs);
      await this.writeFlash(ADDR.shortcut + b * SHORTCUT_SIZE, block);
      this.shortcuts[b] = block;
    }
    if (fn.kind === 'macro') {
      const block = encodeMacro(fn.macro.name, fn.macro.events);
      await this.writeFlash(ADDR.macro + b * MACRO_SIZE, block);
      this.macros[b] = block;
    }
    const km = functionToKeyMap(fn, b);
    await this.writeFlash(ADDR.keys + 4 * b, [...km, check(km)]);
  }

  // --- receiver / maintenance ---------------------------------------------------------
  async longRange() { return (await this.cmd(CMD.GET_LONG_RANGE))[5] === 1; }
  // HIDUsb.dll treats the command as successful when the reply echoes the requested value.
  // The RCC-1 8K receiver (fw 2.20) echoes "on" but 0x17 keeps reporting off, so return the read-back.
  async setLongRange(on) {
    const r = await this.cmd(CMD.SET_LONG_RANGE, { len: 1, data: [on ? 1 : 0] });
    if (r[5] !== (on ? 1 : 0)) throw new Error('Receiver did not acknowledge long-distance mode');
    return this.longRange();
  }
  async dongleLed() { return [...(await this.cmd(CMD.GET_DONGLE_LED)).slice(5, 15)]; }
  async setDongleLedMode(mode) {
    const cur = await this.dongleLed();
    cur[0] = mode;
    const r = await this.cmd(CMD.SET_DONGLE_LED, { len: 10, data: cur });
    if (r[1] !== 0) throw new Error(`Receiver rejected LED mode (status ${r[1]})`);
  }
  pair() { return this.cmd(CMD.PAIR, { len: 2, data: [0, 0, CID], timeout: 2000 }); }
  async factoryReset() {
    await this.cmd(CMD.FACTORY_RESET, { timeout: 5000, retries: 1 });
    await sleep(1500);
  }

  // --- backup / restore -------------------------------------------------------------
  async exportProfile() {
    const shortcuts = [];
    const macros = [];
    for (let b = 0; b < BUTTON_COUNT; b++) {
      shortcuts.push(await this.readFlash(ADDR.shortcut + b * SHORTCUT_SIZE, SHORTCUT_SIZE));
      const head = await this.readFlash(ADDR.macro + b * MACRO_SIZE, 0x20);
      const n = head[0x1f] >= 2 && head[0x1f] <= 70 ? head[0x1f] : 0;
      macros.push(n ? [...head, ...(await this.readFlash(ADDR.macro + b * MACRO_SIZE + 0x20, 5 * n + 1))] : null);
    }
    return { format: 'arye-web-profile', version: 1, config: [...this.config], shortcuts, macros };
  }

  async importProfile(p, progress = () => {}) {
    if (p?.format !== 'arye-web-profile' || p.config?.length !== CONFIG_SIZE) throw new Error('Not an ARYE profile file');
    // Write only the byte runs that differ (runs separated by < 4 equal bytes are merged).
    const runs = [];
    for (let a = 0; a < CONFIG_SIZE; a++) {
      if (this.config[a] === p.config[a]) continue;
      const last = runs.at(-1);
      if (last && a - last[1] < 4) last[1] = a + 1;
      else runs.push([a, a + 1]);
    }
    for (const [i, [s, e]] of runs.entries()) {
      await this.writeFlash(s, p.config.slice(s, e));
      progress((0.5 * (i + 1)) / runs.length);
    }
    for (let b = 0; b < BUTTON_COUNT; b++) {
      if (p.shortcuts?.[b]) await this.writeFlash(ADDR.shortcut + b * SHORTCUT_SIZE, p.shortcuts[b]);
      if (p.macros?.[b]) await this.writeFlash(ADDR.macro + b * MACRO_SIZE, p.macros[b]);
      progress(0.5 + (0.5 * (b + 1)) / BUTTON_COUNT);
    }
    await this.load();
  }
}
