import { notFound, redirect } from "next/navigation";
import { ShieldCheck, CheckCircle2, Clock } from "lucide-react";
import { isPortalAuthed } from "@/lib/portal/auth";
import { getServiceClient } from "@/lib/audit/client";
import { Panel } from "@/components/workspace/panel";
import { EmptyPanel } from "@/components/workspace/empty-panel";
import { ApprovalCard } from "./approval-card";
import { daysAgo } from "@/lib/admin/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ApprovalRow = {
  id: string;
  workspace_id: string;
  action_type: string;
  recipient: string | null;
  proposed_text: string;
  edited_text: string | null;
  status: string;
  decider_id: string | null;
  decision_reason: string | null;
  decided_at: string | null;
  created_at: string;
  risk_score: number | null;
  risk_flags: string[];
};

export default async function RequiereAccionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!(await isPortalAuthed(slug))) redirect(`/portal/${slug}/login`);

  const sb = getServiceClient();
  if (!sb) return null;

  const { data: access } = await sb
    .from("client_portal_access")
    .select("engagement_id")
    .eq("client_slug", slug)
    .maybeSingle();
  if (!access) notFound();

  const { data: agents } = await sb
    .from("client_agents")
    .select("workspace_id")
    .eq("engagement_id", (access as { engagement_id: string }).engagement_id);
  const wsIds = ((agents as Array<{ workspace_id: string }>) ?? []).map((a) => a.workspace_id);

  if (wsIds.length === 0) {
    return (
      <div className="space-y-6">
        <Header empty />
        <Panel>
          <EmptyPanel
            icon={<ShieldCheck className="size-5" />}
            title="Sin agentes activos"
            description="Cuando despleguemos un agente para ti, las acciones que requieran tu aprobación aparecerán aquí."
          />
        </Panel>
      </div>
    );
  }

  const { data: pendingData } = await sb
    .from("pending_approvals")
    .select("*")
    .in("workspace_id", wsIds)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  const { data: recentData } = await sb
    .from("pending_approvals")
    .select("*")
    .in("workspace_id", wsIds)
    .neq("status", "pending")
    .order("decided_at", { ascending: false })
    .limit(20);

  const pending = (pendingData as ApprovalRow[]) ?? [];
  const recent = (recentData as ApprovalRow[]) ?? [];

  return (
    <div className="space-y-6">
      <Header pendingCount={pending.length} />

      {pending.length === 0 ? (
        <Panel tone="success">
          <div className="flex items-center gap-4 py-4">
            <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-500 text-white shadow-md shadow-emerald-500/30">
              <CheckCircle2 className="size-7" />
            </span>
            <div>
              <p className="text-lg font-bold text-neutral-900">Todo bajo control</p>
              <p className="text-sm text-neutral-600">
                Tu agente actuó dentro de las reglas. No hay nada esperando tu aprobación.
              </p>
            </div>
          </div>
        </Panel>
      ) : (
        <div className="space-y-4">
          {pending.map((p) => (
            <ApprovalCard key={p.id} approval={p} slug={slug} />
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <Panel
          title="Historial de decisiones"
          eyebrow="Últimas 20"
          icon={<Clock className="size-4" />}
        >
          <ul className="divide-y divide-neutral-100">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-3 text-xs">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                        r.status === "approved"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-rose-50 text-rose-700"
                      }`}
                    >
                      {r.status === "approved" ? "Aprobado" : "Rechazado"}
                    </span>
                    <span className="text-neutral-700">{r.action_type.replace(/_/g, " ")}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-1 max-w-md text-[11px] text-neutral-500">
                    {r.proposed_text}
                  </p>
                </div>
                <span className="shrink-0 text-[10px] text-neutral-500">
                  {r.decided_at ? `${daysAgo(r.decided_at)}d` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function Header({ pendingCount, empty }: { pendingCount?: number; empty?: boolean }) {
  return (
    <header>
      <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Requiere acción</h1>
      <p className="mt-1 text-sm text-neutral-600">
        {empty
          ? "Espacio reservado para futuras aprobaciones."
          : pendingCount && pendingCount > 0
            ? `${pendingCount} acción${pendingCount === 1 ? "" : "es"} esperando tu visto bueno antes de salir.`
            : "Tu agente está despachando solo. Nada que decidir."}
      </p>
    </header>
  );
}
