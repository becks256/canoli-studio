import { useEffect, useLayoutEffect, useRef, useState } from "react";
import{samePreviewSelection,type GesturePreviews,type GesturePreview}from'../gesture-previews';
import {subscribeNativeFontChanges} from '../../fonts/native-events';
import type { RefObject } from "react";
import type { EditorApplication } from "../../editor";
import type { DocumentData } from "../../core/model";
import type { RenderOptions, RenderRegion } from "../../engine/renderer";
import type { WetPaintPreview } from '../../engine/wet-preview';

export interface UseCanvasRendererOptions {
  editor: EditorApplication;
  viewDocument: DocumentData;
  assets: EditorApplication["assets"];
  renderRegion: RenderRegion;
  zoom: number;
  paintPreview: RenderOptions["paintPreview"];
  colorProof?: RenderOptions["colorProof"];
  wetPreview?: WetPaintPreview | null;
  previewGesture?: object | null;
  gestureRef?: RefObject<object | null>;
  gesturePreviews?: GesturePreviews;
  backendState: unknown;
  displayHost: RefObject<HTMLDivElement | null>;
  onCleanupCursor?(): void;
  onError?(message: string): void;
}

export interface UseCanvasRendererResult {
  rendering: boolean;
  renderError: string | null;
  renderBackend: "webgpu" | "canvas2d" | null;
  paintedRegion: RenderRegion;
  proofStatus: "pending" | "applied" | "failed" | "off";
}

export function useCanvasRenderer({
  editor,
  viewDocument,
  assets,
  renderRegion,
  zoom,
  paintPreview,
  colorProof = editor.colorSettings?.proof ?? null,
  wetPreview,
  previewGesture,
  gestureRef,
  gesturePreviews,
  backendState,
  displayHost,
  onCleanupCursor,
  onError,
}: UseCanvasRendererOptions): UseCanvasRendererResult {
  const colorState=editor.colorSettings;
  const documentOwner = editor.document;
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [proofFrame,setProofFrame]=useState<{proof:typeof colorProof;failed:boolean;colorState:typeof colorState}|null>(null);
  const [fontRevision, setFontRevision] = useState(0);
  useEffect(() => {
    const fonts = document.fonts;
    const changed = () => setFontRevision((value) => value + 1);
    fonts?.addEventListener("loadingdone", changed);
    fonts?.addEventListener("loadingerror", changed);
    const stopOwned=subscribeNativeFontChanges(fonts,changed);
    return () => {
      stopOwned();
      fonts?.removeEventListener("loadingdone", changed);
      fonts?.removeEventListener("loadingerror", changed);
    };
  }, []);

  const [renderBackend, setRenderBackend] = useState<
    "webgpu" | "canvas2d" | null
  >(null);
  const [paintedRegion, setPaintedRegion] = useState<RenderRegion>({
    x: 0,
    y: 0,
    width: 1600,
    height: 1200,
  });

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onCleanupCursorRef = useRef(onCleanupCursor);
  onCleanupCursorRef.current = onCleanupCursor;

  const latestRender = useRef<{
    owner: EditorApplication["document"];
    committedEdit: boolean;
    document: DocumentData;
    colorState:typeof colorState;
    assets: typeof assets;
    key: number;
    options: RenderOptions;
    region: RenderRegion;
    gesture?: object | null;
    preview?: GesturePreview;
    immediateGesture?: boolean;
    sourceDocument: DocumentData;
    zoom: number;
    fontRevision: number;
    backendState: unknown;
    hostAssets: typeof assets;
    wetPreview?: WetPaintPreview | null;
    release?: () => void;
  } | null>(null);
  const renderTarget = useRef<typeof latestRender.current>(null);
  const renderActive = useRef(false);
  const renderVersion = useRef(0);
  const gestureFrame = useRef<{ gesture: object; ready: Promise<void> } | null>(null);
  const presentedDocument = useRef<EditorApplication["document"] | null>(null);
  const frameWait = useRef<{ wake(): void } | null>(null);

  async function waitForFrame(ready: Promise<void>, cancel?: () => void) {
    let wake!: () => void;
    const interrupted = new Promise<void>(resolve => {
      wake = () => { cancel?.(); resolve(); };
    });
    const current = { wake };
    frameWait.current = current;
    try { await Promise.race([ready, interrupted]); }
    finally { if (frameWait.current === current) frameWait.current = null; }
  }

  const isObsolete = (job: NonNullable<typeof latestRender.current>): boolean => {
    const target = renderTarget.current;
    // An older prefix of the SAME live stroke may be displayed while
    // its next frame waits. Never show an old revision/view/gesture.
    const sameStroke =
      target && target.options.colorProof === job.options.colorProof && target.colorState === job.colorState &&
      job.options.paintPreview &&
      target.options.paintPreview?.stroke.id ===
        job.options.paintPreview.stroke.id &&
      target.options.paintPreview.layerId ===
        job.options.paintPreview.layerId &&
      target.options.paintPreview.maskMode ===
        job.options.paintPreview.maskMode &&
      target.document === job.document &&
      target.assets === job.assets &&
      target.region === job.region &&
      target.fontRevision === job.fontRevision &&
      target.backendState === job.backendState &&
      target.options.scale === job.options.scale;

    const sameGesture = target && target.options.colorProof === job.options.colorProof && target.colorState === job.colorState && job.gesture &&
      target.gesture === job.gesture && gestureRef?.current === job.gesture &&
      target.sourceDocument === job.sourceDocument &&
      editor.document.getSnapshot().document === job.sourceDocument &&
      target.assets === job.assets && editor.assetStore === job.assets &&
      target.region === job.region && target.zoom === job.zoom &&
      target.fontRevision === job.fontRevision &&
      target.backendState === job.backendState;

    const sameWet=target&&target.options.colorProof===job.options.colorProof&&target.colorState===job.colorState&&job.wetPreview&&target.wetPreview?.owner===job.wetPreview.owner&&
      job.wetPreview.isCurrent()&&target.sourceDocument===job.sourceDocument&&
      target.hostAssets===job.hostAssets&&target.region===job.region&&target.zoom===job.zoom&&
      target.fontRevision===job.fontRevision&&target.backendState===job.backendState;

    return !!(
      editor.document !== job.owner ||
      editor.document.getSnapshot().document !== job.sourceDocument ||
      editor.assetStore !== job.hostAssets ||
      editor.colorSettings !== job.colorState ||
      (editor.colorSettings?.proof??null) !== (job.options.colorProof??null) ||
      (job.wetPreview&&!job.wetPreview.isCurrent()) ||
      job.options.paintPreview?.cloneSource?.isDisposed ||
      (job.preview && (!gesturePreviews?.getSnapshot()?.valid ||
        gesturePreviews.getSnapshot()?.owner!==job.owner ||
        gesturePreviews.getSnapshot()?.source!==job.sourceDocument ||
        !samePreviewSelection(editor.document.getSnapshot().selectedIds,job.preview.selection))) ||
      (job.gesture && (gestureRef?.current !== job.gesture ||
        editor.document.getSnapshot().document !== job.sourceDocument)) ||
      (!sameStroke && !sameGesture && !sameWet && job.key !== renderVersion.current) ||
      !displayHost.current
    );
  };


  useLayoutEffect(() => {
    const owner = documentOwner;
    const sourceDocument = owner.getSnapshot().document;
    const previous = renderTarget.current;
    if (presentedDocument.current !== owner) presentedDocument.current = null;
    // React has already committed this atomic content revision. Views and
    // previews still coalesce at a frame boundary; a new owner must fit first.
    const committedEdit = presentedDocument.current === owner &&
      previous?.owner === owner && previous.sourceDocument !== sourceDocument &&
      previous.sourceDocument.id === sourceDocument.id &&
      previous.region === renderRegion && previous.zoom === zoom &&
      previous.fontRevision === fontRevision && previous.backendState === backendState &&
      previous.colorState === colorState && previous.options.colorProof === colorProof &&
      previous.hostAssets === assets && viewDocument === sourceDocument &&
      !paintPreview && !wetPreview && !previewGesture;
    const livePreview=()=>{
      const captured=gesturePreviews?.getSnapshot(),state=owner.getSnapshot(),tools=editor.tools.getSnapshot();
      return captured?.valid&&captured.owner===owner&&editor.document===owner&&captured.source===sourceDocument&&state.document===sourceDocument&&
        samePreviewSelection(captured.selection,state.selectedIds)&&captured.gesture&&captured.gesture===gestureRef?.current&&
        !paintPreview&&!wetPreview&&!tools.preview&&!tools.paintPreview&&!tools.wetPreview?.isCurrent()
        ?captured:undefined;
    };
    const captured=livePreview(),gesture=captured?.gesture??previewGesture;
    // Pointer publication and React share this exact validated snapshot; the
    // subsequent layout must not queue the same appearance a second time.
    const represented=!!captured&&previous?.preview===captured&&previous.owner===owner&&previous.sourceDocument===sourceDocument&&
      previous.region===renderRegion&&previous.zoom===zoom&&previous.fontRevision===fontRevision&&previous.backendState===backendState&&
      previous.colorState===colorState&&previous.options.colorProof===colorProof&&previous.hostAssets===assets&&previous.assets===assets;
    if(!represented){
      const key = ++renderVersion.current;
      latestRender.current?.release?.();
      latestRender.current = {
        owner,
        committedEdit,
        document: captured?.document??viewDocument,
        colorState,
        gesture,preview:captured,immediateGesture:!!captured&&presentedDocument.current===owner,
        sourceDocument,
        zoom, fontRevision, backendState,
        assets,
        hostAssets:wetPreview?.hostAssets??assets,
        wetPreview,
        release:wetPreview&&!wetPreview.isDisposed?wetPreview.retain():undefined,
        key,
        region: renderRegion,
        options: {
          region: renderRegion,
          scale: Math.min(1, zoom * window.devicePixelRatio),
          paintPreview,
          colorProof,
        },
      };
      renderTarget.current = latestRender.current;
      // An older view's frame wait must not delay an eligible content edit.
      if (committedEdit) frameWait.current?.wake();
    }

    async function drain() {
      if (renderActive.current) return;
      renderActive.current = true;
      const showRenderingStatus = !paintPreview;
      if (showRenderingStatus) setRendering(true);
      try {
        while (latestRender.current) {
          // Paint is already frame-batched by ToolController. Transforms and
          // wet prefixes share the boundary their previous preparation requested;
          // if that boundary passed during preparation, do not wait a new frame.
          // This permits at most one start per animation frame for the gesture.
          const queued = latestRender.current;
          if (!queued.options.paintPreview && !queued.committedEdit) {
            const prior = gestureFrame.current;
            const cadence = queued.gesture ?? queued.wetPreview?.owner;
            if (cadence && prior?.gesture === cadence) await waitForFrame(prior.ready);
            else if (!queued.wetPreview && !queued.immediateGesture) {
              let frame = 0;
              const ready = new Promise<void>(resolve => {
                frame = requestAnimationFrame(() => resolve());
              });
              await waitForFrame(ready, () => cancelAnimationFrame(frame));
            }
          }
          if (!latestRender.current) break;
          const job = latestRender.current;
          latestRender.current = null;
          const cadence = job.gesture ?? job.wetPreview?.owner;
          gestureFrame.current = cadence ? {
            gesture: cadence,
            ready: new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
          } : null;
          job.options = { ...job.options, isCancelled: () => isObsolete(job) };
          try {
            if(isObsolete(job))continue;
            let result = await editor.renderer.prepareViewport(
              job.document,
              job.assets,
              job.options,
            );
            if (isObsolete(job)) {
              result.dispose();
              continue;
            }

            const present = () => {
              const host = displayHost.current!;
              let canvas = host.querySelector("canvas");
              if (!canvas || canvas.dataset.renderer !== result.backend) {
                canvas = document.createElement("canvas");
                canvas.dataset.renderer = result.backend;
                canvas.dataset.testid = "artwork";
                canvas.setAttribute("aria-label", "Document artwork");
                // A canvas context cannot switch between WebGPU and Canvas2D.
                // Present before replacing the currently visible frame.
                result.present(canvas);
                host.replaceChildren(canvas);
              } else {
                result.present(canvas);
              }
            };

            try {
              try {
                present();
              } catch {
                result.dispose();
                result = await editor.renderer.prepareFallback(
                  job.document,
                  job.assets,
                  job.options,
                );
                if (isObsolete(job)) {
                  continue;
                }
                present();
              }
              presentedDocument.current = job.owner;
            } finally {
              result.dispose();
            }

            setProofFrame({proof:job.options.colorProof??null,failed:false,colorState:job.colorState});
            setRenderError(null);
            setRenderBackend(result.backend);
            setPaintedRegion(job.region);
          } catch (cause) {
            if (!isObsolete(job))setProofFrame(previous=>({proof:job.options.colorProof??null,failed:!!job.options.colorProof||!!previous?.proof||!!previous?.failed,colorState:job.colorState}));
            if (!isObsolete(job)) {
              const message=cause instanceof Error?cause.message:'Rendering failed.';
              setRenderError(message);
              onErrorRef.current?.(message);
            }
          } finally { job.release?.(); }
        }
      } finally {
        renderActive.current = false;
        if (showRenderingStatus) setRendering(false);
      }
    }

    if(latestRender.current)void drain();
    const stopGestures=gesturePreviews?.subscribe(()=>{
      const captured=livePreview(),target=renderTarget.current;
      if(!captured||!target||presentedDocument.current!==owner||editor.assetStore!==assets||editor.colorSettings!==colorState||
        (editor.colorSettings?.proof??null)!==colorProof||target.owner!==owner||target.sourceDocument!==sourceDocument||
        target.region!==renderRegion||target.zoom!==zoom||target.fontRevision!==fontRevision||target.backendState!==backendState||
        target.assets!==assets||target.hostAssets!==assets||target.colorState!==colorState||target.options.colorProof!==colorProof||
        target.options.paintPreview||target.wetPreview||!displayHost.current)return;
      const key=++renderVersion.current;
      latestRender.current?.release?.();
      latestRender.current={owner,committedEdit:false,document:captured.document,colorState,assets,hostAssets:assets,key,
        region:renderRegion,sourceDocument,zoom,fontRevision,backendState,gesture:captured.gesture,preview:captured,immediateGesture:true,
        options:{region:renderRegion,scale:Math.min(1,zoom*window.devicePixelRatio),colorProof}};
      renderTarget.current=latestRender.current;
      void drain();
    });
    // Continue the captured live stroke directly from the tool's frame batch.
    // New strokes, document edits and viewport changes still enter via React.
    const previewCommand = editor.tools.getSnapshot().preview;
    let seenPreview = paintPreview;
    const stopPaint=editor.tools.subscribe(() => {
      const state = editor.tools.getSnapshot();
      const next = state.paintPreview;
      if (!next || next === seenPreview || !paintPreview ||
          next.stroke.id !== paintPreview.stroke.id ||
          next.layerId !== paintPreview.layerId || next.maskMode !== paintPreview.maskMode ||
          state.preview !== previewCommand ||
          editor.document !== documentOwner ||
          editor.document.getSnapshot().document !== sourceDocument) return;
      seenPreview = next;
      const key = ++renderVersion.current;
      latestRender.current?.release?.();
      latestRender.current = {
        owner: editor.document,
        committedEdit: false,
        document: viewDocument, colorState, assets, key, region: renderRegion,
        hostAssets:assets,
        gesture: previewGesture, sourceDocument, zoom, fontRevision, backendState,
        options: { region: renderRegion, scale: Math.min(1, zoom * window.devicePixelRatio), paintPreview: next, colorProof },
      };
      renderTarget.current = latestRender.current;
      void drain();
    });
    return()=>{stopGestures?.();stopPaint();};
  }, [
    viewDocument,
    assets,
    editor,
    documentOwner,
    renderRegion,
    zoom,
    paintPreview,
    colorProof,
    colorState,
    wetPreview,
    previewGesture,
    gestureRef,
    gesturePreviews,
    backendState,
    fontRevision,
    displayHost,
  ]);

  useEffect(
    () => () => {
      renderVersion.current++;
      latestRender.current?.release?.();
      latestRender.current = null;
      renderTarget.current = null;
      presentedDocument.current = null;
      frameWait.current?.wake();
      onCleanupCursorRef.current?.();
      editor.tools.cancel();
    },
    [editor],
  );

  return {
    rendering,
    renderError,
    renderBackend,
    paintedRegion,
    proofStatus:(proofFrame?.proof!==colorProof||proofFrame?.colorState!==colorState)&&(colorProof||proofFrame?.proof||proofFrame?.failed)?"pending":proofFrame?.failed?"failed":colorProof?"applied":"off",
  };
}
