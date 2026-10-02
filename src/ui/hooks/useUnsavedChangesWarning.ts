import { useEffect } from "react";
import type { Document } from "../../dom";

export function useUnsavedChangesWarning(
  dom: Document,
  stamp: string,
  savedStamp: string,
  workspaceDirty?: boolean,
): void {
  useEffect(() => {
    const warning = (event: BeforeUnloadEvent) => {
      if (workspaceDirty ?? (savedStamp !== stamp && dom.layers.length > 0)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warning);
    return () => window.removeEventListener("beforeunload", warning);
  }, [stamp, savedStamp, dom, workspaceDirty]);
}
