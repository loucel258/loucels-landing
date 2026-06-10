import { redirect } from "next/navigation";
import { isAdminAuthed } from "@/lib/admin/auth";
import { LoginForm } from "./form";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata = {
  title: "Sign in — Loucels admin",
  robots: { index: false, follow: false },
};

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (await isAdminAuthed()) redirect("/admin/chat-pulse");
  const { next } = await searchParams;
  return <LoginForm nextPath={next ?? "/admin/chat-pulse"} />;
}
