import pefile, struct
from collections import defaultdict
EXE = r"C:\Users\faust\Desktop\cosas IA\Vascolet\vascolet4.exe"
pe = pefile.PE(EXE)
BASE = pe.OPTIONAL_HEADER.ImageBase
img = open(EXE, "rb").read()

def va_of_off(off):
    for s in pe.sections:
        if s.PointerToRawData <= off < s.PointerToRawData + s.SizeOfRawData:
            return BASE + s.VirtualAddress + (off - s.PointerToRawData)
    return None

def sec_of_va(va):
    rva = va - BASE
    for s in pe.sections:
        if s.VirtualAddress <= rva < s.VirtualAddress + s.Misc_VirtualSize:
            return s.Name.decode().strip("\x00")
    return "?"

refs = defaultdict(list)
for s in pe.sections:
    if s.Name.decode().strip("\x00") not in (".rdata", ".text", ".data"):
        continue
    raw, rsz = s.PointerToRawData, s.SizeOfRawData
    for off in range(raw, raw + rsz - 4, 4):
        v = struct.unpack_from("<I", img, off)[0]
        if BASE <= v < BASE + 0x500000:
            refs[v].append(off)

# TD de CharacterPhysicsEntity: buscar su nombre
import re
m = re.search(rb"\.\?AVCharacterPhysicsEntity@@", img)
td_off = m.start() - 8
td_va = va_of_off(td_off)
print("TD va:", hex(td_va))
for coff in refs.get(td_va, []):
    print(f"ref-a-TD en off {hex(coff)} sec={ [s.Name.decode().strip(chr(0)) for s in pe.sections if s.PointerToRawData <= coff < s.PointerToRawData+s.SizeOfRawData] } val={hex(struct.unpack_from('<I', img, coff)[0])}")
    cva = va_of_off(coff)
    print("  como VA:", hex(cva), " refs a el:", len(refs.get(cva, [])))
    for voff in refs.get(cva, [])[:6]:
        entries = [struct.unpack_from("<I", img, voff + 4 + i * 4)[0] for i in range(4)]
        secs = [sec_of_va(e) for e in entries]
        print(f"    cand voff={hex(voff)} entries={list(map(hex, entries))} secs={secs}")
