import { useEffect, useRef, useState } from "react";
import type {
  ButtonHTMLAttributes,
  ChangeEvent,
  KeyboardEvent,
  ReactNode,
} from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "subtle" | "danger";
  size?: "sm" | "md";
  children: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  children,
  type = "button",
  ...props
}: ButtonProps) {
  const variantClass =
    variant === "primary"
      ? "primary"
      : variant === "subtle"
        ? "subtle"
        : variant === "danger"
          ? "danger"
          : "";
  const sizeClass = size === "sm" ? "button-sm" : "";
  const classes = ["button", variantClass, sizeClass, className]
    .filter(Boolean)
    .join(" ");

  return (
    <button type={type} className={classes} {...props}>
      {children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="icon-button"
      title={label}
      aria-label={label}
      {...props}
    >
      {children}
    </button>
  );
}

export interface NumberFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit?(value: number): void;
  onPreview?(value: number): void;
  onChange?(value: number): void;
  disabled?: boolean;
  step?: number | "any";
  hideLabel?: boolean;
  suffix?: string;
  layout?: "inline" | "stacked";
  id?: string;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
}

export function NumberField({
  label,
  value,
  min,
  max,
  onCommit,
  onPreview,
  onChange,
  disabled = false,
  step = "any",
  hideLabel = false,
  suffix = "",
  layout = "inline",
  id,
  className = "",
  placeholder,
  autoFocus = false,
}: NumberFieldProps) {
  const [draft, setDraft] = useState(formatNumber(value));
  const [prevValue, setPrevValue] = useState(value);
  const dirty = useRef(false);

  if (value !== prevValue) {
    setPrevValue(value);
    setDraft(formatNumber(value));
    dirty.current = false;
  }

  const commit = () => {
    if (!dirty.current) return;
    dirty.current = false;
    const trimmed = draft.trim();
    const parsed = Number(trimmed);
    if (
      trimmed &&
      Number.isFinite(parsed) &&
      parsed >= min &&
      parsed <= max
    ) {
      if (parsed !== value) {
        onCommit?.(parsed);
        onChange?.(parsed);
      }
      setDraft(formatNumber(parsed));
    } else {
      onPreview?.(value);
      setDraft(formatNumber(value));
    }
  };

  if (layout === "stacked") {
    return (
      <label className={`field-label ${className}`.trim()} htmlFor={id}>
        {!hideLabel && label}
        <div className="number-field-wrap">
          <input
            id={id}
            type="number"
            aria-label={label}
            placeholder={placeholder}
            autoFocus={autoFocus}
            value={draft}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            onChange={(event) => {
              dirty.current = true;
              setDraft(event.target.value);
              const trimmed = event.target.value.trim();
              if (trimmed) {
                const parsed = Number(trimmed);
                if (
                  Number.isFinite(parsed) &&
                  parsed >= min &&
                  parsed <= max
                ) {
                  onPreview?.(parsed);
                  onChange?.(parsed);
                }
              }
            }}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                dirty.current = false;
                onPreview?.(value);
                setDraft(formatNumber(value));
                event.currentTarget.blur();
              }
            }}
          />
          {suffix && <span className="number-field-suffix">{suffix}</span>}
        </div>
      </label>
    );
  }
  return (
    <label
      className={`number-field ${hideLabel ? "number-field-value" : ""} ${className}`.trim()}
      htmlFor={id}
    >
      {!hideLabel && <span>{label}</span>}
      <input
        id={id}
        type="number"
        aria-label={label}
        placeholder={placeholder}
        autoFocus={autoFocus}
        value={draft}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => {
          dirty.current = true;
          setDraft(event.target.value);
          const trimmed = event.target.value.trim();
          if (trimmed) {
            const parsed = Number(trimmed);
            if (
              Number.isFinite(parsed) &&
              parsed >= min &&
              parsed <= max
            ) {
              onPreview?.(parsed);
              onChange?.(parsed);
            }
          }
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            dirty.current = false;
            onPreview?.(value);
            setDraft(formatNumber(value));
            event.currentTarget.blur();
          }
        }}
      />
      {suffix && <span className="number-field-suffix">{suffix}</span>}
    </label>
  );
}

function formatNumber(value: number) {
  // Keep safe-integer document coordinates exact; trim only floating-point
  // display noise such as 28.999999999999996 in percentage controls.
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(15)));
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onPreview,
  onCommit,
  disabled = false,
  suffix = "",
  scale = "linear",
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  scale?: "linear" | "quadratic";
  disabled?: boolean;
  onPreview(value: number): void;
  onCommit(value: number): void;
}) {
  const pending = useRef<{ initial: number; value: number } | null>(null);
  const clamp = (next: number) => Math.max(min, Math.min(max, next));
  const position = Math.sqrt((clamp(value) - min) / (max - min)) * 1000;
  const update = (next: number) => {
    pending.current ??= { initial: value, value };
    pending.current.value = next;
    onPreview(next);
  };
  const commit = () => {
    const change = pending.current;
    pending.current = null;
    if (change && change.value !== change.initial) onCommit(change.value);
  };
  const cancel = () => {
    const change = pending.current;
    pending.current = null;
    if (change) onPreview(change.initial);
  };
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  useEffect(() => {
    const blur = () => cancelRef.current();
    window.addEventListener("blur", blur);
    return () => window.removeEventListener("blur", blur);
  }, []);
  return (
    <div
      className="slider-field"
      role="group"
      aria-label={`${label} adjustment`}
    >
      <span className="slider-heading">
        {label}
        <span className="slider-unit">{suffix.trim()}</span>
      </span>
      <div className="slider-inputs">
        <input
          className="slider-track"
          aria-label={label}
          type="range"
          value={scale === "quadratic" ? position : value}
          min={scale === "quadratic" ? 0 : min}
          max={scale === "quadratic" ? 1000 : max}
          step="any"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={`${formatNumber(value)}${suffix ? ` ${suffix.trim()}` : ""}`}
          disabled={disabled}
          onChange={(event) => {
            const raw = Number(event.target.value);
            const next =
              scale === "quadratic"
                ? min + (max - min) * (raw / 1000) ** 2
                : raw;
            update(
              clamp(
                Number(
                  (min + Math.round((next - min) / step) * step).toFixed(10),
                ),
              ),
            );
          }}
          onPointerDown={(event) =>
            event.currentTarget.setPointerCapture(event.pointerId)
          }
          onPointerUp={commit}
          onPointerCancel={cancel}
          onLostPointerCapture={cancel}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              cancel();
              return;
            }
            const direction = (
              {
                ArrowLeft: -1,
                ArrowDown: -1,
                ArrowRight: 1,
                ArrowUp: 1,
                PageDown: -10,
                PageUp: 10,
              } as Record<string, number>
            )[event.key];
            if (
              direction !== undefined ||
              event.key === "Home" ||
              event.key === "End"
            ) {
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? min
                  : event.key === "End"
                    ? max
                    : (pending.current?.value ?? value) + direction * step;
              update(clamp(Number(next.toFixed(10))));
            }
          }}
          onKeyUp={(event) => {
            if (
              [
                "ArrowLeft",
                "ArrowRight",
                "ArrowUp",
                "ArrowDown",
                "Home",
                "End",
                "PageUp",
                "PageDown",
              ].includes(event.key)
            )
              commit();
          }}
          onBlur={commit}
        />
        <NumberField
          label={`${label} value`}
          value={value}
          min={min}
          max={max}
          disabled={disabled}
          hideLabel
          onCommit={onCommit}
        />
      </div>
    </div>
  );
}

export interface TextInputProps {
  label: string;
  value: string;
  onCommit?(value: string): void;
  onPreview?(value: string): void;
  onChange?(value: string): void;
  disabled?: boolean;
  hideLabel?: boolean;
  maxLength?: number;
  layout?: "inline" | "stacked";
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  type?: string;
  id?: string;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  suffix?: string;
}

export function TextInput({
  label,
  value,
  onCommit,
  onPreview,
  onChange,
  disabled = false,
  hideLabel = false,
  maxLength = 240,
  layout = "inline",
  className = "",
  placeholder = "",
  autoFocus = false,
  type = "text",
  id,
  min,
  max,
  step,
  suffix = "",
}: TextInputProps) {
  const [draft, setDraft] = useState(value);
  const [prevValue, setPrevValue] = useState(value);
  const dirty = useRef(false);

  if (value !== prevValue) {
    setPrevValue(value);
    setDraft(value);
    dirty.current = false;
  }

  const commit = () => {
    if (!dirty.current) return;
    dirty.current = false;
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) {
      onCommit?.(trimmed);
      setDraft(trimmed);
    } else {
      onPreview?.(value);
      setDraft(value);
    }
  };

  const cancel = () => {
    dirty.current = false;
    onPreview?.(value);
    setDraft(value);
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    dirty.current = true;
    const val = event.target.value;
    setDraft(val);
    onChange?.(val);
    onPreview?.(val);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
      event.currentTarget.blur();
    }
  };

  if (layout === "stacked") {
    return (
      <label className={`field-label ${className}`.trim()} htmlFor={id}>
        {!hideLabel && label}
        <div className={suffix ? "text-field-wrap" : undefined}>
          <input
            id={id}
            type={type}
            aria-label={label}
            value={draft}
            maxLength={maxLength}
            placeholder={placeholder}
            disabled={disabled}
            autoFocus={autoFocus}
            min={min}
            max={max}
            step={step}
            onChange={handleChange}
            onBlur={commit}
            onKeyDown={handleKeyDown}
          />
          {suffix && <span className="field-suffix">{suffix}</span>}
        </div>
      </label>
    );
  }

  return (
    <label
      className={`text-field ${hideLabel ? "text-field-value" : ""} ${className}`.trim()}
      htmlFor={id}
    >
      {!hideLabel && <span>{label}</span>}
      <input
        id={id}
        type={type}
        aria-label={label}
        value={draft}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        min={min}
        max={max}
        step={step}
        onChange={handleChange}
        onBlur={commit}
        onKeyDown={handleKeyDown}
      />
      {suffix && <span className="field-suffix">{suffix}</span>}
    </label>
  );
}

export const Input = TextInput;

export function TextArea({
  label,
  value,
  onCommit,
  onPreview,
  onChange,
  disabled = false,
  hideLabel = false,
  rows = 3,
  className = "",
  placeholder = "",
  ariaLabel,
}: {
  label: string;
  value: string;
  onCommit?(value: string): void;
  onPreview?(value: string): void;
  onChange?(value: string): void;
  disabled?: boolean;
  hideLabel?: boolean;
  rows?: number;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(value);
  const dirty = useRef(false);
  useEffect(() => {
    dirty.current = false;
    setDraft(value);
  }, [value]);

  const commit = () => {
    if (!dirty.current) return;
    dirty.current = false;
    if (draft !== value) {
      onCommit?.(draft);
    }
  };

  return (
    <label className={`field-label ${className}`.trim()}>
      {!hideLabel && label}
      <textarea
        className="text-content-area"
        aria-label={ariaLabel ?? label}
        value={draft}
        disabled={disabled}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => {
          dirty.current = true;
          const val = e.target.value;
          setDraft(val);
          onChange?.(val);
          onPreview?.(val);
        }}
        onBlur={commit}
      />
    </label>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function Select({
  label,
  value,
  options,
  onChange,
  disabled = false,
  hideLabel = false,
  layout = "inline",
  className = "",
}: {
  label: string;
  value: string;
  options: Array<SelectOption | string>;
  onChange(value: string): void;
  disabled?: boolean;
  hideLabel?: boolean;
  layout?: "inline" | "stacked";
  className?: string;
}) {
  const normalizedOptions = options.map((opt) =>
    typeof opt === "string" ? { value: opt, label: opt } : opt,
  );

  const selectEl = (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {normalizedOptions.map((opt) => (
        <option key={opt.value} value={opt.value} disabled={opt.disabled}>
          {opt.label}
        </option>
      ))}
    </select>
  );

  if (layout === "stacked") {
    return (
      <label className={`field-label ${className}`.trim()}>
        {!hideLabel && label}
        {selectEl}
      </label>
    );
  }

  return (
    <label
      className={`select-field ${hideLabel ? "select-field-value" : ""} ${className}`.trim()}
    >
      {!hideLabel && <span>{label}</span>}
      {selectEl}
    </label>
  );
}

export function ColorField({
  label,
  value,
  onChange,
  disabled = false,
  className = "",
  ariaLabel,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div className={`style-color-row ${className}`.trim()}>
      <span>{label}</span>
      <input
        type="color"
        aria-label={ariaLabel ?? label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: string;
  icon?: ReactNode;
  title?: string;
}

export function SegmentedControl<T extends string = string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  hideLabel = false,
  className = "",
}: {
  label: string;
  value: T;
  options: Array<SegmentedOption<T>>;
  onChange(value: T): void;
  disabled?: boolean;
  hideLabel?: boolean;
  className?: string;
}) {
  return (
    <div className={`field-label ${className}`.trim()}>
      {!hideLabel && <span>{label}</span>}
      <div className="button-group" role="group" aria-label={label}>
        {options.map((opt) => (
          <IconButton
            key={opt.value}
            label={opt.title ?? opt.label}
            aria-pressed={value === opt.value}
            className={`tool-button ${value === opt.value ? "active" : ""}`}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
          >
            {opt.icon ?? opt.label}
          </IconButton>
        ))}
      </div>
    </div>
  );
}

