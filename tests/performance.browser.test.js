"use strict";
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const script = fs.readFileSync(process.argv[2], "utf8");

(async () => {
  const browser = await chromium.launch({ executablePath: process.argv[3], headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<main>" + Array.from({ length: 100 }, (_, a) =>
      `<article data-message-id="message-${a}">` + Array.from({ length: 8 }, (_, p) =>
        `<p id="p-${a}-${p}">Passage ${a}/${p}: ` +
        Array.from({ length: 20 }, (_, s) => `<span>chunk-${s} ordinary research text. </span>`).join("") +
        "</p>").join("") + "</article>").join("") + "</main>");
    await page.addScriptTag({ content: script });
    await page.waitForFunction(() => window.__CODEX_HIGHLIGHTER__.diagnostics().applyCount > 0);
    // Save one real anchor, then load many unrelated historical anchors.
    await page.evaluate(() => {
      const p = document.querySelector("#p-0-0"), r = document.createRange();
      r.setStart(p.firstChild, 0); r.setEnd(p.firstChild, 11);
      getSelection().removeAllRanges(); getSelection().addRange(r);
      p.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelector("#codex-highlighter-toolbar-host")?.style.display === "block");
    await page.evaluate(() => document.querySelector("#codex-highlighter-toolbar-host").shadowRoot.querySelector('[data-color="yellow"]').click());
    await page.waitForFunction(() => window.__CODEX_HIGHLIGHTER__.health().resolved === 1);
    const baseline = await page.evaluate(() => {
      const h = window.__CODEX_HIGHLIGHTER__, data = JSON.parse(h.exportData());
      const first = data.highlights[0];
      for (let i = 0; i < 1373; i++) data.highlights.push({ ...first, id: `old-${i}`,
        scopeHash: `missing-${i}`, scopeIdentity: `data-message-id:old-${i}`, exact: `absent-${i}` });
      data.revision++; data.updatedAt = Date.now() + 1000;
      const count = h.diagnostics().applyCount;
      h.importData(data);
      getSelection().removeAllRanges();
      return count;
    });
    await page.waitForFunction(n => window.__CODEX_HIGHLIGHTER__.diagnostics().applyCount > n, baseline);
    let before = await page.evaluate(() => window.__CODEX_HIGHLIGHTER__.diagnostics());
    assert.equal(before.count, 1374);
    assert.equal(before.resolved, 1);
    assert.ok(before.lastCacheHits > 800, JSON.stringify(before));
    // A local structural change invalidates its owner, not the whole transcript.
    await page.evaluate(() => {
      const p = document.querySelector("#p-50-0");
      p.appendChild(document.createTextNode(" new streamed text"));
    });
    await page.waitForFunction(n => window.__CODEX_HIGHLIGHTER__.diagnostics().applyCount > n, before.applyCount);
    const after = await page.evaluate(() => window.__CODEX_HIGHLIGHTER__.diagnostics());
    assert.ok(after.lastRebuiltScopes < 20, JSON.stringify(after));
    assert.ok(after.lastCacheHits > 800, JSON.stringify(after));
    assert.equal(after.resolved, 1);
    // Updating highlighted text cannot retain a stale cached match.
    await page.evaluate(() => { document.querySelector("#p-0-0").firstChild.data = "Completely replaced: "; });
    await page.waitForFunction(() => window.__CODEX_HIGHLIGHTER__.health().resolved === 0);
    await page.evaluate(() => { document.querySelector("#p-0-0").firstChild.data = "Passage 0/0: "; });
    await page.waitForFunction(() => window.__CODEX_HIGHLIGHTER__.health().resolved === 1);
    const selectionQueries = await page.evaluate(async () => {
      const original = window.getSelection;
      let calls = 0;
      window.getSelection = () => { calls++; return original.call(window); };
      const p = document.querySelector("#p-0-0");
      for (let i = 0; i < 500; i++) p.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 20, clientY: 20 }));
      await new Promise(r => setTimeout(r, 150));
      window.getSelection = original;
      return calls;
    });
    assert.equal(selectionQueries, 0, "Pointer storm performed synchronous selection queries");
    // A continuously ticking status must not postpone the first repaint forever.
    const ticking = await page.evaluate(() => {
      const h = window.__CODEX_HIGHLIGHTER__, base = h.diagnostics().applyCount;
      const span = document.createElement("span");
      document.querySelector("article").appendChild(span);
      let ticks = 0;
      const interval = setInterval(() => {
        span.textContent = String(++ticks);
        if (ticks === 35) { clearInterval(interval); span.remove(); }
      }, 100);
      return base;
    });
    await page.waitForFunction(n => window.__CODEX_HIGHLIGHTER__.diagnostics().applyCount > n, ticking, { timeout: 3000 });
    assert.equal(await page.evaluate(() => window.__CODEX_HIGHLIGHTER__.health().resolved), 1);
    // Cleanup cancels a multi-slice job and cannot recreate CSS highlights later.
    await page.evaluate(() => { const h = window.__CODEX_HIGHLIGHTER__; h.ensure(); h.cleanup(); });
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => [...CSS.highlights.keys()].some(k => k.startsWith("codex-study-highlight"))), false);
    console.log("PASS cached 1374-anchor/900-scope transcript, local invalidation, stale matches, pointer storm, cleanup", JSON.stringify(after));
    const throttled = await browser.newPage();
    await throttled.setContent("<main>" + Array.from({ length: 700 }, (_, i) =>
      `<p>Record ${i}: ` + "<span>nested text </span>".repeat(25) + "</p>").join("") + "</main>");
    await throttled.evaluate(() => {
      const timer = window.setTimeout.bind(window);
      window.setTimeout = (fn, delay, ...args) => timer(fn, Math.max(1000, delay || 0), ...args);
    });
    await throttled.addScriptTag({ content: script });
    await throttled.waitForFunction(() => window.__CODEX_HIGHLIGHTER__.diagnostics().applyCount > 0, null, { timeout: 6000 });
    const clamped = await throttled.evaluate(() => window.__CODEX_HIGHLIGHTER__.diagnostics());
    assert.ok(clamped.lastApplyWallMs < 1500, JSON.stringify(clamped));
    console.log("PASS background timer clamping does not stall cooperative repaint", JSON.stringify(clamped));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
