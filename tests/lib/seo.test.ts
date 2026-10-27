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

  // 旧断言写死 4 条，而后来新增了 /demo 路由（README 明确"sitemap 已含 /demo"）——
  // 这里改为断言"路由清单本身"，新增页面时不会再把测试跑红。
  test("returns one entry per public route", () => {
    const urls = sitemap().map((e) => e.url);
    expect(urls).toHaveLength(5);
    for (const path of ["", "/demo", "/pricing", "/login", "/signup"]) {
      const expected = path === "" ? urls[0] : `${urls[0]}${path}`;
      expect(urls).toContain(expected);
    }
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
