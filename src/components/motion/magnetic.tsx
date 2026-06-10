"use client";

import { useEffect, useRef } from "react";

/**
 * Magnetic — wraps any element (button/link) so it "attracts" the cursor when
 * approached, then springs back on leave. Stripe / Linear / Vercel pattern.
 *
 * Implementation: pointermove on the WRAPPER (which has a wider activation
 * zone via padding/margin) translates the inner child by a fraction of the
 * cursor offset from center. rAF-throttled, springs back via CSS transition.
 *
 * Respects prefers-reduced-motion and disables on coarse pointers (mobile).
 */

export function Magnetic({
  children,
  strength = 0.35,
  className = "",
}: {
  children: React.ReactNode;
  /** 0..1 — how much the element follows the cursor. 0.35 = subtle, 0.6 = aggressive. */
  strength?: number;
  className?: string;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (reduce || coarse) return;

    const wrap = wrapperRef.current;
    const inner = innerRef.current;
    if (!wrap || !inner) return;

    let raf = 0;
    let tx = 0;
    let ty = 0;

    const apply = () => {
      inner.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0)`;
      raf = 0;
    };

    const onMove = (e: PointerEvent) => {
      const r = wrap.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      tx = (e.clientX - cx) * strength;
      ty = (e.clientY - cy) * strength;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onLeave = () => {
      tx = 0;
      ty = 0;
      if (!raf) raf = requestAnimationFrame(apply);
    };

    wrap.addEventListener("pointermove", onMove);
    wrap.addEventListener("pointerleave", onLeave);
    return () => {
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [strength]);

  return (
    <div
      ref={wrapperRef}
      className={`inline-block ${className}`}
      style={{ padding: "12px" /* wider activation zone */ }}
    >
      <div
        ref={innerRef}
        className="inline-block"
        style={{
          transition: "transform 0.55s cubic-bezier(0.16, 1, 0.3, 1)",
          willChange: "transform",
        }}
      >
        {children}
      </div>
    </div>
  );
}
