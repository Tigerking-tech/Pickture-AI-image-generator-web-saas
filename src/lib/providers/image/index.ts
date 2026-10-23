/**
 * 图像 provider 选择器
 *
 * 切换方式（Vercel / .env.local）：设置 IMAGE_PROVIDER=fal | volcano | tencent | aliyun
 * 默认 fal，缺省即回退 fal，避免配置缺失导致整站不可用。
 */
import type { ImageProvider } from "../types";
import { aliyunImageProvider } from "./aliyun";
import { falImageProvider } from "./fal";
import { mockImageProvider } from "./mock";
import { tencentImageProvider } from "./tencent";
import { volcanoImageProvider } from "./volcano";

export function getImageProvider(): ImageProvider {
  const kind = (process.env.IMAGE_PROVIDER ?? "fal").toLowerCase();
  switch (kind) {
    case "volcano":
    case "volcengine":
      return volcanoImageProvider;
    case "tencent":
    case "hunyuan":
      return tencentImageProvider;
    case "aliyun":
    case "alibaba":
    case "qwen":
      return aliyunImageProvider;
    case "mock":
      return mockImageProvider;
    case "fal":
    default:
      return falImageProvider;
  }
}

export type { ImageGenResult, ImageProvider } from "../types";
