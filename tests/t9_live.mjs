import { launch } from './browser.mjs';
const URL = process.env.URL || 'https://dr7w8mf2zj-hub.github.io/rocket-workshop/';
for (const mobile of [false, true]) {
  const { browser, page, logs, fails, reqs } = await launch(mobile ? { context: { viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } } : {});
  await page.goto(URL + (mobile ? '?touch=1' : ''));
  await page.waitForFunction(() => window.__app && (window.__app.ready || window.__app.errors.length), null, { timeout: 120000 });
  await page.waitForTimeout(1000);
  const info = await page.evaluate(() => ({ errors: window.__app.errors, texOk: window.__app.lib.log.filter(l => l.ok).length, texFailed: window.__app.lib.failed, parts: window.__app.design.parts.size }));
  await page.evaluate(() => window.__app.launch()); await page.waitForTimeout(2500);
  await page.screenshot({ path: `/workspace/shots/live_${mobile ? 'mobile_portrait' : 'desktop'}.png` });
  console.log(mobile ? 'mobile' : 'desktop', JSON.stringify(info), 'console:', logs, 'failed:', fails, 'bad:', reqs.filter(r => r[0] >= 400), 'total reqs', reqs.length);
  await browser.close();
}
