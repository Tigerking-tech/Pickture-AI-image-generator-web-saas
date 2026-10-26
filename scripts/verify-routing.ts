/**
 * verify-routing.ts — 用电商真实常用操作，对路由层（router.route + whitelist.detectIntents）
 * 与生成模型映射（generative.resolveFalSpec）做端到端回归验证。
 *
 * 运行：esbuild 打包后经 node 执行（见命令）。不依赖 photocraft CLI / 网络。
 */

import { route, type RouteDecision } from "../src/lib/router";
import { detectIntents } from "../src/lib/whitelist";
import { resolveFalSpec } from "../src/lib/generative";

type RouteKind = RouteDecision["route"];

interface Case {
  op: string; // 电商操作名
  cmd: string; // 用户真实指令
  expRoute: RouteKind;
  expDet: string[]; // 期望确定性意图
  expGen: string[]; // 期望语义意图
  expModels?: Record<string, string>; // 期望 fal 模型（语义意图）
}

const CASES: Case[] = [
  // —— 确定性可做的（应走 photocraft）——
  { op: "去背景/抠图", cmd: "把图片抠图，只要产品", expRoute: "photocraft", expDet: ["remove_bg_white"], expGen: [] },
  { op: "换白底", cmd: "把背景换成白底", expRoute: "photocraft", expDet: ["remove_bg_white"], expGen: [] },
  { op: "透明背景", cmd: "做成透明背景", expRoute: "photocraft", expDet: ["remove_bg_transparent"], expGen: [] },
  { op: "普通抠图", cmd: "帮我抠图", expRoute: "photocraft", expDet: ["remove_bg_white"], expGen: [] },
  { op: "英文去背景", cmd: "remove background", expRoute: "photocraft", expDet: ["remove_bg_white"], expGen: [] }, // 回归：曾走 AI swap_background
  { op: "英文去背景2", cmd: "please remove the background", expRoute: "photocraft", expDet: ["remove_bg_white"], expGen: [] },
  { op: "英文抠图", cmd: "knockout the product", expRoute: "photocraft", expDet: ["remove_bg_white"], expGen: [] },
  { op: "英文换场景", cmd: "change the background to a beach", expRoute: "regenerate", expDet: [], expGen: ["swap_background"] }, // 不应被当成去白底
  { op: "换场景背景", cmd: "换成北欧风客厅场景", expRoute: "regenerate", expDet: [], expGen: ["swap_background"] },
  { op: "校正白平衡", cmd: "校正白平衡", expRoute: "reject", expDet: [], expGen: [] }, // GAP：无对应能力
  { op: "提亮", cmd: "太暗了，提亮一点", expRoute: "photocraft", expDet: ["brighten"], expGen: [] },
  { op: "增艳/质感", cmd: "让颜色更鲜艳有质感", expRoute: "photocraft", expDet: ["boost_saturation"], expGen: [] },
  { op: "暖调", cmd: "调成暖色调", expRoute: "photocraft", expDet: ["warm_up"], expGen: [] },
  { op: "冷调", cmd: "清冷风", expRoute: "photocraft", expDet: ["cool_down"], expGen: [] },
  { op: "锐化", cmd: "再锐化清晰一点", expRoute: "photocraft", expDet: ["sharpen"], expGen: [] },
  { op: "改尺寸", cmd: "改成800x800", expRoute: "photocraft", expDet: ["resize_for_platform"], expGen: [] },
  { op: "缩放%", cmd: "缩小到50%", expRoute: "photocraft", expDet: ["scale_percent"], expGen: [] },
  { op: "加文字水印", cmd: "加个水印", expRoute: "photocraft", expDet: ["watermark"], expGen: [] }, // 回归：曾被 add_object 误吞
  { op: "去瑕疵", cmd: "去除表面污点", expRoute: "regenerate", expDet: [], expGen: ["remove_object"], expModels: { remove_object: "fal-ai/flux-pro/kontext/max" } },
  { op: "去物体", cmd: "去掉旁边的水杯", expRoute: "regenerate", expDet: [], expGen: ["remove_object"] },
  { op: "换材质(木质)", cmd: "材质换成木质", expRoute: "regenerate", expDet: [], expGen: ["change_material"], expModels: { change_material: "fal-ai/flux-pro/kontext" } },
  { op: "换材质(大理石)", cmd: "换成大理石纹理", expRoute: "regenerate", expDet: [], expGen: ["change_material"] },
  { op: "改产品颜色", cmd: "把瓶身改成红色", expRoute: "regenerate", expDet: [], expGen: ["change_object_color"], expModels: { change_object_color: "fal-ai/flux-pro/kontext" } },
  { op: "改背景色", cmd: "把背景改成蓝色", expRoute: "regenerate", expDet: [], expGen: ["swap_background"] }, // 回归：曾被 change_text 误吞
  { op: "改文字", cmd: "把标签文字改成NEW", expRoute: "regenerate", expDet: [], expGen: ["change_text"], expModels: { change_text: "fal-ai/flux-pro/kontext/max" } },
  { op: "风格迁移(日系)", cmd: "换成日系风格", expRoute: "regenerate", expDet: [], expGen: ["style_transfer"], expModels: { style_transfer: "fal-ai/flux/dev/image-to-image" } },
  { op: "扩图", cmd: "扩展画面让背景更宽", expRoute: "regenerate", expDet: [], expGen: ["extend_image"], expModels: { extend_image: "fal-ai/flux-2-pro/outpaint" } },
  { op: "高清修复", cmd: "高清修复提升清晰度", expRoute: "regenerate", expDet: [], expGen: ["upscale"], expModels: { upscale: "fal-ai/real-esrgan" } },
  { op: "加绿植", cmd: "加一盆绿植在旁边", expRoute: "regenerate", expDet: [], expGen: ["add_object"], expModels: { add_object: "fal-ai/flux-pro/kontext" } },
  { op: "锐化并提亮", cmd: "锐化并提亮", expRoute: "photocraft", expDet: ["sharpen", "brighten"], expGen: [] }, // 多确定性意图合并
  { op: "暖调+冷调+锐化", cmd: "暖一点冷一点再锐化", expRoute: "photocraft", expDet: ["warm_up", "cool_down", "sharpen"], expGen: [] },

  // —— 混合（确定性 + 语义，应走 hybrid）——
  { op: "提亮+换白底", cmd: "提亮并把背景换成白底", expRoute: "photocraft", expDet: ["brighten", "remove_bg_white"], expGen: [] },
  { op: "提亮并抠图", cmd: "提亮并抠图", expRoute: "photocraft", expDet: ["brighten", "remove_bg_white"], expGen: [] },
  { op: "锐化+日系", cmd: "锐化并换成日系风格", expRoute: "hybrid", expDet: ["sharpen"], expGen: ["style_transfer"] },
  { op: "改尺寸+加绿植", cmd: "改成800x800并加绿植", expRoute: "hybrid", expDet: ["resize_for_platform"], expGen: ["add_object"] },
  { op: "换白底+改文字", cmd: "换成白底并把文字改成NEW", expRoute: "hybrid", expDet: ["remove_bg_white"], expGen: ["change_text"] },
];

function setEq(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  for (const x of b) if (!sa.has(x)) return false;
  return true;
}

let pass = 0;
let fail = 0;
const fails: string[] = [];

console.log("| 操作 | 指令 | 路由 | 期望路由 | 判定 |");
console.log("|---|---|---|---|---|");

for (const c of CASES) {
  const det = detectIntents(c.cmd).deterministic.map((d) => d.intent);
  const gen = detectIntents(c.cmd).generative.map((g) => g.intent);
  const dec = route(c.cmd, { protectedElements: [], origW: 1200, origH: 900 });
  const gotRoute = dec.route;

  let ok = gotRoute === c.expRoute && setEq(det, c.expDet) && setEq(gen, c.expGen);

  // 模型映射校验
  if (ok && c.expModels) {
    for (const [intent, slug] of Object.entries(c.expModels)) {
      const got = resolveFalSpec(intent).model;
      if (got !== slug) {
        ok = false;
        fails.push(`  ✗ 模型错: ${c.op} 意图 ${intent} 期望 ${slug} 实得 ${got}`);
      }
    }
  }

  // 误命中检查：change_text 不应被"把X改成Y"泛化命中
  const genSet = new Set(gen);
  if (c.op === "改产品颜色" || c.op === "改背景色") {
    if (genSet.has("change_text")) {
      ok = false;
      fails.push(`  ✗ 误命中 change_text: ${c.cmd} → ${gen.join(",")}`);
    }
  }
  if (c.op === "加文字水印") {
    if (genSet.has("add_object")) {
      ok = false;
      fails.push(`  ✗ 误命中 add_object: ${c.cmd} → 走了 hybrid/AI`);
    }
  }

  if (ok) pass++;
  else {
    fail++;
    fails.push(`  ✗ ${c.op} [${c.cmd}] 路由=${gotRoute}(期${c.expRoute}) det=[${det}] 期[${c.expDet}] gen=[${gen}] 期[${c.expGen}]`);
  }
  const verdict = ok ? "✅" : "❌";
  console.log(`| ${c.op} | ${c.cmd} | ${gotRoute} | ${c.expRoute} | ${verdict} |`);
}

console.log("");
console.log(`总计: ${CASES.length}  通过: ${pass}  失败: ${fail}`);
if (fails.length) {
  console.log("\n失败明细:");
  for (const f of fails) console.log(f);
}
process.exit(fail > 0 ? 1 : 0);
