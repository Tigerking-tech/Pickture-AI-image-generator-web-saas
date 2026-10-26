/**
 * make-real-samples.ts — 用真实产品照（Pexels，免费商用许可）重建 Demo 样本
 * 流程：jpg → PNG（CLI convert）→ select.subject + select.inverse + edit.fill(gray)
 *       得到"原始上传"风格的灰底样本，供保真清单与着陆页 before 图使用。
 *
 * 图片来源（Pexels License，可免费商用）：
 *   serum  — https://www.pexels.com/photo/31251033
 *   phones — https://www.pexels.com/photo/16703772
 *   coffee — https://www.pexels.com/photo/14545422
 */
import { cliAvailable, convertFile, runChain } from "../src/lib/pc";

const RAW: Record<string, string> = {
  serum: "/tmp/rawimg/serumA.jpg",
  phones: "/tmp/rawimg/phonesB.jpg",
  coffee: "/tmp/rawimg/coffee_sq.jpg",
};

async function main() {
  if (!cliAvailable()) throw new Error("photocraft CLI missing");
  for (const [id, raw] of Object.entries(RAW)) {
    const png = `/tmp/rawimg/${id}-raw.png`;
    const out = `public/samples/${id}.png`;
    const c = await convertFile(raw, png);
    if (!c.ok) throw new Error(`convert ${id} failed: ${c.stderr}`);
    const g = await runChain(png, [
      { cmd: "select.subject" },
      { cmd: "select.inverse" },
      { cmd: "edit.fill", params: { contents: "gray" } },
    ], out);
    if (!g.ok) throw new Error(`gray ${id} failed: ${g.stderr}`);
    console.log(`✓ ${out}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
