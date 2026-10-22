import {Fragment,type CSSProperties,type ReactNode} from 'react';
import type {WorkspaceLayout,WorkspacePanel} from './workspace-layout';

/** Stable keyed slots preserve the canvas and panel state as DOM order changes. */
export function WorkspaceDock({layout,style,rail,layers,layersResize,canvas,inspectorResize,inspector}:{
 layout:WorkspaceLayout;style:CSSProperties;rail:ReactNode;layers:ReactNode;layersResize:ReactNode;canvas:ReactNode;inspectorResize:ReactNode;inspector:ReactNode;
}){
 const dock=(key:WorkspacePanel)=>{
  const settings=layout.panels[key],panel=<Fragment key="panel">{key==='layers'?layers:inspector}</Fragment>,resize=<Fragment key="resize">{key==='layers'?layersResize:inspectorResize}</Fragment>;
  return <section key={key} className={`workspace-panel-dock dock-${settings.side}`} data-workspace-panel={key} hidden={!settings.visible} aria-label={key==='layers'?'Layers dock':'Properties dock'}>{settings.side==='left'?[panel,resize]:[resize,panel]}</section>;
 };
 return <div className="workspace" style={style}>{[<Fragment key="rail">{rail}</Fragment>,...layout.order.filter(key=>layout.panels[key].side==='left').map(dock),<Fragment key="canvas">{canvas}</Fragment>,...layout.order.filter(key=>layout.panels[key].side==='right').map(dock)]}</div>;
}
