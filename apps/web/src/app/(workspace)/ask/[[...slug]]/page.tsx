"use client";

import { Suspense, useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { cx, ErrorState } from "@/components/ui";
import { AskEmptyState, useAskState } from "@/components/workspace/AskEmptyState";
import { chatTitle, joinNames, modeOf, pageTitle, type AskRoute } from "@/components/workspace/ask/helpers";
import { useArrival } from "@/components/workspace/ask/useArrival";
import { useAskData } from "@/components/workspace/ask/useAskData";
import { useAskRoute } from "@/components/workspace/ask/useAskRoute";
import { useChatSession } from "@/components/workspace/ask/useChatSession";
import { useSourcesState } from "@/components/workspace/ask/useSourcesState";
import { useUploadSignals, type SystemNote } from "@/components/workspace/ask/useUploadSignals";
import { Composer } from "@/components/workspace/Composer";
import { ScopeChip } from "@/components/workspace/ScopeChip";
import { SourcesPanel } from "@/components/workspace/SourcesPanel";
import { SuggestionChips } from "@/components/workspace/SuggestionChips";
import { Thread } from "@/components/workspace/Thread";
import type { AnswerMode, AnswerView, NotFoundContext, TrackedUpload } from "@/components/workspace/types";
import { useUploads } from "@/components/workspace/UploadsContext";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import type { DocumentItem } from "@/lib/types";
import { LOADING_FILENAME, readyMessage } from "@/lib/workspace";

const PLACEHOLDER = "Ask a question about your documents";
const PLACEHOLDER_EMPTY = "Add a document first, then ask anything about it";

// §5.6: the caveat under the docked composer.
const CAVEAT: Record<AnswerMode, string> = {
  extractive: "Answers are exact quotes from your documents. Open the source to check the context.",
  llm: "Claude writes answers from your documents and can make mistakes. Check the cited passages.",
};

// Same breakpoint as the composer's max-md: phones keep the composer at the bottom (§5.3).
const MOBILE_QUERY = "(max-width: 767.98px)";
function subscribeMobile(onChange: () => void) {
  const mq = window.matchMedia(MOBILE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
/** The workspace frame only renders on the client (after /auth/me), so the server snapshot is never shown. */
const useMobile = () =>
  useSyncExternalStore(subscribeMobile, () => window.matchMedia(MOBILE_QUERY).matches, () => false);

/** /ask and /ask/c/[id] (§5): the orchestrator that wires every workspace component. */
export default function AskPage() {
  // useArrival reads useSearchParams, which needs a Suspense boundary when the route prerenders.
  return (
    <Suspense fallback={null}>
      <AskRouter />
    </Suspense>
  );
}

function AskRouter() {
  const { canChat } = useWorkspace();
  const { key, route, adopt } = useAskRoute();
  if (!canChat) return <AuditorView />;
  // A new key (another chat, or "New chat" while already on /ask) remounts the whole view.
  return <AskView key={key} route={route} onAdopt={adopt} />;
}

/** §5.9 E: roles without chat:use get the explained full-page state and load nothing else. */
function AuditorView() {
  const { consoleHref, persona } = useWorkspace();
  useEffect(() => {
    document.title = pageTitle(null);
  }, []);
  return (
    <div className="flex flex-1 flex-col">
      <AskEmptyState
        state="auditor"
        readyCount={0}
        readingDocs={[]}
        onUpload={() => undefined}
        consoleHref={consoleHref}
        isDemo={persona !== null}
      />
    </div>
  );
}

function AskView({ route, onAdopt }: { route: AskRoute; onAdopt: (sessionId: string) => void }) {
  const workspace = useWorkspace();
  const uploads = useUploads();
  const { me, canUpload, consoleHref, persona } = workspace;
  const mobile = useMobile();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // useSourcesState needs the chat's turns, and the chat reports fresh answers to it.
  const noteAnswer = useRef<(answer: AnswerView, hadCitationsBefore: boolean) => void>(() => undefined);

  const data = useAskData({
    enabled: true,
    canRead: me.permissions.includes("collection:read"),
    canModel: me.permissions.includes("model:read"),
    uploads,
  });
  const chat = useChatSession({
    route,
    onAdopt,
    onAnswer: (answer, hadCitationsBefore) => noteAnswer.current(answer, hadCitationsBefore),
    workspace,
    uploads,
    data,
    textareaRef,
  });
  const sources = useSourcesState(chat.turns);
  useLayoutEffect(() => {
    noteAnswer.current = sources.noteAnswer;
  });
  const signals = useUploadSignals(uploads.items);

  const hasTurns = chat.turns.length > 0;
  const state = useAskState({
    loading: data.loading || chat.load === "loading",
    canChat: true,
    canUpload,
    readyCount: data.readyCount,
    pendingCount: data.pendingCount,
    notFound: chat.load === "not_found",
  });
  const loadFailed = chat.load === "error";
  const dataFailed = data.error !== undefined;
  // Operators with nothing Ready and a missing chat get no composer (§5.9 D, F).
  const emptyCanAsk = state === "upload_empty" || state === "reading" || state === "ready";
  const showComposer = !loadFailed && (hasTurns || (emptyCanAsk && !dataFailed));
  const centered = !hasTurns && !mobile;

  const lastAnswer = chat.turns.findLast((t) => t.answer)?.answer;
  const mode = modeOf(lastAnswer?.model) ?? data.defaultMode;

  const title = chatTitle(chat.sessionTitle, chat.turns);
  useEffect(() => {
    document.title = pageTitle(title);
  }, [title]);

  const scope = chat.scope;
  const scopeStats = data.statsFor(scope);
  const notFound: NotFoundContext = {
    documentCount: scopeStats.ready,
    readingCount: scopeStats.pending,
    narrowed: scope !== "all" && data.collections.some((c) => !scope.includes(c.id)),
    canUpload,
    onSearchAll: chat.searchAll,
    onUpload: () => uploads.pickFiles(),
  };

  const ask = (text: string) => {
    signals.clear();
    chat.send(text);
  };

  useArrival({
    enabled: true,
    settled: !data.loading && chat.load !== "loading",
    canSend: showComposer,
    docs: data.docs,
    uploads,
    setDraft: chat.setDraft,
    send: ask,
    setScope: chat.setScope,
    showReading: signals.showReading,
  });

  // State C already lists what is being read, so the "Reading…" row would only repeat it.
  const note = signals.note?.kind === "reading" && !hasTurns && state === "reading" ? null : signals.note;
  const sourceCount = sources.citations.length;

  let top: ReactNode;
  if (loadFailed) {
    top = <LoadError error={chat.loadError} onRetry={chat.retryLoad} />;
  } else if (hasTurns) {
    top = (
      <Thread
        turns={chat.turns}
        mode={mode}
        selectedTurnId={sources.selectedTurnId}
        activeMarker={sources.activeMarker}
        onCite={(turnId, citation) => sources.onCite(turnId, citation)}
        onOpenSources={sources.onOpenSources}
        onRetry={chat.retry}
        onRephrase={chat.rephrase}
        onAskWithoutHeld={chat.askNow}
        onCancelHeld={chat.cancelHeld}
        onStop={chat.stop}
        notFound={notFound}
      />
    );
  } else if (dataFailed && state !== "loading") {
    top = <LoadError error={data.error} onRetry={data.retry} />;
  } else {
    top = (
      <div className={cx("mx-auto w-full max-w-[768px] px-4 md:px-6", centered ? "mt-auto pt-8" : "pt-6")}>
        <AskEmptyState
          state={state}
          readyCount={data.readyCount}
          readingDocs={data.readingDocs}
          onUpload={() => uploads.pickFiles()}
          consoleHref={consoleHref}
          isDemo={persona !== null}
        />
      </div>
    );
  }

  const suggestions =
    showComposer && !hasTurns && state === "ready" ? (
      <SuggestionChips docs={data.docsIn(scope)} mode={mode} onPick={ask} />
    ) : null;

  return (
    // Bounded while there is a thread (it scrolls itself); empty states grow so <main> scrolls them.
    <div className={cx("flex flex-1", hasTurns && "min-h-0")}>
      <div className="flex min-w-0 flex-1 flex-col">
        {hasTurns && (
          <ChatHeader
            title={title}
            sourceCount={sourceCount}
            sourcesOpen={sources.open}
            onToggleSources={sources.toggle}
          />
        )}
        {top}
        {showComposer && (note || (dataFailed && hasTurns) || (suggestions && mobile)) && (
          <div className={cx("relative z-20 mx-auto w-full max-w-[768px] px-4 md:px-6", hasTurns ? "pb-3" : "mt-6")}>
            {dataFailed && hasTurns && <ErrorState error={data.error} onRetry={data.retry} />}
            {note && (
              <SystemRow
                note={note}
                items={uploads.items}
                docs={data.docs}
                onDismiss={hasTurns ? signals.clear : undefined}
              />
            )}
            {/* §5.5: a file that just became ready in a chat is followed by questions about it. */}
            {note?.kind === "ready" && hasTurns && !chat.busy && (
              <div className="mt-3">
                <SuggestionChips docs={readyDocs(data.docs, note.names)} mode={mode} onPick={ask} />
              </div>
            )}
            {suggestions && mobile && <div className="mt-3">{suggestions}</div>}
          </div>
        )}
        {/* One composer in one slot for every state, so the first send keeps its focus (§5.3). */}
        {showComposer && (
          <div className={cx(!hasTurns && (centered ? "mt-8" : "sticky bottom-0 z-10 mt-auto pt-4"))}>
            <Composer
              value={chat.draft}
              onChange={chat.setDraft}
              onSend={ask}
              busy={chat.busy}
              centered={centered}
              placeholder={data.readyCount === 0 && data.pendingCount === 0 ? PLACEHOLDER_EMPTY : PLACEHOLDER}
              scopeSlot={
                data.collections.length > 0 ? (
                  <ScopeChip
                    collections={data.collections}
                    value={scope}
                    onChange={chat.setScope}
                    readingCount={scopeStats.pending}
                  />
                ) : undefined
              }
              caveat={hasTurns ? CAVEAT[mode] : undefined}
              textareaRef={textareaRef}
              firstMessage={!hasTurns}
            />
          </div>
        )}
        {!hasTurns && (
          <div className={cx("mx-auto w-full max-w-[768px] px-4 md:px-6", centered && "mb-auto pb-8")}>
            {suggestions && !mobile && <div className="mt-3">{suggestions}</div>}
          </div>
        )}
      </div>
      <SourcesPanel
        citations={sources.citations}
        activeMarker={sources.activeMarker}
        open={sources.open}
        onClose={sources.close}
        onSelect={sources.onSelect}
      />
    </div>
  );
}

/** §5.2 header: the chat title, and "Sources (n)" while the shown answer has citations. */
function ChatHeader({
  title,
  sourceCount,
  sourcesOpen,
  onToggleSources,
}: {
  title: string | null;
  sourceCount: number;
  sourcesOpen: boolean;
  onToggleSources: () => void;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4 md:px-6 lg:h-14">
      <h1 className="min-w-0 max-w-[420px] truncate text-[15px] font-medium" title={title ?? undefined}>
        {title ?? "New chat"}
      </h1>
      {sourceCount > 0 && (
        <button
          type="button"
          onClick={onToggleSources}
          aria-expanded={sourcesOpen}
          aria-controls={sourcesOpen ? "sources-panel" : undefined}
          className={cx(
            "ml-auto inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border-strong px-3",
            "text-sm font-medium text-text tabular-nums transition-colors duration-150 hover:bg-panel-2 pointer-coarse:h-11",
            sourcesOpen && "border-accent/40 bg-accent-soft text-accent",
          )}
        >
          <Icon name="quote" />
          Sources ({sourceCount})
        </button>
      )}
    </header>
  );
}

function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="mx-auto w-full max-w-[640px] px-4 py-12">
      <ErrorState error={error} onRetry={onRetry} />
    </div>
  );
}

/** Ready documents a "ready" row names, for the suggestions under it. */
function readyDocs(docs: DocumentItem[], names: string[]): DocumentItem[] {
  const wanted = new Set(names);
  return docs.filter((d) => d.status === "indexed" && wanted.has(d.filename));
}

/** The one centred system row (§5.5): "✓ report.pdf is ready · 42 pages", or the ?doc= arrival's
 *  "Reading report.pdf…". The announcer already said it (UploadsProvider), so it isn't a live region. */
function SystemRow({
  note,
  items,
  docs,
  onDismiss,
}: {
  note: SystemNote;
  items: TrackedUpload[];
  docs: DocumentItem[];
  onDismiss?: () => void;
}) {
  let body: ReactNode;
  if (note.kind === "ready") {
    const message = readyMessage(note.names, note.pageCount);
    body = (
      <>
        <Icon name="check" className="shrink-0 text-ok" />
        <span className="min-w-0 wrap-anywhere">
          {note.names.length === 1 ? (
            <>
              {/* readyMessage starts with the filename; only that part is bold. */}
              <strong className="font-semibold text-text">{note.names[0]}</strong>
              {message.slice(note.names[0].length)}
            </>
          ) : (
            message
          )}
        </span>
      </>
    );
  } else {
    const byDoc = new Map(items.filter((u) => u.documentId).map((u) => [u.documentId, u.filename]));
    const docNames = new Map(docs.map((d) => [d.id, d.filename]));
    const names = note.docIds
      .map((id) => byDoc.get(id) ?? docNames.get(id))
      .filter((n): n is string => !!n && n !== LOADING_FILENAME);
    body = (
      <span className="min-w-0 wrap-anywhere">
        Reading {names.length ? joinNames(names) : "your file"}… usually 5–60 seconds. You can type your question
        now.
      </span>
    );
  }

  return (
    <div className="flex items-start justify-center gap-2 text-center text-sm text-muted">
      <p className="flex min-w-0 items-start justify-center gap-2 py-1">{body}</p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-panel-2 hover:text-text pointer-coarse:size-11"
        >
          <Icon name="close" width={14} height={14} />
        </button>
      )}
    </div>
  );
}
