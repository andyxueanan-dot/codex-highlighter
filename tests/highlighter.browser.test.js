"use strict";

const fs = require("fs");
const { chromium } = require("playwright");

const scriptPath = process.argv[2];
const chromePath = process.argv[3];
if (!scriptPath || !chromePath) {
  throw new Error("Usage: node highlighter.browser.test.js <script> <chrome>");
}

const script = fs.readFileSync(scriptPath, "utf8");

async function selectText(page, selector, start, end) {
  await page.evaluate(
    ({ selector, start, end }) => {
      const element = document.querySelector(selector);
      const text = element.firstChild;
      const range = document.createRange();
      range.setStart(text, start);
      range.setEnd(text, end);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);

      const selectionRect = range.getBoundingClientRect();
      const nativeMenu = document.querySelector("#native-selection-menu");
      nativeMenu.style.display = "block";
      nativeMenu.style.left = `${Math.max(0, selectionRect.left)}px`;
      nativeMenu.style.top = `${Math.max(0, selectionRect.top - 38)}px`;
      element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    },
    { selector, start, end },
  );
  await page.waitForFunction(
    () =>
      document.querySelector("#codex-highlighter-toolbar-host")?.style.display ===
      "block",
  );
}

async function clickColor(page, color) {
  await page.evaluate((color) => {
    document
      .querySelector("#codex-highlighter-toolbar-host")
      .shadowRoot.querySelector(`button[data-color="${color}"]`)
      .click();
  }, color);
}

async function clickSelectionDelete(page) {
  await page.evaluate(() => {
    document
      .querySelector("#codex-highlighter-toolbar-host")
      .shadowRoot.querySelector("button.delete")
      .click();
  });
}

function intersects(left, right) {
  return !(
    left.right <= right.left ||
    left.left >= right.right ||
    left.bottom <= right.top ||
    left.top >= right.bottom
  );
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath,
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
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
        <aside id="side-chat">
          <article data-message-id="side-message-1">
            <p id="side-answer">Side panel selectable text.</p>
          </article>
        </aside>
        <div id="native-selection-menu"
          style="display:none;position:fixed;z-index:1000;background:white">
          <button type="button">添加到对话</button><button type="button">更多</button>
        </div>
      </body></html>
    `);
    await page.addScriptTag({ content: script });

    const supported = await page.evaluate(
      () => window.__CODEX_HIGHLIGHTER__.health().supported,
    );
    if (!supported) throw new Error("CSS Highlights API is unavailable");

    await selectText(page, "#answer", 6, 16);
    const placement = await page.evaluate(() => {
      const toolbar = document
        .querySelector("#codex-highlighter-toolbar-host")
        .getBoundingClientRect();
      const nativeMenu = document
        .querySelector("#native-selection-menu")
        .getBoundingClientRect();
      return {
        toolbar: {
          left: toolbar.left,
          right: toolbar.right,
          top: toolbar.top,
          bottom: toolbar.bottom,
        },
        nativeMenu: {
          left: nativeMenu.left,
          right: nativeMenu.right,
          top: nativeMenu.top,
          bottom: nativeMenu.bottom,
        },
      };
    });
    if (intersects(placement.toolbar, placement.nativeMenu)) {
      throw new Error("Highlight palette overlaps the native Codex selection menu");
    }
    await clickColor(page, "yellow");
    await page.waitForFunction(
      () => window.__CODEX_HIGHLIGHTER__.health().resolved === 1,
    );

    const added = await page.evaluate(() => ({
      health: window.__CODEX_HIGHLIGHTER__.health(),
      data: JSON.parse(window.__CODEX_HIGHLIGHTER__.exportData()),
      yellowRanges: CSS.highlights.get("codex-study-highlight-yellow")?.size || 0,
    }));
    if (
      added.health.count !== 1 ||
      added.data.highlights[0].exact !== "beta gamma" ||
      added.data.highlights[0].color !== "yellow" ||
      added.yellowRanges !== 1
    ) {
      throw new Error(`Yellow selection was not persisted correctly: ${JSON.stringify(added)}`);
    }

    await selectText(page, "#answer", 16, 22);
    const adjacentDeleteVisible = await page.evaluate(() =>
      document
        .querySelector("#codex-highlighter-toolbar-host")
        .shadowRoot.querySelector("button.delete").style.display,
    );
    if (adjacentDeleteVisible !== "none") {
      throw new Error("An adjacent selection was incorrectly treated as overlapping");
    }
    await page.keyboard.press("Escape");

    await page.evaluate(() => {
      document.querySelector("main article").outerHTML = `
        <article data-message-id="message-1">
          <p id="answer">Alpha beta gamma delta. Stable anchoring test.</p>
        </article>`;
    });
    await page.waitForFunction(
      () => window.__CODEX_HIGHLIGHTER__.health().resolved === 1,
    );

    await selectText(page, "#answer", 6, 16);
    const deleteVisible = await page.evaluate(() =>
      document
        .querySelector("#codex-highlighter-toolbar-host")
        .shadowRoot.querySelector("button.delete").style.display,
    );
    if (deleteVisible !== "grid") {
      throw new Error("Existing highlight did not expose the selection delete button");
    }
    await clickSelectionDelete(page);
    await page.waitForFunction(
      () => window.__CODEX_HIGHLIGHTER__.health().count === 0,
    );

    await selectText(page, "#side-answer", 0, 10);
    await clickColor(page, "purple");
    await page.waitForFunction(
      () =>
        window.__CODEX_HIGHLIGHTER__.health().resolved === 1 &&
        JSON.parse(window.__CODEX_HIGHLIGHTER__.exportData()).highlights[0]
          ?.color === "purple",
    );

    await selectText(page, "#side-answer", 0, 10);
    await clickColor(page, "cyan");
    await page.waitForFunction(
      () =>
        JSON.parse(window.__CODEX_HIGHLIGHTER__.exportData()).highlights[0]
          ?.color === "cyan" &&
        CSS.highlights.get("codex-study-highlight-cyan")?.size === 1,
    );

    const hoverPoint = await page.evaluate(() => {
      const text = document.querySelector("#side-answer").firstChild;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 10);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await page.mouse.move(hoverPoint.x, hoverPoint.y);
    await page.waitForFunction(
      () =>
        document.querySelector("#codex-highlighter-hover-host")?.style.display ===
        "block",
    );
    await page.evaluate(() => {
      document
        .querySelector("#codex-highlighter-hover-host")
        .shadowRoot.querySelector("button")
        .click();
    });
    await page.waitForFunction(
      () => window.__CODEX_HIGHLIGHTER__.health().count === 0,
    );

    const finalHealth = await page.evaluate(
      () => window.__CODEX_HIGHLIGHTER__.health(),
    );
    if (finalHealth.count !== 0 || finalHealth.resolved !== 0) {
      throw new Error("Hover delete did not remove the anchor");
    }

    process.stdout.write(
      "PASS browser-multi-surface-palette-avoidance-reanchor-hover-delete\n",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
