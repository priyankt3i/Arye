import { Mouse, webHidSupported } from './device.js';
import { DEMO_FLASH } from './demo-flash.js';
import {
  ADDR, BUTTON_COUNT, DPI_SLOTS, DPI_MIN, DPI_MAX, REPORT_RATES, LOD_OPTIONS, SLEEP_OPTIONS,
  DONGLE_LED_MODES, MOUSE_BUTTONS, DPI_ACTIONS, MEDIA_KEYS, DEFAULT_BUTTON_NAMES, EV,
  MACRO_MAX_EVENTS, MACRO_REPEAT, snapDpi, describeFunction, eventFromKeyboard, eventLabel,
} from './protocol.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k));
  return n;
}
const hex = (rgb) => '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('');
const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// --- feedback ----------------------------------------------------------------------
let toastTimer;
function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', error);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), error ? 4500 : 1600);
}
function busy(text, p = null) {
  $('#busy').hidden = text == null;
  if (text != null) {
    $('#busy-text').textContent = text;
    $('#busy-bar').style.width = p == null ? '100%' : `${Math.round(p * 100)}%`;
  }
}
function confirmDialog(text) {
  const d = $('#confirm');
  $('#confirm-text').textContent = text;
  d.showModal();
  return new Promise((r) => d.addEventListener('close', () => r(d.returnValue === 'ok'), { once: true }));
}
async function save(fn, msg = 'SAVED') {
  try {
    await fn();
    toast(msg);
    if (mouse) renderStage();
    return true;
  } catch (e) {
    console.error(e);
    toast(e.message || 'Write failed', true);
    return false;
  }
}

// --- generic controls ------------------------------------------------------------------
function seg(container, options, current, onPick) {
  container.replaceChildren(
    ...options.map((o) =>
      el('button', {
        type: 'button',
        'aria-pressed': String(o.v === current),
        onclick: async () => {
          if (await onPick(o.v)) seg(container, options, o.v, onPick);
        },
      }, o.label),
    ),
  );
}

function bindRange(input, value, format, onCommit) {
  const out = input.parentElement.querySelector('output');
  const paint = () => {
    const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
    input.style.setProperty('--fill', `${pct}%`);
    if (out) out.textContent = format(+input.value);
  };
  input.value = value;
  paint();
  input.oninput = paint;
  input.onchange = () => onCommit(+input.value);
}

function makeSwitch(checked, onToggle) {
  const b = el('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(checked) });
  b.onclick = async () => {
    const next = b.getAttribute('aria-checked') !== 'true';
    if (await onToggle(next)) b.setAttribute('aria-checked', String(next));
  };
  return b;
}

// --- app state -----------------------------------------------------------------------------
let mouse = null;
let selected = 0;
let pollTimer = null;

const TOGGLES = {
  motionSync: { get: () => mouse.byte(ADDR.motionSync) === 1, set: (v) => mouse.setByte(ADDR.motionSync, v ? 1 : 0) },
  angleSnap: { get: () => mouse.byte(ADDR.angleSnap) === 1, set: (v) => mouse.setByte(ADDR.angleSnap, v ? 1 : 0) },
  ripple: { get: () => mouse.byte(ADDR.ripple) === 1, set: (v) => mouse.setByte(ADDR.ripple, v ? 1 : 0) },
  boost: { get: () => mouse.byte(ADDR.boost) === 1, set: (v) => mouse.setByte(ADDR.boost, v ? 1 : 0) },
  longRange: {
    get: () => mouse.longRangeOn,
    set: async (v) => {
      mouse.longRangeOn = await mouse.setLongRange(v);
      if (mouse.longRangeOn !== v) throw new Error('Receiver acknowledged the change but still reports long-distance mode Off');
    },
  },};

// --- landing / connection ----------------------------------------------------------------------
function initLanding() {
  const note = $('#support-note');
  if (!webHidSupported()) {
    note.textContent = 'This browser has no WebHID. Open the page in Chrome, Edge, Opera or another Chromium browser, served from https:// or localhost.';
    $('#connect').disabled = true;
  } else {
    note.textContent = 'Works with the RCC-1 8K receiver and the wired connection. Close the official configurator first if it is running.';
  }
  $('#connect').onclick = async () => {
    try {
      const m = await Mouse.request();
      if (m) await start(m);
    } catch (e) {
      console.error(e);
      toast(e.message, true);
    }
  };
  $('#demo').onclick = () => start(Mouse.demo(DEMO_FLASH));
  $('#disconnect').onclick = stop;
  if (webHidSupported()) {
    navigator.hid.addEventListener('disconnect', (e) => {
      if (mouse?.t.hid === e.device) {
        toast('Device disconnected', true);
        stop();
      }
    });
  }
}

async function start(m) {
  mouse = m;
  mouse.onEvent(() => scheduleRefresh());
  $('#landing').hidden = true;
  $('#app').hidden = false;
  $('#status').hidden = false;
  $('#st-name').textContent = mouse.name;
  $('#demo-banner').hidden = !mouse.isDemo;
  await waitOnlineAndLoad();
}

async function stop() {
  clearInterval(pollTimer);
  pollTimer = null;
  try { await mouse?.close(); } catch {}
  mouse = null;
  $('#app').hidden = true;
  $('#status').hidden = true;
  $('#landing').hidden = false;
  busy(null);
}

async function waitOnlineAndLoad() {
  busy('CONNECTING', 0);
  try {
    while (mouse && !(await mouse.online())) {
      busy(null);
      $('#offline').hidden = false;
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (!mouse) return;
    $('#offline').hidden = true;
    busy('READING DEVICE', 0);
    await mouse.load((p) => busy('READING DEVICE', p));
    mouse.versionsInfo = await mouse.versions();
    mouse.batteryInfo = await mouse.battery();
    if (mouse.isReceiver) {
      mouse.longRangeOn = await mouse.longRange();
      mouse.dongleLedData = await mouse.dongleLed();
    }
    renderAll();
    clearInterval(pollTimer);
    pollTimer = setInterval(poll, 2000);
  } catch (e) {
    console.error(e);
    toast(`Could not read the device: ${e.message}`, true);
  } finally {
    busy(null);
  }
}

let refreshTimer;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    try {
      const [cur] = await mouse.readFlash(ADDR.currentDpi, 1);
      mouse.config[ADDR.currentDpi] = cur;
      mouse.batteryInfo = await mouse.battery();
      renderStatus();
      renderStages();
      renderStage();
    } catch {}
  }, 250);
}

// Every 2 s: read the active DPI stage (changed by the hardware DPI button) and the link state.
// Every 30 s: battery.
let pollTick = 0;
async function poll() {
  if (!mouse) return;
  try {
    const on = await mouse.online();
    $('#offline').hidden = on;
    $('#st-conn').classList.toggle('off', !on);
    if (!on) return;
    // reportRate, maxDpi, currentDpi (+ check bytes) in one 6-byte read; the mouse can change these itself.
    const head = await mouse.readFlash(ADDR.reportRate, 6);
    let changed = false;
    for (let a = 0; a < 6; a += 2) {
      const [v, c] = [head[a], head[a + 1]];
      if (((v + c) & 0xff) === 0x55 && v !== mouse.config[a]) {
        if (a === ADDR.reportRate) console.info(`polling rate changed on the device: 0x${mouse.config[a].toString(16)} -> 0x${v.toString(16)}`);
        mouse.config[a] = v;
        mouse.config[a + 1] = c;
        changed = true;
      }
    }
    if (changed) {
      renderMain();
      renderStage();
    }
    if (pollTick++ % 15 === 0) {
      mouse.batteryInfo = (await mouse.battery()) ?? mouse.batteryInfo;
      renderStatus();
      renderStage();
    }
  } catch (e) {
    console.warn('poll failed', e);
  }
}

// --- rendering ------------------------------------------------------------------------------------
function renderAll() {
  renderStatus();
  renderMain();
  renderButtons();
  renderPerformance();
  renderAdvanced();
  renderDevice();
  renderStage();
}

function renderStatus() {
  const v = mouse.versionsInfo ?? {};
  $('#st-ver').textContent = [v.mouse && `Mouse v${v.mouse}`, v.dongle && `Dongle v${v.dongle}`].filter(Boolean).join(' · ');
  const b = mouse.batteryInfo;
  const bat = $('#st-battery');
  if (!b) return;
  const cells = Array.from({ length: 10 }, (_, i) => el('i', { class: i < Math.round(b.percent / 10) ? 'on' : '' }));
  bat.querySelector('.cells').replaceChildren(...cells);
  bat.querySelector('.pct').textContent = `${b.percent}%`;
  bat.classList.toggle('low', b.percent <= 15);
  bat.classList.toggle('charging', b.charging);
}

// MAIN ------------------------------------------------------------------------------------------------
function renderMain() {
  renderStages();
  const rate = mouse.byte(ADDR.reportRate);
  seg($('#rates'), REPORT_RATES.map((r) => ({ v: r.code, label: r.hz >= 1000 ? `${r.hz / 1000}K` : String(r.hz) })), rate, (code) =>
    save(() => mouse.setByte(ADDR.reportRate, code)),
  );
  $('#rate-hint').textContent = mouse.isReceiver
    ? 'Above 1000 Hz uses more CPU and battery. Verify with tests/measure-polling-rate.py.'
    : 'Wired connection.';
}

let editStage = null;
// Quadratic slider scale so the common 400–3200 range gets most of the travel.
const toDpi = (t) => snapDpi(DPI_MIN + (DPI_MAX - DPI_MIN) * (t / 1000) ** 2);
const toPos = (d) => Math.round(1000 * Math.sqrt((d - DPI_MIN) / (DPI_MAX - DPI_MIN)));

function renderStages() {
  const count = Math.min(DPI_SLOTS, Math.max(1, mouse.byte(ADDR.maxDpi)));
  const active = mouse.byte(ADDR.currentDpi);
  if (editStage == null || editStage >= count) editStage = Math.min(active, count - 1);
  $('#stage-count').replaceChildren(
    el('button', { type: 'button', 'aria-label': 'Fewer stages', onclick: () => setCount(count - 1) }, '−'),
    el('span', {}, `${count} STAGE${count > 1 ? 'S' : ''}`),
    el('button', { type: 'button', 'aria-label': 'More stages', onclick: () => setCount(count + 1) }, '+'),
  );
  const stages = mouse.dpiStages;
  $('#stages').replaceChildren(
    ...stages.slice(0, count).map((s, i) =>
      el('button', {
        type: 'button',
        class: `chip${i === active ? ' active' : ''}${i === editStage ? ' editing' : ''}`,
        style: `--c:${hex(s.color)}`,
        'aria-pressed': String(i === editStage),
        onclick: () => { editStage = i; renderStages(); },
      },
      el('small', {}, `STAGE ${String(i + 1).padStart(2, '0')}`, i === active ? el('em', {}, 'ACTIVE') : null),
      el('b', {}, s.dpi.toLocaleString('en-US'))),
    ),
  );

  const i = editStage;
  const s = stages[i];
  const num = el('input', { type: 'number', min: DPI_MIN, max: DPI_MAX, step: s.dpi >= 26000 ? 100 : 50, value: s.dpi, 'aria-label': `Stage ${i + 1} DPI` });
  const range = el('input', { type: 'range', min: 0, max: 1000, step: 1, value: toPos(s.dpi), 'aria-label': `Stage ${i + 1} DPI slider` });
  const paint = () => range.style.setProperty('--fill', `${range.value / 10}%`);
  paint();
  const commit = async (v) => {
    v = snapDpi(v);
    num.value = v;
    range.value = toPos(v);
    paint();
    if (await save(() => mouse.setDpi(i, v))) { renderStages(); renderStage(); }
  };
  range.oninput = () => { num.value = toDpi(+range.value); paint(); };
  range.onchange = () => commit(toDpi(+range.value));
  num.onchange = () => commit(+num.value);
  const color = el('input', { type: 'color', class: 'swatch', value: hex(s.color), 'aria-label': `Stage ${i + 1} colour` });
  color.onchange = async () => { if (await save(() => mouse.setDpiColor(i, rgbOf(color.value)))) renderStages(); };
  const activate = el('button', { type: 'button', class: 'btn btn-sm', disabled: i === active }, i === active ? 'ACTIVE' : 'SET ACTIVE');
  activate.onclick = async () => { if (await save(() => mouse.setByte(ADDR.currentDpi, i))) { renderStages(); renderStage(); } };
  $('#stage-editor').replaceChildren(color, range, num, activate);
}

async function setCount(n) {
  n = Math.min(DPI_SLOTS, Math.max(1, n));
  const ok = await save(async () => {
    if (mouse.byte(ADDR.currentDpi) >= n) await mouse.setByte(ADDR.currentDpi, n - 1);
    await mouse.setByte(ADDR.maxDpi, n);
  });
  if (ok) renderStages();
}

// STAGE (left preview column) ----------------------------------------------------------------------------
let currentTab = 'main';
// Button positions on assets/rcc1-top.png (percent of the 1400x1400 render), and which side the label sits on.
const CALLOUTS = [
  { x: 42, y: 27, side: 'l' }, // 1 left click
  { x: 59, y: 37, side: 'r' }, // 2 right click
  { x: 50.5, y: 29.5, side: 'r' }, // 3 wheel
  { x: 34.2, y: 53, side: 'l' }, // 4 back (rear side button)
  { x: 34.2, y: 42, side: 'l' }, // 5 forward (front side button)
  { x: 50.5, y: 22.5, side: 'r' }, // 6 DPI button ahead of the wheel
];
// The top render is scaled 1.5x around (50%, 38%) in CSS; map render coords to container coords.
const projX = (x) => 50 + (x - 50) * 1.5;
const projY = (y) => 38 + (y - 38) * 1.5;

function img(name, cls = '') {
  return el('img', { src: `assets/rcc1-${name}.png`, alt: '', class: cls, draggable: 'false' });
}

function readout(items) {
  $('#readout').replaceChildren(...items.map(([v, k]) => el('div', {}, el('b', {}, v), el('small', {}, k))));
}

function renderStage() {
  if (!mouse) return;
  const view = $('#stage-view');
  const rate = REPORT_RATES.find((r) => r.code === mouse.byte(ADDR.reportRate));
  const rateLabel = rate ? (rate.hz >= 1000 ? `${rate.hz / 1000}K` : rate.hz) : '—';
  const bat = mouse.batteryInfo ? `${mouse.batteryInfo.percent}%` : '—';
  switch (currentTab) {
    case 'buttons': {
      const wrap = el('div', { class: 'view-buttons' }, img('top'));
      CALLOUTS.forEach((c, i) => {
        const x = projX(c.x);
        const y = projY(c.y);
        const fn = describeFunction(mouse.buttonFunction(i));
        const tag = el('span', { class: 'tag' }, el('small', {}, `${i + 1} · ${DEFAULT_BUTTON_NAMES[i]}`), el('span', {}, fn));
        const co = el('div', {
          class: `callout ${c.side}${i === selected ? ' selected' : ''}`,
          style: c.side === 'l' ? `top:${y}%;width:${x}%` : `top:${y}%;width:${100 - x}%`,
          role: 'button', tabindex: '0', 'aria-label': `Button ${i + 1}: ${fn}`,
          onclick: () => selectButton(i),
          onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && selectButton(i),
        }, tag, el('i', { class: 'line' }), el('span', { class: 'dot' }, String(i + 1)));
        wrap.append(co);
      });
      view.replaceChildren(wrap);
      readout([[String(selected + 1), 'Selected'], [DEFAULT_BUTTON_NAMES[selected], 'Button'], [String(BUTTON_COUNT), 'Programmable']]);
      break;
    }
    case 'performance': {
      const lod = LOD_OPTIONS.find((o) => o.v === mouse.byte(ADDR.lod))?.label ?? '—';
      view.replaceChildren(img('bottom', 'zoom'));
      readout([[lod, 'Lift-off'], [mouse.byte(ADDR.motionSync) === 1 ? 'ON' : 'OFF', 'Motion Sync'], ['3950', 'Sensor']]);
      break;
    }
    case 'advanced': {
      const raw = mouse.byte(ADDR.angleTune);
      const angle = mouse.byte(ADDR.angleTuneEnable) === 1 ? (raw > 127 ? raw - 256 : raw) : 0;
      const top = img('top', 'zoom');
      top.id = 'angle-rot';
      top.style.transform = `scale(1.35) rotate(${angle}deg)`;
      view.replaceChildren(el('div', { class: 'axes' }), top);
      const sleep = SLEEP_OPTIONS.find((o) => o.v === mouse.byte(ADDR.sleepTime))?.label ?? '—';
      readout([[`${angle > 0 ? '+' : ''}${angle}°`, 'Angle'], [`${mouse.byte(ADDR.debounce)} ms`, 'Debounce'], [sleep, 'Sleep']]);
      break;
    }
    case 'device': {
      view.replaceChildren(img('front', 'zoom'));
      const v = mouse.versionsInfo ?? {};
      readout([[v.mouse ? `v${v.mouse}` : '—', 'Mouse FW'], [v.dongle ? `v${v.dongle}` : 'USB', mouse.isReceiver ? 'Receiver FW' : 'Connection'], [bat, 'Battery']]);
      break;
    }
    default: {
      view.replaceChildren(img('hero', 'zoom'));
      const cur = mouse.dpiStages[mouse.byte(ADDR.currentDpi)];
      readout([[cur ? cur.dpi.toLocaleString('en-US') : '—', 'DPI'], [`${rateLabel}`, 'Hz'], [bat, 'Battery']]);
    }
  }
}

// BUTTONS ---------------------------------------------------------------------------------------------
function renderButtons() {
  renderEditor();
  if (currentTab === 'buttons') renderStage();
}

function selectButton(i) {
  selected = i;
  draft = null;
  renderButtons();
}

const CATEGORIES = [
  { id: 'mouse', label: 'Mouse' },
  { id: 'dpi', label: 'DPI' },
  { id: 'keyboard', label: 'Key Combination' },
  { id: 'media', label: 'Multimedia' },
  { id: 'macro', label: 'Macro' },
  { id: 'other', label: 'Other' },
];
let draft = null; // { cat, fn }

function categoryOf(fn) {
  return { mouse: 'mouse', dpi: 'dpi', dpiLock: 'dpi', combo: 'keyboard', media: 'media', macro: 'macro' }[fn.kind] ?? 'other';
}

function leftClickGuard(fn) {
  const isLeft = (f) => f.kind === 'mouse' && f.button === 0x01;
  if (isLeft(fn)) return true;
  for (let i = 0; i < BUTTON_COUNT; i++) if (i !== selected && isLeft(mouse.buttonFunction(i))) return true;
  toast('Keep at least one button set to Left Click', true);
  return false;
}

async function applyFunction(fn) {
  if (!leftClickGuard(fn)) return;
  const ok = await save(() => mouse.setButton(selected, fn), `BUTTON ${selected + 1} · ${describeFunction(fn).toUpperCase()}`);
  if (ok) {
    draft = null;
    renderButtons();
  }
}

function renderEditor() {
  const ed = $('#editor');
  ed.hidden = false;
  const current = mouse.buttonFunction(selected);
  draft ??= { cat: categoryOf(current), fn: current };
  const picker = el('div', { class: 'button-tabs' },
    ...Array.from({ length: BUTTON_COUNT }, (_, i) =>
      el('button', { type: 'button', 'aria-pressed': String(i === selected), onclick: () => selectButton(i) },
        el('small', {}, `${i + 1} · ${DEFAULT_BUTTON_NAMES[i].toUpperCase()}`),
        el('span', {}, describeFunction(mouse.buttonFunction(i))))));
  const head = el('header', { class: 'card-head' },
    el('h3', {}, `Button ${selected + 1} · ${DEFAULT_BUTTON_NAMES[selected]}`),
    el('span', { class: 'hint' }, `Current: ${describeFunction(current)}`));
  const cats = el('div', { class: 'cats' },
    ...CATEGORIES.map((c) => el('button', { type: 'button', 'aria-pressed': String(c.id === draft.cat), onclick: () => { draft.cat = c.id; renderEditor(); } }, c.label)));
  const body = el('div');
  const opt = (label, fn, active) => el('button', { type: 'button', class: 'option', 'aria-pressed': String(active), onclick: () => applyFunction(fn) }, label);

  switch (draft.cat) {
    case 'mouse':
      body.append(el('div', { class: 'options' }, ...MOUSE_BUTTONS.map((m) => opt(m.label, { kind: 'mouse', button: m.v }, current.kind === 'mouse' && current.button === m.v))));
      break;
    case 'dpi': {
      body.append(el('div', { class: 'options' }, ...DPI_ACTIONS.map((m) => opt(m.label, { kind: 'dpi', action: m.v }, current.kind === 'dpi' && current.action === m.v))));
      const lock = el('input', { type: 'number', min: 50, max: 12800, step: 50, value: current.kind === 'dpiLock' ? current.dpi : 400, style: 'max-width:120px' });
      body.append(el('div', { class: 'row' },
        el('span', { class: 'label', style: 'margin:0' }, 'DPI Lock (hold for fixed DPI)'), lock,
        el('button', { type: 'button', class: 'btn btn-sm', onclick: () => applyFunction({ kind: 'dpiLock', dpi: Math.min(12800, snapDpi(+lock.value)) }) }, 'SET LOCK')));
      break;
    }
    case 'keyboard':
      body.append(comboEditor(current));
      break;
    case 'media':
      body.append(el('div', { class: 'options' }, ...MEDIA_KEYS.map((m) => opt(m.label, { kind: 'media', usage: m.v }, current.kind === 'media' && current.usage === m.v))));
      break;
    case 'macro':
      body.append(macroEditor(current));
      break;
    default:
      body.append(el('div', { class: 'options' },
        opt('Polling Rate Cycle', { kind: 'rate' }, current.kind === 'rate'),
        opt('Profile Switch', { kind: 'profile' }, current.kind === 'profile'),
        opt('Disable', { kind: 'disable' }, current.kind === 'disable')));
  }
  ed.replaceChildren(picker, head, cats, body);
}

function comboEditor(current) {
  let keys = current.kind === 'combo' ? [...current.keys] : [];
  const box = el('div', { class: 'capture', tabindex: '0' });
  const paint = () => box.replaceChildren(...(keys.length ? keys.map((k) => el('span', { class: 'kbd' }, eventLabel(k))) : [el('span', { class: 'hint', style: 'margin:0' }, 'Click here, then press up to 3 keys, e.g. Ctrl + Shift + T')]));
  let fresh = true;
  box.addEventListener('keydown', (e) => {
    e.preventDefault();
    if (e.repeat) return;
    const ev = eventFromKeyboard(e);
    if (!ev) return;
    if (fresh) { keys = []; fresh = false; }
    if (keys.length < 3 && !keys.some((k) => k.t === ev.t && k.v === ev.v)) keys.push(ev);
    paint();
  });
  box.addEventListener('keyup', (e) => { e.preventDefault(); fresh = true; });
  paint();
  return el('div', {}, box,
    el('div', { class: 'row' },
      el('button', { type: 'button', class: 'btn btn-sm', onclick: () => { keys = []; paint(); box.focus(); } }, 'CLEAR'),
      el('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: () => keys.length ? applyFunction({ kind: 'combo', keys }) : toast('Press a key first', true) }, 'ASSIGN')),
    el('p', { class: 'hint' }, 'The mouse sends the keys pressed in order and releases them in reverse.'));
}

// Macro editor ------------------------------------------------------------------------------------------
const LIB_KEY = 'rcc1.macros';
const loadLib = () => { try { return JSON.parse(localStorage.getItem(LIB_KEY)) ?? []; } catch { return []; } };
const saveLib = (lib) => { try { localStorage.setItem(LIB_KEY, JSON.stringify(lib)); } catch {} };
const MOUSE_BTN_FROM_DOM = { 0: 0x01, 1: 0x04, 2: 0x02, 3: 0x08, 4: 0x10 };

function macroEditor(current) {
  const m = current.kind === 'macro' && current.macro
    ? { name: current.macro.name, events: current.macro.events.map((e) => ({ ...e })), repeat: current.repeat }
    : { name: `Macro ${selected + 1}`, events: [], repeat: 1 };
  let recording = false;
  let last = 0;
  let autoDelay = true;
  let defDelay = 20;

  const list = el('ol', { class: 'macro-events' });
  const counter = el('span', { class: 'hint', style: 'margin:0' });
  const paint = () => {
    list.replaceChildren(...m.events.map((ev, i) => {
      const d = el('input', { type: 'number', min: 0, max: 65535, value: ev.delay, 'aria-label': 'Delay after (ms)' });
      d.onchange = () => (ev.delay = Math.max(0, Math.min(65535, +d.value || 0)));
      return el('li', {},
        el('span', { class: `dir ${ev.down ? 'down' : 'up'}`, title: ev.down ? 'Press' : 'Release' }, ev.down ? '↓' : '↑'),
        el('span', {}, eventLabel(ev)),
        el('label', { style: 'display:flex;gap:6px;align-items:center' }, d, 'ms'),
        el('button', { type: 'button', class: 'del', 'aria-label': 'Delete', onclick: () => { m.events.splice(i, 1); paint(); } }, '✕'));
    }));
    counter.textContent = `${m.events.length} / ${MACRO_MAX_EVENTS} events`;
  };
  const push = (ev) => {
    if (m.events.length >= MACRO_MAX_EVENTS) { stopRec(); toast('Macro is full (70 events)', true); return; }
    const now = performance.now();
    if (m.events.length) m.events.at(-1).delay = autoDelay ? Math.min(65535, Math.round(now - last)) : defDelay;
    last = now;
    m.events.push({ ...ev, delay: defDelay });
    paint();
  };
  const onKey = (e) => {
    if (!recording || e.repeat) return;
    const ev = eventFromKeyboard(e);
    if (!ev) return;
    e.preventDefault();
    push({ ...ev, down: e.type === 'keydown' });
  };
  const recArea = el('div', { class: 'capture', tabindex: '0' }, el('span', { class: 'hint', style: 'margin:0' }, 'Press RECORD, then type or click inside this box'));
  const onMouse = (e) => {
    if (!recording || !(e.button in MOUSE_BTN_FROM_DOM)) return;
    e.preventDefault();
    push({ t: EV.MOUSE, v: MOUSE_BTN_FROM_DOM[e.button], down: e.type === 'mousedown' });
  };
  recArea.addEventListener('mousedown', onMouse);
  recArea.addEventListener('mouseup', onMouse);
  recArea.addEventListener('contextmenu', (e) => recording && e.preventDefault());
  const recBtn = el('button', { type: 'button', class: 'btn btn-sm' }, 'RECORD');
  const stopRec = () => {
    recording = false;
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKey, true);
    recBtn.textContent = 'RECORD';
    recArea.firstChild.className = 'hint';
  };
  recBtn.onclick = () => {
    if (recording) return stopRec();
    recording = true;
    last = performance.now();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    recBtn.textContent = 'STOP RECORD';
    recArea.firstChild.className = 'rec';
    recArea.firstChild.textContent = '● RECORDING';
    recArea.focus();
  };

  const name = el('input', { type: 'text', maxlength: 30, value: m.name, 'aria-label': 'Macro name' });
  name.oninput = () => (m.name = name.value);
  const auto = el('input', { type: 'checkbox', checked: autoDelay });
  auto.onchange = () => (autoDelay = auto.checked);
  const def = el('input', { type: 'number', min: 1, max: 65535, value: defDelay, style: 'max-width:90px' });
  def.onchange = () => (defDelay = Math.max(1, +def.value || 10));

  const count = el('input', { type: 'number', min: 1, max: 253, value: m.repeat >= 1 && m.repeat <= 253 ? m.repeat : 1, style: 'max-width:80px' });
  const modeOf = (r) => (r === MACRO_REPEAT.UNTIL_RELEASED ? 'held' : r === MACRO_REPEAT.UNTIL_ANY_KEY ? 'any' : 'count');
  let mode = modeOf(m.repeat);
  const radio = (v, label, extra) => {
    const r = el('input', { type: 'radio', name: 'repeat', value: v, checked: mode === v });
    r.onchange = () => (mode = v);
    return el('label', {}, r, el('span', {}, label, extra));
  };

  const lib = loadLib();
  const libSel = el('select', { 'aria-label': 'Saved macros', style: 'width:100%' },
    el('option', { value: '' }, lib.length ? 'Load a saved macro…' : 'No saved macros yet'),
    ...lib.map((x, i) => el('option', { value: i }, x.name)));
  libSel.onchange = () => {
    const x = lib[+libSel.value];
    if (!x) return;
    m.name = name.value = x.name;
    m.events = x.events.map((e) => ({ ...e }));
    paint();
  };

  // Manual insertion
  const addSel = el('select', { 'aria-label': 'Click to add' },
    el('optgroup', { label: 'Mouse' }, ...MOUSE_BUTTONS.map((b) => el('option', { value: `m${b.v}` }, b.label))),
    el('optgroup', { label: 'Multimedia' }, ...MEDIA_KEYS.map((b) => el('option', { value: `c${b.v}` }, b.label))));
  const addClick = () => {
    const v = addSel.value;
    const ev = { t: v[0] === 'm' ? EV.MOUSE : EV.MEDIA, v: +v.slice(1) };
    if (m.events.length + 2 > MACRO_MAX_EVENTS) return toast('Macro is full (70 events)', true);
    m.events.push({ ...ev, down: true, delay: defDelay }, { ...ev, down: false, delay: defDelay });
    paint();
  };

  const apply = () => {
    if (recording) stopRec();
    const repeat = mode === 'held' ? MACRO_REPEAT.UNTIL_RELEASED : mode === 'any' ? MACRO_REPEAT.UNTIL_ANY_KEY : Math.max(1, Math.min(253, +count.value || 1));
    if (m.events.length < 2) return toast('Record at least one key press and release', true);
    if (!m.name.trim()) return toast('Give the macro a name', true);
    applyFunction({ kind: 'macro', repeat, macro: { name: m.name.trim(), events: m.events } });
  };
  const store = () => {
    if (m.events.length < 2) return toast('Nothing to save yet', true);
    const all = loadLib().filter((x) => x.name !== m.name);
    all.push({ name: m.name, events: m.events });
    saveLib(all);
    toast('SAVED TO LIBRARY');
  };
  const exportMacro = () => download(`${m.name || 'macro'}.json`, { format: 'rcc1-macro', name: m.name, events: m.events });
  const importInput = el('input', { type: 'file', accept: '.json', hidden: true });
  importInput.onchange = async () => {
    try {
      const x = JSON.parse(await importInput.files[0].text());
      if (!Array.isArray(x.events)) throw new Error('Not a macro file');
      m.name = name.value = String(x.name ?? 'Imported').slice(0, 30);
      m.events = x.events.slice(0, MACRO_MAX_EVENTS);
      paint();
    } catch (e) { toast(e.message, true); }
  };

  paint();
  return el('div', { class: 'macro' },
    el('div', {},
      el('div', { class: 'row', style: 'margin-top:0' }, el('span', { class: 'label', style: 'margin:0' }, 'Name'), name),
      el('div', { class: 'row' }, recBtn,
        el('button', { type: 'button', class: 'btn btn-sm', onclick: () => { m.events = []; paint(); } }, 'CLEAR'), counter),
      el('div', { class: 'row' }, recArea),
      el('div', { class: 'row' }, list),
      el('div', { class: 'row' }, addSel, el('button', { type: 'button', class: 'btn btn-sm', onclick: addClick }, 'ADD CLICK'))),
    el('aside', {},
      el('div', { class: 'field-block', style: 'margin:0' },
        el('span', { class: 'label' }, 'Recording'),
        el('div', { class: 'radios' }, el('label', {}, auto, el('span', {}, 'Record real delays'))),
        el('div', { class: 'row' }, el('span', { class: 'label', style: 'margin:0' }, 'Default delay (ms)'), def)),
      el('div', { class: 'field-block', style: 'margin:0' },
        el('span', { class: 'label' }, 'Playback'),
        el('div', { class: 'radios' },
          radio('count', 'Repeat', el('span', { style: 'display:inline-flex;gap:6px;align-items:center;margin-left:6px' }, count, 'times')),
          radio('held', 'Until the button is released'),
          radio('any', 'Until any key is pressed'))),
      el('button', { type: 'button', class: 'btn btn-primary', onclick: apply }, 'ASSIGN TO BUTTON →'),
      el('div', { class: 'field-block', style: 'margin:0' },
        el('span', { class: 'label' }, 'Library'), libSel,
        el('div', { class: 'row' },
          el('button', { type: 'button', class: 'btn btn-sm', onclick: store }, 'SAVE'),
          el('button', { type: 'button', class: 'btn btn-sm', onclick: exportMacro }, 'EXPORT'),
          el('label', { class: 'btn btn-sm' }, 'IMPORT', importInput)))));
}

// PERFORMANCE / ADVANCED ----------------------------------------------------------------------------------
function renderToggles(root) {
  for (const row of $$('.toggle-row', root)) {
    const key = row.dataset.toggle;
    row.querySelector('.switch')?.remove();
    row.append(makeSwitch(TOGGLES[key].get(), (v) => save(() => TOGGLES[key].set(v))));
  }
}

function renderPerformance() {
  seg($('#lod'), LOD_OPTIONS, mouse.byte(ADDR.lod), (v) => save(() => mouse.setByte(ADDR.lod, v)));
  renderToggles($('[data-panel="performance"]'));
}

function renderAdvanced() {
  renderToggles($('[data-panel="advanced"]'));
  const raw = mouse.byte(ADDR.angleTune);
  const angle = mouse.byte(ADDR.angleTuneEnable) === 1 ? (raw > 127 ? raw - 256 : raw) : 0;
  const rot = (v) => {
    const r = $('#angle-rot');
    if (r) r.style.transform = `scale(1.35) rotate(${v}deg)`;
  };
  bindRange($('#angle'), Math.max(-33, Math.min(33, angle)), (v) => { rot(v); return `${v > 0 ? '+' : ''}${v}°`; },
    (v) => save(() => mouse.setAngleTune(v)));
  seg($('#sleep'), SLEEP_OPTIONS, mouse.byte(ADDR.sleepTime), (v) => save(() => mouse.setByte(ADDR.sleepTime, v)));
  const warn = $('#debounce-warn');
  bindRange($('#debounce'), mouse.byte(ADDR.debounce), (v) => { warn.hidden = v >= 3; return v; },
    (v) => save(() => mouse.setByte(ADDR.debounce, v)));
}

// DEVICE ---------------------------------------------------------------------------------------------------
function renderDevice() {
  const v = mouse.versionsInfo ?? {};
  const b = mouse.batteryInfo ?? {};
  const rows = [
    ['Device', mouse.name],
    ['Connection', mouse.connection],
    ['Mouse firmware', v.mouse ? `v${v.mouse}` : '—'],
    ...(mouse.isReceiver ? [['Receiver firmware', v.dongle ? `v${v.dongle}` : '—']] : []),
    ['Battery', b.percent != null ? `${b.percent}%${b.charging ? ' · charging' : ''}` : '—'],
    ['Cell voltage', b.millivolts ? `${(b.millivolts / 1000).toFixed(2)} V` : '—'],
  ];
  $('#info').replaceChildren(...rows.flatMap(([k, val]) => [el('dt', {}, k), el('dd', {}, val)]));

  $('#receiver-card').hidden = !mouse.isReceiver;
  if (mouse.isReceiver) {
    const curMode = mouse.dongleLedData?.[0];
    $('#dongle-led').replaceChildren(...DONGLE_LED_MODES.map((o) => {
      const r = el('input', { type: 'radio', name: 'dongle-led', checked: o.v === curMode });
      r.onchange = () => save(async () => { await mouse.setDongleLedMode(o.v); mouse.dongleLedData[0] = o.v; });
      return el('label', {}, r, el('span', {}, o.label, el('small', {}, o.hint)));
    }));
    renderToggles($('#receiver-card'));
  }
}

function download(filename, obj) {
  const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' })), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

function initDeviceActions() {
  $('#pair').onclick = async () => {
    const btn = $('#pair');
    btn.disabled = true;
    try {
      await mouse.pair();
      busy('PAIRING · KEEP THE MOUSE CLOSE', null);
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (await mouse.online()) {
          busy(null);
          toast('PAIRED');
          await waitOnlineAndLoad();
          return;
        }
      }
      toast('Pairing timed out. Put the mouse in pairing mode and try again.', true);
    } catch (e) {
      toast(e.message, true);
    } finally {
      busy(null);
      btn.disabled = false;
    }
  };
  $('#export').onclick = async () => {
    busy('EXPORTING', null);
    try {
      download(`rcc1-profile-${new Date().toISOString().slice(0, 10)}.json`, await mouse.exportProfile());
    } catch (e) { toast(e.message, true); } finally { busy(null); }
  };
  $('#import').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const p = JSON.parse(await f.text());
      if (!(await confirmDialog('Overwrite every setting on the mouse with this profile?'))) return;
      await mouse.importProfile(p, (x) => busy('WRITING PROFILE', x));
      renderAll();
      toast('PROFILE LOADED');
    } catch (err) { toast(err.message, true); } finally { busy(null); }
  };
  $('#reset').onclick = async () => {
    if (!(await confirmDialog('Restore factory defaults? Buttons, DPI stages and macros will be reset.'))) return;
    busy('RESETTING', null);
    try {
      await mouse.factoryReset();
      await waitOnlineAndLoad();
      toast('DEFAULTS RESTORED');
    } catch (e) { toast(e.message, true); } finally { busy(null); }
  };
}

function initTabs() {
  for (const t of $$('.tabs button')) {
    t.onclick = () => {
      for (const o of $$('.tabs button')) o.setAttribute('aria-selected', String(o === t));
      for (const p of $$('.panel')) p.hidden = p.dataset.panel !== t.dataset.tab;
      currentTab = t.dataset.tab;
      renderStage();
    };
  }
}

initLanding();
initTabs();
initDeviceActions();
if (new URLSearchParams(location.search).has('demo')) start(Mouse.demo(DEMO_FLASH));
else if (webHidSupported()) Mouse.reconnect().then((m) => m && start(m)).catch(() => {});
