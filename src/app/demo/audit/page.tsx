import type { Metadata } from "next";
import { AuditDemo } from "./audit-demo";

export const metadata: Metadata = {
  title: "Audit Trail Demo · Loucel Labs Trust Stack",
  description:
    "Loucel Labs append-only audit log demo — every agent decision recorded immutably, even our team can't rewrite it.",
  robots: { index: false, follow: false },
};

export default function AuditDemoPage() {
  return (
    <main className="relative min-h-screen bg-bg">
      <AuditDemo />
    </main>
  );
}
