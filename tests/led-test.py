#!/usr/bin/env python3
"""Interactive DPI-indicator LED test. Writes one LED setting at a time, you watch the mouse and
press Enter, then every touched byte is restored.

    python3 tests/led-test.py
"""
import glob, os, select, sys, time

dev = None
for path in sorted(glob.glob('/sys/class/hidraw/hidraw*')):
    desc = open(f'{path}/device/report_descriptor', 'rb').read()
    if 'HID_ID=0003:00003554' in open(f'{path}/device/uevent').read().upper() and b'\x06\x02\xff' in desc and b'\x85\x08' in desc:
        dev = '/dev/' + os.path.basename(path)
if not dev:
    sys.exit('Receiver not found')
fd = os.open(dev, os.O_RDWR)


def xfer(cmd, addr=0, data=b'', ln=None):
    while select.select([fd], [], [], 0)[0]:
        os.read(fd, 64)
    b = bytearray(17)
    b[0], b[1], b[3], b[4] = 8, cmd, addr >> 8, addr & 255
    b[5] = len(data) if ln is None else ln
    b[6:6 + len(data)] = data
    b[16] = (0x55 - sum(b[:16])) & 255
    os.write(fd, bytes(b))
    end = time.time() + 1
    while time.time() < end:
        if select.select([fd], [], [], 0.2)[0]:
            r = os.read(fd, 64)
            if r[0] == 8 and r[1] == cmd:
                return r
    raise SystemExit(f'no reply to 0x{cmd:02x}')


def read(addr, n):
    return bytes(xfer(8, addr, ln=n)[6:6 + n])


def put(addr, v):
    xfer(7, addr, bytes([v, (0x55 - v) & 255]))
    time.sleep(0.02)


MODE, BRIGHT, SPEED, ENABLE, OFFTIME, MOVEOFF = 0x4C, 0x4E, 0x50, 0x52, 0xAD, 0xB3
orig = {a: read(a, 2) for a in (MODE, BRIGHT, SPEED, ENABLE, OFFTIME, MOVEOFF)}
active_color = read(0x2C + 4 * read(0x04, 1)[0], 3)
print(f'Device {dev}. Saved originals: ' + ', '.join(f'0x{a:02X}={v[0]}' for a, v in orig.items()))
print(f'Active DPI stage colour is #{active_color.hex()}.  Watch the light on the mouse for each step.\n')

steps = [
    ('LED OFF (enable=0)', [(ENABLE, 0)]),
    ('STEADY, brightness 255 (max)', [(MODE, 1), (BRIGHT, 255), (ENABLE, 1)]),
    ('STEADY, brightness 16 (min)', [(MODE, 1), (BRIGHT, 16), (ENABLE, 1)]),
    ('BREATHING, speed 1, brightness 255', [(MODE, 2), (SPEED, 1), (BRIGHT, 255), (ENABLE, 1)]),
    ('BREATHING, speed 5, brightness 255', [(MODE, 2), (SPEED, 5), (BRIGHT, 255), (ENABLE, 1)]),
]
answers = []
try:
    for name, writes in steps:
        for a, v in writes:
            put(a, v)
        ans = input(f'>> {name}\n   What does the light do? (type a few words, Enter): ').strip()
        answers.append((name, ans))
    print('\nNow press the DPI button once on the mouse while it is set to STEADY 255.')
    for a, v in [(MODE, 1), (BRIGHT, 255), (ENABLE, 1)]:
        put(a, v)
    answers.append(('DPI button press at STEADY 255', input('   What happened? ').strip()))
finally:
    for a, v in orig.items():
        xfer(7, a, v)
        time.sleep(0.02)
    ok = all(read(a, 2) == v for a, v in orig.items())
    print('\nRestored original LED settings:', 'OK' if ok else 'MISMATCH')
    print('\n--- copy this back ---')
    for n, a in answers:
        print(f'{n}: {a}')
