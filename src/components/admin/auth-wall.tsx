import Link from "next/link";
import { Lock } from "lucide-react";

/**
 * AuthWall — splash shown by admin pages when the session cookie is
 * missing/invalid. Sends the operator to the POST-form login.
 */
export function AuthWall() {
  return (
    <div className="mx-auto mt-20 max-w-md p-6 text-center">
      <div className="inline-flex size-12 items-center justify-center rounded-xl bg-neutral-100 text-neutral-500">
        <Lock className="size-5" />
      </div>
      <h1 className="mt-4 text-lg font-semibold">Loucells Core admin</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Session expired or not signed in. Go to{" "}
        <Link
          className="font-medium text-cyan-700 underline-offset-2 hover:underline"
          href="/admin/login"
        >
          /admin/login
        </Link>
        .
      </p>
    </div>
  );
}
