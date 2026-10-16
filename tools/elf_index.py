import json
from collections import defaultdict
from elftools.elf.elffile import ELFFile
from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from capstone.x86_const import X86_OP_IMM, X86_OP_MEM
P = r"C:\Users\faust\Desktop\cosas IA\vascolet4.activity\bin\vascolet4"
f = open(P, "rb"); e = ELFFile(f); img = open(P, "rb").read()
text = e.get_section_by_name(".text")
code = img[text.header.sh_offset:text.header.sh_offset + text.header.sh_size]
base = text.header.sh_addr
lo = min(s.header.sh_addr for s in e.iter_sections() if s.header.sh_addr)
hi = max(s.header.sh_addr + s.header.sh_size for s in e.iter_sections() if s.header.sh_addr)
md = Cs(CS_ARCH_X86, CS_MODE_32); md.detail = True; md.skipdata = True
idx = defaultdict(list); n = 0
for ins in md.disasm(bytes(code), base):
    if ins.id == 0: continue
    n += 1
    try: ops = ins.operands
    except Exception: continue
    for op in ops:
        if op.type == X86_OP_IMM:
            v = op.value.imm & 0xFFFFFFFF
            if lo <= v < hi: idx[v].append(ins.address)
        elif op.type == X86_OP_MEM and op.value.mem.base != 0:
            d = op.value.mem.disp & 0xFFFFFFFF
            if lo <= d < hi: idx[d].append(ins.address)
print("instrs:", n, "addrs:", len(idx))
json.dump({str(k): v for k, v in idx.items()}, open(r"C:\Users\faust\Desktop\cosas IA\vascolet-js\tools\elf_imm.json", "w"))
print("OK")
