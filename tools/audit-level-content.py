"""Compare shipped map/music assignments directly with the local Windows original."""
from pathlib import Path
from collections import Counter
import hashlib,json,xml.etree.ElementTree as ET
root=Path(__file__).resolve().parents[1]
original=root.parent/'Vascolet/assets'
assert original.is_dir(),'Local Windows original not found'
digest=lambda file:hashlib.sha256(file.read_bytes()).hexdigest()
music=set();results=[]
for level in range(1,19):
    relative=f'data/maps/level{level}.tmx';web=root/'assets'/relative;native=original/relative
    assert digest(web)==digest(native),f'Map differs from original: {relative}'
    map=ET.parse(native).getroot()
    props={p.get('name'):p.get('value','') for p in map.findall('./properties/property')}
    tracks={k:v for k,v in props.items() if k.startswith('music,') and v}
    music.update(tracks.values())
    results.append({'level':level,'mapsIdentical':True,'player':props.get('player'),
        'enemies':dict(Counter(o.get('name') for o in map.findall('./objectgroup[@name="Enemies"]/object'))),'music':tracks})
music.update(['gameover.ogg','win_game.ogg'])
for track in music:
    relative=f'audio/music/win/{track}'
    assert digest(root/'assets'/relative)==digest(original/relative),f'Music differs from original: {track}'
effects=list((root/'assets/audio/fx/win').glob('*.ogg'))
for effect in effects:
    native=original/'audio/fx/win'/effect.name
    assert digest(effect)==digest(native),f'Effect differs from original: {effect.name}'
for result in results:print(json.dumps(result,ensure_ascii=False))
print(json.dumps({'ok':True,'identicalMaps':18,'identicalMusicFiles':len(music),'identicalEffectFiles':len(effects)}))
