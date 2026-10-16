"""Unwrap retained REA MCP results without losing the original Evidence JSON."""
import json
from pathlib import Path
import sys

def unwrap(path):
    envelope = json.loads(path.read_text(encoding="utf-8"))
    result = envelope.get("result", envelope)
    if "structuredContent" in result:
        return result["structuredContent"]
    text = next((x["text"] for x in result.get("content", []) if x.get("type") == "text"), "{}")
    try: return json.loads(text)
    except ValueError: return {"text": text}

for arg in sys.argv[1:]:
    p = Path(arg)
    data = unwrap(p)
    target = p.with_suffix(".readable.json")
    target.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    diagnostic = data.get("error", {}).get("details", {}).get("diagnostics", {})
    if "stdout" in diagnostic:
        p.with_suffix(".ghidra.log").write_text(diagnostic["stdout"].get("text", ""), encoding="utf-8")
    print(str(target))
