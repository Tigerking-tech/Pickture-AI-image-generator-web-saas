"use client";

import { ArrowRight, Check, Loader2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildDecisionTree, type DecisionNode } from "@/lib/elementConfig";
import { candidatesForPlan } from "@/lib/modelRouter";
import type { VistaAttributeMap, VistaGroup, VistaTree } from "@/lib/vista";

/**
 * 创作工作台（T6 / R2）
 *
 * 布局：Leonardo.ai 式三栏工作台 —— 左侧决策树步骤、中间画布（候选图）、
 *       右侧要素摘要与终图操作。移动端塌缩为单列，终图按钮固定在底部。
 * 视觉：Midjourney 式图优先 —— 候选网格无边框、负空间即纯黑画布，
 *       选中态只加一圈紫罗兰描边。
 *
 * 红线（PRD §9.5.4）：决策树交互必须保留 —— 用户始终在做选择题，
 * 不提供"一键生成"捷径，也不在后端替用户做决定。
 */

interface ApiError {
  error?: string;
  message?: string;
}

export default function CreatePage() {
  const [sentence, setSentence] = useState("");
  const [tree, setTree] = useState<VistaTree | null>(null);
  const [nodeImages, setNodeImages] = useState<Record<string, string[]>>({});
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [activeId, setActiveId] = useState<string>("");
  const [finalImage, setFinalImage] = useState<string | null>(null);
  const [loading, setLoading] = useState<"" | "decompose" | string | "final">("");
  const [error, setError] = useState<string | null>(null);
  // 流式拆解的实时进度文案（长句拆解 30-45s，必须让用户看到它在动）
  const [progress, setProgress] = useState<string>("");
  // 数据飞轮（PRD §9.5）：一次创作会话一个 sessionId，把该会话的所有选择串起来
  const [sessionId, setSessionId] = useState("");
  // 每个节点被"重出"的次数，用于识别负信号（PRD §9.5.2：重出 > 3 次）
  const [regenCount, setRegenCount] = useState<Record<string, number>>({});
  // 套餐（服务端判定，前端不得自行声明）：决定每节点候选数 —— 免费 4 / 付费 9
  const [plan, setPlan] = useState("free");
  // 句子输入框：textarea 随内容自动长高，长句光标始终可见（不再需要在框里挪来挪去）。
  // 用 input 事件而不是依赖 state：粘贴/自动填充同样生效，也避免多余的重渲染。
  const sentenceRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = sentenceRef.current;
    if (!el) return;
    const grow = () => {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 208)}px`;
    };
    grow();
    el.addEventListener("input", grow);
    return () => el.removeEventListener("input", grow);
  }, []);
  // 用户最近选中的候选图 —— 后续节点的"主体锚"（控制变量：小猫不变，只变其他要素）
  const [pickedImageUrl, setPickedImageUrl] = useState<string | null>(null);

  // 取套餐：失败一律降级 free（成本保守），绝不因取不到就放开到 9
  useEffect(() => {
    void fetch("/api/credits")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j && typeof j.plan === "string") setPlan(j.plan);
      })
      .catch(() => {
        // 静默：取不到套餐就按免费档走，不影响主流程
      });
  }, []);

  useEffect(() => {
    setSessionId(
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
  }, []);

  // 从 Landing 的入口框带过来的句子（/create?q=...）
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) setSentence(q);
  }, []);

  const nodes: DecisionNode[] = useMemo(
    () => (tree ? buildDecisionTree(tree, { candidatesPerNode: candidatesForPlan(plan) }) : []),
    [tree, plan],
  );
  const active: DecisionNode | undefined = nodes.find((n) => n.id === activeId) ?? nodes[0];
  const pickedCount = useMemo(() => nodes.filter((n) => picked[n.id]).length, [nodes, picked]);

  /**
   * 生图走「提交任务 + 短轮询」。
   *
   * 为什么：出 4~9 张候选要 15~25s，线上外网代理约 15s 就会以 HTTP 524 掐断
   * （实测过）。改成短请求后，提交 <1s、每次轮询 <1s，不会再超时；
   * 等待期间右栏/顶部仍显示 loading。
   */
  const generateViaJob = useCallback(async (body: unknown): Promise<Record<string, unknown>> => {
    const start = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...(body as object), async: true }),
    });
    const sj = (await start.json().catch(() => ({}))) as {
      jobId?: string;
      message?: string;
      error?: string;
    };
    if (!start.ok) {
      throw new Error(sj.message ?? sj.error ?? `Request failed (HTTP ${start.status})`);
    }
    const jobId = sj.jobId;
    if (!jobId) throw new Error("Generation failed: no job id returned");

    const deadline = Date.now() + 180_000;
    let misses = 0;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const res = await fetch(`/api/generate?job=${encodeURIComponent(jobId)}`);
        const j = (await res.json().catch(() => ({}))) as {
          status?: string;
          result?: Record<string, unknown>;
          message?: string;
        };
        if (j.status === "done" && j.result) return j.result;
        if (j.status === "error") throw new Error(j.message ?? "Generation failed");
        misses = 0;
      } catch (err) {
        if (err instanceof Error && /Generation failed/.test(err.message)) throw err;
        // 轮询偶发抖动：继续问（任务已提交，重跑太浪费额度）
        misses += 1;
        if (misses > 5) throw new Error("Lost connection while generating. Please try again.");
      }
    }
    throw new Error("Generation took too long. Please try again.");
  }, []);

  /**
   * 数据飞轮埋点（PRD §9.5.1 学习点 A：选择信号沉淀）
   *
   * 埋点失败绝不影响用户操作 —— 飞轮数据这次丢了下次再攒，主流程必须继续走完。
   * 这里只"记录用户选了什么"，不做任何自动改写候选的动作
   * （红线 §9.5.4：飞轮只优化排序，绝不替用户做决定）。
   */
  const track = useCallback(
    (payload: {
      nodeAttr: string;
      candidateIndex: number;
      wasPicked?: boolean;
      satisfaction?: "positive" | "neutral" | "negative";
      event?: "pick" | "outcome";
      candidateValue?: string;
    }) => {
      if (sessionId === "") return;
      void fetch("/api/selections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, ...payload }),
      }).catch(() => {
        // 静默：埋点不是主流程
      });
    },
    [sessionId],
  );

  async function runDecompose(): Promise<void> {
    setError(null);
    setProgress("");
    setLoading("decompose");
    setFinalImage(null);
    setNodeImages({});
    setPicked({});
    setPickedImageUrl(null);
    setActiveId("");
    let lastMessage = "";
    // 网络层失败自动重试一次：移动网络/代理可能掐断长连接（实测手机端 network error）。
    // 只有 fetch 抛出的 TypeError（网络层）才重试；服务端业务报错直接展示，不浪费 tokens。
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const json = await decomposeViaJob(sentence.trim(), sessionId, plan, setProgress);
        setTree(json);
        return;
      } catch (err) {
        lastMessage = err instanceof Error ? err.message : String(err);
        setProgress("");
        if (!(err instanceof TypeError)) break;
      }
    }
    setError(
      `${lastMessage} — Decomposing a long sentence can take up to a minute. ` +
        "If this keeps happening, check your network and tap Decompose again " +
        "(repeat sentences return from cache instantly).",
    );
    setTree(null);
  }

  async function handleDecompose(e: React.SyntheticEvent) {
    e.preventDefault();
    if (sentence.trim() === "") return;
    await runDecompose();
  }

  async function handlePreview(node: DecisionNode) {
    if (!tree) return;
    setError(null);
    setLoading(node.id);
    // 重出计数：同一节点反复重出说明候选没命中，是明确的负信号（PRD §9.5.2）
    const nextCount = (regenCount[node.id] ?? 0) + 1;
    setRegenCount((prev) => ({ ...prev, [node.id]: nextCount }));
    if (nextCount > 3) {
      track({
        nodeAttr: `${node.group}.${node.key}`,
        candidateIndex: -1,
        event: "outcome",
        satisfaction: "negative",
      });
    }
    try {
      // 关键：把整棵树 + 当前属性一起传给后端 —— 后端会把"树里其他要素 +
      // 本节点的每个候选值"组装成完整提示词。否则只发一个 "running"，
      // 猫/场景全丢，生图模型只能默认画人。
      const json = (await generateViaJob({
        mode: "preview",
        candidates: node.candidates,
        tree,
        attribute: { group: node.group, key: node.key },
        // 已锚定主体 → 后续节点图生图锁主体（只变当前要素）；
        // 尚未锚定（第一个节点）→ 允许主体外观变化，给用户更多选择
        referenceUrl: pickedImageUrl ?? undefined,
        varySubject: !pickedImageUrl,
      })) as { images?: string[] };
      setNodeImages((prev) => ({ ...prev, [node.id]: json.images ?? [] }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading("");
    }
  }

  function handlePick(
    nodeId: string,
    group: VistaGroup,
    key: string,
    value: string,
    candidateIndex = -1,
    imageUrl?: string,
  ) {
    // 学习点 A：记录"这个节点的哪个候选被选中"（序号 + 值文本）
    track({
      nodeAttr: `${group}.${key}`,
      candidateIndex,
      candidateValue: value,
      wasPicked: true,
    });
    // 记住这张图：后续节点生成时以它为参考（图生图锁主体，只变当前要素）
    if (imageUrl) setPickedImageUrl(imageUrl);
    setPicked((prev) => ({ ...prev, [nodeId]: value }));
    setTree((prev) => {
      if (!prev) return prev;
      const next: VistaTree = { ...prev };
      const section: VistaAttributeMap = { ...next[group] };
      const attr = section[key];
      if (attr) {
        section[key] = { ...attr, value, source: "user", changed: true };
        next[group] = section;
      }
      return next;
    });
  }

  async function handleFinal() {
    if (!tree) return;
    setError(null);
    setLoading("final");
    try {
      const json = (await generateViaJob({ mode: "final", tree })) as { image?: string };
      setFinalImage(json.image ?? null);
      // 强正信号：会话走完并产出终图（PRD §9.5.2）
      track({
        nodeAttr: "__session__",
        candidateIndex: -1,
        event: "outcome",
        satisfaction: "positive",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading("");
    }
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="sticky top-0 z-20 border-b border-hairline bg-canvas/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-3 md:px-6">
          <Link href="/" className="font-display text-lg font-extrabold tracking-tight">
            Pictory
          </Link>
          <span className="font-mono text-xs text-ink-muted">
            {nodes.length > 0 ? `${pickedCount}/${nodes.length} chosen` : "create"}
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-[1400px] px-4 pb-28 pt-6 md:px-6 lg:pb-12">
        {/* ── 顶部：一句话入口 ── */}
        <form onSubmit={handleDecompose} className="flex flex-col gap-2 sm:flex-row">
          <textarea
            ref={sentenceRef}
            value={sentence}
            onChange={(e) => setSentence(e.target.value)}
            onKeyDown={(e) => {
              // Enter 直接拆解（与原单行输入习惯一致）；Shift+Enter 换行写长句
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleDecompose(e);
              }
            }}
            rows={1}
            placeholder="a girl and a dog running at sunset"
            aria-label="Describe the image you want"
            className="max-h-52 flex-1 resize-none rounded-2xl border border-hairline-strong bg-surface-elevated px-5 py-3 text-sm leading-relaxed text-ink outline-none transition placeholder:text-ink-dim focus:border-accent"
          />
          {/* 耗时预期：拆解带思维链要 30~60s，先说清楚，免得用户以为卡死 */}
          <p className="font-mono text-[11px] text-ink-dim sm:hidden">
            Decomposing usually takes 30–60s (longer for complex scenes).
          </p>
          <button
            type="submit"
            disabled={loading === "decompose"}
            className="btn-primary h-12 px-6 text-sm disabled:opacity-50"
          >
            {loading === "decompose" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Decompose"}
          </button>
        </form>

        {error && (
          <div className="mt-4 rounded-lg border border-danger/40 bg-danger/10 p-4 text-sm text-ink">
            {error}
          </div>
        )}

        {progress && !error && (
          <div className="mt-4 flex items-center gap-2 text-sm text-ink-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{progress}</span>
          </div>
        )}

        {/* ── 空态 ── */}
        {!tree && !loading && (
          <div className="mt-24 text-center">
            <p className="font-display text-lg font-bold tracking-tight">No image yet</p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-secondary">
              Type a sentence above. You’ll get a decision tree of elements, each with 2–4 candidate
              images to pick from.
            </p>
            <Link href="/gallery" className="btn-ghost mt-6 inline-flex px-5 py-2.5 text-sm">
              Browse the gallery
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </div>
        )}

        {/* ── 三栏工作台（Leonardo 范式）；移动端单列 ── */}
        {nodes.length > 0 && (
          <div className="mt-6 lg:grid lg:grid-cols-[200px_minmax(0,1fr)_280px] lg:gap-6">
            {/* 左栏：决策树步骤 */}
            <aside className="lg:sticky lg:top-20 lg:self-start">
              <h2 className="font-mono text-xs uppercase tracking-widest text-ink-muted">
                Decision tree
              </h2>
              {/* 移动端横向 chips / 桌面纵向列表 */}
              <nav className="mt-3 flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0">
                {nodes.map((n, i) => {
                  const isActive = active?.id === n.id;
                  const done = Boolean(picked[n.id]);
                  return (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => setActiveId(n.id)}
                      aria-current={isActive}
                      className={`flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-left text-xs transition lg:w-full lg:rounded-md ${
                        isActive
                          ? "bg-surface-hover text-ink"
                          : "text-ink-secondary hover:bg-surface-elevated hover:text-ink"
                      }`}
                    >
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px] ${
                          done
                            ? "bg-accent text-cta-ink"
                            : "border border-hairline-strong text-ink-muted"
                        }`}
                      >
                        {done ? <Check className="h-3 w-3" /> : i + 1}
                      </span>
                      <span className="whitespace-nowrap">{n.labelEn}</span>
                    </button>
                  );
                })}
              </nav>
            </aside>

            {/* 中栏：画布 */}
            <main className="mt-6 min-w-0 lg:mt-0">
              {active && (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-display text-lg font-bold tracking-tight">
                        {active.labelEn}
                      </h3>
                      <p className="mt-0.5 font-mono text-xs text-ink-muted">
                        {active.candidates.length} candidates
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handlePreview(active)}
                      disabled={loading === active.id}
                      className="btn-ghost h-9 px-4 text-xs disabled:opacity-50"
                    >
                      {loading === active.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        "Generate"
                      )}
                    </button>
                  </div>

                  {/* 候选图：网格隐形，负空间即画布 */}
                  {nodeImages[active.id]?.length ? (
                    <div className="mt-3 grid grid-cols-2 gap-1.5 md:grid-cols-3">
                      {nodeImages[active.id].map((url, idx) => {
                        const value = active.candidates[idx] ?? `candidate ${idx + 1}`;
                        const isPicked = picked[active.id] === value;
                        return (
                          <button
                            key={url}
                            type="button"
                            onClick={() =>
                              handlePick(
                                active.id,
                                active.group,
                                active.key,
                                value,
                                idx,
                                nodeImages[active.id]?.[idx],
                              )
                            }
                            aria-pressed={isPicked}
                            aria-label={`Pick ${value}`}
                            className="group relative overflow-hidden rounded-md"
                          >
                            {/* biome-ignore lint/performance/noImgElement: 生图 CDN 域名不固定，且已由 CDN 优化 */}
                            <img
                              src={url}
                              alt={value}
                              className={`aspect-square w-full object-cover transition ${
                                isPicked ? "" : "opacity-80 group-hover:opacity-100"
                              }`}
                            />
                            {isPicked && (
                              <span className="pointer-events-none absolute inset-0 rounded-md ring-2 ring-accent ring-inset" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="mt-3 flex aspect-[4/3] items-center justify-center rounded-md border border-dashed border-hairline-strong">
                      <p className="px-6 text-center text-sm text-ink-muted">
                        Generate to see {active.candidates.length} candidates for this element
                      </p>
                    </div>
                  )}

                  {/* 对话输入框：每节点都能用一句话改（R2） */}
                  <input
                    placeholder={`Describe the ${active.labelEn.toLowerCase()} you want, then press Enter`}
                    aria-label={`Set ${active.labelEn} by text`}
                    className="mt-3 h-11 w-full rounded-full border border-hairline bg-surface px-4 text-xs text-ink outline-none transition placeholder:text-ink-dim focus:border-accent"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const v = (e.target as HTMLInputElement).value.trim();
                        if (v) {
                          handlePick(
                            active.id,
                            active.group,
                            active.key,
                            v,
                            active.candidates.indexOf(v),
                          );
                        }
                      }
                    }}
                  />

                  {finalImage && (
                    <section className="mt-8">
                      <h3 className="font-display text-lg font-bold tracking-tight">
                        Final result
                      </h3>
                      {/* biome-ignore lint/performance/noImgElement: 生图 CDN 域名不固定，且已由 CDN 优化 */}
                      <img src={finalImage} alt="Final result" className="mt-3 w-full rounded-lg" />
                    </section>
                  )}
                </>
              )}
            </main>

            {/* 右栏：要素摘要 + 终图操作 */}
            <aside className="mt-8 lg:sticky lg:top-20 lg:mt-0 lg:self-start">
              <h2 className="font-mono text-xs uppercase tracking-widest text-ink-muted">
                Summary
              </h2>
              <dl className="mt-3 space-y-2">
                {nodes.map((n) => (
                  <div key={n.id} className="flex items-baseline justify-between gap-3">
                    <dt className="font-mono text-[11px] text-ink-muted">{n.labelEn}</dt>
                    <dd className="truncate text-right text-xs text-ink">
                      {picked[n.id] ?? <span className="text-ink-dim">—</span>}
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="mt-5 hidden border-t border-hairline pt-5 lg:block">
                <button
                  type="button"
                  onClick={handleFinal}
                  disabled={loading === "final"}
                  className="btn-primary inline-flex h-12 w-full items-center justify-center gap-2 disabled:opacity-50"
                >
                  {loading === "final" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Generate final image
                </button>
                <p className="mt-2 text-center font-mono text-xs text-ink-muted">
                  costs 10 credits
                </p>
              </div>
            </aside>
          </div>
        )}
      </div>

      {/* 移动端固定底部 CTA（终图）：不遮挡内容，始终可点 */}
      {nodes.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-canvas/95 px-4 py-3 backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={handleFinal}
            disabled={loading === "final"}
            className="btn-primary inline-flex h-12 w-full items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading === "final" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Generate final image · 10 credits
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * 拆解走「提交任务 + 短轮询」，不再用长连接 SSE。
 *
 * 为什么改（2026-10-23 实测）：为保证抽取质量必须保留 hy3 思维链
 * （关掉它「背对着镜头」会被错抽成 facing camera），但带思维链拆一句
 * 中文长句要 40~70s；手机 WebView / 代理常在 30s 掐断连接，即使有 SSE
 * 心跳也会报 "Failed to fetch"。改成短请求：提交 <1s，之后每 1.5s 用
 * 一个 <1s 的请求问结果，任何一次都不会超时。
 */
async function decomposeViaJob(
  sentence: string,
  sessionId: string,
  plan: string,
  onProgress: (text: string) => void,
): Promise<VistaTree> {
  // ① 提交：立刻拿到 jobId
  const start = await fetch("/api/decompose", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sentence, sessionId, plan, async: true }),
  });
  const startJson = (await start.json().catch(() => ({}))) as {
    jobId?: string;
    message?: string;
    error?: string;
  };
  if (!start.ok) {
    throw new Error(
      startJson.message ?? startJson.error ?? `Decompose failed (HTTP ${start.status})`,
    );
  }
  const jobId = startJson.jobId;
  if (!jobId) throw new Error("Decompose failed: no job id returned");

  // ② 轮询：每次都是短请求
  const startedAt = Date.now();
  const deadline = startedAt + 240_000;
  let pollFailures = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const waited = Math.round((Date.now() - startedAt) / 1000);
    try {
      const res = await fetch(`/api/decompose?job=${encodeURIComponent(jobId)}`);
      const j = (await res.json().catch(() => ({}))) as {
        status?: string;
        result?: VistaTree;
        message?: string;
        progress?: string;
      };
      if (j.status === "done" && j.result) return j.result;
      if (j.status === "error") throw new Error(j.message ?? "Decompose failed");
      // 进度带上已等待秒数：让用户知道"还在动"，而不是对着转圈干着急
      onProgress(j.progress ? `${j.progress} (waited ${waited}s)` : `Decomposing… ${waited}s`);
      pollFailures = 0;
    } catch (err) {
      if (err instanceof Error && /Decompose failed/.test(err.message)) throw err;
      // 轮询偶发网络抖动：忽略继续问（任务已提交，重跑整句太浪费）
      pollFailures += 1;
      if (pollFailures > 5) throw new Error("Lost connection while waiting. Please try again.");
    }
  }
  throw new Error(
    "Decompose took longer than 4 minutes. Please try again — or try a shorter sentence (repeat sentences return from cache instantly).",
  );
}
