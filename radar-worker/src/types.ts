// Mirrors the shape src/lib/mrms-render.ts (the browser canvas renderer in
// the main app) expects — kept in sync by hand since this worker has no
// dependency on the main app's Next.js path aliases or its browser-only
// rendering code.
export type MrmsPoint = { lat: number; lon: number; dbz: number | null };
export type MrmsBounds = { minLatitude: number; maxLatitude: number; minLongitude: number; maxLongitude: number };
