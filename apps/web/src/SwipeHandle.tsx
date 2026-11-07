import { useEffect, useRef } from "react";

/**
 * Before/after divider for the two Maxar mosaics.
 *
 * The captions are not decoration. The post-event scene is the ONLY optical image of the valley after the event,
 * and it is about half cloud and was taken eight days after the peak, by which time the water had gone. Someone
 * dragging this handle will reasonably expect to see a flood, so the labels have to say plainly that they will
 * not, or the control misleads by itself.
 */
export function SwipeHandle({ value, onChange, onClose }: { value: number; onChange: (v: number) => void; onClose: () => void }) {
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
        <strong>This is not a flood before/after.</strong> The 6 Oct scene is the only optical image of the valley
        after the event: it is about half cloud, and it was taken eight days after the 27–28 Sep peak, by which time
        the water had receded. It shows the valley, not the flood. The mapped flood footprint is the UNOSAT extent,
        which is an <em>input</em> to the engine, not something it predicted.
        <button className="link" onClick={onClose}>Close</button>
      </div>
    </>
  );
}
