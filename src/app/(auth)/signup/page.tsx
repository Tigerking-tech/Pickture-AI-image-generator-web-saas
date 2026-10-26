"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { OAuthButtons } from "@/components/oauth-buttons";
import { createSupabaseBrowser } from "@/lib/supabase/client";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createSupabaseBrowser();

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push("/dashboard");
      router.refresh();
    }
  }

  const inputStyle = {
    borderColor: "var(--line)",
    color: "var(--ink)",
    minHeight: 48,
  } as const;

  return (
    <div className="min-h-screen flex" style={{ background: "var(--bg)" }}>
      {/* Left — Form */}
      <div className="flex-1 flex items-center justify-center p-6 md:p-8">
        <div className="w-full max-w-md">
          <Link
            href="/"
            className="text-2xl font-extrabold tracking-tight mb-10 block"
            style={{ color: "var(--ink)" }}
          >
            <span
              aria-hidden="true"
              style={{
                display: "inline-grid",
                placeItems: "center",
                width: 30,
                height: 30,
                borderRadius: 8,
                background: "var(--brand)",
                color: "#fff",
                fontSize: 15,
                fontWeight: 800,
                marginRight: 9,
                verticalAlign: -3,
              }}
            >
              S
            </span>
            Surepix
          </Link>

          <div
            className="p-8 rounded-2xl border"
            style={{
              background: "var(--surface)",
              borderColor: "var(--line-soft)",
              boxShadow: "0 1px 2px rgb(17 17 24 / 0.04), 0 8px 28px rgb(17 17 24 / 0.07)",
            }}
          >
            <h1 className="text-2xl font-extrabold mb-1" style={{ color: "var(--ink)", letterSpacing: "-0.02em" }}>
              Create your account
            </h1>
            <p className="text-sm mb-6" style={{ color: "var(--ink-2)" }}>
              Start with 50 verified edits a month — free, no card required
            </p>

            <form onSubmit={handleSignup} className="space-y-4">
              <div>
                <label htmlFor="signup-email" className="block text-sm font-bold mb-1.5" style={{ color: "var(--ink)" }}>
                  Email address
                </label>
                <input
                  id="signup-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full px-4 py-3 rounded-xl border focus:outline-none transition-colors duration-150"
                  style={inputStyle}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "var(--brand)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "var(--line)")}
                  required
                />
              </div>
              <div>
                <label htmlFor="signup-password" className="block text-sm font-bold mb-1.5" style={{ color: "var(--ink)" }}>
                  Password
                </label>
                <input
                  id="signup-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border focus:outline-none transition-colors duration-150"
                  style={inputStyle}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "var(--brand)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "var(--line)")}
                  minLength={6}
                  required
                />
              </div>

              {error && (
                <p className="text-sm font-medium" style={{ color: "var(--bad)" }} role="alert">
                  {error}
                </p>
              )}

              <button type="submit" disabled={loading} className="w-full py-3 btn-primary disabled:btn-disabled text-base">
                {loading ? "Creating account…" : "Sign Up →"}
              </button>
            </form>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t" style={{ borderColor: "var(--line-soft)" }} />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="px-3 font-medium" style={{ background: "var(--surface)", color: "var(--ink-3)" }}>
                  or
                </span>
              </div>
            </div>

            <OAuthButtons />

            <p className="text-center mt-5 text-sm" style={{ color: "var(--ink-2)" }}>
              Already have an account?{" "}
              <Link href="/login" className="font-bold" style={{ color: "var(--brand)" }}>
                Sign In
              </Link>
            </p>
          </div>
        </div>
      </div>

      {/* Right — Brand panel */}
      <div
        className="hidden lg:flex flex-1 items-center justify-center relative overflow-hidden"
        style={{
          background:
            "radial-gradient(700px 380px at 80% -10%, rgb(255 255 255 / 0.14), transparent 60%), radial-gradient(600px 400px at 10% 110%, rgb(255 255 255 / 0.08), transparent 55%), var(--brand)",
        }}
      >
        <div className="relative z-10 text-center px-12 max-w-md">
          <span
            className="inline-block px-4 py-1.5 text-xs font-bold rounded-full mb-8"
            style={{ background: "rgb(255 255 255 / 0.16)", color: "#fff", letterSpacing: "0.08em" }}
          >
            FREE PLAN · 50 EDITS / MONTH
          </span>
          <h2 className="text-5xl font-extrabold leading-[1.05] mb-5" style={{ color: "#fff", letterSpacing: "-0.03em" }}>
            Verified editing, from the first photo.
          </h2>
          <p className="text-lg font-medium" style={{ color: "rgb(255 255 255 / 0.78)", lineHeight: 1.6 }}>
            Colour, crop, resize and watermark as deterministic recipes —
            every logo, label and price tag verified before delivery.
          </p>
          <div
            className="mt-10 rounded-2xl p-5 text-left"
            style={{ background: "rgb(255 255 255 / 0.1)", border: "1px solid rgb(255 255 255 / 0.18)" }}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-extrabold uppercase tracking-wider" style={{ color: "rgb(255 255 255 / 0.7)" }}>
                What you get
              </span>
            </div>
            {["Fidelity verification included", "PNG + JPG export", "No training on your images", "Upgrade anytime — $9/mo Pro"].map((el) => (
              <div key={el} className="flex items-center gap-2.5 text-sm py-1.5" style={{ color: "#fff" }}>
                <span style={{ color: "#bbf7d0", fontWeight: 800 }}>✓</span>
                <span style={{ opacity: 0.85 }}>{el}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
