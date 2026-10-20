/**
 * T7 验收单元：积分原子扣减 + 套餐模型路由
 * 验收命令：pnpm vitest run tests/lib/credits.test.ts
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// mock Supabase admin，避免测试依赖真实数据库
const mockRpc = vi.fn();
const mockMaybeSingle = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({
    rpc: mockRpc,
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: mockMaybeSingle }),
      }),
    }),
  }),
}));

import {
  CREDITS_PER_WORK,
  consumeRefUploadQuota,
  getPlan,
  spendCredits,
  spendOneWork,
} from "@/lib/credits";
import { normalizePlan, resolveFinalModel, routeForPlan } from "@/lib/modelRouter";

beforeEach(() => {
  mockRpc.mockReset();
  mockMaybeSingle.mockReset();
});

describe("套餐 → 模型路由（PRD §10.5 / 规格 §0.2）", () => {
  it("免费档用 GPT-4o-mini + schnell，付费档切 GPT-4o", () => {
    expect(routeForPlan("free").decomposeModel).toBe("gpt-4o-mini");
    expect(routeForPlan("starter").decomposeModel).toBe("gpt-4o");
    expect(routeForPlan("pro").decomposeModel).toBe("gpt-4o");
  });

  it("节点预览一律走便宜的 schnell（18 张预览的成本基石）", () => {
    for (const plan of ["free", "starter", "pro"] as const) {
      expect(routeForPlan(plan).previewModel).toBe("fal-ai/flux/schnell");
    }
  });

  it("月度额度符合 PRD §10.2：60 / 600 / 2400", () => {
    expect(routeForPlan("free").monthlyCredits).toBe(60);
    expect(routeForPlan("starter").monthlyCredits).toBe(600);
    expect(routeForPlan("pro").monthlyCredits).toBe(2400);
  });

  it("免费档含 2 次 Pro 终图体验，之后降级 schnell（不静默扣费）", () => {
    expect(routeForPlan("free").proTrials).toBe(2);
    expect(resolveFinalModel("free", 0)).toBe("fal-ai/flux-pro/v1.1");
    expect(resolveFinalModel("free", 1)).toBe("fal-ai/flux-pro/v1.1");
    expect(resolveFinalModel("free", 2)).toBe("fal-ai/flux/schnell");
    // 付费档不受体验次数限制
    expect(resolveFinalModel("pro", 999)).toBe("fal-ai/flux-pro/v1.1");
  });

  it("免费档带水印、无优先队列；Pro 反之（PRD §10.2）", () => {
    expect(routeForPlan("free").watermark).toBe(true);
    expect(routeForPlan("free").priority).toBe(false);
    expect(routeForPlan("pro").watermark).toBe(false);
    expect(routeForPlan("pro").priority).toBe(true);
  });

  it("参考图上传限额：免费 月8/日3、Starter 月50、Pro 不限（PRD §10.2.1）", () => {
    expect(routeForPlan("free").refUploadMonthlyLimit).toBe(8);
    expect(routeForPlan("free").refUploadDailyLimit).toBe(3);
    expect(routeForPlan("starter").refUploadMonthlyLimit).toBe(50);
    expect(routeForPlan("pro").refUploadMonthlyLimit).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("未知套餐一律降级 free（不得臆造权益）", () => {
    expect(normalizePlan(undefined)).toBe("free");
    expect(normalizePlan("钻石会员")).toBe("free");
    expect(normalizePlan("PRO")).toBe("pro");
    expect(routeForPlan(null).monthlyCredits).toBe(60);
  });
});

describe("积分原子扣减（R5）", () => {
  it("扣减成功返回新余额", async () => {
    mockRpc.mockResolvedValue({ data: 50, error: null });
    const r = await spendCredits("user-1", 10, "work");
    expect(r.ok).toBe(true);
    expect(r.balance).toBe(50);
  });

  it("余额不足返回 402（R5 验收要求，绝不静默成功）", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Insufficient credits: have 5, need 10" },
    });
    const r = await spendCredits("user-1", 10, "work");
    expect(r.ok).toBe(false);
    expect(r.status).toBe(402);
    expect(r.reason).toBe("insufficient_credits");
  });

  it("无积分记录同样返回 402", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "No credits record for user" },
    });
    const r = await spendCredits("user-1", 10, "work");
    expect(r.ok).toBe(false);
    expect(r.status).toBe(402);
    expect(r.reason).toBe("no_credits_record");
  });

  it("未登录返回 401，非法数量返回 400", async () => {
    expect((await spendCredits("", 10, "work")).status).toBe(401);
    expect((await spendCredits("u", 0, "work")).status).toBe(400);
    expect((await spendCredits("u", -5, "work")).status).toBe(400);
    expect((await spendCredits("u", 1.5, "work")).status).toBe(400);
  });

  it("一个作品扣 10 积分（PRD §10.2.1）", async () => {
    expect(CREDITS_PER_WORK).toBe(10);
    mockRpc.mockResolvedValue({ data: 0, error: null });
    const r = await spendOneWork("user-1");
    expect(r.ok).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith(
      "spend_credits",
      expect.objectContaining({ p_amount: 10 }),
    );
  });

  it("扣减走数据库原子函数，不在应用层做读-改-写（防并发超扣）", async () => {
    mockRpc.mockResolvedValue({ data: 40, error: null });
    await spendCredits("user-1", 10, "work");
    expect(mockRpc).toHaveBeenCalledWith("spend_credits", expect.any(Object));
  });
});

describe("参考图上传配额（PRD §10.2.1）", () => {
  it("配额充足时放行并返回已用次数", async () => {
    mockRpc.mockResolvedValue({
      data: { ok: true, used_month: 1, used_today: 1 },
      error: null,
    });
    const r = await consumeRefUploadQuota("user-1", "free");
    expect(r.ok).toBe(true);
    expect(r.usedMonth).toBe(1);
  });

  it("超出月限返回 402 monthly_limit", async () => {
    mockRpc.mockResolvedValue({
      data: { ok: false, reason: "monthly_limit", used: 8 },
      error: null,
    });
    const r = await consumeRefUploadQuota("user-1", "free");
    expect(r.ok).toBe(false);
    expect(r.status).toBe(402);
    expect(r.reason).toBe("monthly_limit");
  });

  it("超出日限返回 402 daily_limit", async () => {
    mockRpc.mockResolvedValue({
      data: { ok: false, reason: "daily_limit", used: 3 },
      error: null,
    });
    const r = await consumeRefUploadQuota("user-1", "free");
    expect(r.reason).toBe("daily_limit");
    expect(r.status).toBe(402);
  });

  it("免费档按 8/3 传参，Pro 传极大值表示不限", async () => {
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });
    await consumeRefUploadQuota("user-1", "free");
    expect(mockRpc).toHaveBeenCalledWith(
      "consume_ref_upload_quota",
      expect.objectContaining({ p_month_max: 8, p_day_max: 3 }),
    );

    mockRpc.mockClear();
    await consumeRefUploadQuota("user-1", "pro");
    expect(mockRpc).toHaveBeenCalledWith(
      "consume_ref_upload_quota",
      expect.objectContaining({
        p_month_max: Number.MAX_SAFE_INTEGER,
        p_day_max: Number.MAX_SAFE_INTEGER,
      }),
    );
  });
});

describe("套餐读取", () => {
  it("读到合法套餐原样返回", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { plan: "starter" } });
    expect(await getPlan("user-1")).toBe("starter");
  });

  it("库中无记录时降级 free，不抛异常", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null });
    expect(await getPlan("user-1")).toBe("free");
  });
});
