// The forecast console is the app. The earlier map-first OpsConsole is kept, not mounted: export it here to bring it back.
import { ForecastConsole } from "./forecast/ForecastConsole.tsx";
import { IntroGate } from "./intro/GlobeIntro.tsx";

// The globe intro plays on top of the console (which loads underneath) and then fades away.
export function App() {
  return (
    <>
      <ForecastConsole />
      <IntroGate />
    </>
  );
}
