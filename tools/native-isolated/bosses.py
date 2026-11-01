"""Direct native boss captures in TEMP, without host input or original-file edits.

Run build.py first. Positional arguments select levels; the default captures all
twelve boss arenas (including the three birds). Only the TEMP fixture's Start
and map slot change. Captures are observations, not time-aligned equivalence tests.
"""
from pathlib import Path
import hashlib
import json
import os
import shutil
import sys
import time
import xml.etree.ElementTree as ET
from runner import NativeRunner, input_desktop_name

root = Path(__file__).resolve().parents[2]
source = root.parent / "Vascolet"
temporary = Path(os.environ["LOCALAPPDATA"]) / "Temp/opencode"
lab = temporary / "vascolet-boss-reference"
adapter = temporary / "vascolet-native-iteration2"
assert temporary.is_dir() and (adapter / "dinput8.dll").is_file(), "Run build.py first"
lab.mkdir(exist_ok=True)
if not (lab / "assets").exists():
    shutil.copytree(source / "assets", lab / "assets")
for dll in adapter.glob("*.dll"):
    shutil.copy2(dll, lab / dll.name)
shutil.copy2(adapter / "vascolet4.exe", lab / "vascolet4.exe")
kinds = {1:"BigScorpion", 3:"TopoNinja", 4:"BigBird", 6:"FurryCritter",
         7:"BigUglyDragon", 9:"GiantDragonfly", 10:"BigAnguila", 12:"BigPirana",
         13:"BigBat", 15:"BigSpider", 16:"BigGhost", 18:"Malmark2"}
levels = list(map(int, sys.argv[1:])) or list(kinds)
if any(level not in kinds for level in levels):
    raise ValueError("Choose a boss level: " + ", ".join(map(str, kinds)))
digest = lambda file: hashlib.sha256(file.read_bytes()).hexdigest()
exe_before = digest(source / "vascolet4.exe")
report = {"originalExecutableSHA256":exe_before, "globalInputUsed":False,
          "desktopSelected":False, "scope":"Original map copied to level1 with Start moved into the arena; protected-player flags and native code are not changed", "levels":[]}
for level in levels:
    original_map = source / f"assets/data/maps/level{level}.tmx"
    before = digest(original_map)
    xml = ET.parse(original_map)
    boss = next(o for o in xml.findall(".//object") if o.get("name") == kinds[level])
    start = next(o for o in xml.findall(".//object") if o.get("name") == "Start")
    start.set("x", str(int(boss.get("x")) - 96))
    start.set("y", str(int(boss.get("y")) + {4:192,7:96,9:96,13:64,15:256,16:64}.get(level, 0)))
    xml.write(lab / "assets/data/maps/level1.tmx", encoding="utf-8", xml_declaration=True)
    profile = lab / "profile"
    if profile.exists():
        shutil.rmtree(profile)
    output = lab / f"level-{level}"
    output.mkdir(exist_ok=True)
    entry = {"level":level, "kind":kinds[level], "originalMapSHA256":before, "frames":[]}
    with NativeRunner(lab / "vascolet4.exe") as runner:
        time.sleep(19)
        for _ in range(4):
            runner.press(28, .12, 1)
        time.sleep(5)
        runner.press(28, .12, .6)
        beginning = time.perf_counter()
        for at in [0, 1, 3, 6, 10]:
            time.sleep(max(0, beginning + at - time.perf_counter()))
            file = output / f"{at}.png"
            runner.capture(file)
            entry["frames"].append(str(file))
        entry["inputDesktopBefore"] = runner.input_desktop_before
    time.sleep(10)
    entry["inputDesktopAfter"] = input_desktop_name()
    assert entry["inputDesktopAfter"] == entry["inputDesktopBefore"]
    assert digest(original_map) == before
    assert digest(source / "vascolet4.exe") == exe_before
    report["levels"].append(entry)
    (lab / "report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(entry), flush=True)
