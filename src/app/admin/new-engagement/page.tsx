import { isAdminAuthed } from "@/lib/admin/auth";
import { AuthWall } from "@/components/admin/auth-wall";
import { PageHeader } from "@/components/admin/page-header";
import { NewEngagementForm } from "./form";

/**
 * /admin/new-engagement — single-form page to seed an engagement row.
 *
 * Closes the "engagements are created manually via SQL" gap.
 * Webhooks (DocuSign/Stripe/Tally) update the row after creation.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "New engagement — Loucels admin",
  robots: { index: false, follow: false },
};

export default async function NewEngagementPage() {
  if (!(await isAdminAuthed())) return <AuthWall />;

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <PageHeader
        title="New engagement"
        subtitle="Creates a row in engagements with status prospect_signed_up. Webhooks transition it automatically as DocuSign / Stripe / Tally events fire."
      />

      <NewEngagementForm />

      <p className="mt-6 text-xs text-neutral-500">
        After creating, run{" "}
        <code className="rounded bg-neutral-100 px-1 py-0.5 text-[11px]">
          bash gap-audit-kit/bin/new-engagement.sh
        </code>{" "}
        with the same engagement reference to scaffold the local folder.
      </p>
    </main>
  );
}
