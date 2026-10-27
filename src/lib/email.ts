import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

/** 邮件来自若不转义，用户自填的昵称（含 <script>）会原样进入邮件正文 */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 金额单位：分。
 * Creem / webhook 侧的 amount 一律是最小货币单位（USD = cents），呈报前除以 100。
 * 见 src/app/api/webhooks/creem/route.ts 里 billing_events.amount 的注释，两处必须一致。
 */
function formatAmount(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

interface EmailResult {
  success: boolean;
  skipped?: boolean;
  id?: string;
}

export async function sendWelcomeEmail(to: string, name: string): Promise<EmailResult> {
  if (!resend) return { success: true, skipped: true };

  try {
    const { data } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL ?? "Surepix <noreply@resend.dev>",
      to,
      subject: "Welcome to Surepix!",
      html: `<div style="font-family: 'Bricolage Grotesque', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background: #f5f0eb;">
        <h1 style="font-size: 28px; font-weight: 800; color: #0a0a0a; margin-bottom: 16px;">Welcome aboard, ${escapeHtml(name || "there")}!</h1>
        <p style="font-size: 16px; color: #0a0a0a; line-height: 1.6;">Your account is ready. Start building with Surepix.</p>
        <a href="${process.env.NEXT_PUBLIC_APP_URL ?? ""}/dashboard" style="display: inline-block; margin-top: 20px; padding: 12px 24px; background: #ff6b2c; color: #000; font-weight: 700; text-decoration: none; border: 2px solid #000; border-radius: 9999px;">Go to Dashboard</a>
      </div>`,
    });
    return { success: true, id: data?.id };
  } catch {
    console.error("[email] Failed to send welcome email");
    return { success: false };
  }
}

export async function sendPaymentConfirmation(
  to: string,
  productName: string,
  amount: number,
): Promise<EmailResult> {
  if (!resend) return { success: true, skipped: true };

  const formattedAmount = formatAmount(amount);

  try {
    const { data } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL ?? "Surepix <noreply@resend.dev>",
      to,
      subject: `Payment confirmed — ${productName}`,
      html: `<div style="font-family: 'Bricolage Grotesque', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background: #f5f0eb;">
        <h1 style="font-size: 28px; font-weight: 800; color: #0a0a0a; margin-bottom: 16px;">Payment Confirmed</h1>
        <p style="font-size: 16px; color: #0a0a0a; line-height: 1.6;">Thank you for subscribing to <strong>${escapeHtml(productName)}</strong>.</p>
        <div style="margin: 20px 0; padding: 16px; background: #fff; border: 2px solid #000; border-radius: 8px;">
          <p style="margin: 0; font-size: 14px; color: #666;">Amount paid</p>
          <p style="margin: 4px 0 0; font-size: 24px; font-weight: 800; color: #0a0a0a;">${formattedAmount}</p>
        </div>
        <a href="${process.env.NEXT_PUBLIC_APP_URL ?? ""}/dashboard" style="display: inline-block; margin-top: 20px; padding: 12px 24px; background: #ff6b2c; color: #000; font-weight: 700; text-decoration: none; border: 2px solid #000; border-radius: 9999px;">View Dashboard</a>
      </div>`,
    });
    return { success: true, id: data?.id };
  } catch {
    console.error("[email] Failed to send payment confirmation");
    return { success: false };
  }
}
