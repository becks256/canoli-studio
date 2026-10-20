import { useEffect, useId, useLayoutEffect, useRef, type RefObject } from "react";
import type { Tool } from "../tools";
import {pointerPenTilt} from '../core/brush-tip';

const paths: Record<string, string> = {
  crosshair: "M12 2V9M12 15V22M2 12H9M15 12H22",
  move: "M12 2V22M2 12H22M8 6L12 2L16 6M8 18L12 22L16 18M6 8L2 12L6 16M18 8L22 12L18 16",
  text: "M8 3H16M12 3V21M8 21H16",
  hand: "M8 12V5Q8 2 10 4V10V3Q12 0 13 3V10V4Q16 2 16 5V11V7Q19 5 19 8V15Q19 21 14 22H10Q7 21 5 17L2 12Q2 9 5 11L8 14",
  grabbing: "M5 10Q4 7 7 7H17Q20 7 20 11V16Q20 21 15 22H10Q7 21 5 18L2 13Q2 10 5 12Z",
  resize: "M3 3L21 21M3 9V3H9M15 21H21V15",
  rotate: "M5 9A8 8 0 1 1 5 17M2 4L5 9L10 7",
};
const roundTools = new Set(["smudge", "mixer", "brush", "pencil", "eraser", "clone", "heal", "dodge", "burn", "quick-select"]);

/** Screen-space cursor; pointer movement updates one DOM node, never the editor tree. */
export function CanvasCursor({ viewport, enabled, tool, spacePan, size, zoom, footprint, copies,texturePreview }: {
  viewport: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  tool: Tool;
  spacePan: boolean;
  size: number;
  zoom: number;
  texturePreview?:string|null;
  copies?:(tool:Tool,event:PointerEvent)=>{a:number;b:number;c:number;d:number;x:number;y:number}[]|null;
  footprint?: (tool:Tool, tilt?:ReturnType<typeof pointerPenTilt>) => {a:number;b:number;c:number;d:number}|null;
}) {
  const root = useRef<HTMLDivElement>(null);
  const clipId=useId().replace(/[^a-zA-Z0-9_-]/g,'');
  const latest = useRef({ enabled, tool, spacePan, size, zoom, footprint, copies,texturePreview });
  latest.current = { enabled, tool, spacePan, size, zoom, footprint, copies,texturePreview };
  const refresh = useRef(() => {});
  useEffect(() => {
    const host = viewport.current!, node = root.current!;
    const svg = node.querySelector("svg")!;
    const circles = svg.querySelectorAll<SVGCircleElement>(":scope > circle");
    const strokes = node.querySelectorAll("path");
    const texture=svg.querySelector<SVGImageElement>('[data-texture-cursor]')!;
    const setTexture=(image:SVGImageElement,url:string|null|undefined,pencil:boolean)=>{
      image.style.display=url?'':'none';
      if(url)image.setAttribute('href',url);else image.removeAttribute('href');
      image.setAttribute('clip-path',`url(#${clipId}-${pencil?'square':'round'})`);
    };
    const ghosts=document.createElementNS("http://www.w3.org/2000/svg","g");ghosts.setAttribute("data-symmetry-cursors", "");svg.append(ghosts);
    const pool:SVGGElement[]=[];
    let last: PointerEvent | null = null, frame: number | null = null;
    let heldHandle: string | null = null, heldRotate = false;
    const hide = () => {
      last = null;
      node.style.display = "none";
      if (host.hasAttribute("data-custom-cursor-active")) delete host.dataset.customCursorActive;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    };
    const draw = () => {
      frame = null;
      const event = last, settings = latest.current;
      if (!settings.enabled || !event || event.pointerType === "touch") { hide(); return; }
      const box = host.getBoundingClientRect();
      const x = event.clientX - box.left, y = event.clientY - box.top;
      if (x < 0 || y < 0 || x >= box.width || y >= box.height) { hide(); return; }
      const target = event.target instanceof Element ? event.target : null;
      const handle = target?.closest("[data-handle], [data-crop-handle]");
      const rotate = heldRotate || target?.closest("[data-rotate]");
      const direction = heldHandle ?? handle?.getAttribute("data-handle") ?? handle?.getAttribute("data-crop-handle");
      if (!direction && !rotate && target?.closest("button, input, select, textarea, a, [role=menu]")) { hide(); return; }
      const pan = settings.spacePan || settings.tool === "hand" || !!(event.buttons & 4);
      const round = !pan && !direction && !rotate && roundTools.has(settings.tool);
      const kind = round ? settings.tool : pan ? (event.buttons ? "grabbing" : "hand") : rotate ? "rotate" : direction ? "resize" : settings.tool === "move" || settings.tool === "text" ? settings.tool : "crosshair";
      let axes = null;
      let copies:ReturnType<NonNullable<typeof settings.copies>>|undefined=null;
      try { copies=round?settings.copies?.(settings.tool,event):null;axes = round ? settings.footprint?.(settings.tool,event.pointerType === 'pen' ? pointerPenTilt(event) : undefined) : null; }
      catch { hide(); return; }
      svg.style.overflow=copies?"hidden":"visible";
      const radius = settings.size * settings.zoom / 2;
      const extent = axes ? Math.max(Math.abs(axes.a)+Math.abs(axes.c),Math.abs(axes.b)+Math.abs(axes.d))*settings.zoom : radius;
      const center = round ? Math.max(extent + 4, 12) : 12;
      const edge = center * 2;
      setTexture(texture,round&&axes&&!copies?settings.texturePreview:null,settings.tool==='pencil');
      if(axes)texture.setAttribute('transform',`matrix(${axes.a*settings.zoom} ${axes.b*settings.zoom} ${axes.c*settings.zoom} ${axes.d*settings.zoom} ${center} ${center})`);
      svg.setAttribute("width", String(copies?box.width:edge)); svg.setAttribute("height", String(copies?box.height:edge));
      svg.setAttribute("viewBox", `0 0 ${copies?box.width:edge} ${copies?box.height:edge}`);
      circles.forEach(circle => {
        circle.style.display = round && !axes && !copies ? "" : "none";
        circle.setAttribute("cx", String(center)); circle.setAttribute("cy", String(center)); circle.setAttribute("r", String(radius));
      });
      const angle = direction === "ne" || direction === "sw" ? 90 : direction === "n" || direction === "s" ? 45 : direction === "e" || direction === "w" ? -45 : 0;
      strokes.forEach(path => {
        path.style.display=copies?"none":"";
        path.setAttribute("d", axes ? settings.tool === 'pencil' ? 'M-1 -1H1V1H-1Z' : 'M1 0A1 1 0 1 0 -1 0A1 1 0 1 0 1 0Z' : round ? `M${center-2} ${center}h4M${center} ${center-2}v4` : paths[kind]);
        path.setAttribute("transform", axes ? `matrix(${axes.a*settings.zoom} ${axes.b*settings.zoom} ${axes.c*settings.zoom} ${axes.d*settings.zoom} ${center} ${center})` : kind === "resize" ? `rotate(${angle} 12 12)` : "");
        path.setAttribute('vector-effect','non-scaling-stroke');
      });
      for(let i=0;i<(copies?.length??0);i++){
        let group=pool[i];if(!group){group=document.createElementNS(svg.namespaceURI,'g') as SVGGElement;const image=document.createElementNS(svg.namespaceURI,'image');for(const [key,value] of Object.entries({x:'-1',y:'-1',width:'2',height:'2',opacity:'.35',preserveAspectRatio:'none'}))image.setAttribute(key,value);group.append(image);for(const [color,width] of [['#111','3'],['#fff','1']]){const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('fill','none');path.setAttribute('stroke',color);path.setAttribute('stroke-width',width);path.setAttribute('vector-effect','non-scaling-stroke');group.append(path);}pool.push(group);ghosts.append(group);}
        setTexture(group.querySelector('image')!,settings.texturePreview,settings.tool==='pencil');
        const p=copies![i];group.style.display='';group.setAttribute('data-symmetry-copy',String(i));group.setAttribute('transform',`matrix(${p.a*settings.zoom} ${p.b*settings.zoom} ${p.c*settings.zoom} ${p.d*settings.zoom} ${x+p.x*settings.zoom} ${y+p.y*settings.zoom})`);
        for(const path of group.querySelectorAll('path'))path.setAttribute('d',settings.tool==='pencil'?'M-1 -1H1V1H-1Z':'M1 0A1 1 0 1 0 -1 0A1 1 0 1 0 1 0Z');
      }
      pool.forEach((group,i)=>{if(i>=(copies?.length??0))group.style.display='none';});
      node.dataset.cursorKind = kind;
      node.style.transform = copies?"translate3d(0,0,0)":`translate3d(${x-center}px, ${y-center}px, 0)`;
      node.style.display = "block";
      if (!host.hasAttribute("data-custom-cursor-active")) host.dataset.customCursorActive = "true";
    };
    const move = (event: PointerEvent) => {
      if (event.type === "pointerdown") {
        const target = event.target instanceof Element ? event.target : null;
        const handle = target?.closest("[data-handle], [data-crop-handle]");
        heldHandle = handle?.getAttribute("data-handle") ?? handle?.getAttribute("data-crop-handle") ?? null;
        heldRotate = !!target?.closest("[data-rotate]");
      }
      if (!event.buttons) { heldHandle = null; heldRotate = false; }
      last = event;
      if (frame === null) frame = requestAnimationFrame(draw);
    };
    refresh.current = () => { if (frame !== null) cancelAnimationFrame(frame); frame = null; if (last) draw(); else if (!latest.current.enabled) hide(); };
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerdown", move);
    host.addEventListener("pointerup", move);
    host.addEventListener("pointerleave", hide);
    host.addEventListener("pointercancel", hide);
    host.addEventListener("contextmenu", hide);
    window.addEventListener("blur", hide);
    document.addEventListener("visibilitychange", hide);
    return () => {
      ghosts.remove();hide(); refresh.current = () => {};
      host.removeEventListener("pointermove", move); host.removeEventListener("pointerdown", move); host.removeEventListener("pointerup", move);
      host.removeEventListener("pointerleave", hide); host.removeEventListener("pointercancel", hide); host.removeEventListener("contextmenu", hide);
      window.removeEventListener("blur", hide); document.removeEventListener("visibilitychange", hide);
    };
  }, [viewport,clipId]);
  useLayoutEffect(() => refresh.current(), [enabled, tool, spacePan, size, zoom, footprint, copies,texturePreview]);
  return <div ref={root} className="canvas-custom-cursor" aria-hidden="true" data-testid="canvas-custom-cursor">
    <svg fill="none" strokeLinecap="round" strokeLinejoin="round">
      <defs><clipPath id={`${clipId}-round`} clipPathUnits="userSpaceOnUse"><circle r="1" fill="white"/></clipPath><clipPath id={`${clipId}-square`} clipPathUnits="userSpaceOnUse"><rect x="-1" y="-1" width="2" height="2" fill="white"/></clipPath></defs>
      <image data-texture-cursor="" x="-1" y="-1" width="2" height="2" opacity=".35" preserveAspectRatio="none"/>
      <circle stroke="#111" strokeWidth="3" /><circle stroke="#fff" strokeWidth="1" />
      <path stroke="#111" strokeWidth="3" /><path stroke="#fff" strokeWidth="1" />
    </svg>
  </div>;
}
