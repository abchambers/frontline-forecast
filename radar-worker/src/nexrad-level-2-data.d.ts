// nexrad-level-2-data ships no types. Only the surface this app actually uses
// is declared here — see node_modules/nexrad-level-2-data/API.md for the
// full API if more of it is needed later.
declare module "nexrad-level-2-data" {
  type HighResMoment = {
    name?: string;
    gate_count: number;
    gate_size: number;
    first_gate: number;
    scale: number;
    offset: number;
    moment_data: number[];
  };

  type MessageHeader = {
    elevation_angle?: number;
    elevation_number?: number;
  };

  // The volume's Message 5/7 (Volume Coverage Pattern) record, confirmed live 2026-09-01 against a
  // real decoded volume's actual shape (radar.vcp.record.pattern_number) — not guessed from the
  // library's docs. pattern_number is the real NEXRAD VCP code (31/35 = clear air, 12/212/215 etc.
  // = precipitation modes) — see compute-worker.ts's CLEAR_AIR_VCPS for how this app uses it.
  type VcpInfo = { record?: { pattern_number?: number; pattern_type?: number } };

  export class Level2Radar {
    constructor(file: Buffer);
    header: unknown;
    vcp: VcpInfo;
    listElevations(): number[];
    setElevation(elevation: number): void;
    getScans(): number;
    getAzimuth(scan?: number): number | number[];
    getHeader(scan?: number): MessageHeader;
    getHighresReflectivity(scan?: number): HighResMoment | undefined;
    getHighresVelocity(scan?: number): HighResMoment | undefined;
    getHighresSpectrum(scan?: number): HighResMoment | undefined;
    // Real quirk, confirmed live: passing an explicit scan index throws
    // ("invalid scan selected") even for valid data — only the no-arg,
    // whole-elevation-array form works. Typed as two overloads so callers
    // are steered toward the working one; see level2.ts for the workaround.
    getHighresCorrelationCoefficient(): (HighResMoment | undefined)[];
    getHighresCorrelationCoefficient(scan: number): HighResMoment | undefined;
  }

  const _default: { Level2Radar: typeof Level2Radar };
  export default _default;
}
