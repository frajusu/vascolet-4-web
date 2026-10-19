"""Invisible native-game runner: private desktop, private input, backbuffer capture.

Never selects a desktop, uses the host keyboard/cursor, or activates a host window.
The child is put in a kill-on-close Job Object and runs below normal CPU priority.
"""
import ctypes as C
from ctypes import wintypes as W
import mmap
import os
from pathlib import Path
import struct
import time
import uuid
from PIL import Image

SIZE = 320 + 4 * 1024 * 1024
U = C.WinDLL("user32", use_last_error=True)
K = C.WinDLL("kernel32", use_last_error=True)

class Startup(C.Structure):
    _fields_ = [("cb", W.DWORD), ("reserved", W.LPWSTR), ("desktop", W.LPWSTR), ("title", W.LPWSTR),
        ("x", W.DWORD), ("y", W.DWORD), ("xs", W.DWORD), ("ys", W.DWORD), ("cols", W.DWORD), ("rows", W.DWORD),
        ("fill", W.DWORD), ("flags", W.DWORD), ("show", W.WORD), ("reserved2", W.WORD), ("reservedPtr", C.c_void_p),
        ("stdin", W.HANDLE), ("stdout", W.HANDLE), ("stderr", W.HANDLE)]

class Process(C.Structure):
    _fields_ = [("handle", W.HANDLE), ("thread", W.HANDLE), ("pid", W.DWORD), ("tid", W.DWORD)]

class BasicLimits(C.Structure):
    _fields_ = [("processTime", C.c_int64), ("jobTime", C.c_int64), ("flags", W.DWORD),
        ("minWorking", C.c_size_t), ("maxWorking", C.c_size_t), ("processCount", W.DWORD),
        ("affinity", C.c_size_t), ("priority", W.DWORD), ("scheduling", W.DWORD)]

class ExtendedLimits(C.Structure):
    _fields_ = [("basic", BasicLimits), ("io", C.c_uint64 * 6), ("processMemory", C.c_size_t),
        ("jobMemory", C.c_size_t), ("peakProcess", C.c_size_t), ("peakJob", C.c_size_t)]

U.CreateDesktopW.argtypes = [W.LPCWSTR, C.c_void_p, C.c_void_p, W.DWORD, W.DWORD, C.c_void_p]
U.CreateDesktopW.restype = W.HANDLE
U.CloseDesktop.argtypes = [W.HANDLE]
U.OpenInputDesktop.argtypes = [W.DWORD, W.BOOL, W.DWORD]; U.OpenInputDesktop.restype = W.HANDLE
U.GetUserObjectInformationW.argtypes = [W.HANDLE, C.c_int, C.c_void_p, W.DWORD, C.POINTER(W.DWORD)]
U.PostMessageW.argtypes = [W.HWND, W.UINT, W.WPARAM, W.LPARAM]
K.CreateProcessW.argtypes = [W.LPCWSTR, W.LPWSTR, C.c_void_p, C.c_void_p, W.BOOL, W.DWORD, C.c_void_p, W.LPCWSTR, C.POINTER(Startup), C.POINTER(Process)]
K.CreateJobObjectW.argtypes = [C.c_void_p, W.LPCWSTR]; K.CreateJobObjectW.restype = W.HANDLE
K.SetInformationJobObject.argtypes = [W.HANDLE, C.c_int, C.c_void_p, W.DWORD]
K.AssignProcessToJobObject.argtypes = [W.HANDLE, W.HANDLE]
K.TerminateProcess.argtypes = [W.HANDLE, W.UINT]
K.ResumeThread.argtypes = [W.HANDLE]
K.WaitForSingleObject.argtypes = [W.HANDLE, W.DWORD]
K.GetExitCodeProcess.argtypes = [W.HANDLE, C.POINTER(W.DWORD)]
K.CloseHandle.argtypes = [W.HANDLE]
K.ReadProcessMemory.argtypes = [W.HANDLE, C.c_void_p, C.c_void_p, C.c_size_t, C.POINTER(C.c_size_t)]

def input_desktop_name():
    desktop = U.OpenInputDesktop(0, False, 1)
    if not desktop: raise C.WinError(C.get_last_error())
    try:
        name = C.create_unicode_buffer(256); needed = W.DWORD()
        if not U.GetUserObjectInformationW(desktop, 2, name, C.sizeof(name), C.byref(needed)):
            raise C.WinError(C.get_last_error())
        return name.value
    finally: U.CloseDesktop(desktop)

class NativeRunner:
    def __init__(self, executable=None):
        self.exe = Path(executable) if executable else Path(os.environ["LOCALAPPDATA"]) / "Temp/opencode/vascolet-native-iteration2/vascolet4.exe"
        self.desktop = self.job = None
        self.process = Process(); self.channel = None; self.held = set()
        self.name = "VascoletAgent_" + uuid.uuid4().hex[:12]
        self.input_desktop_before = input_desktop_name()

    def __enter__(self):
        if not self.exe.is_file() or not (self.exe.parent / "dinput8.dll").is_file():
            raise FileNotFoundError("Prepare the temporary game copy and build adapter.cpp first")
        try:
            self.desktop = U.CreateDesktopW(self.name, None, None, 0, 0x01ff, None)
            if not self.desktop: raise C.WinError(C.get_last_error())
            self.job = K.CreateJobObjectW(None, None)
            if not self.job: raise C.WinError(C.get_last_error())
            limits = ExtendedLimits(); limits.basic.flags = 0x2000 | 0x100
            limits.processMemory = 512 * 1024 * 1024
            if not K.SetInformationJobObject(self.job, 9, C.byref(limits), C.sizeof(limits)):
                raise C.WinError(C.get_last_error())
            tag = "Local\\" + self.name
            self.channel = mmap.mmap(-1, SIZE, tagname=tag, access=mmap.ACCESS_WRITE)
            struct.pack_into("<II", self.channel, 0, 0x344c4256, 1)
            struct.pack_into("<ii", self.channel, 296, -1000, -1000)
            profile = self.exe.parent / "profile"; profile.mkdir(exist_ok=True)
            env = dict(os.environ, VASCOLET_LAB_CHANNEL=tag, VASCOLET_LAB_PROFILE=str(profile),
                APPDATA=str(profile), ALSOFT_DRIVERS="null", ALSOFT_LOGLEVEL="0")
            block = C.create_unicode_buffer("\0".join(f"{k}={v}" for k, v in sorted(env.items())) + "\0\0")
            startup = Startup(); startup.cb = C.sizeof(startup); startup.desktop = "WinSta0\\" + self.name
            command = C.create_unicode_buffer(f'"{self.exe}"')
            # Suspended until Job assignment; no breakaway and no visible-desktop fallback.
            if not K.CreateProcessW(str(self.exe), command, None, None, False, 0x4404, block,
                str(self.exe.parent), C.byref(startup), C.byref(self.process)):
                raise C.WinError(C.get_last_error())
            if not K.AssignProcessToJobObject(self.job, self.process.handle): raise C.WinError(C.get_last_error())
            K.ResumeThread(self.process.thread)
            deadline = time.perf_counter() + 20
            while not self.presents and time.perf_counter() < deadline:
                self.check_alive(); time.sleep(.05)
            if not self.presents: raise RuntimeError("Native rendering did not start; inspect isolated-adapter.log")
            return self
        except BaseException:
            self.close(); raise

    @property
    def pid(self): return self.process.pid
    @property
    def hwnd(self): return struct.unpack_from("<I", self.channel, 36)[0] if self.channel else 0
    @property
    def presents(self): return struct.unpack_from("<I", self.channel, 16)[0] if self.channel else 0

    def check_alive(self):
        code = W.DWORD()
        if not K.GetExitCodeProcess(self.process.handle, C.byref(code)) or code.value != 259:
            raise RuntimeError(f"Isolated original exited: 0x{code.value:08x}")

    def keys(self, codes):
        self.check_alive(); codes = set(codes)
        if any(not isinstance(code, int) or not 0 <= code < 256 for code in codes): raise ValueError("Invalid DIK code")
        data = bytearray(256)
        for code in codes: data[code] = 0x80
        self.channel[40:296] = data; self.held = codes
        self.channel[316:320] = struct.pack("<I", (struct.unpack_from("<I", self.channel, 316)[0] + 1) & 0xffffffff)

    def press(self, code, duration=.1, after=.15):
        self.keys([code]); time.sleep(duration); self.keys([]); time.sleep(after)

    def capture(self, path=None, timeout=3):
        self.check_alive()
        request = (struct.unpack_from("<I", self.channel, 8)[0] + 1) & 0xffffffff
        struct.pack_into("<I", self.channel, 8, request)
        deadline = time.perf_counter() + timeout
        while struct.unpack_from("<I", self.channel, 12)[0] != request:
            self.check_alive()
            if time.perf_counter() > deadline: raise TimeoutError("Backbuffer capture timed out")
            time.sleep(.01)
        result = struct.unpack_from("<I", self.channel, 20)[0]
        if result & 0x80000000: raise RuntimeError(f"Backbuffer read failed: 0x{result:08x}")
        width, height, pitch = struct.unpack_from("<III", self.channel, 24)
        if not width or not height or pitch < width * 4 or pitch * height > SIZE - 320:
            raise RuntimeError("Invalid native frame dimensions")
        image = Image.frombytes("RGB", (width, height), bytes(self.channel[320:320+pitch*height]), "raw", "BGRX", pitch, 1)
        if path: image.save(path)
        return image

    def read_memory(self, address, size):
        if not 0 < size <= 2 * 1024 * 1024: raise ValueError("Read must be bounded")
        buffer = C.create_string_buffer(size); read = C.c_size_t()
        K.ReadProcessMemory(self.process.handle, address, buffer, size, C.byref(read))
        return buffer.raw[:read.value]

    def close(self):
        if self.channel: self.channel[40:296] = bytes(256)
        if self.process.handle:
            if self.hwnd: U.PostMessageW(self.hwnd, 0x0010, 0, 0)
            if K.WaitForSingleObject(self.process.handle, 1500) != 0: K.TerminateProcess(self.process.handle, 0)
        if self.job: K.CloseHandle(self.job); self.job = None
        if self.process.thread: K.CloseHandle(self.process.thread); self.process.thread = None
        if self.process.handle: K.CloseHandle(self.process.handle); self.process.handle = None
        if self.channel: self.channel.close(); self.channel = None
        if self.desktop: U.CloseDesktop(self.desktop); self.desktop = None

    def __exit__(self, *_): self.close()
