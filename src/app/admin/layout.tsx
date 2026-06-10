import {
  Users,
  TrendingUp,
  Activity,
  Bot,
  PlusCircle,
  Settings,
  LogOut,
  HelpCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import { Sidebar, MobileBrandBar } from "@/components/shell/sidebar";
import { getPathname } from "@/lib/shell/pathname";
import { AdminSignOutButton } from "./sign-out";

export const metadata = {
  title: "Loucels admin",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = await getPathname("/admin");

  // Login page = bare shell (no sidebar)
  if (pathname.endsWith("/login")) {
    return <BareShell>{children}</BareShell>;
  }

  const sections = [
    {
      label: "Operations",
      items: [
        { href: "/admin/clients",     label: "Clients",     icon: <Users className="size-4" />,       match: "/admin/clients",     prefix: true },
        { href: "/admin/agents",      label: "Agents",      icon: <Bot className="size-4" />,         match: "/admin/agents",      prefix: true },
        { href: "/admin/revenue",     label: "Revenue",     icon: <TrendingUp className="size-4" />,  match: "/admin/revenue",     prefix: true },
        { href: "/admin/chat-pulse",  label: "Chat pulse",  icon: <Activity className="size-4" />,    match: "/admin/chat-pulse",  prefix: true },
      ],
    },
    {
      label: "Actions",
      items: [
        { href: "/admin/new-engagement", label: "New engagement", icon: <PlusCircle className="size-4" />, match: "/admin/new-engagement" },
      ],
    },
    {
      label: "Account",
      items: [
        { href: "/admin/settings", label: "Settings", icon: <Settings className="size-4" />, match: "/admin/settings", comingSoon: true },
        { href: "https://github.com/anthropics/claude-code/issues", label: "Help & feedback", icon: <HelpCircle className="size-4" />, match: "_never_" },
      ],
    },
  ];

  return (
    <div className="flex min-h-screen bg-neutral-50 text-neutral-900">
      <Sidebar
        brand={{
          workspaceName: "Loucels HQ",
          subtitle: "Admin operations",
          initials: "L",
        }}
        sections={sections}
        pathname={pathname}
        footer={
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-neutral-500">8-hour session</p>
            <AdminSignOutButton />
          </div>
        }
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileBrandBar
          brand={{
            workspaceName: "Loucels HQ",
            subtitle: "Admin",
            initials: "L",
          }}
        />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}

function BareShell({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-neutral-50 text-neutral-900">{children}</div>;
}
