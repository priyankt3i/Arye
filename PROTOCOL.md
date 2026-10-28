# ARYE Configurator — HID protocol notes

Recovered from `ARYE.Configurator_v1.0.1.3_MP_setup.exe` (Inno Setup 6.1) — `HIDUsb.dll`,
`ARYE Configurator.exe` + its shipped `ARYE.pdb` — and confirmed read-only against a live
"Compx ARYE 8K Receiver" on 2026-10-26.

Legend: **[verified]** = observed on hardware · **[static]** = read from disassembly/PDB · **[inferred]** = educated guess, test before relying on it.

## Device

| | |
|---|---|
| VID | `0x3554` (Compx) |
| PID wired | `0xF516` |
| PID 8K wireless receiver | `0xF517` [verified] |
| Interface | `MI_01`, top-level collection #5 |
| Collection usage | usage page `0xFF02`, usage `0x02` [verified from report descriptor] |
| Report | ID `0x08`, 16-byte Input + 16-byte Output [verified] |

WebHID filter: `{ vendorId: 0x3554, usagePage: 0xFF02, usage: 0x02 }`. Vendor pages are not on the WebHID blocklist.

Other vendor collections on the same interface (not needed for config): `0xFF05`/ID `0x10`, `0xFF03`/ID `0x02`,
`0xFF04`/ID `0x06` (feature, 7 B), `0xFF06`/ID `0x09` (48 B in/out).

## Packet format [static + verified]

17 bytes including report ID (WebHID: `sendReport(0x08, <16 bytes>)`, read `inputreport` with `reportId === 8`).

```
[0] 0x08        report id
[1] cmd
[2] 0x00        (status in replies)
[3] addr hi
[4] addr lo
[5] len         (<= 10; DLL ORs 0x80 when an internal flag is set [static, meaning unknown])
[6..15] data    (10 bytes)
[16] checksum = (0x55 - sum(bytes[0..15])) & 0xFF
```

Replies use the same layout and echo `cmd`. The DLL sends one command at a time, waits ≥ 8 ms
between sends, times out after 1 s (5 s for `0x09`), retries up to 5×.

## Commands [static: names from DLL exports]

| cmd | function | notes |
|---|---|---|
| 0x01 | ReadEncryption / SetKeyboardMode | |
| 0x02 | SetPCDriverStatus | |
| 0x03 | ReadOnLine | reply `01 01 ae 7c 86 …` [verified] |
| 0x04 | ReadBatteryLevel | reply data[0] = `0x4b` (75 %?) [verified raw, inferred meaning] |
| 0x05 | EnterDonglePair (CID/MID) | |
| 0x06 | ReadDonglePairStatus | |
| **0x07** | **Write flash** `addr,len,data` | used by ProtocolDataUpdate to save settings |
| **0x08** | **Read flash** `addr,len` | [verified] |
| 0x09 | SetClearSetting (factory reset) | |
| 0x0A | device → host event/status report | unsolicited |
| 0x0B | SetVidPid | ⚠ do not expose |
| 0x0C | SetDeviceDescriptorString | ⚠ do not expose |
| 0x0D | EnterUsbUpdateMode (firmware) | ⚠ do not expose |
| 0x0E | ReadConfig (current profile) | [verified] |
| 0x0F | SetCurrentConfig | |
| 0x11 | EnterMTKMode | ⚠ |
| 0x12 | ReadVersion | reply `02 19` → 2.19, matches bundled `Mouse-3554-F516-105-02-2.19.bin` [verified] |
| 0x14/0x15 | Set/Get 4K-dongle RGB | |
| 0x16/0x17 | Set/Get LongRangeMode | |
| 0x18/0x19 | Set/Get dongle RGB bar mode | |
| 0x1A | SetDongleIDToMouse | |
| 0x1F/0x20 | Set/Get mouse serial number | |
| 0xB3 | GetSlaveVersion | |
| 0xF0/0xF1 | Write/Read CID-MID | ⚠ |

## Flash map [static: offsets from `ProtocolDataParser`, names from PDB `FlashDataMap`; values verified]

Every value is followed by a check byte `0x55 - sum(value bytes)`; the parser falls back to a default when it doesn't match.

| addr | size | field | live value |
|---|---|---|---|
| 0x00 | 1+1 | reportRate | `0x10` = 2000 Hz |
| 0x02 | 1+1 | maxDPI (number of active DPI slots) | 4 |
| 0x04 | 1+1 | currentDPI (index, must be < maxDPI) | 1 |
| 0x06 | 1+1 | xSpindown | 0 |
| 0x08 | 1+1 | ySpindown | 0 |
| 0x0A | 1+1 | silenceHeight (LOD) | 1 |
| 0x0C + 4·i (i<8) | 3+1 | DPI slot: xDPI, yDPI, DPIex (see encoding below) | `07 07 00`, `0f 0f 00`, `1f 1f 00`, `3f 3f 00` |
| 0x2C + 4·i (i<8) | 3+1 | DPI colour R,G,B | ff0000, 0000ff, ffff00, 00ff00 |
| 0x4C / 0x4E / 0x50 / 0x52 | 1+1 each | DPI LED mode / brightness / breathSpeed / enable | 2 / 0x80 / 3 / 0 |
| 0x60 + 4·i (i<16) | 3+1 | button map: type, param1, param2 | `01 01`, `01 02`, `01 04`, `01 08`, `01 10` (mouse buttons L/R/M/back/fwd) |
| 0xA0 | 6+1 | LED bar: mode, R, G, B, speed, brightness | `01 ff 00 ff 07 09` |
| 0xA7 | 1+1 | LED bar enable | 0 |
| 0xA9 | 1+1 | keyDebounceTime | 4 |
| 0xAB | 1+1 | motionSyncEnable | 1 |
| 0xAD | 1+1 | allLedOffTime | 6 |
| 0xAF | 1+1 | linearCorrectionEnable | 0 |
| 0xB1 | 1+1 | rippleControlEnable | 0 |
| 0xB3 | 1+1 | moveOffLedEnable | 0 |
| 0xB5 | 1+1 | sensorCustomSleepTimeEnable | 0 |
| 0xB7 | 1+1 | sensorSleepTime | 6 |
| 0xB9 | 1+1 | sensorPowerSavingModeEnable | 1 |
| 0xBD / 0xBF / 0xC1 | 1+1 each | sensorAngleTune / enableSensorAngleTune / enableWheelToChangeDPI | |
| 0xC3, 0xC8, 0xCD, 0xD2 | 4+1 each | sensitivity ±X, ±Y (float) | |
| 0x100 + 0x20·i (i<16) | 32 | per-button shortcut key (`ShortCutKey`: count + `MacroContext[]`) | |
| 0x300 + 0x180·i (i<16) | 384 | macro (`MacroKey`: nameLength, name[30], count, `MacroContext[]`) | |

### Writes [static + verified on hardware]

`ProtocolDataUpdate` diffs the new `FlashDataMap` against its cached copy and, for each changed field, sends
cmd `0x07` with `addr`, `len` and the raw flash bytes (value + check byte). Verified on 2026-10-26 by writing
debounce 4 → 5 at `0xA9`, reading it back, and restoring 4. The `len | 0x80` flag is only set by
`UsbServer_KeyboardStart`; mouse sessions use plain lengths.

### Field encodings [static, from the app's `FunctionSet::*` setters and UI handlers]

| field | encoding |
|---|---|
| reportRate | `0x08`=125, `0x04`=250, `0x02`=500, `0x01`=1000, `0x10`=2000, `0x20`=4000, `0x40`=8000 Hz (`Sensor::SlotUpDataReportRate`) |
| DPI slot | PAW3950 path of `Sensor::WriteDPI`: ≤ 26000 → `code = dpi/50 − 1`; > 26000 → `code = dpi/100 − 1` and `DPIex |= 0x11`. `x = y = code & 0xFF`; `hi = code >> 8` goes to `DPIex` bits 2–3 and 6–7 (`((hi<<4)|hi)<<2`) |
| LOD (0x0A) | UI buttons MM0/MM1/MM2 write 3/1/2 (labels LOW/MID/HIGH are inferred) |
| DPI effect | mode 0 → `enable(0x52)=0`; otherwise `mode(0x4C)=1 steady / 2 breathing`, `enable=1`. **Ignored by RCC-1 fw 2.19** (tested by eye 2026-10-26): the LED only flashes the new stage colour on a DPI change |
| DPI LED brightness | slider 1–10 → 16, 30, 60, 90, 128, 150, 180, 210, 230, 255 |
| DPI LED speed | 1–5 |
| angleSnap | 0xAF (`linearCorrectionEnable`) via `SetAngleSnapping` |
| Boost mode (20000 fps) | 0xB5 (`sensorCustomSleepTimeEnable`) via `Macro::on_MotionSync_N_toggled → SetSensorSleepSwitch` |
| Auto sleep | 0xB7, units of 10 s: 1, 3, 6, 30, 60, 180 = 10 s, 30 s, 1 min, 5 min, 10 min, 30 min |
| Angle tune | `SetAngle(v)`: 0xBD = v (signed byte, −33…+33), 0xBF = 1 |
| Debounce | 0xA9, milliseconds |

### Button functions (`KeyFunMap` = type, p1, p2)

| type | meaning | params |
|---|---|---|
| 0x00 | disabled | |
| 0x01 | mouse button | p1 = 1 L, 2 R, 4 M, 8 back, 0x10 forward |
| 0x02 | DPI | p1 = 1 loop, 2 up, 3 down |
| 0x05 | shortcut (key combo or multimedia) | events in the button's 32-byte shortcut record |
| 0x06 | macro | p1 = macro slot (app writes the record to slot = button index), p2 = repeat: N times, `0xFE` until released, `0xFF` until any key pressed |
| 0x07 | polling-rate cycle | |
| 0x09 | profile switch | |
| 0x0A | DPI lock | p1 = DPI code (`dpi/50 − 1`); app menu offers 500–6000 |

Stock slots 6–10 also contain `08 04 00` and `04 0A 03`. No handler in this app version writes types 3, 4 or 8, so the web tool doesn't offer them.

### Shortcut and macro records [static: `0x180009e30`, `0x18000a010` in HIDUsb.dll]

Event byte 0 = state | type. State is `0x80` press, `0x40` release. Type is `0` modifier (bitmask: Ctrl 1, Shift 2, Alt 4, Win 8, right-hand ×16),
`1` keyboard (HID usage), `2` consumer (16-bit usage, little-endian in v0/v1), `4` mouse button (bitmask as above).

- **Shortcut (32 B):** `count (2..6)`, `count × [state|type, v0, v1]`, then `check(bytes[0 .. 3·count])`.
  Multimedia = press + release of one consumer usage. Mute is `02 82 E2 00 42 E2 00 …`, which matches the official app byte for byte.
- **Macro (384 B):** `nameLen (1..30)`, `name[30]`, `count (2..70)` at 0x1F, `count × [state|type, v0, v1, delayHi, delayLo]` from 0x20
  (delay = ms after the event, big-endian), then `check(bytes[0x1F .. 0x20+5·count))`.

Consumer usages used by the app: Play/Pause CD, Next B5, Prev B6, Stop B7, Mute E2, Vol+ E9, Vol− EA, Media 183, Mail 18A,
Calc 192, My Computer 194, Search 221, Home 223, Refresh 227, Stop 226, Favorites 22A.

### Receiver commands [static + verified reads]

- `0x15` get / `0x14` set receiver LED: 10 data bytes, byte 0 = mode (1 connection & rate, 2 battery, 3 low-battery warning; labels inferred). Write back the bytes you read with byte 0 changed.
- `0x17` get / `0x16` set long-distance mode: `len 1`, data[0] = 0/1.
- `0x05` pair: `len 2`, data `00 00 <CID=105>` (same bytes as `UsbServer_EnterDonglePairOnlyCid`). `0x06` reads pairing status.
- `0x09` factory reset; the DLL waits up to 5 s for the reply.
- `0x04` battery reply: data[0] = percent (0x4B = 75), data[2..3] = millivolts big-endian (0x0FAD = 4013 mV); data[1] is assumed to be the charging flag.
- `0xB3` returns receiver firmware (`02 20` → v2.20).

## Still unknown

- The exact LOD distances behind values 3/1/2, and whether the receiver LED mode labels are in the right order.
- How profiles (`0x0E`/`0x0F`) select a flash bank. The app's profile combobox doesn't call them, so the web tool only exposes the profile-switch button function.
- Sensor mode (0xB9, `SetSensorMode`): nothing in this app version calls the setter, so it's not exposed.
