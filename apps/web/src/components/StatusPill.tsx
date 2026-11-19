import { describeStatus, type StatusContext, type StatusTone, type UploadPhase } from "@/lib/status";
import { chipClass, cx, StatusGlyph, type StatusGlyphName } from "./ui";

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

// lib/status speaks in text glyphs; the pills draw them from the icon set so every status
// renders the same in every font. Unknown glyphs fall back to the text.
const GLYPH_ICON: Record<string, StatusGlyphName> = {
  "↑": "arrowUp",
  "◷": "clock",
  "↻": "refresh",
  "✓": "check",
  "\u26A0": "alert", // lib/status warning sign
  "⌫": "trash",
  "⧉": "copy",
  "⊘": "ban",
};

/** Reading and retrying spin (§5.4); with reduced motion the ring holds still (§8.4). */
function Glyph({ phase, glyph }: { phase: UploadPhase; glyph: string }) {
  const live = phase === "processing" || phase === "retry_wait";
  const icon: StatusGlyphName | undefined = live ? "spin" : GLYPH_ICON[glyph];
  if (!icon) return <span aria-hidden="true">{glyph}</span>;
  return (
    <span data-status-spinner={live || undefined} className="inline-flex">
      <StatusGlyph glyph={icon} />
    </span>
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
      <span className="inline-flex flex-wrap items-center gap-x-2 text-xs">
        <span className={cx("inline-flex items-center gap-1 font-medium", TEXT_TONE[s.tone])}>
          <Glyph phase={phase} glyph={s.glyph} />
          {s.label}
        </span>
        {showSub && s.sub && (
          <span className="text-muted">
            <span className="sr-only">, </span>
            {s.sub}
          </span>
        )}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className={cx(chipClass, TONE[s.tone])}>
        <Glyph phase={phase} glyph={s.glyph} />
        {s.label}
      </span>
      {showSub && s.sub && <span className="text-xs text-muted">{s.sub}</span>}
    </span>
  );
}
