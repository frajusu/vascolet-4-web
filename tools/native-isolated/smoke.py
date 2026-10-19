"""Verify invisible rendering/private controls and clean up the entire child job."""
from pathlib import Path
import ctypes as C
from ctypes import wintypes as W
import json,os,struct,time
from runner import NativeRunner,K,input_desktop_name

class MBI(C.Structure):
    _fields_=[('base',C.c_void_p),('allocation',C.c_void_p),('allocationProtect',W.DWORD),('size',C.c_size_t),('state',W.DWORD),('protect',W.DWORD),('type',W.DWORD)]
K.VirtualQueryEx.argtypes=[W.HANDLE,C.c_void_p,C.c_void_p,C.c_size_t];K.VirtualQueryEx.restype=C.c_size_t
def hero(runner):
    address=total=0;needle=struct.pack('<III',6,4,60)
    while address<0x7fff0000 and total<256*1024*1024:
        m=MBI()
        if not K.VirtualQueryEx(runner.process.handle,address,C.byref(m),C.sizeof(m)):break
        end=(m.base or address)+m.size
        if end<=address:break
        if m.state==0x1000 and m.type==0x20000 and m.protect&4 and not m.protect&0x100:
            for start in range(m.base,end,2*1024*1024):
                raw=runner.read_memory(start,min(end-start,2*1024*1024));total+=len(raw);index=0
                while (index:=raw.find(needle,index))>=0:
                    if index>=28:
                        x,y=struct.unpack_from('<ff',raw,index-28)
                        if 250<x<290 and 370<y<390:return start+index-28
                    index+=12
        address=end
    raise RuntimeError('New-game player was not found after the intro/menu inputs')
def position(runner,address):
    return [struct.unpack('<f',runner.read_memory(address-56,4))[0],struct.unpack('<f',runner.read_memory(address-28,4))[0]]
output=Path(os.environ['LOCALAPPDATA'])/'Temp/opencode'/f'vascolet-isolated-{int(time.time())}'
output.mkdir();report={'output':str(output),'globalInputUsed':False,'desktopSelected':False}
try:
    with NativeRunner() as runner:
        report['desktop']=runner.name;report['inputDesktopBefore']=runner.input_desktop_before
        time.sleep(19)
        for _ in range(4):runner.press(28,.12,1)
        time.sleep(5);runner.press(28,.12,.6)
        runner.capture(output/'before.png');address=hero(runner);before=position(runner,address)
        runner.keys([205]);time.sleep(.6);runner.keys([]);time.sleep(.15)
        after=position(runner,address);runner.capture(output/'walking.png')
        runner.keys([44]);time.sleep(.24);jump=position(runner,address);runner.capture(output/'jump.png');runner.keys([])
        assert 30<after[0]-before[0]<200,(before,after)
        assert jump[1]<after[1]-15,(after,jump)
        report.update(before=before,afterRight=after,atJump=jump,presents=runner.presents)
    report['inputDesktopAfter']=input_desktop_name()
    assert report['inputDesktopAfter']==report['inputDesktopBefore']
    report['ok']=True
finally:
    (output/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
