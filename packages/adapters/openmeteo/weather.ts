import type { Weather, WeatherPort, WeatherSeed } from "../../ports/index.ts";

/** Kathmandu valley center (Bagmati). */
export const KTM = { lat: 27.7, lon: 85.32 };
const DEFAULT_INCHES = 10;

export function describeWeather(inches: number): Weather {
  const mm = inches * 25.4;
  return {
    inches, mm,
    lowIn: Math.max(0, Math.round(inches * 0.8 * 10) / 10),
    highIn: Math.round(inches * 1.2 * 10) / 10,
    peakMmH: Math.round((mm / 24) * 2.6),
    label: inches >= 14 ? "Extreme" : inches >= 9 ? "Heavy" : inches >= 5 ? "Moderate" : "Light",
  };
}

export function clampInches(n: number) {
  return Math.min(20, Math.max(4, Math.round(n)));
}

export class FixtureWeatherAdapter implements WeatherPort {
  constructor(private inches = DEFAULT_INCHES) {}
  async seedRainfall(): Promise<WeatherSeed> {
    return { inches: this.inches, source: "fixture", fetchedAt: new Date().toISOString() };
  }
  describe(inches: number) { return describeWeather(inches); }
}

export class OpenMeteoWeatherAdapter implements WeatherPort {
  constructor(
    private fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
    private point = KTM,
  ) {}

  describe(inches: number) { return describeWeather(inches); }

  async seedRainfall(): Promise<WeatherSeed> {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${this.point.lat}&longitude=${this.point.lon}&hourly=precipitation&forecast_days=1&timezone=auto`;
      const res = await this.fetchImpl(url);
      if (!res.ok) throw new Error(`open-meteo ${res.status}`);
      const data = await res.json() as { hourly?: { precipitation?: (number | null)[] } };
      const precip = data.hourly?.precipitation ?? [];
      const mm = precip.reduce<number>((s, v) => s + (v ?? 0), 0);
      let flood: Record<string, unknown> | undefined;
      try {
        const fUrl = `https://flood-api.open-meteo.com/v1/flood?latitude=${this.point.lat}&longitude=${this.point.lon}&daily=river_discharge&forecast_days=3`;
        const fr = await this.fetchImpl(fUrl);
        if (fr.ok) {
          const fj = await fr.json() as { daily?: { river_discharge?: number[] } };
          flood = { river_discharge: fj.daily?.river_discharge ?? null };
        }
      } catch { /* provenance only */ }

      const inches = clampInches(mm / 25.4 || DEFAULT_INCHES);
      return {
        inches,
        source: "open-meteo-forecast",
        fetchedAt: new Date().toISOString(),
        provenance: { mm24h: Math.round(mm * 10) / 10, point: this.point, flood },
      };
    } catch {
      return { inches: DEFAULT_INCHES, source: "fallback-default", fetchedAt: new Date().toISOString() };
    }
  }
}
