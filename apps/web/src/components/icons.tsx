// Minimal stroke icon set (decorative; always paired with visible text or an aria-label).
import type { SVGProps } from "react";

const paths: Record<string, string> = {
  overview: "M3 13h8V3H3v10zm10 8h8V11h-8v10zM3 21h8v-6H3v6zm10-18v6h8V3h-8z",
  collections: "M4 6h16M4 12h16M4 18h10",
  documents: "M7 3h7l5 5v13H7zM14 3v5h5",
  chat: "M4 5h16v11H8l-4 4z",
  inspector: "M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zm5-2 5 5",
  jobs: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  workers: "M4 7h16v10H4zM8 21h8M12 17v4",
  models: "M12 3 3 8l9 5 9-5zM3 16l9 5 9-5M3 12l9 5 9-5",
  evaluation: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  racks: "M5 3h14v18H5zM5 9h14M5 15h14M8 6h.01M8 12h.01M8 18h.01",
  users: "M16 21v-2a4 4 0 0 0-8 0v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  audit: "M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-2-4-2 1-2-2V4h-4v2L9 7 7 6 5 10l2 1v2l-2 1 2 4 2-1 2 2v2h4v-2l2-1 2 1 2-4-2-1z",
  logout: "M15 3h4v18h-4M10 17l5-5-5-5M15 12H3",
  upload: "M12 16V4M7 9l5-5 5 5M4 20h16",
  close: "M6 6l12 12M18 6 6 18",
  refresh: "M20 11a8 8 0 1 0-2 5.3M20 4v7h-7",
};

export type IconName = keyof typeof paths;

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
