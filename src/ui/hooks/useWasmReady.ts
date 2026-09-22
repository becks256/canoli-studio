import { useEffect, useRef, useState } from "react";
import type { EditorApplication } from "../../editor";

export function useWasmReady(
  editor: EditorApplication,
  onError?: (message: string) => void,
): boolean {
  const [wasmReady, setWasmReady] = useState(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let active = true;
    editor.renderer.processor.ready
      .then(() => {
        if (active) setWasmReady(true);
      })
      .catch((cause) => {
        if (active && onErrorRef.current) {
          onErrorRef.current(cause instanceof Error ? cause.message : String(cause));
        }
      });
    return () => {
      active = false;
    };
  }, [editor]);

  return wasmReady;
}
