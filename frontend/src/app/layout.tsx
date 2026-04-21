import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "@/components/nav";
import { Footer } from "@/components/footer";

function safeMetadataBase(): URL {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/$/, "");
  const fallback = "http://localhost:3000";
  try {
    return new URL(raw || fallback);
  } catch {
    return new URL(fallback);
  }
}

export const metadata: Metadata = {
  metadataBase: safeMetadataBase(),
  title: {
    default: "MemeLab - Decoding the genome of meme tokens on BNB Chain",
    template: "%s · MemeLab",
  },
  description:
    "Meme DNA, decoded live. MemeLab indexes Four.Meme on BNB Chain, clusters launches into DNA Families, and adds AI-assisted narratives.",
  applicationName: "MemeLab",
  keywords: [
    "MemeLab",
    "Four.Meme",
    "BNB Chain",
    "meme coins",
    "event intelligence",
    "token launches",
  ],
  authors: [{ name: "MemeLab" }],
  openGraph: {
    title: "MemeLab",
    description: "Decoding the origin, evolution, and dominance of meme tokens.",
    type: "website",
    images: [
      {
        url: "/memelab-logo.svg",
        width: 512,
        height: 512,
        alt: "MemeLab: Meme DNA Intelligence",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "MemeLab",
    description: "Meme DNA Intelligence for Four.Meme launches on BNB Chain.",
    images: ["/memelab-logo.svg"],
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/memelab-logo.svg", type: "image/svg+xml" }],
    shortcut: ["/favicon.svg"],
  },
};

export const viewport: Viewport = {
  themeColor: "#05070c",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Nav />
        {/* The outer main spans the whole viewport so hero-class sections
            can opt into "full-bleed" via `full-bleed` class. Narrow content
            lives inside `.page-shell` below. */}
        <main className="relative w-full pb-24">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
