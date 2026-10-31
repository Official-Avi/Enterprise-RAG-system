// Messages that arrive within one write delay are joined, so a quick second call (e.g. "Uploading
// a.pdf" right after a skipped-files note) never replaces the first one unheard.
let pending: string[] = [];
let timer: number | undefined;

function sentence(message: string): string {
  return /[.!?…]$/.test(message) ? message : `${message}.`;
}

/** Polite announcement through the single #sr-announcer region (root layout). */
export function announce(message: string): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById("sr-announcer");
  if (!el) return;
  const text = message.trim();
  if (text && !pending.includes(text)) pending.push(text);
  if (timer !== undefined) return;
  el.textContent = "";
  // Clearing first and writing after a tick makes screen readers re-announce identical messages.
  timer = window.setTimeout(() => {
    timer = undefined;
    const joined = pending.length > 1 ? pending.map(sentence).join(" ") : (pending[0] ?? "");
    pending = [];
    (document.getElementById("sr-announcer") ?? el).textContent = joined;
  }, 50);
}
