"use strict";
const fs = require("fs");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const script = fs.readFileSync(process.argv[2], "utf8");
const key = "codex-highlighter:pending-retention-backup:v1";

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.argv[3] });
  try {
    async function setup(count) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.route("http://highlight.test/**", (route) => route.fulfill({
        contentType: "text/html", body: '<main><p id="sample">New selected phrase.</p></main>',
      }));
      await page.goto("http://highlight.test/");
      await page.addScriptTag({ content: script });
      await page.evaluate((count) => {
        const highlights = Array.from({ length: count }, (_, index) => ({
          id: `old-${index}`, exact: `unrelated-${index}`,
          contextKey: "http://highlight.test/", createdAt: 1000 + index,
          color: "yellow", start: 0, end: 5,
        })).reverse(); // Array order deliberately differs from age order.
        window.__CODEX_HIGHLIGHTER__.importData({ version: 1, revision: 100,
          updatedAt: Date.now(), highlights });
      }, count);
      await page.waitForTimeout(100);
      return page;
    }
    async function add(page) {
      await page.evaluate(() => {
        const text = document.querySelector("#sample").firstChild;
        const range = document.createRange();
        range.setStart(text, 0); range.setEnd(text, 3);
        getSelection().removeAllRanges(); getSelection().addRange(range);
        text.parentElement.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      });
      await page.waitForFunction(() => document.querySelector("#codex-highlighter-toolbar-host")?.style.display === "block");
      await page.evaluate(() => document.querySelector("#codex-highlighter-toolbar-host")
        .shadowRoot.querySelector('[data-color="green"]').click());
      await page.waitForTimeout(100);
    }
    async function state(page) {
      return page.evaluate(() => ({
        active: JSON.parse(window.__CODEX_HIGHLIGHTER__.exportData()),
        backup: JSON.parse(window.__CODEX_HIGHLIGHTER__.exportRetentionBackup() || "null"),
      }));
    }
    for (const [size, expected] of [[1998, 1999], [1999, 1000], [2000, 1001]]) {
      const page = await setup(size);
      assert.equal((await state(page)).active.highlights.length, size, "Loading must not prune");
      await add(page);
      const value = await state(page);
      assert.equal(value.active.highlights.length, expected);
      assert(value.active.highlights.some((item) => item.exact === "New"));
      if (size < 1999) assert.equal(value.backup, null);
      else {
        assert.deepEqual(value.backup.highlights.map((item) => item.id),
          Array.from({ length: 1000 }, (_, index) => `old-${index}`));
        assert(value.active.highlights.filter((item) => item.id.startsWith("old-"))
          .every((item) => Number(item.id.slice(4)) >= 1000));
        assert.equal(await page.evaluate(() => window.__CODEX_HIGHLIGHTER__.acknowledgeRetentionBackup("wrong-id")), false);
        // Reloading the renderer retains active records and the unacknowledged backup.
        await page.evaluate(() => window.__CODEX_HIGHLIGHTER__.cleanup());
        await page.addScriptTag({ content: script });
        assert.equal((await state(page)).backup.id, value.backup.id);
        assert.equal((await state(page)).active.highlights.length, expected);
        assert.equal(await page.evaluate((id) => window.__CODEX_HIGHLIGHTER__.acknowledgeRetentionBackup(id), value.backup.id), true);
        assert.equal((await state(page)).backup, null);
      }
      await page.close();
    }
    // Failed backup OR failed active-document write must preserve all old records.
    for (const failKey of [key, "codex-highlighter:data:v1"]) {
      const page = await setup(2000);
      const before = (await state(page)).active;
      await page.evaluate((failKey) => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key === failKey) throw new DOMException("Full", "QuotaExceededError");
          return original.call(this, key, value);
        };
      }, failKey);
      await add(page);
      assert.deepEqual((await state(page)).active, before);
      await page.close();
    }
    const pending = await setup(2000);
    await pending.evaluate((key) => localStorage.setItem(key, '{"id":"previous-batch"}'), key);
    await add(pending);
    assert.equal((await state(pending)).active.highlights.length, 2000);
    assert.equal((await state(pending)).backup.id, "previous-batch");
    await pending.close();
    // A second window with stale in-memory data must not restore already-pruned records.
    const first = await setup(2000);
    const second = await first.context().newPage();
    await second.route("http://highlight.test/**", (route) => route.fulfill({
      contentType: "text/html", body: '<main><p id="sample">Second selection.</p></main>',
    }));
    await second.goto("http://highlight.test/");
    await second.addScriptTag({ content: script });
    await add(first);
    await add(second);
    const secondState = await state(second);
    assert.equal(secondState.active.highlights.length, 1002);
    assert(secondState.active.highlights.some((item) => item.exact === "New"));
    assert(secondState.active.highlights.some((item) => item.exact === "Sec"));
    assert.equal(secondState.backup.highlights.length, 1000);
    await second.close(); await first.close();
    // Recoloring at capacity is not a new highlight and must not trigger pruning.
    const recolor = await setup(0);
    await add(recolor);
    await recolor.evaluate(() => {
      const current = JSON.parse(window.__CODEX_HIGHLIGHTER__.exportData());
      for (let index = 0; index < 1999; index++) current.highlights.push({
        id: `filler-${index}`, exact: `not-visible-${index}`, createdAt: index,
      });
      current.updatedAt = Date.now() + 1; current.revision++;
      window.__CODEX_HIGHLIGHTER__.importData(current);
    });
    await recolor.waitForFunction(() => window.__CODEX_HIGHLIGHTER__.health().resolved === 1);
    await add(recolor);
    assert.equal((await state(recolor)).active.highlights.length, 2000);
    assert.equal((await state(recolor)).backup, null);
    await recolor.close();
    console.log("PASS retention boundaries, oldest-first, recovery, storage failures, pending backup, recolor");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
