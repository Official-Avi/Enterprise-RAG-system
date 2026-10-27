import { PageHeader } from "./ui";

/** Honest placeholder for modules scheduled later in the sprint (no fake data). */
export function NotYet({ title, description }: { title: string; description: string }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
        <p className="font-medium">Not available yet</p>
        <p className="mt-1 text-sm text-muted">
          This module is scheduled for Day 2 of the sprint. See Docs/TODO.md for its status.
        </p>
      </div>
    </>
  );
}
