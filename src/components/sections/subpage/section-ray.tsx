"use client";

import { motion } from "framer-motion";

/**
 * Intermittent diagonal light ray — appears when the parent section
 * enters the viewport and pulses while visible.
 *
 * Alternating zigzag pattern across the page:
 *  - direction="lr" → top-left to bottom-right, tilts down (8°)
 *  - direction="rl" → bottom-right to top-left, tilts up
 *
 * Colors alternate cyan / violet per section to keep the visual rhythm.
 */
export function SectionRay({
  color = "cyan",
  direction = "lr",
  delay = 0,
}: {
  color?: "cyan" | "violet";
  direction?: "lr" | "rl";
  delay?: number;
}) {
  const isLR = direction === "lr";
  const colorVar =
    color === "cyan" ? "var(--accent-cyan)" : "var(--accent-violet)";
  const glowVar =
    color === "cyan"
      ? "var(--accent-cyan-glow)"
      : "color-mix(in oklab, var(--accent-violet) 60%, transparent)";

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
    >
      <motion.div
        className={`absolute h-[2px] w-[60%] ${
          isLR
            ? "left-[5%] top-[28%] origin-left rotate-[8deg]"
            : "right-[5%] bottom-[28%] origin-right -rotate-[8deg]"
        }`}
        style={{
          background: `linear-gradient(${
            isLR ? "to right" : "to left"
          }, transparent 0%, ${colorVar} 50%, transparent 100%)`,
          boxShadow: `0 0 24px ${glowVar}, 0 0 8px ${colorVar}`,
        }}
        initial={{ opacity: 0, scaleX: 0.7 }}
        whileInView={{
          opacity: [0, 0.7, 0.15, 0.65, 0],
          scaleX: [0.7, 1, 0.85, 1, 0.85],
        }}
        viewport={{ once: false, margin: "-12%" }}
        transition={{
          duration: 7,
          delay,
          ease: "easeInOut",
          repeat: Infinity,
          repeatType: "loop",
        }}
      />
    </div>
  );
}
