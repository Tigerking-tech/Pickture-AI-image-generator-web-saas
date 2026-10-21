/**
 * 图像 provider 选择器
 *
 * 切换方式（Vercel / .env.local）：设置 IMAGE_PROVIDER=fal | volcano
 * 默认 fal，缺省即回退 fal，避免配置缺失导致整站不可用。
 */
import type { ImageProvider } from "../types";
import { falImageProvider } from "./fal";
import { volcanoImageProvider } from "./volcano";

export function getImageProvider(): ImageProvider {
  const kind = (process.env.IMAGE_PROVIDER ?? "fal").toLowerCase();
  switch (kind) {
    case "volcano":
    case "volcengine":
      return volcanoImageProvider;
    case "fal":
    default:
      return falImageProvider;
  }
}

export type { ImageProvider };
