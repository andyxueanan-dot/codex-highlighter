"use strict";

const port = Number(process.argv[2] || 9460);

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
          params: { expression, returnByValue: true },
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
    (target) =>
      target.type === "page" &&
      target.url.startsWith("app://") &&
      !target.url.includes("avatar-overlay"),
  );
  for (const target of pages) {
    const cleaned = await evaluate(
      target,
      "Boolean(window.__CODEX_HIGHLIGHTER__?.cleanup?.())",
    );
    process.stdout.write(`${target.id} cleanup=${cleaned}\n`);
  }
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
