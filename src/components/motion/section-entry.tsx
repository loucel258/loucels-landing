"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Subtle "the next section arrives" effect — scale 0.97 → 1 + opacity 0.7 → 1
 * when the wrapped content enters the viewport. Respects prefers-reduced-motion
 * (returns a plain div). Designed to wrap a section's inner `container-page`
 * div rather than the `<section>` itself so absolute-positioned backgrounds
 * and glows stay anchored while only the content "breathes" in.
 *
 * Trigger margin pulls the start earlier (when content is ~25% from the
 * bottom edge of the viewport), so by the time the user is reading the
 * section the animation has already completed and isn't pulling their eye.
 */
export function SectionEntry({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) {
    return <div className={className}>{children}</div>;
  }
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0.7, scale: 0.97 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true, margin: "0px 0px -22% 0px" }}
      transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
