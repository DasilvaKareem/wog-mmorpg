import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { preAuthenticate } from "thirdweb/wallets/in-app";
import { useWalletContext } from "@/context/WalletContext";
import { thirdwebClient, skaleChain, sharedInAppWallet } from "@/lib/inAppWalletClient";
import { getAuthToken } from "@/lib/agentAuth";
import { WalletManager } from "@/lib/walletManager";
import { trackUserSignedUp } from "@/lib/analytics";

type SocialStrategy = "google" | "discord" | "x" | "telegram";
type Step = "login" | "email-input" | "email-otp" | "connecting";

const SOCIAL_PROVIDERS: { strategy: SocialStrategy; label: string; icon: string; color: string }[] = [
  { strategy: "google", label: "Google", icon: "G", color: "#ea4335" },
  { strategy: "discord", label: "Discord", icon: "D", color: "#5865f2" },
  { strategy: "x", label: "X / Twitter", icon: "X", color: "#e7e7e7" },
  { strategy: "telegram", label: "Telegram", icon: "T", color: "#26a5e4" },
];

export function MobileLoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { connect, syncAddress } = useWalletContext();

  // If ?callback=wog:// is present, we're in native auth mode
  // After login, redirect to the callback URL with wallet + token
  const nativeCallback = searchParams.get("callback");

  const [step, setStep] = React.useState<Step>("login");
  const [error, setError] = React.useState<string | null>(null);
  const [email, setEmail] = React.useState("");
  const [otp, setOtp] = React.useState("");
  const [sendingOtp, setSendingOtp] = React.useState(false);

  async function connectSocial(strategy: SocialStrategy) {
    setError(null);
    setStep("connecting");
    try {
      const account = await sharedInAppWallet.connect({ client: thirdwebClient, chain: skaleChain, strategy });
      await handleAuthSuccess(account.address);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed. Please try again.");
      setStep("login");
    }
  }

  async function sendEmailOtp() {
    if (!email.trim()) return;
    setSendingOtp(true);
    setError(null);
    try {
      await preAuthenticate({ client: thirdwebClient, strategy: "email", email: email.trim() });
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

  async function connectWallet() {
    setError(null);
    setStep("connecting");
    try {
      await connect();
      const nextAddress = WalletManager.getInstance().address;
      if (!nextAddress) {
        setStep("login");
        return;
      }
      await handleAuthSuccess(nextAddress);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wallet connection failed.");
      setStep("login");
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

  // ── OTP verification screen ────────────────────────────────────────
  if (step === "email-otp") {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center bg-[#070d15] px-6">
        <p className="mb-2 font-mono text-lg font-bold text-[#d4a437]">Enter code</p>
        <p className="mb-6 font-mono text-xs text-[#e2e8f0]/50">Sent to {email}</p>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
          placeholder="000000"
          autoFocus
          className="w-full max-w-[200px] border-2 border-[#2a3450] bg-[#0e1628] px-4 py-3 text-center font-mono text-2xl tracking-[0.5em] text-[#e2e8f0] placeholder-[#6d77a3] outline-none focus:border-[#d4a437]"
          onKeyDown={(e) => e.key === "Enter" && otp.length === 6 && verifyEmailOtp()}
        />
        {error && <p className="mt-3 max-w-xs font-mono text-xs text-[#ff4d6d]">[ERR] {error}</p>}
        <div className="mt-4 flex w-full max-w-xs gap-2">
          <button
            onClick={() => { setError(null); setStep("email-input"); }}
            className="flex-1 border-2 border-[#2a3450] bg-[#0e1628] py-3 font-mono text-sm text-[#6d77a3] transition hover:text-[#e2e8f0]"
          >
            Back
          </button>
          <button
            onClick={verifyEmailOtp}
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
        {SOCIAL_PROVIDERS.map((p) => (
          <button
            key={p.strategy}
            onClick={() => void connectSocial(p.strategy)}
            className="flex w-full items-center gap-3 border-2 border-[#2a3450] bg-[#0e1628] px-4 py-3 text-left font-mono text-sm text-[#d6deff] shadow-[3px_3px_0_0_#000] transition hover:border-[#54f28b] hover:text-[#54f28b] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0_0_#000]"
          >
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center border text-xs font-bold"
              style={{ borderColor: p.color, color: p.color }}
            >
              {p.icon}
            </span>
            <span>Login with {p.label}</span>
            <span className="ml-auto text-[11px] text-[#6d77a3]">[&rarr;]</span>
          </button>
        ))}

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
          onClick={() => void connectWallet()}
          className="flex w-full items-center gap-3 border-2 border-[#54f28b] bg-[#0a1a0e] px-4 py-3 text-left font-mono text-sm text-[#54f28b] shadow-[3px_3px_0_0_#000] transition hover:bg-[#112a1b] active:translate-x-[1px] active:translate-y-[1px]"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center border border-[#54f28b] text-xs font-bold text-[#54f28b]">
            W
          </span>
          <div className="flex flex-col">
            <span>Browse Wallets</span>
            <span className="text-[10px] text-[#6d77a3]">MetaMask, Rabby, WalletConnect, more</span>
          </div>
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
