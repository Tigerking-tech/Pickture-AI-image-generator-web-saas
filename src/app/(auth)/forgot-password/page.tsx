"use client";

import Link from "next/link";
import { useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/client";

/**
 * 忘记密码。
 *
 * 此前系统里没有任何找回入口（登录页无链接、无 /forgot-password、无 /reset-password），
 * 用户一旦忘记密码就只能人工联系客服 —— 对一个自助 SaaS 来说是不可接受的。
 *
 * 前置条件：Supabase Dashboard > Authentication > URL Configuration 里，
 * Site URL 与 Redirect URLs 必须包含下面的 redirectTo（默认 `${NEXT_PUBLIC_APP_URL}/reset-password`），
 * 否则邮件里的链接不可达。
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const supabase = createSupabaseBrowser();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin}/reset-password`;

    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    // 无论邮箱是否存在都显示同一句话，避免用「账号是否存在」做用户枚举
    setSent(true);
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
            Reset your password
          </h1>
          <p className="text-sm mb-6" style={{ color: "var(--ink-2)" }}>
            We&apos;ll email you a link to set a new one.
          </p>

          {sent ? (
            <div className="space-y-4">
              <p
                className="text-sm font-medium"
                style={{ color: "var(--ok, #16a34a)" }}
                role="status"
              >
                If an account exists for <strong>{email}</strong>, a reset link is on its way. Check
                your inbox (and spam folder).
              </p>
              <Link href="/login" className="block text-center py-3 btn-primary text-base">
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="forgot-email"
                  className="block text-sm font-bold mb-1.5"
                  style={{ color: "var(--ink)" }}
                >
                  Email address
                </label>
                <input
                  id="forgot-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full px-4 py-3 rounded-xl border focus:outline-none transition-colors duration-150"
                  style={inputStyle}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = "var(--brand)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "var(--line)";
                  }}
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
                disabled={loading}
                className="w-full py-3 btn-primary disabled:btn-disabled text-base"
              >
                {loading ? "Sending…" : "Send reset link →"}
              </button>

              <p className="text-center text-sm" style={{ color: "var(--ink-2)" }}>
                <Link href="/login" className="font-bold" style={{ color: "var(--brand)" }}>
                  Back to sign in
                </Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
