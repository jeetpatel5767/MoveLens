import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MoveLens — Sui Move Security Auditor",
  description: "AI-powered security analysis for Sui Move smart contracts",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
