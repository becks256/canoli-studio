import { useEffect } from "react";
import type { Document } from "../../dom";

export function useUnsavedChangesWarning(
  dom: Document,
  stamp: string,
  savedStamp: string,
): void {
  useEffect(() => {
    const warning = (event: BeforeUnloadEvent) => {
      if (savedStamp !== stamp && dom.layers.length > 0) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warning);
    return () => window.removeEventListener("beforeunload", warning);
  }, [stamp, savedStamp, dom]);
}
