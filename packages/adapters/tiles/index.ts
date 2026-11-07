import type { TileBytes, TileCachePort } from "../../ports/index.ts";
import { DiskTileCache, hashKey } from "./diskCache.ts";

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";
const TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";

export class CachingTileAdapter implements TileCachePort {
  constructor(public cache = new DiskTileCache()) {}

  getEsri(z: number, y: number, x: number): Promise<TileBytes> {
    return this.cache.get("esri", `${z}/${y}/${x}.jpg`, `${ESRI}/${z}/${y}/${x}`);
  }

  getTerrarium(z: number, x: number, y: number): Promise<TileBytes> {
    return this.cache.get("terrarium", `${z}/${x}/${y}.png`, `${TERRARIUM}/${z}/${x}/${y}.png`);
  }

  getCesium(upstreamUrl: string, cacheKey: string, headers?: Record<string, string>): Promise<TileBytes> {
    const key = cacheKey || hashKey(upstreamUrl);
    return this.cache.get("cesium", key, upstreamUrl, headers);
  }
}

export { DiskTileCache, hashKey, DEFAULT_CACHE_ROOT } from "./diskCache.ts";
