"""Recover character descriptors from the symbolized original, without global analysis."""
from pathlib import Path
import json, struct, hashlib
from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from elftools.elf.elffile import ELFFile

root=Path(__file__).resolve().parents[1]
binary=root.parent/'Vascolet4.activity/bin/vascolet4'
with binary.open('rb') as stream:
    elf=ELFFile(stream)
    if elf.elfclass!=32 or elf['e_machine']!='EM_386':raise ValueError('Expected original i386 ELF')
    sections=[(s['sh_addr'],s.data()) for s in elf.iter_sections() if s['sh_type']!='SHT_NOBITS']
def read(address,size):
    for start,data in sections:
        if start<=address and address+size<=start+len(data):return data[address-start:address-start+size]
    return b''
def text(address):
    out=[]
    for i in range(120):
        raw=read(address+4*i,4)
        if len(raw)!=4:return None
        c=int.from_bytes(raw,'little')
        if c==0:return ''.join(out) or None
        if not 32<=c<256:return None
        out.append(chr(c))
catalog=[];fields={};strings=[];start=None
assert hashlib.sha256(binary.read_bytes()).hexdigest()=='95f3798f7e1be2bb75a85d637e74750beb41787cbd260549232f88f5cd759573','Reindex descriptor offsets for a different binary'
for ins in Cs(CS_ARCH_X86,CS_MODE_32).disasm(read(0x080725c0,41111),0x080725c0):
    if ins.mnemonic=='call' and ins.op_str=='0x821e490':
        fields={};strings=[];start=ins.address
    if ins.mnemonic=='mov' and ', ' in ins.op_str:
        dst,src=ins.op_str.rsplit(', ',1)
        try:value=int(src,0)
        except ValueError:continue
        if dst=='dword ptr [esp + 4]':
            s=text(value)
            if s is not None:strings.append(s)
        for offset,name in [('0x58','gravity'),('0x50','hp'),('0x48','physicsType'),('0x44','halfWidth'),('0x40','height')]:
            if dst==f'dword ptr [ebp - {offset}]':fields[name]=struct.unpack('<f',struct.pack('<I',value))[0] if name=='gravity' else value
    if ins.mnemonic=='call' and ins.op_str=='0x8218ff0' and len(strings)>=6:
        catalog.append(dict(name=strings[0],image=strings[1],animation=strings[2],persistent=strings[3],
            script=strings[4],initial=strings[5],address=hex(start),**fields))
output=root/'analysis/native-character-catalog.json'
output.write_text(json.dumps({'sha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'characters':catalog},indent=2),encoding='utf-8')
for character in catalog:print(json.dumps(character))
