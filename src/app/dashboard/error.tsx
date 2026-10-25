"use client";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center p-4">
      <div
        className="bg-bg-secondary rounded-2xl border border-line-soft p-8 max-w-md w-full text-center"
        style={{ boxShadow: "0 1px 2px rgb(17 17 24 / 0.04), 0 8px 28px rgb(17 17 24 / 0.07)" }}
      >
        <h2 className="text-xl font-extrabold text-text-primary mb-2">Something went wrong</h2>
        <p className="text-text-muted text-sm mb-6">
          {error.message || "An unexpected error occurred."}
        </p>
        <button type="button" onClick={reset} className="btn-primary text-sm px-6 py-2">
          Try Again
        </button>
      </div>
    </div>
  );
}
