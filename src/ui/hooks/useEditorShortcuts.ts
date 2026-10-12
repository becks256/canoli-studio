import { useEffect, useRef } from "react";
import type { EditorApplication } from "../../editor";
import type { ShortcutRegistry } from "../shortcuts";
import { isTextInput } from "../shortcuts";

export interface UseEditorShortcutsOptions {
  shortcuts: ShortcutRegistry;
  editor: EditorApplication;
  busy: boolean;
  modalOpen: boolean;
  onDismissModals(): void;
  onSetSpacePan(active: boolean): void;
  onClearPreview(): void;
  onResetGestures(): void;
}

export function useEditorShortcuts({
  shortcuts,
  editor,
  busy,
  modalOpen,
  onDismissModals,
  onSetSpacePan,
  onClearPreview,
  onResetGestures,
}: UseEditorShortcutsOptions): void {
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;
  const stateRef = useRef({ busy, modalOpen });
  stateRef.current = { busy, modalOpen };
  const callbacksRef = useRef({
    onDismissModals,
    onSetSpacePan,
    onClearPreview,
    onResetGestures,
  });
  callbacksRef.current = {
    onDismissModals,
    onSetSpacePan,
    onClearPreview,
    onResetGestures,
  };

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        callbacksRef.current.onDismissModals();
        editor.tools.cancel();
        callbacksRef.current.onClearPreview();
        callbacksRef.current.onResetGestures();
        return;
      }
      if (stateRef.current.modalOpen) {
        return;
      }
      if (stateRef.current.busy) {
        shortcutsRef.current.handle(event, true);
        return;
      }
      if (event.code === "Space" && !isTextInput(event.target)) {
        event.preventDefault();
        callbacksRef.current.onSetSpacePan(true);
        return;
      }
      shortcutsRef.current.handle(event);
    };

    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        callbacksRef.current.onSetSpacePan(false);
      }
    };

    const blur = () => {
      editor.tools.cancel();
      callbacksRef.current.onSetSpacePan(false);
      callbacksRef.current.onResetGestures();
      callbacksRef.current.onClearPreview();
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [editor]);
}
