// Wait for real scene transitions instead of assuming three rapid Enter presses
// survive asynchronous chapter/level loading on every machine.
export async function startNewGame(page) {
  await page.evaluate(async()=>{
    window.__game=(await import("/js/game.js")).Game;
    window.__scene=(await import("/js/main.js")).currentScene;
  });
  await page.waitForFunction(()=>window.__scene()==="menu");
  const box=await page.locator("#game").boundingBox();
  await page.mouse.click(box.x+451*box.width/512,box.y+130*box.height/384);
  await page.waitForFunction(()=>window.__scene()==="chapters");
  await page.mouse.move(0,0);
  await page.keyboard.press("Enter",{delay:50});
  await page.waitForFunction(()=>["video","game"].includes(window.__scene()));
  if(await page.evaluate(()=>window.__scene()==="video"))await page.keyboard.press("Enter",{delay:50});
  await page.waitForFunction(()=>window.__scene()==="game"&&Boolean(window.__game.player?.anim)&&window.__game.time>0);
}
export async function pauseGame(page) {
  await page.keyboard.press("Escape",{delay:50});
  await page.waitForFunction(()=>window.__scene()==="paused");
}
