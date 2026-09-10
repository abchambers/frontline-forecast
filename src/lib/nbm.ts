// National Blend of Models hourly text bulletin (NBH) parsing + element metadata.
// Field layout and definitions verified against NOAA/MDL's own NBM text card docs
// (https://vlab.noaa.gov/web/mdl/nbm-textcard-v4.2, WBG added in NBM V5.0) rather than
// guessed from the raw text -- every row is a 3-letter label followed by N right-
// justified 3-character fields (blank when that hour has no value for that element),
// one per forecast hour. Confirmed by diffing header/value column offsets on live data
// character-by-character before writing this parser.

export type NbmElementGroup = "primary" | "wind" | "precipType" | "aviation" | "uncertainty" | "other";

export type NbmElementMeta = {
  label: string;
  unit: string;
  group: NbmElementGroup;
  /** Multiply the raw integer value by this before display (e.g. Q01 is 1/100 in). */
  scale?: number;
  /** Raw value -> display override, checked before scaling (e.g. CIG's -88 = unlimited). */
  specialValues?: Record<string, string>;
};

export const NBM_ELEMENTS: Record<string, NbmElementMeta> = {
  TMP: { label: "Temperature", unit: "°F", group: "primary" },
  TSD: { label: "Temperature spread", unit: "°F", group: "uncertainty" },
  DPT: { label: "Dewpoint", unit: "°F", group: "primary" },
  DSD: { label: "Dewpoint spread", unit: "°F", group: "uncertainty" },
  WBG: { label: "Wet bulb globe temp", unit: "°F", group: "primary" },
  SKY: { label: "Sky cover", unit: "%", group: "primary" },
  SSD: { label: "Sky cover spread", unit: "%", group: "uncertainty" },
  WDR: { label: "Wind direction", unit: "", group: "wind" },
  WSP: { label: "Wind speed", unit: "kt", group: "wind" },
  WSD: { label: "Wind speed spread", unit: "kt", group: "uncertainty" },
  GST: { label: "Wind gust", unit: "kt", group: "wind" },
  GSD: { label: "Wind gust spread", unit: "kt", group: "uncertainty" },
  P01: { label: "1-hr precip chance", unit: "%", group: "primary" },
  P06: { label: "6-hr precip chance", unit: "%", group: "primary" },
  P12: { label: "12-hr precip chance", unit: "%", group: "primary" },
  Q01: { label: "1-hr rainfall", unit: "in", group: "primary", scale: 0.01 },
  Q06: { label: "6-hr rainfall", unit: "in", group: "primary", scale: 0.01 },
  Q12: { label: "12-hr rainfall", unit: "in", group: "primary", scale: 0.01 },
  T01: { label: "1-hr thunderstorm chance", unit: "%", group: "primary" },
  T03: { label: "3-hr thunderstorm chance", unit: "%", group: "primary" },
  T06: { label: "6-hr thunderstorm chance", unit: "%", group: "primary" },
  T12: { label: "12-hr thunderstorm chance", unit: "%", group: "primary" },
  TXN: { label: "18-hr max/min temperature", unit: "°F", group: "other" },
  XND: { label: "Max/min temperature spread", unit: "°F", group: "uncertainty" },
  DUR: { label: "Precipitation duration", unit: "hr", group: "other" },
  S06: { label: "6-hr snowfall", unit: "in", group: "primary", scale: 0.1 },
  I06: { label: "6-hr ice accumulation", unit: "in", group: "precipType", scale: 0.01 },
  PZR: { label: "Freezing rain chance (if precip)", unit: "%", group: "precipType" },
  PSN: { label: "Snow chance (if precip)", unit: "%", group: "precipType" },
  PPL: { label: "Sleet/ice pellets chance (if precip)", unit: "%", group: "precipType" },
  PRA: { label: "Rain chance (if precip)", unit: "%", group: "precipType" },
  S01: { label: "1-hr snowfall", unit: "in", group: "primary", scale: 0.1 },
  SLV: { label: "Snow level", unit: "ft", group: "other", scale: 100 },
  I01: { label: "1-hr ice accumulation", unit: "in", group: "precipType", scale: 0.01 },
  CIG: { label: "Ceiling height", unit: "ft", group: "aviation", scale: 100, specialValues: { "-88": "Unlimited" } },
  MVC: { label: "MVFR ceiling chance", unit: "%", group: "aviation" },
  IFC: { label: "IFR ceiling chance", unit: "%", group: "aviation" },
  LIC: { label: "LIFR ceiling chance", unit: "%", group: "aviation" },
  LCB: { label: "Lowest cloud base", unit: "ft", group: "aviation", scale: 100, specialValues: { "-88": "Unlimited" } },
  VIS: { label: "Visibility", unit: "mi", group: "aviation", scale: 0.1 },
  MVV: { label: "MVFR visibility chance", unit: "%", group: "aviation" },
  IFV: { label: "IFR visibility chance", unit: "%", group: "aviation" },
  LIV: { label: "LIFR visibility chance", unit: "%", group: "aviation" },
  MHT: { label: "Mixing height", unit: "ft AGL", group: "other", scale: 100 },
  TWD: { label: "Transport wind direction", unit: "", group: "other" },
  TWS: { label: "Transport wind speed", unit: "kt", group: "other" },
  HID: { label: "Haines Index", unit: "", group: "other" },
  SOL: { label: "Solar radiation", unit: "W/m²", group: "other", scale: 10 },
};

export function nbmDisplayValue(elementCode: string, raw: string | null): string | null {
  if (raw === null || raw.trim() === "") return null;
  const meta = NBM_ELEMENTS[elementCode];
  if (!meta) return raw;
  if (meta.specialValues?.[raw.trim()]) return meta.specialValues[raw.trim()];
  const numeric = Number(raw);
  if (Number.isNaN(numeric)) return raw;
  const scaled = meta.scale ? numeric * meta.scale : numeric;
  const rounded = meta.scale && meta.scale < 1 ? Math.round(scaled * 100) / 100 : Math.round(scaled);
  return `${rounded}${meta.unit ? ` ${meta.unit}` : ""}`;
}

/** Same scaling as nbmDisplayValue but returns a plain number for charting, not a labeled string. */
export function nbmNumericValue(elementCode: string, raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const numeric = Number(raw);
  if (Number.isNaN(numeric)) return null;
  const meta = NBM_ELEMENTS[elementCode];
  return meta?.scale ? numeric * meta.scale : numeric;
}

export type NbmParsedHourly = { hours: string[]; elements: Record<string, (string | null)[]> };
export type NbmHourly = NbmParsedHourly & { station: string; cycle: string };

/**
 * Parses one station's NBH or NBS block into columns. `issuedAt` is the bulletin's own issuance
 * instant (the successful cycle candidate, not "now"). NBH (hourly, ~25h range) has no FHR row --
 * forecast hour N is issuedAt + (N+1) hours, real elapsed time rather than trusting the printed
 * "00".."23" hour-of-day labels, so day/month rollover is always correct. NBS (3-hourly, ~72h
 * range) DOES carry a real "FHR" row (forecast-hour offsets, e.g. "04 07 10...") right after the
 * UTC header -- used directly when present, since NBS's spacing isn't a uniform +1 like NBH's and
 * trusting the bulletin's own stated offsets is more honest than assuming a fixed interval.
 */
export function parseNbmHourly(bulletinText: string, issuedAt: Date): NbmParsedHourly | null {
  const lines = bulletinText.split("\n");
  const headerIndex = lines.findIndex((line) => line.slice(0, 4).trim() === "UTC");
  if (headerIndex < 0) return null;
  const parseRow = (line: string, count: number) => {
    const rest = line.slice(5);
    const fields: (string | null)[] = [];
    for (let i = 0; i < count; i += 1) {
      const field = rest.slice(i * 3, i * 3 + 3).trim();
      fields.push(field === "" ? null : field);
    }
    return fields;
  };
  const headerFields = parseRow(lines[headerIndex], Math.floor((lines[headerIndex].length - 5) / 3));
  const hourCount = headerFields.filter((field) => field !== null).length;
  const fhrIndex = lines[headerIndex + 1]?.slice(0, 4).trim() === "FHR" ? headerIndex + 1 : -1;
  const hours = fhrIndex >= 0
    ? parseRow(lines[fhrIndex], hourCount).map((offset) => new Date(issuedAt.getTime() + Number(offset) * 3600_000).toISOString())
    : Array.from({ length: hourCount }, (_, index) => new Date(issuedAt.getTime() + (index + 1) * 3600_000).toISOString());
  const elements: Record<string, (string | null)[]> = {};
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    if (i === fhrIndex) continue;
    const line = lines[i];
    if (!line.trim()) break;
    const label = line.slice(0, 4).trim();
    if (!label || !/^[A-Z0-9]{2,4}$/.test(label)) break;
    elements[label] = parseRow(line, hourCount);
  }
  return { hours, elements };
}

/**
 * Combines a near-term product (NBH) with a longer-range one (NBS) into one continuous timeline.
 * Real timestamps are the join key, not array position -- NBS's 3-hourly points don't line up 1:1
 * with NBH's hourly ones, and the two products don't share every element code (NBH's hourly P01/
 * Q01/T01 become NBS's windowed P06/P12/Q06/Q12/T03/T06/T12 at the coarser resolution). A code only
 * covered by one product is simply null outside that product's own range -- not synthesized to look
 * like a continuation, since a 6-hour trailing accumulation isn't the same quantity as an hourly one.
 */
export function mergeNbmProducts(primary: NbmParsedHourly, extension: NbmParsedHourly): NbmParsedHourly {
  const timesByEpoch = new Map<number, string>();
  for (const iso of primary.hours) timesByEpoch.set(new Date(iso).getTime(), iso);
  for (const iso of extension.hours) {
    const epoch = new Date(iso).getTime();
    if (!timesByEpoch.has(epoch)) timesByEpoch.set(epoch, iso);
  }
  const sortedEpochs = [...timesByEpoch.keys()].sort((a, b) => a - b);
  const hours = sortedEpochs.map((epoch) => timesByEpoch.get(epoch)!);
  const primaryIndex = new Map(primary.hours.map((iso, index) => [new Date(iso).getTime(), index]));
  const extensionIndex = new Map(extension.hours.map((iso, index) => [new Date(iso).getTime(), index]));
  const codes = new Set([...Object.keys(primary.elements), ...Object.keys(extension.elements)]);
  const elements: Record<string, (string | null)[]> = {};
  for (const code of codes) {
    elements[code] = sortedEpochs.map((epoch) => {
      const primaryValue = primaryIndex.has(epoch) ? primary.elements[code]?.[primaryIndex.get(epoch)!] ?? null : null;
      if (primaryValue !== null) return primaryValue;
      return extensionIndex.has(epoch) ? extension.elements[code]?.[extensionIndex.get(epoch)!] ?? null : null;
    });
  }
  return { hours, elements };
}
