import struct
from elftools.elf.elffile import ELFFile
from capstone import Cs, CS_ARCH_X86, CS_MODE_32
P = r"C:\Users\faust\Desktop\cosas IA\vascolet4.activity\bin\vascolet4"
f = open(P, "rb"); e = ELFFile(f); img = open(P, "rb").read()
text = e.get_section_by_name(".text"); ro = e.get_section_by_name(".rodata")
taddr, toff = text.header.sh_addr, text.header.sh_offset
raddr, roff = ro.header.sh_addr, ro.header.sh_offset
R0, R1 = raddr, raddr + ro.header.sh_size

def rdstr(va, wide=True, n=48):
    o = roff + (va - raddr)
    raw = img[o:o + n * 2]
    if wide:
        s = raw.decode("utf-16-le", errors="ignore").split("\x00")[0]
    else:
        s = raw.split(b"\x00")[0].decode(errors="ignore")
    return s if s.isprintable() and len(s) >= 2 else None

def dis_range(va, size):
    code = img[toff + (va - taddr):toff + (va - taddr) + size]
    md = Cs(CS_ARCH_X86, CS_MODE_32); md.skipdata = True
    return [i for i in md.disasm(code, va) if i.id != 0]

# defineCharacters: 0x80725c0
insns = dis_range(0x80725c0, 41111)
print(len(insns), "instrs")
import re
for i in insns:
    m = re.findall(r"0x[0-9a-f]{6,8}", i.op_str)
    for t in m:
        v = int(t, 16)
        if R0 <= v < R1:
            # es string?
            try:
                s = rdstr(v)
            except Exception:
                s = None
            if s:
                print(f"{i.address:#x}  str[{s[:40]}]")
                break
            else:
                try:
                    fl = struct.unpack_from("<f", img, roff + (v - raddr))[0]
                    iv = struct.unpack_from("<i", img, roff + (v - raddr))[0]
                    if abs(fl) < 1e6 and fl == fl:
                        print(f"{i.address:#x}  f32[{fl}] int[{iv}]")
                        break
                except Exception:
                    pass
