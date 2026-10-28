// Protocol constants and codecs for Compx-based ARYE mice (VID 0x3554).
// Every value here was recovered from HIDUsb.dll / ARYE Configurator.exe; see PROTOCOL.md.

export const VID = 0x3554;
export const PIDS = { 0xf516: 'Wired', 0xf517: '8K Receiver' };
export const USAGE_PAGE = 0xff02;
export const USAGE = 0x02;
export const REPORT_ID = 0x08;
export const CID = 105; // from usersetting/Config.ini

export const CMD = {
  ONLINE: 0x03,
  BATTERY: 0x04,
  PAIR: 0x05,
  PAIR_STATUS: 0x06,
  WRITE_FLASH: 0x07,
  READ_FLASH: 0x08,
  FACTORY_RESET: 0x09,
  EVENT: 0x0a,
  READ_CONFIG: 0x0e,
  VERSION: 0x12,
  SET_DONGLE_LED: 0x14,
  GET_DONGLE_LED: 0x15,
  SET_LONG_RANGE: 0x16,
  GET_LONG_RANGE: 0x17,
  DONGLE_VERSION: 0xb3,
};

// Each scalar lives at ADDR and is followed by a check byte (0x55 - value).
export const ADDR = {
  reportRate: 0x00,
  maxDpi: 0x02,
  currentDpi: 0x04,
  lod: 0x0a,
  dpi: 0x0c, // 8 x [x, y, ex, chk]
  dpiColor: 0x2c, // 8 x [r, g, b, chk]
  dpiLedMode: 0x4c,
  dpiLedBrightness: 0x4e,
  dpiLedSpeed: 0x50,
  dpiLedEnable: 0x52,
  keys: 0x60, // 16 x [type, p1, p2, chk]
  debounce: 0xa9,
  motionSync: 0xab,
  ledOffTime: 0xad,
  angleSnap: 0xaf,
  ripple: 0xb1,
  moveOffLed: 0xb3,
  boost: 0xb5,
  sleepTime: 0xb7,
  sensorMode: 0xb9,
  angleTune: 0xbd,
  angleTuneEnable: 0xbf,
  shortcut: 0x100, // 16 x 32 bytes
  macro: 0x300, // 16 x 384 bytes
};
export const CONFIG_SIZE = 0xd8;
export const SHORTCUT_SIZE = 0x20;
export const MACRO_SIZE = 0x180;
export const BUTTON_COUNT = 6;
export const DPI_SLOTS = 8;

export const sum = (bytes) => bytes.reduce((a, b) => a + b, 0);
export const check = (bytes) => (0x55 - sum(bytes)) & 0xff;

// --- Report rate -----------------------------------------------------------
export const REPORT_RATES = [
  { hz: 125, code: 0x08 },
  { hz: 250, code: 0x04 },
  { hz: 500, code: 0x02 },
  { hz: 1000, code: 0x01 },
  { hz: 2000, code: 0x10 },
  { hz: 4000, code: 0x20 },
  { hz: 8000, code: 0x40 },
];

// --- DPI (PAW3950, DPIRange 50..26000 step 50, 26100..32000 step 100) -------
export const DPI_MIN = 50;
export const DPI_MAX = 32000;

export function snapDpi(dpi) {
  dpi = Math.max(DPI_MIN, Math.min(DPI_MAX, Math.round(dpi)));
  return dpi > 26000 ? Math.round(dpi / 100) * 100 : Math.round(dpi / 50) * 50;
}

export function encodeDpi(dpi) {
  dpi = snapDpi(dpi);
  const high = dpi > 26000;
  const code = dpi / (high ? 100 : 50) - 1;
  const hi = code >> 8;
  const ex = (high ? 0x11 : 0) | (((hi << 4) | hi) << 2);
  return [code & 0xff, code & 0xff, ex & 0xff];
}

export function decodeDpi(lo, ex) {
  const step = ex & 0x11 ? 100 : 50;
  const code = (((ex >> 2) & 3) << 8) | lo;
  return (code + 1) * step;
}

// --- Option tables -----------------------------------------------------------
export const LOD_OPTIONS = [
  { v: 3, label: 'LOW' },
  { v: 1, label: 'MID' },
  { v: 2, label: 'HIGH' },
];
export const SLEEP_OPTIONS = [
  { v: 1, label: '10 SEC' },
  { v: 3, label: '30 SEC' },
  { v: 6, label: '1 MIN' },
  { v: 30, label: '5 MIN' },
  { v: 60, label: '10 MIN' },
  { v: 180, label: '30 MIN' },
];
export const DPI_LED_MODES = [
  { v: 0, label: 'OFF' },
  { v: 1, label: 'STEADY' },
  { v: 2, label: 'BREATHING' },
];
export const DPI_LED_BRIGHTNESS = [16, 30, 60, 90, 128, 150, 180, 210, 230, 255];
export const DONGLE_LED_MODES = [
  { v: 1, label: 'Connection & polling rate', hint: 'Red 125 · Blue 250 · Yellow 500 · Orange 1K · Purple 2K · Green 4K' },
  { v: 2, label: 'Battery level', hint: 'Green 100% · Yellow 66% · Orange 33% · Red 0%' },
  { v: 3, label: 'Low-battery warning only', hint: 'Light stays off, blinks red when battery is low' },
];

// --- Button functions ----------------------------------------------------------
export const KEY_TYPE = { DISABLE: 0, MOUSE: 1, DPI: 2, SHORTCUT: 5, MACRO: 6, RATE: 7, PROFILE: 9, DPI_LOCK: 0x0a };

export const MOUSE_BUTTONS = [
  { v: 0x01, label: 'Left Click' },
  { v: 0x02, label: 'Right Click' },
  { v: 0x04, label: 'Middle Click' },
  { v: 0x08, label: 'Back' },
  { v: 0x10, label: 'Forward' },
];
export const DPI_ACTIONS = [
  { v: 1, label: 'DPI Loop' },
  { v: 2, label: 'DPI +' },
  { v: 3, label: 'DPI −' },
];
export const MEDIA_KEYS = [
  { v: 0xcd, label: 'Play / Pause' },
  { v: 0xb5, label: 'Next Track' },
  { v: 0xb6, label: 'Previous Track' },
  { v: 0xb7, label: 'Stop' },
  { v: 0xe2, label: 'Mute' },
  { v: 0xe9, label: 'Volume Up' },
  { v: 0xea, label: 'Volume Down' },
  { v: 0x183, label: 'Media Player' },
  { v: 0x18a, label: 'Email' },
  { v: 0x192, label: 'Calculator' },
  { v: 0x194, label: 'My Computer' },
  { v: 0x221, label: 'Search' },
  { v: 0x223, label: 'Browser Home' },
  { v: 0x224, label: 'Browser Back' },
  { v: 0x225, label: 'Browser Forward' },
  { v: 0x226, label: 'Browser Stop' },
  { v: 0x227, label: 'Browser Refresh' },
  { v: 0x22a, label: 'Favorites' },
];
export const DEFAULT_BUTTON_NAMES = ['Left', 'Right', 'Middle', 'Back', 'Forward', 'DPI'];

// Event types inside shortcut / macro records (low nibble of the first byte).
export const EV = { MOD: 0, KEY: 1, MEDIA: 2, MOUSE: 4 };
const DOWN = 0x80;
const UP = 0x40;

// KeyboardEvent.code -> HID keyboard usage
export const HID_KEYS = (() => {
  const m = {};
  for (let i = 0; i < 26; i++) m['Key' + String.fromCharCode(65 + i)] = 0x04 + i;
  for (let i = 1; i <= 9; i++) m['Digit' + i] = 0x1d + i;
  m.Digit0 = 0x27;
  Object.assign(m, {
    Enter: 0x28, Escape: 0x29, Backspace: 0x2a, Tab: 0x2b, Space: 0x2c, Minus: 0x2d, Equal: 0x2e,
    BracketLeft: 0x2f, BracketRight: 0x30, Backslash: 0x31, Semicolon: 0x33, Quote: 0x34, Backquote: 0x35,
    Comma: 0x36, Period: 0x37, Slash: 0x38, CapsLock: 0x39, PrintScreen: 0x46, ScrollLock: 0x47, Pause: 0x48,
    Insert: 0x49, Home: 0x4a, PageUp: 0x4b, Delete: 0x4c, End: 0x4d, PageDown: 0x4e, ArrowRight: 0x4f,
    ArrowLeft: 0x50, ArrowDown: 0x51, ArrowUp: 0x52, NumLock: 0x53, NumpadDivide: 0x54, NumpadMultiply: 0x55,
    NumpadSubtract: 0x56, NumpadAdd: 0x57, NumpadEnter: 0x58, Numpad0: 0x62, NumpadDecimal: 0x63,
    IntlBackslash: 0x64, ContextMenu: 0x65,
  });
  for (let i = 1; i <= 9; i++) m['Numpad' + i] = 0x58 + i;
  for (let i = 1; i <= 12; i++) m['F' + i] = 0x39 + i;
  for (let i = 13; i <= 24; i++) m['F' + i] = 0x68 + (i - 13);
  return m;
})();
export const HID_MODS = {
  ControlLeft: 0x01, ShiftLeft: 0x02, AltLeft: 0x04, MetaLeft: 0x08,
  ControlRight: 0x10, ShiftRight: 0x20, AltRight: 0x40, MetaRight: 0x80,
};
const KEY_NAMES = Object.fromEntries(Object.entries(HID_KEYS).map(([c, u]) => [u, prettyCode(c)]));
const MOD_NAMES = Object.fromEntries(Object.entries(HID_MODS).map(([c, u]) => [u, prettyCode(c)]));

function prettyCode(code) {
  return code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace(/Left$/, '')
    .replace(/Right$/, ' R')
    .replace(/^Control/, 'Ctrl')
    .replace(/^Meta/, 'Win')
    .replace(/^Arrow/, '')
    .replace(/^Numpad/, 'Num ');
}

export function eventFromKeyboard(e) {
  if (e.code in HID_MODS) return { t: EV.MOD, v: HID_MODS[e.code] };
  if (e.code in HID_KEYS) return { t: EV.KEY, v: HID_KEYS[e.code] };
  return null;
}

export function eventLabel(ev) {
  switch (ev.t) {
    case EV.MOD: return MOD_NAMES[ev.v] ?? `Mod 0x${ev.v.toString(16)}`;
    case EV.KEY: return KEY_NAMES[ev.v] ?? `Key 0x${ev.v.toString(16)}`;
    case EV.MEDIA: return MEDIA_KEYS.find((m) => m.v === ev.v)?.label ?? `Media 0x${ev.v.toString(16)}`;
    case EV.MOUSE: return MOUSE_BUTTONS.find((m) => m.v === ev.v)?.label ?? `Mouse 0x${ev.v.toString(16)}`;
    default: return `? ${ev.t}`;
  }
}

function packEvent(ev) {
  return [(ev.down ? DOWN : UP) | ev.t, ev.v & 0xff, (ev.v >> 8) & 0xff];
}
function unpackEvent(b0, b1, b2) {
  return { down: (b0 & 0xc0) === DOWN, t: b0 & 0x0f, v: b1 | (b2 << 8) };
}

// Shortcut record (32 bytes): count, count x [state|type, v0, v1], check
export function encodeShortcut(events) {
  const n = events.length;
  if (n < 2 || n > 6) throw new Error('A key combination needs 2–6 events');
  const out = [n, ...events.flatMap(packEvent)];
  out.push(check(out));
  while (out.length < SHORTCUT_SIZE) out.push(0);
  return out;
}

export function decodeShortcut(b) {
  const n = b[0];
  if (n < 2 || n > 6 || check(b.slice(0, 3 * n + 1)) !== b[3 * n + 1]) return null;
  const evs = [];
  for (let i = 0; i < n; i++) evs.push(unpackEvent(b[1 + 3 * i], b[2 + 3 * i], b[3 + 3 * i]));
  return evs;
}

// Combo keys (pressed in order) -> press all, release in reverse.
export function comboEvents(keys) {
  return [...keys.map((k) => ({ ...k, down: true })), ...[...keys].reverse().map((k) => ({ ...k, down: false }))];
}

export function mediaEvents(usage) {
  return [{ t: EV.MEDIA, v: usage, down: true }, { t: EV.MEDIA, v: usage, down: false }];
}

// Macro record (384 bytes): nameLen, name[30], count, count x [state|type, v0, v1, dHi, dLo], check
export const MACRO_MAX_EVENTS = 70;
export function encodeMacro(name, events) {
  const n = events.length;
  if (n < 2 || n > MACRO_MAX_EVENTS) throw new Error(`A macro needs 2–${MACRO_MAX_EVENTS} events`);
  const nameBytes = [...new TextEncoder().encode(name || 'Macro')].slice(0, 30);
  const out = new Array(MACRO_SIZE).fill(0);
  out[0] = nameBytes.length;
  nameBytes.forEach((c, i) => (out[1 + i] = c));
  out[0x1f] = n;
  events.forEach((ev, i) => {
    const d = Math.max(0, Math.min(0xffff, Math.round(ev.delay ?? 10)));
    out.splice(0x20 + 5 * i, 5, ...packEvent(ev), d >> 8, d & 0xff);
  });
  const end = 0x20 + 5 * n;
  out[end] = check(out.slice(0x1f, end));
  return out.slice(0, end + 1);
}

export function decodeMacro(b) {
  const nameLen = b[0];
  const n = b[0x1f];
  if (nameLen < 1 || nameLen > 30 || n < 2 || n > MACRO_MAX_EVENTS) return null;
  const end = 0x20 + 5 * n;
  if (check(b.slice(0x1f, end)) !== b[end]) return null;
  const name = new TextDecoder().decode(new Uint8Array(b.slice(1, 1 + nameLen)));
  const events = [];
  for (let i = 0; i < n; i++) {
    const o = 0x20 + 5 * i;
    events.push({ ...unpackEvent(b[o], b[o + 1], b[o + 2]), delay: (b[o + 3] << 8) | b[o + 4] });
  }
  return { name, events };
}

export const MACRO_REPEAT = { UNTIL_RELEASED: 0xfe, UNTIL_ANY_KEY: 0xff };

// --- Button function model <-> 3-byte KeyFunMap ---------------------------------
export function describeFunction(fn) {
  switch (fn.kind) {
    case 'disable': return 'Disabled';
    case 'mouse': return MOUSE_BUTTONS.find((m) => m.v === fn.button)?.label ?? 'Mouse';
    case 'dpi': return DPI_ACTIONS.find((m) => m.v === fn.action)?.label ?? 'DPI';
    case 'dpiLock': return `DPI Lock · ${fn.dpi}`;
    case 'rate': return 'Polling Rate Cycle';
    case 'profile': return 'Profile Switch';
    case 'media': return MEDIA_KEYS.find((m) => m.v === fn.usage)?.label ?? 'Multimedia';
    case 'combo': return fn.keys.map(eventLabel).join(' + ') || 'Key Combination';
    case 'macro': return `Macro · ${fn.macro?.name ?? '—'}`;
    default: return `Unknown [${fn.raw?.map((x) => x.toString(16).padStart(2, '0')).join(' ')}]`;
  }
}

export function functionToKeyMap(fn, buttonIndex) {
  switch (fn.kind) {
    case 'disable': return [KEY_TYPE.DISABLE, 0, 0];
    case 'mouse': return [KEY_TYPE.MOUSE, fn.button, 0];
    case 'dpi': return [KEY_TYPE.DPI, fn.action, 0];
    case 'dpiLock': return [KEY_TYPE.DPI_LOCK, Math.min(255, Math.round(fn.dpi / 50) - 1), 0];
    case 'rate': return [KEY_TYPE.RATE, 0, 0];
    case 'profile': return [KEY_TYPE.PROFILE, 0, 0];
    case 'media':
    case 'combo': return [KEY_TYPE.SHORTCUT, 0, 0];
    case 'macro': return [KEY_TYPE.MACRO, buttonIndex, fn.repeat ?? 1];
    default: return fn.raw.slice(0, 3);
  }
}

export function keyMapToFunction([type, p1, p2], shortcutBytes, macroBytes) {
  switch (type) {
    case KEY_TYPE.DISABLE: return { kind: 'disable' };
    case KEY_TYPE.MOUSE: return { kind: 'mouse', button: p1 };
    case KEY_TYPE.DPI: return { kind: 'dpi', action: p1 };
    case KEY_TYPE.DPI_LOCK: return { kind: 'dpiLock', dpi: (p1 + 1) * 50 };
    case KEY_TYPE.RATE: return { kind: 'rate' };
    case KEY_TYPE.PROFILE: return { kind: 'profile' };
    case KEY_TYPE.SHORTCUT: {
      const evs = shortcutBytes && decodeShortcut(shortcutBytes);
      if (evs && evs.length === 2 && evs[0].t === EV.MEDIA) return { kind: 'media', usage: evs[0].v };
      if (evs) return { kind: 'combo', keys: evs.filter((e) => e.down).map(({ t, v }) => ({ t, v })) };
      return { kind: 'combo', keys: [] };
    }
    case KEY_TYPE.MACRO: return { kind: 'macro', repeat: p2, macro: macroBytes ? decodeMacro(macroBytes) : null };
    default: return { kind: 'raw', raw: [type, p1, p2] };
  }
}
