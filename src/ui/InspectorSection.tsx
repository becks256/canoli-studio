import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export interface InspectorSectionProps {
  title: ReactNode;
  children: ReactNode;
  defaultCollapsed?: boolean;
  collapsed?: boolean;
  onToggle?(): void;
  actions?: ReactNode;
  badge?: ReactNode;
  className?: string;
  headingLevel?: "h2" | "h3";
  ariaLabel?: string;
}

export function InspectorSection({
  title,
  children,
  defaultCollapsed = false,
  collapsed: controlledCollapsed,
  onToggle,
  actions,
  badge,
  className = "",
  headingLevel: Heading = "h2",
  ariaLabel,
}: InspectorSectionProps) {
  const [uncontrolledCollapsed, setUncontrolledCollapsed] =
    useState(defaultCollapsed);
  const isCollapsed =
    controlledCollapsed !== undefined
      ? controlledCollapsed
      : uncontrolledCollapsed;

  const toggle = () => {
    if (onToggle) {
      onToggle();
    } else {
      setUncontrolledCollapsed((prev) => !prev);
    }
  };

  return (
    <section
      className={`inspector-section ${isCollapsed ? "collapsed" : "expanded"} ${className}`.trim()}
      aria-label={ariaLabel || (typeof title === "string" ? title : undefined)}
    >
      <div className="inspector-section-header">
        <Heading className="inspector-section-heading">
          <button
            type="button"
            className="inspector-section-toggle"
            aria-expanded={!isCollapsed}
            onClick={toggle}
          >
            <span className="inspector-section-chevron" aria-hidden="true">
              {isCollapsed ? (
                <ChevronRight size={13} />
              ) : (
                <ChevronDown size={13} />
              )}
            </span>
            <span className="inspector-section-title">{title}</span>
            {badge && <span className="inspector-section-badge">{badge}</span>}
          </button>
        </Heading>
        {actions && (
          <div
            className="inspector-section-actions"
            onClick={(e) => e.stopPropagation()}
          >
            {actions}
          </div>
        )}
      </div>
      {!isCollapsed && (
        <div className="inspector-section-content">{children}</div>
      )}
    </section>
  );
}
