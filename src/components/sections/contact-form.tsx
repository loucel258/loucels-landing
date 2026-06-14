"use client";

import { useState } from "react";
import { ArrowUpRight, Check, Loader2 } from "lucide-react";
import { Reveal } from "@/components/motion/reveal";
import type { Locale } from "@/i18n/config";

/**
 * Contact form — the low-commitment path that lives beside "Book a call".
 * For the visitor who's still comparing and isn't ready to pick a calendar
 * slot. Posts to /api/contact → leads table (source='contact_form') →
 * internal alert. Self-contained bilingual copy (no global Dictionary edit).
 */

const COPY = {
  en: {
    eyebrow: "Not ready for a call?",
    title: "Send us a message instead.",
    subtitle:
      "Tell us what you're working on. No calendar, no commitment, no pitch. We'll read it and reply like humans.",
    name: "Name",
    email: "Email",
    business: "Business (optional)",
    phone: "Phone (optional)",
    message: "What can we help with?",
    messagePlaceholder: "A sentence or two about what you're trying to fix…",
    submit: "Send message",
    sending: "Sending…",
    successTitle: "Got it.",
    successBody: "Your message is in. We'll get back to you by email shortly.",
    errorGeneric: "Something went wrong. Try again, or email contact@loucellscore.com.",
    errorRate: "One moment — too many submissions. Try again in a few minutes.",
    required: "Name, email, and a message are required.",
  },
  es: {
    eyebrow: "¿No estás listo para una llamada?",
    title: "Mándanos un mensaje.",
    subtitle:
      "Cuéntanos en qué estás trabajando. Sin calendario, sin compromiso, sin pitch. Lo leemos y te respondemos como humanos.",
    name: "Nombre",
    email: "Email",
    business: "Negocio (opcional)",
    phone: "Teléfono (opcional)",
    message: "¿En qué te podemos ayudar?",
    messagePlaceholder: "Una o dos frases sobre lo que estás tratando de resolver…",
    submit: "Enviar mensaje",
    sending: "Enviando…",
    successTitle: "Listo.",
    successBody: "Tu mensaje llegó. Te respondemos por email en breve.",
    errorGeneric: "Algo salió mal. Inténtalo de nuevo, o escribe a contact@loucellscore.com.",
    errorRate: "Un momento — demasiados envíos. Inténtalo de nuevo en unos minutos.",
    required: "Nombre, email y un mensaje son obligatorios.",
  },
} as const;

const fieldCls =
  "w-full rounded-xl border border-border-soft bg-surface/40 px-4 py-3 text-[15px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-cyan focus:ring-2 focus:ring-cyan/20";

export function ContactForm({ locale }: { locale: Locale }) {
  const t = COPY[locale];
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "sending") return;
    const form = e.currentTarget;
    const data = new FormData(form);
    const payload = {
      name: String(data.get("name") ?? "").trim(),
      email: String(data.get("email") ?? "").trim(),
      message: String(data.get("message") ?? "").trim(),
      business: String(data.get("business") ?? "").trim() || undefined,
      phone: String(data.get("phone") ?? "").trim() || undefined,
      company_website: String(data.get("company_website") ?? ""), // honeypot
    };
    if (!payload.name || !payload.email || !payload.message) {
      setStatus("error");
      setErrorMsg(t.required);
      return;
    }

    setStatus("sending");
    setErrorMsg("");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setStatus("success");
        form.reset();
      } else {
        setStatus("error");
        setErrorMsg(res.status === 429 ? t.errorRate : t.errorGeneric);
      }
    } catch {
      setStatus("error");
      setErrorMsg(t.errorGeneric);
    }
  }

  return (
    <section id="contact-form" className="relative py-24 md:py-28">
      <div className="container-page">
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-12 lg:grid-cols-[0.85fr_1fr] lg:gap-16">
          {/* Left — framing */}
          <div className="flex flex-col gap-6">
            <Reveal>
              <div className="flex items-center gap-3">
                <span aria-hidden className="size-1 rounded-full bg-cyan" />
                <span className="text-micro text-cyan">{"// "}{t.eyebrow}</span>
              </div>
            </Reveal>
            <Reveal>
              <h2 className="text-display-2 text-balance text-text-primary">{t.title}</h2>
            </Reveal>
            <Reveal delay={0.1}>
              <p className="max-w-md text-pretty text-[15px] leading-relaxed text-text-secondary">
                {t.subtitle}
              </p>
            </Reveal>
          </div>

          {/* Right — form / success */}
          <Reveal delay={0.15} preset="fade">
            {status === "success" ? (
              <div className="flex h-full flex-col items-start justify-center gap-4 rounded-2xl border border-cyan/30 bg-cyan/5 p-8">
                <span className="inline-flex size-12 items-center justify-center rounded-xl bg-cyan text-bg">
                  <Check className="size-6" />
                </span>
                <h3 className="text-xl font-semibold text-text-primary">{t.successTitle}</h3>
                <p className="text-[15px] text-text-secondary">{t.successBody}</p>
              </div>
            ) : (
              <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-mono-xs text-text-tertiary">{t.name}</span>
                    <input name="name" type="text" autoComplete="name" required className={fieldCls} />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-mono-xs text-text-tertiary">{t.email}</span>
                    <input name="email" type="email" autoComplete="email" required className={fieldCls} />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-mono-xs text-text-tertiary">{t.business}</span>
                    <input name="business" type="text" autoComplete="organization" className={fieldCls} />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-mono-xs text-text-tertiary">{t.phone}</span>
                    <input name="phone" type="tel" autoComplete="tel" className={fieldCls} />
                  </label>
                </div>
                <label className="flex flex-col gap-1.5">
                  <span className="text-mono-xs text-text-tertiary">{t.message}</span>
                  <textarea
                    name="message"
                    required
                    rows={4}
                    placeholder={t.messagePlaceholder}
                    className={`${fieldCls} resize-none`}
                  />
                </label>

                {/* Honeypot — visually hidden, off-screen, not tabbable */}
                <input
                  type="text"
                  name="company_website"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden
                  className="absolute left-[-9999px] size-0 opacity-0"
                />

                {status === "error" && (
                  <p className="text-sm text-rose-400">{errorMsg}</p>
                )}

                <button
                  type="submit"
                  disabled={status === "sending"}
                  className="group inline-flex h-13 w-fit items-center gap-3 rounded-xl border border-cyan/40 bg-cyan/10 px-7 py-3.5 text-[15px] font-semibold text-cyan backdrop-blur-sm transition-all duration-300 hover:border-cyan hover:bg-cyan hover:text-bg hover:shadow-[0_0_40px_-4px_var(--accent-cyan-glow)] active:scale-[0.98] disabled:opacity-60"
                >
                  {status === "sending" ? (
                    <>
                      {t.sending}
                      <Loader2 className="size-4 animate-spin" />
                    </>
                  ) : (
                    <>
                      {t.submit}
                      <ArrowUpRight
                        className="size-4 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                        strokeWidth={2}
                      />
                    </>
                  )}
                </button>
              </form>
            )}
          </Reveal>
        </div>
      </div>
    </section>
  );
}
