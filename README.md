# RCC-1 Web Configurator

Unofficial browser configurator for Compx-based ARYE mice (USB VID `3554`, wired PID `F516`, 8K receiver PID `F517`).
It replaces the Windows-only *ARYE Configurator v1.0.1.3* and works on Linux, macOS, Windows and ChromeOS through WebHID.
Nothing is installed: it is three static files plus a few ES modules.

## Run it

WebHID needs a Chromium-based browser (Chrome, Edge, Opera, Vivaldi, Brave) and a secure origin (`https://` or `localhost`).

```bash
cd /path/to/Arye
python3 -m http.server 8765 --bind 127.0.0.1
# open http://localhost:8765
```

Add `?demo` to the URL to explore the UI offline. Demo mode replays a flash dump taken from a real receiver.

Any static HTTPS host works for sharing it, e.g. GitHub Pages, Vercel or Netlify. No server code is involved.

### Linux permissions

Browsers open the device through `/dev/hidraw*`, which is root-only by default:

```bash
sudo cp 99-arye-hid.rules /etc/udev/rules.d/
sudo udevadm control --reload && sudo udevadm trigger
```

Then unplug and replug the receiver.

## Features

| Area | What you can change |
|---|---|
| Main | 1–8 DPI stages (50–32000), stage colours, active stage, polling rate 125 Hz–8 kHz, DPI indicator (off/steady/breathing, brightness, speed) |
| Buttons | 6 buttons: mouse clicks, DPI loop/+/−, DPI lock, key combinations (up to 3 keys), 18 multimedia keys, macros, polling-rate cycle, profile switch, disable |
| Macros | Record keyboard and mouse input with real or fixed delays, edit delays, up to 70 events, repeat N times / until released / until any key, local library, import/export |
| Performance | Lift-off distance, Motion Sync, Angle Snapping, Ripple Control |
| Advanced | Boost mode (20000 fps), sensor angle calibration (±33°), auto-sleep time, debounce |
| Device | Firmware versions, battery and cell voltage, receiver LED mode, long-distance mode, pairing, profile export/import, factory reset |

Firmware updates are deliberately not implemented.

## Layout

```
index.html        page shell
styles.css        design tokens + layout (Space Mono, ink/mist palette)
js/protocol.js    flash map, packet checksum, DPI/key/macro codecs
js/device.js      WebHID transport, command queue, read/write helpers, demo transport
js/app.js         UI
js/demo-flash.js  real flash dump used by ?demo
PROTOCOL.md       reverse-engineered protocol reference
```

## License

The code and documentation are released under the [MIT License](LICENSE), © 2026 kumar priyank.

The RCC-1 product renders in `assets/` are © ARYE Equipment Ltd and are **not** MIT-licensed; see [assets/ATTRIBUTION.md](assets/ATTRIBUTION.md).
Get ARYE's permission, or swap in your own images, before publishing this project.
"ARYE" and "RCC-1" are names used by ARYE Equipment Ltd. This is an unofficial community tool that ARYE has not endorsed.
