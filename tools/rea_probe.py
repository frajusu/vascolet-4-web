"""Run a bounded, reusable-in-one-batch REA MCP session; retain complete results.

Usage: python tools/rea_probe.py analysis/plan.json
No target execution. One Node + Ghidra session, heap bounded, CPU affinity bounded.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import queue
import time

ROOT = Path(__file__).resolve().parents[1]
REA = Path(r"C:\Users\faust\AppData\Local\npm-cache\_npx\ad9a3fdbcad992c6\node_modules\rea-agents\scripts\rea.mjs")
NODE = Path(r"C:\Users\faust\AppData\Local\npm-cache\_npx\6d82ddbdd7da268b\node_modules\node\bin\node.exe")
ENV = dict(os.environ, GHIDRA_INSTALL_DIR=r"C:\Users\faust\Downloads\ghidra_12.1.4_PUBLIC_20260921",
           REA_ANALYSIS_PROVIDER="ghidra", GHIDRA_HEADLESS_MAXMEM="768M",
           REA_GHIDRA_STARTUP_TIMEOUT_MS="480000",
           REA_GHIDRA_DISABLED_ANALYZERS="WindowsResourceReference",
           NODE_OPTIONS="--max-old-space-size=384")

def main():
    plan = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    if plan.get("seed_file"):
        ENV["REA_GHIDRA_SEED_FILE"] = str(ROOT / plan["seed_file"])
    if plan.get("disabled_analyzers"):
        ENV["REA_GHIDRA_DISABLED_ANALYZERS"] = ",".join(plan["disabled_analyzers"])
    output = ROOT / "analysis" / plan.get("name", "probe")
    output.mkdir(parents=True, exist_ok=True)
    proc = subprocess.Popen([str(NODE), str(REA), "mcp"], stdin=subprocess.PIPE,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=ENV, text=True,
        encoding="utf-8", bufsize=1)
    if sys.platform == "win32":
        import ctypes
        # Inherited by REA's owned child Job Object; keep work on two logical CPUs.
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.SetProcessAffinityMask.argtypes = [ctypes.c_void_p, ctypes.c_size_t]
        kernel.SetProcessAffinityMask(ctypes.c_void_p(int(proc._handle)), 3)
    lines = queue.Queue()
    threading.Thread(target=lambda: [lines.put(x) for x in proc.stdout], daemon=True).start()
    def errors():
        with (output / "server.stderr.log").open("w", encoding="utf-8") as log:
            for line in proc.stderr:
                log.write(line); log.flush()
    threading.Thread(target=errors, daemon=True).start()
    seq = 0
    def call(method, params, timeout=510):
        nonlocal seq
        seq += 1
        proc.stdin.write(json.dumps(dict(jsonrpc="2.0", id=seq, method=method, params=params)) + "\n")
        proc.stdin.flush()
        until = time.monotonic() + timeout
        while time.monotonic() < until:
            try:
                line = lines.get(timeout=min(2, max(.1, until - time.monotonic())))
            except queue.Empty:
                if proc.poll() is not None:
                    raise RuntimeError(f"REA exited {proc.returncode}; see stderr log")
                continue
            try: data = json.loads(line)
            except ValueError: continue
            if data.get("id") == seq: return data
        raise TimeoutError(f"REA {method} exceeded {timeout}s")
    try:
        print(json.dumps(call("initialize", dict(protocolVersion="2024-11-05", capabilities={}, clientInfo=dict(name="vascolet-research", version="1")))), flush=True)
        proc.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n'); proc.stdin.flush()
        tools = call("tools/list", {})
        (output / "tools.json").write_text(json.dumps(tools, indent=2), encoding="utf-8")
        print("REA tools:", ", ".join(t["name"] for t in tools.get("result", {}).get("tools", [])), flush=True)
        n = 0
        def run_steps(steps):
            nonlocal n
            for step in steps:
                print("CALL", step["name"], step.get("arguments", {}), flush=True)
                result = call("tools/call", step)
                dest = output / f'{n:02d}-{step["name"]}.json'
                n += 1
                dest.write_text(json.dumps(result, indent=2), encoding="utf-8")
                payload = result.get("result", {})
                content = payload.get("structuredContent")
                if content is None:
                    try: content = json.loads(payload["content"][0]["text"])
                    except (KeyError, IndexError, ValueError): content = {}
                dest.with_suffix(".readable.json").write_text(json.dumps(content, ensure_ascii=False, indent=2), encoding="utf-8")
                print("SAVED", dest.name, json.dumps(result, ensure_ascii=False)[:1800], flush=True)
                if content.get("error", {}).get("code") == "provider_timeout":
                    raise TimeoutError("Stop session after first provider timeout; do not repeat cold imports")
        run_steps(plan.get("steps", []))
        if plan.get("inbox"):
            inbox = ROOT / plan["inbox"]
            inbox.mkdir(parents=True, exist_ok=True)
            consumed = set()
            idle_until = time.monotonic() + 2700
            while time.monotonic() < idle_until and not (inbox / "STOP").exists():
                for item in sorted(inbox.glob("*.json")):
                    if item.name not in consumed:
                        request = json.loads(item.read_text(encoding="utf-8"))
                        run_steps(request["steps"])
                        consumed.add(item.name)
                        idle_until = time.monotonic() + 2700
                time.sleep(1)
    finally:
        try:
            print("CLOSE", json.dumps(call("tools/call", dict(name="close_binary", arguments={}), timeout=45))[:300], flush=True)
        except Exception as err: print("close:", err, flush=True)
        try: proc.stdin.close()
        except OSError: pass
        try: proc.wait(timeout=15)
        except subprocess.TimeoutExpired: proc.terminate()

if __name__ == "__main__": main()
