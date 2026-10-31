import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], axes: ["opsz"], display: "swap", variable: "--font-inter" });

export const metadata: Metadata = {
  title: "RackFlow AI",
  description: "Ask questions about your documents and see the exact page every answer came from.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#0f6b66",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`h-full antialiased ${inter.variable}`}>
      <body className="min-h-full">
        {children}
        {/* The one polite announcer for status changes (answers ready, uploads finished). */}
        <div id="sr-announcer" role="status" aria-live="polite" aria-atomic="true" className="sr-only" />
      </body>
    </html>
  );
}
