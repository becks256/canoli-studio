/** Production browser input-to-matching-glyph canvas-copy proxy; see PERFORMANCE_BENCHMARKS.md. */
import {chromium} from '@playwright/test';
import {writeFile, mkdir} from 'node:fs/promises';
import {cpus, platform, arch} from 'node:os';
import {join} from 'node:path';

const corpus = [
  {id: 'plain-one', lines: 1, characters: 14, layers: 1, style: 'plain'},
  {id: 'plain-100', lines: 100, characters: 14, layers: 1, style: 'plain'},
  {id: 'plain-600', lines: 600, characters: 14, layers: 1, style: 'plain'},
  {id: 'long-line', lines: 1, characters: 9900, layers: 1, style: 'plain'},
  {id: 'plain-64', lines: 1, characters: 14, layers: 64, style: 'plain'},
  {id: 'overlay-64', lines: 1, characters: 14, layers: 64, style: 'overlay'},
  {id: 'shadow-64', lines: 1, characters: 14, layers: 64, style: 'shadow'},
  {id: 'unique-600', lines: 600, characters: 14, layers: 1, style: 'plain', unique: true},
  {id: 'shadow-64-large', lines: 1, characters: 14, layers: 64, style: 'shadow', fontSize: 32, blur: 12},
  {id: 'shadow-64-long', lines: 1, characters: 9900, layers: 64, style: 'shadow'},
  {id: 'paragraph-240', lines: 1, characters: 240, layers: 1, style: 'plain', wrapWidth: 320},
  {id: 'paragraph-9900', lines: 1, characters: 9900, layers: 1, style: 'plain', wrapWidth: 320},
  {id: 'paragraph-64', lines: 1, characters: 240, layers: 64, style: 'plain', wrapWidth: 320},
  {id: 'paragraph-wide', lines: 1, characters: 9900, layers: 1, style: 'plain', wrapWidth: 'near-full'},
  {id: 'justify-240', lines: 1, characters: 240, layers: 1, style: 'plain', wrapWidth: 320, justify: true},
  {id: 'justify-9900', lines: 1, characters: 9900, layers: 1, style: 'plain', wrapWidth: 320, justify: true},
  {id: 'justify-64', lines: 1, characters: 240, layers: 64, style: 'plain', wrapWidth: 320, justify: true},
  {id: 'justify-wide', lines: 1, characters: 9900, layers: 1, style: 'plain', wrapWidth: 'near-full', justify: true},
];
const selected = process.env.CANOLI_TYPING_CASES?.split(',');
if (selected?.some(id => !corpus.some(f => f.id === id))) throw new Error('Unknown CANOLI_TYPING_CASES fixture.');
const fixtures = corpus.filter(f => !selected || selected.includes(f.id));
const output = process.env.CANOLI_TYPING_OUTPUT ?? `/tmp/canoli-text-input-${Date.now()}`;
const baseURL = process.env.CANOLI_TYPING_URL ?? 'http://127.0.0.1:4173/';
const profiled = process.env.CANOLI_TYPING_PROFILE === '1';
const save = (name, value) => writeFile(join(output, name), JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
await mkdir(output, {recursive: true});
const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
const reports = [];
try {
  // Prove that native long-task observation retains work beginning before an
  // input timestamp. The deliberate block runs in a separate disposable page,
  // outside every measured fixture and before profiling starts.
  const control = await browser.newContext();
  let longTaskControl;
  try {
    const page = await control.newPage();
    await page.evaluate(() => {
      const state = {first: 0, last: 0, entries: [], ready: false};
      window.canoliLongTaskControl = state;
      const observer = new PerformanceObserver(list => {
        state.entries.push(...list.getEntries().map(e => ({start: e.startTime, duration: e.duration})));
        state.ready = state.first > 0 && state.entries.some(e => e.duration >= 50 && e.start < state.first && e.start + e.duration >= state.first);
      });
      observer.observe({type: 'longtask'});
      state.finish = () => observer.disconnect();
      setTimeout(() => {
        const start = performance.now();
        while (performance.now() < start + 10) { /* pre-input work */ }
        state.first = performance.now();
        while (performance.now() < state.first + 65) { /* measured overlap */ }
        state.last = performance.now();
      }, 0);
    });
    await page.waitForFunction(() => window.canoliLongTaskControl.ready);
    longTaskControl = await page.evaluate(() => {
      const s = window.canoliLongTaskControl; s.finish();
      return {first: s.first, last: s.last, entries: s.entries, passed: s.ready};
    });
  } finally {await control.close();}
  for (const fixture of fixtures) {
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(baseURL);
      if (await page.evaluate(() => 'luma' in window)) throw new Error('Use a normal production build without developer globals.');
      const source = `
        document.resize(800,600);
        for(let i=1;i<${fixture.layers};i++) document.layers.add(new TextLayer({
          text:'Design layer '+i,x:i%10*70,y:Math.floor(i/10)*50,fontSize:${fixture.fontSize ?? 16},color:'#ffffff'
        }));
        const line='Design details'.repeat(Math.ceil(${fixture.characters}/14)).slice(0,${fixture.characters});
        const layer=document.layers.add(new TextLayer({
          text:Array.from({length:${fixture.lines}},(_,i)=>${fixture.unique ? "('L'+String(i).padStart(3,'0')+' '+line.slice(5))" : 'line'}).join('\\n'),
          fontSize:${fixture.fontSize ?? 16},color:'#ffffff'${fixture.justify ? ',paragraphJustify: '+JSON.stringify('inter-word') : ''}${typeof fixture.wrapWidth === 'number' ? ',wrapWidth:'+fixture.wrapWidth : ''}
        }));
        ${fixture.wrapWidth === 'near-full' ? 'layer.wrapWidth=layer.width-1;' : ''}
        ${fixture.style === 'plain' ? '' : `for(const item of document.layers) item.styles=new LayerStyle({
          colorOverlay:{enabled:true,color:'#e09458',opacity:.65},
          dropShadow:{enabled:${fixture.style === 'shadow'},blur:${fixture.blur ?? 3},x:2,y:4,opacity:.5,color:'#362044'}
        });`}
        document.selectedLayer=layer;print('Typing ready');`;
      await page.getByRole('button', {name: 'Scripts (Mod+Shift+K)', exact: true}).click();
      await page.getByLabel('Script code', {exact: true}).fill(source);
      await page.getByRole('button', {name: 'Run script', exact: true}).click();
      try {await page.getByLabel('Script output').filter({hasText: 'Typing ready'}).waitFor();}
      catch(error){throw new Error('Fixture '+fixture.id+' failed to seed: '+await page.getByLabel('Script output').innerText(),{cause:error});}
      await page.getByRole('button', {name: 'Close scripts', exact: true}).click();
      await page.getByRole('button', {name: 'Fit canvas (Mod+0)', exact: true}).click();
      await page.waitForFunction(() => !document.querySelector('footer .status-dot.working'));
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      const input = page.getByRole('textbox', {name: 'Text content', exact: true});
      await input.focus();
      await input.press('Control+Home');
      const original = await input.inputValue();
      const paragraph = fixture.wrapWidth !== undefined;
      if (!(await page.locator('footer').textContent())?.includes('Standard rendering')) throw new Error('This Canvas-copy proxy requires the displayed Standard rendering backend.');
      const paragraphWidth = paragraph ? Number(await page.getByRole('spinbutton', {name: 'Paragraph width', exact: true}).inputValue()) : undefined;
      const justificationMode = fixture.justify ? await page.getByLabel('Justification', {exact: true}).inputValue() : undefined;
      if (fixture.justify && justificationMode !== 'inter-word') throw new Error('Justification fixture was not enabled.');
      const pixels = () => page.locator('.canvas-wrap canvas').evaluate(canvas => canvas.toDataURL());
      const before = await pixels();
      // Hooks observe native Canvas copies and are restored before ending each case.
      // Paragraphs match the complete first token at a visual-line start. The
      // growing typed prefix cannot accept a retained frame of the old text.
      await page.evaluate(paragraph => {
        const state = {start: 0, expected: '', samples: [], tasks: [], first: 0, last: 0, matchedGlyphs: 0, presents: 0, glyphWordSpacings: []};
        window.canoliTyping = state;
        const tags = new WeakMap(), p = CanvasRenderingContext2D.prototype;
        const fill = p.fillText, draw = p.drawImage, clear = p.clearRect, bitmap = window.createImageBitmap;
        p.fillText = function (...args) {
          const result = fill.apply(this, args);
          if (state.start && (paragraph ? String(args[0]).startsWith(state.expected) : args[0] === state.expected)) {tags.set(this.canvas, state.expected); state.matchedGlyphs++; state.glyphWordSpacings.push(Number.parseFloat(this.wordSpacing ?? '0'));}
          return result;
        };
        p.clearRect = function (...args) {tags.delete(this.canvas); return clear.apply(this, args);};
        p.drawImage = function (...args) {
          const result = draw.apply(this, args), tag = tags.get(args[0]);
          if (state.start && tag === state.expected) {
            tags.set(this.canvas, tag);
            if (this.canvas.isConnected && this.canvas.closest('.canvas-wrap')) {
              state.last = performance.now(); state.samples.push(state.last - state.start);
              state.start = 0; state.presents++;
            }
          }
          return result;
        };
        window.createImageBitmap = async function (...args) {
          const tag = tags.get(args[0]), result = await bitmap.apply(this, args);
          if (tag) tags.set(result, tag);
          return result;
        };
        const capture = event => {
          if (event.target.getAttribute?.('aria-label') === 'Text content') {
            state.start = performance.now(); state.first ||= state.start;
            state.expected = paragraph ? event.target.value.split(/[ \t\r\f\n\u2028\u2029]/, 1)[0] : event.target.value.split('\n')[0];
          }
        };
        window.addEventListener('input', capture, true);
        const entries = list => list.map(e => ({start: e.startTime, duration: e.duration}));
        const observer = new PerformanceObserver(list => state.tasks.push(...entries(list.getEntries())));
        observer.observe({type: 'longtask'});
        state.finish = () => {
          state.tasks.push(...entries(observer.takeRecords())); observer.disconnect();
          window.removeEventListener('input', capture, true);
          p.fillText = fill; p.drawImage = draw; p.clearRect = clear; window.createImageBitmap = bitmap;
        };
      }, paragraph);
      const cdp = profiled ? await context.newCDPSession(page) : null;
      if (cdp) {await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');}
      for (let i = 1; i <= 20; i++) {
        await input.pressSequentially('x');
        await page.waitForFunction(count => window.canoliTyping.samples.length === count, i, {timeout: 30_000});
      }
      if (cdp) {
        const {profile} = await cdp.send('Profiler.stop');
        await save(`${fixture.id}-profile.json`, profile); await cdp.detach();
      }
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const report = await page.evaluate(() => {
        const s = window.canoliTyping; s.finish();
        return {samples: s.samples, observedTasks: s.tasks, interval: {first: s.first, last: s.last},
          longTasks: s.tasks.filter(t => t.start + t.duration >= s.first && t.start <= s.last),
          matchedGlyphs: s.matchedGlyphs, glyphWordSpacings: s.glyphWordSpacings, presents: s.presents, backend: document.querySelector('footer')?.textContent,
          developerGlobal: 'luma' in window, entryScripts: [...document.scripts].map(s => s.src).filter(Boolean)};
      });
      if (await input.inputValue() !== 'x'.repeat(20) + original) throw new Error('Typing content mismatch.');
      report.pixelsChanged = before !== await pixels();
      if (!report.pixelsChanged || report.samples.length !== 20 || report.presents !== 20 || errors.length)
        throw new Error(`Invalid measured frame/content or page errors: ${JSON.stringify(errors)}`);
      if (fixture.justify && !report.glyphWordSpacings.some(value => value > 0)) throw new Error('No expanded native word spacing reached the measured glyph draw.');
      const sorted = [...report.samples].sort((a, b) => a - b);
      await page.getByRole('button', {name: 'Move tool (V)', exact: true}).click();
      for (let i = 0; i < 20; i++) await page.keyboard.press('Control+z');
      await page.waitForFunction(expected => document.querySelector('.canvas-wrap canvas')?.toDataURL() === expected, before);
      report.undoExact = before === await pixels() && await input.inputValue() === original;
      if (!report.undoExact || errors.length) throw new Error('Undo or late page error mismatch: '+JSON.stringify(errors));
      Object.assign(report, {p95Ms: sorted[18], maxMs: sorted.at(-1), fixture, paragraphWidth, justificationMode, match: paragraph ? 'complete first token at visual-line start' : 'complete first hard line'});
      reports.push(report); await save(`${fixture.id}.json`, report);
      console.log(JSON.stringify({id: fixture.id, p95Ms: report.p95Ms, maxMs: report.maxMs,
        longTasks: report.longTasks.map(t => t.duration), matchedGlyphs: report.matchedGlyphs}));
    } finally {await context.close();}
  }
  await save('report.json', {reports, environment: {chromium: browser.version(), node: process.version,
    os: platform(), arch: arch(), cpu: cpus()[0]?.model, viewport: {width: 1440, height: 1000}}, profiled, baseURL, longTaskControl,
    limits: '20 paced keys per fixture; edit the first visible line from its start, matching the complete first hard line or complete first token for wrapping paragraphs. Setup, pixel snapshots and exact 20-entry undo are outside timed input. Native Canvas hooks observe input-event-to-matching-glyph canvas copies; browser composition/display can follow. No app debug global, physical input-to-photon, continuous-typing throughput, peak memory or complete F14/device acceptance. Profiler adds overhead. Compare normal builds with the same corpus/environment; retain raw samples and both build identities.'});
} finally {await browser.close();}
console.log(`Report: ${join(output, 'report.json')}`);
