"use client";

import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { Icon } from "@/components/icons";
import { cx } from "@/components/ui";
import { announce } from "@/lib/announce";
import type { UploadPhase } from "@/lib/status";
import { AttachmentChip } from "./AttachmentChip";
import type { TrackedUpload } from "./types";
import { useUploads } from "./UploadsContext";

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  /** Parent decides between sending now and holding for files (§5.5). */
  onSend: (text: string) => void;
  /** A question is in flight (Send shows a spinner, stays aria-disabled). */
  busy: boolean;
  /** Empty-chat layout: vertically centred with a heading above (§5.3). */
  centered: boolean;
  placeholder: string;
  /** Usually <ScopeChip/>. */
  scopeSlot?: ReactNode;
  /** 12px caveat under the composer (§5.6). */
  caveat?: string;
  /** Heading/sub shown above the centred composer (state B/C). */
  heading?: ReactNode;
  textareaRef?: Ref<HTMLTextAreaElement>;
  /** Show the labelled "Add files" pill (before the first message) instead of a paperclip. */
  firstMessage: boolean;
}

const HINT_ID = "composer-hint";
const COLLAPSE_AT = 5;
const COLLAPSED_SHOWN = 3;
const NO_UPLOAD_NOTE =
  "Operators can't add documents. You can ask about documents already here. An Engineer or Admin can add files.";

const FINE_POINTER = "(pointer: fine)";
const isFinePointer = () => window.matchMedia(FINE_POINTER).matches;
function subscribePointer(onChange: () => void) {
  const mq = window.matchMedia(FINE_POINTER);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
// The server assumes a mouse; touch devices correct it right after hydration.
const useFinePointer = () => useSyncExternalStore(subscribePointer, isFinePointer, () => true);

// Same breakpoint as ScopeChip's bottom-sheet switch (below Tailwind's sm).
const NARROW = "(max-width: 639.98px)";
const isNarrow = () => window.matchMedia(NARROW).matches;
function subscribeNarrow(onChange: () => void) {
  const mq = window.matchMedia(NARROW);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
/** §5.8/§10: on phones the scope chip gets its own row above the textarea. */
const useNarrow = () => useSyncExternalStore(subscribeNarrow, isNarrow, () => false);

const supportsFieldSizing = () => typeof CSS !== "undefined" && CSS.supports("field-sizing", "content");

const AGGREGATE: [phases: UploadPhase[], word: string][] = [
  [["uploading"], "uploading"],
  [["queued", "processing", "retry_wait"], "reading"],
  [["failed"], "couldn't read"],
  [["rejected"], "not accepted"],
  [["deleting"], "removing"],
];

/** "3 of 8 ready · 4 reading · 1 not accepted" */
function aggregateLine(items: TrackedUpload[]): string {
  const count = (phases: UploadPhase[]) => items.filter((i) => phases.includes(i.phase)).length;
  const parts = [`${count(["indexed", "duplicate"])} of ${items.length} ready`];
  for (const [phases, word] of AGGREGATE) {
    const n = count(phases);
    if (n) parts.push(`${n} ${word}`);
  }
  return parts.join(" · ");
}

/** The composer (§5.3): chips row from useUploads(), auto-grow textarea, IME-safe Enter,
 *  attach/paste, scope slot, Send. */
export function Composer({
  value,
  onChange,
  onSend,
  busy,
  centered,
  placeholder,
  scopeSlot,
  caveat,
  heading,
  textareaRef,
  firstMessage,
}: ComposerProps) {
  const uploads = useUploads();
  const finePointer = useFinePointer();
  const narrow = useNarrow();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(textareaRef, () => inputRef.current as HTMLTextAreaElement, []);

  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const [expanded, setExpanded] = useState(false);
  const [pasteNote, setPasteNote] = useState<string | null>(null);

  const chips = uploads.items.filter((u) => !removed.has(u.key));
  const many = chips.length >= COLLAPSE_AT;
  const shown = many && !expanded ? chips.slice(0, COLLAPSED_SHOWN) : chips;
  const blocked = busy || value.trim() === "";

  // Fallback auto-grow where `field-sizing: content` is unsupported; max-h caps it at 200px.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el || supportsFieldSizing()) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  // Expose the docked composer's height so the thread can set scroll-padding-bottom (§9 #20).
  useEffect(() => {
    const el = rootRef.current;
    const doc = document.documentElement;
    if (centered || !el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => doc.style.setProperty("--composer-h", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => {
      ro.disconnect();
      doc.style.removeProperty("--composer-h");
    };
  }, [centered]);

  const refocus = () => {
    if (isFinePointer()) inputRef.current?.focus();
  };

  const send = () => {
    if (blocked) return;
    onSend(value.trim());
    const el = inputRef.current;
    if (!el) return;
    // Keep typing flow on desktop; drop the on-screen keyboard on touch (§10).
    if (isFinePointer()) el.focus();
    else el.blur();
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    send();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter") {
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        send();
      } else if (!e.shiftKey && isFinePointer()) {
        e.preventDefault();
        send();
      }
      return;
    }
    // Esc clears the staged chips (§5.3); the draft is never thrown away by a key press.
    if (e.key === "Escape" && chips.length > 0) {
      e.preventDefault();
      clearChips();
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files);
    if (!files.length) return;
    // Office apps put an image rendering next to copied text; that paste is text, not a file.
    if (e.clipboardData.getData("text/plain") && files.every((f) => f.type.startsWith("image/"))) return;
    e.preventDefault();
    if (uploads.canUpload) {
      void uploads.add(files);
    } else {
      setPasteNote(NO_UPLOAD_NOTE);
      announce(NO_UPLOAD_NOTE);
    }
  };

  const removeChip = (key: string) => {
    setRemoved((prev) => new Set(prev).add(key));
    uploads.remove(key);
    refocus();
  };

  // Hides the chips only: uploads keep going and the files still land in My documents.
  const clearChips = () => {
    const keys = chips.map((u) => u.key);
    setRemoved((prev) => new Set([...prev, ...keys]));
    keys.forEach((key) => uploads.remove(key));
    setExpanded(false);
    announce(
      keys.length === 1
        ? "1 attached file cleared. It stays in My documents."
        : `${keys.length} attached files cleared. They stay in My documents.`,
    );
  };

  const scope = scopeSlot ? (
    <div className={cx("min-w-0 empty:hidden", narrow && "mb-2")}>{scopeSlot}</div>
  ) : null;

  const composer = (
    <form
      onSubmit={onSubmit}
      className={cx(
        "rounded-3xl border border-border-strong bg-panel px-3 pt-3 pb-2 shadow-elev-1",
        "transition-[box-shadow,border-color] duration-150 focus-within:border-accent/40 focus-within:shadow-elev-3",
      )}
    >
      {uploads.rejectedNote && (
        <Note
          glyph="⊘"
          tone="text-bad"
          onDismiss={() => {
            uploads.clearRejectedNote();
            refocus();
          }}
        >
          {uploads.rejectedNote}
        </Note>
      )}
      {pasteNote && (
        <Note
          glyph={<Icon name="lock" width={14} height={14} />}
          tone="text-muted"
          onDismiss={() => {
            setPasteNote(null);
            refocus();
          }}
        >
          {pasteNote}
        </Note>
      )}

      {chips.length > 0 && (
        <div className="mb-2">
          <ul aria-label="Attached files" className="flex flex-wrap gap-2">
            {shown.map((u) => (
              <li key={u.key} className="max-w-full">
                <AttachmentChip upload={u} onRemove={() => removeChip(u.key)} />
              </li>
            ))}
            {many && (
              <li>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setExpanded((v) => !v)}
                  className="h-13 rounded-xl border border-border px-3 text-[13px] font-medium text-text tabular-nums transition-colors hover:bg-panel-2"
                >
                  {expanded ? "Show fewer" : `+${chips.length - COLLAPSED_SHOWN} more`}
                </button>
              </li>
            )}
          </ul>
          {many && <p className="mt-1.5 px-1 text-xs text-muted tabular-nums">{aggregateLine(chips)}</p>}
        </div>
      )}

      {narrow && scope}

      <label htmlFor="composer-input" className="sr-only">
        Your question
      </label>
      <textarea
        id="composer-input"
        ref={inputRef}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        placeholder={placeholder}
        enterKeyHint="send"
        aria-describedby={finePointer ? HINT_ID : undefined}
        className={cx(
          "field-sizing-content block max-h-[200px] w-full resize-none overflow-y-auto bg-transparent px-1.5 py-1",
          "text-[16px] leading-[26px] text-text placeholder:text-muted",
          // The container's focus-within border and shadow are the focus indicator.
          "not-forced-colors:focus-visible:outline-none!",
        )}
      />

      <div className="mt-1 flex min-h-10 flex-wrap items-center gap-2">
        {uploads.canUpload &&
          (firstMessage ? (
            <button
              type="button"
              onClick={() => uploads.pickFiles()}
              className="inline-flex h-9 items-center gap-1.5 rounded-full! border border-border px-3 text-sm font-medium text-text transition-colors hover:bg-panel-2 pointer-coarse:h-11"
            >
              <Icon name="paperclip" />
              Add files
            </button>
          ) : (
            <button
              type="button"
              onClick={() => uploads.pickFiles()}
              aria-label="Attach files"
              className="grid size-9 place-items-center rounded-full! text-muted transition-colors hover:bg-panel-2 hover:text-text pointer-coarse:size-11"
            >
              <Icon name="paperclip" width={18} height={18} />
            </button>
          ))}
        {!narrow && scope}
        <div className="ml-auto flex min-w-0 items-center gap-3">
          <p id={HINT_ID} className="hidden truncate text-xs text-muted md:pointer-fine:block">
            Enter to send · Shift+Enter for a new line
          </p>
          <button
            type="submit"
            aria-label="Send"
            aria-disabled={blocked}
            onMouseDown={(e) => e.preventDefault()}
            className={cx(
              "grid size-9 shrink-0 place-items-center rounded-full! bg-accent text-accent-contrast transition-opacity pointer-coarse:size-11",
              "hover:opacity-90 aria-disabled:cursor-not-allowed aria-disabled:opacity-40",
            )}
          >
            {busy ? <Spinner /> : <Icon name="send" width={18} height={18} strokeWidth={2.2} />}
          </button>
        </div>
      </div>
    </form>
  );

  return (
    <div
      ref={rootRef}
      className={cx(
        "w-full",
        !centered && [
          // §5.3 pb-4 when docked; §10 keeps phones clear of the home indicator.
          "sticky bottom-0 z-10 bg-panel pb-[max(8px,env(safe-area-inset-bottom))]",
          "md:pb-[max(16px,env(safe-area-inset-bottom))]",
          "before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-6",
          "before:bg-linear-to-t before:from-panel before:to-transparent",
        ].join(" "),
      )}
    >
      <div className="mx-auto w-full max-w-[768px] px-6 max-md:px-4">
        {centered && heading && <div className="mb-8 text-center">{heading}</div>}
        {composer}
        {caveat && <p className="mt-2 text-center text-xs text-muted">{caveat}</p>}
      </div>
    </div>
  );
}

function Note({
  glyph,
  tone,
  onDismiss,
  children,
}: {
  glyph: ReactNode;
  tone: string;
  onDismiss: () => void;
  children: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-start gap-2 rounded-xl bg-panel-2 py-1 pr-1 pl-3 text-xs text-text">
      <span aria-hidden="true" className={cx("flex h-6 shrink-0 items-center", tone)}>
        {glyph}
      </span>
      <p className="min-w-0 flex-1 py-1 leading-4">{children}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss note"
        className="grid size-6 shrink-0 place-items-center rounded-full! text-muted transition-colors hover:bg-panel hover:text-text pointer-coarse:size-11"
      >
        <Icon name="close" width={14} height={14} />
      </button>
    </div>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="none" aria-hidden="true" className="motion-safe:animate-spin">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
