// Audit API route — POST starts an audit, GET polls status.
// Phase 7 wires the full pipeline. Phase 1 (F05) implements source upload parsing.
import { NextRequest, NextResponse } from "next/server";
import { buildPackageContextFromUpload, UploadValidationError } from "@/lib/ingest/upload";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const input = body as Record<string, unknown>;

  // Source upload path (F05)
  if (input.source) {
    const src = input.source as { files?: { name: string; content: string }[] };
    try {
      const ctx = buildPackageContextFromUpload(src.files ?? []);
      // TODO (Phase 7): enqueue audit job and return auditId
      return NextResponse.json({ packageId: ctx.packageId, modules: ctx.modules.length }, { status: 200 });
    } catch (e) {
      if (e instanceof UploadValidationError) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      throw e;
    }
  }

  // Package ID path (Phase 7 completes this)
  if (input.packageId) {
    // TODO (Phase 7): validate address, enqueue fetchPackage + audit job
    return NextResponse.json({ error: "Package ID audit not yet implemented" }, { status: 501 });
  }

  return NextResponse.json({ error: "Provide either 'packageId' or 'source.files'" }, { status: 400 });
}

export async function GET() {
  // TODO (Phase 7): poll audit job status by id
  return NextResponse.json({ error: "Use GET /api/audit?id=<auditId>" }, { status: 400 });
}
