export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-bg-primary">
      {/* Header skeleton */}
      <header className="bg-bg-secondary border-b border-line-soft">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-4 flex items-center justify-between">
          <div className="h-7 w-32 bg-border rounded animate-pulse" />
          <div className="h-8 w-24 bg-border rounded-full animate-pulse" />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 md:px-6 py-8 space-y-6">
        {/* Cards skeleton */}
        <div className="grid md:grid-cols-2 gap-6">
          <div
            className="bg-bg-secondary rounded-2xl border border-line-soft p-6 h-48 animate-pulse"
            style={{ boxShadow: "0 1px 2px rgb(17 17 24 / 0.04), 0 8px 28px rgb(17 17 24 / 0.07)" }}
          >
            <div className="h-5 w-40 bg-border rounded mb-4" />
            <div className="h-4 w-60 bg-border rounded mb-3" />
            <div className="h-4 w-48 bg-border rounded mb-3" />
            <div className="h-10 w-32 bg-border rounded-full mt-4" />
          </div>
          <div
            className="bg-bg-secondary rounded-2xl border border-line-soft p-6 h-48 animate-pulse"
            style={{ boxShadow: "0 1px 2px rgb(17 17 24 / 0.04), 0 8px 28px rgb(17 17 24 / 0.07)" }}
          >
            <div className="h-5 w-32 bg-border rounded mb-4" />
            <div className="h-8 w-20 bg-border rounded mb-3" />
            <div className="h-4 w-56 bg-border rounded" />
          </div>
        </div>

        {/* Features skeleton */}
        <div
          className="bg-bg-secondary rounded-2xl border border-line-soft p-6 animate-pulse"
          style={{ boxShadow: "0 1px 2px rgb(17 17 24 / 0.04), 0 8px 28px rgb(17 17 24 / 0.07)" }}
        >
          <div className="h-5 w-44 bg-border rounded mb-4" />
          <div className="space-y-3">
            <div className="h-4 w-36 bg-border rounded" />
            <div className="h-4 w-44 bg-border rounded" />
            <div className="h-4 w-32 bg-border rounded" />
          </div>
        </div>
      </main>
    </div>
  );
}
