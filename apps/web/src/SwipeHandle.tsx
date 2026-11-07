import { useEffect, useRef } from "react";

/**
 * Before/after divider for the two Maxar mosaics.
 *
 * The captions are not decoration. The post-event scene is the ONLY optical image of the valley after the event,
 * and it is about half cloud and was taken eight days after the peak, by which time the water had gone. Someone
 * dragging this handle will reasonably expect to see a flood, so the labels have to say plainly that they will
 * not, or the control misleads by itself.
 */
export function SwipeHandle({ value, onChange, onClose, patches }: { value: number; onChange: (v: number) => void; onClose: () => void; patches: number }) {
  const drag = useRef(false);
  useEffect(() => {
    const move = (e: PointerEvent) => { if (drag.current) onChange(Math.min(0.97, Math.max(0.03, e.clientX / window.innerWidth))); };
    const up = () => { drag.current = false; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [onChange]);

  return (
    <>
      <div className="swipe" style={{ left: `${value * 100}%` }}>
        <button
          className="swipe-grip" aria-label="Drag to compare before and after"
          onPointerDown={(e) => { drag.current = true; e.currentTarget.setPointerCapture(e.pointerId); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") onChange(Math.max(0.03, value - 0.04));
            if (e.key === "ArrowRight") onChange(Math.min(0.97, value + 0.04));
          }}
        >⇄</button>
      </div>
      <div className="swipe-tag left" style={{ opacity: value > 0.12 ? 1 : 0 }}>13 Jan 2024 · before</div>
      <div className="swipe-tag right" style={{ opacity: value < 0.88 ? 1 : 0 }}>6 Oct 2024 · after</div>
      <div className="swipe-note">
        <strong>What you are looking at.</strong> Left: 13 Jan 2024, clear. Right: 6 Oct 2024 — the only optical image
        of the valley after the event, about half cloud, and taken eight days after the 27–28 Sep peak once the water
        had receded. <strong>Neither side shows the flood</strong>, so do not try to read one from them: the white in
        the right-hand image is cloud, not water.
        <br />
        The {patches} cyan outlines are where UNOSAT <em>mapped</em> the water on 30 Sep. That footprint is an{" "}
        <em>input</em> to the engine, not one of its predictions — to see what the engine actually predicted and
        whether it was right, turn on <strong>Verification (real)</strong>.
        <button className="link" onClick={onClose}>Close</button>
      </div>
    </>
  );
}
