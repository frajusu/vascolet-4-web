import sys
from elftools.elf.elffile import ELFFile
from capstone import Cs, CS_ARCH_X86, CS_MODE_32
P = r"C:\Users\faust\Desktop\cosas IA\vascolet4.activity\bin\vascolet4"
f = open(P, "rb")
e = ELFFile(f)
img = open(P, "rb").read()
text = e.get_section_by_name(".text")
taddr, toff = text.header.sh_addr, text.header.sh_offset

def dis(va, nbytes=600):
    code = img[toff + (va - taddr):toff + (va - taddr) + nbytes]
    md = Cs(CS_ARCH_X86, CS_MODE_32)
    md.skipdata = True
    for ins in md.disasm(code, va):
        print(f"  {ins.address:#x}  {ins.mnemonic:8} {ins.op_str}")
        if ins.mnemonic == "ret":
            break

# rodata helper
ro = e.get_section_by_name(".rodata")
def f32(va):
    return __import__("struct").unpack_from("<f", img, ro.header.sh_offset + (va - ro.header.sh_addr))[0]
def s32(va):
    return __import__("struct").unpack_from("<i", img, ro.header.sh_offset + (va - ro.header.sh_addr))[0]

if "--rodata-floats" in sys.argv:
    import struct
    d = img[ro.header.sh_offset:ro.header.sh_offset + ro.header.sh_size]
    for off in range(0, len(d) - 4, 4):
        v = struct.unpack_from("<f", d, off)[0]
        if v in (1500.0, 170.0, 300.0, 560.0, 900.0, 24.0, 9.0, 8.5, 6.0, 22.0, 12.0):
            print(f"{ro.header.sh_addr + off:#x} = {v}")
else:
    for a in sys.argv[1:]:
        if a.startswith("--"):
            continue
        print(f"===== {a} =====")
        dis(int(a, 16))
