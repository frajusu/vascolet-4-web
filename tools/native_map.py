"""Bounded, static PE32/RTTI mapper; never loads or executes the target.

Run: python tools/native_map.py
Inspect one entry: python tools/native_map.py --inspect 0xADDRESS
Requires pefile and capstone. All reported code/data pointers are preferred VAs.
The curated semantic shortlist is specific to this Vascolet executable version.
"""
from __future__ import annotations

import argparse
import bisect
import hashlib
import json
import math
import re
import struct
from collections import defaultdict
from pathlib import Path

import pefile
from capstone import Cs, CS_ARCH_X86, CS_MODE_32, CS_AC_READ
from capstone.x86_const import X86_OP_IMM, X86_OP_MEM

ROOT = Path(__file__).resolve().parents[1]
CLASSES = (
    "MainMenuState", "LevelSelect", "MenuObject", "MenuButton",
    "AnimationPlayer", "SpriteAnim", "InfoState", "Hud",
    "CharacterPhysicsEntity", "GameSubject",
)

# Semantic labels are deliberately candidates; facts quote observed instructions.
PICKS = (
    (0x436D90, "AnimationPlayer frame/time advance", "Called by slot 3. Increments/decrements [this+0x1e0], compares count +0x1dc and loop sentinel -1; flags +0x220/+0x221, elapsed +0x224, duration +0x228."),
    (0x436F50, "AnimationPlayer current-frame duration", "Called by 0x436d90; divides integer [frame+4] by [animation+0], stores float at +0x228. 0x69ca20 is the 2^32 unsigned-to-float correction, not a frame-time constant. Uses EDI as the object register."),
    (0x436D20, "AnimationPlayer update wrapper (slot 3)", "Checks animation +0x1d8, passes dt with AL=1 to 0x436d90, then copies current frame+0x10 to object+0x204 via 0x4372e0."),
    (0x439590, "SpriteAnim render/frame synchronization (slot 1)", "Reads linked AnimationPlayer at +0x100 and its frame index +0x1e0; propagates frame transforms/visibility into sprite children, calls 0x529560, returns with ret 0xc. Rendering-stage candidate; no direct GPU draw proven here."),
    (0x436C10, "AnimationPlayer constructor", "Calls base initializer 0x5188f0, writes vptr 0x688a1c, zeros animation pointer +0x1d8, initializes +0x1e8 and +0x204."),
    (0x50AB90, "MenuObject constructor", "Writes vptr 0x69aa44; +0x1d8=0, +0x1d9=1, +0x1dc=2, +0x1e0=0."),
    (0x50EED0, "MenuButton constructor", "Writes primary vptr 0x69afd4 and mouse-listener vptr 0x69b038 at +0x1e4; +0x1dc=2; clears +0x1e8/+0x1ec/+0x314/+0x318."),
    (0x50EE60, "MenuButton input/update (slot 3)", "Tests +0x1d8/+0x1d9, callback +0x314, input token 0x1b, state +0x264==1, debounce byte +0x318."),
    (0x50F030, "MenuButton state/visual selection (slot 19)", "Writes byte +0x1d8, optional callback and 0x510200; chooses +0x1e8 versus +0x1ec and calls 0x5253b0 on embedded object +0x1f0."),
    (0x50D9B0, "MainMenuState constructor/menu assembly", "Writes vptrs 0x69af34/+0, 0x69af64/+4, 0x69afb4/+0x1dc, 0x69afc0/+0x204, 0x69afcc/+0x208; directly references jugar/opciones/ayuda button names. Factory at 0x50d940 allocates 0x658 bytes and calls this entry."),
    (0x50EA40, "MainMenuState update (secondary vtable slot 3)", "Calls inherited child update 0x518b70; tests +0x648; input token 0; allocates 0x43c and calls 0x512810. ECX is the +4 display subobject."),
    (0x50B490, "LevelSelect constructor", "Installs LevelSelect RTTI vptrs 0x69adc0, 0x69adcc, 0x69ae1c. Prefer over 5303-byte slot-1 setup when first querying pseudocode."),
    (0x50CA90, "LevelSelect update (secondary vtable slot 3)", "Direct UTF-16 asset and level-label references; bounded 1296-byte candidate, substantially smaller than slot-1 UI setup."),
    (0x4D2930, "InfoState update (secondary vtable slot 3)", "Calls 0x518b70, queries input token 0x38; computes ([this+0x330]+3) modulo [this+0x334], stores remainder, calls 0x4d2980 with this-4."),
    (0x513D70, "Hud constructor", "Writes Hud vptr 0x69b6c4; initializes embedded HUD display objects. Constructor candidate distinct from destructor 0x513f20."),
    (0x514170, "Hud display/setup (slot 1)", "Direct UTF-16 HUD heart/counter references; 4004-byte UI setup/display candidate. Semantic draw-versus-setup remains inferred."),
    (0x515120, "Hud input/update (slot 3)", "Gated on byte +0x1364; indirect input checks; clears global object byte +0xfd and local +0x1364, calls 0x530f50."),
    (0x515180, "Hud refresh/status pass (slot 5)", "Direct lives/coin/key string references; useful counter-state logic candidate rather than constructor/destructor."),
    (0x4F9AE0, "CharacterPhysicsEntity boolean predicate (slot 2)", "27-instruction predicate; virtual slot-1 query on argument, byte +0x11, signed comparisons and [arg+0xc]*[arg+4]; ret 0x14. Collision/filter interpretation is inferred."),
    (0x4D3D60, "GameSubject update (slot 3)", "Direct references to player, Invinsibility, InvinsibilityTime, Apply anim-displacement: . Good animation/physics integration follow-up; 2013 inferred span bytes."),
)


def hx(value):
    return f"0x{value:08x}"


class NativeMap:
    def __init__(self, exe, index_path):
        self.exe = Path(exe)
        self.data = self.exe.read_bytes()
        self.pe = pefile.PE(data=self.data, fast_load=True)
        self.base = self.pe.OPTIONAL_HEADER.ImageBase
        if self.pe.FILE_HEADER.Machine != 0x14C:
            raise ValueError("This mapper expects x86 PE32")
        self.sections = list(self.pe.sections)
        self.text = next(s for s in self.sections if s.Name.rstrip(b"\0") == b".text")
        self.lo = self.base + self.text.VirtualAddress
        self.hi = self.lo + self.text.Misc_VirtualSize
        self.md = Cs(CS_ARCH_X86, CS_MODE_32)
        self.md.detail = True
        self.index = {int(k): sorted(set(v)) for k, v in json.loads(index_path.read_text()).items()}
        self.starts = {}
        code = self.text.get_data()
        # These are clues, not authoritative procedure boundaries.
        for m in re.finditer(rb"\x55\x8b\xec", code):
            self.starts[self.lo + m.start()] = "inferred MSVC frame prologue"
        for m in re.finditer(rb"\xcc{2,}([^\xcc])", code):
            self.starts[self.lo + m.end() - 1] = "inferred entry after INT3 padding"
        # Many optimized procedures have neither EBP frames nor INT3 padding.
        # Reuse only verified direct CALL targets from the existing index.
        for target in self.index:
            if self.code(target):
                for ins in self.refs(target):
                    if ins.mnemonic == "call" and ins.operands[0].type == X86_OP_IMM:
                        self.starts[target] = "inferred procedure entry from verified direct CALL target"
                        break
        self.cache = {}
        self.disassembly = {}

    def offset(self, va):
        rva = va - self.base
        for s in self.sections:
            delta = rva - s.VirtualAddress
            if 0 <= delta < s.SizeOfRawData:
                return s.PointerToRawData + delta
        return None

    def va(self, offset):
        for s in self.sections:
            delta = offset - s.PointerToRawData
            if 0 <= delta < s.SizeOfRawData:
                return self.base + s.VirtualAddress + delta
        return None

    def u32(self, va):
        off = self.offset(va)
        return struct.unpack_from("<I", self.data, off)[0] if off is not None and off + 4 <= len(self.data) else None

    def code(self, va):
        return va is not None and self.lo <= va < self.hi

    def instruction(self, va):
        off = self.offset(va)
        return next(self.md.disasm(self.data[off:off + 15], va, count=1), None) if off is not None else None

    def line(self, ins):
        return f"{hx(ins.address)}: {ins.mnemonic} {ins.op_str}".rstrip()

    def string(self, va):
        off = self.offset(va)
        if off is None or self.code(va):
            return None
        raw = self.data[off:off + 512]
        # Check UTF-16 independently and convert its FILE OFFSET through sections.
        # Adding ImageBase to a raw offset would give the wrong pointer.
        wide = re.match(rb"(?:[\x20-\x7e\xa0-\xff]\x00){3,}\x00\x00", raw)
        narrow = re.match(rb"[\x20-\x7e]{4,}\x00", raw)
        if wide:
            text, encoding = wide[0][:-2].decode("utf-16-le"), "utf-16-le"
        elif narrow and not self.code(self.u32(va)):
            text, encoding = narrow[0][:-1].decode("cp1252", errors="replace"), "cp1252"
        else:
            return None
        return {"va": hx(va), "file_offset": hx(off), "encoding": encoding, "text": text}

    def refs(self, value):
        # Existing index omitted absolute [disp32] loads. Indexed references are
        # re-decoded and verified; bounded function analysis also reads those loads.
        result = []
        for va in self.index.get(value, []):
            ins = self.instruction(va)
            if ins and any((op.type == X86_OP_IMM and op.imm & 0xffffffff == value) or
                           (op.type == X86_OP_MEM and op.mem.disp & 0xffffffff == value)
                           for op in ins.operands):
                result.append(ins)
        return result

    def recover_tables(self, old):
        tables = defaultdict(dict)
        for name in CLASSES:
            decorated = f".?AV{name}@@"
            for address, count in old.get(decorated, []):
                tables[name][int(address, 16)] = {"source": "legacy table, revalidated", "legacy_count": count}
            # Recover through TypeDescriptor -> CompleteObjectLocator -> vftable[-1].
            needle = decorated.encode() + b"\0"
            for match in re.finditer(re.escape(needle), self.data):
                td = self.va(match.start() - 8)
                if td is None:
                    continue
                for ref in re.finditer(re.escape(struct.pack("<I", td)), self.data):
                    col = self.va(ref.start() - 12)
                    if col is None or self.u32(col) != 0 or self.u32(col + 12) != td:
                        continue
                    # A COL's object offset is small; reject base-class descriptors.
                    if (self.u32(col + 4) or 0) > 0x10000:
                        continue
                    for cref in re.finditer(re.escape(struct.pack("<I", col)), self.data):
                        table = self.va(cref.start() + 4)
                        if table and self.code(self.u32(table)):
                            tables[name].setdefault(table, {"source": "recovered RTTI COL chain"})
        result = {}
        for name in CLASSES:
            result[name] = []
            for table, metadata in sorted(tables[name].items()):
                col = self.u32(table - 4)
                td = self.u32(col + 12)
                td_offset = self.offset(td) if td is not None else None
                expected = f".?AV{name}@@".encode() + b"\0"
                rtti_verified = td_offset is not None and self.data[td_offset + 8:td_offset + 8 + len(expected)] == expected
                if not rtti_verified:
                    raise ValueError(f"RTTI class mismatch at {hx(table)} for {name}")
                entries = []
                boundary = "first non-.text pointer"
                # The listed table address IS slot zero; no initial +4.
                for slot in range(160):
                    off = self.offset(table + 4 * slot)
                    if off is not None and re.match(rb"(?:[\x20-\x7e]\x00){4,}\x00\x00", self.data[off:off + 512]):
                        boundary = "following UTF-16 string (its character pairs would masquerade as .text pointers)"
                        break
                    fn = self.u32(table + 4 * slot)
                    if not self.code(fn):
                        break
                    self.starts[fn] = "exact vtable function pointer"
                    entries.append({"slot": slot, "byte_offset": hx(slot * 4), "function_va": hx(fn)})
                installs = []
                for ins in self.refs(table):
                    if ins.mnemonic == "mov" and ins.operands[0].type == X86_OP_MEM:
                        installs.append({"instruction_va": hx(ins.address), "instruction": self.line(ins)})
                result[name].append({**metadata, "va": hx(table), "col_va": hx(col),
                                     "type_descriptor_va": hx(td), "decorated_type": expected[:-1].decode(),
                                     "rtti_class_verified": rtti_verified,
                                     "object_offset": self.u32(col + 4), "slot_count": len(entries),
                                     "count_boundary": boundary, "slots": entries, "vptr_writes": installs})
        self.sorted_starts = sorted(self.starts)
        return result

    def enclosing(self, va):
        pos = bisect.bisect_right(self.sorted_starts, va) - 1
        if pos < 0 or va - self.sorted_starts[pos] > 0x8000:
            return None
        start = self.sorted_starts[pos]
        return {"va": hx(start), "basis": self.starts[start], "inferred": start != va}

    def analyze(self, start, max_bytes=0x6000, max_instructions=2400):
        if start in self.cache:
            return self.cache[start]
        todo, seen, instructions, external = [start], set(), {}, set()
        truncated = False
        while todo:
            address = todo.pop()
            while address not in seen:
                if not start <= address < min(start + max_bytes, self.hi) or len(seen) >= max_instructions:
                    external.add(address)
                    truncated = True
                    break
                # Do not absorb a different known vtable entry on fall-through.
                if address != start and self.starts.get(address) == "exact vtable function pointer":
                    external.add(address)
                    break
                ins = self.instruction(address)
                if ins is None or ins.mnemonic in ("int3", "ud2"):
                    break
                seen.add(address)
                instructions[address] = ins
                next_va = address + ins.size
                if ins.mnemonic.startswith("ret"):
                    break
                if ins.mnemonic.startswith("j") or ins.mnemonic.startswith("loop"):
                    target = ins.operands[0].imm & 0xffffffff if ins.operands[0].type == X86_OP_IMM else None
                    if target is not None:
                        if start <= target < start + max_bytes:
                            todo.append(target)
                        else:
                            external.add(target)
                    if ins.mnemonic == "jmp":
                        break
                address = next_va
        ordered = [instructions[k] for k in sorted(instructions)]
        self.disassembly[start] = [self.line(i) for i in ordered]
        strings, calls, constants, floats, writes = [], [], [], [], []
        seen_strings = set()
        for ins in ordered:
            if ins.mnemonic == "call":
                target = ins.operands[0].imm & 0xffffffff if ins.operands[0].type == X86_OP_IMM else None
                calls.append({"at": hx(ins.address), "target": hx(target) if target is not None else ins.op_str})
            for op in ins.operands:
                value = op.imm & 0xffffffff if op.type == X86_OP_IMM else op.mem.disp & 0xffffffff if op.type == X86_OP_MEM else None
                if value is None:
                    continue
                if not ins.mnemonic.startswith(("j", "call", "ret")):
                    text = self.string(value)
                    if text and value not in seen_strings:
                        strings.append({"at": hx(ins.address), **text})
                        seen_strings.add(value)
                    if op.type == X86_OP_IMM:
                        constants.append({"at": hx(ins.address), "value": hx(value), "instruction": self.line(ins)})
                if op.type == X86_OP_MEM and op.mem.base == 0 and op.mem.index == 0 and op.access & CS_AC_READ:
                    offset = self.offset(value)
                    section = self.pe.get_section_by_rva(value - self.base) if value >= self.base else None
                    if offset is not None and section and not section.Characteristics & 0x80000000 and (ins.mnemonic.startswith("f") or ins.mnemonic.endswith(("ss", "sd"))):
                        size = 8 if op.size == 8 else 4
                        fmt = ("<q" if size == 8 else "<i") if ins.mnemonic == "fild" else ("<d" if size == 8 else "<f")
                        number = struct.unpack_from(fmt, self.data, offset)[0]
                        if math.isfinite(number) and abs(number) < 1e20:
                            floats.append({"at": hx(ins.address), "data_va": hx(value), "value": number,
                                           "width": size, "instruction": self.line(ins)})
            if ins.mnemonic == "mov" and len(ins.operands) == 2 and ins.operands[0].type == X86_OP_MEM and ins.operands[1].type == X86_OP_IMM:
                writes.append(self.line(ins))
        end = max((i.address + i.size for i in ordered), default=start)
        result = {"va": hx(start), "entry_basis": self.starts.get(start, "explicit requested entry"),
                  "bounds": "inferred bounded CFG; not symbol/debug procedure bounds",
                  "span_bytes": end - start, "reachable_instruction_count": len(ordered),
                  "reachable_bytes": sum(i.size for i in ordered), "analysis_capped": truncated,
                  "end_exclusive_inferred": hx(end), "external_branches": [hx(x) for x in sorted(external)],
                  "strings": strings, "float_constants": floats, "immediates": constants[:180],
                  "immediates_capped": len(constants) > 180, "calls": calls[:100],
                  "vptr_or_constant_writes": writes[:40],
                  "entry_disassembly": [self.line(i) for i in ordered[:16]],
                  "return_disassembly": [self.line(i) for i in ordered if i.mnemonic.startswith("ret")]}
        self.cache[start] = result
        return result


def make_report(mapper, tables):
    associations = defaultdict(list)
    for name, items in tables.items():
        for table in items:
            for slot in table["slots"]:
                associations[int(slot["function_va"], 16)].append(f"{name} {table['va']} slot {slot['slot']}")
            for write in table["vptr_writes"]:
                containing = mapper.enclosing(int(write["instruction_va"], 16))
                write["enclosing_candidate"] = containing
                if containing:
                    associations[int(containing["va"], 16)].append(f"{name} vptr writer at {write['instruction_va']} (constructor/destructor candidate)")
    for address, label, rationale in PICKS:
        associations[address].append(label + " (semantic candidate)")
    functions = {}
    for address, uses in sorted(associations.items()):
        summary = mapper.analyze(address)
        summary["associations"] = uses
        functions[hx(address)] = summary
    shortlist = [{"va": hx(address), "label_inferred": label, "rationale": rationale,
                  "span_bytes_inferred": functions[hx(address)]["span_bytes"],
                  "reachable_instruction_count": functions[hx(address)]["reachable_instruction_count"]}
                 for address, label, rationale in PICKS]
    validations = {"slot_pointer_checks": 0, "string_offset_roundtrips": 0, "vptr_writer_cfg_checks": 0,
                   "unconfirmed_vptr_enclosing_candidates": []}
    for items in tables.values():
        for table in items:
            for slot in table["slots"]:
                assert mapper.u32(int(table["va"], 16) + 4 * slot["slot"]) == int(slot["function_va"], 16)
                validations["slot_pointer_checks"] += 1
            for write in table["vptr_writes"]:
                containing = write["enclosing_candidate"]
                if containing:
                    start = int(containing["va"], 16)
                    found = any(line.startswith(write["instruction_va"] + ":") for line in mapper.disassembly[start])
                    write["enclosing_cfg_contains_write"] = found
                    validations["vptr_writer_cfg_checks"] += 1
                    if not found:
                        validations["unconfirmed_vptr_enclosing_candidates"].append(write)
    for fn in functions.values():
        for string in fn["strings"]:
            offset, va = int(string["file_offset"], 16), int(string["va"], 16)
            assert mapper.va(offset) == va and mapper.offset(va) == offset
            encoded = string["text"].encode(string["encoding"], errors="replace")
            assert mapper.data[offset:offset + len(encoded)] == encoded
            validations["string_offset_roundtrips"] += 1
    return {"binary": str(mapper.exe), "sha256": hashlib.sha256(mapper.data).hexdigest(),
            "image_base": hx(mapper.base), "address_convention": "preferred virtual addresses, not file offsets; slots are zero-based",
            "method": ["Read-only pefile + bounded Capstone static disassembly; original is never executed.",
                       "Legacy table addresses are slot zero. Counts stop at first non-.text pointer OR following UTF-16 text masquerading as code pointers.",
                       "RTTI recovery validates x86 CompleteObjectLocator and TypeDescriptor chains.",
                       "UTF-16 and narrow string pointers use section-aware raw-file-offset to VA conversion.",
                       "Existing immediate index is revalidated; it omits absolute memory loads, inspected inside candidate functions.",
                       "Vtable entries are exact; semantic names and procedure bounds are inferred. Vptr writes can be constructors OR destructors.",
                       "CFG follows conditional branches, stops at returns/indirect jumps; large functions are capped. No whole-binary instruction dump."],
            "validation": validations, "shortlist": shortlist, "classes": tables, "functions": functions}


def markdown(report):
    lines = ["# Native address map", "", f"Binary SHA-256: `{report['sha256']}`", "",
             "Preferred VAs; zero-based slots. All semantic labels and function ends are inferred.", "",
             "## Vtables", "", "| Class | Vtable | Object offset | Corrected slots | Legacy count |", "|---|---|---:|---:|---:|"]
    for name, tables in report["classes"].items():
        for table in tables:
            lines.append(f"| {name} | `{table['va']}` | {table['object_offset']} | {table['slot_count']} | {table.get('legacy_count', 'recovered')} |")
        if not tables:
            lines.append(f"| {name} | unrecovered | | | |")
    lines += ["", "SpriteAnim is **12 slots**, not legacy 16 or naive corrected 17: following UTF-16 text creates false code pointers including `0x00490046`. Do not query those as procedures.",
              "", "## Prioritized pseudocode queries", "", "Labels and span sizes are inferred; vtable slot pointers are exact. Start with the small animation helpers and MenuButton constructor.",
              "", "| VA | Candidate | Instructions / span bytes | Evidence |", "|---|---|---:|---|"]
    for pick in report["shortlist"]:
        fn = report["functions"][pick["va"]]
        lines.append(f"| `{pick['va']}` | {pick['label_inferred']} | {fn['reachable_instruction_count']} / {fn['span_bytes']} | {pick['rationale']} |")
    lines += ["", "## Exact referenced strings and numeric data", "", "String VAs below are section-converted, never ImageBase + raw file offset. Full evidence is in `native-map.json`.", ""]
    for pick in report["shortlist"]:
        fn = report["functions"][pick["va"]]
        evidence = [f"`{s['text']}` @ `{s['va']}` (raw `{s['file_offset']}`, {s['encoding']}; instruction `{s['at']}`)" for s in fn["strings"][:8]]
        evidence += [f"{s['value']!r} @ `{s['data_va']}` (instruction `{s['at']}`)" for s in fn["float_constants"][:5]]
        if evidence:
            lines.append(f"- `{pick['va']}`: " + "; ".join(evidence) + ".")
    lines += ["", "## Reuse", "", "```powershell", "python tools/native_map.py", "python tools/native_map.py --class-name AnimationPlayer", "python tools/native_map.py --inspect 0x436d90 --instructions 160", "```", "",
              "## Validation", "", f"Checked {report['validation']['slot_pointer_checks']} raw slot pointers, {report['validation']['string_offset_roundtrips']} string raw-offset/VA round trips, and {report['validation']['vptr_writer_cfg_checks']} vptr-writer CFG memberships.",
              f"Unconfirmed enclosing candidates: {len(report['validation']['unconfirmed_vptr_enclosing_candidates'])}."]
    lines += ["", "## Method and limits", ""] + [f"- {item}" for item in report["method"]]
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exe", type=Path, default=ROOT.parent / "Vascolet" / "vascolet4.exe")
    parser.add_argument("--inspect", type=lambda x: int(x, 0), help="print one bounded function summary; does not rewrite reports")
    parser.add_argument("--instructions", type=int, default=0, help="with --inspect, print up to this many reachable instructions instead of JSON")
    parser.add_argument("--class-name", choices=CLASSES, help="print only a class's exact slots and vptr writers")
    args = parser.parse_args()
    mapper = NativeMap(args.exe, ROOT / "tools" / "imm_index.json")
    tables = mapper.recover_tables(json.loads((ROOT / "tools" / "vtables.json").read_text()))
    if args.class_name:
        for table in tables[args.class_name]:
            print(f"{args.class_name} {table['va']} object+{table['object_offset']:#x}")
            for slot in table["slots"]:
                va = int(slot["function_va"], 16)
                ins = mapper.instruction(va)
                print(f"  slot {slot['slot']:2}: {slot['function_va']}  {mapper.line(ins) if ins else '?'}")
            for write in table["vptr_writes"]:
                print(f"  {write['instruction']}  enclosing={mapper.enclosing(int(write['instruction_va'], 16))}")
        return
    if args.inspect:
        summary = mapper.analyze(args.inspect)
        if args.instructions:
            print("\n".join(mapper.disassembly[args.inspect][:args.instructions]))
        else:
            print(json.dumps(summary, ensure_ascii=True, indent=2))
        return
    report = make_report(mapper, tables)
    output = ROOT / "analysis"
    if not output.is_dir():
        raise FileNotFoundError(output)
    (output / "native-map.json").write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    (output / "native-map.md").write_text(markdown(report), encoding="utf-8")
    print(f"Wrote analysis/native-map.json and analysis/native-map.md: {sum(map(len, tables.values()))} vtables, {len(report['functions'])} functions, {len(report['shortlist'])} prioritized candidates")
    print(json.dumps(report["validation"]))


if __name__ == "__main__":
    main()
