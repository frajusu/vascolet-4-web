"""RE quirurgica de vascolet4.exe: RTTI MSVC -> vtables -> metodos.
No ejecuta nada pesado: solo lee el binario con pefile."""
import pefile, struct, sys

EXE = r"C:\Users\faust\Desktop\cosas IA\Vascolet\vascolet4.exe"
pe = pefile.PE(EXE)
BASE = pe.OPTIONAL_HEADER.ImageBase
print(f"ImageBase=0x{BASE:X} sections=" + ",".join(f"{s.Name.decode().strip(chr(0))}:{s.SizeOfRawData//1024}k" for s in pe.sections))

img = open(EXE, "rb").read()

def rva_to_off(rva):
    for s in pe.sections:
        va, vsz, raw, rsz = s.VirtualAddress, s.Misc_VirtualSize, s.PointerToRawData, s.SizeOfRawData
        if va <= rva < va + max(vsz, rsz):
            return raw + (rva - va)
    return None

def read_u32(off):
    return struct.unpack_from("<I", img, off)[0]

# 1. TypeDescriptors: ".?AV....@@"
import re
names = {}
for m in re.finditer(rb"\.\?AV[ -~]{1,120}?@@", img):
    s = m.group(0)
    try:
        name = s.decode()
    except Exception:
        continue
    # TypeDescriptor = vtableptr(4) + spare(4) + name; name offset = td+8
    td_off = m.start() - 8
    if td_off < 0:
        continue
    # el primer dword debe apuntar a type_info vtable (dentro de imagen)
    v = read_u32(td_off)
    if not (BASE <= v < BASE + len(img)):
        continue
    names[name] = td_off

print(f"TypeDescriptors hallados: {len(names)}")
wanted = [n for n in names if any(k in n for k in ("CharacterPhysicsEntity", "GameTileMap", "SamplePhysicsEntity", "PlatformPhysicsEntity", "GameSubject", "CharacterFactory", "GameScripts", "GameTile", "AnimLibrary", "SpriteAnim", "AnimationPlayer", "VirtualController", "CutScene"))]
print(f"clases de interes: {len(wanted)}")

# 2. Para cada TD, buscar COLs (dwords que apuntan al TD) y luego vtables (dwords que apuntan al COL)
# Index de dwords que son VAs validas: construimos set de offsets por valor
from collections import defaultdict
refs = defaultdict(list)
# escanear .rdata y .text como dwords
for s in pe.sections:
    nm = s.Name.decode().strip(chr(0))
    if nm not in (".rdata", ".text", ".data"):
        continue
    raw, rsz = s.PointerToRawData, s.SizeOfRawData
    for off in range(raw, raw + rsz - 4, 4):
        v = read_u32(off)
        rva = v - BASE
        if 0 <= rva < len(img):
            refs[v].append(off)

def va(off):
    # offset en archivo -> VA (aprox via secciones)
    for s in pe.sections:
        if s.PointerToRawData <= off < s.PointerToRawData + s.SizeOfRawData:
            return BASE + s.VirtualAddress + (off - s.PointerToRawData)
    return None

out = []
for name in sorted(wanted):
    td_off = names[name]
    td_va = va(td_off)
    # COLs: lugares que apuntan a td_va
    cols = refs.get(td_va, [])
    vtinfo = []
    for coff in cols:
        cva = va(coff)
        # vtable: lugares que apuntan a cva (vtable[-1] == COL)
        for voff in refs.get(cva, []):
            # contar entries de vtable (dwords que son code pointers en .text)
            n = 0
            oo = voff + 4
            while True:
                if oo + 4 > len(img):
                    break
                e = read_u32(oo)
                er = e - BASE
                ro = rva_to_off(er) if 0 <= er < len(img) else None
                in_text = False
                if ro is not None:
                    for s in pe.sections:
                        if s.Name.decode().strip(chr(0)) == ".text" and s.PointerToRawData <= ro < s.PointerToRawData + s.SizeOfRawData:
                            in_text = True
                if not in_text:
                    break
                n += 1
                oo += 4
                if n > 400:
                    break
            vtinfo.append((hex(va(voff)), n))
    vtinfo = [(a, n) for (a, n) in vtinfo if n >= 3]
    out.append((name, hex(td_va) if td_va else "?", len(cols), vtinfo[:6]))

for name, td, ncol, vts in out:
    print(f"{name}\n   TD={td} COLs={ncol} vtables={vts}")
