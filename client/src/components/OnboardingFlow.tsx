import * as React from "react";
import { useNavigate } from "react-router-dom";
import { preAuthenticate } from "thirdweb/wallets/in-app";
import { fetchClasses, fetchRaces, createCharacter } from "@/ShardClient";
import { useWalletContext } from "@/context/WalletContext";
import { thirdwebClient, skaleChain, sharedInAppWallet } from "@/lib/inAppWalletClient";
import { getAuthToken } from "@/lib/agentAuth";
import { API_URL } from "@/config";
import { gameBus } from "@/lib/eventBus";
import { PaymentGate } from "@/components/PaymentGate";
import type { RaceInfo, ClassInfo, CharacterStats } from "@/types";

type SocialStrategy = "google" | "discord" | "x" | "telegram" | "farcaster";
type Step =
  | "login"
  | "email-input"
  | "email-otp"
  | "connecting"
  | "create-char"
  | "payment-char"
  | "minting"
  | "success";

interface SuccessData {
  name: string;
  race: string;
  className: string;
  txHash?: string;
  agentDeploying?: boolean;
  agentEntityId?: string;
  agentZoneId?: string;
  agentError?: string;
}

const SOCIAL_PROVIDERS: { strategy: SocialStrategy; label: string; icon: string; color: string }[] = [
  { strategy: "google", label: "Google", icon: "G", color: "#ea4335" },
  { strategy: "discord", label: "Discord", icon: "D", color: "#5865f2" },
  { strategy: "x", label: "X / Twitter", icon: "X", color: "#e7e7e7" },
  { strategy: "telegram", label: "Telegram", icon: "T", color: "#26a5e4" },
];

function combineStats(base: CharacterStats, modifiers: CharacterStats): CharacterStats {
  const keys = Object.keys(base) as (keyof CharacterStats)[];
  const result = {} as CharacterStats;
  for (const key of keys) {
    result[key] = Math.floor((base[key] ?? 0) * (modifiers[key] ?? 1));
  }
  return result;
}

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-[8px]">
      <span className="text-[#9aa7cc]">{label}</span>
      <span className="text-[#ffcc00]">{value}</span>
    </div>
  );
}

interface OnboardingFlowProps {
  onClose: () => void;
}

export function OnboardingFlow({ onClose }: OnboardingFlowProps): React.ReactElement {
  const navigate = useNavigate();
  const { syncAddress } = useWalletContext();

  const [step, setStep] = React.useState<Step>("login");
  const [error, setError] = React.useState<string | null>(null);
  const [connectedAddress, setConnectedAddress] = React.useState<string | null>(null);

  // Email flow
  const [email, setEmail] = React.useState("");
  const [otp, setOtp] = React.useState("");
  const [sendingOtp, setSendingOtp] = React.useState(false);

  // Character creation
  const [races, setRaces] = React.useState<RaceInfo[]>([]);
  const [classes, setClasses] = React.useState<ClassInfo[]>([]);
  const [charName, setCharName] = React.useState("");
  const [raceId, setRaceId] = React.useState("");
  const [classId, setClassId] = React.useState("");
  const [successData, setSuccessData] = React.useState<SuccessData | null>(null);

  // Load races/classes when entering create-char step
  React.useEffect(() => {
    if (step !== "create-char") return;
    Promise.all([fetchRaces(), fetchClasses()]).then(([r, c]) => {
      setRaces(r);
      setClasses(c);
    });
  }, [step]);

  async function connectSocial(strategy: SocialStrategy) {
    setError(null);
    setStep("connecting");
    try {
      const account = await sharedInAppWallet.connect({ client: thirdwebClient, chain: skaleChain, strategy });
      setConnectedAddress(account.address);
      await syncAddress(account.address);
      setStep("create-char");
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
      setConnectedAddress(account.address);
      await syncAddress(account.address);
      setStep("create-char");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid code. Please try again.");
      setStep("email-otp");
    }
  }

  const selectedRace = races.find((r) => r.id === raceId);
  const selectedClass = classes.find((c) => c.id === classId);
  const previewStats =
    selectedRace && selectedClass
      ? combineStats(selectedClass.baseStats, selectedRace.statModifiers)
      : null;

  const canCreate =
    Boolean(connectedAddress) &&
    charName.trim().length >= 2 &&
    charName.trim().length <= 24 &&
    Boolean(selectedRace) &&
    Boolean(selectedClass);

  function handleRequestMint() {
    if (!canCreate) return;
    setError(null);
    setStep("payment-char");
  }

  async function handleCreate() {
    if (!connectedAddress || !canCreate) return;
    setError(null);
    setStep("minting");
    try {
      const result = await createCharacter(
        connectedAddress,
        charName.trim(),
        raceId,
        classId
      );
      if ("error" in result) {
        setError(result.error);
        setStep("create-char");
        return;
      }

      const successBase: SuccessData = {
        name: charName.trim(),
        race: selectedRace?.name ?? raceId,
        className: selectedClass?.name ?? classId,
        txHash: result.txHash,
        agentDeploying: true,
      };
      setSuccessData(successBase);
      setStep("success");

      // Deploy agent in the background
      try {
        const token = await getAuthToken(connectedAddress);
        if (token) {
          const deployRes = await fetch(`${API_URL}/agent/deploy`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              walletAddress: connectedAddress,
              characterName: charName.trim(),
              raceId,
              classId,
            }),
          });
          const deployData = await deployRes.json();
          if (deployRes.ok) {
            setSuccessData({
              ...successBase,
              agentDeploying: false,
              agentEntityId: deployData.entityId,
              agentZoneId: deployData.zoneId,
            });
          } else {
            setSuccessData({ ...successBase, agentDeploying: false, agentError: deployData.error });
          }
        }
      } catch (deployErr: any) {
        setSuccessData({ ...successBase, agentDeploying: false, agentError: deployErr.message });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Minting failed. Please try again.");
      setStep("create-char");
    }
  }

  // Shared wrapper style
  const panelCls =
    "w-full max-w-sm border-4 border-[#54f28b] bg-[#060d12] shadow-[8px_8px_0_0_#000] font-mono";

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={panelCls}>
        {/* Header bar */}
        <div className="flex items-center justify-between border-b-2 border-[#54f28b] bg-[#0a1a0e] px-4 py-2">
          <span className="text-[9px] uppercase tracking-widest text-[#54f28b]">
            {step === "login" || step === "email-input" || step === "email-otp"
              ? ">> ENTER THE WORLD <<"
              : step === "connecting"
              ? ">> AUTHENTICATING..."
              : step === "create-char"
              ? ">> CREATE CHARACTER"
              : step === "payment-char"
              ? ">> CHARACTER MINT FEE"
              : step === "minting"
              ? ">> MINTING NFT..."
              : ">> CHARACTER CREATED!"}
          </span>
          <button
            onClick={onClose}
            className="text-[10px] text-[#54f28b] hover:text-[#ffcc00] transition-colors"
          >
            [X]
          </button>
        </div>

        <div className="p-5">
          {/* ── STEP: LOGIN ── */}
          {(step === "login") && (
            <div className="flex flex-col gap-3">
              <p className="text-[8px] leading-relaxed text-[#9aa7cc] mb-1">
                Sign in instantly — no wallet extension needed. Your account is
                secured by thirdweb in-app wallets.
              </p>
              {SOCIAL_PROVIDERS.map((p) => (
                <button
                  key={p.strategy}
                  onClick={() => void connectSocial(p.strategy)}
                  className="flex w-full items-center gap-3 border-2 border-[#2a3450] bg-[#0e1628] px-4 py-3 text-left text-[10px] text-[#d6deff] shadow-[3px_3px_0_0_#000] transition hover:border-[#54f28b] hover:text-[#54f28b] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0_0_#000]"
                >
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center border text-[9px] font-bold"
                    style={{ borderColor: p.color, color: p.color }}
                  >
                    {p.icon}
                  </span>
                  <span>Login with {p.label}</span>
                  <span className="ml-auto text-[7px] text-[#3a4260]">[→]</span>
                </button>
              ))}

              <div className="flex items-center gap-2 my-1">
                <div className="flex-1 border-t border-[#2a3450]" />
                <span className="text-[7px] text-[#3a4260]">OR</span>
                <div className="flex-1 border-t border-[#2a3450]" />
              </div>

              <button
                onClick={() => { setError(null); setStep("email-input"); }}
                className="flex w-full items-center gap-3 border-2 border-[#2a3450] bg-[#0e1628] px-4 py-3 text-left text-[10px] text-[#d6deff] shadow-[3px_3px_0_0_#000] transition hover:border-[#ffcc00] hover:text-[#ffcc00] active:translate-x-[1px] active:translate-y-[1px]"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center border border-[#ffcc00] text-[9px] font-bold text-[#ffcc00]">
                  @
                </span>
                <span>Continue with Email</span>
                <span className="ml-auto text-[7px] text-[#3a4260]">[→]</span>
              </button>

              {error && (
                <p className="mt-1 text-[8px] text-[#ff4d6d] border border-[#ff4d6d] px-3 py-2 bg-[#1a0a0e]">
                  [ERR] {error}
                </p>
              )}
            </div>
          )}

          {/* ── STEP: EMAIL INPUT ── */}
          {step === "email-input" && (
            <div className="flex flex-col gap-3">
              <p className="text-[8px] text-[#9aa7cc]">
                Enter your email address to receive a verification code.
              </p>
              <input
                type="email"
                placeholder="agent@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void sendEmailOtp(); }}
                className="w-full border-2 border-[#2a3450] bg-[#0b1020] px-3 py-2 text-[10px] text-[#d6deff] placeholder-[#3a4260] outline-none focus:border-[#54f28b]"
                autoFocus
              />
              <button
                onClick={() => void sendEmailOtp()}
                disabled={!email.trim() || sendingOtp}
                className="w-full border-2 border-[#54f28b] bg-[#0a1a0e] px-4 py-2 text-[10px] text-[#54f28b] shadow-[3px_3px_0_0_#000] transition hover:bg-[#112a1b] disabled:opacity-40 disabled:cursor-not-allowed active:translate-x-[1px] active:translate-y-[1px]"
              >
                {sendingOtp ? "Sending..." : "[→] Send Code"}
              </button>
              <button
                onClick={() => { setError(null); setStep("login"); }}
                className="text-[8px] text-[#3a4260] hover:text-[#9aa7cc] transition-colors"
              >
                ← Back
              </button>
              {error && (
                <p className="text-[8px] text-[#ff4d6d] border border-[#ff4d6d] px-3 py-2 bg-[#1a0a0e]">
                  [ERR] {error}
                </p>
              )}
            </div>
          )}

          {/* ── STEP: EMAIL OTP ── */}
          {step === "email-otp" && (
            <div className="flex flex-col gap-3">
              <p className="text-[8px] text-[#9aa7cc]">
                Code sent to <span className="text-[#ffcc00]">{email}</span>.
                Check your inbox and enter the 6-digit code.
              </p>
              <input
                type="text"
                inputMode="numeric"
                placeholder="000000"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => { if (e.key === "Enter" && otp.length === 6) void verifyEmailOtp(); }}
                className="w-full border-2 border-[#2a3450] bg-[#0b1020] px-3 py-2 text-center text-[14px] tracking-[0.5em] text-[#ffcc00] placeholder-[#3a4260] outline-none focus:border-[#ffcc00]"
                autoFocus
              />
              <button
                onClick={() => void verifyEmailOtp()}
                disabled={otp.length !== 6}
                className="w-full border-2 border-[#54f28b] bg-[#0a1a0e] px-4 py-2 text-[10px] text-[#54f28b] shadow-[3px_3px_0_0_#000] transition hover:bg-[#112a1b] disabled:opacity-40 disabled:cursor-not-allowed active:translate-x-[1px] active:translate-y-[1px]"
              >
                [→] Verify & Continue
              </button>
              <button
                onClick={() => { setOtp(""); setError(null); setStep("email-input"); }}
                className="text-[8px] text-[#3a4260] hover:text-[#9aa7cc] transition-colors"
              >
                ← Resend / Change email
              </button>
              {error && (
                <p className="text-[8px] text-[#ff4d6d] border border-[#ff4d6d] px-3 py-2 bg-[#1a0a0e]">
                  [ERR] {error}
                </p>
              )}
            </div>
          )}

          {/* ── STEP: CONNECTING ── */}
          {step === "connecting" && (
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="text-[20px] text-[#54f28b] animate-pulse">{">>>"}</div>
              <p className="text-[9px] text-[#9aa7cc]">Authenticating with thirdweb...</p>
              <p className="text-[7px] text-[#3a4260]">A popup window may open. Please allow it.</p>
            </div>
          )}

          {/* ── STEP: CREATE CHARACTER ── */}
          {step === "create-char" && (
            <div className="flex flex-col gap-3">
              {connectedAddress && (
                <div className="text-[7px] text-[#54f28b] border border-[#1a3a22] bg-[#0a1a0e] px-2 py-1">
                  [AUTH] {connectedAddress.slice(0, 8)}...{connectedAddress.slice(-6)}
                </div>
              )}

              {/* Name */}
              <div>
                <label className="mb-1 block text-[8px] text-[#9aa7cc] uppercase tracking-wider">
                  Character Name
                </label>
                <input
                  type="text"
                  placeholder="2–24 characters"
                  value={charName}
                  maxLength={24}
                  onChange={(e) => setCharName(e.target.value)}
                  className="w-full border-2 border-[#2a3450] bg-[#0b1020] px-3 py-2 text-[10px] text-[#d6deff] placeholder-[#3a4260] outline-none focus:border-[#ffcc00]"
                  autoFocus
                />
              </div>

              {/* Race */}
              <div>
                <label className="mb-1 block text-[8px] text-[#9aa7cc] uppercase tracking-wider">
                  Race
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {races.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setRaceId(r.id)}
                      className={`border-2 px-2 py-1.5 text-left text-[8px] transition shadow-[2px_2px_0_0_#000] ${
                        raceId === r.id
                          ? "border-[#ffcc00] bg-[#2a2210] text-[#ffcc00]"
                          : "border-[#2a3450] bg-[#0e1628] text-[#9aa7cc] hover:border-[#54f28b] hover:text-[#54f28b]"
                      }`}
                    >
                      {r.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Class */}
              <div>
                <label className="mb-1 block text-[8px] text-[#9aa7cc] uppercase tracking-wider">
                  Class
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {classes.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setClassId(c.id)}
                      className={`border-2 px-2 py-1.5 text-left text-[8px] transition shadow-[2px_2px_0_0_#000] ${
                        classId === c.id
                          ? "border-[#54f28b] bg-[#0a1a0e] text-[#54f28b]"
                          : "border-[#2a3450] bg-[#0e1628] text-[#9aa7cc] hover:border-[#54f28b] hover:text-[#54f28b]"
                      }`}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Stat preview */}
              {previewStats && (
                <div className="border border-[#2a3450] bg-[#0b1020] px-3 py-2">
                  <p className="mb-1.5 text-[7px] uppercase tracking-wider text-[#3a4260]">
                    Base Stats — {selectedRace?.name} {selectedClass?.name}
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                    <StatRow label="STR" value={previewStats.str ?? 0} />
                    <StatRow label="DEF" value={previewStats.def ?? 0} />
                    <StatRow label="HP" value={previewStats.hp ?? 0} />
                    <StatRow label="AGI" value={previewStats.agi ?? 0} />
                    <StatRow label="INT" value={previewStats.int ?? 0} />
                    <StatRow label="LUCK" value={previewStats.luck ?? 0} />
                  </div>
                </div>
              )}

              {error && (
                <p className="text-[8px] text-[#ff4d6d] border border-[#ff4d6d] px-3 py-2 bg-[#1a0a0e]">
                  [ERR] {error}
                </p>
              )}

              <button
                onClick={handleRequestMint}
                disabled={!canCreate}
                className="mt-1 w-full border-4 border-black bg-[#0a1a0e] px-4 py-3 text-[11px] uppercase tracking-wide text-[#54f28b] shadow-[4px_4px_0_0_#000] transition hover:bg-[#112a1b] disabled:opacity-40 disabled:cursor-not-allowed active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#000]"
              >
                [→] Mint Character — $10
              </button>
            </div>
          )}

          {/* ── STEP: PAYMENT (CHARACTER MINT) ── */}
          {step === "payment-char" && (
            <PaymentGate
              label="Character Mint Fee — one-time $10 to enter World of Geneva"
              onSuccess={() => void handleCreate()}
              onCancel={() => setStep("create-char")}
            />
          )}

          {/* ── STEP: MINTING ── */}
          {step === "minting" && (
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="text-[20px] text-[#ffcc00] animate-pulse">{"$$"}</div>
              <p className="text-[9px] text-[#9aa7cc]">
                Minting your character NFT on SKALE...
              </p>
              <p className="text-[7px] text-[#3a4260]">
                Zero gas fees — powered by sFUEL
              </p>
            </div>
          )}

          {/* ── STEP: SUCCESS ── */}
          {step === "success" && successData && (
            <div className="flex flex-col gap-3">
              <div className="border-2 border-[#54f28b] bg-[#0a1a0e] px-4 py-3">
                <p className="text-[8px] text-[#54f28b] mb-2">[✓] CHARACTER MINTED</p>
                <p
                  className="text-[14px] text-[#ffcc00] mb-0.5"
                  style={{ textShadow: "2px 2px 0 #000" }}
                >
                  {successData.name}
                </p>
                <p className="text-[9px] text-[#d6deff]">
                  {successData.race} · {successData.className} · Level 1
                </p>
                {successData.txHash && (
                  <p className="mt-2 text-[7px] text-[#3a4260] break-all">
                    TX: {successData.txHash.slice(0, 12)}...{successData.txHash.slice(-8)}
                  </p>
                )}
              </div>

              {/* Agent deploy status */}
              {successData.agentDeploying ? (
                <div className="border border-[#2a3450] bg-[#0b1020] px-3 py-2 text-[7px]">
                  <p className="text-[#9aa7cc] animate-pulse mb-1">[{">"}{">"}{">"}] Deploying AI agent...</p>
                  <p className="text-[#565f89]">Creating custodial wallet + spawning character</p>
                </div>
              ) : successData.agentEntityId ? (
                <div className="border border-[#54f28b] bg-[#0a1a0e] px-3 py-2 text-[7px]">
                  <p className="text-[#54f28b] mb-1">[✓] AGENT DEPLOYED</p>
                  <p className="text-[#9aa7cc]">
                    Your AI agent is live in <span className="text-[#ffcc00]">{successData.agentZoneId}</span>
                  </p>
                  <p className="text-[#565f89] mt-1">Chat with it in the world view to give directives.</p>
                </div>
              ) : (
                <div className="border border-[#2a3450] bg-[#0b1020] px-3 py-2 text-[7px] text-[#565f89]">
                  {successData.agentError ? (
                    <p className="text-[#ff4d6d]">[!] Agent deploy skipped: {successData.agentError?.slice(0, 80)}</p>
                  ) : (
                    <>
                      <p className="text-[#9aa7cc] mb-1">Your character NFT is ready.</p>
                      <p>Deploy an AI agent from the world view chat panel.</p>
                    </>
                  )}
                </div>
              )}

              <button
                onClick={() => {
                  onClose();
                  navigate("/world");
                  if (connectedAddress) {
                    setTimeout(() => gameBus.emit("lockToPlayer", { walletAddress: connectedAddress }), 500);
                  }
                }}
                className="w-full border-4 border-black bg-[#54f28b] px-4 py-3 text-[11px] uppercase tracking-wide text-[#060d12] shadow-[4px_4px_0_0_#000] transition hover:bg-[#7bf5a8] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#000] font-bold"
                disabled={successData.agentDeploying}
              >
                {successData.agentDeploying ? "..." : ">>> Enter World <<<"}
              </button>

              <button
                onClick={onClose}
                className="text-[8px] text-[#3a4260] hover:text-[#9aa7cc] transition-colors text-center"
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
