import type { Metadata } from "next";
import { DLPDemo } from "./dlp-demo";

export const metadata: Metadata = {
  title: "DLP Middleware Demo · Loucel Labs Trust Stack",
  description:
    "Loucel Labs DLP middleware — PII and secret detection that strips sensitive data from prompts before they reach the language model.",
  robots: { index: false, follow: false },
};

export default function DLPDemoPage() {
  return (
    <main className="relative min-h-screen bg-bg">
      <DLPDemo />
    </main>
  );
}
