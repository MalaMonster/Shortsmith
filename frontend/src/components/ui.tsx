import { useEffect, useRef, useState, type ReactNode } from "react";
import { HelpCircle } from "lucide-react";

export function Tip({ text }: { text: string }) {
  return <span className="tip" data-tip={text}><HelpCircle size={12} /></span>;
}

export function Field({ label, tip, children, right }: { label: ReactNode; tip?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="field">
      <label><span className="row" style={{ gap: 5 }}>{label}{tip && <Tip text={tip} />}</span>{right}</label>
      {children}
    </div>
  );
}

export function Section({ title, children, right }: { title: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="section">
      <h3><span className="row" style={{ gap: 6 }}>{title}</span>{right}</h3>
      {children}
    </div>
  );
}

/** Number input that only commits on blur/enter (so typing "1." doesn't fight the store). */
export function NumberInput({ value, onChange, step = 1, min, max, digits = 2, className = "", suffix, title }: {
  value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; digits?: number; className?: string; suffix?: string; title?: string;
}) {
  const [txt, setTxt] = useState(value.toFixed(digits));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setTxt(value.toFixed(digits)); }, [value, digits]);
  const commit = (s: string) => {
    let v = parseFloat(s);
    if (!isFinite(v)) { setTxt(value.toFixed(digits)); return; }
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    onChange(v);
    setTxt(v.toFixed(digits));
  };
  return (
    <span className="row" style={{ gap: 3 }} title={title}>
      <input className={`input num ${className}`} value={txt} onFocus={() => (focused.current = true)}
        onBlur={(e) => { focused.current = false; commit(e.target.value); }}
        onChange={(e) => setTxt(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const d = (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            commit(String((parseFloat(txt) || 0) + d));
          }
        }} />
      {suffix && <span className="hint">{suffix}</span>}
    </span>
  );
}

export function Slider({ value, onChange, min, max, step = 0.01, digits = 2, suffix, display }: {
  value: number; onChange: (v: number) => void; min: number; max: number; step?: number; digits?: number; suffix?: string;
  display?: { scale?: number };
}) {
  const sc = display?.scale ?? 1;
  return (
    <div className="slider">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
      <NumberInput value={value * sc} digits={digits} step={step * sc} min={min * sc} max={max * sc} suffix={suffix}
        onChange={(v) => onChange(v / sc)} className="sm" />
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <span className={`toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)} role="switch" aria-checked={on}>
      <span className="sw" />{label && <span>{label}</span>}
    </span>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { v: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.v} className={value === o.v ? "on" : ""} title={o.title} onClick={() => onChange(o.v)}>{o.label}</button>
      ))}
    </div>
  );
}

export function ColorInput({ value, onChange, alpha }: { value: string; onChange: (v: string) => void; alpha?: boolean }) {
  // supports #rrggbb and rgba(); the picker edits rgb, alpha via slider when requested
  const parsed = parseColor(value);
  return (
    <span className="color">
      <input type="color" value={parsed.hex} onChange={(e) => onChange(alpha ? toRgba(e.target.value, parsed.a) : e.target.value)} />
      {alpha && (
        <input type="range" min={0} max={1} step={0.01} value={parsed.a} style={{ width: 70 }}
          title={`Opacity ${(parsed.a * 100).toFixed(0)}%`} onChange={(e) => onChange(toRgba(parsed.hex, parseFloat(e.target.value)))} />
      )}
      <span className="hint" style={{ fontFamily: "monospace" }}>{parsed.hex.toUpperCase()}</span>
    </span>
  );
}

export function parseColor(c: string): { hex: string; a: number } {
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b, a = "1"] = m[1].split(",").map((s) => s.trim());
    const hex = "#" + [r, g, b].map((x) => Math.round(+x).toString(16).padStart(2, "0")).join("");
    return { hex, a: parseFloat(a) };
  }
  let h = c.replace("#", "");
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  return { hex: "#" + h.slice(0, 6).padEnd(6, "0"), a: 1 };
}

export function toRgba(hex: string, a: number) {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${+a.toFixed(3)})`;
}

export function fmtTime(t: number, withMs = true) {
  if (!isFinite(t)) t = 0;
  const neg = t < 0; t = Math.abs(t);
  const m = Math.floor(t / 60), s = Math.floor(t % 60), ms = Math.floor((t % 1) * 100);
  const h = Math.floor(m / 60);
  const base = h > 0 ? `${h}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  return (neg ? "-" : "") + base + (withMs ? `.${String(ms).padStart(2, "0")}` : "");
}

/** Generic pointer drag helper. */
export function startDrag(e: React.PointerEvent | PointerEvent, onMove: (dx: number, dy: number, ev: PointerEvent) => void, onEnd?: (ev: PointerEvent) => void) {
  const x0 = e.clientX, y0 = e.clientY;
  const move = (ev: PointerEvent) => onMove(ev.clientX - x0, ev.clientY - y0, ev);
  const up = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    onEnd?.(ev);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/** Observe an element's size. */
export function useSize<T extends HTMLElement>(): [React.RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}
