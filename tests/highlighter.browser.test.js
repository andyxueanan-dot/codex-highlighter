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
          <div id="short-anchor-zone"></div>
          <div id="duplicate-zone"></div>
          <div id="composer-zone" role="textbox" contenteditable="true"></div>
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
    await page.waitForTimeout(450);
    const rerenderState = await page.evaluate(() => {
      const data = JSON.parse(window.__CODEX_HIGHLIGHTER__.exportData());
      const text = document.querySelector("main article")?.textContent || "";
      const fingerprint = (value) => {
        const source = `${value.length}|${value.slice(0, 256)}|${value.slice(-256)}`;
        let hash = 0x811c9dc5;
        for (let index = 0; index < source.length; index += 1) {
          hash ^= source.charCodeAt(index);
          hash = Math.imul(hash, 0x01000193);
        }
        return (hash >>> 0).toString(16).padStart(8, "0");
      };
      return {
        health: window.__CODEX_HIGHLIGHTER__.health(),
        anchor: data.highlights[0],
        candidateText: text,
        candidateHash: fingerprint(text),
      };
    });
    if (rerenderState.health.resolved !== 1) {
      throw new Error(`Original re-render did not re-anchor: ${JSON.stringify(rerenderState)}`);
    }

    await selectText(page, "#answer", 6, 16);
    const deleteState = await page.evaluate(() => ({
      display: document
        .querySelector("#codex-highlighter-toolbar-host")
        .shadowRoot.querySelector("button.delete").style.display,
      selection: getSelection().toString(),
      health: window.__CODEX_HIGHLIGHTER__.health(),
      diagnostics: window.__CODEX_HIGHLIGHTER__.diagnostics(),
      range: (() => {
        const resolved = Array.from(
          CSS.highlights.get("codex-study-highlight-yellow") || [],
        )[0];
        const selected = getSelection().rangeCount
          ? getSelection().getRangeAt(0)
          : null;
        return {
          resolvedText: resolved?.toString() || "",
          resolvedConnected: Boolean(resolved?.startContainer?.isConnected),
          sameStartNode: Boolean(
            resolved && selected && resolved.startContainer === selected.startContainer,
          ),
          resolvedStart: resolved?.startOffset ?? -1,
          selectedStart: selected?.startOffset ?? -1,
        };
      })(),
    }));
    if (deleteState.display !== "grid") {
      throw new Error(
        `Existing highlight did not expose delete: ${JSON.stringify(deleteState)}`,
      );
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

    await page.evaluate(() => {
      document.querySelector("#short-anchor-zone").innerHTML =
        '<h3 id="short-answer">3. GAT的四个计算步骤</h3>';
    });
    await selectText(page, "#short-answer", 7, 9);
    await clickColor(page, "yellow");
    await page.waitForFunction(
      () =>
        window.__CODEX_HIGHLIGHTER__.health().count === 1 &&
        window.__CODEX_HIGHLIGHTER__.health().resolved === 1,
    );

    await page.evaluate(() => {
      document.querySelector("#duplicate-zone").innerHTML =
        '<p id="later-short">后面再次出现四个不应高亮。</p>';
      document.querySelector("#composer-zone").innerHTML =
        '<span id="composer-short">我想问这四个配置。</span>';
    });
    await page.waitForTimeout(350);
    const shortAnchor = await page.evaluate(() => {
      const ranges = Array.from(
        CSS.highlights.get("codex-study-highlight-yellow") || [],
      );
      return {
        resolved: window.__CODEX_HIGHLIGHTER__.health().resolved,
        rangeCount: ranges.length,
        ownerId: ranges[0]?.startContainer?.parentElement?.id || "",
      };
    });
    if (
      shortAnchor.resolved !== 1 ||
      shortAnchor.rangeCount !== 1 ||
      shortAnchor.ownerId !== "short-answer"
    ) {
      throw new Error(`Short anchor moved to a duplicate: ${JSON.stringify(shortAnchor)}`);
    }

    await page.evaluate(() => document.querySelector("#short-answer").remove());
    await page.waitForFunction(
      () => window.__CODEX_HIGHLIGHTER__.health().resolved === 0,
    );
    await page.waitForTimeout(350);
    const duplicateState = await page.evaluate(() => {
      const ranges = Array.from(
        CSS.highlights.get("codex-study-highlight-yellow") || [],
      );
      return {
        resolved: window.__CODEX_HIGHLIGHTER__.health().resolved,
        rangeCount: ranges.length,
        ownerId: ranges[0]?.startContainer?.parentElement?.id || "",
      };
    });
    if (duplicateState.resolved !== 0 || duplicateState.rangeCount !== 0) {
      throw new Error(
        `A later duplicate inherited the removed short highlight: ${JSON.stringify(duplicateState)}`,
      );
    }

    await page.evaluate(() => {
      document.querySelector("#short-anchor-zone").innerHTML =
        '<h3 id="short-answer">3. GAT的四个计算步骤</h3>';
    });
    await page.waitForFunction(
      () => window.__CODEX_HIGHLIGHTER__.health().resolved === 1,
    );
    await selectText(page, "#short-answer", 7, 9);
    await clickSelectionDelete(page);
    await page.waitForFunction(
      () => window.__CODEX_HIGHLIGHTER__.health().count === 0,
    );

    await page.evaluate(() => {
      const text = document.querySelector("#composer-short").firstChild;
      const start = text.data.indexOf("四个");
      const range = document.createRange();
      range.setStart(text, start);
      range.setEnd(text, start + 2);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document
        .querySelector("#composer-short")
        .dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
    await page.waitForTimeout(120);
    const editableToolbarDisplay = await page.evaluate(
      () =>
        document.querySelector("#codex-highlighter-toolbar-host")?.style.display ||
        "none",
    );
    if (editableToolbarDisplay !== "none") {
      throw new Error("Editable composer text incorrectly opened the highlight palette");
    }

    const performanceBaseline = await page.evaluate(() => {
      const highlighter = window.__CODEX_HIGHLIGHTER__;
      const current = highlighter.syncState();
      const applyCount = highlighter.diagnostics().applyCount;
      const highlights = Array.from({ length: 600 }, (_, index) => ({
        id: `historical-${index}`,
        contextKey: "about://blank",
        scopeHash: `missing-${index}`,
        scopeIdentity: `data-message-id:historical-${index}`,
        scopeTag: "P",
        scopeLead: `Historical record ${index}`,
        scopeTail: `Historical record ${index}`,
        color: "yellow",
        exact: `historical-token-${index}`,
        prefix: "before ",
        suffix: " after",
        start: 7,
        end: 27,
        createdAt: Date.now() - index,
      }));
      highlighter.importData({
        version: 1,
        revision: current.revision + 1,
        updatedAt: Date.now(),
        highlights,
      });
      return { revision: current.revision + 1, applyCount };
    });
    await page.waitForFunction(
      (baseline) =>
        window.__CODEX_HIGHLIGHTER__.syncState().revision === baseline.revision &&
        window.__CODEX_HIGHLIGHTER__.diagnostics().applyCount > baseline.applyCount,
      performanceBaseline,
    );
    const beforeMutations = await page.evaluate(
      () => window.__CODEX_HIGHLIGHTER__.diagnostics(),
    );
    await page.evaluate(() => {
      const answer = document.querySelector("#answer");
      for (let index = 0; index < 25; index += 1) {
        answer.textContent = `Alpha beta gamma delta. Stream update ${index}.`;
      }
    });
    await page.waitForFunction(
      (applyCount) =>
        window.__CODEX_HIGHLIGHTER__.diagnostics().applyCount > applyCount,
      beforeMutations.applyCount,
    );
    await page.waitForTimeout(1200);
    const afterMutations = await page.evaluate(
      () => window.__CODEX_HIGHLIGHTER__.diagnostics(),
    );
    const applyDelta = afterMutations.applyCount - beforeMutations.applyCount;
    if (applyDelta !== 1) {
      throw new Error(`Mutation burst caused ${applyDelta} re-anchor passes`);
    }
    if (afterMutations.lastFallbackAnchors !== 0) {
      throw new Error(
        `Historical anchors triggered ${afterMutations.lastFallbackAnchors} fallback scans`,
      );
    }
    if (afterMutations.lastApplyMs > 250) {
      throw new Error(
        `Indexed re-anchor exceeded 250ms: ${JSON.stringify(afterMutations)}`,
      );
    }

    process.stdout.write(
      "PASS browser-features-short-anchor-isolation-indexed-performance\n",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
