"""Build the x86 IO-only adapter with existing VS tools; binaries stay in TEMP."""
from pathlib import Path
import os,subprocess,shutil,hashlib
root=Path(__file__).resolve().parent
out=Path(os.environ['LOCALAPPDATA'])/'Temp/opencode/vascolet-native-iteration2'
source=root.parents[2]/'Vascolet'
assert out.parent.is_dir() and source.is_dir()
out.mkdir(exist_ok=True)
if not (out/'assets').exists():shutil.copytree(source/'assets',out/'assets')
original=(source/'vascolet4.exe').read_bytes();old='Vascolet4'.encode('utf-16-le');new='VascoTst4'.encode('utf-16-le')
assert original.count(old)==1 and len(old)==len(new)
(out/'vascolet4.exe').write_bytes(original.replace(old,new))
for dll in source.glob('*.dll'):
    if dll.name.lower()!='dinput8.dll':shutil.copy2(dll,out/dll.name)
assert hashlib.sha256((out/'assets/data/maps/level1.tmx').read_bytes()).digest()==hashlib.sha256((source/'assets/data/maps/level1.tmx').read_bytes()).digest()
vc=Path(r'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat')
assert vc.is_file()
command=f'call "{vc}" x86 && cl /nologo /LD /MT /O2 /EHsc /std:c++17 "{root / "adapter.cpp"}" /Fo"{out / "adapter.obj"}" /link /DEF:"{root / "adapter.def"}" /OUT:"{out / "dinput8.dll"}" /IMPLIB:"{out / "adapter.lib"}" user32.lib dxguid.lib'
subprocess.run(command,shell=True,cwd=out,check=True)
