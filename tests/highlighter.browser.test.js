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

async function selectTextByNeedle(page, selector, needle) {
  await page.evaluate(
    ({ selector, needle }) => {
      const element = document.querySelector(selector);
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const nodes = [];
      let fullText = "";
      let node = walker.nextNode();
      while (node) {
        nodes.push({ node, start: fullText.length, end: fullText.length + node.data.length });
        fullText += node.data;
        node = walker.nextNode();
      }
      const start = fullText.indexOf(needle);
      if (start < 0) throw new Error(`Needle not found: ${needle}`);
      const end = start + needle.length;
      const startNode = nodes.find((item) => start >= item.start && start <= item.end);
      const endNode = nodes.find((item) => end >= item.start && end <= item.end);
      const range = document.createRange();
      range.setStart(startNode.node, start - startNode.start);
      range.setEnd(endNode.node, end - endNode.start);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    },
    { selector, needle },
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
            <div id="plain-card" role="button">
              <div>Plain text</div>
              <pre><code id="plain-code">A1: all members report to the leader\nBlock 12: all edges</code></pre>
            </div>
            <div id="syntax-card" role="button">
              <div>JavaScript</div>
              <pre><code id="syntax-code"><span>const </span><span>answer</span><span> = </span><span>42</span><span>;</span></code></pre>
            </div>
            <div id="table-card" role="button">
              <button id="table-copy" type="button">Copy table</button>
              <table id="metrics-table">
                <thead>
                  <tr><th>模型</th><th>raw MAE</th><th>EMA MAE</th><th>初步结论</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td id="metric-cell-a">A1: 全范围传递</td>
                    <td id="metric-cell-raw"><span>raw </span><strong>1.236</strong></td>
                    <td>1.641 <button id="cell-copy" type="button">Copy value</button></td>
                    <td>公平基线</td>
                  </tr>
                  <tr>
                    <td>B: 严格分圈</td><td>1.257</td><td>1.634</td>
                    <td><span id="repeat-cell-1">0.1</span></td>
                  </tr>
                  <tr>
                    <td>C: 分圈+注意力</td><td>1.253</td><td>1.637</td>
                    <td><span id="repeat-cell-2">0.1</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div id="aria-grid" role="grid">
              <div role="row">
                <div role="columnheader">Model</div>
                <div role="columnheader">Result</div>
              </div>
              <div role="row">
                <div role="gridcell">Model B</div>
                <div id="aria-cell" role="gridcell">strict grouping</div>
              </div>
            </div>
            <button id="real-control" type="button">Do not highlight this control</button>
          </article>
          <div id="short-anchor-zone"></div>
          <div id="duplicate-zone"></div>
          <div id="composer-zone" role="textbox" contenteditable="true"></div>
          <div id="latency-zone"></div>
        </main>
        <aside id="side-chat">
          <article data-message-id="side-message-1">
            <p id="side-answer">Side panel selectable text.</p>
          </article>
        </aside>
        <div id="native-selection-menu"
          style="display:none;position:fixed;z-index:1000;background:white">
          <button type="button">添加到对话</button>
          <button id="ask-side-chat" type="button">在侧边聊天中提问</button>
          <button type="button">更多</button>
        </div>
      </body></html>
    `);
    await page.addScriptTag({ content: script });

    const supported = await page.evaluate(
      () => window.__CODEX_HIGHLIGHTER__.health().supported,
    );
    if (!supported) throw new Error("CSS Highlights API is unavailable");

    await selectTextByNeedle(page, "#plain-code", "Block 12");
    await clickColor(page, "cyan");
    await page.waitForFunction(
      () =>
        window.__CODEX_HIGHLIGHTER__.health().count === 1 &&
        window.__CODEX_HIGHLIGHTER__.health().resolved === 1,
    );
    await selectTextByNeedle(page, "#syntax-code", "answer = 42");
    await clickColor(page, "pink");
    await page.waitForFunction(
      () =>
        window.__CODEX_HIGHLIGHTER__.health().count === 2 &&
        window.__CODEX_HIGHLIGHTER__.health().resolved === 2,
    );
    await selectTextByNeedle(page, "#metric-cell-a", "全范围传递");
    await clickColor(page, "yellow");
    await selectTextByNeedle(page, "#metric-cell-raw", "raw 1.236");
    await clickColor(page, "green");
    await selectTextByNeedle(page, "#repeat-cell-2", "0.1");
    await clickColor(page, "purple");
    await selectTextByNeedle(page, "#aria-cell", "strict grouping");
    await clickColor(page, "cyan");
    await page.waitForFunction(
      () =>
        window.__CODEX_HIGHLIGHTER__.health().count === 6 &&
        window.__CODEX_HIGHLIGHTER__.health().resolved === 6,
    );
    const literalData = await page.evaluate(() =>
      JSON.parse(window.__CODEX_HIGHLIGHTER__.exportData()).highlights.map(
        (anchor) => ({
          exact: anchor.exact,
          tag: anchor.scopeTag,
          color: anchor.color,
          identity: anchor.scopeIdentity,
        }),
      ),
    );
    if (
      !literalData.some(
        (anchor) =>
          anchor.exact === "Block 12" && anchor.tag === "PRE" && anchor.color === "cyan",
      ) ||
      !literalData.some(
        (anchor) =>
          anchor.exact === "answer = 42" && anchor.tag === "PRE" && anchor.color === "pink",
      ) ||
      !literalData.some(
        (anchor) =>
          anchor.exact === "全范围传递" &&
          anchor.tag === "TD" &&
          anchor.color === "yellow",
      ) ||
      !literalData.some(
        (anchor) =>
          anchor.exact === "raw 1.236" &&
          anchor.tag === "TD" &&
          anchor.color === "green",
      ) ||
      !literalData.some(
        (anchor) =>
          anchor.exact === "0.1" &&
          anchor.color === "purple" &&
          /table:0:row:3:cell:3$/.test(anchor.identity),
      ) ||
      !literalData.some(
        (anchor) =>
          anchor.exact === "strict grouping" &&
          anchor.tag === "DIV" &&
          anchor.color === "cyan" &&
          /table:1:row:1:cell:1$/.test(anchor.identity),
      )
    ) {
      throw new Error(
        "Structured text anchors were not preserved: " +
          JSON.stringify(literalData),
      );
    }
    await page.evaluate(() => {
      const table = document.querySelector("#metrics-table");
      table.outerHTML = table.outerHTML;
    });
    await page.waitForFunction(() => {
      const ranges = Array.from(
        CSS.highlights.get("codex-study-highlight-purple") || [],
      );
      return ranges.some(
        (range) => range.startContainer?.parentElement?.id === "repeat-cell-2",
      );
    });
    await page.evaluate(() => {
      const highlighter = window.__CODEX_HIGHLIGHTER__;
      const state = highlighter.syncState();
      highlighter.importData({
        version: 1,
        revision: state.revision + 1,
        updatedAt: Date.now(),
        highlights: [],
      });
    });
    await page.waitForFunction(
      () => window.__CODEX_HIGHLIGHTER__.health().count === 0,
    );
    await page.evaluate(() => {
      const text = document.querySelector("#real-control").firstChild;
      const range = document.createRange();
      range.selectNodeContents(text);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document
        .querySelector("#real-control")
        .dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
    await page.waitForTimeout(120);
    const controlToolbar = await page.evaluate(
      () =>
        document.querySelector("#codex-highlighter-toolbar-host")?.style.display ||
        "none",
    );
    if (controlToolbar !== "none") {
      throw new Error("A real button incorrectly opened the highlight palette");
    }
    await page.evaluate(() => {
      const text = document.querySelector("#cell-copy").firstChild;
      const range = document.createRange();
      range.selectNodeContents(text);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document
        .querySelector("#cell-copy")
        .dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
    await page.waitForTimeout(120);
    const tableControlToolbar = await page.evaluate(
      () =>
        document.querySelector("#codex-highlighter-toolbar-host")?.style.display ||
        "none",
    );
    if (tableControlToolbar !== "none") {
      throw new Error("A real button inside a table incorrectly opened the palette");
    }

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
    await page.evaluate(() => {
      window.__sideChatOpenCount = 0;
      document.querySelector("#ask-side-chat").addEventListener("click", () => {
        window.__sideChatOpenCount += 1;
      });
    });
    await page.click("#ask-side-chat");
    const nativeActionState = await page.evaluate(() => ({
      count: window.__sideChatOpenCount,
      toolbar:
        document.querySelector("#codex-highlighter-toolbar-host")?.style.display ||
        "none",
    }));
    if (nativeActionState.count !== 1 || nativeActionState.toolbar !== "none") {
      throw new Error(
        "Native side-chat action was intercepted by the highlighter: " +
          JSON.stringify(nativeActionState),
      );
    }
    await selectText(page, "#answer", 6, 16);
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
    await page.waitForFunction(
      () =>
        document
          .querySelector("#codex-highlighter-toolbar-host")
          ?.shadowRoot.querySelector("button.delete")?.style.display === "grid",
    );
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

    const staleRangeBaseline = await page.evaluate(() => {
      const fingerprint = (value) => {
        const source = `${value.length}|${value.slice(0, 256)}|${value.slice(-256)}`;
        let hash = 0x811c9dc5;
        for (let index = 0; index < source.length; index += 1) {
          hash ^= source.charCodeAt(index);
          hash = Math.imul(hash, 0x01000193);
        }
        return (hash >>> 0).toString(16).padStart(8, "0");
      };
      const zone = document.querySelector("#latency-zone");
      const highlights = [];
      for (let index = 0; index < 120; index += 1) {
        const text = `Context ${index} selected-token-${index} suffix`;
        const element = document.createElement("p");
        element.id = `latency-${index}`;
        element.dataset.messageId = `latency-message-${index}`;
        element.textContent = text;
        zone.appendChild(element);
        const exact = `selected-token-${index}`;
        const start = text.indexOf(exact);
        highlights.push({
          id: `latency-anchor-${index}`,
          contextKey: "about://blank",
          scopeHash: fingerprint(text),
          scopeIdentity: `data-message-id:latency-message-${index}`,
          scopeTag: "P",
          scopeLead: text,
          scopeTail: text,
          color: "yellow",
          exact,
          prefix: text.slice(0, start),
          suffix: text.slice(start + exact.length),
          start,
          end: start + exact.length,
          createdAt: Date.now() - index,
        });
      }
      const highlighter = window.__CODEX_HIGHLIGHTER__;
      const state = highlighter.syncState();
      highlighter.importData({
        version: 1,
        revision: state.revision + 1,
        updatedAt: Date.now(),
        highlights,
      });
      return {
        revision: state.revision + 1,
        applyCount: highlighter.diagnostics().applyCount,
      };
    });
    await page.waitForFunction(
      (baseline) =>
        window.__CODEX_HIGHLIGHTER__.syncState().revision === baseline.revision &&
        window.__CODEX_HIGHLIGHTER__.health().resolved === 120 &&
        window.__CODEX_HIGHLIGHTER__.diagnostics().applyCount > baseline.applyCount,
      staleRangeBaseline,
    );
    const beforeStaleSelection = await page.evaluate(
      () => window.__CODEX_HIGHLIGHTER__.diagnostics(),
    );
    await page.evaluate(() => {
      document.querySelector("#latency-zone").replaceChildren();
    });
    await selectText(page, "#answer", 0, 5);
    const staleSelectionState = await page.evaluate(() => ({
      toolbarDisplay: document.querySelector("#codex-highlighter-toolbar-host")
        ?.style.display,
      diagnostics: window.__CODEX_HIGHLIGHTER__.diagnostics(),
    }));
    if (staleSelectionState.toolbarDisplay !== "block") {
      throw new Error("Palette did not appear with stale resolved ranges");
    }
    if (staleSelectionState.diagnostics.lastToolbarMs > 100) {
      throw new Error(
        `Palette latency exceeded 100ms: ${JSON.stringify(staleSelectionState)}`,
      );
    }
    if (
      staleSelectionState.diagnostics.applyCount !==
      beforeStaleSelection.applyCount
    ) {
      throw new Error("Selection synchronously triggered a full re-anchor pass");
    }
    await page.keyboard.press("Escape");

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
