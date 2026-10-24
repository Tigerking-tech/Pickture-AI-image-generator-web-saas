// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Lightbox } from "@/components/lightbox";

const base = { imageUrl: "https://cdn.example/1.png", title: "running" };

describe("Lightbox", () => {
  it("renders the dialog and image with the given title", () => {
    render(<Lightbox {...base} onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "running" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "running" })).toBeTruthy();
  });

  it("closes on ESC", () => {
    const onClose = vi.fn();
    render(<Lightbox {...base} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when the overlay is clicked", () => {
    const onClose = vi.fn();
    render(<Lightbox {...base} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes via the close button", () => {
    const onClose = vi.fn();
    render(<Lightbox {...base} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the action button only when actionLabel + onAction are provided", () => {
    const onAction = vi.fn();
    render(<Lightbox {...base} onClose={() => {}} actionLabel="Use this" onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "Use this" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("is view-only without action props", () => {
    render(<Lightbox {...base} onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: "Use this" })).toBeNull();
  });

  it("locks body scroll while open and restores it on unmount", () => {
    const { unmount } = render(<Lightbox {...base} onClose={() => {}} />);
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });
});
