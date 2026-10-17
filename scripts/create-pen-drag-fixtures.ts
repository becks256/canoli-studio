import {Document, VectorLayer, VectorPath} from '../src/dom/index';
import {serializeProject} from '../src/core/project';
import {writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const PEN_DRAG_CORPUS = [
  {id: 'drag-20-paths', paths: 20, anchors: 4},
  {id: 'drag-2000-paths', paths: 2000, anchors: 4},
  {id: 'drag-8000-anchors', paths: 1, anchors: 8000},
] as const;

/** Synthetic native projects; all anchors retained, no scripting transport bypass. */
export async function createPenDragFixtures(directory: string) {
  await mkdir(directory, {recursive: true});
  const manifest = [];
  for (const fixture of PEN_DRAG_CORPUS) {
    const document = new Document({width: 800, height: 600, name: fixture.id});
    const layer = new VectorLayer({name: 'Moving vectors'});
    for (let i = 0; i < fixture.paths; i++) {
      const x = 20+i%50*14, y = 20+Math.floor(i/50)*14;
      const points = fixture.anchors === 4
        ? [{x, y}, {x: x+10, y}, {x: x+10, y: y+10}, {x, y: y+10}]
        : Array.from({length: fixture.anchors}, (_, j) => ({x: 20+j%100*7, y: 20+Math.floor(j/100)*6}));
      layer.paths.add(new VectorPath({points, closed: true, fill: i ? '#df2020' : '#f01122', stroke: null}));
    }
    document.layers.add(layer);
    const project = await serializeProject(document.toJSON(), {get() {throw new Error('Unexpected raster asset.');}});
    const bytes = new Uint8Array(await project.arrayBuffer());
    await writeFile(join(directory, fixture.id+'.luma'), bytes, {flag: 'wx'});
    manifest.push({...fixture, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')});
  }
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2)+'\n', {flag: 'wx'});
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Pass a new fixture directory.');
  console.log(JSON.stringify(await createPenDragFixtures(process.argv[2]), null, 2));
}
