import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';

// A real development React.StrictMode probe, using the actual hooks. Its own Vite
// server uses an ephemeral port/cache and never touches a running lesson or API.
// Run with Node 24: node scripts/check-frame-state.mjs
// --expect-stall is only for proving the original regression before the fix.
const expectStall = process.argv.includes('--expect-stall');
assert(process.argv.slice(2).every(arg => arg === '--expect-stall'), 'Unknown option');
const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'mpt-frame-state-'));
let vite, browser;
const report = { strictMode: true, actualHooks: true, ephemeralVite: true, cloudServices: false, expectStall };
const markup = `<!doctype html><html><body><div id="probe"></div><script type="module">
import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useFrameState, useWhiteboard} from '/src/whiteboard/useWhiteboard.js';
let root;
const tile = (id, text) => ({id, text, kind:'consonant', x:200, y:300, hx:48, hy:848, z:1, order:1, heldBy:null});
function FrameProbe() {
  const [value,set] = useFrameState(0);
  window.frameSetter = set;
  useEffect(() => {set(1); window.probeReady=true;}, []);
  return React.createElement('output', {'data-frame-value':value}, String(value));
}
function TileProbe() {
  const board = useWhiteboard('tutor', () => {});
  const [,force] = useState(0);
  window.deliverTile = () => board.handle({t:'tile:add',tiles:[tile('later-tile','b')]});
  window.forceProbeRender = () => force(value => value + 1);
  useEffect(() => {
    board.handle({t:'board',strip:true,boxes:0,tiles:[tile('initial-tile','a')],strokes:[],pictures:[],pieces:[],offers:[]});
    window.probeReady=true;
  }, []);
  return React.createElement('div', null, board.tiles.map(tile => React.createElement('span', {'data-probe-tile':tile.id,key:tile.id},tile.text)));
}
function mount(Component) {
  root?.unmount();
  window.probeReady=false;
  root=createRoot(document.getElementById('probe'));
  root.render(React.createElement(React.StrictMode,null,React.createElement(Component)));
}
window.mountFrameProbe=()=>mount(FrameProbe);
window.mountTileProbe=()=>mount(TileProbe);
window.unmountProbe=()=>root?.unmount();
mount(FrameProbe);
</script></body></html>`;
try {
  vite = await createServer({ root, configFile:false, cacheDir:join(temporary,'cache'), appType:'custom', logLevel:'error',
    plugins:[react(), {name:'frame-probe-page', configureServer(server) {
      server.middlewares.use(async (req,res,next) => {
        if (req.url !== '/__frame-state') return next();
        try {res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,markup));}
        catch(error) {next(error);}
      });
    }}],
    server:{host:'127.0.0.1',port:0,strictPort:false}, optimizeDeps:{include:['react','react-dom/client']},
  });
  await vite.listen();
  browser = await chromium.launch({headless:true});
  const page = await browser.newPage();
  const errors=[]; page.on('pageerror',error => errors.push(error.message));
  await page.addInitScript(() => {
    let next=0;
    const callbacks=new Map();
    window.requestAnimationFrame=callback => {callbacks.set(++next,callback);return next;};
    window.cancelAnimationFrame=id => callbacks.delete(id);
    window.pendingProbeFrames=()=>callbacks.size;
    window.flushProbeFrames=()=>{const frame=[...callbacks.values()];callbacks.clear();frame.forEach(callback=>callback(performance.now()));};
  });
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__frame-state`);
  await page.waitForFunction(()=>window.probeReady,{},{polling:20});
  const pendingAfterReplay=await page.evaluate(()=>window.pendingProbeFrames());
  await page.evaluate(()=>window.flushProbeFrames());
  await page.waitForTimeout(50);
  const afterReplay=Number(await page.locator('[data-frame-value]').getAttribute('data-frame-value'));
  await page.evaluate(()=>{window.frameSetter(2);window.frameSetter(3);});
  const coalescedFrames=await page.evaluate(()=>window.pendingProbeFrames());
  await page.evaluate(()=>window.flushProbeFrames());
  await page.waitForTimeout(50);
  const afterLaterSet=Number(await page.locator('[data-frame-value]').getAttribute('data-frame-value'));
  report.frameState={pendingAfterReplay,afterReplay,coalescedFrames,afterLaterSet};
  if (expectStall) {
    assert.equal(afterReplay,0,'Original lifecycle should lose the pending value');
    assert.equal(afterLaterSet,0,'Original cancelled handle should block later updates');
  } else {
    assert.equal(pendingAfterReplay,1,'Replay should schedule exactly one replacement frame');
    assert.equal(afterReplay,1,'Pending latest value must survive effect replay');
    assert.equal(coalescedFrames,1,'Multiple updates should share one frame');
    assert.equal(afterLaterSet,3,'The latest subsequent update must render');
  }
  await page.evaluate(()=>{window.frameSetter(4);window.unmountProbe();});
  assert.equal(await page.evaluate(()=>window.pendingProbeFrames()),0,'Unmount must cancel its pending frame');
  await page.evaluate(()=>window.frameSetter(5));
  assert.equal(await page.evaluate(()=>window.pendingProbeFrames()),0,'A late callback after unmount must not leak a frame');
  report.unmountFramesCleared=true;
  await page.evaluate(()=>window.mountTileProbe());
  await page.waitForFunction(()=>window.probeReady,{},{polling:20});
  await page.evaluate(()=>window.flushProbeFrames());
  await page.waitForFunction(()=>document.querySelectorAll('[data-probe-tile]').length===1,{},{polling:20});
  // Server arrival occurs independently of a React click or pointer event. Do not
  // flush animation frames after this discrete tile:add: it must render itself.
  await page.evaluate(()=>setTimeout(()=>window.deliverTile(),20));
  await page.waitForTimeout(100);
  const afterIndependentAdd=await page.locator('[data-probe-tile]').count();
  report.tileAdd={afterIndependentAdd};
  if (expectStall) {
    assert.equal(afterIndependentAdd,1,'Original hook should keep the accepted tile invisible');
    await page.evaluate(()=>window.forceProbeRender());
    await page.waitForFunction(()=>document.querySelectorAll('[data-probe-tile]').length===2,{},{polling:20});
    report.tileAdd.afterUnrelatedRender=await page.locator('[data-probe-tile]').count();
  } else assert.equal(afterIndependentAdd,2,'A server tile:add must render without another click or RAF flush');
  await page.evaluate(()=>window.unmountProbe());
  assert.equal(await page.evaluate(()=>window.pendingProbeFrames()),0);
  assert.deepEqual(errors,[]);
  report.errors=errors;report.passed=true;
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  await vite?.close();
  await rm(temporary,{recursive:true,force:true});
}
