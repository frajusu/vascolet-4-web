"""Muestra codigo alrededor de referencias a una direccion (VA hex)."""
import pefile, json, sys
from capstone import Cs, CS_ARCH_X86, CS_MODE_32

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

idx = json.load(open(r"C:\Users\faust\Desktop\cosas IA\vascolet-js\tools\imm_index.json"))
text = next(s for s in pe.sections if s.Name.decode().strip("\x00") == ".text")
base_va = BASE + text.VirtualAddress

target = int(sys.argv[1], 16)
refs = idx.get(str(target), [])
print(f"VA {hex(target)}: {len(refs)} refs")
back = int(sys.argv[2]) if len(sys.argv) > 2 else 120
fwd = int(sys.argv[3]) if len(sys.argv) > 3 else 200
for r in refs[:4]:
    print(f"===== funcion con ref en {hex(r)} =====")
    roff = va2off(r)
    start = max(text.PointerToRawData, roff - back)
    chunk = img[start:roff + fwd]
    md = Cs(CS_ARCH_X86, CS_MODE_32)
    md.skipdata = True
    for ins in md.disasm(chunk, base_va + (start - text.PointerToRawData)):
        mark = ">>>" if ins.address == r else "   "
        print(f"{mark} {ins.address:#x}  {ins.mnemonic:8} {ins.op_str}")
