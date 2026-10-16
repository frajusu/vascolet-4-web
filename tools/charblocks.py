import struct
from elftools.elf.elffile import ELFFile
from capstone import Cs, CS_ARCH_X86, CS_MODE_32
P = r"C:\Users\faust\Desktop\cosas IA\vascolet4.activity\bin\vascolet4"
f = open(P, "rb"); e = ELFFile(f); img = open(P, "rb").read()
text = e.get_section_by_name(".text"); ro = e.get_section_by_name(".rodata")
taddr, toff = text.header.sh_addr, text.header.sh_offset
raddr, roff, rsz = ro.header.sh_addr, ro.header.sh_offset, ro.header.sh_size

def in_ro(va): return raddr <= va < raddr + rsz
def rd_wide(va, n=40):
    if not in_ro(va): return None
    try:
        s = img[roff+(va-raddr):roff+(va-raddr)+n*4].decode("utf-32-le").split("\x00")[0]
        return s if 1 <= len(s) <= n and s.isprintable() else None
    except Exception: return None
def rd_i32(va):
    return struct.unpack_from("<i", img, roff+(va-raddr))[0] if in_ro(va) else None
def rd_f32(va):
    return struct.unpack_from("<f", img, roff+(va-raddr))[0] if in_ro(va) else None

def dis(va, size):
    code = img[toff+(va-taddr):toff+(va-taddr)+size]
    md = Cs(CS_ARCH_X86, CS_MODE_32); md.skipdata = True
    return [i for i in md.disasm(code, va) if i.id != 0]

import re
insns = dis(0x80725c0, 41111)
blocks, cur = [], {"strs": [], "nums": []}
for i in insns:
    m = re.findall(r"0x[0-9a-f]{6,8}", i.op_str)
    for t in m:
        v = int(t, 16)
        if in_ro(v):
            s = rd_wide(v)
            if s: cur["strs"].append(s); break
    if i.mnemonic in ("mov", "movzx", "movsx") and "ebp -" in i.op_str and "," in i.op_str:
        try:
            tail = i.op_str.split(",")[-1].strip().rstrip("]")
            if tail.startswith("0x"):
                v = int(tail, 16)
            elif tail.lstrip("-").isdigit():
                v = int(tail)
            else:
                raise ValueError
            try: fl = struct.unpack("<f", struct.pack("<I", v & 0xFFFFFFFF))[0]
            except Exception: fl = None
            cur["nums"].append((i.address, v, fl))
        except Exception: pass
    if i.mnemonic == "call" and "0x8218ff0" in i.op_str:
        blocks.append(cur); cur = {"strs": [], "nums": []}
print(len(blocks), "bloques")
for b in blocks[:14]:
    strs = [s for s in b["strs"][:14]]
    nums = "; ".join(f"{v}({fl:.2f})" if fl is not None and abs(fl) < 1e7 and abs(fl) > 1e-4 else str(v) for _, v, fl in b["nums"][:14])
    print("STR:", strs)
    print("NUM:", nums)
    print()
