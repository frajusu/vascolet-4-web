// Test adapter for the original on an UNSELECTED Win32 desktop.
// Private DirectInput state + D3D9Ex backbuffer capture. No gameplay hooks.
#define WIN32_LEAN_AND_MEAN
#define DIRECTINPUT_VERSION 0x0800
#include <windows.h>
#include <dinput.h>
#include <d3d9.h>
#include <cstdio>
#include <cstring>

struct Channel {
    DWORD magic, version;
    volatile LONG captureRequest, captureDone, presents;
    HRESULT result;
    DWORD width, height, pitch, hwnd;
    BYTE keys[256];
    LONG mouseX, mouseY, wheel;
    BYTE buttons[8];
    LONG inputSequence;
    BYTE frame[4 * 1024 * 1024];
};
static_assert(offsetof(Channel, frame) == 320, "Python/native channel ABI");
static Channel* channel = nullptr;
static HWND window = nullptr;
static HANDLE mapping = nullptr;
static void log(const char* text, HRESULT hr = S_OK) {
    FILE* f = nullptr;
    if (!fopen_s(&f, "isolated-adapter.log", "a") && f) {
        fprintf(f, "%lu %s 0x%08lx\n", GetTickCount(), text, (unsigned long)hr);
        fclose(f);
    }
}
static void* replace(void** slot, void* value) {
    DWORD old = 0;
    if (!VirtualProtect(slot, sizeof(void*), PAGE_READWRITE, &old)) return nullptr;
    void* previous = *slot; *slot = value;
    VirtualProtect(slot, sizeof(void*), old, &old);
    return previous;
}
static bool owned(HWND h) {
    DWORD pid = 0; GetWindowThreadProcessId(h, &pid);
    return pid == GetCurrentProcessId();
}
static BOOL WINAPI foreground(HWND h) {
    if (!owned(h)) return FALSE;
    window = h; if (channel) channel->hwnd = (DWORD)(ULONG_PTR)h;
    return TRUE; // Deliberately no SetForegroundWindow call.
}
static HWND WINAPI getWindow() { return window; }
static HWND WINAPI setWindow(HWND h) { HWND old = window; foreground(h); return old; }
static BOOL WINAPI clipCursor(const RECT*) { return TRUE; }
static BOOL WINAPI setCursorPos(int, int) { return TRUE; }
static int WINAPI showCursor(BOOL) { return 0; }
static UINT WINAPI sendInput(UINT n, LPINPUT, int) { return n; }
static BOOL WINAPI switchDesktop(HDESK) { return FALSE; }
using FolderW = HRESULT (WINAPI*)(HWND, int, HANDLE, DWORD, LPWSTR);
using FolderA = HRESULT (WINAPI*)(HWND, int, HANDLE, DWORD, LPSTR);
using SpecialW = BOOL (WINAPI*)(HWND, LPWSTR, int, BOOL);
using SpecialA = BOOL (WINAPI*)(HWND, LPSTR, int, BOOL);
static FolderW realFolderW = nullptr; static FolderA realFolderA = nullptr;
static SpecialW realSpecialW = nullptr; static SpecialA realSpecialA = nullptr;
static bool profileW(int folder, LPWSTR out) {
    return (folder & 0xff) == 0x1a && GetEnvironmentVariableW(L"VASCOLET_LAB_PROFILE", out, MAX_PATH) > 0;
}
static bool profileA(int folder, LPSTR out) {
    return (folder & 0xff) == 0x1a && GetEnvironmentVariableA("VASCOLET_LAB_PROFILE", out, MAX_PATH) > 0;
}
static HRESULT WINAPI folderW(HWND h, int f, HANDLE t, DWORD flags, LPWSTR out) { return profileW(f, out) ? S_OK : realFolderW(h, f, t, flags, out); }
static HRESULT WINAPI folderA(HWND h, int f, HANDLE t, DWORD flags, LPSTR out) { return profileA(f, out) ? S_OK : realFolderA(h, f, t, flags, out); }
static BOOL WINAPI specialW(HWND h, LPWSTR out, int f, BOOL create) { return profileW(f, out) ? TRUE : realSpecialW(h, out, f, create); }
static BOOL WINAPI specialA(HWND h, LPSTR out, int f, BOOL create) { return profileA(f, out) ? TRUE : realSpecialA(h, out, f, create); }
static BOOL WINAPI cursorPos(POINT* p) {
    if (!p) return FALSE;
    p->x = channel ? channel->mouseX : -1000;
    p->y = channel ? channel->mouseY : -1000;
    if (window) ClientToScreen(window, p);
    return TRUE;
}
static SHORT WINAPI keyState(int vk) {
    if (channel && vk == VK_LBUTTON) return channel->buttons[0] ? (SHORT)0x8000 : 0;
    if (channel && vk == VK_RBUTTON) return channel->buttons[1] ? (SHORT)0x8000 : 0;
    UINT scan = MapVirtualKeyW(vk, MAPVK_VK_TO_VSC);
    if (vk >= VK_LEFT && vk <= VK_DOWN) scan |= 0x80;
    return channel && scan < 256 && channel->keys[scan] ? (SHORT)0x8000 : 0;
}
using Peek = BOOL (WINAPI*)(LPMSG, HWND, UINT, UINT, UINT);
static Peek realPeekA = nullptr, realPeekW = nullptr;
static BOOL peek(Peek fn, LPMSG msg, HWND h, UINT lo, UINT hi, UINT flags) {
    BOOL ok = fn(msg, h, lo, hi, flags);
    if (ok) {
        if (msg->message == WM_ACTIVATEAPP) msg->wParam = TRUE;
        if (msg->message == WM_ACTIVATE) msg->wParam = WA_ACTIVE;
        if (msg->message == WM_KILLFOCUS) msg->message = WM_SETFOCUS;
    }
    return ok;
}
static BOOL WINAPI peekA(LPMSG m, HWND h, UINT l, UINT r, UINT f) { return peek(realPeekA, m, h, l, r, f); }
static BOOL WINAPI peekW(LPMSG m, HWND h, UINT l, UINT r, UINT f) { return peek(realPeekW, m, h, l, r, f); }

struct InputDevice { void* self; bool keyboard; BYTE previous[256]; };
static InputDevice devices[16] = {};
static unsigned deviceCount = 0, sequence = 0;
static InputDevice* device(void* self) {
    for (unsigned i = 0; i < deviceCount; ++i) if (devices[i].self == self) return &devices[i];
    return nullptr;
}
static HRESULT STDMETHODCALLTYPE acquire(void*) { return DI_OK; }
static HRESULT STDMETHODCALLTYPE cooperate(void*, HWND, DWORD) { return DI_OK; }
static HRESULT STDMETHODCALLTYPE state(void* self, DWORD size, void* output) {
    if (!output) return DIERR_INVALIDPARAM;
    memset(output, 0, size);
    InputDevice* d = device(self);
    if (channel && d && d->keyboard) memcpy(output, channel->keys, size < 256 ? size : 256);
    else if (channel && size >= sizeof(DIMOUSESTATE)) {
        auto* m = (DIMOUSESTATE*)output;
        memcpy(m->rgbButtons, channel->buttons, sizeof(m->rgbButtons));
        m->lZ = channel->wheel;
    }
    return DI_OK;
}
static HRESULT STDMETHODCALLTYPE data(void* self, DWORD stride, DIDEVICEOBJECTDATA* out, DWORD* count, DWORD flags) {
    InputDevice* d = device(self);
    if (!count) return DIERR_INVALIDPARAM;
    DWORD used = 0, capacity = *count;
    if (d && d->keyboard && channel && out) {
        for (DWORD i = 0; i < 256 && used < capacity; ++i) if (d->previous[i] != channel->keys[i]) {
            auto* e = (DIDEVICEOBJECTDATA*)((BYTE*)out + used * stride);
            memset(e, 0, stride); e->dwOfs = i; e->dwData = channel->keys[i];
            e->dwTimeStamp = GetTickCount(); e->dwSequence = ++sequence;
            if (!(flags & DIGDD_PEEK)) d->previous[i] = channel->keys[i];
            ++used;
        }
    }
    *count = used; return DI_OK;
}
using CreateInputDevice = HRESULT (STDMETHODCALLTYPE*)(void*, REFGUID, void**, IUnknown*);
static CreateInputDevice realCreateInputDevice = nullptr;
static HRESULT STDMETHODCALLTYPE createInputDevice(void* self, REFGUID guid, void** output, IUnknown* outer) {
    HRESULT hr = realCreateInputDevice(self, guid, output, outer);
    if (FAILED(hr) || !output || !*output) return hr;
    if (deviceCount >= 16) return DIERR_OUTOFMEMORY;
    bool keyboard = IsEqualGUID(guid, GUID_SysKeyboard);
    devices[deviceCount].self = *output; devices[deviceCount++].keyboard = keyboard;
    void** table = *(void***)*output;
    replace(&table[7], (void*)acquire); replace(&table[8], (void*)acquire);
    replace(&table[9], (void*)state); replace(&table[10], (void*)data);
    replace(&table[13], (void*)cooperate); replace(&table[25], (void*)acquire);
    log(keyboard ? "private keyboard" : "private mouse");
    return DI_OK;
}
extern "C" HRESULT WINAPI LabDirectInput8Create(HINSTANCE instance, DWORD version, REFIID iid, void** out, IUnknown* outer) {
    wchar_t path[MAX_PATH]; GetSystemDirectoryW(path, MAX_PATH); wcscat_s(path, L"\\dinput8.dll");
    static HMODULE real = LoadLibraryW(path);
    using Create = HRESULT (WINAPI*)(HINSTANCE, DWORD, REFIID, void**, IUnknown*);
    auto fn = real ? (Create)GetProcAddress(real, "DirectInput8Create") : nullptr;
    if (!fn) return DIERR_NOTINITIALIZED;
    HRESULT hr = fn(instance, version, iid, out, outer);
    if (SUCCEEDED(hr) && out && *out) {
        void** table = *(void***)*out;
        if (table[3] != (void*)createInputDevice)
            realCreateInputDevice = (CreateInputDevice)replace(&table[3], (void*)createInputDevice);
    }
    return hr;
}

using Present = HRESULT (STDMETHODCALLTYPE*)(IDirect3DDevice9*, const RECT*, const RECT*, HWND, const RGNDATA*);
static Present realPresent = nullptr;
using Texture = HRESULT (STDMETHODCALLTYPE*)(IDirect3DDevice9*, UINT, UINT, UINT, DWORD, D3DFORMAT, D3DPOOL, IDirect3DTexture9**, HANDLE*);
static Texture realTexture = nullptr;
static HRESULT STDMETHODCALLTYPE texture(IDirect3DDevice9* self, UINT w, UINT h, UINT levels, DWORD usage, D3DFORMAT format, D3DPOOL pool, IDirect3DTexture9** out, HANDLE* shared) {
    if (pool == D3DPOOL_MANAGED) { pool = D3DPOOL_DEFAULT; usage |= D3DUSAGE_DYNAMIC; }
    HRESULT hr = realTexture(self, w, h, levels, usage, format, pool, out, shared);
    if (FAILED(hr)) log("CreateTexture", hr);
    return hr;
}
static HRESULT STDMETHODCALLTYPE present(IDirect3DDevice9* self, const RECT* a, const RECT* b, HWND h, const RGNDATA* region) {
    static bool activated = false;
    if (!activated && window) {
        activated = true;
        // Notify only this private window's application state. This is not an
        // OS focus operation and never selects the desktop or injects input.
        SendMessageW(window, WM_ACTIVATEAPP, TRUE, GetCurrentThreadId());
        SendMessageW(window, WM_ACTIVATE, WA_ACTIVE, 0);
        log("private activation notification");
    }
    if (channel) {
        ++channel->presents;
        LONG request = channel->captureRequest;
        if (request != channel->captureDone) {
            IDirect3DSurface9 *back = nullptr, *cpu = nullptr;
            HRESULT hr = self->GetBackBuffer(0, 0, D3DBACKBUFFER_TYPE_MONO, &back);
            D3DSURFACE_DESC desc = {};
            if (SUCCEEDED(hr)) hr = back->GetDesc(&desc);
            if (SUCCEEDED(hr)) hr = self->CreateOffscreenPlainSurface(desc.Width, desc.Height, desc.Format, D3DPOOL_SYSTEMMEM, &cpu, nullptr);
            if (SUCCEEDED(hr)) hr = self->GetRenderTargetData(back, cpu);
            D3DLOCKED_RECT lock = {};
            if (SUCCEEDED(hr)) {
                hr = cpu->LockRect(&lock, nullptr, D3DLOCK_READONLY);
                if (SUCCEEDED(hr)) {
                    if ((size_t)lock.Pitch * desc.Height <= sizeof(channel->frame)) {
                        channel->width = desc.Width; channel->height = desc.Height; channel->pitch = lock.Pitch;
                        memcpy(channel->frame, lock.pBits, (size_t)lock.Pitch * desc.Height);
                    } else hr = E_OUTOFMEMORY;
                    cpu->UnlockRect();
                }
            }
            if (cpu) cpu->Release(); if (back) back->Release();
            channel->result = hr; MemoryBarrier(); channel->captureDone = request;
        }
    }
    return realPresent(self, a, b, h, region);
}
static HRESULT STDMETHODCALLTYPE createGraphicsDevice(IDirect3D9* self, UINT adapter, D3DDEVTYPE type, HWND focus, DWORD flags, D3DPRESENT_PARAMETERS* params, IDirect3DDevice9** out) {
    foreground(focus); params->Windowed = TRUE; params->FullScreen_RefreshRateInHz = 0;
    IDirect3DDevice9Ex* ex = nullptr;
    HRESULT hr = ((IDirect3D9Ex*)self)->CreateDeviceEx(adapter, type, focus, flags, params, nullptr, &ex);
    log("CreateDeviceEx", hr);
    if (FAILED(hr)) {
        flags &= ~(D3DCREATE_HARDWARE_VERTEXPROCESSING | D3DCREATE_MIXED_VERTEXPROCESSING | D3DCREATE_PUREDEVICE);
        flags |= D3DCREATE_SOFTWARE_VERTEXPROCESSING;
        hr = ((IDirect3D9Ex*)self)->CreateDeviceEx(adapter, type, focus, flags, params, nullptr, &ex);
        log("CreateDeviceEx software vertices", hr);
    }
    if (SUCCEEDED(hr)) {
        *out = ex; void** table = *(void***)ex;
        if (table[17] != (void*)present) realPresent = (Present)replace(&table[17], (void*)present);
        if (table[23] != (void*)texture) realTexture = (Texture)replace(&table[23], (void*)texture);
    }
    if (channel) channel->result = hr;
    return hr;
}
static IDirect3D9* WINAPI graphics(UINT sdk) {
    using Create = HRESULT (WINAPI*)(UINT, IDirect3D9Ex**);
    auto fn = (Create)GetProcAddress(GetModuleHandleW(L"d3d9.dll"), "Direct3DCreate9Ex");
    IDirect3D9Ex* out = nullptr; HRESULT hr = fn ? fn(sdk, &out) : E_NOTIMPL;
    log("Direct3DCreate9Ex", hr);
    if (FAILED(hr)) { if (channel) channel->result = hr; return nullptr; }
    replace(&(*(void***)out)[16], (void*)createGraphicsDevice);
    return out;
}
static void imports() {
    BYTE* base = (BYTE*)GetModuleHandleW(nullptr);
    auto* dos = (IMAGE_DOS_HEADER*)base; auto* nt = (IMAGE_NT_HEADERS*)(base + dos->e_lfanew);
    auto* dll = (IMAGE_IMPORT_DESCRIPTOR*)(base + nt->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_IMPORT].VirtualAddress);
    for (; dll->Name; ++dll) {
        if (!dll->OriginalFirstThunk) continue;
        auto* names = (IMAGE_THUNK_DATA*)(base + dll->OriginalFirstThunk);
        auto* slots = (IMAGE_THUNK_DATA*)(base + dll->FirstThunk);
        for (; names->u1.AddressOfData; ++names, ++slots) {
            if (IMAGE_SNAP_BY_ORDINAL(names->u1.Ordinal)) continue;
            const char* name = (char*)((IMAGE_IMPORT_BY_NAME*)(base + names->u1.AddressOfData))->Name;
            void* hook = nullptr;
            if (!strcmp(name, "Direct3DCreate9")) hook = (void*)graphics;
            else if (!strcmp(name, "SetForegroundWindow")) hook = (void*)foreground;
            else if (!strcmp(name, "GetForegroundWindow") || !strcmp(name, "GetActiveWindow") || !strcmp(name, "GetFocus")) hook = (void*)getWindow;
            else if (!strcmp(name, "SetActiveWindow") || !strcmp(name, "SetFocus")) hook = (void*)setWindow;
            else if (!strcmp(name, "ClipCursor")) hook = (void*)clipCursor;
            else if (!strcmp(name, "SetCursorPos")) hook = (void*)setCursorPos;
            else if (!strcmp(name, "GetCursorPos")) hook = (void*)cursorPos;
            else if (!strcmp(name, "ShowCursor")) hook = (void*)showCursor;
            else if (!strcmp(name, "SendInput")) hook = (void*)sendInput;
            else if (!strcmp(name, "SwitchDesktop")) hook = (void*)switchDesktop;
            else if (!strcmp(name, "GetAsyncKeyState") || !strcmp(name, "GetKeyState")) hook = (void*)keyState;
            else if (!strcmp(name, "PeekMessageA")) { realPeekA = (Peek)slots->u1.Function; hook = (void*)peekA; }
            else if (!strcmp(name, "PeekMessageW")) { realPeekW = (Peek)slots->u1.Function; hook = (void*)peekW; }
            else if (!strcmp(name, "SHGetFolderPathW")) { realFolderW = (FolderW)slots->u1.Function; hook = (void*)folderW; }
            else if (!strcmp(name, "SHGetFolderPathA")) { realFolderA = (FolderA)slots->u1.Function; hook = (void*)folderA; }
            else if (!strcmp(name, "SHGetSpecialFolderPathW")) { realSpecialW = (SpecialW)slots->u1.Function; hook = (void*)specialW; }
            else if (!strcmp(name, "SHGetSpecialFolderPathA")) { realSpecialA = (SpecialA)slots->u1.Function; hook = (void*)specialA; }
            if (hook) replace((void**)&slots->u1.Function, hook);
        }
    }
}
BOOL WINAPI DllMain(HINSTANCE, DWORD reason, LPVOID) {
    if (reason != DLL_PROCESS_ATTACH) return TRUE;
    wchar_t desktop[256] = {}, tag[256] = {}; DWORD bytes = 0;
    if (!GetUserObjectInformationW(GetThreadDesktop(GetCurrentThreadId()), UOI_NAME, desktop, sizeof(desktop), &bytes) ||
        wcsncmp(desktop, L"VascoletAgent_", 14) || !GetEnvironmentVariableW(L"VASCOLET_LAB_CHANNEL", tag, 256)) {
        TerminateProcess(GetCurrentProcess(), ERROR_ACCESS_DENIED); return FALSE;
    }
    mapping = OpenFileMappingW(FILE_MAP_ALL_ACCESS, FALSE, tag);
    channel = mapping ? (Channel*)MapViewOfFile(mapping, FILE_MAP_ALL_ACCESS, 0, 0, sizeof(Channel)) : nullptr;
    if (!channel || channel->magic != 0x344c4256) { TerminateProcess(GetCurrentProcess(), ERROR_INVALID_DATA); return FALSE; }
    imports(); log("isolated adapter initialized"); return TRUE;
}
