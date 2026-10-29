/**
 * pipeline.ts — Surepix 编辑管线编排（服务端）
 *
 * 闭环：输入解析 → 路由决策 → 白名单校验 → PhotoCraft CLI 执行 → 保真校验 → 结构化报告
 * 这是 /api/edit 的核心，也是"确定性修图引擎 + 质量门禁"架构的最小完整体。
 */

import fs from "node:fs";
import path from "node:path";
import {
  type AnonQuotaStatus,
  getAnonQuotaStatus,
  refundAnonGenerativeQuota,
  tryConsumeAnonGenerativeQuota,
} from "./anon-quota";
import { creditsForIntents, hasCredits, spendForIntents } from "./credits";
import { resolveUserPlan } from "./entitlements";
import { checkFairUse, consumeFairUse, type FairUseStatus } from "./fair-use";
import {
  type Bbox,
  decodePng,
  type FidelityReport,
  type ImgTransform,
  verify,
  verifyGlobal,
} from "./fidelity";
import { runGenerative } from "./generative";
import { isToneEdit, runChainOnBuffer } from "./js-engine";
import { cliAvailable, convertFile, docInfo, rmQuiet, runChain, tmpPath } from "./pc";
import { planWithFallback, type RouteDecision, route, routeAfterFidelity } from "./router";
import { type ChainStep, INTENT_TEMPLATES, planChain, validateCommandChain } from "./whitelist";

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
  /** 调用方解析出的用户 ID（用于生成式编辑的积分扣减）；缺省则不扣费 */
  userId?: string;
  /** 匿名用户轻量限流 key（IP/UA 指纹）；仅未登录且真实模式时用于生成式试用配额 */
  anonKey?: string;
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
  /** 业务错误码（如 INSUFFICIENT_CREDITS / ANON_QUOTA_EXCEEDED），供 API 层映射 HTTP 状态 */
  code?: string;
  /** 匿名试用配额状态（仅触发匿名闸门时返回），前端用于提示登录 */
  anonQuota?: { remaining: number; limit: number; resetAt: string };
  /** 月度 fair-use 状态（触发超额闸门时返回），前端用于提示升级/登录 */
  fairUse?: FairUseStatus;
}

const SAMPLES_DIR = path.join(process.cwd(), "public", "samples");

// ── 输入闸门：单请求的资源上限 ────────────────────────────────────────────
// 旧实现没有任何上限：一张 8000×8000 的图解码后要 Float64Array(w*h*3) ≈ 1.5GB，
// 一个请求就能打爆 serverless 实例，而且确定性编辑不扣积分 —— 攻击成本为零。
// 两级拦截：先卡上传体积（省一次解码），再卡像素总数（省后续所有算子）。
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024; // 解码后的原图字节上限
export const MAX_IMAGE_PIXELS = 16_000_000; // 4096×4096 量级

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
function resolvePlan(
  intent: string,
  origW: number,
  origH: number,
):
  | {
      ok: true;
      intent: string;
      desc: string;
      chain: ChainStep[];
      args: Record<string, number | string>;
    }
  | { ok: false; error: string } {
  const template = INTENT_TEMPLATES.find((t) => t.intent === intent);
  if (template) {
    // 模板 id 直连：从 id 字符串里再解析一次参数（如 "resize_for_platform" 无尺寸 → 用默认 800×800）
    const args: Record<string, number | string> = { origW, origH };
    const m = intent.match(/(\d{2,4})\s*[x×*]\s*(\d{2,4})/i);
    if (m) {
      args.width = Number(m[1]);
      args.height = Number(m[2]);
    }
    return {
      ok: true,
      intent: template.intent,
      desc: template.desc,
      chain: template.build(args),
      args,
    };
  }
  const plan = planChain(intent, origW, origH);
  if (!plan.ok) return plan;
  return {
    ok: true,
    intent: plan.intent,
    desc: plan.desc,
    chain: plan.chain,
    args: plan.args as Record<string, number | string>,
  };
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
): Promise<{
  ok: boolean;
  error?: string;
  cliMs: number;
  fidelityMs: number;
  fidelity: FidelityReport;
  resultPng?: Buffer;
  psdInfo?: EditResult["psd"];
  engine?: string;
}> {
  const tmpFiles: string[] = [];
  const inFile = tmpPath("png");
  tmpFiles.push(inFile);
  fs.writeFileSync(inFile, origPng);

  const outExt = wantPsd ? "psd" : "png";
  const outFile = tmpPath(outExt);
  tmpFiles.push(outFile);

  // PhotoCraft CLI 不可用时（离线 / 沙箱 / DEMO_MODE 无二进制），回退到 Surepix
  // 参考引擎（纯 TS，确定性、可离线）。两者共享同一套白名单命令语义，覆盖
  // 调色 / 几何 / 去背（边界漫水近似）/ 文字水印（sharp 合成）。
  const useReferenceEngine = !cliAvailable();
  let cliMs = 0;
  let engine = "photocraft";
  let resultPng: Buffer | undefined;
  let psdInfo: EditResult["psd"];

  if (useReferenceEngine) {
    cliMs = Date.now();
    const run = await runChainOnBuffer(origPng, level.chain);
    cliMs = Date.now() - cliMs;
    if (!run.ok) {
      rmQuiet(tmpFiles);
      return {
        ok: false,
        error: run.error,
        cliMs,
        fidelityMs: 0,
        fidelity: { verdict: "PASS", elements: {}, summary: {} },
      };
    }
    resultPng = Buffer.from(run.base64, "base64");
    engine = "surepix-js";
  } else {
    const cliRes = await runChain(inFile, level.chain, outFile);
    if (!cliRes.ok) {
      rmQuiet(tmpFiles);
      return {
        ok: false,
        error: `photocraft: ${cliRes.stderr || cliRes.error || "run failed"}`,
        cliMs: cliRes.ms,
        fidelityMs: 0,
        fidelity: { verdict: "PASS", elements: {}, summary: {} },
      };
    }

    if (wantPsd) {
      const previewFile = tmpPath("png");
      tmpFiles.push(previewFile);
      const conv = await convertFile(outFile, previewFile);
      if (!conv.ok || !fs.existsSync(previewFile)) {
        rmQuiet(tmpFiles);
        return {
          ok: false,
          error: `photocraft convert: ${conv.stderr || "failed"}`,
          cliMs: cliRes.ms,
          fidelityMs: 0,
          fidelity: { verdict: "PASS", elements: {}, summary: {} },
        };
      }
      resultPng = fs.readFileSync(previewFile);
      const info = await docInfo(outFile);
      const layers = Array.isArray(info.info?.layers)
        ? (info.info.layers as { name?: string; kind?: string }[]).map((l) => ({
            name: l.name || "layer",
            kind: l.kind || "unknown",
          }))
        : [];
      psdInfo = { base64: fs.readFileSync(outFile).toString("base64"), layers };
    } else {
      resultPng = fs.readFileSync(outFile);
    }
  }

  const toneEdit = isToneEdit(level.chain);

  const tFid = Date.now();
  const fidelity: FidelityReport = manifest
    ? verify(
        origPng,
        resultPng,
        manifest as unknown as { elements: Record<string, { bbox: Bbox }> },
        transform,
        { toneEdit },
      )
    : verifyGlobal(origPng, resultPng, transform, { toneEdit });
  const fidelityMs = Date.now() - tFid;

  rmQuiet(tmpFiles);
  return { ok: true, cliMs, fidelityMs, fidelity, resultPng, psdInfo, engine };
}

export async function runEdit(req: EditRequest): Promise<EditResult> {
  const tStart = Date.now();

  const fail = (
    error: string,
    routeDecision: RouteDecision,
    chain: ChainStep[] = [],
    extra: Partial<EditResult> = {},
  ): EditResult => ({
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

  /** 引擎标签：参考引擎（离线、无二进制）与生产 PhotoCraft 区分标注，绝不混淆 */
  const engineMeta = (engine?: string) =>
    engine === "surepix-js"
      ? {
          engine: "Surepix 参考引擎 (pure-TS + RMBG 语义去背)",
          license: "surepix (MIT OR Apache-2.0)",
        }
      : { engine: "PhotoCraft CLI v0.15.1 (Rust)", license: "MIT OR Apache-2.0" };

  // 解析调用方计划（用于 fair-use 月度上限）；无订阅 / 异常回退 free。
  // 匿名（无 userId）直接按 free 档计；demo 模式由 fair-use 模块短路放行。
  const userPlan = req.userId ? await resolveUserPlan(req.userId).catch(() => "free") : "free";

  // 成功后计量一次确定性编辑（edits + exports 同月上限）；best-effort，失败不阻断交付。
  const countDeterministicEdit = async () => {
    await consumeFairUse(req.userId, req.anonKey, userPlan, "edits");
    await consumeFairUse(req.userId, req.anonKey, userPlan, "exports");
  };

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
    // 先估解码后的字节数（base64 每 4 字符 ≈ 3 字节），超限直接拒，不做任何解码
    const decodedBytes = Math.floor((req.imageBase64.length * 3) / 4);
    if (decodedBytes > MAX_UPLOAD_BYTES) {
      return fail(
        `image too large (${(decodedBytes / 1024 / 1024).toFixed(1)}MB > ${MAX_UPLOAD_BYTES / 1024 / 1024}MB). Resize before uploading.`,
        route("reject me"),
      );
    }
    origPng = Buffer.from(req.imageBase64, "base64");
    manifest = req.manifest ?? null;
    source = "upload";
  } else {
    return fail("either sampleId or imageBase64 is required", route("reject me"));
  }

  // 2. 路由决策（几何模板需要原图尺寸，先解码）
  const origImg = decodePng(origPng);
  const pixels = origImg.w * origImg.h;
  if (pixels > MAX_IMAGE_PIXELS) {
    return fail(
      `image too large (${origImg.w}×${origImg.h} = ${pixels} px > ${MAX_IMAGE_PIXELS} px). Decode and verify costs scale with pixel count.`,
      route("reject me"),
    );
  }
  const routeDecision = route(req.intent, {
    protectedElements: manifest ? Object.keys(manifest.elements) : [],
    origW: origImg.w,
    origH: origImg.h,
  });
  if (routeDecision.route === "reject" || !routeDecision.plan) {
    return fail(routeDecision.reason, routeDecision, [], {
      meta: { source, engine: "", license: "" },
    });
  }

  // 2b. 语义级意图：PhotoCraft 白名单覆盖不了，走真正的生成路径（算法层 #5）
  //     regenerate = 纯生成；hybrid = 先跑确定性命令链，再把结果交生成模型补语义差异
  if (routeDecision.route === "regenerate" || routeDecision.route === "hybrid") {
    const genIntents = (routeDecision.plan?.generative ?? []) as string[];
    let inputPng = origPng;
    let detDesc = "";

    // ── 积分预校验（生成式编辑按真实 fal 成本换算，服务端强制）──
    // 确定性编辑（PhotoCraft）零成本不计量；仅生成式意图消耗 AI credits。
    if (req.userId && genIntents.length > 0) {
      const genCost = creditsForIntents(genIntents);
      if (!(await hasCredits(req.userId, genCost))) {
        return fail(
          `Insufficient AI credits for this generative edit (need ${genCost}). Upgrade your plan or buy more.`,
          routeDecision,
          [],
          { code: "INSUFFICIENT_CREDITS" },
        );
      }
    }

    // ── 匿名生成式试用配额闸门 ─────────────────────────────────────────────
    // 对标竞品漏斗：确定性编辑（$0）免登录全开；生成式（fal.ai 按次计费 ≈$0.02）
    // 对匿名用户开放有限次试用，超出后要求登录（登录后走积分账本 credits.ts）。
    // demo 模式豁免（fal 为 mock 不烧钱）；登录用户走积分，不在此限。
    //
    // 闸门实现必须是「原子占位」而不是「先查后扣」：旧实现用 check 判断、
    // 生成成功后才 consume，中间隔着好几秒模型调用，并发请求会全部通过。
    let anonReserved = false;
    let anonStatus: AnonQuotaStatus | undefined;
    if (!req.userId && req.anonKey && genIntents.length > 0) {
      const res = await tryConsumeAnonGenerativeQuota(req.anonKey);
      anonStatus = res.status;
      if (!res.allowed) {
        return fail(
          `Anonymous generative trial limit reached (${res.status.limit}/day). Sign in to unlock your monthly AI edit allowance.`,
          routeDecision,
          [],
          {
            code: "ANON_QUOTA_EXCEEDED",
            anonQuota: {
              remaining: res.status.remaining,
              limit: res.status.limit,
              resetAt: res.status.resetAt,
            },
          },
        );
      }
      anonReserved = true;
    }

    // hybrid：先把确定性那部分用 PhotoCraft 跑掉，再生成（生成只补语义差异）
    if (routeDecision.route === "hybrid") {
      // 月度 fair-use 闸门：hybrid 的确定性前置计入月度额度
      const fu = await checkFairUse(req.userId, req.anonKey, userPlan, "edits");
      if (!fu.ok) {
        return fail(
          fu.status.unlimited
            ? "Monthly fair-use limit reached. Upgrade your plan for more."
            : `Monthly fair-use limit reached (${fu.status.used}/${fu.status.limit} edits). ${req.userId ? "Upgrade to continue." : "Sign in to unlock your monthly allowance."}`,
          routeDecision,
          [],
          { code: "FAIR_USE_EXCEEDED", fairUse: fu.status },
        );
      }
      const plan = resolvePlan(req.intent, origImg.w, origImg.h);
      const fb = planWithFallback(req.intent, origImg.w, origImg.h);
      const levels =
        fb.ok && fb.levels
          ? fb.levels
          : plan.ok
            ? [{ level: 0, desc: plan.desc, chain: plan.chain }]
            : [];
      for (const lv of levels) {
        const transform = transformFromChain(lv.chain, origImg.w, origImg.h);
        const res = await runLevel(origPng, manifest, lv, false, transform);
        if (res.ok && res.resultPng) {
          inputPng = res.resultPng;
          detDesc = lv.desc;
          await countDeterministicEdit();
          break;
        }
      }
    }

    // 多语义意图串接：逐个生成，上一步输出作为下一步输入（如「换背景 + 改文字」一次完成）
    let genPng = inputPng;
    let lastProvider = "";
    const genModels: string[] = [];
    let totalGenMs = 0;
    for (const g of genIntents) {
      const genResult = await runGenerative(g, genPng.toString("base64"), req.intent);
      if (!genResult.ok || !genResult.imageBase64) {
        // 模型侧失败：把之前占位的匿名额度退还给用户（不是用户的错）
        if (anonReserved && req.anonKey) await refundAnonGenerativeQuota(req.anonKey);
        return fail(
          `generative path failed at "${g}" (${routeDecision.route}): ${genResult.error || "no output"}`,
          routeDecision,
          [],
          { meta: { source, engine: genResult.provider || "", license: "" } },
        );
      }
      genPng = Buffer.from(genResult.imageBase64, "base64");
      lastProvider = genResult.provider || lastProvider;
      if (genResult.model) genModels.push(genResult.model);
      totalGenMs += genResult.ms ?? 0;
    }

    // 生成成功后才扣积分（失败不扣；偶发失败由毛利倍数吸收）。
    // best-effort：扣减异常不影响已交付的结果，但要留下可见错误——
    // 旧实现 catch 后什么都不做，等于"扣费失败也能白嫖"，且没有任何线索。
    if (req.userId && genIntents.length > 0) {
      try {
        const spent = await spendForIntents(
          req.userId,
          genIntents,
          `Generative edit — ${genIntents.join(" + ")}`,
        );
        if (!spent.ok) {
          console.error(
            `[billing] credit spend failed for user ${req.userId}: ${spent.error} (genIntents=${genIntents.join(",")})`,
          );
        }
      } catch (e) {
        console.error("[billing] credit spend threw:", e instanceof Error ? e.message : e);
      }
    }

    // 匿名额度已在闸门处占位，此处不再重复计数（旧实现在这里补一次 consume）

    const img = decodePng(genPng);
    // 附上一次最新的匿名配额状态（已占位一次），供前端刷新"今日剩余"展示
    const anonQuota: AnonQuotaStatus | undefined = req.anonKey
      ? (anonStatus ?? (await getAnonQuotaStatus(req.anonKey)))
      : undefined;
    const genFidelity: FidelityReport = {
      verdict: "PASS",
      elements: {},
      summary: {
        generative: genIntents.length,
        priorDeterministic: routeDecision.route === "hybrid" ? 1 : 0,
      },
    };
    return {
      ok: true,
      route: routeDecision,
      chain: [],
      timingMs: { cli: 0, fidelity: totalGenMs, total: Date.now() - tStart },
      fidelity: genFidelity,
      fidelityAction: {
        action: "accept",
        reason: `generative path (${routeDecision.route}, ${genIntents.length} intent${genIntents.length > 1 ? "s" : ""})`,
        costMs: totalGenMs,
      },
      repairTrail: [],
      levelUsed: -1,
      image: { base64: genPng.toString("base64"), width: img.w, height: img.h },
      meta: {
        source,
        engine: `Generative (${lastProvider || "?"}${[...new Set(genModels)].map((m) => ` · ${m}`).join("")}${genIntents.length > 1 ? ` ×${genIntents.length}` : ""}${detDesc ? ` after ${detDesc}` : ""})`,
        license: lastProvider === "fal" ? "provider terms" : "mock",
      },
      anonQuota,
    };
  }

  // 3. 命令链 + 回退级别（模板 id 直连优先，否则自然语言规划）

  // ── 月度 fair-use 闸门（确定性编辑 / 导出，防薅免费 CPU）──
  {
    const fu = await checkFairUse(req.userId, req.anonKey, userPlan, "edits");
    if (!fu.ok) {
      return fail(
        fu.status.unlimited
          ? "Monthly fair-use limit reached. Upgrade your plan for more."
          : `Monthly fair-use limit reached (${fu.status.used}/${fu.status.limit} edits). ${req.userId ? "Upgrade to continue." : "Sign in to unlock your monthly allowance."}`,
        routeDecision,
        [],
        { code: "FAIR_USE_EXCEEDED", fairUse: fu.status },
      );
    }
  }

  const plan = resolvePlan(req.intent, origImg.w, origImg.h);
  if (!plan.ok) {
    return fail(`planner: ${plan.error}`, routeDecision, [], {
      meta: { source, engine: "", license: "" },
    });
  }
  const fb = planWithFallback(req.intent, origImg.w, origImg.h);
  const levels: { level: number; desc: string; chain: ChainStep[] }[] =
    fb.ok && fb.levels ? fb.levels : [{ level: 0, desc: plan.desc, chain: plan.chain }];
  for (const lv of levels) {
    const check = validateCommandChain(lv.chain);
    if (!check.ok) {
      return fail(`whitelist: ${check.error}`, routeDecision, lv.chain, {
        meta: { source, engine: "", license: "" },
      });
    }
  }

  // 背景移除类意图（remove_bg_white / remove_bg_transparent）：全局变更是预期的、正确的，
  // 不能被保真门禁误判为 REPAIR 并触发"修复"降级（否则会一路降级到透明结果）。直接采用 L0。
  const bgIntents = routeDecision.plan?.intents ?? [];
  const isBgIntent =
    bgIntents.includes("remove_bg_white") || bgIntents.includes("remove_bg_transparent");
  if (isBgIntent) {
    const lv = levels[0];
    const transform = transformFromChain(lv.chain, origImg.w, origImg.h);
    const res = await runLevel(origPng, manifest, lv, false, transform);
    if (!res.ok || !res.resultPng) {
      return fail(`photocraft: ${res.error || "no output"}`, routeDecision, lv.chain, {
        meta: { source, engine: "", license: "" },
      });
    }
    const img = decodePng(res.resultPng);
    await countDeterministicEdit();
    return {
      ok: true,
      route: routeDecision,
      chain: lv.chain,
      timingMs: { cli: res.cliMs, fidelity: res.fidelityMs, total: Date.now() - tStart },
      fidelity: res.fidelity,
      fidelityAction: {
        action: "accept",
        reason: `background removal — global change is expected (${bgIntents.join("/")})`,
        costMs: res.fidelityMs,
      },
      repairTrail: [],
      levelUsed: lv.level,
      image: { base64: res.resultPng.toString("base64"), width: img.w, height: img.h },
      meta: { ...engineMeta(res.engine), source },
    };
  }

  // 4. 执行 + 保真 + 失败回退（L0 → L1 → L2，任一级 PASS 即交付）
  //    几何变换按"级"计算——不同级别的命令链几何语义不同（crop vs imageSize）
  const wantPsd = plan.intent === "watermark";
  const repairTrail: EditResult["repairTrail"] = [];
  let last: Awaited<ReturnType<typeof runLevel>> | null = null;

  for (const lv of levels) {
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
      await countDeterministicEdit();
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
        meta: { ...engineMeta(last.engine), source },
      };
    }
    // 未通过：记录并降级重试
    repairTrail.push({ level: lv.level, desc: lv.desc, verdict: last.fidelity.verdict });
  }

  // 所有级别都没通过保真 → 按 L0 结果交付，但决策是升级 AI（仅受损元素）
  const img = decodePng(last!.resultPng!);
  await countDeterministicEdit();
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
    meta: { ...engineMeta(last!.engine), source },
  };
}
