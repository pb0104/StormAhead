import { useState } from "react";
import { HeleneView } from "./HeleneView.tsx";
import { HindcastView } from "./HindcastView.tsx";

export function App() {
  const [mode, setMode] = useState<"helene" | "kathmandu">("helene");
  return (
    <div className="app hind-app">
      <header>
        <div><h1>StormAhead</h1><span className="sub">Which roads can we still use — and where should resources go?</span></div>
        <div className="modes">
          <button className={mode === "helene" ? "active" : ""} onClick={() => setMode("helene")}>Hurricane Helene replay</button>
          <button className={mode === "kathmandu" ? "active" : ""} onClick={() => setMode("kathmandu")}>Kathmandu case study</button>
        </div>
        {mode === "helene"
          ? <div className="banner real">REPLAY · Hurricane Helene 2024 · NCDOT records (reconstructed after the event) · nothing is sent</div>
          : <div className="banner real">CASE STUDY · Kathmandu 2024 · OSM (pre-event), UNOSAT flood extent (given), BIPAD (scoring only)</div>}
      </header>
      {mode === "helene" ? <HeleneView /> : <HindcastView />}
    </div>
  );
}
