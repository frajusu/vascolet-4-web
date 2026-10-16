"""Dado un string del binario, lista el codigo que lo referencia y desensambla alrededor."""
import pefile, struct, sys
from collections import defaultdict
from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from capstone.x86_const import X86_OP_IMM

EXE = r"C:\Users\faust\Desktop\cosas IA\Vascolet\vascolet4.exe"
pe = pefile.PE(EXE)
BASE = pe.OPTIONAL_HEADER.ImageBase
img = open(EXE, "rb").read()

def va2off(va):
    rva = va - BASE
    for s in pe.sections:
        if s.VirtualAddress <= rva < s.VirtualAddress + max(s.Misc_VirtualSize, s.SizeOfRawData):
            return s.PointerToRawData + (rva - s.VirtualAddress)
    return None

def sec_of_va(va):
    rva = va - BASE
    for s in pe.sections:
        if s.VirtualAddress <= rva < s.VirtualAddress + s.Misc_VirtualSize:
            return s.Name.decode().strip("\x00")
    return "?"

text = next(s for s in pe.sections if s.Name.decode().strip("\x00") == ".text")
code = img[text.PointerToRawData:text.PointerToRawData + text.SizeOfRawData]
base_va = BASE + text.VirtualAddress

print("indexando .text...", flush=True)
md = Cs(CS_ARCH_X86, CS_MODE_32)
md.detail = True
md.skipdata = True
imm_to_rvas = defaultdict(list)
for ins in md.disasm(code, base_va):
    if ins.id == 0:
        continue
    try:
        ops = ins.operands
    except Exception:
        continue
    for op in ops:
        if op.type == X86_OP_IMM:
            v = op.value.imm & 0xFFFFFFFF
            if BASE <= v < BASE + 0x600000:
                imm_to_rvas[v].append(ins.address)
print("listo.", flush=True)

for needle in sys.argv[1:]:
    for nb, tag in ((needle.encode(), "narrow"), (needle.encode("utf-16-le"), "wide")):
        off = img.find(nb)
        if off < 0:
            continue
    # off->VA
    va = None
    for s in pe.sections:
        if s.PointerToRawData <= off < s.PointerToRawData + s.SizeOfRawData:
            va = BASE + s.VirtualAddress + (off - s.PointerToRawData)
    print(f"=== '{needle}'[{tag}] @ {hex(va)} refs={len(imm_to_rvas.get(va, []))}")
    for rva in imm_to_rvas.get(va, [])[:6]:
        print(f"--- ref desde {hex(rva)}")
        # desensamblar ventana [rva-160, rva+160]
        roff = va2off(rva)
        start = max(text.PointerToRawData, roff - 160)
        chunk = img[start:roff + 200]
        md2 = Cs(CS_ARCH_X86, CS_MODE_32)
        md2.skipdata = True
        cur = BASE + text.VirtualAddress + (start - text.PointerToRawData)
        for ins in md2.disasm(chunk, cur):
            mark = ">>>" if ins.address == rva else "   "
            print(f"{mark} {ins.address:#x}  {ins.mnemonic:8} {ins.op_str}")
            if cur > rva + 120:
                break
