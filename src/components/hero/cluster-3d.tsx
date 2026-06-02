"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Cluster3D — drop-in pseudo-3D animated cluster from a single transparent PNG.
 *
 * Fills its parent container. Designed to replace a static <Image /> inside an
 * already-positioned wrapper (the hero section keeps its absolute positioning,
 * radial mask, and entry motion — this just swaps the visual contents).
 *
 * Effects:
 *  - 3 stacked copies at different translateZ / scale / blur / opacity = depth cloud
 *  - Idle floating animation (CSS keyframes, runs even with no input)
 *  - Pointer tilt with lerp easing (rAF stops when settled)
 *  - Specular glare that travels opposite the tilt
 *  - Gyroscope on Android / non-permissioned iOS; respects prefers-reduced-motion
 *
 * Trigger area for cursor tilt is the component's own bounding box. Place this
 * inside a wrapper that defines how much of the screen the tilt zone covers.
 */

const MAX_TILT = 12;
const LERP = 0.08;
const SETTLE = 0.05;

type DOEWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

export function Cluster3D({
  imageSrc = "/hero/01-cluster.webp",
  className = "",
  glareIntensity = 0.35,
}: {
  imageSrc?: string;
  className?: string;
  /** 0..1, white specular opacity. Lower on already-bright backgrounds. */
  glareIntensity?: number;
}) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const glareRef = useRef<HTMLDivElement>(null);

  const target = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });
  const rafId = useRef<number | null>(null);
  const animating = useRef(false);

  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduce(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const applyTransform = useCallback(() => {
    const stage = stageRef.current;
    const glare = glareRef.current;
    if (!stage) return;
    const { x, y } = current.current;
    stage.style.transform = `rotateX(${(-y * MAX_TILT).toFixed(3)}deg) rotateY(${(x * MAX_TILT).toFixed(3)}deg)`;
    if (glare) {
      glare.style.transform = `translate(${(-x * 50).toFixed(1)}%, ${(-y * 50).toFixed(1)}%)`;
    }
  }, []);

  const tick = useCallback(() => {
    const dx = target.current.x - current.current.x;
    const dy = target.current.y - current.current.y;
    if (Math.abs(dx) < SETTLE && Math.abs(dy) < SETTLE) {
      current.current.x = target.current.x;
      current.current.y = target.current.y;
      applyTransform();
      animating.current = false;
      rafId.current = null;
      return;
    }
    current.current.x += dx * LERP;
    current.current.y += dy * LERP;
    applyTransform();
    rafId.current = requestAnimationFrame(tick);
  }, [applyTransform]);

  const ensureRaf = useCallback(() => {
    if (animating.current || reduce) return;
    animating.current = true;
    rafId.current = requestAnimationFrame(tick);
  }, [tick, reduce]);

  useEffect(() => {
    if (reduce) return;
    const scene = sceneRef.current;
    if (!scene) return;
    const onMove = (e: PointerEvent) => {
      const r = scene.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width - 0.5) * 2;
      const y = ((e.clientY - r.top) / r.height - 0.5) * 2;
      target.current.x = Math.max(-1, Math.min(1, x));
      target.current.y = Math.max(-1, Math.min(1, y));
      ensureRaf();
    };
    const onLeave = () => {
      target.current.x = 0;
      target.current.y = 0;
      ensureRaf();
    };
    scene.addEventListener("pointermove", onMove, { passive: true });
    scene.addEventListener("pointerleave", onLeave, { passive: true });
    return () => {
      scene.removeEventListener("pointermove", onMove);
      scene.removeEventListener("pointerleave", onLeave);
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
      animating.current = false;
    };
  }, [reduce, ensureRaf]);

  useEffect(() => {
    if (reduce || typeof window === "undefined") return;
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    const DOE = typeof DeviceOrientationEvent !== "undefined"
      ? (DeviceOrientationEvent as DOEWithPermission)
      : null;
    // iOS 13+ needs a user gesture for permission. Inside a hero we skip
    // silently rather than show a permission button — the idle animation
    // already conveys life on mobile.
    if (DOE && typeof DOE.requestPermission === "function") return;
    const onOrient = (e: DeviceOrientationEvent) => {
      target.current.x = Math.max(-1, Math.min(1, (e.gamma ?? 0) / 45));
      target.current.y = Math.max(-1, Math.min(1, (e.beta ?? 0) / 45));
      ensureRaf();
    };
    window.addEventListener("deviceorientation", onOrient, true);
    return () => window.removeEventListener("deviceorientation", onOrient, true);
  }, [reduce, ensureRaf]);

  return (
    <div
      ref={sceneRef}
      className={`relative h-full w-full ${className}`}
      style={{ perspective: "1400px" }}
    >
      <div
        ref={stageRef}
        className="relative h-full w-full will-change-transform"
        style={{
          transformStyle: "preserve-3d",
          transition: reduce ? "none" : "transform 0.06s linear",
        }}
      >
        {/* Back layer — blurred, lower opacity, atmospheric depth */}
        <img
          src={imageSrc}
          alt=""
          aria-hidden
          draggable={false}
          className={
            reduce
              ? "absolute inset-0 m-auto h-[110%] w-[110%] select-none object-cover object-center opacity-25"
              : "absolute inset-0 m-auto h-[110%] w-[110%] select-none object-cover object-center opacity-25 [animation:c3d-back_18s_ease-in-out_infinite]"
          }
          style={{ transform: "translateZ(-90px) scale(1.12)", filter: "blur(14px)" }}
        />
        {/* Mid layer — centerpiece */}
        <img
          src={imageSrc}
          alt=""
          draggable={false}
          className={
            reduce
              ? "absolute inset-0 m-auto h-full w-full select-none object-cover object-center"
              : "absolute inset-0 m-auto h-full w-full select-none object-cover object-center [animation:c3d-mid_14s_ease-in-out_infinite]"
          }
          style={{ transform: "translateZ(0)" }}
        />
        {/* Front layer — smaller, partial opacity, screen-blended → adds dimensionality */}
        <img
          src={imageSrc}
          alt=""
          aria-hidden
          draggable={false}
          className={
            reduce
              ? "absolute inset-0 m-auto h-[85%] w-[85%] select-none object-cover object-center opacity-50"
              : "absolute inset-0 m-auto h-[85%] w-[85%] select-none object-cover object-center opacity-50 mix-blend-screen [animation:c3d-front_11s_ease-in-out_infinite_reverse]"
          }
          style={{ transform: "translateZ(60px) scale(0.92)" }}
        />
        {/* Specular glare — travels opposite the tilt direction */}
        {!reduce && (
          <div
            ref={glareRef}
            aria-hidden
            className="pointer-events-none absolute inset-0 mix-blend-screen"
            style={{
              background: `radial-gradient(ellipse at 30% 30%, rgba(255,255,255,${glareIntensity}) 0%, rgba(255,255,255,${glareIntensity * 0.3}) 25%, transparent 55%)`,
              transition: "transform 0.08s ease-out",
            }}
          />
        )}
      </div>

      <style>{`
        @keyframes c3d-back  { 0%,100% { transform: translateZ(-90px) scale(1.12) rotate(0deg); } 50% { transform: translateZ(-90px) scale(1.16) rotate(2deg); } }
        @keyframes c3d-mid   { 0%,100% { transform: translateZ(0) translateY(0) scale(1) rotate(0deg); } 50% { transform: translateZ(0) translateY(-1.2%) scale(1.025) rotate(-1.5deg); } }
        @keyframes c3d-front { 0%,100% { transform: translateZ(60px) scale(0.92) rotate(0deg); } 50% { transform: translateZ(60px) scale(0.94) rotate(3deg); } }
      `}</style>
    </div>
  );
}
