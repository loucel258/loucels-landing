import type { Metadata } from "next";
import { RBACDemo } from "./rbac-demo";

export const metadata: Metadata = {
  title: "RBAC Demo · Loucel Labs Trust Stack",
  description:
    "Loucel Labs RBAC middleware — role-based authorization enforced before the prompt reaches the language model.",
  robots: { index: false, follow: false },
};

export default function RBACDemoPage() {
  return (
    <main className="relative min-h-screen bg-bg">
      <RBACDemo />
    </main>
  );
}
