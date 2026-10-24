import test from "node:test";
import assert from "node:assert/strict";
import { readFile,readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root=fileURLToPath(new URL("../",import.meta.url));
test("every character manifest URL matches the exact file and directory case used by Pages",async()=>{
  const manifest=JSON.parse(await readFile(path.join(root,"assets/chars.json"),"utf8")),directories=new Map();
  for(const [kind,entry]of Object.entries(manifest))for(const property of ["png","xml","anim"]){
    if(!entry[property])continue;let directory=root;
    for(const part of entry[property].replaceAll("\\","/").split("/")){
      if(!directories.has(directory))directories.set(directory,await readdir(directory));
      assert.ok(directories.get(directory).includes(part),`${kind}.${property}: wrong case or missing ${part} in ${entry[property]}`);
      directory=path.join(directory,part);
    }
  }
});
