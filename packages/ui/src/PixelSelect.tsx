import { useEffect, useRef, useState } from "react";

/** One row in a PixelSelect: a selectable option, or a non-interactive group header. */
export interface PixelSelectItem {
  type?: "option" | "group";
  value?: string;
  label: string;
  disabled?: boolean;
  warn?: boolean;
}

/**
 * Pixel-styled dropdown that replaces native <select>, whose option list can't
 * be themed to match the rest of the UI. Click-driven, closes on outside click
 * or Escape. Supports flat options and grouped options with a warning marker.
 */
export function PixelSelect({
  value,
  onChange,
  items,
  placeholder = "Select...",
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  items: PixelSelectItem[];
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = items.find((it) => it.type !== "group" && it.value === value);

  const pick = (it: PixelSelectItem) => {
    if (it.type === "group" || it.disabled) return;
    onChange(it.value ?? "");
    setOpen(false);
  };

  return (
    <div className="px-select" ref={ref} style={style}>
      <button type="button" className="px-select-btn" onClick={() => setOpen((o) => !o)}>
        <span className={selected ? "" : "px-placeholder"}>{selected?.label ?? placeholder}</span>
        <span className="px-caret">▾</span>
      </button>
      {open && (
        <div className="px-select-pop">
          {items.map((it, i) =>
            it.type === "group" ? (
              <div key={`g${i}`} className="px-group">{it.label}</div>
            ) : (
              <div
                key={it.value ?? `o${i}`}
                className={`px-option${it.value === value ? " active" : ""}${it.disabled ? " disabled" : ""}`}
                onClick={() => pick(it)}
              >
                <span className="px-check">{it.value === value ? "✓" : ""}</span>
                <span className="px-option-label">{it.label}</span>
                {it.warn && <span className="px-warn">⚠️</span>}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
