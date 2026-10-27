"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/client";

/**
 * 设置新密码（重置邮件落地页）。
 *
 * 流程：Supabase 的 resetPasswordForEmail 会把用户带回这里并带上一次性凭证，
 * @supabase/supabase-js 会在页面加载时自动识别 URL 里的凭证并触发
 * PASSWORD_RECOVERY 事件，此时会话是临时的、只能用来 updateUser。
 *
 * 注意：middleware 的 matcher 目前只保护 /dashboard /login /signup，
 * 本页不需要登录态，因此不冲突。
 */
export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const router = useRouter();
  const supabase = createSupabaseBrowser();

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event: string) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== password2) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    // 改完密码后旧会话应当失效，退出并让用户重新登录
    await supabase.auth.signOut();
    router.push("/login");
  }

  const inputStyle = {
    borderColor: "var(--line)",
    color: "var(--ink)",
    minHeight: 48,
  } as const;

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: "var(--bg)" }}
    >
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
          <h1
            className="text-2xl font-extrabold mb-1"
            style={{ color: "var(--ink)", letterSpacing: "-0.02em" }}
          >
            Set a new password
          </h1>
          <p className="text-sm mb-6" style={{ color: "var(--ink-2)" }}>
            {ready
              ? "Choose a new password for your account."
              : "Waiting for your reset link… If you opened this page directly, request a new link instead."}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="new-password"
                className="block text-sm font-bold mb-1.5"
                style={{ color: "var(--ink)" }}
              >
                New password
              </label>
              <input
                id="new-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="w-full px-4 py-3 rounded-xl border focus:outline-none transition-colors duration-150"
                style={inputStyle}
                required
              />
            </div>
            <div>
              <label
                htmlFor="confirm-password"
                className="block text-sm font-bold mb-1.5"
                style={{ color: "var(--ink)" }}
              >
                Confirm password
              </label>
              <input
                id="confirm-password"
                type="password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                autoComplete="new-password"
                className="w-full px-4 py-3 rounded-xl border focus:outline-none transition-colors duration-150"
                style={inputStyle}
                required
              />
            </div>

            {error && (
              <p className="text-sm font-medium" style={{ color: "var(--bad)" }} role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !ready}
              className="w-full py-3 btn-primary disabled:btn-disabled text-base"
            >
              {loading ? "Saving…" : "Save new password"}
            </button>
          </form>

          <p className="text-center mt-5 text-sm" style={{ color: "var(--ink-2)" }}>
            Need a new link?{" "}
            <Link href="/forgot-password" className="font-bold" style={{ color: "var(--brand)" }}>
              Request one
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
