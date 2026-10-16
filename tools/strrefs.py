import struct
from elftools.elf.elffile import ELFFile
from capstone import Cs, CS_ARCH_X86, CS_MODE_32
P = r"C:\Users\faust\Desktop\cosas IA\vascolet4.activity\bin\vascolet4"
f = open(P, "rb"); e = ELFFile(f); img = open(P, "rb").read()
text = e.get_section_by_name(".text"); ro = e.get_section_by_name(".rodata")
taddr, toff = text.header.sh_addr, text.header.sh_offset
raddr, roff, rsz = ro.header.sh_addr, ro.header.sh_offset, ro.header.sh_size

def in_ro(va):
    return raddr <= va < raddr + rsz

def try_wide(va, n=60):
    # wchar_t de 4 bytes (GCC): UTF-32
    if not in_ro(va):
        return None
    raw = img[roff + (va - raddr):roff + (va - raddr) + n * 4]
    try:
        s = raw.decode("utf-32-le").split("\x00")[0]
    except Exception:
        return None
    return s if 2 <= len(s) <= n and s.isprintable() else None

def resolve_str(va):
    # 1. chars directos
    s = try_wide(va)
    if s:
        return s
    # 2. objeto wstring: {ptr|SSO, size, ...}
    try:
        ptr = struct.unpack_from("<I", img, roff + (va - raddr))[0]
        s = try_wide(ptr)
        if s:
            return s
        # 3. SSO: buffer inline (32 bytes para wchar de 4)
        raw = img[roff + (va - raddr):roff + (va - raddr) + 32]
        s = raw.decode("utf-32-le", errors="ignore").split("\x00")[0]
        if 2 <= len(s) <= 8 and s.isprintable():
            return s
    except Exception:
        pass
    return None

def dis_range(va, size):
    code = img[toff + (va - taddr):toff + (va - taddr) + size]
    md = Cs(CS_ARCH_X86, CS_MODE_32); md.skipdata = True
    return [i for i in md.disasm(code, va) if i.id != 0]

import re, sys
start, size = int(sys.argv[1], 16), int(sys.argv[2]) if len(sys.argv) > 2 else 2000
for i in dis_range(start, size):
    hits = []
    for t in re.findall(r"0x[0-9a-f]{6,8}", i.op_str):
        v = int(t, 16)
        if in_ro(v):
            s = resolve_str(v)
            if s:
                hits.append(s[:36])
    if hits:
        print(f"{i.address:#x}  {i.mnemonic:8} {i.op_str[:60]:62} ;; {hits}")
