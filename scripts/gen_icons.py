import struct, zlib, math

def png_chunk(typ, data):
    c = typ + data
    return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

def circle_icon(size, scale=1.0):
    cx = cy = (size - 1) / 2
    r = (size * 0.5 - max(1, size // 32)) * scale
    inner = (255, 251, 235)
    mid = (251, 191, 36)   # #FBBF24
    outer = (249, 115, 22) # #F97316
    rows = []
    for y in range(size):
        row = bytearray([0])  # filter type 0
        for x in range(size):
            d = math.hypot(x - cx, y - cy) / r if r > 0 else 2
            if d > 1.0:
                row += bytes((0, 0, 0, 0))
                continue
            t = min(1.0, d)
            if t < 0.35:
                k = t / 0.35
                col = tuple(round(inner[i] + (mid[i] - inner[i]) * k) for i in range(3))
            else:
                k = (t - 0.35) / 0.65
                col = tuple(round(mid[i] + (outer[i] - mid[i]) * k) for i in range(3))
            row += bytes((col[0], col[1], col[2], 255))
        rows.append(bytes(row))
    raw = b''.join(rows)
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n' + png_chunk(b'IHDR', ihdr)
            + png_chunk(b'IDAT', zlib.compress(raw, 9)) + png_chunk(b'IEND', b''))

for s in (192, 512):
    with open(f'public/icons/icon-{s}.png', 'wb') as f:
        f.write(circle_icon(s))
    print(f'icon-{s}.png written')

# Maskable variant: safe-zone padding so Android can crop to any mask shape.
with open('public/icons/icon-maskable-512.png', 'wb') as f:
    f.write(circle_icon(512, scale=0.72))
print('icon-maskable-512.png written')
