import { describe, expect, test } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";

describe("sitemap", () => {
  test("includes home page", () => {
    const entries = sitemap();
    const urls = entries.map((e) => e.url);
    expect(urls.some((u) => u.endsWith("/") || !u.includes("/", 8))).toBe(true);
  });

  test("includes pricing page", () => {
    const entries = sitemap();
    const urls = entries.map((e) => e.url);
    expect(urls.some((u) => u.includes("/pricing"))).toBe(true);
  });

  // PRD §8 信息架构新增 /create 与 /gallery，条数由 4 增至 6
  test("returns 6 entries", () => {
    expect(sitemap()).toHaveLength(6);
  });

  test("includes create and gallery pages", () => {
    const urls = sitemap().map((e) => e.url);
    expect(urls.some((u) => u.includes("/create"))).toBe(true);
    expect(urls.some((u) => u.includes("/gallery"))).toBe(true);
  });
});

describe("robots — AI 爬虫放行（R12 / PRD §11.3）", () => {
  test("explicitly allows GPTBot / ClaudeBot / PerplexityBot", () => {
    const config = robots();
    const rules = Array.isArray(config.rules) ? config.rules : [config.rules];
    const agents = rules.flatMap((r) =>
      Array.isArray(r.userAgent) ? r.userAgent : r.userAgent ? [r.userAgent] : [],
    );
    expect(agents).toContain("GPTBot");
    expect(agents).toContain("ClaudeBot");
    expect(agents).toContain("PerplexityBot");
  });
});

describe("robots", () => {
  test("disallows /api/ and /dashboard/", () => {
    const config = robots();
    const rules = Array.isArray(config.rules) ? config.rules : [config.rules];
    const disallowed = rules.flatMap((r) =>
      Array.isArray(r.disallow) ? r.disallow : r.disallow ? [r.disallow] : [],
    );
    expect(disallowed).toContain("/api/");
    expect(disallowed).toContain("/dashboard/");
  });

  test("includes sitemap URL", () => {
    const config = robots();
    expect(config.sitemap).toContain("sitemap.xml");
  });
});
