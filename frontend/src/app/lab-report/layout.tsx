import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Lab Report",
  description:
    "One-page Meme DNA report for your wallet or a single Four.Meme token. Shareable summary, printable.",
};

export default function LabReportLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
