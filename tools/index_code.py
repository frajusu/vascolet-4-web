"""Indice unico: imm/mem-disp -> instrucciones que lo usan. Se guarda en JSON."""
import pefile, json
from collections import defaultdict
from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from capstone.x86_const import X86_OP_IMM, X86_OP_MEM

EXE = r"C:\Users\faust\Desktop\cosas IA\Vascolet\vascolet4.exe"
pe = pefile.PE(EXE)
BASE = pe.OPTIONAL_HEADER.ImageBase
img = open(EXE, "rb").read()
text = next(s for s in pe.sections if s.Name.decode().strip("\x00") == ".text")
code = img[text.PointerToRawData:text.PointerToRawData + text.SizeOfRawData]
base_va = BASE + text.VirtualAddress
md = Cs(CS_ARCH_X86, CS_MODE_32)
md.detail = True
md.skipdata = True
idx = defaultdict(list)
n = 0
for ins in md.disasm(code, base_va):
    if ins.id == 0:
        continue
    n += 1
    try:
        ops = ins.operands
    except Exception:
        continue
    for op in ops:
        if op.type == X86_OP_IMM:
            v = op.value.imm & 0xFFFFFFFF
            if BASE <= v < BASE + 0x600000:
                idx[v].append(ins.address)
        elif op.type == X86_OP_MEM:
            d = op.value.mem.disp & 0xFFFFFFFF
            if BASE <= d < BASE + 0x600000 and op.value.mem.base != 0:
                idx[d].append(ins.address)
print("instrs:", n, "imms:", len(idx))
json.dump({str(k): v for k, v in idx.items()}, open(r"C:\Users\faust\Desktop\cosas IA\vascolet-js\tools\imm_index.json", "w"))
print("OK imm_index.json")
