import type { Metadata } from "next";
import { HitlDemo } from "./hitl-demo";

export const metadata: Metadata = {
  title: "Human-in-the-Loop Demo · Loucel Labs Trust Stack",
  description:
    "Loucel Labs HITL demo — high-risk agent actions pause for human review, edit, and approval before they execute.",
  robots: { index: false, follow: false },
};

export default function HitlDemoPage() {
  return (
    <main className="relative min-h-screen bg-bg">
      <HitlDemo />
    </main>
  );
}
