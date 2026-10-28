#!/usr/bin/env python3
"""Measure the polling rate the mouse is really sending, independent of the browser.

Reads raw HID input reports from every hidraw node of the ARYE/Compx receiver (VID 3554),
waits until you start moving the mouse, then counts reports for 5 seconds.

    python3 tests/measure-polling-rate.py
"""
import glob, os, select, sys, time

RATES = {8: 125, 4: 250, 2: 500, 1: 1000, 0x10: 2000, 0x20: 4000, 0x40: 8000}

nodes = {}
vendor = []  # nodes carrying the vendor collection (usage page 0xFF02, report ID 8)
for path in sorted(glob.glob('/sys/class/hidraw/hidraw*')):
    uevent = open(f'{path}/device/uevent').read()
    if 'HID_ID=0003:00003554' in uevent.upper():
        dev = '/dev/' + os.path.basename(path)
        fd = os.open(dev, os.O_RDWR)
        nodes[fd] = dev
        desc = open(f'{path}/device/report_descriptor', 'rb').read()
        if b'\x06\x02\xff' in desc and b'\x85\x08' in desc:
            vendor.append(fd)
if not nodes:
    sys.exit('No ARYE/Compx receiver found (VID 3554).')


def configured_rate():
    """Read the polling-rate byte from mouse flash over the vendor channel (report ID 8)."""
    for fd in vendor:
        try:
            pkt = bytearray(17)
            pkt[0], pkt[1], pkt[5] = 8, 8, 1
            pkt[16] = (0x55 - sum(pkt[:16])) & 0xFF
            os.write(fd, bytes(pkt))
        except OSError:
            continue
        end = time.time() + 0.5
        while time.time() < end:
            if select.select([fd], [], [], 0.1)[0]:
                r = os.read(fd, 64)
                if r[:2] == b'\x08\x08':
                    return RATES.get(r[6])
    return None


print(f"Configured on the mouse: {configured_rate() or 'unknown'} Hz")
print(f"Watching {', '.join(nodes.values())}")
print('Move the mouse in fast circles now (waiting for movement)...', flush=True)

def is_motion(fd, r):
    # Interface 1 multiplexes several report IDs; only ID 0x0B is the mouse report there.
    return r[0] == 0x0B if fd in vendor else True

# wait for movement
while True:
    ready = select.select(list(nodes), [], [], 1)[0]
    if any(is_motion(fd, os.read(fd, 64)) for fd in ready):
        break

print('Measuring for 5 s, keep moving...', flush=True)
counts = {dev: [] for dev in nodes.values()}
start = time.perf_counter()
while time.perf_counter() - start < 5:
    for fd in select.select(list(nodes), [], [], 0.05)[0]:
        r = os.read(fd, 64)
        if is_motion(fd, r):
            counts[nodes[fd]].append(time.perf_counter())

for dev, ts in counts.items():
    if not ts:
        continue
    windows = {}
    for t in ts:
        k = int((t - start) * 10)
        windows[k] = windows.get(k, 0) + 1
    hz = sorted(v * 10 for v in windows.values() if v >= 5)
    if not hz:
        continue
    top = hz[len(hz) // 2:]
    print(f"{dev}: {len(ts)} reports · median {hz[len(hz)//2]} Hz · fastest-half avg {sum(top)//len(top)} Hz · peak {hz[-1]} Hz")
print('Slow or paused movement lowers the numbers; the peak / fastest-half values are the ones to compare.')
