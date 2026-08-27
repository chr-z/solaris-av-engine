# R4c — kit de ícones Solaris v3 (paleta accent refinada), espelhando o disco
# do SolarisLogo: círculo com gradiente linear 135° #8F6FF7 -> #F09A52.
# Substitui os PNGs antigos (laranja #f97316, paleta pré-redesign).
import math
import struct
import zlib

FROM = (143, 111, 247)  # --color-accent-from
TO = (240, 154, 82)     # --color-accent-to
BG_DARK = (11, 14, 20)  # --color-bg


def gradient_at(u):
    """u em [0,1] ao longo do eixo do gradiente."""
    return tuple(round(FROM[i] + (TO[i] - FROM[i]) * u) for i in range(3))


def _png(size, rows_raw):
    raw = b"".join(rows_raw)

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def render(size, inner=0.78):
    """Disco com gradiente 135deg sobre fundo transparente.

    inner: fração do canvas ocupada pelo diâmetro do disco.
    """
    scale = size * inner / 2.0          # raio em px
    cx = cy = size / 2.0
    inv = 1.0 / math.sqrt(2)            # direção (1,1)/|..| — CSS 135deg
    rows = []
    for y in range(size):
        row = bytearray([0])            # filtro 0
        for x in range(size):
            dx, dy = x + 0.5 - cx, y + 0.5 - cy
            d = math.sqrt(dx * dx + dy * dy)
            if d <= scale:
                u = min(max((dx + dy) * inv / (2 * scale) + 0.5, 0.0), 1.0)
                r, g, b = gradient_at(u)
                a = 255
                edge = scale - d
                if edge < 1.0:
                    a = max(0, round(255 * max(edge, 0)))
                row += bytes((r, g, b, a))
            else:
                row += bytes((0, 0, 0, 0))
        rows.append(bytes(row))
    return _png(size, rows)


def render_maskable(size):
    """Maskable: fundo escuro cheio + disco dentro da zona segura (~80%)."""
    disc_r = size * 0.40
    cx = cy = size / 2.0
    inv = 1.0 / math.sqrt(2)
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            dx, dy = x + 0.5 - cx, y + 0.5 - cy
            d = math.sqrt(dx * dx + dy * dy)
            if d > cx:
                row += bytes((0, 0, 0, 0))   # fora: transparente
                continue
            if d <= disc_r:
                u = min(max((dx + dy) * inv / (2 * disc_r) + 0.5, 0.0), 1.0)
                r, g, b = gradient_at(u)
            else:
                r, g, b = BG_DARK
            a = 255
            edge = cx - d                     # anti-alias só na borda externa
            if edge < 1.0:
                a = max(0, round(255 * max(edge, 0)))
            row += bytes((r, g, b, a))
        rows.append(bytes(row))
    return _png(size, rows)


if __name__ == "__main__":
    import os

    out_dir = os.path.join(os.path.dirname(__file__), "..", "public", "icons")
    os.makedirs(out_dir, exist_ok=True)
    for name, data in [
        ("icon-16.png", render(16)),
        ("icon-32.png", render(32)),
        ("icon-192.png", render(192)),
        ("icon-512.png", render(512)),
        ("icon-maskable-512.png", render_maskable(512)),
    ]:
        path = os.path.join(out_dir, name)
        with open(path, "wb") as f:
            f.write(data)
        print(name, len(data), "bytes")
