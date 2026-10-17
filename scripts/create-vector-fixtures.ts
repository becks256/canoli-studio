import {Document, VectorLayer, VectorPath, TextLayer} from '../src/dom/index';
import {serializeProject} from '../src/core/project';
import {writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const VECTOR_INPUT_CORPUS = [
  {id: 'paths-20', paths: 20, layers: 1, anchors: 4},
  {id: 'paths-200', paths: 200, layers: 1, anchors: 4},
  {id: 'paths-1000', paths: 1000, layers: 1, anchors: 4},
  {id: 'paths-200-layers-64', paths: 200, layers: 64, anchors: 4},
  {id: 'curves-200', paths: 200, layers: 1, anchors: 100},
] as const;

/** Constructor-built synthetic projects; no raw DTO mutation or raster dependencies. */
export async function createVectorInputFixtures(directory: string) {
  await mkdir(directory, {recursive: true});
  const manifest = [];
  for (const fixture of VECTOR_INPUT_CORPUS) {
    const doc = new Document({width: 800, height: 600, name: fixture.id});
    for (let i = 1; i < fixture.layers; i++) doc.layers.add(new TextLayer({
      text: 'Background ' + i, fontSize: 16, x: i % 10 * 70, y: Math.floor(i / 10) * 50,
    }));
    const layer = new VectorLayer({name: 'Moving vectors'});
    for (let i = 0; i < fixture.paths; i++) {
      const x = 20 + i % 40 * 18, y = 20 + Math.floor(i / 40) * 18;
      const points = fixture.anchors === 4
        ? [{x, y}, {x: x + 12, y}, {x: x + 12, y: y + 12}, {x, y: y + 12}]
        : Array.from({length: fixture.anchors}, (_, j) => {
          const angle = -Math.PI * .75 + Math.PI * 2 * j / fixture.anchors;
          const radius = j % 2 ? 7 : Math.sqrt(72);
          const px = j === 0 ? x : x + 6 + Math.cos(angle) * radius;
          const py = j === 0 ? y : y + 6 + Math.sin(angle) * radius;
          return {x: px, y: py,
            in: {x: px + Math.sin(angle) * .2, y: py - Math.cos(angle) * .2},
            out: {x: px - Math.sin(angle) * .2, y: py + Math.cos(angle) * .2}};
        });
      layer.paths.add(new VectorPath({points, closed: true, fill: i === 0 ? '#f01122' : '#df2020', stroke: null}));
    }
    doc.layers.add(layer);
    const blob = await serializeProject(doc.toJSON(), {get() {throw new Error('Unexpected raster dependency.');}});
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await writeFile(join(directory, fixture.id + '.luma'), bytes, {flag: 'wx'});
    manifest.push({...fixture, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')});
  }
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx'});
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = process.argv[2] ?? `/tmp/canoli-vector-fixtures-${Date.now()}`;
  console.log(JSON.stringify({directory, fixtures: await createVectorInputFixtures(directory)}, null, 2));
}
