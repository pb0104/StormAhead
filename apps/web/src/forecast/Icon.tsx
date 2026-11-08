/** Small stroke icons (24 px grid) for factors and controls. Drawn for this console; no icon font. */
const P: Record<string, string> = {
  weather: "M7 15a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 7.5a3.75 3.75 0 0 1 .5 7.47M8 18l-1 2.5M12 17l-1 3.5M16 18l-1 2.5",
  rivers: "M2 8c2 0 2-1.5 4-1.5S8 8 10 8s2-1.5 4-1.5S16 8 18 8s2-1.5 4-1.5M2 13c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M2 18c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5",
  terrain: "M3 19 9.5 8l3.5 6 2.5-3.5L21 19ZM9.5 8l1.6 2.7",
  satellite: "m13 7 4-4 4 4-4 4M7 13l-4 4 4 4 4-4M9.5 9.5l5 5M8 12l4-4 4 4-4 4ZM17 17a4 4 0 0 0 4-4",
  roads: "M8 3 4 21M16 3l4 18M12 4v3M12 10.5v3M12 17v3",
  cellular: "M12 10v11M9 21h6M12 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM7.8 4.8a6 6 0 0 0 0 7.4M16.2 4.8a6 6 0 0 1 0 7.4M5 2.5a9.5 9.5 0 0 0 0 12M19 2.5a9.5 9.5 0 0 1 0 12",
  power: "M13 2 4.5 13.5H12L11 22l8.5-11.5H12Z",
  social: "M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12ZM8.5 10.5h7M8.5 13.5h4.5",
  facilities: "M4 21V7l8-4 8 4v14M2 21h20M12 9v6M9 12h6",
  resources: "M3 8.5 12 4l9 4.5v9L12 22l-9-4.5ZM3 8.5l9 4.5 9-4.5M12 13v9M7.5 6.2l9 4.6",
  landslides: "M3 20h18L8 6ZM12 15.5a1.5 1.5 0 1 0 0-.01M16 18a1 1 0 1 0 0-.01M17.5 9.5l1.5-1M19.5 12.5l1.5-.5",
  send: "M5 12h13M13 6l6 6-6 6",
  layers: "m12 3 9 5-9 5-9-5ZM3 13l9 5 9-5M3 17.5l9 5 9-5",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 7.5v.01",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8ZM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8Z",
  check: "m5 12.5 4.5 4.5L19 7.5",
  x: "M6 6l12 12M18 6 6 18",
  play: "M7 4.5v15l12.5-7.5Z",
  pause: "M8 5v14M16 5v14",
  read: "M4 6c0-1.66 3.58-3 8-3s8 1.34 8 3-3.58 3-8 3-8-1.34-8-3ZM4 6v12c0 1.66 3.58 3 8 3s8-1.34 8-3V6M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3",
  calc: "M5 4h14v16H5ZM8 8h8M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01",
  found: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8 12.5l2.5 2.5L16 9.5",
  chevron: "m6 9 6 6 6-6",
  cube: "M12 2.5 20.5 7v10L12 21.5 3.5 17V7ZM3.5 7 12 11.5 20.5 7M12 11.5v10",
  fusion: "M6 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM18 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM12 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM7.3 7.5l3.6 7M16.7 7.5l-3.6 7",
  doc: "M6 2.5h8l4 4v15H6ZM14 2.5v4h4M9 12h6M9 15.5h6M9 9h2",
  copy: "M8 8h12v12H8ZM16 8V4H4v12h4",
  download: "M12 3v12M7 10l5 5 5-5M4 20h16",
  shield: "M12 3 4.5 6v6c0 4.5 3.2 7.8 7.5 9 4.3-1.2 7.5-4.5 7.5-9V6ZM9 12l2 2 4-4",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2",
  alert: "M12 3 2 20h20ZM12 10v4.5M12 17.5v.01",
  radio: "M4 9h16v11H4ZM8 9l9-5M8 14.5a1.5 1.5 0 1 0 0-.01M13 13h4M13 16h4",
};

export function Icon({ name, size = 18, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name] ?? P.info} />
    </svg>
  );
}
