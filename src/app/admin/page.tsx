import { redirect } from "next/navigation";
import { isAdminAuthed } from "@/lib/admin/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata = {
  title: "Loucells Core admin",
  robots: { index: false, follow: false },
};

export default async function AdminIndex() {
  if (await isAdminAuthed()) redirect("/admin/dashboard");
  redirect("/admin/login");
}
