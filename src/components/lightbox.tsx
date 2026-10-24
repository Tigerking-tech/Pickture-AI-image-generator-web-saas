"use client";

import { X } from "lucide-react";
import { useEffect } from "react";

/**
 * 通用大图查看（P0-2）
 *
 * 为什么需要：候选图在网格里只有巴掌大（移动端 2 列），细节看不清，
 * 而"点击即选中"让用户没有机会先放大再决定。
 * 现在点击 = 放大看细节，确认后在大图里点主操作按钮才选中（Midjourney 式）。
 *
 * 交互约定：ESC / 点击遮罩关闭；打开期间锁定背景滚动。
 * 传 actionLabel + onAction → 显示主操作按钮（候选图"Use this"）；
 * 不传 → 纯查看模式（终图放大）。
 */

interface LightboxProps {
  imageUrl: string;
  /** 候选值或图名，同时用作无障碍标签 */
  title: string;
  onClose: () => void;
  actionLabel?: string;
  onAction?: () => void;
}

export function Lightbox({ imageUrl, title, onClose, actionLabel, onAction }: LightboxProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // 锁背景滚动：遮罩下页面不应跟着手势滚
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/95 p-4 backdrop-blur">
      {/* 遮罩即关闭按钮：真 button 天然支持键盘/读屏；点击内容区不会命中它 */}
      <button
        type="button"
        aria-label="Dismiss"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex max-h-full w-full max-w-3xl flex-col gap-3"
      >
        <div className="flex items-center justify-between gap-3">
          <p className="truncate font-mono text-xs text-ink-muted">{title}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="btn-ghost inline-flex h-9 w-9 shrink-0 items-center justify-center"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {/* biome-ignore lint/performance/noImgElement: 生图 CDN 域名不固定，且已由 CDN 优化 */}
        <img src={imageUrl} alt={title} className="max-h-[70vh] w-full rounded-lg object-contain" />
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="btn-primary inline-flex h-12 w-full items-center justify-center gap-2"
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
