"""Focused static UI evidence reader; does not execute the target executable.

Examples: --function 0x50d9b0 --from-va 0x50dc60 --to-va 0x50e930
          --vtable Options; --strings Vascolet; --function 0x50b5d0 --events
"""
import argparse
import hashlib
import json
import math
import re
import struct
import xml.etree.ElementTree as ET

from capstone.x86_const import X86_OP_IMM, X86_OP_MEM
from native_map import NativeMap, ROOT, hx


def mapper():
    result = NativeMap(ROOT.parent / "Vascolet" / "vascolet4.exe", ROOT / "tools" / "imm_index.json")
    result.recover_tables(json.loads((ROOT / "tools" / "vtables.json").read_text()))
    return result


def annotations(m, ins):
    result = []
    for op in ins.operands:
        if op.type == X86_OP_MEM and op.mem.base == 0 and op.mem.index == 0:
            va = op.mem.disp & 0xffffffff
            offset = m.offset(va)
            if offset is not None and ins.mnemonic.startswith("f"):
                width = 8 if op.size == 8 else 4
                fmt = ("<q" if width == 8 else "<i") if ins.mnemonic == "fild" else ("<d" if width == 8 else "<f")
                number = struct.unpack_from(fmt, m.data, offset)[0]
                result.append(f"data {hx(va)}={number!r} ({width*8}-bit; raw {hx(offset)})")
        if op.type == X86_OP_IMM:
            value = op.imm & 0xffffffff
            if ins.mnemonic.startswith(("call", "j")):
                continue
            string = m.string(value)
            if string:
                result.append(f"{string['encoding']} {string['text']!r} @ {string['va']}")
            elif ins.mnemonic in ("push", "mov"):
                number = struct.unpack("<f", struct.pack("<I", value))[0]
                if math.isfinite(number) and 0.001 <= abs(number) <= 100000:
                    result.append(f"immediate-as-f32={number!r} (interpretation candidate)")
    return result


def function_instructions(m, address):
    m.analyze(address)
    return [m.instruction(int(line.split(":", 1)[0], 16)) for line in m.disassembly[address]]


def scalar(m, at):
    ins = m.instruction(at)
    assert ins and ins.mnemonic in ("fld", "fldz", "fld1", "fsub", "fadd"), hx(at)
    if ins.mnemonic in ("fldz", "fld1"):
        value = 0.0 if ins.mnemonic == "fldz" else 1.0
        return {"at": hx(at), "value": value, "ieee754_hex": hx(struct.unpack("<I", struct.pack("<f", value))[0]), "instruction": m.line(ins)}
    op = ins.operands[0]
    assert op.type == X86_OP_MEM and op.mem.base == 0 and op.mem.index == 0
    va, width = op.mem.disp & 0xffffffff, op.size
    offset = m.offset(va)
    raw = m.data[offset:offset + width]
    return {"at": hx(at), "data_va": hx(va), "raw_offset": hx(offset), "width_bytes": width,
            "value": struct.unpack("<d" if width == 8 else "<f", raw)[0],
            "ieee754_hex": "0x" + raw[::-1].hex(), "instruction": m.line(ins)}


def snippet(m, start, end):
    result = []
    while start < end and len(result) < 120:
        ins = m.instruction(start)
        if ins is None:
            break
        result.append(m.line(ins))
        start += ins.size
    return result


def atlas_assets(path):
    return {node.attrib["keyName"]: {"origin": [int(v) for v in node.attrib["axis"].split(",")],
                                    "source_rect": [int(v) for v in node.attrib["sourceRect"].split(",")]}
            for node in ET.parse(path).iter("SpriteData")}


def write_json(m):
    assets = ROOT.parent / "Vascolet" / "assets"
    # Recover the two stack arrays with a tiny x87 constant-store interpreter.
    # PUSH 0x48 occurs between the first FLD and FSTP: normalize ESP explicitly.
    stack, slots, sp_delta = [], {}, 0
    for ins in function_instructions(m, 0x50B5D0):
        if not 0x50BB4B <= ins.address <= 0x50BD14:
            continue
        if ins.mnemonic == "push":
            sp_delta -= 4
        elif ins.mnemonic == "fld":
            stack.insert(0, scalar(m, ins.address))
        elif ins.mnemonic in ("fst", "fstp"):
            op = ins.operands[0]
            assert op.type == X86_OP_MEM and m.md.reg_name(op.mem.base) == "esp"
            slots[op.mem.disp + sp_delta] = {**stack[0], "store_at": hx(ins.address), "store_instruction": m.line(ins)}
            if ins.mnemonic == "fstp":
                stack.pop(0)
    points = [{"level_index": index, "x": slots[0xf4 + index*4], "y": slots[0xac + index*4]}
              for index in range(18)]
    assert [(p["x"]["value"], p["y"]["value"]) for p in points] == [
        (19,231),(31,271),(59,299),(95,325),(146,343),(200,348),
        (249,343),(303,333),(352,317),(396,300),(433,278),(463,248),
        (482,211),(480,174),(466,139),(444,106),(411,79),(375,63)]
    main_rows = []
    for key, local_y, callsite, store, attach in (
        ("jugarUp", 0, None, None, 0x50DC97),
        ("opcionesUp", 40, 0x50DDEE, 0x50DDFA, 0x50DDDD),
        ("ayudaUp", 80, 0x50DF4F, 0x50DF5B, 0x50DF3E),
        ("creditosUp", 120, 0x50E0B0, 0x50E0BC, 0x50E09F),
        ("salirUp", 180, 0x50E211, 0x50E21D, 0x50E200),
        ("reset_game", 227, 0x50E387, 0x50E393, 0x50E376),
    ):
        evidence = scalar(m, callsite) if callsite else {"value": 0, "basis": "default sprite position: 0x525294 -> 0x526bfd/0x526c03"}
        assert evidence["value"] == local_y
        main_rows.append({"asset": key, "local_anchor": [0, local_y], "logical_anchor": [450, 120+local_y],
                          "y_evidence": evidence, "y_store_at": hx(store) if store else None,
                          "group_attach_virtual_callsite": hx(attach)})
    options = []
    for name, xat, yat, role in (
        ("panel",0x510BE0,0x510BF3,"centered 512x384 atlas panel"),
        ("music_toggle",0x510EAB,0x510EC3,"first sound checkbox; .options+0x424, reads settings+0xc"),
        ("effects_toggle",0x51131E,0x511336,"second sound checkbox; .options+0x420"),
        ("music_slider_base",0x51103B,0x511053,"x=145+200*music_volume; y=160"),
        ("effects_slider_base",0x5114B0,0x5114C8,"x=145+200*effects_volume; y=226"),
        ("fullscreen_checkbox",0x5116FB,0x511714,"label assignment corroborated by original options atlas"),
        ("stretch_checkbox",0x51191A,0x511932,"label assignment corroborated by original options atlas"),
        ("back",0x511A80,0x511A91,"volverUp/volverOver"),
    ):
        x, y = scalar(m, xat), scalar(m, yat)
        options.append({"name": name, "anchor": [x["value"], y["value"]], "x_evidence": x, "y_evidence": y, "role": role})
    fonts = []
    for font_id, name in ((0,"clanOT20"),(1,"winnie14-or"),(2,"winnie14-ob")):
        file = assets / "lang" / "fonts" / (name + ".xml")
        glyphs = {chr(int(node.attrib["key"])): {tag: int(node.findtext(tag)) for tag in ("x","y","width","height")}
                  for node in ET.parse(file).iter("character")}
        fonts.append({"font_id": font_id, "name": name, "asset": str(file.relative_to(assets)),
                      "sha256": hashlib.sha256(file.read_bytes()).hexdigest(), "character_spacing": 0,
                      "logical_heights": sorted({g["height"] for g in glyphs.values()}),
                      "advance_formula": "XML width; no extra spacing. Raster source width/height rounded up to even, but logical advance retains original width.",
                      "sample_glyphs": {c: glyphs[c] for c in " AiW.0123456789" if c in glyphs},
                      "glyph_widths": {c: g["width"] for c,g in glyphs.items()}})
    evidence_ranges = {
        "sprite_default_xy_scale": (0x526BF2,0x526C28),
        "main_parent_translation": (0x50E3C5,0x50E3F7),
        "main_parent_hierarchy": (0x50E48E,0x50E4C4),
        "main_help_origin": (0x50E4C4,0x50E4F0),
        "version_footer_anchor": (0x50E693,0x50E6E5),
        "chapter_button_position_store": (0x50BE5F,0x50BEA3),
        "chapter_indicator_offset_with_pending_push": (0x50C8E5,0x50C94F),
        "chapter_title_positions": (0x50C68B,0x50C708),
        "options_slider_formula": (0x51103B,0x5110D4),
        "options_help_config_call": (0x511AC9,0x511AF3),
        "help_item_position_formula": (0x5100C1,0x510167),
        "font_loader_zero_spacing_parameters": (0x4C5942,0x4C595C),
        "font_descriptor_parameter_stores": (0x42C1AE,0x42C1D2),
        "glyph_width_even_rounding_vs_advance": (0x42C8E4,0x42C950),
        "font_spacing_getter": (0x42A540,0x42A544),
        "text_advance_and_final_spacing_removal": (0x53B0CF,0x53B107),
        "text_width_final_spacing_removal": (0x53B141,0x53B168),
        "game_subject_vertical_acceleration": (0x4D4540,0x4D45AD),
    }
    evidence = {name: snippet(m, start, end) for name,(start,end) in evidence_ranges.items()}
    report = {
        "binary_sha256": hashlib.sha256(m.data).hexdigest(), "address_convention": "preferred VAs; raw offsets always section converted",
        "method": "Static bounded Capstone and original read-only XML atlas/font metadata; semantic roles inferred where noted. No original execution.",
        "main_menu": {"constructor": hx(0x50D9B0), "group_object_offset": "0x430", "group_translation": [scalar(m,0x50E3C5),scalar(m,0x50E3D9)],
                      "rows": main_rows, "primary_sprite_geometry": {"size":[110,30],"origin":[55,15]},
                      "root_group": "MainMenuState+0x330, default identity; button group+0x430 and background+0x20c are siblings under it",
                      "help_origin": [20,20], "version_anchor": {"x": scalar(m,0x50E6C2), "y_formula": "screen/config height at [0x6e1d64]+8 minus 3.0", "subtract": scalar(m,0x50E6A9)}},
        "level_select": {"setup": hx(0x50B5D0), "vtable": hx(0x69ADCC), "slot": 1, "update": hx(0x50CA90),
                         "placement": "18 hard-coded float pairs, not runtime sin/cos", "points": points,
                         "stack_normalization": "0x50bb51 PUSH 0x48 shifts ESP by -4 while constants are stored; 0x50bd20 restores it. Normalized arrays x=ESP+0xf4, y=ESP+0xac.",
                         "back": {"x": scalar(m,0x50C27D), "y": scalar(m,0x50C296)},
                         "achievements": {"x": scalar(m,0x50C405), "y": scalar(m,0x50C41C)},
                         "banner_anchor": [scalar(m,0x50C55B), scalar(m,0x50C56C)],
                         "help_origin": [20,360], "indicator_anchor_delta": [-23,-10],
                         "title_group_anchor": [scalar(m,0x50C68B),scalar(m,0x50C69E)],
                         "title_children": {"counter_local_anchor":[0,-6],"name_local_anchor":[32,18],"counter_font_id":2},
                         "indicator_delta_caveat": "0x50c8e5 PUSH shifts array loads by one entry: loaded point index i actually refers to table point i-1, followed by delta (-23,-10). i==0 needs preceding-stack-slot verification.",
                         "transition_duration": scalar(m,0x50B827), "blink_interval": scalar(m,0x50CDE3)},
        "options": {"constructor": hx(0x510760), "setup": hx(0x5108E0), "vtable": hx(0x69B3CC), "slot": 1,
                    "controls": options, "slider_range": scalar(m,0x511075), "help_origin": [20,20],
                    "parent_coordinates": "ECX/EDI in setup is complete Options+4. Content container=display+0x1e4 (complete+0x1e8), default identity; panel=display+0x2e4 and controls are siblings, so do not add panel center (256,192) to control positions.",
                    "coordinate_caveat": "anchors are sprite positions, not necessarily visual centers; options atlas origins vary"},
        "font_metrics": {"registration": hx(0x4C55F0), "font_getters": {"width":"0x42a4e0", "height":"0x42a500", "line_height":"0x42a520", "spacing":"0x42a540", "glyph_offset":"0x42a550"},
                         "fonts": fonts, "menu_label_caveat": "primary menu button labels are pre-rendered atlas sprites, not TextField glyphs"},
        "help_hints": {"builder": hx(0x50FA10), "config": hx(0x50F9C0),
                       "formula": "x_i=anchor_x+previous_item_x+manager_0x228+current_gap; y_i=anchor_y; manager_0x228=current_gap; previous_item_x=0 for first item",
                       "gaps": {"enter_token_0x1b":scalar(m,0x50FD2D), "default":scalar(m,0x5100C1), "left_arrow":scalar(m,0x50FE12), "right_arrow":scalar(m,0x50FEB7), "up_key":scalar(m,0x50FFB4), "escape_key":scalar(m,0x51003C)},
                       "uncertainty": "item order and visibility depend on selected MenuObject/runtime help list; do not bake a fixed full row from constants alone"},
        "physics_followup": {"vascolet_exact_utf16": [m.string(v) for v in (0x68F8B8,0x692C90,0x69420C,0x694BF8)],
                             "primary_name_refs": [m.line(i) for i in m.refs(0x68F8B8)],
                             "integration": "0x4d4540: candidate acceleration step delta=GameSubject[+0x550]*dt*int[+0x55c]; reads caps +0x554/+0x558; numeric accelerations are not literals in this routine",
                             "init_numeric_data": [scalar(m,v) for v in (0x4D30D6,0x4D30EE)],
                             "uncertainty": "0.1 and 0.5 initialize +0x75c/+0x760/+0x764; update uses these as approach/time-scale controls, not proven gravity/jump speed"},
        "original_atlas_metadata": {name:atlas_assets(assets / rel) for name,rel in (
            ("menu","gui/menu/menu.xml"),("options","gui/options/options.xml"),("level","gui/level/level.xml"),("help","gui/menu/user-help-buttons.xml"))},
        "instruction_evidence": evidence,
        "uncertainties": ["Logical UI anchors do not establish 800x600 viewport scaling/letterboxing.",
                          "LevelSelect is a display subobject at complete-object+4; member offsets in setup/update are relative to that ECX, not the complete object.",
                          "Display setup slot-1 functions create scene objects; do not equate slot 1 with per-frame GPU drawing.",
                          "Chapter indicator array lookup has a pending PUSH; the main chapter-button table does not. Indicator delta is exact, effective index needs care."]}
    output = ROOT / "analysis" / "ui-layout.json"
    assert output.parent.is_dir()
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {output.relative_to(ROOT)}: {len(points)} chapter points, {len(main_rows)} menu rows, {len(options)} options controls, {len(fonts)} fonts")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--function", type=lambda v: int(v, 0))
    parser.add_argument("--from-va", type=lambda v: int(v, 0), default=0)
    parser.add_argument("--to-va", type=lambda v: int(v, 0), default=0xffffffff)
    parser.add_argument("--events", action="store_true", help="only calls, float operations, string and float-immediate references")
    parser.add_argument("--vtable")
    parser.add_argument("--strings")
    parser.add_argument("--match", help="filter disassembly by regex, with optional context")
    parser.add_argument("--context", type=int, default=0)
    parser.add_argument("--write-json", action="store_true", help="write validated focused findings and evidence to analysis/ui-layout.json")
    args = parser.parse_args()
    m = mapper()
    if args.write_json:
        write_json(m)
    if args.vtable:
        old = json.loads((ROOT / "tools" / "vtables.json").read_text())
        for table, _ in old.get(f".?AV{args.vtable}@@", []):
            va = int(table, 16)
            print(f"{args.vtable} {table}")
            for slot in range(40):
                target = m.u32(va + slot * 4)
                if not m.code(target):
                    break
                print(f"  slot {slot}: {hx(target)}")
            for ins in m.refs(va):
                print(m.line(ins), "enclosing", m.enclosing(ins.address))
    if args.strings:
        for encoding in ("utf-16-le", "cp1252"):
            needle = args.strings.encode(encoding)
            for found in re.finditer(re.escape(needle), m.data):
                va = m.va(found.start())
                if va is None:
                    continue
                print(json.dumps({"matched_va": hx(va), "raw_offset": hx(found.start()), "encoding": encoding,
                                  "string": m.string(va)}, ensure_ascii=True))
                for ins in m.refs(va)[:20]:
                    print(" ", m.line(ins), "enclosing", m.enclosing(ins.address))
    if args.function:
        summary = m.analyze(args.function)
        print(f"Function {hx(args.function)}: {summary['reachable_instruction_count']} reachable instructions, capped={summary['analysis_capped']}")
        instructions = function_instructions(m, args.function)
        matches = set()
        if args.match:
            for index, ins in enumerate(instructions):
                if re.search(args.match, m.line(ins)):
                    matches.update(range(max(0, index - args.context), min(len(instructions), index + args.context + 1)))
        for index, ins in enumerate(instructions):
            if not args.from_va <= ins.address < args.to_va:
                continue
            if args.match and index not in matches:
                continue
            notes = annotations(m, ins)
            if args.events and not (notes or ins.mnemonic.startswith("f") or ins.mnemonic == "call"):
                continue
            print(m.line(ins) + (" ; " + "; ".join(notes) if notes else ""))


if __name__ == "__main__":
    main()
