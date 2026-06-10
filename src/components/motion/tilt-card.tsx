"use client";

import { useEffect, useRef } from "react";

/**
 * TiltCard — wraps content with a subtle 3D tilt that follows the cursor.
 * Optional specular glare travels opposite the tilt direction.
 *
 * Disabled on touch (coarse pointer) + prefers-reduced-motion. Settles via
 * CSS transition on pointerleave so there's no jank.
 *
 * Pass `glare={false}` if the card's content already has bright accents that
 * would clash with the white sheen (e.g. cyan ring on hover).
 */

export function TiltCard({
  children,
  maxTilt = 8,
  glare = true,
  className = "",
}: {
  children: React.ReactNode;
  /** Max rotation in degrees on each axis. 8 = subtle, 14 = pronounced. */
  maxTilt?: number;
  glare?: boolean;
  className?: string;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const glareRef = useRef<HTMLDivElement>(null);

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
    let rx = 0;
    let ry = 0;
    let gx = 50;
    let gy = 50;

    const apply = () => {
      inner.style.transform = `perspective(1000px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
      const g = glareRef.current;
      if (g) {
        g.style.background = `radial-gradient(circle at ${gx}% ${gy}%, rgba(255,255,255,0.18), transparent 50%)`;
      }
      raf = 0;
    };

    const onMove = (e: PointerEvent) => {
      const r = wrap.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width; // 0..1
      const py = (e.clientY - r.top) / r.height; // 0..1
      ry = (px - 0.5) * 2 * maxTilt;
      rx = -(py - 0.5) * 2 * maxTilt;
      gx = px * 100;
      gy = py * 100;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onLeave = () => {
      rx = 0;
      ry = 0;
      gx = 50;
      gy = 50;
      if (!raf) raf = requestAnimationFrame(apply);
    };

    wrap.addEventListener("pointermove", onMove);
    wrap.addEventListener("pointerleave", onLeave);
    return () => {
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [maxTilt]);

  return (
    <div
      ref={wrapperRef}
      className={`relative ${className}`}
      style={{ perspective: "1000px" }}
    >
      <div
        ref={innerRef}
        className="relative h-full w-full"
        style={{
          transformStyle: "preserve-3d",
          transition: "transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
          willChange: "transform",
        }}
      >
        {children}
        {glare && (
          <div
            ref={glareRef}
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[inherit] mix-blend-overlay"
            style={{ transition: "background 0.3s ease-out" }}
          />
        )}
      </div>
    </div>
  );
}
