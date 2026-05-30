import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <div className="flex flex-col items-center gap-6">
        <span className="font-mono text-xs uppercase tracking-[0.25em] text-accent">
          // 404
        </span>
        <h1 className="text-balance text-5xl font-semibold leading-tight tracking-tight md:text-7xl">
          Page not found
        </h1>
        <p className="max-w-md text-balance text-lg leading-relaxed text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist, or has been
          moved.
          <br />
          La página que buscas no existe o fue movida.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/en"
            className={cn(buttonVariants(), "h-11 px-5 text-base")}
          >
            Back to home
          </Link>
          <Link
            href="/es"
            className={cn(
              buttonVariants({ variant: "outline" }),
              "h-11 px-5 text-base",
            )}
          >
            Volver al inicio
          </Link>
        </div>
      </div>
    </main>
  );
}
