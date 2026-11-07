declare module "*.css";
declare module "*?url" { const u: string; export default u; }
declare module "*.geojson" {
  const value: { type: string; features: unknown[]; properties?: Record<string, unknown> };
  export default value;
}
