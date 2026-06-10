"use client";

import { LogOut } from "lucide-react";

export function AdminSignOutButton() {
  async function signOut() {
    await fetch("/api/admin/login", { method: "DELETE" });
    window.location.href = "/admin/login";
  }
  return (
    <button
      type="button"
      onClick={signOut}
      className="inline-flex items-center gap-1 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-[10px] font-medium text-neutral-200 transition-colors hover:bg-neutral-800"
    >
      <LogOut className="size-3" />
      Sign out
    </button>
  );
}
