"""Compact inventory of original TMX mechanics, without dumping tile CSVs."""
from collections import Counter
from pathlib import Path
import json
import xml.etree.ElementTree as ET
import argparse

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--level', type=int, nargs='+', default=list(range(1, 19)))
args = parser.parse_args()
for number in args.level:
    level = ET.parse(root / f'assets/data/maps/level{number}.tmx').getroot()
    props = {p.get('name'): p.get('value', p.text or '') for p in level.findall('./properties/property')}
    groups = {}
    for group in level.findall('objectgroup'):
        if group.get('name') == 'REFERENCE': continue
        objects = group.findall('object')
        groups[group.get('name')] = dict(Counter(o.get('name', '') for o in objects))
    print(json.dumps({'level': number, 'size': [int(level.get('width')) * 32, int(level.get('height')) * 32],
        'player': props.get('player', 'Vascolet'), 'win': {k: v for k, v in props.items() if k.startswith('win')},
        'groups': groups,
        'camera': [o.attrib for o in level.findall('./objectgroup[@name="Camera"]/object')],
        'start': [o.attrib for o in level.findall('./objectgroup[@name="General"]/object[@name="Start"]')],
        'exit': [o.attrib for o in level.findall('./objectgroup[@name="Items"]/object[@name="Exit"]')]}, ensure_ascii=False))
