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
        <span aria-hidden="true">{s.glyph}</span>
        {s.label}
      </span>
    );
  }
  if (variant === "inline") {
    return (
      <span className="text-xs">
        <span className={cx("font-medium", TEXT_TONE[s.tone])}>
          <span aria-hidden="true">{s.glyph} </span>
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
        <span aria-hidden="true">{s.glyph}</span>
        {s.label}
      </span>
      {showSub && s.sub && <span className="text-xs text-muted">{s.sub}</span>}
    </span>
  );
}
