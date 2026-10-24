import http from "node:http";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const mime = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8", ".tmx": "application/xml; charset=utf-8",
  ".tsx": "application/xml; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".ogg": "audio/ogg", ".wav": "audio/wav", ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".svg": "image/svg+xml", ".ico": "image/x-icon",
};
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

// Port 0 lets the OS allocate a free port without a probe/bind race.
export async function startServer({ port = 0, root = projectRoot } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid port");
  root = await realpath(root);
  const server = http.createServer(async (request, response) => {
    const reply = (status, text) => {
      response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(request.method === "HEAD" ? undefined : text);
    };
    if (!["GET", "HEAD"].includes(request.method)) {
      response.setHeader("Allow", "GET, HEAD");
      return reply(405, "Method not allowed");
    }
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      if (pathname === "/favicon.ico") { response.writeHead(204); response.end(); return; }
      if (pathname.includes("\0") || pathname.includes("\\") || pathname.includes(":")) return reply(400, "Invalid path");
      let file = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
      if (!inside(root, file)) return reply(403, "Forbidden");
      file = await realpath(file);
      if (!inside(root, file)) return reply(403, "Forbidden");
      const info = await stat(file);
      if (!info.isFile()) return reply(404, "Not found");
      response.writeHead(200, {
        "Content-Type": mime[path.extname(file).toLowerCase()] || "application/octet-stream",
        "Content-Length": info.size, "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      if (request.method === "HEAD") { response.end(); return; }
      const stream = createReadStream(file);
      stream.on("error", () => response.destroy());
      response.on("close", () => stream.destroy());
      stream.pipe(response);
    } catch (error) {
      if (error instanceof URIError) reply(400, "Invalid URL encoding");
      else if (["ENOENT", "ENOTDIR"].includes(error.code)) reply(404, "Not found");
      else reply(500, "Server error");
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return { server, url: `http://127.0.0.1:${server.address().port}`, root };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--port" || !/^\d+$/.test(args[1]))) {
      throw new Error("Usage: node tools/serve.mjs [--port 0..65535]");
    }
    const { server, url, root } = await startServer({ port: args.length ? Number(args[1]) : 0 });
    const ready = { type: "ready", url, root, pid: process.pid };
    if (process.send) process.send(ready);
    else console.log(JSON.stringify(ready));
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      server.close(() => process.exit(0));
      server.closeAllConnections();
      setTimeout(() => process.exit(1), 2000).unref();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    process.on("message", message => { if (message?.type === "stop") stop(); });
    if (process.send) process.on("disconnect", stop);
  } catch (error) {
    console.error(JSON.stringify({ type: "error", message: error.message }));
    process.exitCode = 1;
  }
}
