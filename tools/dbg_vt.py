import pefile, struct
EXE = r"C:\Users\faust\Desktop\cosas IA\Vascolet\vascolet4.exe"
pe = pefile.PE(EXE)
BASE = pe.OPTIONAL_HEADER.ImageBase
img = open(EXE, "rb").read()

def sec_of_va(va):
    rva = va - BASE
    for s in pe.sections:
        if s.VirtualAddress <= rva < s.VirtualAddress + s.Misc_VirtualSize:
            return s.Name.decode().strip("\x00")
    return "?"

def sec_of_off(off):
    for s in pe.sections:
        if s.PointerToRawData <= off < s.PointerToRawData + s.SizeOfRawData:
            return s.Name.decode().strip("\x00")
    return "?"

def va2off(va):
    rva = va - BASE
    for s in pe.sections:
        if s.VirtualAddress <= rva < s.VirtualAddress + max(s.Misc_VirtualSize, s.SizeOfRawData):
            return s.PointerToRawData + (rva - s.VirtualAddress)
    return None

# vtable CharacterPhysicsEntity segun salida anterior: 0x6a9a00
vt = 0x6a9a00
off = va2off(vt)
print("vtable off:", hex(off) if off else None, "sec:", sec_of_off(off) if off else None)
print("dword en voff-4 (COL?):", hex(struct.unpack_from("<I", img, off)[0]) if off else None)
for i in range(12):
    e = struct.unpack_from("<I", img, off + 4 + i * 4)[0]
    print(f"  [{i}] {hex(e)} sec={sec_of_va(e)}")
