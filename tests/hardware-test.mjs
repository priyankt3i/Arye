// Hardware test: drives the real app code (js/device.js + js/protocol.js) against a plugged-in mouse
// through Linux hidraw instead of WebHID, verifies every write by re-reading flash, then restores
// every touched byte.  Usage:  node tests/hardware-test.mjs [/dev/hidrawN]
import fs from 'node:fs';
import { Mouse, matches } from '../js/device.js';
import {
  ADDR, CONFIG_SIZE, SHORTCUT_SIZE, MACRO_SIZE, REPORT_ID, CMD, EV, check, encodeDpi, encodeShortcut,
  encodeMacro, mediaEvents, comboEvents, decodeMacro, describeFunction,
} from '../js/protocol.js';

function findHidraw() {
  for (const n of fs.readdirSync('/sys/class/hidraw')) {
    const desc = fs.readFileSync(`/sys/class/hidraw/${n}/device/report_descriptor`);
    const uevent = fs.readFileSync(`/sys/class/hidraw/${n}/device/uevent`, 'utf8');
    // vendor collection: Usage Page 0xFF02 (06 02 FF), report ID 8 (85 08)
    if (/HID_ID=0003:00003554/i.test(uevent) && desc.includes(Buffer.from([0x06, 0x02, 0xff])) && desc.includes(Buffer.from([0x85, 0x08])))
      return `/dev/${n}`;
  }
  throw new Error('No ARYE/Compx vendor hidraw node found');
}

class HidrawTransport {
  constructor(path) {
    this.path = path;
    this.fd = fs.openSync(path, fs.constants.O_RDWR | fs.constants.O_NONBLOCK);
    this.pending = null;
    this.onEvent = null;
    this.closed = false;
    const pid = fs.readFileSync(`/sys/class/hidraw/${path.split('/').pop()}/device/uevent`, 'utf8').match(/HID_ID=\w+:\w+:0000(\w{4})/i);
    this.pid = parseInt(pid[1], 16);
    this.#readLoop();
  }
  get name() { return `hidraw ${this.path}`; }
  async open() {}
  async close() { this.closed = true; fs.closeSync(this.fd); }
  #readLoop() {
    const buf = Buffer.alloc(64);
    fs.read(this.fd, buf, 0, 64, null, (err, n) => {
      if (this.closed) return;
      if (err?.code === 'EAGAIN') return setTimeout(() => this.#readLoop(), 1);
      if (!err && n >= 17 && buf[0] === REPORT_ID) {
        const d = new Uint8Array(buf.subarray(1, 17));
        if (process.env.HWLOG) fs.appendFileSync(process.env.HWLOG, `< ${Buffer.from(d).toString('hex')}\n`);
        if (check([REPORT_ID, ...d.slice(0, 15)]) === d[15]) {
          if (this.pending && matches(this.pending.packet, d)) {
            const p = this.pending;
            this.pending = null;
            clearTimeout(p.timer);
            p.resolve(d);
          } else if (d[0] === CMD.EVENT) this.onEvent?.(d);
        }
      }
      this.#readLoop();
    });
  }
  send(packet16, cmd, timeout) {
    return new Promise((resolve, reject) => {
      const entry = { packet: packet16, resolve };
      entry.timer = setTimeout(() => { if (this.pending === entry) this.pending = null; reject(new Error('timeout')); }, timeout);
      this.pending = entry;
      if (process.env.HWLOG) fs.appendFileSync(process.env.HWLOG, `> ${Buffer.from(packet16).toString('hex')}\n`);
      fs.writeSync(this.fd, Buffer.from([REPORT_ID, ...packet16]));
    });
  }
}

const results = [];
const hex = (a) => [...a].map((b) => b.toString(16).padStart(2, '0')).join(' ');
async function expectFlash(m, name, addr, expected) {
  const got = await m.readFlash(addr, expected.length);
  const ok = got.every((b, i) => b === expected[i]);
  results.push({ name, ok, detail: ok ? hex(got) : `expected ${hex(expected)} got ${hex(got)}` });
}
const pair = (v) => [v & 0xff, check([v & 0xff])];

const path = process.argv[2] ?? findHidraw();
const m = new Mouse(new HidrawTransport(path));
console.log(`Device ${path}  PID ${m.t.pid.toString(16)}  (${m.connection})`);

if (!(await m.online())) { console.log('Mouse is asleep/offline — move it and rerun.'); process.exit(2); }
const versions = await m.versions();
const battery = await m.battery();
console.log('Versions', versions, 'Battery', battery);

// ---- snapshot everything this test touches ----
const snap = {
  config: await m.readFlash(0, CONFIG_SIZE),
  sc4: await m.readFlash(ADDR.shortcut + 4 * SHORTCUT_SIZE, SHORTCUT_SIZE),
  sc5: await m.readFlash(ADDR.shortcut + 5 * SHORTCUT_SIZE, SHORTCUT_SIZE),
  mac3: await m.readFlash(ADDR.macro + 3 * MACRO_SIZE, 0x40),
  longRange: m.isReceiver ? await m.longRange() : null,
  dongleLed: m.isReceiver ? await m.dongleLed() : null,
};
await m.load();
console.log('Buttons before:', [0, 1, 2, 3, 4, 5].map((b) => describeFunction(m.buttonFunction(b))).join(' | '));

try {
  // Main
  await m.setByte(ADDR.reportRate, 0x01); await expectFlash(m, 'polling rate 1000 Hz', ADDR.reportRate, pair(0x01));
  await m.setByte(ADDR.reportRate, 0x40); await expectFlash(m, 'polling rate 8000 Hz', ADDR.reportRate, pair(0x40));
  await m.setByte(ADDR.maxDpi, 5); await expectFlash(m, 'stage count 5', ADDR.maxDpi, pair(5));
  await m.setByte(ADDR.currentDpi, 2); await expectFlash(m, 'active stage 3', ADDR.currentDpi, pair(2));
  for (const dpi of [6400, 30000]) {
    await m.setDpi(4, dpi);
    const e = encodeDpi(dpi);
    await expectFlash(m, `stage 5 = ${dpi} DPI`, ADDR.dpi + 16, [...e, check(e)]);
  }
  await m.setDpiColor(4, [0x12, 0x34, 0x56]); await expectFlash(m, 'stage 5 colour', ADDR.dpiColor + 16, [0x12, 0x34, 0x56, check([0x12, 0x34, 0x56])]);
  await m.setDpiEffect(1); await expectFlash(m, 'DPI LED steady (mode)', ADDR.dpiLedMode, pair(1)); await expectFlash(m, 'DPI LED steady (enable)', ADDR.dpiLedEnable, pair(1));
  await m.setByte(ADDR.dpiLedBrightness, 210); await expectFlash(m, 'DPI LED brightness', ADDR.dpiLedBrightness, pair(210));
  // Performance / advanced
  await m.setByte(ADDR.lod, 2); await expectFlash(m, 'LOD high', ADDR.lod, pair(2));
  for (const [k, a] of [['motion sync', ADDR.motionSync], ['angle snapping', ADDR.angleSnap], ['ripple', ADDR.ripple], ['boost', ADDR.boost]]) {
    const cur = snap.config[a];
    await m.setByte(a, cur ? 0 : 1); await expectFlash(m, `${k} toggled`, a, pair(cur ? 0 : 1));
  }
  await m.setByte(ADDR.sleepTime, 30); await expectFlash(m, 'auto sleep 5 min', ADDR.sleepTime, pair(30));
  await m.setAngleTune(-10); await expectFlash(m, 'angle −10°', ADDR.angleTune, pair(-10)); await expectFlash(m, 'angle enable', ADDR.angleTuneEnable, pair(1));
  await m.setByte(ADDR.debounce, 6); await expectFlash(m, 'debounce 6 ms', ADDR.debounce, pair(6));
  // Buttons
  await m.setButton(5, { kind: 'media', usage: 0xe9 });
  await expectFlash(m, 'button 6 → Volume Up (key map)', ADDR.keys + 20, [5, 0, 0, check([5, 0, 0])]);
  await expectFlash(m, 'button 6 → Volume Up (shortcut record)', ADDR.shortcut + 5 * SHORTCUT_SIZE, encodeShortcut(mediaEvents(0xe9)).slice(0, 8));
  const combo = [{ t: EV.MOD, v: 0x01 }, { t: EV.MOD, v: 0x02 }, { t: EV.KEY, v: 0x17 }];
  await m.setButton(4, { kind: 'combo', keys: combo });
  await expectFlash(m, 'button 5 → Ctrl+Shift+T', ADDR.shortcut + 4 * SHORTCUT_SIZE, encodeShortcut(comboEvents(combo)).slice(0, 20));
  const macro = { name: 'HWTEST', events: [{ t: EV.KEY, v: 0x0a, down: true, delay: 15 }, { t: EV.KEY, v: 0x0a, down: false, delay: 40 }] };
  await m.setButton(3, { kind: 'macro', repeat: 2, macro });
  await expectFlash(m, 'button 4 → macro (key map)', ADDR.keys + 12, [6, 3, 2, check([6, 3, 2])]);
  await expectFlash(m, 'button 4 → macro (record)', ADDR.macro + 3 * MACRO_SIZE, encodeMacro(macro.name, macro.events));
  await m.load();
  const decoded = m.buttonFunction(3);
  results.push({ name: 'macro reads back through app decoder', ok: decoded.macro?.name === 'HWTEST' && decoded.macro.events.length === 2, detail: describeFunction(decoded) });
  await m.setButton(5, { kind: 'dpiLock', dpi: 2000 }); await expectFlash(m, 'button 6 → DPI lock 2000', ADDR.keys + 20, [0x0a, 0x27, 0, check([0x0a, 0x27, 0])]);
  // Receiver
  if (m.isReceiver) {
    let lr;
    try { lr = (await m.setLongRange(!snap.longRange)) === !snap.longRange ? 'applied' : 'acknowledged, read-back unchanged'; }
    catch (e) { lr = `error: ${e.message}`; }
    results.push({ name: 'long-distance mode (info)', ok: !lr.startsWith('error'), detail: lr });
    const mode = snap.dongleLed[0] === 1 ? 3 : 1;
    await m.setDongleLedMode(mode);
    const led = await m.dongleLed();
    results.push({ name: `receiver LED mode ${mode}`, ok: led[0] === mode, detail: hex(led) });
  }
} finally {
  // ---- restore every touched byte ----
  await m.writeFlash(0, snap.config);
  await m.writeFlash(ADDR.shortcut + 4 * SHORTCUT_SIZE, snap.sc4);
  await m.writeFlash(ADDR.shortcut + 5 * SHORTCUT_SIZE, snap.sc5);
  await m.writeFlash(ADDR.macro + 3 * MACRO_SIZE, snap.mac3);
  if (m.isReceiver) {
    try { await m.setLongRange(snap.longRange); } catch (e) { console.log('long-range restore:', e.message); }
    await m.cmd(CMD.SET_DONGLE_LED, { len: 10, data: snap.dongleLed });
  }
  const after = {
    config: await m.readFlash(0, CONFIG_SIZE),
    sc4: await m.readFlash(ADDR.shortcut + 4 * SHORTCUT_SIZE, SHORTCUT_SIZE),
    sc5: await m.readFlash(ADDR.shortcut + 5 * SHORTCUT_SIZE, SHORTCUT_SIZE),
    mac3: await m.readFlash(ADDR.macro + 3 * MACRO_SIZE, 0x40),
  };
  const same = Object.keys(after).every((k) => after[k].every((b, i) => b === snap[k][i]));
  const lrOk = !m.isReceiver || (await m.longRange()) === snap.longRange;
  const ledOk = !m.isReceiver || (await m.dongleLed()).every((b, i) => b === snap.dongleLed[i]);
  results.push({ name: 'RESTORE: all touched bytes identical to before', ok: same && lrOk && ledOk, detail: same && lrOk && ledOk ? 'ok' : 'MISMATCH' });
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(42)} ${r.detail}`);
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
  await m.close();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
