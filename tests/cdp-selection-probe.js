"use strict";

const port = Number(process.argv[2] || 9460);
const needle = process.argv[3] || "Codex Highlighter";

async function evaluate(target, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timeout = setTimeout(() => reject(new Error("CDP timeout")), 5000);
    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true, awaitPromise: true },
        }),
      );
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timeout);
      socket.close();
      if (message.error || message.result?.exceptionDetails) {
        reject(new Error(JSON.stringify(message.error || message.result.exceptionDetails)));
        return;
      }
      resolve(message.result?.result?.value);
    });
    socket.addEventListener("error", reject);
  });
}

(async () => {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
    response.json(),
  );
  const target = targets.find(
    (item) => item.type === "page" && item.url === "app://-/index.html",
  );
  if (!target) throw new Error("Main Codex renderer not found");
  const encodedNeedle = JSON.stringify(needle);
  const result = await evaluate(
    target,
    `new Promise((resolve) => {
      const needle = ${encodedNeedle};
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && (!node.data.includes(needle) || !node.parentElement?.closest('main'))) {
        node = walker.nextNode();
      }
      if (!node) { resolve({ found: false }); return; }
      const start = node.data.indexOf(needle);
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + needle.length);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      node.parentElement.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      setTimeout(() => {
        const host = document.querySelector('#codex-highlighter-toolbar-host');
        const button = host?.shadowRoot?.querySelector('button');
        resolve({
          found: true,
          selected: selection.toString(),
          insideMain: Boolean(node.parentElement.closest('main')),
          toolbarDisplay: host?.style.display || null,
          buttonTitle: button?.title || null,
          health: window.__CODEX_HIGHLIGHTER__?.health?.() || null
        });
      }, 250);
    })`,
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
