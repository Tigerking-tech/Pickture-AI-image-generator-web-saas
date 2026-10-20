"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 画廊网格 + lightbox（Midjourney 范式）
 *
 * · 网格隐形：无卡片、无边框，图片间负空间即画布本身
 * · lightbox：近黑遮罩 + 大图居中 + 元数据侧栏（等宽字体承载）
 * · 无障碍：role=dialog、ESC 关闭、打开时锁滚动、焦点归还触发元素
 */

export interface GalleryItem {
  id: string;
  /** 列表展示用：缩略图（≤640px） */
  url: string;
  /** lightbox 展示用：大图（≤1536px） */
  full: string;
  caption: string | null;
  createdAt: string | null;
}

export function GalleryGrid({ items }: { items: GalleryItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const lastTrigger = useRef<HTMLElement | null>(null);

  const isOpen = openIndex !== null;
  const current = isOpen ? items[openIndex] : null;

  const close = useCallback(() => {
    setOpenIndex(null);
    // 焦点归还触发元素，避免键盘用户丢失位置
    lastTrigger.current?.focus();
  }, []);

  const step = useCallback(
    (delta: number) => {
      setOpenIndex((i) => (i === null ? null : (i + delta + items.length) % items.length));
    },
    [items.length],
  );

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    document.addEventListener("keydown", onKey);
    // 打开时锁滚动
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [isOpen, close, step]);

  return (
    <>
      {/* 密集瀑布流：columns 实现，移动端 2 列起步 */}
      <div className="mt-8 columns-2 gap-1.5 sm:columns-3 md:columns-4 lg:columns-5">
        {items.map((item, idx) => (
          <button
            key={item.id}
            type="button"
            onClick={(e) => {
              lastTrigger.current = e.currentTarget;
              setOpenIndex(idx);
            }}
            className="mb-1.5 block w-full break-inside-avoid overflow-hidden rounded-sm"
            aria-label={`Open ${item.caption ?? "work"}`}
          >
            {/* biome-ignore lint/performance/noImgElement: 生图 CDN 域名不固定，且已由 CDN 优化 */}
            <img
              src={item.url}
              alt={item.caption ?? "Generated work"}
              loading="lazy"
              className="w-full bg-surface-elevated transition hover:opacity-90"
            />
          </button>
        ))}
      </div>

      {/* Lightbox */}
      {isOpen && current && (
        // 遮罩点击关闭是鼠标便利功能；键盘用户走 ESC / 方向键（见上方 useEffect 全局监听）
        // biome-ignore lint/a11y/useKeyWithClickEvents: 键盘路径由 document keydown 覆盖，遮罩本身不可聚焦
        <div
          role="dialog"
          aria-modal="true"
          aria-label={current.caption ?? "Work detail"}
          className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/95 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            aria-label="Close"
            className="absolute right-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-hairline-strong text-ink transition hover:bg-surface-hover"
          >
            <X className="h-5 w-5" />
          </button>

          {/* 前后切换 */}
          {items.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Previous"
                className="absolute left-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-hairline-strong text-ink transition hover:bg-surface-hover"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Next"
                className="absolute right-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-hairline-strong text-ink transition hover:bg-surface-hover"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          )}

          <figure className="flex max-h-full w-full max-w-5xl flex-col items-center gap-4 px-4 py-16 md:flex-row md:items-start md:gap-6 md:px-16">
            {/* biome-ignore lint/performance/noImgElement: 生图 CDN 域名不固定，且已由 CDN 优化 */}
            <img
              src={current.full}
              alt={current.caption ?? "Generated work"}
              className="max-h-[70vh] w-auto rounded-md object-contain"
            />
            <figcaption className="w-full shrink-0 md:max-w-[240px] md:pt-2">
              <div className="font-mono text-[11px] uppercase tracking-widest text-ink-muted">
                Prompt
              </div>
              <p className="mt-2 text-sm leading-relaxed text-ink">{current.caption ?? "—"}</p>
              {current.createdAt && (
                <>
                  <div className="mt-5 font-mono text-[11px] uppercase tracking-widest text-ink-muted">
                    Created
                  </div>
                  <p className="mt-2 font-mono text-xs text-ink-secondary">
                    {new Date(current.createdAt).toISOString().slice(0, 10)}
                  </p>
                </>
              )}
              <p className="mt-5 font-mono text-[11px] text-ink-dim">
                {openIndex! + 1} / {items.length}
              </p>
            </figcaption>
          </figure>
        </div>
      )}
    </>
  );
}
