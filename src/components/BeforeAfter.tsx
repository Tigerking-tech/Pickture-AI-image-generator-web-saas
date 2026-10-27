"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ============================================================
   Before / After 对比滑块 — 拖动分割线对比编辑前后。
   Landing 与 Demo 共用。支持指针拖动与键盘（左右箭头）。

   移动端可靠性（三重保险）：
   1. CSS `touch-action: none`（globals.css）——阻止浏览器把
      手势抢走当页面滚动（否则手指稍有纵向偏移就 pointercancel）。
   2. 指针捕获设在容器（currentTarget）上，move 即便移出元素
      也继续送达；另挂 window 级 move/up 兜底（capture 不可用时）。
   3. 原生非被动 touch 事件兜底——个别 WebView 的 Pointer
      Events 触摸支持不完整时仍可拖动；preventDefault 需非被动
      监听（React 合成 onTouchMove 是被动的，不能用来阻止滚动）。
   ============================================================ */

interface BeforeAfterProps {
  before: string;
  after: string;
  altBefore?: string;
  altAfter?: string;
  /** 初始分割线位置（0-100） */
  initial?: number;
  /** 是否显示左下/右下角标签 */
  labels?: boolean;
  className?: string;
}

export function BeforeAfter({
  before,
  after,
  altBefore = "Original",
  altAfter = "Edited",
  initial = 55,
  labels = true,
  className = "",
}: BeforeAfterProps) {
  const [pos, setPos] = useState(initial);
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const setFromClientX = useCallback((clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const p = ((clientX - r.left) / r.width) * 100;
    setPos(Math.min(100, Math.max(0, p)));
  }, []);

  /* ---------- 原生非被动 touch 兜底（在 effect 中挂到容器） ---------- */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ts = (e: TouchEvent) => {
      dragging.current = true;
      if (e.touches[0]) setFromClientX(e.touches[0].clientX);
    };
    const tm = (e: TouchEvent) => {
      if (!dragging.current) return;
      e.preventDefault(); // 非被动监听，可有效阻止页面滚动抢手势
      if (e.touches[0]) setFromClientX(e.touches[0].clientX);
    };
    const te = () => {
      dragging.current = false;
    };
    el.addEventListener("touchstart", ts, { passive: false });
    el.addEventListener("touchmove", tm, { passive: false });
    el.addEventListener("touchend", te);
    el.addEventListener("touchcancel", te);
    return () => {
      el.removeEventListener("touchstart", ts);
      el.removeEventListener("touchmove", tm);
      el.removeEventListener("touchend", te);
      el.removeEventListener("touchcancel", te);
    };
  }, [setFromClientX]);

  /* ---------- Pointer Events 主路径 ---------- */
  // window 级兜底处理必须用稳定引用：拖动中 setPos 会触发重渲染，
  // 若用每次渲染新建的函数，up 时 removeEventListener 会移除错对象导致泄漏
  const onWinMove = useCallback(
    (e: PointerEvent) => {
      if (dragging.current) setFromClientX(e.clientX);
    },
    [setFromClientX],
  );
  const onWinUp = useCallback(() => {
    dragging.current = false;
    window.removeEventListener("pointermove", onWinMove);
    window.removeEventListener("pointerup", onWinUp);
    window.removeEventListener("pointercancel", onWinUp);
  }, [onWinMove]);

  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    // 捕获设在容器上：拖出元素边界 move 仍送达
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      /* 老环境不支持则由 window 兜底 */
    }
    // window 级兜底：capture 失败/未触发时仍能跟踪 move 与 up
    window.addEventListener("pointermove", onWinMove);
    window.addEventListener("pointerup", onWinUp);
    window.addEventListener("pointercancel", onWinUp);
    setFromClientX(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragging.current) setFromClientX(e.clientX);
  };
  const onPointerUp = useCallback(() => {
    onWinUp();
  }, [onWinUp]);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setPos((p) => Math.max(0, p - 4));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setPos((p) => Math.min(100, p + 4));
    }
  };

  return (
    <div
      ref={ref}
      className={`ba ${className}`}
      style={{ "--pos": `${pos}%` } as React.CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* biome-ignore lint/performance/noImgElement: 图片来自编辑管线的运行时 dataURL/base64，next/image 无法优化且会破坏对比滑块的定位 */}
      <img src={before} alt={altBefore} draggable={false} />
      {/* biome-ignore lint/performance/noImgElement: 图片来自编辑管线的运行时 dataURL/base64，next/image 无法优化且会破坏对比滑块的定位 */}
      <img src={after} alt={altAfter} className="ba-after" draggable={false} />
      {labels && (
        <>
          <span className="ba-label before">Before</span>
          <span className="ba-label after">After</span>
        </>
      )}
      <div className="ba-divider" aria-hidden="true" />
      <button
        type="button"
        className="ba-handle"
        role="slider"
        aria-label="Compare before and after"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pos)}
        onKeyDown={onKey}
      >
        ↔
      </button>
    </div>
  );
}
