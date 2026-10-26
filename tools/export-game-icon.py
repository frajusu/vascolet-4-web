"""Export the original EXE's first Windows icon group without changing its images."""
from pathlib import Path
import argparse, hashlib, json, struct
import pefile

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--exe', type=Path, default=root.parent / 'Vascolet/vascolet4.exe')
parser.add_argument('--output', type=Path, default=root / 'assets/icons/vascolet4-original.ico')
args = parser.parse_args()
pe = pefile.PE(str(args.exe))
resources = {entry.id: entry for entry in pe.DIRECTORY_ENTRY_RESOURCE.entries}
groups = resources[14].directory.entries
group = sorted(groups, key=lambda entry: (entry.id is None, entry.id or 0))[0]
group_entry = group.directory.entries[0].data.struct
data = pe.get_data(group_entry.OffsetToData, group_entry.Size)
reserved, kind, count = struct.unpack_from('<HHH', data)
assert reserved == 0 and kind == 1 and count > 0
icons = {entry.id: entry for entry in resources[3].directory.entries}
offset = 6 + count * 16
directory, images, sizes = [], [], []
for i in range(count):
    width, height, colors, reserved, planes, bits, size, identifier = struct.unpack_from('<BBBBHHIH', data, 6 + i * 14)
    resource = icons[identifier].directory.entries[0].data.struct
    image = pe.get_data(resource.OffsetToData, resource.Size)
    assert len(image) == size
    directory.append(struct.pack('<BBBBHHII', width, height, colors, reserved, planes, bits, len(image), offset))
    images.append(image); offset += len(image)
    sizes.append([width or 256, height or 256, bits])
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_bytes(struct.pack('<HHH', 0, 1, count) + b''.join(directory) + b''.join(images))
pe.close()
print(json.dumps({'source': str(args.exe), 'sourceSha256': hashlib.sha256(args.exe.read_bytes()).hexdigest(),
    'iconGroup': group.id or str(group.name), 'images': sizes, 'output': str(args.output)}, indent=2))
