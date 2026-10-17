import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// Keep hostile maps in a bounded child: a regressed dependency must not hang
// Vitest's event loop or allocate an unbounded array in the main test process.
function probe(mode: string) {
  const script = `
    const assert = require('node:assert/strict');
    const {SourceMapConsumer, SourceNode} = require('source-map-js');
    const mode = process.argv[1];
    const code = '.card { color: green; }\\n';
    const leaf = {version:3,sources:['authored.css'],sourcesContent:[code],names:[],mappings:'AAAA'};
    const section = (line, map = leaf) => ({version:3,sections:[{offset:{line,column:0},map}]});
    (async () => {
      if (mode === 'huge-offset') {
        assert.throws(() => new SourceMapConsumer(section(1e12)), /offset/i);
      } else if (mode === 'nested-offset') {
        assert.throws(() => new SourceMapConsumer(section(6000000, section(6000000))), /offset/i);
      } else if (mode === 'bounded-copy') {
        const consumer = new SourceMapConsumer(section(10000000));
        assert.equal(SourceNode.fromStringWithSourceMap(code, consumer).toString(), code);
        let nested = leaf;
        for (let i=0;i<40;i++) nested=section(0,nested);
        const node=SourceNode.fromStringWithSourceMap(code,new SourceMapConsumer(nested));
        assert.equal(node.toString(),code);
        const contents={};node.walkSourceContents((name,value)=>contents[name]=value);
        assert.deepEqual(contents,{'authored.css':code});
      } else {
        const postcss = require('postcss');
        const result = await postcss([]).process(code,{from:'generated.css',to:'output.css',map:{inline:false,annotation:false,prev:leaf}});
        assert.equal(result.css,code);
        const output = new SourceMapConsumer(result.map.toJSON());
        const position = output.originalPositionFor({line:1,column:0});
        assert.ok(position.source.endsWith('authored.css'));
        assert.equal(position.line,1);
        assert.equal(output.sourceContentFor(position.source),code);
      }
      console.log(JSON.stringify({mode,passed:true}));
    })().catch(error=>{console.error(error);process.exitCode=1;});
  `;
  return spawnSync(process.execPath, ['--max-old-space-size=128', '-e', script, mode], {
    cwd: process.cwd(), timeout: 3000, encoding: 'utf8', maxBuffer: 128 * 1024,
  });
}

describe('build source-map security boundary', () => {
  for (const mode of ['huge-offset', 'nested-offset', 'bounded-copy', 'postcss-roundtrip']) {
    it(`preserves bounded processing and source provenance: ${mode}`, () => {
      const result = probe(mode);
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toEqual({ mode, passed: true });
    });
  }
});
