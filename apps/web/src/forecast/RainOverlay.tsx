/**
 * Screen-space rain over the map. Intensity (0..1) follows the weather agent's hourly valley-mean rain, so heavier hours rain
 * harder. Visual only: it carries no data beyond that intensity. Off when the user prefers reduced motion.
 */
import { useEffect, useRef } from "react";

type Drop = { x: number; y: number; len: number; v: number; a: number };

export function RainOverlay({ intensity }: { intensity: number }) {
  const cv = useRef<HTMLCanvasElement>(null), flash = useRef<HTMLDivElement>(null);
  const level = useRef(intensity);
  level.current = intensity;

  useEffect(() => {
    const c = cv.current; if (!c) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = c.getContext("2d")!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = 0, h = 0, raf = 0, last = performance.now(), shown = 0, nextFlash = performance.now() + 9000;
    const drops: Drop[] = [];
    const spawn = (anywhere: boolean): Drop => ({ x: Math.random() * (w + 200) - 100, y: anywhere ? Math.random() * h : -30 - Math.random() * 80, len: 9 + Math.random() * 16, v: 900 + Math.random() * 650, a: 0.12 + Math.random() * 0.3 });
    const size = () => { w = c.clientWidth; h = c.clientHeight; c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    size();
    const ro = new ResizeObserver(size); ro.observe(c);
    const slant = 0.18;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      shown += (level.current - shown) * Math.min(1, dt * 2.2); // ease toward the target intensity
      const target = Math.round(shown * 1100);
      while (drops.length < target) drops.push(spawn(true));
      if (drops.length > target) drops.length = target;
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = "round";
      ctx.lineWidth = 1;
      for (const d of drops) {
        d.y += d.v * dt; d.x += d.v * slant * dt;
        if (d.y > h + 20 || d.x > w + 120) Object.assign(d, spawn(false));
        ctx.strokeStyle = `rgba(190, 215, 240, ${d.a * (0.55 + shown * 0.6)})`;
        ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.len * slant, d.y - d.len); ctx.stroke();
      }
      // Rare, soft lightning in the heaviest hours.
      if (shown > 0.8 && now > nextFlash && flash.current) {
        flash.current.animate([{ opacity: 0 }, { opacity: 0.28 }, { opacity: 0.05 }, { opacity: 0.2 }, { opacity: 0 }], { duration: 650, easing: "ease-out" });
        nextFlash = now + 7000 + Math.random() * 9000;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return (
    <>
      <div className="fx-storm" style={{ opacity: Math.min(0.55, intensity * 0.6) }} aria-hidden="true" />
      <canvas ref={cv} className="fx-rain" aria-hidden="true" />
      <div ref={flash} className="fx-flash" aria-hidden="true" />
    </>
  );
}
