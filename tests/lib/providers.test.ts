import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getImageProvider } from "@/lib/providers/image";
import { getTextProvider } from "@/lib/providers/text";
import { createOpenAIProvider } from "@/lib/providers/text/openai";

/**
 * Provider 选择层单测：确认"切换供应商 = 改 env"，无需改路由代码。
 */
describe("provider selection (env-driven)", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    // 清掉相关 env，避免测试间污染
    delete process.env.IMAGE_PROVIDER;
    delete process.env.TEXT_PROVIDER;
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it("默认图像 provider 是 fal", () => {
    expect(getImageProvider().name).toBe("fal");
  });

  it("IMAGE_PROVIDER=volcano 切到火山引擎", () => {
    process.env.IMAGE_PROVIDER = "volcano";
    expect(getImageProvider().name).toBe("volcano");
  });

  it("IMAGE_PROVIDER=aliyun 切到阿里云百炼", () => {
    process.env.IMAGE_PROVIDER = "aliyun";
    expect(getImageProvider().name).toBe("aliyun");
  });

  it("IMAGE_PROVIDER 别名（alibaba / qwen）同样切到阿里云", () => {
    process.env.IMAGE_PROVIDER = "qwen";
    expect(getImageProvider().name).toBe("aliyun");
    process.env.IMAGE_PROVIDER = "alibaba";
    expect(getImageProvider().name).toBe("aliyun");
  });

  it("IMAGE_PROVIDER=tencent 切到腾讯混元", () => {
    process.env.IMAGE_PROVIDER = "tencent";
    expect(getImageProvider().name).toBe("tencent");
  });

  it("未配置 key 时阿里云 provider 如实报告未配置", () => {
    process.env.IMAGE_PROVIDER = "aliyun";
    const savedAliyun = process.env.ALIYUN_API_KEY;
    const savedDash = process.env.DASHSCOPE_API_KEY;
    delete process.env.ALIYUN_API_KEY;
    delete process.env.DASHSCOPE_API_KEY;
    expect(getImageProvider().isConfigured()).toBe(false);
    if (savedAliyun !== undefined) process.env.ALIYUN_API_KEY = savedAliyun;
    if (savedDash !== undefined) process.env.DASHSCOPE_API_KEY = savedDash;
  });

  it("默认文本 provider 是 openai", () => {
    expect(getTextProvider().name).toBe("openai");
  });

  it("TEXT_PROVIDER=openrouter 切到 OpenRouter", () => {
    process.env.TEXT_PROVIDER = "openrouter";
    expect(getTextProvider().name).toBe("openrouter");
  });

  it("未配置 key 时 provider 如实报告未配置", () => {
    const savedKey = process.env.FAL_KEY;
    delete process.env.FAL_KEY;
    expect(getImageProvider().isConfigured()).toBe(false);
    if (savedKey !== undefined) process.env.FAL_KEY = savedKey;
  });
});

/**
 * 回归保护：拆句必须保留思维链（准确率优先）。
 *
 * 2026-10-23 实测对照（同一句「老人…背对着镜头…坐在礁石上」）：
 *   思维链开 → 30~120s，但抽取出 sitting / back to camera（正确）
 *   思维链关 → 16s，   抽取成 running / facing camera（错误）
 * 用户明确选择"保持准确率"，故锁定：请求体里绝不能带 thinking:{type:"disabled"}。
 */
describe("拆句保留思维链（准确率优先，回归保护）", () => {
  it("disableThinking 为 false 时，请求体不带 thinking 字段", async () => {
    const original = globalThis.fetch;
    let body: string | undefined;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      body = init?.body as string;
      return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const p = createOpenAIProvider({
      name: "t",
      apiKey: "k",
      baseUrl: "https://example.test/v1",
      missingKeyMessage: "m",
      disableThinking: false,
    });
    try {
      await p.decompose({ sentence: "老人背对着镜头坐在礁石上", model: "hy3" });
    } finally {
      globalThis.fetch = original;
    }

    const parsed = JSON.parse(body ?? "{}");
    expect(parsed.thinking).toBeUndefined();
  });

  it("disableThinking 为 true 时才发送 thinking:{type:'disabled'}（确认开关确实有效）", async () => {
    const original = globalThis.fetch;
    let body: string | undefined;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      body = init?.body as string;
      return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const p = createOpenAIProvider({
      name: "t",
      apiKey: "k",
      baseUrl: "https://example.test/v1",
      missingKeyMessage: "m",
      disableThinking: true,
    });
    try {
      await p.decompose({ sentence: "x", model: "hy3" });
    } finally {
      globalThis.fetch = original;
    }

    const parsed = JSON.parse(body ?? "{}");
    expect(parsed.thinking).toEqual({ type: "disabled" });
  });
});
