/** Optional real-browser publication/navigation regression. See README. */
import assert from 'node:assert/strict';
import { chromium as pw } from 'playwright-core';
const base = process.env.WEBAPP_TEST_URL || 'http://127.0.0.1:3000';
const launch = () => pw.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined, headless: true,
  args: ['--no-sandbox', ...(process.env.CHROMIUM_SINGLE_PROCESS === '1' ? ['--single-process', '--no-zygote'] : [])],
});
const browser=await launch();
const page=await browser.newPage({viewport:{width:393,height:852}});
await page.route('https://telegram.org/**',r=>r.abort());
const errors=[];page.on('pageerror',e=>errors.push(e.message));
// Failure of AVIF must try actual JPEG first, not lose the visible photo.
await page.route('**/*.avif*',r=>r.fulfill({status:404,body:'missing'}));
await page.goto(`${base}/product/AG0015#/collection/retro-asia`);
await page.waitForSelector('#boot.done');
await page.waitForFunction(()=>[...document.querySelectorAll('[data-grid] img')].every(i=>i.complete&&i.naturalWidth>0));
assert.equal(await page.locator('[data-grid] .pcard').count(),4);
assert.equal(await page.locator('[data-grid] picture source').count(),0);
assert.ok(await page.evaluate(()=>{const s=document.querySelector('.scroll');return s.scrollHeight>s.clientHeight}));
await page.locator('[data-grid] [data-add="AG0015"]').click();
await page.waitForFunction(()=>document.querySelector('[data-add="AG0015"]').classList.contains('in'));
await page.evaluate(()=>location.hash='/cart');
await page.waitForSelector('.cline');
assert.match(await page.locator('.cline').innerText(),/Cocktail Glass/);
assert.equal(await page.locator('[data-checkout]').isVisible(), true);
await page.evaluate(()=>location.hash='/product/AG0015');
await page.waitForSelector('.pview');await page.waitForTimeout(500);
assert.equal(await page.locator('.tabbar').isVisible(),true);
// Ordinary Telegram SDK without initData must NOT hide the CTA.
assert.equal(await page.locator('[data-main]').isVisible(),true);
await page.evaluate(()=>location.hash='/');await page.waitForSelector('.hero');
await page.evaluate(()=>document.querySelector('.scroll').scrollTop=800);
await page.waitForFunction(()=>[...document.querySelectorAll('[data-popular] img')].every(i=>i.complete&&i.naturalWidth>0));
assert.equal(await page.locator('[data-popular] .pcard').count(),8);
assert.equal(await page.locator('.coll-row').count(),10);
assert.deepEqual(errors,[]);
console.log('PASS: deep route, codec failure → JPEG, bounded scroll, cart add, CTA, warm home, 10 collections/8 cards, no JS errors');
await browser.close();
