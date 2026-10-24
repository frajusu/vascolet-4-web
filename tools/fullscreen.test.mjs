import test from "node:test";
import assert from "node:assert/strict";
import { createFullscreenController } from "../js/fullscreen.js";

class Events {
  listeners=new Map();
  addEventListener(type,fn){const set=this.listeners.get(type)||new Set();set.add(fn);this.listeners.set(type,set);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  emit(type,props={}){const e={type,isTrusted:true,key:"",button:0,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...props};
    for(const fn of this.listeners.get(type)||[]){fn(e);if(e.stopped)break;}return e;}
}
function fixture({preference=false,lock=true,reject=false}={}) {
  const doc=new Events(),target=new Events(),calls={enter:0,exit:0,lock:[],unlock:0,pause:0,writes:[]};
  let stored=preference,time=1000;
  target.performance={now:()=>time};doc.fullscreenElement=null;doc.documentElement={};
  doc.documentElement.requestFullscreen=async()=>{calls.enter++;if(reject)throw new Error("Denied");doc.fullscreenElement=doc.documentElement;doc.emit("fullscreenchange");};
  doc.exitFullscreen=async()=>{calls.exit++;doc.fullscreenElement=null;doc.emit("fullscreenchange");};
  const keyboard=lock?{lock:async keys=>{calls.lock.push(keys);},unlock:()=>calls.unlock++}:undefined;
  const controller=createFullscreenController({doc,target,keyboard,readPreference:()=>stored,writePreference:value=>{stored=value;calls.writes.push(value);},onExit:()=>{calls.pause++;return true;}});
  controller.init();
  return {controller,doc,target,calls,preference:()=>stored,advance:()=>time+=250};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test("stored preference waits for the first trusted gesture and never claims fullscreen at boot",async()=>{
  const f=fixture({preference:true});assert.equal(f.controller.active(),false);assert.equal(f.calls.enter,0);assert.equal(f.controller.restoring,true);
  f.target.emit("keydown",{key:"Enter",isTrusted:false});assert.equal(f.calls.enter,0);
  f.target.emit("keydown",{key:"Escape"});assert.equal(f.calls.enter,0);
  f.target.emit("keydown",{key:"Enter"});await flush();
  assert.equal(f.calls.enter,1);assert.equal(f.controller.active(),true);assert.equal(f.controller.locked,true);
  assert.deepEqual(f.calls.lock,[["Escape"]]);assert.deepEqual(f.calls.writes,[]);f.controller.dispose();
});
test("keyboard lock retains ordinary Esc for gameplay; browser exit invokes pause exactly once and consumes a late Esc edge",async()=>{
  const f=fixture();await f.controller.set(true);await flush();
  assert.equal(f.target.emit("keydown",{key:"Escape"}).prevented,true);assert.equal(f.controller.active(),true);
  f.doc.fullscreenElement=null;f.doc.emit("fullscreenchange");f.doc.emit("fullscreenchange");
  assert.equal(f.calls.pause,1);assert.equal(f.controller.active(),false);
  assert.equal(f.target.emit("keydown",{key:"Escape"}).stopped,true);
  f.advance();assert.equal(f.target.emit("keydown",{key:"Escape"}).stopped,undefined);f.controller.dispose();
});
test("without keyboard lock the fullscreen-exit fallback still pauses and does not auto-reenter on the next gesture",async()=>{
  const f=fixture({lock:false});await f.controller.set(true);await f.controller.set(false);
  assert.equal(f.calls.pause,1);assert.equal(f.controller.locked,false);
  f.target.emit("pointerup");await flush();assert.equal(f.calls.enter,1);assert.equal(f.preference(),false);f.controller.dispose();
});
test("rejected fullscreen requests roll the explicit preference back to actual state and settle without unhandled rejection",async()=>{
  const f=fixture({reject:true});assert.equal(await f.controller.set(true),false);
  assert.equal(f.preference(),false);assert.equal(f.controller.active(),false);assert.match(f.controller.lastError.message,/Denied/);f.controller.dispose();
});
test("keyboard-lock denial uses the fallback rather than failing fullscreen",async()=>{
  const f=fixture();f.controller.dispose();
  const c=createFullscreenController({doc:f.doc,target:f.target,keyboard:{lock:()=>Promise.reject(new Error("Not allowed")),unlock(){}},
    readPreference:()=>false,writePreference(){},onExit:()=>true});c.init();
  assert.equal(await c.set(true),true);await flush();assert.equal(c.locked,false);assert.equal(c.active(),true);c.dispose();
});
test("an exit requested while entry is pending is serialized, keeping preference and actual state consistent",async()=>{
  const f=fixture();let complete;
  f.doc.documentElement.requestFullscreen=()=>new Promise(resolve=>{complete=()=>{f.doc.fullscreenElement=f.doc.documentElement;f.doc.emit("fullscreenchange");resolve();};});
  const entering=f.controller.set(true),leaving=f.controller.set(false);complete();await entering;await leaving;
  assert.equal(f.controller.active(),false);assert.equal(f.preference(),false);assert.equal(f.calls.exit,1);f.controller.dispose();
});
