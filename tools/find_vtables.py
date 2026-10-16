"""Desensambla .text con capstone y caza instalaciones de vtable (mov [reg], imm)."""
import pefile, struct
from collections import defaultdict
from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from capstone.x86_const import X86_OP_IMM

EXE = r"C:\Users\faust\Desktop\cosas IA\Vascolet\vascolet4.exe"
pe = pefile.PE(EXE)
BASE = pe.OPTIONAL_HEADER.ImageBase
img = open(EXE, "rb").read()

text = next(s for s in pe.sections if s.Name.decode().strip("\x00") == ".text")
code = img[text.PointerToRawData:text.PointerToRawData + text.SizeOfRawData]
base_va = BASE + text.VirtualAddress
print(f".text {len(code)//1024}k @ {hex(base_va)}")

md = Cs(CS_ARCH_X86, CS_MODE_32)
md.detail = True
md.skipdata = True
imm_to_rvas = defaultdict(set)  # imm -> set(code_rva que lo referencia)
n = 0
for ins in md.disasm(code, base_va):
    n += 1
    if ins.id == 0:
        continue
    try:
        ops = ins.operands
    except Exception:
        continue
    for op in ops:
        vals = []
        if op.type == X86_OP_IMM:  # inmediato
            vals.append(op.value.imm & 0xFFFFFFFF)
        elif op.type == 3:  # MEM: desplazamiento (lea/mov [reg+disp])
            d = op.value.mem.disp & 0xFFFFFFFF
            if d != 0:
                vals.append(d)
        for v in vals:
            if BASE + 0x200000 <= v < BASE + 0x400000:  # rango .rdata/.data aprox
                imm_to_rvas[v].add(ins.address)
print(f"instrs: {n}, immediatos a datos: {len(imm_to_rvas)}")

def sec_of_va(va):
    rva = va - BASE
    for s in pe.sections:
        if s.VirtualAddress <= rva < s.VirtualAddress + s.Misc_VirtualSize:
            return s.Name.decode().strip("\x00")
    return "?"

def va2off(va):
    rva = va - BASE
    for s in pe.sections:
        if s.VirtualAddress <= rva < s.VirtualAddress + max(s.Misc_VirtualSize, s.SizeOfRawData):
            return s.PointerToRawData + (rva - s.VirtualAddress)
    return None

# vtables: imm en .rdata/.data cuyos siguientes dwords son code pointers
vtables = {}
for v, uses in imm_to_rvas.items():
    if sec_of_va(v) not in (".rdata", ".data"):
        continue
    off = va2off(v)
    if off is None:
        continue
    m = 0
    while True:
        e = struct.unpack_from("<I", img, off + 4 + m * 4)[0] if off + 4 + m * 4 + 4 <= len(img) else 0
        if sec_of_va(e) != ".text":
            break
        m += 1
        if m > 500:
            break
    if m >= 3:
        vtables[v] = (m, len(uses), sorted(uses)[:3])

print(f"vtables candidatas: {len(vtables)}")

# nombrar via COL->TD (vtable[-1])
def read_u32_va(va):
    off = va2off(va)
    return struct.unpack_from("<I", img, off)[0] if off is not None else 0

import re
name_at = {}
for m in re.finditer(rb"\.\?AV[ -~]{1,120}?@@", img):
    name_at[m.start()] = m.group(0).decode()

named = 0
by_class = defaultdict(list)
for v, (mcount, nuses, uses) in vtables.items():
    col = read_u32_va(v - 4)
    if sec_of_va(col) not in (".rdata", ".data"):
        continue
    # COL: [sig, off, cd, pTD, pHier]
    ptd = read_u32_va(col + 12)
    ptd_off = va2off(ptd)
    if ptd_off is None:
        continue
    nm = name_at.get(ptd_off + 8)
    if nm:
        named += 1
        by_class[nm].append((hex(v), mcount))

print(f"vtables nombradas: {named} en {len(by_class)} clases")
interesting = [c for c in by_class if any(k in c for k in ("CharacterPhysicsEntity", "GameTileMap", "SamplePhysicsEntity", "PlatformPhysicsEntity", "GameSubject", "CharacterFactory", "GameScripts", "GameTile@", "AnimLibrary", "SpriteAnim", "AnimationPlayer", "VirtualController", "CutScene", "GameTileMap"))]
for c in sorted(by_class):
    mark = "  <== INTERES" if c in interesting else ""
    print(f"{c}: {by_class[c]}{mark}")

# guardar mapa completo para uso posterior
import json
json.dump({c: v for c, v in by_class.items()}, open(r"C:\Users\faust\Desktop\cosas IA\vascolet-js\tools\vtables.json", "w"), indent=0)
print("OK vtables.json")
