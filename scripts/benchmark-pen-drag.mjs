import {chromium} from '@playwright/test';
import {writeFile, readFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {cpus, platform, arch} from 'node:os';
import {PEN_DRAG_CORPUS, createPenDragFixtures} from './create-pen-drag-fixtures.ts';

const output = process.env.CANOLI_PEN_DRAG_OUTPUT ?? `/tmp/canoli-pen-drag-${Date.now()}`;
const selected = process.env.CANOLI_PEN_DRAG_CASES?.split(',');
if (selected?.some(id => !PEN_DRAG_CORPUS.some(f => f.id === id))) throw new Error('Unknown vector fixture.');
const fixtures = PEN_DRAG_CORPUS.filter(f => !selected || selected.includes(f.id));
const tool = 'pen';
const baseURL = process.env.CANOLI_PEN_DRAG_URL ?? 'http://127.0.0.1:4173/';
const profiled = process.env.CANOLI_PEN_DRAG_PROFILE === '1';
const fixtureDirectory = process.env.CANOLI_PEN_DRAG_FIXTURES ?? join(output, 'fixtures');
const save = (name, value) => writeFile(join(output, name), JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
await mkdir(output, {recursive: true});
if (!process.env.CANOLI_PEN_DRAG_FIXTURES) await createPenDragFixtures(fixtureDirectory);
const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
const reports = [];
try {
  // Native positive control: the task begins before the captured interval.
  const control = await browser.newContext();
  let longTaskControl;
  try {
    const page = await control.newPage();
    await page.evaluate(() => {
      const s = {first: 0, last: 0, entries: [], ready: false}; window.vectorTaskControl = s;
      const observer = new PerformanceObserver(list => {
        s.entries.push(...list.getEntries().map(e => ({start: e.startTime, duration: e.duration})));
        s.ready = s.first > 0 && s.entries.some(e => e.duration >= 50 && e.start < s.first && e.start + e.duration >= s.first);
      });
      observer.observe({type: 'longtask'}); s.finish = () => observer.disconnect();
      setTimeout(() => {
        const begin = performance.now(); while (performance.now() < begin + 10) { /* before capture */ }
        s.first = performance.now(); while (performance.now() < s.first + 65) { /* deliberate control */ }
        s.last = performance.now();
      }, 0);
    });
    await page.waitForFunction(() => window.vectorTaskControl.ready);
    longTaskControl = await page.evaluate(() => {const s = window.vectorTaskControl; s.finish(); return {first: s.first, last: s.last, entries: s.entries, passed: s.ready};});
  } finally {await control.close();}
  for (const fixture of fixtures) {
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(baseURL);
      if (await page.evaluate(() => 'luma' in window)) throw new Error('Use a normal production build.');
      // Install before import, retaining marker tags on the initial cached frame
      // too. Repeated movement may then measure genuine unchanged cache hits.
      await page.evaluate(tool => {
        const s = {armed: false, start: 0, first: 0, last: 0, x: 20, y: 20, sequence: 0, frames: [], tasks: [], fills: 0, copies: 0};
        window.vectorProbe = s;
        const p = CanvasRenderingContext2D.prototype, fill = p.fill, draw = p.drawImage, clear = p.clearRect;
        const bitmap = window.createImageBitmap, tags = new WeakMap(), starts = new WeakMap();
        const begin = p.beginPath, move = p.moveTo;
        p.beginPath = function (...args) {starts.delete(this); return begin.apply(this, args);};
        p.moveTo = function (x, y) {if (!starts.has(this)) {const t=this.getTransform(); starts.set(this, {x:t.a*x+t.c*y+t.e,y:t.b*x+t.d*y+t.f});} return move.call(this,x,y);};
        p.fill = function (...args) {
          const result = fill.apply(this, args);
          if (this.fillStyle === '#f01122' && starts.has(this)) {
            tags.set(this.canvas, starts.get(this)); s.fills++;
          }
          return result;
        };
        p.clearRect = function (...args) {tags.delete(this.canvas); return clear.apply(this, args);};
        p.drawImage = function (...args) {
          const result = draw.apply(this, args), point = tags.get(args[0]);
          if (!point) return result;
          const source = args[0];
          let sx = 0, sy = 0, sw = source.width, sh = source.height, dx = args[1], dy = args[2], dw = sw, dh = sh;
          if (args.length === 5) {dw = args[3]; dh = args[4];}
          if (args.length === 9) {sx = args[1]; sy = args[2]; sw = args[3]; sh = args[4]; dx = args[5]; dy = args[6]; dw = args[7]; dh = args[8];}
          if (!(point.x >= sx && point.x < sx + sw && point.y >= sy && point.y < sy + sh)) return result;
          const t = this.getTransform(), x = (point.x - sx) * dw / sw + dx, y = (point.y - sy) * dh / sh + dy;
          const at = {x: t.a * x + t.c * y + t.e, y: t.b * x + t.d * y + t.f};
          tags.set(this.canvas, at); s.copies++;
          if (s.start && this.canvas.isConnected && this.canvas.closest('.canvas-wrap')) {
            const box = this.canvas.getBoundingClientRect(), wrap = document.querySelector('.canvas-wrap').getBoundingClientRect();
            const zoom = wrap.width / 800;
            const wantedControl = {x: wrap.left + s.x * zoom, y: wrap.top + s.y * zoom};
            const wanted = {x: (wantedControl.x - box.left) * this.canvas.width / box.width, y: (wantedControl.y - box.top) * this.canvas.height / box.height};
            let control = null;
            if (tool === 'pen') {
              const rect = document.querySelector('[data-testid="pen-controls"] rect')?.getBoundingClientRect();
              if (!rect) return result;
              control = {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2};
              if (Math.abs(control.x - wantedControl.x) >= .02 || Math.abs(control.y - wantedControl.y) >= .02) return result;
            }
            if (Math.abs(wanted.x - at.x) < .02 && Math.abs(wanted.y - at.y) < .02) {
              s.last = performance.now(); s.frames.push({ms: s.last - s.start, x: s.x, y: s.y, sequence: s.sequence, at, wanted, control, wantedControl}); s.start = 0;
            }
          }
          return result;
        };
        window.createImageBitmap = async function (...args) {
          const point = tags.get(args[0]), result = await bitmap.apply(this, args);
          if (point) tags.set(result, point); return result;
        };
        const capture = event => {
          if (s.armed && event.buttons === 1) {
            s.start=performance.now(); s.first ||= s.start;
            const wrap=document.querySelector('.canvas-wrap').getBoundingClientRect(), zoom=wrap.width/800;
            s.x=(event.clientX-wrap.left)/zoom; s.y=(event.clientY-wrap.top)/zoom; s.sequence++;
          }
        };
        window.addEventListener('pointermove', capture, true);
        const entries = list => list.map(e => ({start: e.startTime, duration: e.duration}));
        const observer = new PerformanceObserver(list => s.tasks.push(...entries(list.getEntries())));
        observer.observe({type: 'longtask'});
        s.finish = () => {
          s.armed = false; s.tasks.push(...entries(observer.takeRecords())); observer.disconnect();
          window.removeEventListener('pointermove', capture, true); p.beginPath=begin; p.moveTo=move; p.fill = fill; p.drawImage = draw; p.clearRect = clear; window.createImageBitmap = bitmap;
        };
      }, tool);
      const bytes = await readFile(join(fixtureDirectory, fixture.id + '.luma'));
      const fixtureHash = createHash('sha256').update(bytes).digest('hex');
      const setupStart = await page.evaluate(() => performance.now());
      await page.getByTestId('project-input').setInputFiles({name: fixture.id + '.luma', mimeType: 'application/x-luma', buffer: bytes});
      const select = page.getByRole('button', {name: 'Select Moving vectors', exact: true});
      await select.waitFor(); await select.click();
      await page.getByRole('button', {name: 'Fit canvas (Mod+0)', exact: true}).click();
      await page.getByRole('button', {name: tool === 'pen' ? 'Vector pen (P)' : 'Move tool (V)', exact: true}).click();
      await page.waitForFunction(() => !document.querySelector('footer .status-dot.working'));
      await page.evaluate(async () => {await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));});
      if (tool === 'pen' && await page.getByTestId('pen-controls').locator('rect').count() !== fixture.paths * fixture.anchors) throw new Error('Missing Pen anchors.');
      if (!(await page.locator('footer').textContent())?.includes('Standard rendering')) throw new Error('This Canvas2D presentation proxy requires the displayed Standard rendering backend; use separate hardware telemetry for WebGPU.');
      const setupMs = await page.evaluate(start => performance.now() - start, setupStart);
      const pixels = () => page.locator('.canvas-wrap canvas').evaluate(c => c.toDataURL());
      const before = await pixels();
      const wrap = await page.locator('.canvas-wrap').boundingBox();
      const zoom = wrap.width/800;
      await page.mouse.move(wrap.x+20*zoom,wrap.y+20*zoom); await page.mouse.down();
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.evaluate(() => {window.vectorProbe.armed = true;});
      const cdp = profiled ? await context.newCDPSession(page) : null;
      if (cdp) {await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');}
      for (let i = 0; i < 20; i++) {
        await page.mouse.move(wrap.x+(22+i*2)*zoom,wrap.y+(21+i)*zoom);
        await page.waitForFunction(n => window.vectorProbe.frames.length === n, i + 1, {timeout: 30_000});
      }
      if (cdp) {const {profile} = await cdp.send('Profiler.stop'); await save(fixture.id + '-profile.json', profile); await cdp.detach();}
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      const report = await page.evaluate(() => {
        const s = window.vectorProbe; s.finish();
        return {frames: s.frames, samples: s.frames.map(f => f.ms), observedTasks: s.tasks, interval: {first: s.first, last: s.last},
          longTasks: s.tasks.filter(t => t.start + t.duration >= s.first && t.start <= s.last), fills: s.fills, copies: s.copies, x: s.x, y: s.y,
          backend: document.querySelector('footer')?.textContent, developerGlobal: 'luma' in window,
          entryScripts: [...document.scripts].map(s => s.src).filter(Boolean)};
      });
      report.pixelsChanged = before !== await pixels();
      await page.mouse.up();
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      if (!report.pixelsChanged || Math.abs(report.x-60)>.02 || Math.abs(report.y-40)>.02 || report.samples.length !== 20) throw new Error('Invalid measured movement.');
      // Read through the real isolated API; no host/debug object or direct DTO mutation.
      await page.getByRole('button', {name: 'Scripts (Mod+Shift+K)', exact: true}).click();
      await page.getByLabel('Script code', {exact: true}).fill("const p=document.selectedLayer.paths.at(0).points[0];if(Math.abs(p.x-60)>.02||Math.abs(p.y-40)>.02)throw new Error('Unexpected anchor position');print('Vector final matched',document.selectedLayer.paths.length,p.x,p.y);");
      await page.getByRole('button', {name: 'Run script', exact: true}).click();
      await page.getByLabel('Script output').filter({hasText: `Vector final matched ${fixture.paths} `}).waitFor();
      report.modelVerification = await page.getByLabel('Script output').textContent();
      await page.getByRole('button', {name: 'Close scripts', exact: true}).click();
      await page.keyboard.press('Control+z');
      await page.waitForFunction(expected => document.querySelector('.canvas-wrap canvas')?.toDataURL() === expected, before);
      report.undoExact = before === await pixels();
      if (!report.undoExact || errors.length) throw new Error('Undo or page errors: ' + JSON.stringify(errors));
      const percentile = samples => [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * .95) - 1];
      Object.assign(report, {fixture: {...fixture, tool}, setupMs, fixtureBytes: bytes.length, fixtureSha256: fixtureHash,
        p95Ms: percentile(report.samples), maxMs: Math.max(...report.samples)});
      reports.push(report); await save(fixture.id + '.json', report);
      console.log(JSON.stringify({id: fixture.id, tool, p95Ms: report.p95Ms, maxMs: report.maxMs, longTasks: report.longTasks.map(t => t.duration)}));
    } finally {await context.close();}
  }
  await save('report.json', {reports, longTaskControl, profiled, baseURL,
    environment: {chromium: browser.version(), node: process.version, cpu: cpus()[0]?.model, os: platform(), arch: arch(), viewport: {width: 1440, height: 1000}},
    limits: 'Paced pointer moves to matching native path-start geometry copied into the connected canvas and matching displayed anchor center. Browser paint/composition/display can follow. Native project import and font/handle setup, PNG snapshots and exact undo are outside measured input intervals. Positive control runs in a separate page. One drag has twenty paced moves and one undo entry; not continuous throughput or long-session acceptance. Synthetic fixtures, no physical GPU/input-to-photon, peak memory or complete F14 claim.'});
} finally {await browser.close();}
console.log(`Report: ${join(output, 'report.json')}`);
