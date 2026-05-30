"use client";

import { motion, type Variants } from "framer-motion";
import { useRef } from "react";

const variants: Record<string, Variants> = {
  fadeUp: {
    hidden: { opacity: 0, y: 32 },
    visible: { opacity: 1, y: 0 },
  },
  fade: {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
  },
  blurUp: {
    hidden: { opacity: 0, y: 24, filter: "blur(12px)" },
    visible: { opacity: 1, y: 0, filter: "blur(0px)" },
  },
};

export function Reveal({
  children,
  delay = 0,
  preset = "blurUp",
  className,
  as = "div",
}: {
  children: React.ReactNode;
  delay?: number;
  preset?: "fadeUp" | "fade" | "blurUp";
  className?: string;
  as?: "div" | "span" | "section" | "li" | "p" | "h2" | "h3";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const Tag = motion[as as keyof typeof motion] as typeof motion.div;
  return (
    <Tag
      ref={ref}
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-80px" }}
      variants={variants[preset]}
      transition={{
        duration: 0.9,
        delay,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      {children}
    </Tag>
  );
}

export function StaggerGroup({
  children,
  className,
  stagger = 0.08,
  delayChildren = 0.1,
}: {
  children: React.ReactNode;
  className?: string;
  stagger?: number;
  delayChildren?: number;
}) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-80px" }}
      variants={{
        hidden: {},
        visible: {
          transition: {
            staggerChildren: stagger,
            delayChildren,
          },
        },
      }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
  preset = "blurUp",
}: {
  children: React.ReactNode;
  className?: string;
  preset?: "fadeUp" | "fade" | "blurUp";
}) {
  return (
    <motion.div
      className={className}
      variants={variants[preset]}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
