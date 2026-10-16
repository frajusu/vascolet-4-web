"""Volcado de constantes flotantes de .rdata: candidatas a fisica (gravedad, velocidades)."""
import pefile, struct
EXE = r"C:\Users\faust\Desktop\cosas IA\Vascolet\vascolet4.exe"
pe = pefile.PE(EXE)
BASE = pe.OPTIONAL_HEADER.ImageBase
img = open(EXE, "rb").read()
rd = next(s for s in pe.sections if s.Name.decode().strip("\x00") == ".rdata")
raw, rsz, rva = rd.PointerToRawData, rd.SizeOfRawData, rd.VirtualAddress
seen = {}
for off in range(raw, raw + rsz - 4):
    u = struct.unpack_from("<I", img, off)[0]
    f = struct.unpack_from("<f", img, off)[0]
    va = BASE + rva + (off - raw)
    # f32 plausibles de juego (no denormales, no enormes)
    if 0.05 <= abs(f) <= 3000 and f == f and (u & 0x7F800000) not in (0, 0x7F800000):
        # evitar ruido: quedarnos con valores "redondos" o repetidos sera post-proceso
        seen.setdefault(round(f, 4), []).append(va)
print(f"distintos f32 plausibles: {len(seen)}")
cands = sorted(seen.items(), key=lambda kv: (-len(kv[1]), kv[0]))
for val, vas in cands[:80]:
    print(f"{val:12} x{len(vas):3}  ej {hex(vas[0])}")
