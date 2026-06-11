"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

/**
 * SmoothScroll — Lenis integrated with GSAP ScrollTrigger.
 * Without this integration, both libraries compute scroll separately and
 * fight each other, causing dropped frames and stutter.
 */
export function SmoothScroll() {
  useEffect(() => {
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduced) return;

    // lerp mode instead of duration+easing: trackpads emit hundreds of
    // fine-grained wheel events with their own OS inertia. A fixed
    // 1s-duration ease on top double-smooths that input — the scroll
    // feels ignored, then the accumulated momentum dumps all at once.
    // lerp applies a per-frame fraction, so the page tracks the fingers
    // almost 1:1 while still feeling buttery on discrete mouse wheels.
    const lenis = new Lenis({
      lerp: 0.14,
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 1.2,
    });

    // Tell ScrollTrigger to update when Lenis scrolls
    lenis.on("scroll", ScrollTrigger.update);

    // Drive Lenis with GSAP ticker so both share one rAF loop.
    // The callback MUST be removed on cleanup: without it, StrictMode
    // double-mount and HMR remounts stack tickers that each call
    // lenis.raf() per frame — the scroll integrates 2-3x per frame and
    // trackpad input turns into "ignored, then jumps" jank.
    const onTick = (time: number) => {
      lenis.raf(time * 1000);
    };
    gsap.ticker.add(onTick);
    gsap.ticker.lagSmoothing(0);

    // ScrollTrigger uses Lenis's scroll value
    ScrollTrigger.scrollerProxy(document.body, {
      scrollTop(value) {
        if (arguments.length && value !== undefined) {
          lenis.scrollTo(value, { immediate: true });
        }
        return window.scrollY;
      },
      getBoundingClientRect() {
        return {
          top: 0,
          left: 0,
          width: window.innerWidth,
          height: window.innerHeight,
        };
      },
    });

    ScrollTrigger.defaults({ scroller: document.body });
    ScrollTrigger.refresh();

    return () => {
      gsap.ticker.remove(onTick);
      lenis.destroy();
      ScrollTrigger.getAll().forEach((t) => t.kill());
    };
  }, []);

  return null;
}
