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
   await page.route("http://highlight.test/**", route => route.fulfill({contentType:"text/html",body:'<main><p id="sample">New selected phrase.</p></main>'}));
   await page.goto("http://highlight.test/");
   await page.addScriptTag({content:script});
   await page.evaluate(count => window.__CODEX_HIGHLIGHTER__.importData({version:1,revision:100,updatedAt:Date.now(),
    highlights:Array.from({length:count},(_,i)=>({id:`old-${i}`,exact:`unrelated-${i}`,createdAt:1000+i,color:"yellow"})).reverse()}),count);
   await page.waitForTimeout(100);
   return page;
  }
  async function add(page) {
   await page.evaluate(()=>{const n=document.querySelector('#sample').firstChild;const r=document.createRange();r.setStart(n,0);r.setEnd(n,3);getSelection().removeAllRanges();getSelection().addRange(r);n.parentElement.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));});
   await page.waitForFunction(()=>document.querySelector('#codex-highlighter-toolbar-host')?.style.display==='block');
   await page.evaluate(()=>document.querySelector('#codex-highlighter-toolbar-host').shadowRoot.querySelector('[data-color="green"]').click());
  }
  const state = page => page.evaluate(()=>({active:JSON.parse(window.__CODEX_HIGHLIGHTER__.exportData()),backup:JSON.parse(window.__CODEX_HIGHLIGHTER__.exportRetentionBackup()||'null')}));
  const ack = (page,id) => page.evaluate(id=>window.__CODEX_HIGHLIGHTER__.acknowledgeRetentionBackup(id),id);
  for(const [count,expected] of [[1998,1999],[1999,1000],[2000,1001]]) {
   const page=await setup(count); await add(page); const pending=await state(page);
   if(count<1999){assert.equal(pending.active.highlights.length,expected);assert.equal(pending.backup,null);}
   else {
    assert.equal(pending.active.highlights.length,count,'Do not prune before disk ack');
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),null,'No backup in localStorage');
    assert.deepEqual(pending.backup.highlights.map(a=>a.id),Array.from({length:1000},(_,i)=>`old-${i}`));
    assert.equal(await ack(page,'wrong'),false);
    assert.equal(await ack(page,pending.backup.id),true);
    const done=await state(page);assert.equal(done.active.highlights.length,expected);assert(done.active.highlights.some(a=>a.exact==='New'));assert.equal(done.backup,null);
   }
   await page.context().close();
  }
  // No room for a duplicate backup in page storage: disk confirmation still allows a smaller active list.
  const full=await setup(2000);
  await full.evaluate(key=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===key)throw new DOMException('Full','QuotaExceededError');return original.call(this,k,v);};},key);
  await add(full);const fullBackup=(await state(full)).backup;assert(fullBackup);
  assert.equal(await ack(full,fullBackup.id),true);assert.equal((await state(full)).active.highlights.length,1001);
  await full.context().close();
  const blocked=await setup(2000);const before=(await state(blocked)).active;
  await blocked.evaluate(()=>{window.originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('Full','QuotaExceededError');};});
  await add(blocked);const batch=(await state(blocked)).backup;
  assert.equal(await ack(blocked,batch.id),false);assert.deepEqual((await state(blocked)).active,before);
  await blocked.evaluate(()=>{Storage.prototype.setItem=window.originalSet;});
  assert.equal(await ack(blocked,batch.id),true);await blocked.context().close();
  const reload=await setup(2000);await add(reload);await add(reload);assert.equal((await state(reload)).active.highlights.length,2000);
  await reload.evaluate(()=>window.__CODEX_HIGHLIGHTER__.cleanup());await reload.addScriptTag({content:script});
  assert.equal((await state(reload)).active.highlights.length,2000);assert.equal((await state(reload)).backup,null);await reload.context().close();
  const changed=await setup(2000);await add(changed);const pending=(await state(changed)).backup;
  await changed.evaluate(()=>{const h=window.__CODEX_HIGHLIGHTER__,d=JSON.parse(h.exportData());d.revision++;d.updatedAt=Date.now()+1;d.highlights.pop();h.importData(d);});
  assert.equal(await ack(changed,pending.id),false);assert.equal((await state(changed)).active.highlights.length,1999);await changed.context().close();
  const legacy=await setup(2000);await legacy.evaluate(key=>localStorage.setItem(key,'{"id":"legacy"}'),key);
  assert.equal(await ack(legacy,'legacy'),true);assert.equal((await state(legacy)).active.highlights.length,2000);await legacy.context().close();
  console.log('PASS disk-first retention, quota, no-ack/reload, revision guard, legacy backup');
  const repair=await setup(1999);
  assert.equal(await repair.evaluate(()=>window.__CODEX_HIGHLIGHTER__.requestRetention()),true);
  const repairBatch=(await state(repair)).backup;
  assert.equal(await ack(repair,repairBatch.id),true);
  assert.equal((await state(repair)).active.highlights.length,999);
  await repair.context().close();
  const large=await setup(0);
  const result=await large.evaluate(()=>{
   const h=window.__CODEX_HIGHLIGHTER__;
   h.importData({version:1,revision:500,updatedAt:Date.now()+2,highlights:Array.from({length:1100},(_,i)=>({id:String(i),exact:'汉😀\\'.repeat(550),createdAt:i}))});
   const expected=h.exportData(),meta=h.beginExport('data');let joined='',maxBytes=0;
   for(let offset=0;offset<meta.length;){const p=h.readExportChunk(meta.id,offset);joined+=p;offset+=p.length;maxBytes=Math.max(maxBytes,new TextEncoder().encode(JSON.stringify(p)).length);}
   h.endExport(meta.id);
   const d=JSON.parse(joined);d.revision++;d.updatedAt+=1;const input=JSON.stringify(d),id=h.beginImport();
   for(let offset=0;offset<input.length;){let end=Math.min(offset+32768,input.length);if(end<input.length&&/[\uD800-\uDBFF]/.test(input[end-1]))end--;h.appendImportChunk(id,offset,input.slice(offset,end));offset=end;}
   const imported=h.finishImport(id);
   return {equal:expected===joined,bytes:new TextEncoder().encode(JSON.stringify(expected)).length,maxBytes,imported,roundtrip:h.exportData()===input};
  });
  assert(result.bytes>4*1024*1024);assert(result.maxBytes<256*1024);assert(result.equal&&result.imported&&result.roundtrip);
  await large.context().close();console.log('PASS >4 MiB chunked Chinese/emoji transfer');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
