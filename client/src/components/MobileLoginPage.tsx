import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { preAuthenticate } from "thirdweb/wallets/in-app";
import { useWalletContext } from "@/context/WalletContext";
import { thirdwebClient, skaleChain, sharedInAppWallet } from "@/lib/inAppWalletClient";
import { getAuthToken } from "@/lib/agentAuth";
import { trackUserSignedUp } from "@/lib/analytics";

type Step = "login" | "email-input" | "email-otp" | "phone-input" | "phone-otp" | "connecting";

export function MobileLoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { syncAddress } = useWalletContext();

  // If ?callback=wog:// is present, we're in native auth mode
  // After login, redirect to the callback URL with wallet + token
  const nativeCallback = searchParams.get("callback");

  const [step, setStep] = React.useState<Step>("login");
  const [error, setError] = React.useState<string | null>(null);
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [otp, setOtp] = React.useState("");
  const [sendingOtp, setSendingOtp] = React.useState(false);

  async function sendEmailOtp() {
    if (!email.trim()) return;
    setSendingOtp(true);
    setError(null);
    try {
      await preAuthenticate({ client: thirdwebClient, strategy: "email", email: email.trim() });
      setOtp("");
      setStep("email-otp");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send code.");
    } finally {
      setSendingOtp(false);
    }
  }

  async function verifyEmailOtp() {
    setError(null);
    setStep("connecting");
    try {
      const account = await sharedInAppWallet.connect({
        client: thirdwebClient,
        chain: skaleChain,
        strategy: "email",
        email: email.trim(),
        verificationCode: otp.trim(),
      });
      await handleAuthSuccess(account.address);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid code. Please try again.");
      setStep("email-otp");
    }
  }

  async function sendPhoneOtp() {
    const normalized = normalizePhone(phone);
    if (!normalized) {
      setError("Enter your number in international format (e.g. +15551234567).");
      return;
    }
    setSendingOtp(true);
    setError(null);
    try {
      await preAuthenticate({ client: thirdwebClient, strategy: "phone", phoneNumber: normalized });
      setOtp("");
      setStep("phone-otp");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send code.");
    } finally {
      setSendingOtp(false);
    }
  }

  async function verifyPhoneOtp() {
    const normalized = normalizePhone(phone);
    if (!normalized) return;
    setError(null);
    setStep("connecting");
    try {
      const account = await sharedInAppWallet.connect({
        client: thirdwebClient,
        chain: skaleChain,
        strategy: "phone",
        phoneNumber: normalized,
        verificationCode: otp.trim(),
      });
      await handleAuthSuccess(account.address);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid code. Please try again.");
      setStep("phone-otp");
    }
  }

  async function handleAuthSuccess(address: string) {
    trackUserSignedUp("mobile", address);
    await syncAddress(address);

    let token = "";
    try {
      token = await getAuthToken(address) ?? "";
    } catch { /* best-effort */ }

    // Native app mode: redirect to custom URL scheme with credentials
    if (nativeCallback) {
      const callbackUrl = `${nativeCallback}?wallet=${encodeURIComponent(address)}&token=${encodeURIComponent(token)}`;
      window.location.href = callbackUrl;
      return;
    }

    // Web mode: go to game
    navigate("/world");
  }

  // ── Connecting screen ──────────────────────────────────────────────
  if (step === "connecting") {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center bg-[#070d15] px-6">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#d4a437] border-t-transparent" />
        <p className="mt-4 font-mono text-sm text-[#e2e8f0]/50">Authenticating...</p>
      </div>
    );
  }

  // ── Email input screen ─────────────────────────────────────────────
  if (step === "email-input") {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center bg-[#070d15] px-6">
        <p className="mb-6 font-mono text-lg font-bold text-[#d4a437]">Enter your email</p>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoFocus
          className="w-full max-w-xs border-2 border-[#2a3450] bg-[#0e1628] px-4 py-3 font-mono text-sm text-[#e2e8f0] placeholder-[#6d77a3] outline-none focus:border-[#d4a437]"
          onKeyDown={(e) => e.key === "Enter" && sendEmailOtp()}
        />
        {error && <p className="mt-3 max-w-xs font-mono text-xs text-[#ff4d6d]">[ERR] {error}</p>}
        <div className="mt-4 flex w-full max-w-xs gap-2">
          <button
            onClick={() => { setError(null); setStep("login"); }}
            className="flex-1 border-2 border-[#2a3450] bg-[#0e1628] py-3 font-mono text-sm text-[#6d77a3] transition hover:text-[#e2e8f0]"
          >
            Back
          </button>
          <button
            onClick={sendEmailOtp}
            disabled={sendingOtp || !email.trim()}
            className="flex-1 bg-[#d4a437] py-3 font-mono text-sm font-bold text-[#070d15] transition hover:bg-[#f5c842] disabled:opacity-50"
          >
            {sendingOtp ? "Sending..." : "Send Code"}
          </button>
        </div>
      </div>
    );
  }

  // ── Phone input screen ─────────────────────────────────────────────
  if (step === "phone-input") {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center bg-[#070d15] px-6">
        <p className="mb-2 font-mono text-lg font-bold text-[#d4a437]">Enter your phone</p>
        <p className="mb-6 font-mono text-[11px] text-[#e2e8f0]/40">International format, e.g. +15551234567</p>
        <input
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+15551234567"
          autoFocus
          className="w-full max-w-xs border-2 border-[#2a3450] bg-[#0e1628] px-4 py-3 font-mono text-sm text-[#e2e8f0] placeholder-[#6d77a3] outline-none focus:border-[#d4a437]"
          onKeyDown={(e) => e.key === "Enter" && sendPhoneOtp()}
        />
        {error && <p className="mt-3 max-w-xs font-mono text-xs text-[#ff4d6d]">[ERR] {error}</p>}
        <div className="mt-4 flex w-full max-w-xs gap-2">
          <button
            onClick={() => { setError(null); setStep("login"); }}
            className="flex-1 border-2 border-[#2a3450] bg-[#0e1628] py-3 font-mono text-sm text-[#6d77a3] transition hover:text-[#e2e8f0]"
          >
            Back
          </button>
          <button
            onClick={sendPhoneOtp}
            disabled={sendingOtp || !phone.trim()}
            className="flex-1 bg-[#d4a437] py-3 font-mono text-sm font-bold text-[#070d15] transition hover:bg-[#f5c842] disabled:opacity-50"
          >
            {sendingOtp ? "Sending..." : "Send Code"}
          </button>
        </div>
      </div>
    );
  }

  // ── OTP verification screen ────────────────────────────────────────
  if (step === "email-otp" || step === "phone-otp") {
    const isPhone = step === "phone-otp";
    const onVerify = isPhone ? verifyPhoneOtp : verifyEmailOtp;
    const sentTo = isPhone ? normalizePhone(phone) || phone : email;
    const backStep: Step = isPhone ? "phone-input" : "email-input";
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center bg-[#070d15] px-6">
        <p className="mb-2 font-mono text-lg font-bold text-[#d4a437]">Enter code</p>
        <p className="mb-6 font-mono text-xs text-[#e2e8f0]/50">Sent to {sentTo}</p>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
          placeholder="000000"
          autoFocus
          className="w-full max-w-[200px] border-2 border-[#2a3450] bg-[#0e1628] px-4 py-3 text-center font-mono text-2xl tracking-[0.5em] text-[#e2e8f0] placeholder-[#6d77a3] outline-none focus:border-[#d4a437]"
          onKeyDown={(e) => e.key === "Enter" && otp.length === 6 && onVerify()}
        />
        {error && <p className="mt-3 max-w-xs font-mono text-xs text-[#ff4d6d]">[ERR] {error}</p>}
        <div className="mt-4 flex w-full max-w-xs gap-2">
          <button
            onClick={() => { setError(null); setStep(backStep); }}
            className="flex-1 border-2 border-[#2a3450] bg-[#0e1628] py-3 font-mono text-sm text-[#6d77a3] transition hover:text-[#e2e8f0]"
          >
            Back
          </button>
          <button
            onClick={onVerify}
            disabled={otp.length < 6}
            className="flex-1 bg-[#d4a437] py-3 font-mono text-sm font-bold text-[#070d15] transition hover:bg-[#f5c842] disabled:opacity-50"
          >
            Verify
          </button>
        </div>
      </div>
    );
  }

  // ── Main login screen ──────────────────────────────────────────────
  return (
    <div className="flex h-[100dvh] flex-col bg-[#070d15] px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(3rem,env(safe-area-inset-top))]">
      {/* Header */}
      <div className="flex flex-col items-center pt-8">
        <h1 className="font-mono text-2xl font-bold tracking-[0.2em] text-[#d4a437]">
          WORLD OF GENEVA
        </h1>
        <p className="mt-2 font-mono text-xs text-[#e2e8f0]/40">
          Sign in to play
        </p>
      </div>

      {/* Login buttons */}
      <div className="mx-auto mt-10 flex w-full max-w-sm flex-1 flex-col gap-3">
        <button
          onClick={() => { setError(null); setStep("email-input"); }}
          className="flex w-full items-center gap-3 border-2 border-[#2a3450] bg-[#0e1628] px-4 py-3 text-left font-mono text-sm text-[#d6deff] shadow-[3px_3px_0_0_#000] transition hover:border-[#ffcc00] hover:text-[#ffcc00] active:translate-x-[1px] active:translate-y-[1px]"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center border border-[#ffcc00] text-xs font-bold text-[#ffcc00]">
            @
          </span>
          <span>Continue with Email</span>
          <span className="ml-auto text-[11px] text-[#6d77a3]">[&rarr;]</span>
        </button>

        <button
          onClick={() => { setError(null); setStep("phone-input"); }}
          className="flex w-full items-center gap-3 border-2 border-[#2a3450] bg-[#0e1628] px-4 py-3 text-left font-mono text-sm text-[#d6deff] shadow-[3px_3px_0_0_#000] transition hover:border-[#54f28b] hover:text-[#54f28b] active:translate-x-[1px] active:translate-y-[1px]"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center border border-[#54f28b] text-xs font-bold text-[#54f28b]">
            #
          </span>
          <span>Continue with SMS</span>
          <span className="ml-auto text-[11px] text-[#6d77a3]">[&rarr;]</span>
        </button>

        {error && (
          <p className="mt-1 border border-[#ff4d6d] bg-[#1a0a0e] px-3 py-2 font-mono text-xs text-[#ff4d6d]">
            [ERR] {error}
          </p>
        )}

        <div className="flex-1" />

        <button
          onClick={() => {
            if (nativeCallback) {
              window.location.href = `${nativeCallback}?spectate=true`;
            } else {
              navigate("/world");
            }
          }}
          className="mb-2 w-full py-3 font-mono text-xs text-[#e2e8f0]/30 transition hover:text-[#e2e8f0]/60"
        >
          Spectate without signing in &rarr;
        </button>
      </div>
    </div>
  );
}

// Strip whitespace, dashes, parens; require leading + and 7-15 digits.
function normalizePhone(input: string): string | null {
  const cleaned = input.replace(/[\s\-()]/g, "");
  if (!/^\+\d{7,15}$/.test(cleaned)) return null;
  return cleaned;
}
