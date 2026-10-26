import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { COLOR_VAR } from "./format";
import type { BinColor } from "./types";

type Tone = "neutral" | "positive" | "negative" | "warning";

const PILL: Record<Tone, string> = {
  neutral: "bg-[var(--pill-neutral-bg)] text-[var(--pill-neutral-ink)]",
  positive: "bg-[var(--pill-positive-bg)] text-[var(--pill-positive-ink)]",
  negative: "bg-[var(--pill-negative-bg)] text-[var(--pill-negative-ink)]",
  warning: "bg-[var(--pill-warning-bg)] text-[var(--pill-warning-ink)]",
};

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex h-5 flex-none items-center whitespace-nowrap rounded-full px-2 text-small font-medium ${PILL[tone]}`}>
      {children}
    </span>
  );
}

export function Dot({ color, size = 8 }: { color: BinColor | string; size?: number }) {
  const bg = color in COLOR_VAR ? COLOR_VAR[color as BinColor] : color;
  return <span className="inline-block flex-none rounded-full" style={{ width: size, height: size, background: bg }} />;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost";
  busy?: boolean;
}

export function Button({ variant = "ghost", busy, children, className = "", disabled, ...rest }: ButtonProps) {
  const base =
    "inline-flex h-[34px] flex-none items-center justify-center gap-1.5 whitespace-nowrap rounded-card px-3 text-body font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const look =
    variant === "primary"
      ? "bg-ink text-surface hover:bg-[#e4e4e6]"
      : "border border-control text-ink hover:bg-raised";
  return (
    <button type="button" className={`${base} ${look} ${className}`} disabled={disabled || busy} {...rest}>
      {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/** Tab row: each selected tab carries the 1px accent line, as wide as its label. */
export function Tabs<T extends string>({
  value,
  onChange,
  items,
  label,
}: {
  value: T;
  onChange(v: T): void;
  items: { id: T; label: string; count?: number }[];
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-4 border-b border-line">
      {items.map((it) => (
        <button
          key={it.id}
          role="tab"
          aria-selected={value === it.id}
          onClick={() => onChange(it.id)}
          className={`sel -mb-px inline-flex h-8 items-center gap-1.5 text-body ${value === it.id ? "text-ink" : "text-muted hover:text-ink"}`}
        >
          <span className="relative">
            {it.label}
          </span>
          {it.count !== undefined && <span className="text-small text-muted">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Segmented choice (speed, range). Selection is the accent line under the label. */
export function Choice<T extends string | number>({
  value,
  onChange,
  items,
  label,
}: {
  value: T;
  onChange(v: T): void;
  items: { id: T; label: string }[];
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-none gap-3">
      {items.map((it) => (
        <button
          key={String(it.id)}
          aria-pressed={value === it.id}
          onClick={() => onChange(it.id)}
          className={`sel h-6 whitespace-nowrap text-body ${value === it.id ? "text-ink" : "text-muted hover:text-ink"}`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between gap-3 first:mt-0">
      <h2 className="text-[16px] font-semibold leading-6 text-ink">{children}</h2>
      {right && <div className="text-small text-muted">{right}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-card border border-dashed border-control px-3 py-4 text-body text-muted">{children}</div>;
}

export const Dash = () => <span className="text-muted">—</span>;

/** Runs an async action and keeps its busy state and error text. */
export function useAction<A extends unknown[]>(fn: (...a: A) => Promise<string | null | void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (...a: A) => {
    setBusy(true);
    setError(null);
    try {
      const msg = await fn(...a);
      if (typeof msg === "string") setError(msg);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { run, busy, error };
}

export function ErrorLine({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="mt-2 text-small text-negative">
      {children}
    </p>
  );
}

/** Panel page heading: one h1 per screen, a noun, with the finding as the line under it. */
export function PageTitle({ title, finding, action }: { title: string; finding?: ReactNode; action?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-4 pb-4">
      <div className="min-w-0">
        <h1 className="text-title font-semibold text-ink">{title}</h1>
        {finding && <p className="mt-1 text-body text-muted">{finding}</p>}
      </div>
      {action}
    </header>
  );
}
