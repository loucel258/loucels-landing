"use client";


/**
 * LogosMarquee — horizontal infinite scroll of the tools Loucels agents talk to.
 *
 * Wordmarks-only (no logo asset files) — keeps repo light, dodges trademark
 * issues, and matches the "your tools stay, the AI joins them" framing.
 *
 * Two duplicate tracks animate in tandem so the loop is seamless. Edge mask
 * fades the wordmarks into the background on both sides.
 */

const TOOLS = [
  "Boulevard",
  "Twilio",
  "QuickBooks",
  "Stripe",
  "Google Calendar",
  "Slack",
  "JobNimbus",
  "Toast",
  "Mews",
  "Weave",
  "HubSpot",
  "Resend",
  "Mindbody",
  "Wealthbox",
  "Notion",
  "Linear",
];

export function LogosMarquee({ locale = "en" }: { locale?: "en" | "es" }) {
  const label =
    locale === "es"
      ? "Tu stack se queda. El agente se conecta a él."
      : "Your stack stays. The agent joins it.";

  return (
    <section
      aria-label="Tools the agents integrate with"
      className="relative isolate overflow-hidden py-12 md:py-16"
    >
      <div className="container-page flex flex-col items-center gap-6">
        <span className="text-micro text-text-secondary">
          // {label}
        </span>

        <div
          className="relative w-full overflow-hidden"
          style={{
            maskImage:
              "linear-gradient(to right, transparent, black 12%, black 88%, transparent)",
            WebkitMaskImage:
              "linear-gradient(to right, transparent, black 12%, black 88%, transparent)",
          }}
        >
          <div className="flex w-max gap-12 [animation:logo-marquee_38s_linear_infinite] hover:[animation-play-state:paused]">
            {[...TOOLS, ...TOOLS].map((name, i) => (
              <span
                key={i}
                className="shrink-0 select-none whitespace-nowrap font-mono text-[15px] tracking-[0.06em] text-text-secondary/80 transition-colors duration-200 hover:text-cyan"
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes logo-marquee {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
      `}</style>
    </section>
  );
}
