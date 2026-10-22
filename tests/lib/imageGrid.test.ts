import { describe, expect, it } from "vitest";
import {
  buildGridPrompt,
  gridLayoutFor,
  sharedConstraintOf,
} from "@/lib/imageGrid";

describe("grid prompt builder", () => {
  it("2~4 个候选用 2x2，5~9 个用 3x3（满格方阵遵循最好）", () => {
    expect(gridLayoutFor(2)).toEqual({ rows: 2, cols: 2 });
    expect(gridLayoutFor(4)).toEqual({ rows: 2, cols: 2 });
    expect(gridLayoutFor(5)).toEqual({ rows: 3, cols: 3 });
    expect(gridLayoutFor(9)).toEqual({ rows: 3, cols: 3 });
  });

  it("共享约束取所有候选的公共描述", () => {
    const shared = sharedConstraintOf([
      "standing, back to camera, rooftop at night",
      "walking, back to camera, rooftop at night",
      "crouching, back to camera, rooftop at night",
    ]);
    expect(shared).toContain("back to camera");
    expect(shared).toContain("rooftop at night");
    expect(shared).not.toContain("standing");
    expect(shared).not.toContain("walking");
  });

  it("背影类约束触发负面约束（堵死朝向漂移）", () => {
    const p = buildGridPrompt(
      [
        "standing, back to camera (seen from behind), rooftop at night",
        "walking, back to camera (seen from behind), rooftop at night",
      ],
      { rows: 2, cols: 2 },
    );
    expect(p).toContain("NEGATIVE CONSTRAINT");
    expect(p).toContain("face is NEVER visible");
    expect(p).toContain("2x2");
    expect(p).toContain("exactly 4 equal square panels");
    // 满格多出的格子要指令为重复最后一格
    expect(p).toContain("repeat Panel 2's content exactly");
  });

  it("无朝向约束时不加负面约束", () => {
    const p = buildGridPrompt(
      ["a red apple on a table", "a green apple on a table"],
      { rows: 2, cols: 2 },
    );
    expect(p).not.toContain("NEGATIVE CONSTRAINT");
    expect(p).toContain("a red apple on a table");
  });
});
