import { TAB_REORDER_KEYS } from "./shortcuts";
import { X, Plus } from "lucide-react";
import type { Document } from "../dom";
import "./DocumentTabBar.css";
export function DocumentTabBar({
  sessions,
  activeId,
  busy,
  onActivate,
  onClose,
  onNew,
  onMove,
}: {
  sessions: { id: string; document: Document; dirty: boolean }[];
  activeId?: string;
  busy: boolean;
  onMove(document: Document, index: number): void;
  onActivate(document: Document): void;
  onClose(document: Document): void;
  onNew(): void;
}) {
  return (
    <div className="document-tabs" role="tablist" aria-label="Open documents">
      {sessions.map((session, index) => (
        <div
          className={`document-tab ${session.id === activeId ? "active" : ""}`}
          key={session.id}
          onDragOver={(event) => {
            if (
              !busy &&
              event.dataTransfer.types.includes(
                "application/x-luma-document-tab",
              )
            )
              event.preventDefault();
          }}
          onDrop={(event) => {
            if (busy) return;
            const source = sessions.find(
              (candidate) =>
                candidate.id ===
                event.dataTransfer.getData("application/x-luma-document-tab"),
            );
            if (source) {
              event.preventDefault();
              onMove(source.document, index);
            }
          }}
        >
          <button
            role="tab"
            aria-selected={session.id === activeId}
            tabIndex={session.id === activeId ? 0 : -1}
            draggable={!busy}
            title="Drag to reorder; Alt+Left/Right when focused"
            onDragStart={(event) => {
              event.dataTransfer.setData(
                "application/x-luma-document-tab",
                session.id,
              );
              event.dataTransfer.effectAllowed = "move";
            }}
            disabled={busy}
            onClick={() => onActivate(session.document)}
            onKeyDown={(event) => {
              if (
                event.altKey &&
                (event.key === TAB_REORDER_KEYS.previous ||
                  event.key === TAB_REORDER_KEYS.next)
              ) {
                event.preventDefault();
                event.stopPropagation();
                const next =
                  index + (event.key === TAB_REORDER_KEYS.next ? 1 : -1);
                if (next >= 0 && next < sessions.length)
                  onMove(session.document, next);
                return;
              }
              if (
                ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              ) {
                event.preventDefault();
                event.stopPropagation();
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? sessions.length - 1
                      : (index +
                          (event.key === "ArrowRight" ? 1 : -1) +
                          sessions.length) %
                        sessions.length;
                const tabs = event.currentTarget
                  .closest('[role="tablist"]')!
                  .querySelectorAll<HTMLButtonElement>('[role="tab"]');
                tabs[next].focus();
                onActivate(sessions[next].document);
              }
            }}
          >
            <span>{session.document.name}</span>
            {session.dirty && <span aria-label="Unsaved changes">*</span>}
          </button>
          <button
            className="document-tab-close"
            disabled={busy}
            aria-label={`Close ${session.document.name}`}
            onClick={() => onClose(session.document)}
          >
            <X size={12} />
          </button>
        </div>
      ))}
      <button
        disabled={busy}
        className="document-tab-new"
        aria-label="New document tab"
        onClick={onNew}
      >
        <Plus size={15} />
      </button>
    </div>
  );
}
