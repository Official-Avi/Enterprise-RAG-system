import type { Metadata, Viewport } from "next";
import { Familjen_Grotesk, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

// Two families (design.md § Type): Familjen Grotesk for heads, figures and keys, IBM Plex Sans for
// everything read. Variable weights so dark mode can drop the body to 370. Mono is the system stack.
const familjen = Familjen_Grotesk({
  subsets: ["latin"],
  weight: "variable",
  display: "swap",
  variable: "--font-familjen",
});
const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: "variable",
  display: "swap",
  variable: "--font-plex",
});

export const metadata: Metadata = {
  title: "RackFlow AI",
  description: "Ask questions about your documents and see the exact page every answer came from.",
};

// Browser chrome colour. Metadata can't read CSS variables: these mirror --bg in globals.css.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fbfe" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0f13" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`h-full antialiased ${familjen.variable} ${plex.variable}`}
    >
      <body className="min-h-full">
        {children}
        {/* The one polite announcer for status changes (answers ready, uploads finished). */}
        <div id="sr-announcer" role="status" aria-live="polite" aria-atomic="true" className="sr-only" />
      </body>
    </html>
  );
}
