import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

export function Dialog({
  titleId,
  className = "",
  onClose,
  localEscape=false,
  children,
}: {
  titleId: string;
  className?: string;
  onClose(): void;
  localEscape?:boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    return () => {
      dialog.close();
      prior?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`shortcut-dialog ${className}`}
      aria-labelledby={titleId}
      onKeyDown={event=>{if(localEscape&&event.key==="Escape")event.stopPropagation();}}
      onCancel={(event) => {
        event.preventDefault();
        close.current();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            close.current();
        }
      }}
    >
      {children}
    </dialog>
  );
}
