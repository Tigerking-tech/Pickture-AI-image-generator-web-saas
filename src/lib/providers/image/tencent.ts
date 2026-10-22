/**
 * 腾讯混元生图（Hunyuan Image）图像 provider —— 原生腾讯云 API（非 OpenAI 兼容）。
 *
 * 接口：SubmitHunyuanImageJob + QueryHunyuanImageJob（异步任务 + 轮询）
 * 凭证：腾讯云 CAM 的 SecretId / SecretKey（与文本用的 TokenHub Key 是两套系统！）
 * 免费档：首次开通送 50 次免费额度，之后轻量版约 ¥0.099/张。
 *
 * 签名：腾讯云 TC3-HMAC-SHA256（自实现，不引入额外 SDK 依赖）。
 * 返回：生成的 COS 临时 URL（有效期 1 小时），调用方应转存到自有存储（见 lib/storage.ts）。
 */
import crypto from "node:crypto";
import type { ImageGenRequest, ImageGenResult, ImageProvider } from "../types";

const HOST = "hunyuan.tencentcloudapi.com";
const SERVICE = "hunyuan";
const REGION = "ap-guangzhou";
const VERSION = "2023-09-01";

interface TencentImageConfig {
  secretId: string | undefined;
  secretKey: string | undefined;
}

/** 把 fal 风格的 size 提示映射到混元支持的分辨率字符串 */
function toResolution(hint: string | undefined): string {
  const h = (hint ?? "").toLowerCase();
  if (/(portrait|vertical|3:4|9:16|3:5)/.test(h)) return "768:1024";
  if (/(landscape|horizontal|4:3|16:9|5:3)/.test(h)) return "1024:768";
  return "1024:1024";
}

function sha256Hex(data: string): string {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}
function hmac(key: crypto.BinaryLike, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

/** 构造腾讯云 TC3 签名并 POST 到 API 网关 */
async function tencentRequest(
  cfg: TencentImageConfig,
  action: string,
  payload: Record<string, unknown>,
): Promise<any> {
  const secretId = cfg.secretId!;
  const secretKey = cfg.secretKey!;
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);

  const hashedPayload = sha256Hex(body);
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${HOST}\n`;
  const signedHeaders = "content-type;host";
  const canonicalRequest = ["POST", "/", "", canonicalHeaders, signedHeaders, hashedPayload].join(
    "\n",
  );

  const credentialScope = `${date}/${SERVICE}/tc3_request`;
  const stringToSign = [
    "TC3-HMAC-SHA256",
    String(timestamp),
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const secretDate = hmac(`TC3${secretKey}`, date);
  const secretService = hmac(secretDate, SERVICE);
  const secretSigning = hmac(secretService, "tc3_request");
  const signature = hmac(secretSigning, stringToSign).toString("hex");

  const authorization = [
    `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  const res = await fetch(`https://${HOST}/`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json; charset=utf-8",
      Host: HOST,
      "X-TC-Action": action,
      "X-TC-Version": VERSION,
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Region": REGION,
    },
    body,
  });

  const json = (await res.json()) as { Response?: any };
  const resp = json.Response ?? {};
  if (resp.Error) {
    throw new Error(`Tencent ${action} error: ${resp.Error.Code} ${resp.Error.Message}`);
  }
  return resp;
}

export function createTencentImageProvider(cfg: TencentImageConfig): ImageProvider {
  return {
    name: "tencent",

    isConfigured() {
      return Boolean(cfg.secretId && cfg.secretKey);
    },

    missingKeyMessage() {
      return "TENCENT_SECRET_ID / TENCENT_SECRET_KEY are not configured, so no image can be generated via Tencent Hunyuan. Add the CAM keys to .env.local and retry. This endpoint will not return fake images.";
    },

    async generate(req: ImageGenRequest): Promise<ImageGenResult> {
      if (!cfg.secretId || !cfg.secretKey) {
        return { ok: false, status: 503, detail: this.missingKeyMessage() };
      }

      let jobId: string;
      try {
        const submit = await tencentRequest(cfg, "SubmitHunyuanImageJob", {
          Prompt: req.prompt,
          Resolution: toResolution(req.size),
          Num: Math.min(Math.max(req.numImages ?? 1, 1), 4),
          Revise: 0, // 我们已自带英文 prompt，关闭平台扩写
          LogoAdd: 0, // 不加水印，成品图交给我们自己的存储
        });
        jobId = submit.JobId;
      } catch (err) {
        return { ok: false, status: 502, detail: (err as Error).message };
      }

      // 轮询任务状态（1=等待 2=运行 4=失败 5=完成），最长 ~60s
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        let status: any;
        try {
          status = await tencentRequest(cfg, "QueryHunyuanImageJob", { JobId: jobId });
        } catch (err) {
          return { ok: false, status: 502, detail: (err as Error).message };
        }
        if (status.JobStatusCode === "4") {
          return {
            ok: false,
            status: 502,
            detail: `Tencent generation failed: ${status.JobErrorMsg ?? "unknown"}`,
          };
        }
        if (status.JobStatusCode === "5") {
          const urls = Array.isArray(status.ResultImage) ? status.ResultImage.filter(Boolean) : [];
          if (urls.length === 0) {
            return { ok: false, status: 502, detail: "Tencent returned no image URLs" };
          }
          return { ok: true, urls };
        }
      }
      return { ok: false, status: 504, detail: "Tencent image job timed out (60s)" };
    },
  };
}

export const tencentImageProvider = createTencentImageProvider({
  secretId: process.env.TENCENT_SECRET_ID,
  secretKey: process.env.TENCENT_SECRET_KEY,
});
