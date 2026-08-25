"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const projectRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(projectRoot, "src", "highlighter.js");
const outputDirectory = path.join(projectRoot, "assets");
const chromePath =
  process.argv[2] || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const highlighter = fs.readFileSync(sourcePath, "utf8");

async function selectRange(page, selector, start, end) {
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

async function addHighlight(page, selector, start, end, color) {
  await selectRange(page, selector, start, end);
  await page.evaluate((color) => {
    document
      .querySelector("#codex-highlighter-toolbar-host")
      .shadowRoot.querySelector(`button[data-color="${color}"]`)
      .click();
  }, color);
  await page.waitForTimeout(120);
}

(async () => {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: chromePath });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 820 },
    deviceScaleFactor: 1,
  });
  try {
    await page.setContent(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            * { box-sizing: border-box; }
            body {
              margin: 0;
              min-height: 820px;
              font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
              color: #22252a;
              background:
                radial-gradient(circle at 18% 10%, rgba(255,235,59,.16), transparent 31%),
                radial-gradient(circle at 88% 5%, rgba(92,225,230,.12), transparent 28%),
                #f5f6f8;
            }
            header {
              height: 92px;
              display: flex;
              align-items: center;
              justify-content: space-between;
              padding: 0 58px;
              border-bottom: 1px solid #e0e3e8;
              background: rgba(255,255,255,.86);
              backdrop-filter: blur(16px);
            }
            .brand { display: flex; align-items: center; gap: 16px; }
            .marker {
              width: 42px; height: 42px; border-radius: 13px;
              background: #ffeb3b; box-shadow: inset 0 -5px rgba(185,160,0,.16), 0 8px 22px rgba(127,110,0,.16);
            }
            h1 { margin: 0; font-size: 26px; letter-spacing: -.5px; }
            .version { color: #6f7680; font-size: 14px; }
            #root {
              display: grid;
              grid-template-columns: minmax(0, 1.55fr) minmax(370px, .85fr);
              gap: 24px;
              padding: 34px 58px 52px;
            }
            main, aside {
              min-height: 610px;
              border: 1px solid #dfe3e9;
              border-radius: 22px;
              background: rgba(255,255,255,.93);
              box-shadow: 0 18px 55px rgba(29,35,45,.08);
              padding: 34px 40px;
            }
            aside { background: rgba(251,252,254,.95); }
            .eyebrow {
              display: inline-flex; align-items: center; gap: 8px;
              margin-bottom: 20px; color: #717782; font-size: 13px; font-weight: 650;
              letter-spacing: .08em; text-transform: uppercase;
            }
            .dot { width: 8px; height: 8px; border-radius: 50%; background: #8be85a; }
            h2 { margin: 0 0 26px; font-size: 22px; }
            p { font-size: 20px; line-height: 1.72; margin: 0 0 22px; }
            .muted { color: #747b86; }
            .tip {
              margin-top: 34px; padding: 18px 20px; border-radius: 15px;
              border: 1px solid #e4e7ec; background: #f7f8fa; font-size: 15px; color: #646b75;
            }
            .native-actions {
              display: none; position: fixed; z-index: 1000;
              align-items: center; overflow: hidden; border: 1px solid #dde1e7;
              border-radius: 13px; background: #fff; box-shadow: 0 8px 25px rgba(0,0,0,.11);
            }
            .native-actions button {
              height: 36px; border: 0; border-right: 1px solid #eceef2;
              padding: 0 14px; background: #fff; color: #3c4149; font-size: 13px;
            }
            .native-actions button:last-child { border-right: 0; }
          </style>
        </head>
        <body>
          <header>
            <div class="brand"><span class="marker"></span><h1>Codex Highlighter</h1></div>
            <div class="version">Persistent · local · five colors</div>
          </header>
          <div id="root">
            <main>
              <div class="eyebrow"><span class="dot"></span>Main transcript</div>
              <h2>Keep the important parts visible</h2>
              <article data-message-id="main-demo">
                <p id="main-one">Persistent highlights stay attached to the words that matter.</p>
                <p id="main-two">Choose yellow, green, cyan, pink, or purple for different ideas.</p>
                <p id="main-three">Select any phrase to open the compact color palette.</p>
              </article>
              <div class="tip">Highlights re-anchor after transcript updates and remain local to your device.</div>
            </main>
            <aside>
              <div class="eyebrow"><span class="dot" style="background:#5ce1e6"></span>Side chat</div>
              <h2>Works across conversation surfaces</h2>
              <article data-message-id="side-demo">
                <p id="side-one">Side-chat answers support the same five colors.</p>
                <p id="side-two">Hover a highlight to reveal the instant delete action.</p>
                <p class="muted">No translation, summarization, or AI actions—just highlighting.</p>
              </article>
            </aside>
          </div>
          <div class="native-actions" id="native-actions">
            <button>Add to conversation</button><button>More</button><button>Ask in side chat</button>
          </div>
        </body>
      </html>
    `);
    await page.addScriptTag({ content: highlighter });

    await addHighlight(page, "#main-one", 11, 36, "yellow");
    await addHighlight(page, "#main-two", 15, 20, "green");
    await addHighlight(page, "#main-two", 22, 26, "cyan");
    await addHighlight(page, "#main-two", 28, 32, "pink");
    await addHighlight(page, "#main-two", 37, 43, "purple");
    await addHighlight(page, "#side-one", 0, 17, "cyan");
    await addHighlight(page, "#side-two", 6, 17, "purple");

    await page.evaluate(() => {
      const text = document.querySelector("#main-three").firstChild;
      const start = text.data.indexOf("compact color palette");
      const range = document.createRange();
      range.setStart(text, start);
      range.setEnd(text, start + "compact color palette".length);
      const rect = range.getBoundingClientRect();
      const nativeActions = document.querySelector("#native-actions");
      nativeActions.style.display = "flex";
      nativeActions.style.left = `${rect.left}px`;
      nativeActions.style.top = `${rect.top - 43}px`;
    });
    await selectRange(page, "#main-three", 30, 51);
    await page.waitForTimeout(180);
    await page.screenshot({
      path: path.join(outputDirectory, "demo-palette.png"),
      fullPage: true,
    });

    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      getSelection().removeAllRanges();
      document.querySelector("#native-actions").style.display = "none";
    });
    const hoverPoint = await page.evaluate(() => {
      const text = document.querySelector("#side-two").firstChild;
      const range = document.createRange();
      range.setStart(text, 6);
      range.setEnd(text, 17);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await page.mouse.move(hoverPoint.x, hoverPoint.y);
    await page.waitForFunction(
      () => document.querySelector("#codex-highlighter-hover-host")?.style.display === "block",
    );
    await page.screenshot({
      path: path.join(outputDirectory, "demo-hover-delete.png"),
      fullPage: true,
    });

    process.stdout.write("Captured README demo screenshots.\n");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
