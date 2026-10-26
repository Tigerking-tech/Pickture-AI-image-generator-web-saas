"use client";

import { useCallback, useRef, useState } from "react";

/* ============================================================
   Before / After 对比滑块 — 拖动分割线对比编辑前后。
   Landing 与 Demo 共用。支持指针拖动与键盘（左右箭头）。
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

  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setFromClientX(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragging.current) setFromClientX(e.clientX);
  };
  const onPointerUp = () => {
    dragging.current = false;
  };
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
      <img src={before} alt={altBefore} draggable={false} />
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
