import { describe, it } from "vitest";
import { main } from "../../scripts/make-showcase";

describe("make-showcase", () => {
  it("regenerate all showcase images with QC gate", async () => {
    await main();
  }, 600000);
});
