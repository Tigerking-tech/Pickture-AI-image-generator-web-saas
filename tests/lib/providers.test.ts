import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getImageProvider } from "@/lib/providers/image";
import { getTextProvider } from "@/lib/providers/text";

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
