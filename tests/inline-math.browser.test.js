"use strict";
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const script = fs.readFileSync(process.argv[2], "utf8");
const formula = (id, symbol, tex = symbol) => `<span id="${id}" class="katex"><span class="katex-mathml"><math><semantics><mi>${symbol}</mi><annotation encoding="application/x-tex">${tex}</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span class="mord">${symbol}</span></span></span>`;

(async () => {
  const browser = await chromium.launch({ executablePath: process.argv[3], headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<style>.katex-mathml{position:absolute;clip:rect(1px,1px,1px,1px);width:1px;height:1px;overflow:hidden}td{padding:16px}.mord{font-style:italic}</style><main><article data-message-id="math-table"><table><tbody>
      <tr><td>${formula('first-n','N')}</td><td>Earlier symbol</td></tr>
      <tr><td>${formula('second-n','N')}</td><td>Selected symbol</td></tr>
      <tr><td>${formula('letter-a','a')}</td><td id="mixed">第 ${formula('letter-i','i','\\mathit{i}')} 个原子</td></tr>
      <tr><td>${formula('script-a','𝒜','\\mathcal{A}')}</td><td id="mixed-all">第 ${formula('other-i','i')} 个与 ${formula('letter-k','k')} 对应</td></tr>
      <tr><td><span class="katex" id="subscript"><span class="katex-mathml"><math><semantics><msub><mi>τ</mi><mi>i</mi></msub><annotation encoding="application/x-tex">\\tau_i</annotation></semantics></math></span><span class="katex-html"><span>τ</span><sub>i</sub></span></span></td><td>原子角色标签</td></tr>
      </tbody></table><p id="ordinary">Standalone ordinary text</p></article></main>`);
    await page.addScriptTag({ content: script });
    async function select(selector, mode) {
      await page.evaluate(({ selector, mode }) => {
        const e = document.querySelector(selector), r = document.createRange();
        if (mode === 'mixed-end') { r.setStart(e.firstChild, 0); r.setEnd(e.querySelector('mi').firstChild, 1); }
        else r.selectNodeContents(e);
        getSelection().removeAllRanges(); getSelection().addRange(r);
        e.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      }, { selector, mode });
      await page.waitForFunction(() => document.querySelector('#codex-highlighter-toolbar-host')?.style.display === 'block');
    }
    async function color(name) {
      await page.evaluate(name => document.querySelector('#codex-highlighter-toolbar-host').shadowRoot.querySelector(`[data-color="${name}"]`).click(), name);
      await page.waitForTimeout(100);
    }
    const cases = [
      ['#second-n .katex-html', 'contents', 'yellow', 'N'],
      ['#letter-a mi', 'contents', 'green', 'a'],
      ['#mixed', 'mixed-end', 'pink', '第 i'],
      ['#script-a', 'contents', 'purple', '𝒜'],
      ['#mixed-all', 'contents', 'cyan', '第 i 个与 k 对应'],
      ['#subscript', 'contents', 'purple', 'τi'],
    ];
    for (const [selector, mode, shade, exact] of cases) {
      await select(selector, mode); await color(shade);
      const saved = await page.evaluate(() => JSON.parse(window.__CODEX_HIGHLIGHTER__.exportData()).highlights.at(-1));
      assert.equal(saved?.exact, exact, `${selector}: selected text not saved correctly`);
      assert.equal(saved.color, shade);
    }
    await page.waitForFunction((count) => window.__CODEX_HIGHLIGHTER__.health().resolved === count, cases.length);
    const owner = () => page.evaluate(() => {
      const range = [...CSS.highlights.get('codex-study-highlight-yellow')][0];
      return range?.startContainer?.parentElement?.closest('.katex')?.id;
    });
    assert.equal(await owner(), 'second-n', 'Duplicate N must not move to the first formula');
    await page.evaluate(() => { const t = document.querySelector('table'); t.outerHTML = t.outerHTML; });
    await page.waitForFunction(() => [...CSS.highlights.get('codex-study-highlight-yellow')].some(r => r.toString() === 'N' && r.startContainer.isConnected));
    assert.equal(await owner(), 'second-n');
    await select('#second-n .katex-html','contents');
    await page.waitForFunction(() => document.querySelector('#codex-highlighter-toolbar-host').shadowRoot.querySelector('.delete').style.display === 'grid');
    await color('green');
    assert.equal(await page.evaluate(() => JSON.parse(window.__CODEX_HIGHLIGHTER__.exportData()).highlights.find(a=>a.exact==='N').color), 'green');
    await select('#second-n .katex-html','contents');
    await page.evaluate(() => document.querySelector('#codex-highlighter-toolbar-host').shadowRoot.querySelector('.delete').click());
    assert.equal(await page.evaluate(() => window.__CODEX_HIGHLIGHTER__.health().count),cases.length - 1);
    // When the exact formula disappears, a different same-letter formula must not inherit its highlight.
    await select('#second-n .katex-html','contents'); await color('yellow');
    await page.evaluate(() => {document.querySelector('#second-n').textContent='removed';});
    await page.waitForFunction((count) => window.__CODEX_HIGHLIGHTER__.health().resolved === count, cases.length - 1);
    assert.equal(await page.evaluate(() => CSS.highlights.get('codex-study-highlight-yellow').size),0);
    // Pre-1.2.11 anchors used raw text offsets, including the hidden MathML copy.
    await page.evaluate(() => {
      const h = window.__CODEX_HIGHLIGHTER__, data = JSON.parse(h.exportData());
      const scope = document.querySelector('#mixed');
      const text = scope.textContent, exact = '个原子', start = text.indexOf(exact);
      const source = `${text.length}|${text.slice(0,256)}|${text.slice(-256)}`;
      let hash = 0x811c9dc5;
      for (let i=0;i<source.length;i++) hash = Math.imul(hash ^ source.charCodeAt(i),0x01000193);
      data.highlights = [{id:'legacy', exact, start, end:start+exact.length,
        scopeHash:(hash>>>0).toString(16).padStart(8,'0'), scopeTag:'TD',
        scopeIdentity:'data-message-id:math-table|table:0:row:2:cell:1',
        scopeLead:text, scopeTail:text, prefix:text.slice(0,start), suffix:'',color:'yellow'}];
      data.updatedAt = Date.now()+1; data.revision++;
      h.importData(data);
    });
    await page.waitForFunction(() => [...CSS.highlights.get('codex-study-highlight-yellow')].some(r => r.toString()==='个原子' && r.startContainer.parentElement.id==='mixed'));
    console.log('PASS inline symbols, element boundaries, mixed prose/MathML, duplicate isolation, rerender, recolor/delete');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
