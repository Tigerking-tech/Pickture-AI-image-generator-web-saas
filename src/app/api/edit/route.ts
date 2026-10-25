import { NextRequest, NextResponse } from "next/server";
import { runEdit } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/edit — Pickture 编辑管线入口（完整闭环） */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const intent = typeof body.intent === "string" ? body.intent : "";
  if (!intent) {
    return NextResponse.json({ ok: false, error: "intent is required" }, { status: 400 });
  }

  const reqPayload = {
    intent,
    sampleId: typeof body.sampleId === "string" ? body.sampleId : undefined,
    imageBase64: typeof body.imageBase64 === "string" ? body.imageBase64 : undefined,
    manifest: body.manifest && typeof body.manifest === "object" ? (body.manifest as never) : undefined,
  };

  try {
    const result = await runEdit(reqPayload);
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "internal error" },
      { status: 500 },
    );
  }
}

/** GET /api/edit — 能力探测（前端握手用） */
export async function GET() {
  return NextResponse.json({
    service: "surepix-edit-pipeline",
    version: "0.1.0",
    engine: "PhotoCraft CLI v0.15.1 (Rust)",
    license: "MIT OR Apache-2.0",
    routes: ["photocraft", "hybrid", "regenerate", "reject"],
    docs: "POST {intent, sampleId | imageBase64, manifest?}",
  });
}
