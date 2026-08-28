"use strict";

const port = Number(process.argv[2] || 9460);
const highlightNeedle = process.argv[3] || "";

async function evaluate(target, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`Timed out: ${target.id}`));
    }, 5000);
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
  const pages = targets.filter(
    (target) => target.type === "page" && target.url.startsWith("app://"),
  );
  const encodedNeedle = JSON.stringify(highlightNeedle);
  for (const target of pages) {
    const result = await evaluate(
      target,
      `(() => ({
        href: location.href,
        title: document.title,
        readyState: document.readyState,
        highlighter: window.__CODEX_HIGHLIGHTER__?.health?.() || null,
        highlighterDiagnostics:
          window.__CODEX_HIGHLIGHTER__?.diagnostics?.() || null,
        mainElements: document.querySelectorAll('main').length,
        roleMainElements: document.querySelectorAll('[role="main"]').length,
        bodyTextLength: (document.body?.innerText || '').length,
        highlightLocations: (() => {
          const needle = ${encodedNeedle};
          if (!needle) return [];
          const result = [];
          for (const [name, highlight] of CSS.highlights || []) {
            if (!name.startsWith('codex-study-highlight-')) continue;
            for (const range of highlight) {
              if (range.toString() !== needle) continue;
              const parent = range.startContainer?.parentElement;
              result.push({
                color: name.replace('codex-study-highlight-', ''),
                tag: parent?.tagName || '',
                editable: Boolean(parent?.closest(
                  "input,textarea,[contenteditable='true'],[contenteditable='']," +
                  "[role='textbox'],[data-lexical-editor='true']"
                ))
              });
            }
          }
          return result;
        })(),
        bodyChildren: [...(document.body?.children || [])].map(node => ({
          tag: node.tagName,
          id: node.id,
          role: node.getAttribute('role'),
          className: String(node.className || '').slice(0, 160)
        }))
      }))()`,
    );
    process.stdout.write(
      `${JSON.stringify({ id: target.id, url: target.url, result }, null, 2)}\n`,
    );
  }
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
