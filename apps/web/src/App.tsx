import { useState } from "react";
import { HeleneView } from "./HeleneView.tsx";
import { HindcastView } from "./HindcastView.tsx";
import { OpsConsole } from "./OpsConsole.tsx";

type Mode = "console" | "helene" | "hindcast";

export function App() {
  const [mode, setMode] = useState<Mode>("console");
  const modes: { id: Mode; label: string }[] = [
    { id: "console", label: "Kathmandu ops" },
    { id: "helene", label: "Hurricane Helene" },
    { id: "hindcast", label: "Kathmandu hindcast" },
  ];

  if (mode === "console") {
    return (
      <>
        <div className="modes top-modes" role="tablist" aria-label="Demo mode">
          {modes.map((m) => (
            <button key={m.id} className={mode === m.id ? "active" : ""} aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>{m.label}</button>
          ))}
        </div>
        <OpsConsole />
      </>
    );
  }

  return (
    <div className="app hind-app">
      <header>
        <div><h1>StormAhead</h1><span className="sub">Which roads can we still use — and where should resources go?</span></div>
        <div className="modes" role="tablist" aria-label="Demo mode">
          {modes.map((m) => (
            <button key={m.id} className={mode === m.id ? "active" : ""} aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>{m.label}</button>
          ))}
        </div>
        {mode === "helene"
          ? <div className="banner real">REPLAY · Hurricane Helene 2024 · NCDOT records (reconstructed after the event) · nothing is sent</div>
          : <div className="banner real">CASE STUDY · Kathmandu 2024 · OSM (pre-event), UNOSAT flood extent (given), BIPAD (scoring only)</div>}
      </header>
      {mode === "helene" ? <HeleneView /> : <HindcastView />}
    </div>
  );
}
