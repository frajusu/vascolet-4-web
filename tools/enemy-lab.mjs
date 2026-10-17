import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { chromium } from "playwright-core";
import { startServer } from "./serve.mjs";

const kinds = process.argv[2] ? [process.argv[2]] : ["Fly", "Frog", "Flower", "Beetle", "Snail"];
const output = path.join(os.tmpdir(), "opencode", `vascolet-animals-${Date.now()}`);
await mkdir(output, { recursive: true });
const { server, url } = await startServer();
const report = { output, scope: "Controlled fixture using the actual game update/renderer, not a native equivalence certificate", runs: [], errors: [] };
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE ||
    path.join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1243/chrome-win64/chrome.exe") });
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  page.on("pageerror", e => report.errors.push(e.message));
  page.on("response", r => { if (r.status() >= 400) report.errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(url + "/tools/enemy-lab.html"); await page.waitForFunction(() => window.Lab?.ready, null, { timeout: 20000 });
  for (const kind of kinds) {
    const trajectories = {};
    for (const scenario of ["far-left", "far-right", "near", "cross", ...(kind === "Frog" ? ["boomerang"] : [])]) {
      await page.evaluate(([kind, scenario]) => window.Lab.setup(kind, scenario, 1), [kind, scenario]);
      for (let batch = 0; batch < 30; batch++) {
        await page.evaluate(() => window.Lab.ticks(12));
        if (scenario === "near" && [0, 1, 2, 4, 6, 9, 19, 29].includes(batch))
          await page.locator("canvas").screenshot({ path: path.join(output, `${kind}-${scenario}-${String(batch).padStart(2, "0")}.png`) });
      }
      const run = await page.evaluate(() => window.Lab.trace()); trajectories[scenario] = run.samples;
      await writeFile(path.join(output, `${kind}-${scenario}.json`), JSON.stringify(run));
      report.runs.push({ kind, scenario, seed: 1, minX: Math.min(...run.samples.map(s => s.x)), maxX: Math.max(...run.samples.map(s => s.x)),
        minY: Math.min(...run.samples.map(s => s.y)), maxY: Math.max(...run.samples.map(s => s.y)),
        jumps: run.samples.filter((s, i, a) => s.state === "jump" && a[i-1]?.state !== "jump").map(s => s.t),
        attacks: run.samples.filter((s, i, a) => s.state === "attack" && a[i-1]?.state !== "attack").map(s => s.t) });
    }
    if (kind !== "Frog") assert.deepEqual(trajectories["far-left"].map(s => s.x), trajectories["far-right"].map(s => s.x), `${kind} must not chase player X`);
    if (kind === "Fly") assert.ok(trajectories.near.every(s => Math.abs(s.x - 560) < 105), "fly patrol escaped its spawn neighborhood");
    if (kind === "Frog") {
      assert.ok(trajectories["far-left"].every(s => s.state === "normal"));
      assert.ok(trajectories.near.some(s => s.state === "jump"));
      assert.ok(trajectories.boomerang.some(s => s.state === "jump"), "nearby boomerang must trigger evasion");
      const jump = trajectories.cross.filter(s => s.state === "jump");
      assert.ok(jump.every(s => s.dir === jump[0].dir), "frog must not steer in midair");
    }
  }
  assert.deepEqual(report.errors, []); report.ok = true;
} catch (e) { report.ok = false; report.failure = e.stack; process.exitCode = 1; }
finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
}
