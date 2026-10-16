import json, re, struct
from elftools.elf.elffile import ELFFile
P = r"C:\Users\faust\Desktop\cosas IA\vascolet4.activity\bin\vascolet4"
f = open(P, "rb"); e = ELFFile(f); img = open(P, "rb").read()
ro = e.get_section_by_name(".rodata")
raddr, roff, rsz = ro.header.sh_addr, ro.header.sh_offset, ro.header.sh_size
text = e.get_section_by_name(".text")
taddr = text.header.sh_addr

def va_of_off(off):
    for s in e.iter_sections():
        a, o, sz = s.header.sh_addr, s.header.sh_offset, s.header.sh_size or 1
        if o and o <= off < o + sz:
            return a + (off - o) if a else None
    return None

idx = json.load(open(r"C:\Users\faust\Desktop\cosas IA\vascolet-js\tools\elf_imm.json"))
# todos los cs-msg y banners con sus VA
strs = {}
patterns = [rb"cs\d-msg\d+", rb"dialogBanner[A-Za-z0-9]*", rb"cartelDialogos", rb"mensaje"]
# buscar en utf-32-le: convertir patron insertando \x00\x00\x00 entre chars no funciona con regex;
# en su lugar escanear todos los wide strings e filtrar
for m in re.finditer(rb"(?:[\x20-\x7e]\x00\x00\x00){3,40}?", img):
    raw = img[m.start():m.start() + 160]
    try:
        s = raw.decode("utf-32-le").split("\x00")[0]
    except Exception:
        continue
    if not (3 <= len(s) <= 40 and s.isprintable()):
        continue
    if re.fullmatch(r"cs\d-msg\d+|dialogBanner[A-Za-z0-9]*|cartelDialogos|mensaje", s):
        va = va_of_off(m.start())
        if va and s not in strs:
            strs[s] = va
print(len(strs), "strings")
pairs = []
for s, va in sorted(strs.items()):
    if s.startswith("cs"):
        refs = idx.get(str(va), [])
        # banners referenciados cerca (misma funcion +-4KB)
        near = set()
        for r in refs:
            for s2, va2 in strs.items():
                if s2.startswith("dialogBanner"):
                    for r2 in idx.get(str(va2), []):
                        if abs(r2 - r) < 4096:
                            near.add((s2, r2 - r))
        pairs.append((s, [(hex(r), sorted(n)) for r, n in [ (r, []) for r in refs[:3]]] + sorted(near)))
for s, info in sorted(pairs):
    print(s, info)
