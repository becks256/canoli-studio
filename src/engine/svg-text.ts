import {nativeTextFont} from '../core/text-style';
import {captureExportFonts} from './export-fonts';
import type {SvgDocument} from '../core/svg-masks';
import {planSvgTexts,svgWhitespaceRuns,type SvgWhitespaceRun,type SvgTextLayouts,type SvgTextLayout} from '../core/svg-text';
import {yieldTask} from '../core/task-yield';
import {createCanvas,release} from './canvas';
import {checkExport,type ExportControl} from './export-control';
import type {TextLayerData} from '../core/model';
import {applyTextStyle,measureStyledText} from '../core/text-style';
import {layoutText} from '../core/text-layout';

/** Measure native top-to-alphabetic baselines without copying font files. */
export async function prepareSvgTexts(document:SvgDocument,control?:ExportControl,check:()=>void=()=>{},additional:readonly TextLayerData[]=[]):Promise<{layouts:SvgTextLayouts;check:()=>void}>{
  const visible=planSvgTexts(document),layers=[...visible,...additional],layouts=new Map<string,SvgTextLayout>();
  const measuredLayers=new Set(visible);
  if(!layers.length)return{layouts,check:()=>{}};
  if(typeof globalThis.document==='undefined')throw new Error('SVG text requires browser font measurement.');
  const fonts=captureExportFonts(layers.map(layer=>layer.fontFamily));
  const current=()=>{checkExport(control);check();fonts();};current();
  const canvas=createCanvas(1,1),context=canvas.getContext('2d')!;
  const spacingSupported='letterSpacing' in context;
  let probeHost:HTMLDivElement|undefined,probeTexts:SVGTextElement[]=[];
  let probeLayer:TextLayerData|undefined,probeWordSpacing:number|undefined;
  const configureProbe=(layer:TextLayerData,wordSpacing:number)=>{
    if(!probeHost){
      probeHost=globalThis.document.createElement('div');probeHost.setAttribute('data-canoli-svg-text-probe','');probeHost.setAttribute('aria-hidden','true');probeHost.setAttribute('inert','');probeHost.style.cssText='position:fixed;left:-100000px;top:0;width:1px;height:1px;visibility:hidden;pointer-events:none;contain:strict';
      const shadow=probeHost.attachShadow({mode:'closed'}),svg=globalThis.document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('width','1');svg.setAttribute('height','1');
      probeTexts=[0,1].map(()=>{const text=globalThis.document.createElementNS('http://www.w3.org/2000/svg','text');svg.append(text);return text;});shadow.append(svg);globalThis.document.body.append(probeHost);
    }
    if(probeLayer!==layer||probeWordSpacing!==wordSpacing){
      for(const text of probeTexts){
        const direction=layer.direction??'ltr',align=layer.align;
        const attributes={'x':'0','y':'0','font-family':layer.fontFamily,'font-size':String(layer.fontSize),'font-weight':layer.fontWeight??'normal','font-style':layer.fontStyle??'normal','direction':direction,'text-anchor':align==='center'?'middle':(align==='left')===(direction==='ltr')?'start':'end'};
        for(const[key,value]of Object.entries(attributes))text.setAttribute(key,value);
        text.style.whiteSpace='pre';text.style.fontKerning=layer.fontKerning??'auto';text.style.fontVariantCaps=layer.fontVariantCaps??'normal';text.style.fontStretch=layer.fontStretch??'normal';text.style.wordSpacing=`${wordSpacing}px`;text.style.letterSpacing=`${spacingSupported?(layer.letterSpacing??0):0}px`;
      }
      probeLayer=layer;probeWordSpacing=wordSpacing;
    }
  };
  const setProbeContent=(text:SVGTextElement,line:string,runs:readonly SvgWhitespaceRun[])=>{
    const nodes:Node[]=[];let offset=0;
    for(const run of runs){
      nodes.push(globalThis.document.createTextNode(line.slice(offset,run.start)));
      const span=globalThis.document.createElementNS('http://www.w3.org/2000/svg','tspan');span.setAttribute('word-spacing','0');span.textContent=line.slice(run.start,run.end);nodes.push(span);offset=run.end;
    }
    nodes.push(globalThis.document.createTextNode(line.slice(offset)));text.replaceChildren(...nodes);
  };
  const spacingPlan=async(layer:TextLayerData,line:string,wordSpacing:number):Promise<{runs:SvgWhitespaceRun[];offset:number}|undefined>=>{
    const normalized=line.replace(/[\t\r\f]/g,' ');
    if(!wordSpacing||!/[ \u00a0]/u.test(normalized)||!normalized.replace(/[ \u00a0]/gu,''))return;
    configureProbe(layer,wordSpacing);context.textAlign=layer.align;
    measureStyledText(context,normalized,layer,wordSpacing);
    const nativeMetrics=context.measureText(normalized),native=nativeMetrics.width;
    if(native<0)return; // SVG clamps negative chunk lengths; keep the proven fallback.
    measureStyledText(context,normalized,layer,0);
    const baseMetrics=context.measureText(normalized),nativeBase=baseMetrics.width;
    measureStyledText(context,normalized,layer,wordSpacing);
    const probe=probeTexts[0];probe.textContent=normalized;probe.style.wordSpacing='0px';const svgBase=probe.getComputedTextLength();probe.style.wordSpacing=`${wordSpacing}px`;
    const plain=probe.getComputedTextLength(),response=native-nativeBase,tolerance=Math.max(1/32,Math.abs(response)/64);
    const plainError=Math.abs(plain-svgBase-response);
    if(!Number.isFinite(plainError)||plainError<=tolerance)return;
    // Advance equality alone cannot prove internal placement. Native ink
    // responses must also agree with the outer non-whitespace character cells.
    // Bearings cancel between zero/requested spacing; words stay shaped whole.
    const characters=probe.getNumberOfChars()===normalized.length?normalized.split(''):Array.from(normalized);
    if(probe.getNumberOfChars()!==characters.length)return;
    const edges:number[]=[];
    for(let i=0;i<characters.length;i++)if(!/[\s\u00a0]/u.test(characters[i])&&(i===0||i===characters.length-1||/[\s\u00a0]/u.test(characters[i-1])||/[\s\u00a0]/u.test(characters[i+1])))edges.push(i);
    const extent=async()=>{
      let left=Infinity,right=-Infinity,measured=0;
      for(const i of edges){
        const a=probe.getStartPositionOfChar(i).x,b=probe.getEndPositionOfChar(i).x;left=Math.min(left,a,b);right=Math.max(right,a,b);
        // Character-position reads can each walk the shaped line. A long line
        // must not turn many native reads into one uninterruptible JS batch.
        if(++measured%16===0){checkExport(control);if(performance.now()>=deadline){await yieldTask();current();deadline=performance.now()+8;}}
      }
      return{left,right};
    };
    let baseExtent:{left:number;right:number};
    probe.style.wordSpacing='0px';try{baseExtent=await extent();}finally{probe.style.wordSpacing=`${wordSpacing}px`;}
    const factor=layer.align==='right'?1:layer.align==='center'?.5:0,baseOffset=(svgBase-nativeBase)*factor;
    const nativeLeft=baseMetrics.actualBoundingBoxLeft-nativeMetrics.actualBoundingBoxLeft,nativeRight=nativeMetrics.actualBoundingBoxRight-baseMetrics.actualBoundingBoxRight;
    if(![baseExtent.left,baseExtent.right,nativeLeft,nativeRight].every(Number.isFinite))return;
    let best: {runs:SvgWhitespaceRun[];advance:number;error:number}|undefined;
    const seen=new Set<string>();
    for(const mask of [1,2,4,3,5,6]){
      const runs=svgWhitespaceRuns(normalized,mask),key=JSON.stringify(runs);if(!runs.length||seen.has(key))continue;seen.add(key);
      setProbeContent(probe,normalized,runs);const advance=probe.getComputedTextLength(),bounds=await extent(),offset=(advance-native)*factor-baseOffset;
      const error=Math.max(Math.abs(advance-svgBase-response),Math.abs(bounds.left+offset-baseExtent.left-nativeLeft),Math.abs(bounds.right+offset-baseExtent.right-nativeRight));
      if(Number.isFinite(error)&&(!best||error<best.error))best={runs,advance,error};
      if(performance.now()>=deadline){await yieldTask();current();deadline=performance.now()+8;}
      if(error===0)break;
    }
    if(!best||best.error>tolerance||best.error+tolerance>=plainError)return;
    return{runs:best.runs,offset:(best.advance-native)*factor};
  };
  // Compare whole shaped lines against the same content without boundary
  // spaces. This cancels font bearings while retaining kerning across spaces.
  // Canvas and SVG differ in boundary word spacing and signed chunk advances.
  const boundaryOffset=(layer:TextLayerData,line:string,wordSpacing:number)=>{
    const normalized=line.replace(/[\t\r\f]/g,' '),body=normalized.replace(/^[ \u00a0]+|[ \u00a0]+$/g,'');
    if(!wordSpacing||!body||body===normalized)return 0;
    if(!svgWhitespaceRuns(normalized,4).length)return 0;
    configureProbe(layer,wordSpacing);
    context.textAlign=layer.align;
    const native=context.measureText(body).actualBoundingBoxLeft-context.measureText(normalized).actualBoundingBoxLeft;
    probeTexts[0].textContent=normalized;probeTexts[1].textContent=body;
    const first=normalized.search(/[^ \u00a0]/),svg=probeTexts[0].getStartPositionOfChar(first).x-probeTexts[1].getStartPositionOfChar(0).x,offset=native-svg;
    if(!Number.isFinite(offset))throw new Error('The browser cannot measure SVG word-spacing positions.');
    return Math.abs(offset)<1e-8?0:offset;
  };
  let measured=0,deadline=performance.now()+8;
  try{
    for(const layer of layers){
      current();
      const requested=nativeTextFont(layer);
      // Invalid CSS assignments retain the preceding value. Two sentinels
      // distinguish invalid input from a valid font/color equal to a sentinel.
      context.font='10px serif';context.font=requested;
      if(context.font==='10px serif'){context.font='11px monospace';context.font=requested;if(context.font==='11px monospace')throw new Error('Cannot export invalid text font settings to SVG.');}
      if(globalThis.document.fonts&&!globalThis.document.fonts.check(requested,layer.text))throw new Error('A referenced text font is not loaded. Retry SVG export after fonts are ready.');
      if(!measuredLayers.has(layer)){
        if(++measured%16===0||performance.now()>=deadline){await yieldTask();current();deadline=performance.now()+8;}
        continue;
      }
      context.fillStyle='#010203';context.fillStyle=layer.color;
      if(context.fillStyle==='#010203'){context.fillStyle='#040506';context.fillStyle=layer.color;if(context.fillStyle==='#040506')throw new Error('Cannot export an invalid text color to SVG.');}
      const color=String(context.fillStyle),letterSpacing=spacingSupported?(layer.letterSpacing??0):0;
      applyTextStyle(context,layer);
      const visual=layoutText(layer,(text,spacing)=>measureStyledText(context,text,layer,spacing),layer.width);
      const baselines:number[]=[],xOffsets:number[]=[],spacingRuns:SvgWhitespaceRun[][]=[],offsets=new Map<string,{offset:number;runs:SvgWhitespaceRun[]}>();
      for(const visualLine of visual.lines){
        const line=visualLine.text,wordSpacing=visualLine.wordSpacing??layer.wordSpacing??0;
        measureStyledText(context,line,layer,wordSpacing);
        const key=`${wordSpacing}\0${line}`;
        current();const sample=line||'M';
        let prepared=offsets.get(key);
        if(prepared===undefined){prepared=await spacingPlan(layer,line,wordSpacing)??{offset:boundaryOffset(layer,line,wordSpacing),runs:[]};offsets.set(key,prepared);}
        xOffsets.push(prepared.offset);spacingRuns.push(prepared.runs);
        context.textBaseline='alphabetic';const alphabetic=context.measureText(sample).actualBoundingBoxAscent;
        context.textBaseline='top';const top=context.measureText(sample).actualBoundingBoxAscent;
        const baseline=visualLine.y+alphabetic-top;
        if(!Number.isFinite(baseline))throw new Error('The browser cannot measure SVG text baselines.');
        baselines.push(baseline);
        if(++measured%16===0||performance.now()>=deadline){await yieldTask();current();deadline=performance.now()+8;}
      }
      layouts.set(layer.id,{baselines,color,letterSpacing,xOffsets,spacingRuns,lines:visual.lines.map(line=>line.text),xPositions:visual.lines.map(line=>line.x),wordSpacings:visual.lines.map(line=>line.wordSpacing??layer.wordSpacing??0)});
    }
    current();return{layouts,check:fonts};
  }finally{probeHost?.remove();release(canvas);}
}
