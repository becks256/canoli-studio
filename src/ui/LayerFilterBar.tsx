import type { LayerData } from "../core/model";
import type { LayerFilter } from "./layer-filter";
import { emptyLayerFilter } from "./layer-filter";
import "./LayerFilterBar.css";
export function LayerFilterBar({
  value,
  onChange,
  active,
  count,
}: {
  value: LayerFilter;
  onChange(value: LayerFilter): void;
  active: boolean;
  count: number;
}) {
  return (
    <div className="layer-filter-bar" role="search" aria-label="Filter layers">
      <input
        aria-label="Search layers"
        placeholder="Search layers…"
        value={value.query}
        onChange={(e) => onChange({ ...value, query: e.target.value })}
      />
      <div className="layer-filter-options">
        <select
          aria-label="Layer type"
          value={value.kind}
          onChange={(e) =>
            onChange({
              ...value,
              kind: e.target.value as LayerData["kind"] | "all",
            })
          }
        >
          <option value="all">All types</option>
          {["raster", "group", "paint", "vector", "text", "adjustment"].map(
            (kind) => (
              <option key={kind} value={kind}>
                {kind[0].toUpperCase() + kind.slice(1)}
              </option>
            ),
          )}
        </select>
        <select
          aria-label="Layer visibility"
          value={value.visibility}
          onChange={(e) =>
            onChange({
              ...value,
              visibility: e.target.value as LayerFilter["visibility"],
            })
          }
        >
          <option value="all">Visibility</option>
          <option value="visible">Visible</option>
          <option value="hidden">Hidden</option>
        </select>
        <select
          aria-label="Layer locking"
          value={value.lock}
          onChange={(e) =>
            onChange({ ...value, lock: e.target.value as LayerFilter["lock"] })
          }
        >
          <option value="all">Lock state</option>
          <option value="locked">Locked</option>
          <option value="unlocked">Unlocked</option>
        </select>
      </div>
      {active && (
        <div className="layer-filter-summary">
          <span role="status">
            {count} matching {count === 1 ? "layer" : "layers"}
          </span>
          <button onClick={() => onChange({ ...emptyLayerFilter })}>
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
