import { NextResponse } from "next/server";
import { modelMapVariables } from "@/lib/model-maps";

// This endpoint intentionally exposes catalog metadata, not invented map
// imagery. A future gridded-data adapter will fulfill these requests with
// rendered tiles or server-side image products tied to an exact run/time.
export async function GET() {
  return NextResponse.json({
    status: "foundation-ready",
    variables: modelMapVariables,
    requirements: ["provider/model", "run time", "valid time", "variable", "level", "grid or tile source", "quality metadata"],
  }, { headers: { "Cache-Control": "public, s-maxage=3600" } });
}
