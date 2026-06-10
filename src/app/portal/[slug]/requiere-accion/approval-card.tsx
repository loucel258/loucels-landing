"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle, Pencil, Mail, AlertTriangle, Loader2 } from "lucide-react";

type Approval = {
  id: string;
  action_type: string;
  recipient: string | null;
  proposed_text: string;
  edited_text: string | null;
  risk_score: number | null;
  risk_flags: string[];
  created_at: string;
};

const ACTION_LABELS: Record<string, string> = {
  send_message: "Enviar mensaje",
  send_quote: "Enviar cotización",
  send_refund: "Procesar reembolso",
  reply_review: "Responder reseña",
};

const REAL_TIME_ACTIONS = new Set(["send_message"]);

export function ApprovalCard({ approval, slug }: { approval: Approval; slug: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "edit" | "reject">("view");
  const [editedText, setEditedText] = useState(approval.edited_text || approval.proposed_text);
  const [rejectReason, setRejectReason] = useState("");
  const [result, setResult] = useState<
    | null
    | { kind: "approved"; realtime: boolean }
    | { kind: "rejected" }
    | { kind: "error"; message: string }
  >(null);
  const [pending, startTransition] = useTransition();

  const isHighRisk = (approval.risk_score ?? 0) >= 70;
  const isMediumRisk = (approval.risk_score ?? 0) >= 40;
  const actionLabel = ACTION_LABELS[approval.action_type] ?? approval.action_type;
  const isRealTime = REAL_TIME_ACTIONS.has(approval.action_type);

  async function callApprove(text: string | undefined) {
    setResult(null);
    try {
      const res = await fetch(`/api/portal/${slug}/hitl/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvalId: approval.id, editedText: text }),
      });
      const data = await res.json();
      if (data.ok) {
        setResult({ kind: "approved", realtime: !!data.executedRealtime });
        startTransition(() => router.refresh());
      } else {
        setResult({ kind: "error", message: data.error ?? "unknown" });
      }
    } catch {
      setResult({ kind: "error", message: "network" });
    }
  }

  async function callReject() {
    setResult(null);
    try {
      const res = await fetch(`/api/portal/${slug}/hitl/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvalId: approval.id, reason: rejectReason.trim() || undefined }),
      });
      const data = await res.json();
      if (data.ok) {
        setResult({ kind: "rejected" });
        startTransition(() => router.refresh());
      } else {
        setResult({ kind: "error", message: data.error ?? "unknown" });
      }
    } catch {
      setResult({ kind: "error", message: "network" });
    }
  }

  if (result?.kind === "approved") {
    return (
      <div className="overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-cyan-50/40 p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="inline-flex size-10 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-md shadow-emerald-500/30">
            <CheckCircle2 className="size-5" />
          </span>
          <div>
            <p className="text-sm font-bold text-emerald-900">
              {result.realtime ? "Enviado" : "Aprobado"}
            </p>
            <p className="text-xs text-emerald-700">
              {result.realtime
                ? "El mensaje salió al instante."
                : "Loucels lo está ejecutando — confirmación en 1 hora hábil."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (result?.kind === "rejected") {
    return (
      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 p-6">
        <div className="flex items-center gap-3">
          <span className="inline-flex size-10 items-center justify-center rounded-xl bg-neutral-500 text-white">
            <XCircle className="size-5" />
          </span>
          <div>
            <p className="text-sm font-bold text-neutral-900">Rechazado</p>
            <p className="text-xs text-neutral-600">El agente no enviará esta acción.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${
        isHighRisk ? "border-rose-300" : isMediumRisk ? "border-amber-300" : "border-neutral-200"
      }`}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-violet-500 text-white">
            <Mail className="size-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-neutral-900">{actionLabel}</p>
            {approval.recipient && (
              <p className="text-[11px] text-neutral-500">
                → <code className="rounded bg-neutral-100 px-1 py-px">{approval.recipient}</code>
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {isHighRisk && (
            <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-rose-700 ring-1 ring-rose-200">
              <AlertTriangle className="size-3" />
              Riesgo alto
            </span>
          )}
          {!isHighRisk && isMediumRisk && (
            <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 ring-1 ring-amber-200">
              Riesgo medio
            </span>
          )}
          {approval.risk_flags.slice(0, 3).map((f) => (
            <span key={f} className="rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
              {f}
            </span>
          ))}
        </div>
      </header>

      <div className="px-5 py-4">
        {mode === "edit" ? (
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              Edita el mensaje
            </p>
            <textarea
              value={editedText}
              onChange={(e) => setEditedText(e.target.value)}
              rows={6}
              className="w-full rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm leading-relaxed text-neutral-800 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
            />
          </div>
        ) : (
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              {mode === "reject" ? "Mensaje que el agente quería enviar" : "El agente quiere enviar:"}
            </p>
            <p className="whitespace-pre-wrap rounded-lg bg-neutral-50 px-4 py-3 text-sm leading-relaxed text-neutral-800">
              {approval.proposed_text}
            </p>
          </div>
        )}

        {mode === "reject" && (
          <div className="mt-4">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              ¿Por qué? (opcional)
            </p>
            <input
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Lo escribiré yo / información incorrecta / no estoy listo todavía"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-800 outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100"
            />
          </div>
        )}
      </div>

      <footer className="border-t border-neutral-100 bg-neutral-50/60 px-5 py-3">
        {mode === "view" && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => callApprove(undefined)}
              className="inline-flex flex-1 min-w-[140px] items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-md shadow-emerald-500/30 transition-all hover:shadow-emerald-500/40 disabled:opacity-50"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              Aprobar y enviar
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setMode("edit")}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-neutral-700 ring-1 ring-neutral-300 transition-colors hover:bg-neutral-50 disabled:opacity-50"
            >
              <Pencil className="size-4" /> Modificar
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setMode("reject")}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-rose-700 ring-1 ring-rose-200 transition-colors hover:bg-rose-50 disabled:opacity-50"
            >
              <XCircle className="size-4" /> Rechazar
            </button>
            {isRealTime && (
              <p className="ml-auto text-[10px] text-neutral-500">
                Se envía al instante vía Resend
              </p>
            )}
            {!isRealTime && (
              <p className="ml-auto text-[10px] text-neutral-500">
                Confirmación en 1 hora hábil
              </p>
            )}
          </div>
        )}

        {mode === "edit" && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => callApprove(editedText)}
              className="inline-flex flex-1 min-w-[140px] items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-md shadow-emerald-500/30 disabled:opacity-50"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              Aprobar versión editada
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => { setMode("view"); setEditedText(approval.proposed_text); }}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-neutral-700 ring-1 ring-neutral-300 disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        )}

        {mode === "reject" && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={callReject}
              className="inline-flex flex-1 min-w-[140px] items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-rose-500 to-rose-600 px-5 py-3 text-sm font-bold text-white shadow-md shadow-rose-500/30 disabled:opacity-50"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <XCircle className="size-4" />}
              Confirmar rechazo
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => { setMode("view"); setRejectReason(""); }}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-neutral-700 ring-1 ring-neutral-300 disabled:opacity-50"
            >
              Atrás
            </button>
          </div>
        )}

        {result?.kind === "error" && (
          <p className="mt-2 text-xs text-rose-600">
            No pudimos procesar la acción ({result.message}). Inténtalo de nuevo o escribe a steven@loucels.com.
          </p>
        )}
      </footer>
    </div>
  );
}
