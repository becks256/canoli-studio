import { describe, expect, it, vi, beforeEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Document, PaintLayer } from "../src/dom";
import { ShortcutRegistry } from "../src/ui/shortcuts";
import {
  useWasmReady,
  useUnsavedChangesWarning,
  useWheelZoom,
  useViewportObserver,
  useEditorShortcuts,
  useCanvasRenderer,
} from "../src/ui/hooks";

// Minimal DOM mock environment for React 19 in Node
class MockNode {
  nodeType: number;
  nodeName: string;
  tagName: string;
  namespaceURI: string;
  childNodes: MockNode[];
  parentNode: MockNode | null;
  ownerDocument: MockDocument | null;
  style: Record<string, string>;
  dataset: Record<string, string>;
  private listeners: Map<string, Set<EventListener>>;

  constructor(nodeType = 1, nodeName = "DIV") {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.tagName = nodeName;
    this.namespaceURI = "http://www.w3.org/1999/xhtml";
    this.childNodes = [];
    this.parentNode = null;
    this.ownerDocument = null;
    this.style = {};
    this.dataset = {};
    this.listeners = new Map();
  }

  appendChild(child: MockNode) {
    this.childNodes.push(child);
    child.parentNode = this;
    return child;
  }

  removeChild(child: MockNode) {
    const idx = this.childNodes.indexOf(child);
    if (idx >= 0) this.childNodes.splice(idx, 1);
    child.parentNode = null;
    return child;
  }

  replaceChildren(...children: MockNode[]) {
    this.childNodes = [];
    for (const child of children) {
      this.appendChild(child);
    }
  }

  querySelector(selector: string): MockNode | null {
    if (selector === "canvas") {
      return this.childNodes.find((c) => c.nodeName === "CANVAS") ?? null;
    }
    return null;
  }

  addEventListener(type: string, listener: EventListener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: Event): boolean {
    const handlers = this.listeners.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        handler(event);
      }
    }
    return !event.defaultPrevented;
  }

  closest(_selector: string): MockNode | null {
    return null;
  }
}

class MockDocument extends MockNode {
  defaultView: MockWindow | null = null;
  activeElement: MockNode | null = null;

  constructor() {
    super(9, "#document");
  }

  createElement(tag: string): MockNode {
    const el = new MockNode(1, tag.toUpperCase());
    el.ownerDocument = this;
    return el;
  }

  createTextNode(text: string): MockNode {
    const el = new MockNode(3, "#text");
    (el as unknown as { textContent: string }).textContent = text;
    el.ownerDocument = this;
    return el;
  }
}

class MockWindow {
  document: MockDocument;
  HTMLIFrameElement = class {};
  devicePixelRatio = 1;
  private listeners: Map<string, Set<EventListener>>;

  constructor(doc: MockDocument) {
    this.document = doc;
    this.listeners = new Map();
  }

  addEventListener(type: string, listener: EventListener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: Event): boolean {
    const handlers = this.listeners.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        handler(event);
      }
    }
    return !event.defaultPrevented;
  }
}

let activeDOM: { doc: MockDocument; win: MockWindow };

function setupMockDOM() {
  const doc = new MockDocument();
  const win = new MockWindow(doc);
  doc.defaultView = win;

  (globalThis as unknown as { window: MockWindow }).window = win;
  (globalThis as unknown as { document: MockDocument }).document = doc;
  (globalThis as unknown as { Element: unknown }).Element = MockNode;
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(cb, 0) as unknown as number;
  (globalThis as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = (id: number) =>
    clearTimeout(id as unknown as NodeJS.Timeout);

  activeDOM = { doc, win };
  return activeDOM;
}

function renderHook<T>(hookFn: () => T) {
  const { doc, win } = activeDOM;
  const container = doc.createElement("div");
  const root = createRoot(container as unknown as Element);
  let result!: T;

  function TestComponent() {
    result = hookFn();
    return null;
  }

  act(() => {
    root.render(React.createElement(TestComponent));
  });

  return {
    get result() {
      return result;
    },
    unmount() {
      act(() => {
        root.unmount();
      });
    },
    win,
    doc,
  };
}

describe("UI Custom Hooks", () => {
  beforeEach(() => {
    setupMockDOM();
  });

  describe("useWasmReady", () => {
    it("returns false initially and true when processor.ready resolves", async () => {
      let resolveReady!: () => void;
      const readyPromise = new Promise<void>((resolve) => {
        resolveReady = resolve;
      });

      const mockEditor = {
        renderer: {
          processor: {
            ready: readyPromise,
          },
        },
      } as unknown as Parameters<typeof useWasmReady>[0];

      const hook = renderHook(() => useWasmReady(mockEditor));
      expect(hook.result).toBe(false);

      await act(async () => {
        resolveReady();
        await readyPromise;
      });

      expect(hook.result).toBe(true);
      hook.unmount();
    });

    it("calls onError if processor.ready rejects", async () => {
      const error = new Error("WASM init failed");
      const readyPromise = Promise.reject(error);
      const onError = vi.fn();

      const mockEditor = {
        renderer: {
          processor: {
            ready: readyPromise,
          },
        },
      } as unknown as Parameters<typeof useWasmReady>[0];

      renderHook(() => useWasmReady(mockEditor, onError));

      await act(async () => {
        try {
          await readyPromise;
        } catch {
          // Expected rejection
        }
      });

      expect(onError).toHaveBeenCalledWith("WASM init failed");
    });
  });

  describe("useUnsavedChangesWarning", () => {
    it("attaches beforeunload listener and warns when there are unsaved changes", () => {
      const dom = new Document();
      dom.layers.add(new PaintLayer({ name: "Layer 1" }));

      const { win } = renderHook(() =>
        useUnsavedChangesWarning(dom, "doc-1:2", "doc-1:1"),
      );

      const event = {
        type: "beforeunload",
        preventDefault: vi.fn(),
        returnValue: undefined as unknown as string,
      };

      win.dispatchEvent(event as unknown as Event);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.returnValue).toBe("");
    });

    it("does not prevent beforeunload when savedStamp matches stamp", () => {
      const dom = new Document();
      dom.layers.add(new PaintLayer({ name: "Layer 1" }));

      const { win } = renderHook(() =>
        useUnsavedChangesWarning(dom, "doc-1:1", "doc-1:1"),
      );

      const event = {
        type: "beforeunload",
        preventDefault: vi.fn(),
        returnValue: undefined as unknown as string,
      };

      win.dispatchEvent(event as unknown as Event);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(event.returnValue).toBeUndefined();
    });

    it("removes listener on unmount", () => {
      const dom = new Document();
      const hook = renderHook(() =>
        useUnsavedChangesWarning(dom, "doc-1:2", "doc-1:1"),
      );
      const removeSpy = vi.spyOn(hook.win, "removeEventListener");

      hook.unmount();
      expect(removeSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));
    });
  });

  describe("useWheelZoom", () => {
    it("attaches non-passive wheel listener and computes exponential zoom factor", () => {
      const el = new MockNode(1, "DIV");
      const ref = { current: el as unknown as HTMLElement };
      const onZoom = vi.fn();

      renderHook(() => useWheelZoom(ref, onZoom));

      const event = {
        type: "wheel",
        deltaY: 100,
        preventDefault: vi.fn(),
      };

      el.dispatchEvent(event as unknown as Event);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(onZoom).toHaveBeenCalledWith(Math.exp(-100 * 0.0015));
    });

    it("removes wheel listener on unmount", () => {
      const el = new MockNode(1, "DIV");
      const ref = { current: el as unknown as HTMLElement };
      const removeSpy = vi.spyOn(el, "removeEventListener");

      const hook = renderHook(() => useWheelZoom(ref, vi.fn()));
      hook.unmount();

      expect(removeSpy).toHaveBeenCalledWith("wheel", expect.any(Function));
    });
  });

  describe("useViewportObserver", () => {
    it("triggers onClearPreview and onFit on initial mount/dom change", () => {
      const dom = new Document();
      const onClearPreview = vi.fn();
      const onFit = vi.fn();
      const onResize = vi.fn();
      const ref = { current: null };

      renderHook(() =>
        useViewportObserver({
          viewportRef: ref,
          dom,
          onClearPreview,
          onFit,
          onResize,
        }),
      );

      expect(onClearPreview).toHaveBeenCalledTimes(1);
      expect(onFit).toHaveBeenCalledTimes(1);
    });

    it("observes element with ResizeObserver and disconnects on unmount", () => {
      const dom = new Document();
      const el = new MockNode(1, "DIV");
      const ref = { current: el as unknown as HTMLElement };

      let observerCallback!: ResizeObserverCallback;
      const observeMock = vi.fn();
      const disconnectMock = vi.fn();

      class MockResizeObserver {
        constructor(cb: ResizeObserverCallback) {
          observerCallback = cb;
        }
        observe = observeMock;
        disconnect = disconnectMock;
        unobserve = vi.fn();
      }
      (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
        MockResizeObserver;

      const onResize = vi.fn();
      const onFit = vi.fn();

      const hook = renderHook(() =>
        useViewportObserver({
          viewportRef: ref,
          dom,
          onClearPreview: vi.fn(),
          onFit,
          onResize,
        }),
      );

      expect(observeMock).toHaveBeenCalledWith(el);

      // Simulate resize
      act(() => {
        observerCallback(
          [
            {
              contentRect: { width: 1280, height: 720 },
            } as unknown as ResizeObserverEntry,
          ],
          {} as ResizeObserver,
        );
      });

      expect(onResize).toHaveBeenCalledWith({ width: 1280, height: 720 });

      hook.unmount();
      expect(disconnectMock).toHaveBeenCalled();
    });
  });

  describe("useEditorShortcuts", () => {
    it("handles Escape key to dismiss modals and cancel tools", () => {
      const cancelMock = vi.fn();
      const onDismissModals = vi.fn();
      const onClearPreview = vi.fn();
      const onResetGestures = vi.fn();

      const editor = {
        tools: { cancel: cancelMock },
      } as unknown as Parameters<typeof useEditorShortcuts>[0]["editor"];

      const shortcuts = new ShortcutRegistry([]);

      const { win } = renderHook(() =>
        useEditorShortcuts({
          shortcuts,
          editor,
          busy: false,
          modalOpen: false,
          onDismissModals,
          onSetSpacePan: vi.fn(),
          onClearPreview,
          onResetGestures,
        }),
      );

      const event = {
        type: "keydown",
        key: "Escape",
      };

      win.dispatchEvent(event as unknown as Event);
      expect(onDismissModals).toHaveBeenCalled();
      expect(cancelMock).toHaveBeenCalled();
      expect(onClearPreview).toHaveBeenCalled();
      expect(onResetGestures).toHaveBeenCalled();
    });

    it("handles Space keydown and keyup for space pan when not typing in text input", () => {
      const onSetSpacePan = vi.fn();

      const editor = {
        tools: { cancel: vi.fn() },
      } as unknown as Parameters<typeof useEditorShortcuts>[0]["editor"];

      const shortcuts = new ShortcutRegistry([]);

      const { win } = renderHook(() =>
        useEditorShortcuts({
          shortcuts,
          editor,
          busy: false,
          modalOpen: false,
          onDismissModals: vi.fn(),
          onSetSpacePan,
          onClearPreview: vi.fn(),
          onResetGestures: vi.fn(),
        }),
      );

      const downEvent = {
        type: "keydown",
        code: "Space",
        target: { tagName: "DIV" },
        preventDefault: vi.fn(),
      };
      win.dispatchEvent(downEvent as unknown as Event);
      expect(downEvent.preventDefault).toHaveBeenCalled();
      expect(onSetSpacePan).toHaveBeenCalledWith(true);

      const upEvent = {
        type: "keyup",
        code: "Space",
      };
      win.dispatchEvent(upEvent as unknown as Event);
      expect(onSetSpacePan).toHaveBeenCalledWith(false);
    });

    it("ignores Space key when typing in text input", () => {
      const onSetSpacePan = vi.fn();

      const editor = {
        tools: { cancel: vi.fn() },
      } as unknown as Parameters<typeof useEditorShortcuts>[0]["editor"];

      const shortcuts = new ShortcutRegistry([]);

      const inputElement = new MockNode(1, "INPUT");
      inputElement.closest = (sel: string) => (sel.includes("input") ? inputElement : null);

      const { win } = renderHook(() =>
        useEditorShortcuts({
          shortcuts,
          editor,
          busy: false,
          modalOpen: false,
          onDismissModals: vi.fn(),
          onSetSpacePan,
          onClearPreview: vi.fn(),
          onResetGestures: vi.fn(),
        }),
      );

      const downEvent = {
        type: "keydown",
        code: "Space",
        target: inputElement,
        preventDefault: vi.fn(),
      };
      win.dispatchEvent(downEvent as unknown as Event);
      expect(downEvent.preventDefault).not.toHaveBeenCalled();
      expect(onSetSpacePan).not.toHaveBeenCalled();
    });

    it("ignores shortcuts when busy or modal is open", () => {
      const handleSpy = vi.fn();
      const shortcuts = { handle: handleSpy } as unknown as ShortcutRegistry;

      const editor = {
        tools: { cancel: vi.fn() },
      } as unknown as Parameters<typeof useEditorShortcuts>[0]["editor"];

      const { win } = renderHook(() =>
        useEditorShortcuts({
          shortcuts,
          editor,
          busy: true,
          modalOpen: false,
          onDismissModals: vi.fn(),
          onSetSpacePan: vi.fn(),
          onClearPreview: vi.fn(),
          onResetGestures: vi.fn(),
        }),
      );

      const event = {
        type: "keydown",
        key: "b",
      };
      win.dispatchEvent(event as unknown as Event);
      expect(handleSpy).not.toHaveBeenCalled();
    });

    it("handles blur event by cancelling tools and resetting gestures", () => {
      const cancelMock = vi.fn();
      const onSetSpacePan = vi.fn();
      const onResetGestures = vi.fn();
      const onClearPreview = vi.fn();

      const editor = {
        tools: { cancel: cancelMock },
      } as unknown as Parameters<typeof useEditorShortcuts>[0]["editor"];

      const { win } = renderHook(() =>
        useEditorShortcuts({
          shortcuts: new ShortcutRegistry([]),
          editor,
          busy: false,
          modalOpen: false,
          onDismissModals: vi.fn(),
          onSetSpacePan,
          onClearPreview,
          onResetGestures,
        }),
      );

      win.dispatchEvent({ type: "blur" } as unknown as Event);
      expect(cancelMock).toHaveBeenCalled();
      expect(onSetSpacePan).toHaveBeenCalledWith(false);
      expect(onResetGestures).toHaveBeenCalled();
      expect(onClearPreview).toHaveBeenCalled();
    });
  });

  describe("useCanvasRenderer", () => {
    it("cleans up editor tools on unmount", () => {
      const cancelMock = vi.fn();
      const cleanupCursorMock = vi.fn();

      const editor = {
        renderer: {
          prepareViewport: vi.fn(),
          prepareFallback: vi.fn(),
        },
        tools: { cancel: cancelMock },
      } as unknown as Parameters<typeof useCanvasRenderer>[0]["editor"];

      const dom = new Document();
      const ref = { current: null };

      const hook = renderHook(() =>
        useCanvasRenderer({
          editor,
          viewDocument: dom.toJSON(),
          assets: {} as unknown as Parameters<typeof useCanvasRenderer>[0]["assets"],
          renderRegion: { x: 0, y: 0, width: 800, height: 600 },
          zoom: 1,
          paintPreview: undefined,
          backendState: null,
          displayHost: ref,
          onCleanupCursor: cleanupCursorMock,
        }),
      );

      hook.unmount();
      expect(cancelMock).toHaveBeenCalled();
      expect(cleanupCursorMock).toHaveBeenCalled();
    });
  });
});
