"""Bounded ELF excerpts for the enemy workflow; requires pyelftools + capstone."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from elftools.elf.elffile import ELFFile

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--subject', choices=['Fly', 'Frog', 'Flower', 'Beetle', 'Snail', 'PlayerDamage', 'PlayerProgress', 'BigScorpion', 'MountedPlayers', 'AutoCamera'], default='Frog')
parser.add_argument('--compact', action='store_true', help='Only annotated strings/actions/constants, for focused review')
parser.add_argument('--binary', type=Path, default=root.parent / 'Vascolet4.activity/bin/vascolet4')
parser.add_argument('--output', type=Path, default=root / 'analysis/native-evidence')
args = parser.parse_args()
ranges = {
    'Fly': [(0x0816c8f5, 0x0816d080), (0x08078c20, 0x08078d70)],
    'Frog': [(0x08170434, 0x08170b70), (0x080797f0, 0x08079940)],
    'Flower': [(0x0816ecd8, 0x0816f4e2), (0x080792b0, 0x08079400)],
    'Beetle': [(0x0816f4e2, 0x0816f945), (0x08079400, 0x08079550)],
    'Snail': [(0x0816fdc7, 0x08170408), (0x080796a0, 0x080797f0)],
    'PlayerDamage': [(0x080cca24, 0x080ccd53), (0x080cdd12, 0x080ce150)],
    'PlayerProgress': [(0x080c6180, 0x080c6be2), (0x080d57f0, 0x080d5a28),
                       (0x080d66ac, 0x080d680c), (0x081e8740, 0x081e876a), (0x08201040, 0x0820108d)],
    'BigScorpion': [(0x08176a3e, 0x08178c8e)],
    'MountedPlayers': [(0x081679f0, 0x0816c8f5), (0x08078ad4, 0x08078c18),
                       (0x0807a67d, 0x0807a7c9), (0x081e7680, 0x081e76fe), (0x081e9a70, 0x081e9bc2)],
    'AutoCamera': [(0x081cfad0, 0x081d01b2), (0x081d40a0, 0x081d4b15),
                   (0x082012d0, 0x082014f3), (0x08202ac0, 0x08202d07)],
}
with args.binary.open('rb') as f:
    elf = ELFFile(f)
    if elf.elfclass != 32 or elf['e_machine'] != 'EM_386': raise ValueError('Expected original i386 ELF')
    sections = [(s['sh_addr'], s.data()) for s in elf.iter_sections() if s['sh_type'] != 'SHT_NOBITS']
    symbols = list(elf.get_section_by_name('.symtab').iter_symbols())
    state = next((s for s in symbols if s.name == '_ZN11GameScripts15script_states_2Ev'), None)
    if state is None or state['st_value'] != 0x081679f0 or state['st_size'] != 161029:
        raise ValueError('Binary layout differs from the indexed original; rebuild the ranges before extracting')
    names = {s['st_value']: s.name for s in symbols if s['st_info']['type'] == 'STT_FUNC'}
    names.update({s['st_value'] + 8: s.name for s in symbols if s.name.startswith('_ZTV')})
def read(va, size):
    for start, data in sections:
        if start <= va and va + size <= start + len(data): return data[va-start:va-start+size]
    return b''
def string(va):
    chars = []
    for i in range(100):
        raw = read(va + i*4, 4)
        if not raw: return None
        c = int.from_bytes(raw, 'little')
        if c == 0: return ''.join(chars) if len(chars) > 1 else None
        if not 32 <= c < 256: return None
        chars.append(chr(c))
    return None
args.output.mkdir(parents=True, exist_ok=True)
files = []
for start, end in ranges[args.subject]:
    lines = []
    for ins in Cs(CS_ARCH_X86, CS_MODE_32).disasm(read(start, end-start), start):
        notes = []
        for token in re.findall(r'0x[0-9a-f]{7,8}', ins.op_str):
            va = int(token, 16)
            text = string(va)
            if text: notes.append(repr(text))
            elif va in names: notes.append(names[va])
            elif ins.mnemonic.startswith('f') and len(read(va, 4)) == 4:
                notes.append('f32=' + str(struct.unpack('<f', read(va, 4))[0]))
            elif va >= 0x3b000000:
                value = struct.unpack('<f', struct.pack('<I', va))[0]
                if .001 < abs(value) < 100000: notes.append('literal=' + str(value))
        if notes or not args.compact:
            lines.append(f'{ins.address:#x} {ins.mnemonic:8} {ins.op_str} ; {" ".join(notes)}')
    file = args.output / f'{args.subject}-{start:08x}.txt'
    file.write_text('\n'.join(lines), encoding='utf-8'); files.append(str(file))
manifest = {'subject': args.subject, 'binary': str(args.binary), 'sha256': hashlib.sha256(args.binary.read_bytes()).hexdigest(),
            'ranges': ranges[args.subject], 'files': files, 'scope': 'ELF excerpts, not Windows equivalence certification'}
if args.subject == 'PlayerProgress':
    raw = read(0x0860dbb0, 4)
    manifest['boomerang_level_initial_data'] = struct.unpack('<i', raw)[0] if len(raw) == 4 else None
(args.output / f'{args.subject}.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print(json.dumps(manifest, indent=2))
