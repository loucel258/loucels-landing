import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/audit/client";
import { isAdminAuthed } from "@/lib/admin/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CRM mutations for /admin. Single action-dispatch route — the CRM has
 * several small writes (note, task, lifecycle) and one endpoint keeps the
 * admin auth + service-client wiring in one place. All writes use the
 * service role; the page reads use the read-only dashboard role.
 */

const AddNote = z.object({
  action: z.literal("add_note"),
  accountId: z.string().uuid(),
  body: z.string().min(1).max(4000),
});
const AddTask = z.object({
  action: z.literal("add_task"),
  accountId: z.string().uuid(),
  title: z.string().min(1).max(200),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  kind: z.enum(["followup_d14", "followup_d28", "custom"]).default("custom"),
});
const CompleteTask = z.object({
  action: z.literal("complete_task"),
  taskId: z.string().uuid(),
});
const ReopenTask = z.object({
  action: z.literal("reopen_task"),
  taskId: z.string().uuid(),
});
const SetLifecycle = z.object({
  action: z.literal("set_lifecycle"),
  accountId: z.string().uuid(),
  lifecycle: z.enum(["prospect", "active", "dormant", "churned"]),
});
const UpdateContact = z.object({
  action: z.literal("update_contact"),
  accountId: z.string().uuid(),
  contactName: z.string().max(200).nullable().optional(),
  contactPhone: z.string().max(60).nullable().optional(),
});

const Body = z.discriminatedUnion("action", [
  AddNote,
  AddTask,
  CompleteTask,
  ReopenTask,
  SetLifecycle,
  UpdateContact,
]);

export async function POST(req: Request): Promise<Response> {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let input;
  try {
    input = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const sb = getServiceClient();
  if (!sb) {
    return NextResponse.json({ ok: false, error: "service_unavailable" }, { status: 503 });
  }

  const touchAccount = (id: string) =>
    sb.from("crm_accounts").update({ updated_at: new Date().toISOString() }).eq("id", id);

  try {
    switch (input.action) {
      case "add_note": {
        const { error } = await sb
          .from("crm_notes")
          .insert({ account_id: input.accountId, body: input.body, author: "steven" });
        if (error) throw error;
        await touchAccount(input.accountId);
        break;
      }
      case "add_task": {
        const { error } = await sb.from("crm_tasks").insert({
          account_id: input.accountId,
          title: input.title,
          due_date: input.dueDate ?? null,
          kind: input.kind,
        });
        if (error) throw error;
        await touchAccount(input.accountId);
        break;
      }
      case "complete_task": {
        const { error } = await sb
          .from("crm_tasks")
          .update({ status: "done", completed_at: new Date().toISOString() })
          .eq("id", input.taskId);
        if (error) throw error;
        break;
      }
      case "reopen_task": {
        const { error } = await sb
          .from("crm_tasks")
          .update({ status: "open", completed_at: null })
          .eq("id", input.taskId);
        if (error) throw error;
        break;
      }
      case "set_lifecycle": {
        const { error } = await sb
          .from("crm_accounts")
          .update({ lifecycle: input.lifecycle, updated_at: new Date().toISOString() })
          .eq("id", input.accountId);
        if (error) throw error;
        break;
      }
      case "update_contact": {
        const patch: Record<string, string | null> = { updated_at: new Date().toISOString() };
        if (input.contactName !== undefined) patch.primary_contact_name = input.contactName;
        if (input.contactPhone !== undefined) patch.primary_contact_phone = input.contactPhone;
        const { error } = await sb.from("crm_accounts").update(patch).eq("id", input.accountId);
        if (error) throw error;
        break;
      }
    }
  } catch (err) {
     
    console.warn("[crm] mutation failed:", err);
    return NextResponse.json({ ok: false, error: "write_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
