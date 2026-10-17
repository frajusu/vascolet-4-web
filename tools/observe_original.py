"""Bounded original-game observations using Win32 scan-code input.

Only captures the selected game's client area; never the rest of the desktop.
Usage: python tools/observe_original.py <plan.json> [output-directory]
"""
import ctypes as C
from ctypes import wintypes as W
import json
from pathlib import Path
import subprocess
import sys
import time
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
GAME = ROOT.parent / "Vascolet" / "vascolet4.exe"
U = C.WinDLL("user32", use_last_error=True)
G = C.WinDLL("gdi32", use_last_error=True)

class KEYBDINPUT(C.Structure):
    _fields_ = [("wVk", W.WORD), ("wScan", W.WORD), ("dwFlags", W.DWORD),
                ("time", W.DWORD), ("dwExtraInfo", C.c_size_t)]
class MOUSEINPUT(C.Structure):
    _fields_ = [("dx", W.LONG), ("dy", W.LONG), ("mouseData", W.DWORD),
                ("dwFlags", W.DWORD), ("time", W.DWORD), ("dwExtraInfo", C.c_size_t)]
class UNION(C.Union):
    _fields_ = [("ki", KEYBDINPUT), ("mi", MOUSEINPUT)]
class INPUT(C.Structure):
    _anonymous_ = ("u",)
    _fields_ = [("type", W.DWORD), ("u", UNION)]
U.SendInput.argtypes = [W.UINT, C.POINTER(INPUT), C.c_int]
U.GetForegroundWindow.restype = W.HWND
U.SetForegroundWindow.argtypes = [W.HWND]
U.ClientToScreen.argtypes = [W.HWND, C.POINTER(W.POINT)]
U.GetDC.argtypes = [W.HWND]; U.GetDC.restype = W.HDC
U.ReleaseDC.argtypes = [W.HWND, W.HDC]
G.CreateCompatibleDC.argtypes = [W.HDC]; G.CreateCompatibleDC.restype = W.HDC
G.CreateCompatibleBitmap.argtypes = [W.HDC, C.c_int, C.c_int]; G.CreateCompatibleBitmap.restype = W.HBITMAP
G.SelectObject.argtypes = [W.HDC, W.HANDLE]; G.SelectObject.restype = W.HANDLE
G.BitBlt.argtypes = [W.HDC, C.c_int, C.c_int, C.c_int, C.c_int, W.HDC, C.c_int, C.c_int, W.DWORD]
G.GetDIBits.argtypes = [W.HDC, W.HBITMAP, W.UINT, W.UINT, C.c_void_p, C.c_void_p, W.UINT]
G.DeleteObject.argtypes = [W.HANDLE]; G.DeleteDC.argtypes = [W.HDC]

def window_for_pid(pid):
    found = []
    callback_type = C.WINFUNCTYPE(W.BOOL, W.HWND, W.LPARAM)
    @callback_type
    def visit(hwnd, _):
        p = W.DWORD()
        U.GetWindowThreadProcessId(hwnd, C.byref(p))
        if p.value == pid and U.IsWindowVisible(hwnd): found.append(hwnd)
        return True
    U.EnumWindows(visit, 0)
    return found[0] if found else None

def send_key(scan, up=False):
    extended = 1 if scan in (0x48, 0x50, 0x4b, 0x4d) else 0
    event = INPUT(type=1, ki=KEYBDINPUT(wScan=scan, dwFlags=8 | extended | (2 if up else 0)))
    if U.SendInput(1, C.byref(event), C.sizeof(INPUT)) != 1:
        raise C.WinError(C.get_last_error())

def press(scan, duration=.2):
    send_key(scan)
    try: time.sleep(duration)
    finally: send_key(scan, True)
    time.sleep(.15)  # DirectInput polling must observe the released state between presses.

def capture(hwnd, filename):
    rect = W.RECT(); U.GetClientRect(hwnd, C.byref(rect))
    width, height = rect.right, rect.bottom
    dc = U.GetDC(hwnd); mem = G.CreateCompatibleDC(dc)
    bitmap = G.CreateCompatibleBitmap(dc, width, height)
    old = G.SelectObject(mem, bitmap)
    try:
        G.BitBlt(mem, 0, 0, width, height, dc, 0, 0, 0x00CC0020)
        G.SelectObject(mem, old)
        # BITMAPINFOHEADER + RGBQUAD slots; negative height requests top-down rows.
        header = C.create_string_buffer(40 + 1024)
        import struct
        struct.pack_into("<IiiHHIIiiII", header, 0, 40, width, -height, 1, 32, 0,
                         width * height * 4, 0, 0, 0, 0)
        bits = C.create_string_buffer(width * height * 4)
        rows = G.GetDIBits(mem, bitmap, 0, height, bits, header, 0)
        if not rows: raise C.WinError(C.get_last_error())
        Image.frombuffer("RGB", (width, height), bits, "raw", "BGRX", 0, 1).save(filename)
        print("CAPTURE", str(filename), width, height, flush=True)
    finally:
        G.DeleteObject(bitmap); G.DeleteDC(mem); U.ReleaseDC(hwnd, dc)

def main():
    plan = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    output = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else ROOT / "analysis" / "original"
    output.mkdir(parents=True, exist_ok=True)
    import hashlib
    (output / "run.json").write_text(json.dumps({"plan": plan, "executable": str(GAME),
      "sha256": hashlib.sha256(GAME.read_bytes()).hexdigest(), "started": time.strftime("%Y-%m-%dT%H:%M:%S")}, indent=2))
    proc = subprocess.Popen([str(GAME)], cwd=GAME.parent)
    try:
        hwnd = None
        deadline = time.monotonic() + 25
        while not hwnd and proc.poll() is None and time.monotonic() < deadline:
            time.sleep(.5)
            hwnd = window_for_pid(proc.pid)
        if not hwnd: raise RuntimeError(f"No original window; process exit={proc.poll()}")
        U.SetForegroundWindow(hwnd)
        time.sleep(4)
        for step in plan["steps"]:
            hwnd = window_for_pid(proc.pid) or hwnd
            U.ShowWindow(hwnd, 9)
            U.SetForegroundWindow(hwnd)
            time.sleep(.15)
            if "wait" in step: time.sleep(min(10, step["wait"]))
            if "click" in step:
                if U.GetForegroundWindow() != hwnd: raise RuntimeError("Original is not focused")
                point = W.POINT(*step["click"])
                U.ClientToScreen(hwnd, C.byref(point))
                U.SetCursorPos(point.x, point.y)
                time.sleep(.2)
                event = INPUT(type=0, mi=MOUSEINPUT(dwFlags=2))
                U.SendInput(1, C.byref(event), C.sizeof(INPUT)); time.sleep(.15)
                event.mi.dwFlags = 4
                U.SendInput(1, C.byref(event), C.sizeof(INPUT)); time.sleep(.2)
            if "record" in step:
                if U.GetForegroundWindow() != hwnd:
                    raise RuntimeError(f"Original lost focus ({hwnd} != {U.GetForegroundWindow()}); refusing to send gameplay input")
                scans = step.get("keys", [])
                used = set(scans)
                start = time.perf_counter()
                samples = []
                try:
                    for scan in scans: send_key(scan)
                    count = min(120, step.get("frames", 30))
                    interval = max(.04, step.get("interval", .1))
                    for i in range(count):
                        time.sleep(max(0, start + i * interval - time.perf_counter()))
                        for event in step.get("events", []):
                            if event["frame"] != i: continue
                            for scan in event.get("up", []): send_key(scan, True)
                            for scan in event.get("down", []): send_key(scan); used.add(scan)
                        samples.append({"frame": i, "seconds": time.perf_counter() - start})
                        capture(hwnd, output / f"{step['record']}-{i:03d}.png")
                        if i == step.get("releaseAt", -1):
                            for scan in scans: send_key(scan, True)
                finally:
                    for scan in used: send_key(scan, True)
                (output / f"{step['record']}-times.json").write_text(json.dumps(samples))
            if "scan" in step: press(step["scan"], min(2, step.get("hold", .2)))
            if "shot" in step: capture(hwnd, output / (step["shot"] + ".png"))
    finally:
        proc.terminate()
        try: proc.wait(timeout=4)
        except subprocess.TimeoutExpired: proc.kill()

if __name__ == "__main__": main()
