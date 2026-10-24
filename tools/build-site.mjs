// Publish a single content-hashed module so cached/filtered individual source
// names cannot break the app's dependency graph. Source remains usable for dev.
import { build } from "esbuild";
import { mkdir,rm,cp,readFile,writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
export const root=fileURLToPath(new URL("../",import.meta.url));
export async function buildSite() {
  const destination=path.join(root,"_site");
  await rm(destination,{recursive:true,force:true});await mkdir(destination,{recursive:true});
  const result=await build({absWorkingDir:root,entryPoints:["js/main.js"],bundle:true,format:"esm",platform:"browser",
    target:"es2020",outdir:path.join(destination,"js"),entryNames:"app-[hash]",metafile:true,write:true,logLevel:"silent"});
  const entry=Object.entries(result.metafile.outputs).find(([,info])=>info.entryPoint==="js/main.js");
  if(!entry)throw Error("Missing bundled entry point");
  const relative=path.relative(destination,path.resolve(root,entry[0])).replaceAll("\\","/");
  const template=await readFile(path.join(root,"index.html"),"utf8");
  if(!template.includes('data-entry="./js/main.js"'))throw Error("Missing index entry placeholder");
  await writeFile(path.join(destination,"index.html"),template.replace('data-entry="./js/main.js"',`data-entry="./${relative}"`));
  await cp(path.join(root,"assets"),path.join(destination,"assets"),{recursive:true});
  // Existing cached HTML and diagnostic/dev tools may still request source paths.
  await cp(path.join(root,"js"),path.join(destination,"js"),{recursive:true});
  const manifest={entry:relative,sourceModules:Object.keys(result.metafile.inputs).length};
  await writeFile(path.join(destination,"release.json"),JSON.stringify(manifest,null,2));
  return {destination,...manifest};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await buildSite(),null,2));
