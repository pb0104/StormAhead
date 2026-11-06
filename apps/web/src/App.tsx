import { HindcastView } from "./HindcastView.tsx";

export function App() {
  return (
    <div className="app hind-app">
      <header>
        <div><h1>CascadeIQ</h1><span className="sub">Predicting the unforeseen knock-on impact of a flood</span></div>
        <div className="banner real">REAL DATA — OSM (pre-event), UNOSAT flood extent (given hazard), BIPAD reports (scoring only)</div>
      </header>
      <HindcastView />
    </div>
  );
}
