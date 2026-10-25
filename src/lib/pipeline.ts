/**
 * pipeline.ts — Surepix 编辑管线编排（服务端）
 *
 * 闭环：输入解析 → 路由决策 → 白名单校验 → PhotoCraft CLI 执行 → 保真校验 → 结构化报告
 * 这是 /api/edit 的核心，也是"确定性修图引擎 + 质量门禁"架构的最小完整体。
 */

import fs from "node:fs";
import path from "node:path";
import { runChain, convertFile, docInfo, tmpPath, rmQuiet } from "./pc";
import { INTENT_TEMPLATES, planChain, validateCommandChain, type ChainStep } from "./whitelist";
import { route, routeAfterFidelity, planWithFallback, type RouteDecision } from "./router";
import { verify, verifyGlobal, decodePng, type FidelityReport, type Bbox, type ImgTransform } from "./fidelity";

export interface Manifest {
  width: number;
  height: number;
  elements: Record<string, { bbox: Bbox; hash?: string }>;
}

export interface EditRequest {
  /** 意图：模板 id（如 warm_up）或自然语言（如 "make it warmer" / "resize to 800x800"） */
  intent: string;
  /** 用内置样本图（带 manifest 逐元素校验） */
  sampleId?: string;
  /** 或用户上传（base64 PNG，无 manifest 时走全局校验） */
  imageBase64?: string;
  manifest?: Manifest;
}

export interface EditResult {
  ok: boolean;
  error?: string;
  route: RouteDecision;
  chain: ChainStep[];
  timingMs: { cli: number; fidelity: number; total: number };
  fidelity: FidelityReport;
  fidelityAction: ReturnType<typeof routeAfterFidelity>;
  /** 回退轨迹：L0 失败 → L1 重试 → …（空数组 = 一次通过） */
  repairTrail: { level: number; desc: string; verdict: string }[];
  levelUsed: number;
  image: { base64: string; width: number; height: number };
  psd?: { base64: string; layers: { name: string; kind: string }[] };
  meta: { source: string; engine: string; license: string };
}

const SAMPLES_DIR = path.join(process.cwd(), "public", "samples");

function loadSample(id: string): { png: Buffer; manifest: Manifest | null } {
  const pngPath = path.join(SAMPLES_DIR, `${id}.png`);
  const manifestPath = path.join(SAMPLES_DIR, `${id}.json`);
  if (!fs.existsSync(pngPath)) throw new Error(`sample not found: ${id}`);
  const png = fs.readFileSync(pngPath);
  let manifest: Manifest | null = null;
  if (fs.existsSync(manifestPath)) {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
  }
  return { png, manifest };
}

/** 把意图解析为计划：模板 id 直连，否则走自然语言规划（几何模板需要原图尺寸） */
function resolvePlan(intent: string, origW: number, origH: number): { ok: true; intent: string; desc: string; chain: ChainStep[]; args: Record<string, number | string> } | { ok: false; error: string } {
  const template = INTENT_TEMPLATES.find((t) => t.intent === intent);
  if (template) {
    // 模板 id 直连：从 id 字符串里再解析一次参数（如 "resize_for_platform" 无尺寸 → 用默认 800×800）
    const args: Record<string, number | string> = { origW, origH };
    const m = intent.match(/(\d{2,4})\s*[x×*]\s*(\d{2,4})/i);
    if (m) {
      args.width = Number(m[1]);
      args.height = Number(m[2]);
    }
    return { ok: true, intent: template.intent, desc: template.desc, chain: template.build(args), args };
  }
  const plan = planChain(intent, origW, origH);
  if (!plan.ok) return plan;
  return { ok: true, intent: plan.intent, desc: plan.desc, chain: plan.chain, args: plan.args as Record<string, number | string> };
}

/**
 * 从命令链推导几何变换（管线自己发出的命令，语义已知）：
 *  - image.crop {x,y,w,h,tw,th}：先平移 (-x,-y) 再缩放 (tw/w, th/h)
 *  - image.imageSize {width,height}：整图到目标尺寸
 *  - image.imageSize {percent}：整图百分比缩放
 *  - image.canvasSize {width,height}（anchor=center）：画布扩展，内容平移 (new-old)/2
 *  - 其他：恒等
 * 注意：crop 的 target 尺寸 = 裁剪尺寸时 CLI 不重采样（坐标不变）——公式自动退化为平移。
 */
function transformFromChain(chain: ChainStep[], ow: number, oh: number): ImgTransform {
  let scale: [number, number] = [1, 1];
  let translate: [number, number] = [0, 0];
  for (const step of chain) {
    const p = (step.params || {}) as Record<string, number>;
    if (step.cmd === "image.imageSize") {
      if (p.percent) scale = [p.percent / 100, p.percent / 100];
      else if (p.width && p.height) scale = [p.width / ow, p.height / oh];
    } else if (step.cmd === "image.crop") {
      const sx = p.width && p.targetWidth ? p.targetWidth / p.width : 1;
      const sy = p.height && p.targetHeight ? p.targetHeight / p.height : 1;
      return { scale: [sx, sy], translate: [p.x ?? 0, p.y ?? 0] };
    } else if (step.cmd === "image.canvasSize") {
      // 内容（已经过 imageSize）在新画布中居中：平移量 = (新画布 - 内容尺寸) / 2
      // 前向映射 p' = p*s + off = (p - t)*s  ⇒  t = -off/s
      const contentW = ow * scale[0];
      const contentH = oh * scale[1];
      const offX = (p.width - contentW) / 2;
      const offY = (p.height - contentH) / 2;
      translate = [-offX / scale[0], -offY / scale[1]];
    }
  }
  return { scale, translate };
}

/** 执行一级（一个命令链）并做保真校验，返回该级结果 */
async function runLevel(
  origPng: Buffer,
  manifest: Manifest | null,
  level: { level: number; desc: string; chain: ChainStep[] },
  wantPsd: boolean,
  transform: ImgTransform,
): Promise<{ ok: boolean; error?: string; cliMs: number; fidelityMs: number; fidelity: FidelityReport; resultPng?: Buffer; psdInfo?: EditResult["psd"] }> {
  const tmpFiles: string[] = [];
  const inFile = tmpPath("png");
  tmpFiles.push(inFile);
  fs.writeFileSync(inFile, origPng);

  const outExt = wantPsd ? "psd" : "png";
  const outFile = tmpPath(outExt);
  tmpFiles.push(outFile);

  const cliRes = await runChain(inFile, level.chain, outFile);
  if (!cliRes.ok) {
    rmQuiet(tmpFiles);
    return { ok: false, error: `photocraft: ${cliRes.stderr || cliRes.error || "run failed"}`, cliMs: cliRes.ms, fidelityMs: 0, fidelity: { verdict: "PASS", elements: {}, summary: {} } };
  }

  let resultPng: Buffer;
  let psdInfo: EditResult["psd"];
  if (wantPsd) {
    const previewFile = tmpPath("png");
    tmpFiles.push(previewFile);
    const conv = await convertFile(outFile, previewFile);
    if (!conv.ok || !fs.existsSync(previewFile)) {
      rmQuiet(tmpFiles);
      return { ok: false, error: `photocraft convert: ${conv.stderr || "failed"}`, cliMs: cliRes.ms, fidelityMs: 0, fidelity: { verdict: "PASS", elements: {}, summary: {} } };
    }
    resultPng = fs.readFileSync(previewFile);
    const info = await docInfo(outFile);
    const layers = Array.isArray(info.info?.layers)
      ? (info.info.layers as { name?: string; kind?: string }[]).map((l) => ({ name: l.name || "layer", kind: l.kind || "unknown" }))
      : [];
    psdInfo = { base64: fs.readFileSync(outFile).toString("base64"), layers };
  } else {
    resultPng = fs.readFileSync(outFile);
  }

  const tFid = Date.now();
  const fidelity: FidelityReport = manifest
    ? verify(origPng, resultPng, manifest as unknown as { elements: Record<string, { bbox: Bbox }> }, transform)
    : verifyGlobal(origPng, resultPng, transform);
  const fidelityMs = Date.now() - tFid;

  rmQuiet(tmpFiles);
  return { ok: true, cliMs: cliRes.ms, fidelityMs, fidelity, resultPng, psdInfo };
}

export async function runEdit(req: EditRequest): Promise<EditResult> {
  const tStart = Date.now();

  const fail = (error: string, routeDecision: RouteDecision, chain: ChainStep[] = [], extra: Partial<EditResult> = {}): EditResult => ({
    ok: false,
    error,
    route: routeDecision,
    chain,
    timingMs: { cli: 0, fidelity: 0, total: Date.now() - tStart },
    fidelity: { verdict: "PASS", elements: {}, summary: {} },
    fidelityAction: { action: "accept", reason: "rejected before execution", costMs: 0 },
    repairTrail: [],
    levelUsed: -1,
    image: { base64: "", width: 0, height: 0 },
    meta: { source: "none", engine: "", license: "" },
    ...extra,
  });

  // 1. 输入解析
  let origPng: Buffer;
  let manifest: Manifest | null = null;
  let source: string;
  if (req.sampleId) {
    const s = loadSample(req.sampleId);
    origPng = s.png;
    manifest = s.manifest;
    source = `sample:${req.sampleId}`;
  } else if (req.imageBase64) {
    origPng = Buffer.from(req.imageBase64, "base64");
    manifest = req.manifest ?? null;
    source = "upload";
  } else {
    return fail("either sampleId or imageBase64 is required", route("reject me"));
  }

  // 2. 路由决策（几何模板需要原图尺寸，先解码）
  const origImg = decodePng(origPng);
  const routeDecision = route(req.intent, {
    protectedElements: manifest ? Object.keys(manifest.elements) : [],
    origW: origImg.w,
    origH: origImg.h,
  });
  if (routeDecision.route === "reject" || !routeDecision.plan) {
    return fail(routeDecision.reason, routeDecision, [], { meta: { source, engine: "", license: "" } });
  }

  // 2b. 语义级意图：PhotoCraft 白名单覆盖不了，明确走 AI 路径（本 demo 未接入）
  if (routeDecision.route === "regenerate" || routeDecision.route === "hybrid") {
    return fail(
      `semantic intent requires the generative path (${routeDecision.route}) — not enabled in this demo: ${routeDecision.reason}`,
      routeDecision,
      [],
      {
        meta: { source, engine: "", license: "" },
        fidelityAction: { action: "accept", reason: "routed to generative path before execution", costMs: 0 },
      },
    );
  }

  // 3. 命令链 + 回退级别（模板 id 直连优先，否则自然语言规划）
  const plan = resolvePlan(req.intent, origImg.w, origImg.h);
  if (!plan.ok) {
    return fail(`planner: ${plan.error}`, routeDecision, [], { meta: { source, engine: "", license: "" } });
  }
  const fb = planWithFallback(req.intent, origImg.w, origImg.h);
  const levels: { level: number; desc: string; chain: ChainStep[] }[] = fb.ok && fb.levels
    ? fb.levels
    : [{ level: 0, desc: plan.desc, chain: plan.chain }];
  for (const lv of levels) {
    const check = validateCommandChain(lv.chain);
    if (!check.ok) {
      return fail(`whitelist: ${check.error}`, routeDecision, lv.chain, { meta: { source, engine: "", license: "" } });
    }
  }

  // 4. 执行 + 保真 + 失败回退（L0 → L1 → L2，任一级 PASS 即交付）
  //    几何变换按"级"计算——不同级别的命令链几何语义不同（crop vs imageSize）
  const wantPsd = plan.intent === "watermark";
  const repairTrail: EditResult["repairTrail"] = [];
  let last: Awaited<ReturnType<typeof runLevel>> | null = null;

  for (const lv of levels) {
    // 该级的输出尺寸（从命令参数推导，不依赖实际执行；canvasSize 是最后生效的画布尺寸）
    let lvOutW = origImg.w;
    let lvOutH = origImg.h;
    for (const step of lv.chain) {
      const p = (step.params || {}) as Record<string, number>;
      if (step.cmd === "image.imageSize") {
        if (p.width && p.height) {
          lvOutW = p.width;
          lvOutH = p.height;
        } else if (p.percent) {
          lvOutW = Math.round((origImg.w * p.percent) / 100);
          lvOutH = Math.round((origImg.h * p.percent) / 100);
        }
      }
      if (step.cmd === "image.crop" && p.targetWidth && p.targetHeight) {
        lvOutW = p.targetWidth;
        lvOutH = p.targetHeight;
      }
      if (step.cmd === "image.canvasSize" && p.width && p.height) {
        lvOutW = p.width;
        lvOutH = p.height;
      }
    }
    const transform = transformFromChain(lv.chain, origImg.w, origImg.h);

    last = await runLevel(origPng, manifest, lv, wantPsd, transform);
    if (!last.ok) {
      return fail(last.error || "execution failed", routeDecision, lv.chain, {
        timingMs: { cli: last.cliMs, fidelity: 0, total: Date.now() - tStart },
        meta: { source, engine: "", license: "" },
        repairTrail,
        levelUsed: lv.level,
      });
    }
    if (last.fidelity.verdict === "PASS") {
      const img = decodePng(last.resultPng!);
      return {
        ok: true,
        route: routeDecision,
        chain: lv.chain,
        timingMs: { cli: last.cliMs, fidelity: last.fidelityMs, total: Date.now() - tStart },
        fidelity: last.fidelity,
        fidelityAction: routeAfterFidelity(last.fidelity),
        repairTrail,
        levelUsed: lv.level,
        image: { base64: last.resultPng!.toString("base64"), width: img.w, height: img.h },
        psd: last.psdInfo,
        meta: { source, engine: "PhotoCraft CLI v0.15.1 (Rust)", license: "MIT OR Apache-2.0" },
      };
    }
    // 未通过：记录并降级重试
    repairTrail.push({ level: lv.level, desc: lv.desc, verdict: last.fidelity.verdict });
  }

  // 所有级别都没通过保真 → 按 L0 结果交付，但决策是升级 AI（仅受损元素）
  const img = decodePng(last!.resultPng!);
  return {
    ok: true,
    route: routeDecision,
    chain: levels[0].chain,
    timingMs: { cli: last!.cliMs, fidelity: last!.fidelityMs, total: Date.now() - tStart },
    fidelity: last!.fidelity,
    fidelityAction: routeAfterFidelity(last!.fidelity),
    repairTrail,
    levelUsed: levels[levels.length - 1].level,
    image: { base64: last!.resultPng!.toString("base64"), width: img.w, height: img.h },
    psd: last!.psdInfo,
    meta: { source, engine: "PhotoCraft CLI v0.15.1 (Rust)", license: "MIT OR Apache-2.0" },
  };
}
