/** Gemini Live prebuilt voices — one distinct voice + call sign per forecast agent. */
export type AgentVoice = { voice: string; callSign: string };

export const DEFAULT_VOICE = "Aoede";
export const DEFAULT_CALL_SIGN = "ORACLE";

export const AGENT_VOICES: Record<string, AgentVoice> = {
  weather: { voice: "Autonoe", callSign: "Weather" },
  rivers: { voice: "Charon", callSign: "Rivers" },
  terrain: { voice: "Kore", callSign: "Flood & runoff" },
  satellite: { voice: "Leda", callSign: "Satellite" },
  roads: { voice: "Orus", callSign: "Roads" },
  cellular: { voice: "Puck", callSign: "Cell network" },
  power: { voice: "Fenrir", callSign: "Power" },
  social: { voice: "Sulafat", callSign: "Social" },
  facilities: { voice: "Enceladus", callSign: "Facilities" },
  landslides: { voice: "Algenib", callSign: "Landslides" },
};

export function voiceForAgent(id: string | null | undefined): AgentVoice {
  if (!id) return { voice: DEFAULT_VOICE, callSign: DEFAULT_CALL_SIGN };
  return AGENT_VOICES[id] ?? { voice: DEFAULT_VOICE, callSign: DEFAULT_CALL_SIGN };
}
