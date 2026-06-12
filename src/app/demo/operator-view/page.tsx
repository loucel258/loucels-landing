import type { Metadata } from "next";
import { OperatorViewDemo } from "./operator-view-demo";

export const metadata: Metadata = {
  title: "Operator view — Loucells Core",
  description:
    "What a Loucells Core client sees day-to-day. Approve high-stakes actions, watch live activity, see the system breathe.",
  robots: { index: false, follow: false },
};

export default function OperatorViewPage() {
  return <OperatorViewDemo />;
}
