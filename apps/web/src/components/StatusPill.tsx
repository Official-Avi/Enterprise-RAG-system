import { describeStatus, type StatusContext, type StatusTone, type UploadPhase } from "@/lib/status";
import { cx } from "./ui";

const TONE: Record<StatusTone, string> = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  info: "bg-info-soft text-info",
  neutral: "bg-panel-2 text-muted",
};

const TEXT_TONE: Record<StatusTone, string> = {
  ok: "text-ok",
  warn: "text-warn",
  bad: "text-bad",
  info: "text-info",
  neutral: "text-muted",
};

/** Reading and retrying show a spinner (§5.4); with reduced motion the static glyph stays (§8.4). */
function Glyph({ phase, glyph, spaced }: { phase: UploadPhase; glyph: string; spaced?: boolean }) {
  const text = spaced ? `${glyph} ` : glyph;
  if (phase !== "processing" && phase !== "retry_wait") return <span aria-hidden="true">{text}</span>;
  return (
    <>
      <span aria-hidden="true" className="motion-safe:hidden">{text}</span>
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        fill="none"
        data-status-spinner
        className={cx("size-3 shrink-0 motion-safe:animate-spin motion-reduce:hidden", spaced && "mr-1 inline align-[-1px]")}
      >
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />
        <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </>
  );
}

/** Workspace status in plain words (§5.4). Always glyph + word, never colour alone. */
export function StatusPill({
  phase,
  ctx,
  variant = "pill",
  showSub = false,
}: {
  phase: UploadPhase;
  ctx?: StatusContext;
  variant?: "pill" | "inline" | "dot";
  showSub?: boolean;
}) {
  const s = describeStatus(phase, ctx);
  if (variant === "dot") {
    return (
      <span className={cx("inline-flex items-center gap-1 text-xs font-medium", TEXT_TONE[s.tone])}>
        <Glyph phase={phase} glyph={s.glyph} />
        {s.label}
      </span>
    );
  }
  if (variant === "inline") {
    return (
      <span className="text-xs">
        <span className={cx("font-medium", TEXT_TONE[s.tone])}>
          <Glyph phase={phase} glyph={s.glyph} spaced />
          {s.label}
        </span>
        {showSub && s.sub && <span className="text-muted"> · {s.sub}</span>}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span
        className={cx(
          "badge inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
          TONE[s.tone],
        )}
      >
        <Glyph phase={phase} glyph={s.glyph} />
        {s.label}
      </span>
      {showSub && s.sub && <span className="text-xs text-muted">{s.sub}</span>}
    </span>
  );
}
