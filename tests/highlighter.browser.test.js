"use strict";

const fs = require("fs");
const { chromium } = require("playwright");

const scriptPath = process.argv[2];
const chromePath = process.argv[3];
if (!scriptPath || !chromePath) {
  throw new Error("Usage: node highlighter.browser.test.js <script> <chrome>");
}

const script = fs.readFileSync(scriptPath, "utf8");

async function selectText(page, start, end) {
  await page.evaluate(
    ({ start, end }) => {
      const text = document.querySelector("#answer").firstChild;
      const range = document.createRange();
      range.setStart(text, start);
      range.setEnd(text, end);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document
        .querySelector("#answer")
        .dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    },
    { start, end },
  );
  await page.waitForFunction(
    () =>
      document.querySelector("#codex-highlighter-toolbar-host")?.style.display ===
      "block",
  );
}

async function clickMarker(page) {
  await page.evaluate(() => {
    document
      .querySelector("#codex-highlighter-toolbar-host")
      .shadowRoot.querySelector("button")
      .click();
  });
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath,
  });
  const page = await browser.newPage();
  try {
    await page.setContent(`
      <!doctype html>
      <html><head><meta charset="utf-8"><title>Codex fixture</title></head>
      <body>
        <nav>Sidebar text that must not be highlighted</nav>
        <main id="non-chat-main"><p>Unrelated first main region.</p></main>
        <main>
          <article data-message-id="message-1">
            <p id="answer">Alpha beta gamma delta. Stable anchoring test.</p>
          </article>
        </main>
      </body></html>
    `);
    await page.addScriptTag({ content: script });

    const supported = await page.evaluate(
      () => window.__CODEX_HIGHLIGHTER__.health().supported,
    );
    if (!supported) throw new Error("CSS Highlights API is unavailable");

    await selectText(page, 6, 16);
    await clickMarker(page);
    await page.waitForFunction(
      () => window.__CODEX_HIGHLIGHTER__.health().resolved === 1,
    );

    const added = await page.evaluate(() => ({
      health: window.__CODEX_HIGHLIGHTER__.health(),
      data: JSON.parse(window.__CODEX_HIGHLIGHTER__.exportData()),
    }));
    if (added.health.count !== 1 || added.data.highlights[0].exact !== "beta gamma") {
      throw new Error("Selection was not persisted correctly");
    }

    await selectText(page, 16, 22);
    const adjacentMode = await page.evaluate(() =>
      document
        .querySelector("#codex-highlighter-toolbar-host")
        .shadowRoot.querySelector("button").dataset.mode,
    );
    if (adjacentMode !== "add") {
      throw new Error("An adjacent selection was incorrectly treated as overlapping");
    }
    await page.keyboard.press("Escape");

    await page.evaluate(() => {
      document.querySelector("article").outerHTML = `
        <article data-message-id="message-1">
          <p id="answer">Alpha beta gamma delta. Stable anchoring test.</p>
        </article>`;
    });
    await page.waitForFunction(
      () => window.__CODEX_HIGHLIGHTER__.health().resolved === 1,
    );

    await selectText(page, 6, 16);
    const removalMode = await page.evaluate(() => ({
      mode: document
        .querySelector("#codex-highlighter-toolbar-host")
        .shadowRoot.querySelector("button").dataset.mode,
      selected: getSelection().toString(),
      health: window.__CODEX_HIGHLIGHTER__.health(),
      data: JSON.parse(window.__CODEX_HIGHLIGHTER__.exportData()),
    }));
    if (removalMode.mode !== "remove") {
      throw new Error(`Existing highlight was not detected: ${JSON.stringify(removalMode)}`);
    }
    await clickMarker(page);
    await page.waitForFunction(
      () => window.__CODEX_HIGHLIGHTER__.health().count === 0,
    );

    const finalHealth = await page.evaluate(
      () => window.__CODEX_HIGHLIGHTER__.health(),
    );
    if (finalHealth.count !== 0 || finalHealth.resolved !== 0) {
      throw new Error("Highlight toggle did not remove the anchor");
    }

    process.stdout.write("PASS browser-add-reanchor-remove\n");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
