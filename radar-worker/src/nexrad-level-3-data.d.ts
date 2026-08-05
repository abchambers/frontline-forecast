// nexrad-level-3-data ships no types and is a plain default-export function,
// not a class. Only the surface this app actually uses is declared here —
// the library returns much more (symbology packets, text headers, etc.) but
// this project only reads the fields storm-relative velocity (product 56,
// packet AF1F) actually populates.
declare module "nexrad-level-3-data" {
  type ProductDescription = {
    latitude: number;
    longitude: number;
    height: number;
    elevationAngle: number;
    volumeScanDate: number;
    volumeScanTime: number;
    // Halfwords 31-46 of the Product Description Block: 16 raw 2-byte
    // "Data Level Threshold" entries used by legacy 16-level color-table
    // products (packet AF1F) to map each 4-bit radial gate code to a real
    // physical value. Undocumented by this library (it doesn't resolve
    // these itself for packet AF1F) — decoded manually, see level3.ts.
    dependent31_46: Buffer;
  };

  type RadialDataPacket = {
    firstBin: number;
    numberBins: number;
    rangeScale: number; // km per bin
    numRadials: number;
    radials: { startAngle: number; angleDelta: number; bins: number[] }[];
  };

  type Level3Data = {
    productDescription: ProductDescription;
    radialPackets?: Record<string, RadialDataPacket>;
  };

  type Options = { logger?: false | Console };

  function parser(file: Buffer, options?: Options): Level3Data;
  export default parser;
}
