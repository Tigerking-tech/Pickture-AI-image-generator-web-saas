/**
 * VISTA schema 提示（拆句用的紧凑描述）。
 * 抽成共享模块，避免 OpenAI / OpenRouter 等各 provider 重复定义。
 */
import { VISTA_ATTRIBUTES } from "@/lib/vista";

export function buildSchemaHint(): string {
  const groups = new Map<string, string[]>();
  for (const a of VISTA_ATTRIBUTES) {
    if (!groups.has(a.group)) groups.set(a.group, []);
    const pool = a.pool.length > 0 ? ` [${a.pool.join("|")}]` : "";
    groups.get(a.group)!.push(`${a.key}${pool}`);
  }
  return [...groups.entries()].map(([g, keys]) => `${g}: ${keys.join("; ")}`).join("\n");
}
