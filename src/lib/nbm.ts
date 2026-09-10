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
  Q01: { label: "1-hr rainfall", unit: "in", group: "primary", scale: 0.01 },
  T01: { label: "1-hr thunderstorm chance", unit: "%", group: "primary" },
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

const COMPASS_POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

/** WDR/TWD store direction in tens of degrees (36 = 360/north, 09 = 90/east, 00 = calm). */
export function windDirectionCompass(rawTens: string | null): string | null {
  if (!rawTens || rawTens.trim() === "") return null;
  const tens = Number(rawTens);
  if (Number.isNaN(tens)) return null;
  if (tens === 0) return "Calm";
  const degrees = tens * 10;
  return COMPASS_POINTS[Math.round(degrees / 22.5) % 16];
}

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

export type NbmHourly = { hours: string[]; elements: Record<string, (string | null)[]> };

/**
 * Parses one station's NBH block into hourly columns. `issuedAt` is the bulletin's own
 * issuance instant (the successful cycle candidate, not "now") -- forecast hour N is
 * issuedAt + (N+1) hours, computed from real elapsed time rather than trusting the
 * printed "00".."23" hour-of-day labels, so day/month rollover is always correct.
 */
export function parseNbmHourly(bulletinText: string, issuedAt: Date): NbmHourly | null {
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
  const hours = Array.from({ length: hourCount }, (_, index) => new Date(issuedAt.getTime() + (index + 1) * 3600_000).toISOString());
  const elements: Record<string, (string | null)[]> = {};
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) break;
    const label = line.slice(0, 4).trim();
    if (!label || !/^[A-Z0-9]{2,4}$/.test(label)) break;
    elements[label] = parseRow(line, hourCount);
  }
  return { hours, elements };
}
