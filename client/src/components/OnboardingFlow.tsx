import * as React from "react";
import { useNavigate } from "react-router-dom";
import { preAuthenticate } from "thirdweb/wallets/in-app";
import { fetchClasses, fetchRaces, createCharacter } from "@/ShardClient";
import { useWalletContext } from "@/context/WalletContext";
import { thirdwebClient, skaleChain, sharedInAppWallet } from "@/lib/inAppWalletClient";
import { getAuthToken } from "@/lib/agentAuth";
import { validateCharacterName } from "@/lib/characterNameValidation";
import { WalletManager } from "@/lib/walletManager";
import { API_URL } from "@/config";
import { gameBus } from "@/lib/eventBus";
import type { OnboardingStartMode } from "@/lib/onboarding";
import {
  queueTutorialMasterIntro,
  warmTutorialMasterPortraitCache,
} from "@/lib/tutorialMaster";
import { PaymentGate } from "@/components/PaymentGate";
import type { RaceInfo, ClassInfo, CharacterStats } from "@/types";
import { CharacterPreview } from "@/components/CharacterPreview";

type SocialStrategy = "google" | "discord" | "x" | "telegram" | "farcaster";
type Step =
  | "login"
  | "email-input"
  | "email-otp"
  | "connecting"
  | "create-char"
  | "payment-char"
  | "minting"
  | "success"
  | "telegram-signup"
  | "done";

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

const SKIN_COLORS = [
  { id: "fair", label: "Fair", hex: "#f5d0a9" },
  { id: "light", label: "Light", hex: "#d4a574" },
  { id: "medium", label: "Medium", hex: "#a67c52" },
  { id: "tan", label: "Tan", hex: "#8d5524" },
  { id: "brown", label: "Brown", hex: "#6b3a2a" },
  { id: "dark", label: "Dark", hex: "#3b1d0e" },
];

const HAIR_STYLES = [
  { id: "short", label: "Short" },
  { id: "long", label: "Long" },
  { id: "braided", label: "Braided" },
  { id: "mohawk", label: "Mohawk" },
  { id: "bald", label: "Bald" },
  { id: "ponytail", label: "Ponytail" },
  { id: "locs", label: "Locs" },
  { id: "afro", label: "Afro" },
  { id: "cornrows", label: "Cornrows" },
  { id: "bantu-knots", label: "Bantu Knots" },
  { id: "bangs", label: "Bangs" },
  { id: "topknot", label: "Top Knot" },
];

const EYE_COLORS = [
  { id: "brown", label: "Brown", hex: "#5c3317" },
  { id: "blue", label: "Blue", hex: "#4a90d9" },
  { id: "green", label: "Green", hex: "#3d8b37" },
  { id: "amber", label: "Amber", hex: "#cf8f2e" },
  { id: "gray", label: "Gray", hex: "#8e8e8e" },
  { id: "violet", label: "Violet", hex: "#8b45a6" },
];

const GENDERS = [
  { id: "male" as const, label: "Male" },
  { id: "female" as const, label: "Female" },
];

const ORIGINS = [
  {
    id: "sunforged",
    label: "Sunforged",
    tone: "Brave",
    desc: "Raised in the holy citadels of Aurandel, sworn to protect the weak. Speaks with conviction and charges headfirst into the unknown.",
  },
  {
    id: "veilborn",
    label: "Veilborn",
    tone: "Cunning",
    desc: "Orphaned in the shadow markets of Nythara, trust is a currency they never spend. Calculates every move, reveals nothing freely.",
  },
  {
    id: "dawnkeeper",
    label: "Dawnkeeper",
    tone: "Warm",
    desc: "Wanderers from the Ember Communes who believe all souls carry light. Disarms with kindness, heals before they fight.",
  },
  {
    id: "ironvow",
    label: "Ironvow",
    tone: "Ruthless",
    desc: "Forged in the gladiator pits beneath Felsrock. Mercy is weakness, victory is the only prayer. Speaks bluntly, strikes without hesitation.",
  },
];

const PLANS = [
  {
    id: "free" as const,
    name: "Free",
    price: "$0",
    period: "",
    border: "#54f28b",
    perks: [
      "4-hour activity summaries",
      "Level-up & death alerts",
      "Basic agent commands",
    ],
  },
  {
    id: "adventurer" as const,
    name: "Adventurer",
    price: "$4.99",
    period: "/mo",
    border: "#5dadec",
    perks: [
      "Everything in Free",
      "Real-time combat alerts",
      "Loot drop notifications",
      "Daily strategy tips from AI",
      "Priority agent response",
    ],
  },
  {
    id: "champion" as const,
    name: "Champion",
    price: "$9.99",
    period: "/mo",
    border: "#ffcc00",
    perks: [
      "Everything in Adventurer",
      "Live minute-by-minute feed",
      "AI strategy coaching",
      "Legendary item drop alerts",
      "Custom alert filters",
      "Early access to new zones",
    ],
  },
];

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className="text-[#9aa7cc]">{label}</span>
      <span className="text-[#ffcc00]">{value}</span>
    </div>
  );
}

interface OnboardingFlowProps {
  onClose: () => void;
  initialMode?: OnboardingStartMode;
}

function modeToStep(mode: OnboardingStartMode): Step {
  return mode === "sign-in" ? "login" : "create-char";
}

export function OnboardingFlow({
  onClose,
  initialMode = "create-character",
}: OnboardingFlowProps): React.ReactElement {
  const navigate = useNavigate();
  const { syncAddress, address: walletAddress, connect } = useWalletContext();
  const signInOnly = initialMode === "sign-in";

  const [step, setStep] = React.useState<Step>(() => modeToStep(initialMode));
  const [error, setError] = React.useState<string | null>(null);
  const [connectedAddress, setConnectedAddress] = React.useState<string | null>(walletAddress);
  const [pendingMintAfterAuth, setPendingMintAfterAuth] = React.useState(false);

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
  const [gender, setGender] = React.useState<"male" | "female" | undefined>(undefined);
  const [skinColor, setSkinColor] = React.useState("");
  const [hairStyle, setHairStyle] = React.useState("");
  const [eyeColor, setEyeColor] = React.useState("");
  const [origin, setOrigin] = React.useState("");
  const [successData, setSuccessData] = React.useState<SuccessData | null>(null);

  // Telegram signup + plan selection
  const [telegramLinked, setTelegramLinked] = React.useState(false);
  const [botLinkUrl, setBotLinkUrl] = React.useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = React.useState<"free" | "adventurer" | "champion">("free");

  // PWA install prompt
  const [pwaInstalled, setPwaInstalled] = React.useState(() =>
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true)
  );
  const [pwaPrompt, setPwaPrompt] = React.useState<any>(null);
  const isIosPwa = typeof navigator !== "undefined" &&
    (/iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

  React.useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); setPwaPrompt(e); };
    window.addEventListener("beforeinstallprompt", handler);
    const mq = window.matchMedia("(display-mode: standalone)");
    const mqHandler = () => setPwaInstalled(mq.matches);
    if (mq.addEventListener) {
      mq.addEventListener("change", mqHandler);
    } else {
      mq.addListener(mqHandler);
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      if (mq.removeEventListener) {
        mq.removeEventListener("change", mqHandler);
      } else {
        mq.removeListener(mqHandler);
      }
    };
  }, []);

  // Sync wallet address into local state when it arrives (e.g. after Connect Wallet)
  React.useEffect(() => {
    if (walletAddress && !connectedAddress) {
      setConnectedAddress(walletAddress);
    }
  }, [walletAddress, connectedAddress]);

  // Load races/classes when entering create-char step
  React.useEffect(() => {
    if (step !== "create-char") return;
    Promise.all([fetchRaces(), fetchClasses()]).then(([r, c]) => {
      setRaces(r);
      setClasses(c);
    });
  }, [step]);

  // Fetch bot link URL when entering telegram-signup
  React.useEffect(() => {
    if (step !== "telegram-signup" || !connectedAddress) return;
    fetch(`${API_URL}/notifications/telegram/bot-link/${connectedAddress}`)
      .then((r) => r.json())
      .then((data) => setBotLinkUrl(data.url ?? null))
      .catch(() => {});
  }, [step, connectedAddress]);

  // Poll for Telegram link status (every 2s, auto-skip after 2 min)
  React.useEffect(() => {
    if (step !== "telegram-signup" || !connectedAddress) return;
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/notifications/telegram/status/${connectedAddress}`);
        const { linked } = await res.json();
        if (linked) setTelegramLinked(true);
      } catch { /* non-fatal */ }
    }, 2000);
    const timeout = setTimeout(() => {
      clearInterval(poll);
      setStep("done");
    }, 120_000);
    return () => { clearInterval(poll); clearTimeout(timeout); };
  }, [step, connectedAddress]);

  // "done" step — close modal and enter world
  React.useEffect(() => {
    if (step !== "done") return;
    onClose();
    navigate("/world");
    let retry: number | null = null;

    if (connectedAddress) {
      void (async () => {
        const trackedWallet = await WalletManager.getInstance().getTrackedWalletAddress();
        const walletToFocus = trackedWallet ?? connectedAddress;
        const zoneId = successData?.agentZoneId;
        let attempts = 0;
        const maxAttempts = 8;

        retry = window.setInterval(() => {
          if (zoneId) {
            gameBus.emit("switchZone", { zoneId });
          }
          gameBus.emit("lockToPlayer", { walletAddress: walletToFocus });
          if (++attempts >= maxAttempts && retry !== null) {
            window.clearInterval(retry);
            retry = null;
          }
        }, 350);
      })();
    }

    return () => {
      if (retry !== null) window.clearInterval(retry);
    };
  }, [connectedAddress, navigate, onClose, step, successData?.agentZoneId]);

  React.useEffect(() => {
    if (step !== "success" || !successData?.agentEntityId) return;
    const timeout = window.setTimeout(() => setStep("done"), 600);
    return () => window.clearTimeout(timeout);
  }, [step, successData?.agentEntityId]);

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

  async function handleAuthSuccess(nextAddress: string, options?: { skipSync?: boolean }) {
    setConnectedAddress(nextAddress);
    if (!options?.skipSync) {
      await syncAddress(nextAddress);
    }
    if (pendingMintAfterAuth) {
      void handleCreate(nextAddress);
      return;
    }
    setStep(signInOnly ? "done" : "create-char");
  }

  const selectedRace = races.find((r) => r.id === raceId);
  const selectedClass = classes.find((c) => c.id === classId);
  const previewStats =
    selectedRace && selectedClass
      ? combineStats(selectedClass.baseStats, selectedRace.statModifiers)
      : null;
  const nameValidationError = validateCharacterName(charName);

  const canCreate =
    !nameValidationError &&
    Boolean(selectedRace) &&
    Boolean(selectedClass) &&
    Boolean(gender) &&
    Boolean(skinColor) &&
    Boolean(hairStyle) &&
    Boolean(eyeColor) &&
    Boolean(origin);

  const missingFields: string[] = [];
  if (!charName.trim()) missingFields.push("Name");
  else if (nameValidationError) missingFields.push("Valid Name");
  if (!selectedRace) missingFields.push("Race");
  if (!selectedClass) missingFields.push("Class");
  if (!gender) missingFields.push("Gender");
  if (!skinColor) missingFields.push("Skin");
  if (!hairStyle) missingFields.push("Hair");
  if (!eyeColor) missingFields.push("Eyes");
  if (!origin) missingFields.push("Origin");

  React.useEffect(() => {
    if (!pendingMintAfterAuth || !connectedAddress || !canCreate || step !== "create-char") return;
    void handleCreate(connectedAddress);
  }, [pendingMintAfterAuth, connectedAddress, canCreate, step]);

  function handleRequestMint() {
    if (nameValidationError) {
      setError(nameValidationError);
      return;
    }
    if (!canCreate) return;
    if (!connectedAddress) {
      setPendingMintAfterAuth(true);
      setError(null);
      setStep("login");
      return;
    }
    setError(null);
    void handleCreate(connectedAddress);
  }

  async function handleCreate(overrideAddress?: string) {
    const targetAddress = overrideAddress ?? connectedAddress;
    if (nameValidationError) {
      setError(nameValidationError);
      setStep("create-char");
      return;
    }
    if (!targetAddress || !canCreate) return;
    setError(null);
    setPendingMintAfterAuth(false);
    setStep("minting");
    try {
      const result = await createCharacter(
        targetAddress,
        charName.trim(),
        raceId,
        classId,
        { gender, skinColor, hairStyle, eyeColor, origin }
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
      queueTutorialMasterIntro();
      void warmTutorialMasterPortraitCache();
      setSuccessData(successBase);
      setStep("success");

      const token = await getAuthToken(targetAddress);
      if (!token) {
        setSuccessData({
          ...successBase,
          agentDeploying: false,
          agentError: "Auth not available",
        });
        return;
      }

      try {
        const deployRes = await fetch(`${API_URL}/agent/deploy`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            walletAddress: targetAddress,
            characterName: charName.trim(),
            raceId,
            classId,
          }),
        });
        const deployData = await deployRes.json();

        if (deployRes.ok) {
          if (deployData.custodialWallet) {
            WalletManager.getInstance().setCustodialAddress(deployData.custodialWallet);
          }
          setSuccessData({
            ...successBase,
            agentDeploying: false,
            agentEntityId: deployData.entityId,
            agentZoneId: deployData.zoneId,
          });
          return;
        }

        setSuccessData({
          ...successBase,
          agentDeploying: false,
          agentError: deployData.error ?? "Agent deploy failed",
        });
      } catch (deployErr) {
        setSuccessData({
          ...successBase,
          agentDeploying: false,
          agentError: deployErr instanceof Error ? deployErr.message : "Agent deploy failed",
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Minting failed. Please try again.");
      setStep("create-char");
    }
  }

  // Shared wrapper style
  const panelCls =
    "w-full max-w-2xl border-4 border-[#54f28b] bg-[#060d12] shadow-[8px_8px_0_0_#000] font-mono";

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`${panelCls} max-h-[90vh] flex flex-col`}>
        {/* Header bar */}
        <div className="flex items-center justify-between border-b-2 border-[#54f28b] bg-[#0a1a0e] px-4 py-2 shrink-0">
          <span className="text-[13px] uppercase tracking-widest text-[#54f28b]">
            {step === "login" || step === "email-input" || step === "email-otp"
              ? ">> SUMMON CHAMPION <<"
              : step === "connecting"
              ? ">> AUTHENTICATING..."
              : step === "create-char"
              ? ">> CREATE CHARACTER"
              : step === "payment-char"
              ? ">> CHARACTER MINT"
              : step === "minting"
              ? ">> MINTING NFT..."
              : step === "telegram-signup"
              ? ">> TELEGRAM UPDATES"
              : ">> CHARACTER CREATED!"}
          </span>
          <button
            onClick={onClose}
            className="text-[14px] text-[#54f28b] hover:text-[#ffcc00] transition-colors"
          >
            [X]
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          {/* ── STEP: LOGIN ── */}
          {(step === "login") && (
            <div className="flex flex-col gap-3">
              <button
                onClick={() => { onClose(); navigate("/world"); }}
                className="flex w-full items-center gap-3 border-2 border-[#54f28b] bg-[#0a1a0e] px-4 py-3 text-left text-[14px] text-[#54f28b] shadow-[3px_3px_0_0_#000] transition hover:bg-[#112a1b] hover:text-[#7bf5a8] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0_0_#000]"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center border border-[#54f28b] text-[13px] font-bold text-[#54f28b]">
                  👁
                </span>
                <div className="flex flex-col">
                  <span>Spectate World</span>
                  <span className="text-[11px] text-[#6d77a3]">Watch without signing in</span>
                </div>
                <span className="ml-auto text-[11px] text-[#6d77a3]">[→]</span>
              </button>

              <div className="flex items-center gap-2 my-1">
                <div className="flex-1 border-t border-[#2a3450]" />
                <span className="text-[11px] text-[#6d77a3]">OR SIGN IN TO SUMMON</span>
                <div className="flex-1 border-t border-[#2a3450]" />
              </div>

              {SOCIAL_PROVIDERS.map((p) => (
                <button
                  key={p.strategy}
                  onClick={() => void connectSocial(p.strategy)}
                  className="flex w-full items-center gap-3 border-2 border-[#2a3450] bg-[#0e1628] px-4 py-3 text-left text-[14px] text-[#d6deff] shadow-[3px_3px_0_0_#000] transition hover:border-[#54f28b] hover:text-[#54f28b] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0_0_#000]"
                >
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center border text-[13px] font-bold"
                    style={{ borderColor: p.color, color: p.color }}
                  >
                    {p.icon}
                  </span>
                  <span>Login with {p.label}</span>
                  <span className="ml-auto text-[11px] text-[#6d77a3]">[→]</span>
                </button>
              ))}

              <div className="flex items-center gap-2 my-1">
                <div className="flex-1 border-t border-[#2a3450]" />
                <span className="text-[11px] text-[#6d77a3]">OR</span>
                <div className="flex-1 border-t border-[#2a3450]" />
              </div>

              <button
                onClick={() => { setError(null); setStep("email-input"); }}
                className="flex w-full items-center gap-3 border-2 border-[#2a3450] bg-[#0e1628] px-4 py-3 text-left text-[14px] text-[#d6deff] shadow-[3px_3px_0_0_#000] transition hover:border-[#ffcc00] hover:text-[#ffcc00] active:translate-x-[1px] active:translate-y-[1px]"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center border border-[#ffcc00] text-[13px] font-bold text-[#ffcc00]">
                  @
                </span>
                <span>Continue with Email</span>
                <span className="ml-auto text-[11px] text-[#6d77a3]">[→]</span>
              </button>

              <div className="flex items-center gap-2 my-1">
                <div className="flex-1 border-t border-[#2a3450]" />
                <span className="text-[11px] text-[#6d77a3]">OR</span>
                <div className="flex-1 border-t border-[#2a3450]" />
              </div>

              <button
                onClick={async () => {
                  setError(null);
                  setStep("connecting");
                  try {
                    await connect();
                    const nextAddress = WalletManager.getInstance().address;
                    if (!nextAddress) {
                      setStep("login");
                      return;
                    }
                    await handleAuthSuccess(nextAddress, { skipSync: true });
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Wallet connection failed.");
                    setStep("login");
                  }
                }}
                className="flex w-full items-center gap-3 border-2 border-[#54f28b] bg-[#0a1a0e] px-4 py-2 text-left text-[13px] text-[#54f28b] shadow-[3px_3px_0_0_#000] transition hover:bg-[#112a1b] active:translate-x-[1px] active:translate-y-[1px]"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center border border-[#54f28b] text-[13px] font-bold text-[#54f28b]">
                  W
                </span>
                <div className="flex flex-col">
                  <span>Browse Wallets</span>
                  <span className="text-[10px] text-[#6d77a3]">MetaMask, Rabby, Rainbow, Coinbase, WalletConnect, more</span>
                </div>
                <span className="ml-auto text-[11px] text-[#6d77a3]">[→]</span>
              </button>

              {pendingMintAfterAuth && (
                <button
                  onClick={() => {
                    setPendingMintAfterAuth(false);
                    setError(null);
                    setStep("create-char");
                  }}
                  className="text-[12px] text-[#6d77a3] hover:text-[#9aa7cc] transition-colors"
                >
                  ← Back to Character Builder
                </button>
              )}

              {error && (
                <p className="mt-1 text-[12px] text-[#ff4d6d] border border-[#ff4d6d] px-3 py-2 bg-[#1a0a0e]">
                  [ERR] {error}
                </p>
              )}
            </div>
          )}

          {/* ── STEP: EMAIL INPUT ── */}
          {step === "email-input" && (
            <div className="flex flex-col gap-3">
              <p className="text-[12px] text-[#9aa7cc]">
                Enter your email address to receive a verification code.
              </p>
              <input
                type="email"
                placeholder="agent@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void sendEmailOtp(); }}
                className="w-full border-2 border-[#2a3450] bg-[#0b1020] px-3 py-2 text-[14px] text-[#d6deff] placeholder-[#6d77a3] outline-none focus:border-[#54f28b]"
                autoFocus
              />
              <button
                onClick={() => void sendEmailOtp()}
                disabled={!email.trim() || sendingOtp}
                className="w-full border-2 border-[#54f28b] bg-[#0a1a0e] px-4 py-2 text-[14px] text-[#54f28b] shadow-[3px_3px_0_0_#000] transition hover:bg-[#112a1b] disabled:opacity-40 disabled:cursor-not-allowed active:translate-x-[1px] active:translate-y-[1px]"
              >
                {sendingOtp ? "Sending..." : "[→] Send Code"}
              </button>
              <button
                onClick={() => { setError(null); setStep("login"); }}
                className="text-[12px] text-[#6d77a3] hover:text-[#9aa7cc] transition-colors"
              >
                ← Back
              </button>
              {error && (
                <p className="text-[12px] text-[#ff4d6d] border border-[#ff4d6d] px-3 py-2 bg-[#1a0a0e]">
                  [ERR] {error}
                </p>
              )}
            </div>
          )}

          {/* ── STEP: EMAIL OTP ── */}
          {step === "email-otp" && (
            <div className="flex flex-col gap-3">
              <p className="text-[12px] text-[#9aa7cc]">
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
                className="w-full border-2 border-[#2a3450] bg-[#0b1020] px-3 py-2 text-center text-[16px] tracking-[0.5em] text-[#ffcc00] placeholder-[#6d77a3] outline-none focus:border-[#ffcc00]"
                autoFocus
              />
              <button
                onClick={() => void verifyEmailOtp()}
                disabled={otp.length !== 6}
                className="w-full border-2 border-[#54f28b] bg-[#0a1a0e] px-4 py-2 text-[14px] text-[#54f28b] shadow-[3px_3px_0_0_#000] transition hover:bg-[#112a1b] disabled:opacity-40 disabled:cursor-not-allowed active:translate-x-[1px] active:translate-y-[1px]"
              >
                [→] Verify & Continue
              </button>
              <button
                onClick={() => { setOtp(""); setError(null); setStep("email-input"); }}
                className="text-[12px] text-[#6d77a3] hover:text-[#9aa7cc] transition-colors"
              >
                ← Resend / Change email
              </button>
              {error && (
                <p className="text-[12px] text-[#ff4d6d] border border-[#ff4d6d] px-3 py-2 bg-[#1a0a0e]">
                  [ERR] {error}
                </p>
              )}
            </div>
          )}

          {/* ── STEP: CONNECTING ── */}
          {step === "connecting" && (
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="text-[22px] text-[#54f28b] animate-pulse">{">>>"}</div>
              <p className="text-[13px] text-[#9aa7cc]">Authenticating with thirdweb...</p>
              <p className="text-[11px] text-[#6d77a3]">A popup window may open. Please allow it.</p>
            </div>
          )}

          {/* ── STEP: CREATE CHARACTER ── */}
          {step === "create-char" && (
            <div className="flex flex-col gap-3">
              {connectedAddress && (
                <div className="text-[11px] text-[#54f28b] border border-[#1a3a22] bg-[#0a1a0e] px-2 py-1">
                  [AUTH] {connectedAddress.slice(0, 8)}...{connectedAddress.slice(-6)}
                </div>
              )}

              {/* Top row: Preview + Name/Race/Class */}
              <div className="flex gap-3">
                {/* Character preview with zone frame */}
                <div className="shrink-0 flex flex-col items-center">
                  <div className="border-2 border-[#2a3450] bg-gradient-to-b from-[#0f1a2e] via-[#0b1424] to-[#162210] p-3 relative">
                    <CharacterPreview
                      skinColor={skinColor || "medium"}
                      eyeColor={eyeColor || "brown"}
                      hairStyle={hairStyle || "short"}
                      classId={classId || "warrior"}
                    />
                    {/* Ground decoration */}
                    <div className="absolute bottom-0 left-0 right-0 h-3 bg-gradient-to-t from-[#1a2a10] to-transparent" />
                  </div>
                  <div className="border-2 border-t-0 border-[#2a3450] bg-[#0a1a0e] px-3 py-1 w-full text-center">
                    <span className="text-[9px] text-[#6d77a3] uppercase tracking-wider">Spawns in</span>
                    <p className="text-[11px] text-[#54f28b] font-bold">Village Square</p>
                    <span className="text-[9px] text-[#6d77a3]">Level 1 Zone</span>
                  </div>
                </div>

                {/* Right side: Name + Race/Class */}
                <div className="flex-1 flex flex-col gap-2 min-w-0">
                  {/* Name */}
                  <div>
                    <label className="mb-1 block text-[11px] text-[#9aa7cc] uppercase tracking-wider">
                      Character Name
                    </label>
                    <input
                      type="text"
                      placeholder="2–24 characters"
                      value={charName}
                      maxLength={24}
                      onChange={(e) => {
                        setCharName(e.target.value);
                        if (error) setError(null);
                      }}
                      className="w-full border-2 border-[#2a3450] bg-[#0b1020] px-3 py-1.5 text-[13px] text-[#d6deff] placeholder-[#6d77a3] outline-none focus:border-[#ffcc00]"
                      autoFocus
                    />
                    {nameValidationError && charName.trim().length > 0 && (
                      <p className="mt-1 text-[11px] text-[#ff4d6d]">[ERR] {nameValidationError}</p>
                    )}
                  </div>

                  {/* Race */}
                  <div>
                    <label className="mb-1 block text-[11px] text-[#9aa7cc] uppercase tracking-wider">
                      Race
                    </label>
                    <div className="grid grid-cols-2 gap-1">
                      {races.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => setRaceId(r.id)}
                          className={`border-2 px-2 py-1 text-left text-[11px] transition shadow-[2px_2px_0_0_#000] ${
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
                    <label className="mb-1 block text-[11px] text-[#9aa7cc] uppercase tracking-wider">
                      Class
                    </label>
                    <div className="grid grid-cols-2 gap-1">
                      {classes.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => setClassId(c.id)}
                          className={`border-2 px-2 py-1 text-left text-[11px] transition shadow-[2px_2px_0_0_#000] ${
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

                  {/* Gender */}
                  <div>
                    <label className="mb-1 block text-[11px] text-[#9aa7cc] uppercase tracking-wider">
                      Gender
                    </label>
                    <div className="grid grid-cols-2 gap-1">
                      {GENDERS.map((option) => (
                        <button
                          key={option.id}
                          onClick={() => setGender(option.id)}
                          className={`border-2 px-2 py-1 text-left text-[11px] transition shadow-[2px_2px_0_0_#000] ${
                            gender === option.id
                              ? "border-[#ffcc00] bg-[#2a2210] text-[#ffcc00]"
                              : "border-[#2a3450] bg-[#0e1628] text-[#9aa7cc] hover:border-[#54f28b] hover:text-[#54f28b]"
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Selected class/race description */}
              {(selectedClass || selectedRace) && (
                <div className="border border-[#2a3450] bg-[#0b1020] px-3 py-1.5 text-[10px] text-[#8b95c2]">
                  {selectedRace && <p><span className="text-[#ffcc00]">{selectedRace.name}:</span> {selectedRace.description}</p>}
                  {selectedClass && <p className={selectedRace ? "mt-1" : ""}><span className="text-[#54f28b]">{selectedClass.name}:</span> {selectedClass.description}</p>}
                </div>
              )}

              {/* Appearance row: Skin + Eyes + Hair */}
              <div className="grid grid-cols-3 gap-3">
                {/* Skin Color */}
                <div>
                  <label className="mb-1 block text-[11px] text-[#9aa7cc] uppercase tracking-wider">
                    Skin
                  </label>
                  <div className="grid grid-cols-3 gap-1">
                    {SKIN_COLORS.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setSkinColor(s.id)}
                        className={`h-8 border-2 transition flex items-end justify-center pb-0.5 ${
                          skinColor === s.id
                            ? "border-[#ffcc00] ring-1 ring-[#ffcc00]"
                            : "border-[#2a3450] hover:border-[#54f28b]"
                        }`}
                        style={{ backgroundColor: s.hex }}
                      >
                        <span className="text-[8px] font-bold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                          {s.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Eye Color */}
                <div>
                  <label className="mb-1 block text-[11px] text-[#9aa7cc] uppercase tracking-wider">
                    Eyes
                  </label>
                  <div className="grid grid-cols-3 gap-1">
                    {EYE_COLORS.map((e) => (
                      <button
                        key={e.id}
                        onClick={() => setEyeColor(e.id)}
                        className={`h-8 border-2 transition flex items-end justify-center pb-0.5 ${
                          eyeColor === e.id
                            ? "border-[#ffcc00] ring-1 ring-[#ffcc00]"
                            : "border-[#2a3450] hover:border-[#54f28b]"
                        }`}
                        style={{ backgroundColor: e.hex }}
                      >
                        <span className="text-[8px] font-bold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                          {e.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Hair Style */}
                <div>
                  <label className="mb-1 block text-[11px] text-[#9aa7cc] uppercase tracking-wider">
                    Hair
                  </label>
                  <div className="grid grid-cols-2 gap-1 max-h-[136px] overflow-y-auto pr-0.5">
                    {HAIR_STYLES.map((h) => (
                      <button
                        key={h.id}
                        onClick={() => setHairStyle(h.id)}
                        className={`border-2 px-1 py-0.5 text-center text-[9px] transition ${
                          hairStyle === h.id
                            ? "border-[#ffcc00] bg-[#2a2210] text-[#ffcc00]"
                            : "border-[#2a3450] bg-[#0e1628] text-[#9aa7cc] hover:border-[#54f28b] hover:text-[#54f28b]"
                        }`}
                      >
                        {h.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Origin */}
              <div>
                <label className="mb-1 block text-[11px] text-[#9aa7cc] uppercase tracking-wider">
                  Origin
                </label>
                <div className="grid grid-cols-2 gap-1">
                  {ORIGINS.map((o) => (
                    <button
                      key={o.id}
                      onClick={() => setOrigin(o.id)}
                      className={`border-2 px-2 py-1.5 text-left transition ${
                        origin === o.id
                          ? "border-[#ffcc00] bg-[#2a2210]"
                          : "border-[#2a3450] bg-[#0e1628] hover:border-[#54f28b]"
                      }`}
                    >
                      <span className={`text-[11px] font-bold ${origin === o.id ? "text-[#ffcc00]" : "text-[#d6deff]"}`}>
                        {o.label}
                      </span>
                      <span className="text-[9px] text-[#6d77a3] ml-1">/ {o.tone}</span>
                      {origin === o.id && (
                        <p className="text-[9px] text-[#8b95c2] mt-0.5 leading-tight">{o.desc}</p>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Stat preview */}
              {previewStats && (
                <div className="border border-[#2a3450] bg-[#0b1020] px-3 py-1.5">
                  <p className="mb-1 text-[10px] uppercase tracking-wider text-[#6d77a3]">
                    Stats — {selectedRace?.name} {selectedClass?.name}
                  </p>
                  <div className="grid grid-cols-3 gap-x-3 gap-y-0">
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
                <p className="text-[12px] text-[#ff4d6d] border border-[#ff4d6d] px-3 py-2 bg-[#1a0a0e]">
                  [ERR] {error}
                </p>
              )}

              <button
                onClick={handleRequestMint}
                disabled={!canCreate}
                className="w-full border-4 border-black bg-[#0a1a0e] px-4 py-2.5 text-[13px] uppercase tracking-wide text-[#54f28b] shadow-[4px_4px_0_0_#000] transition hover:bg-[#112a1b] disabled:opacity-40 disabled:cursor-not-allowed active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#000]"
              >
                {canCreate
                  ? connectedAddress
                    ? "[→] Mint Character — $0.00"
                    : "[→] Sign In to Mint Character"
                  : `Select: ${missingFields.join(", ")}`}
              </button>
            </div>
          )}

          {/* ── STEP: PAYMENT (CHARACTER MINT) ── */}
          {step === "payment-char" && (
            <PaymentGate
              label="Character Mint Fee — one-time $2 USDC to enter World of Geneva"
              amount="2"
              onSuccess={() => void handleCreate()}
              onCancel={() => setStep("create-char")}
            />
          )}

          {/* ── STEP: MINTING ── */}
          {step === "minting" && (
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="text-[22px] text-[#ffcc00] animate-pulse">{"$$"}</div>
              <p className="text-[13px] text-[#9aa7cc]">
                Minting your character NFT on SKALE...
              </p>
              <p className="text-[11px] text-[#6d77a3]">
                Zero gas fees — powered by sFUEL
              </p>
            </div>
          )}

          {/* ── STEP: SUCCESS ── */}
          {step === "success" && successData && (
            <div className="flex flex-col gap-3">
              <div className="border-2 border-[#54f28b] bg-[#0a1a0e] px-4 py-3">
                <p className="text-[12px] text-[#54f28b] mb-2">[✓] CHARACTER MINTED</p>
                <p
                  className="text-[16px] text-[#ffcc00] mb-0.5"
                  style={{ textShadow: "2px 2px 0 #000" }}
                >
                  {successData.name}
                </p>
                <p className="text-[13px] text-[#d6deff]">
                  {successData.race} · {successData.className} · Level 1
                </p>
                {successData.txHash && (
                  <p className="mt-2 text-[11px] text-[#6d77a3] break-all">
                    TX: {successData.txHash.slice(0, 12)}...{successData.txHash.slice(-8)}
                  </p>
                )}
              </div>

              {/* Agent deploy status */}
              {successData.agentDeploying ? (
                <div className="border border-[#2a3450] bg-[#0b1020] px-3 py-2 text-[11px]">
                  <p className="text-[#9aa7cc] animate-pulse mb-1">[{">"}{">"}{">"}] Deploying AI agent...</p>
                  <p className="text-[#8b95c2]">Creating custodial wallet + spawning character</p>
                </div>
              ) : successData.agentEntityId ? (
                <div className="border border-[#54f28b] bg-[#0a1a0e] px-3 py-2 text-[11px]">
                  <p className="text-[#54f28b] mb-1">[✓] AGENT DEPLOYED</p>
                  <p className="text-[#9aa7cc]">
                    Your AI agent is live in <span className="text-[#ffcc00]">{successData.agentZoneId}</span>
                  </p>
                  <p className="text-[#8b95c2] mt-1">Chat with it in the world view to give directives.</p>
                </div>
              ) : (
                <div className="border border-[#2a3450] bg-[#0b1020] px-3 py-2 text-[11px] text-[#8b95c2]">
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
                onClick={() => setStep("telegram-signup")}
                className="w-full border-4 border-black bg-[#54f28b] px-4 py-3 text-[13px] uppercase tracking-wide text-[#060d12] shadow-[4px_4px_0_0_#000] transition hover:bg-[#7bf5a8] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#000] font-bold"
                disabled={successData.agentDeploying}
              >
                {successData.agentDeploying ? "..." : "Continue →"}
              </button>

              <button
                onClick={() => setStep("done")}
                className="text-[12px] text-[#6d77a3] hover:text-[#9aa7cc] transition-colors text-center"
              >
                Skip &amp; Enter World
              </button>
            </div>
          )}
          {/* ── STEP: TELEGRAM SIGNUP + PLAN ── */}
          {step === "telegram-signup" && (
            <div className="flex flex-col gap-3">
              {/* Plan selection */}
              <p className="text-[12px] leading-relaxed text-[#9aa7cc]">
                Choose your Telegram alerts plan. Upgrade anytime.
              </p>

              <div className="grid grid-cols-3 gap-2">
                {PLANS.map((plan) => {
                  const isSelected = selectedPlan === plan.id;
                  return (
                    <button
                      key={plan.id}
                      onClick={() => setSelectedPlan(plan.id)}
                      className={`border-2 px-2 py-2 text-left transition flex flex-col ${
                        isSelected
                          ? "bg-[#0a1a0e] shadow-[3px_3px_0_0_#000]"
                          : "border-[#2a3450] bg-[#0e1628] hover:border-[#54f28b]"
                      }`}
                      style={isSelected ? { borderColor: plan.border } : undefined}
                    >
                      <div className="flex items-baseline gap-1 mb-1">
                        <span
                          className="text-[13px] font-bold"
                          style={{ color: isSelected ? plan.border : "#d6deff" }}
                        >
                          {plan.price}
                        </span>
                        {plan.period && (
                          <span className="text-[9px] text-[#6d77a3]">{plan.period}</span>
                        )}
                      </div>
                      <span
                        className="text-[10px] font-bold mb-1.5"
                        style={{ color: isSelected ? plan.border : "#9aa7cc" }}
                      >
                        {plan.name}
                      </span>
                      <div className="flex flex-col gap-0.5">
                        {plan.perks.map((perk, i) => (
                          <span
                            key={i}
                            className={`text-[8px] leading-tight ${
                              isSelected ? "text-[#9aa7cc]" : "text-[#6d77a3]"
                            }`}
                          >
                            {perk}
                          </span>
                        ))}
                      </div>
                      {isSelected && (
                        <div
                          className="mt-2 text-[8px] font-bold uppercase tracking-wider text-center py-0.5 border-t"
                          style={{ color: plan.border, borderColor: plan.border + "40" }}
                        >
                          Selected
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Telegram connection */}
              {!telegramLinked ? (
                <>
                  {botLinkUrl ? (
                    <a
                      href={botLinkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex w-full items-center justify-center gap-2 border-2 border-[#26a5e4] bg-[#0a1020] px-4 py-3 text-[14px] text-[#26a5e4] shadow-[3px_3px_0_0_#000] transition hover:bg-[#0e1830] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0_0_#000]"
                    >
                      <span className="flex h-5 w-5 items-center justify-center border border-[#26a5e4] text-[13px] font-bold">T</span>
                      Connect Telegram
                      <span className="ml-auto text-[11px] text-[#6d77a3]">[→]</span>
                    </a>
                  ) : (
                    <div className="border-2 border-[#2a3450] bg-[#0b1020] px-4 py-3 text-[12px] text-[#8b95c2] text-center">
                      Telegram bot not configured
                    </div>
                  )}

                  <div className="flex items-center gap-2 text-[11px] text-[#8b95c2]">
                    <span className="animate-pulse">&bull;</span>
                    <span className="animate-pulse" style={{ animationDelay: "0.3s" }}>&bull;</span>
                    <span className="opacity-30">&bull;</span>
                    <span className="ml-1">Waiting for connection...</span>
                  </div>

                  {/* ── PWA Install CTA ── */}
                  {!pwaInstalled && isIosPwa && (
                    <div className="border-2 border-[#2a3450] bg-[#0b1020] px-3 py-3">
                      <p className="text-[11px] text-[#ffcc00] font-bold mb-1">[ INSTALL APP ]</p>
                      <p className="text-[10px] text-[#9aa7cc] leading-relaxed mb-2">
                        Get push alerts for level-ups &amp; deaths. Tap{" "}
                        <span className="text-white font-bold">Share ⬆</span> then{" "}
                        <span className="text-white font-bold">Add to Home Screen</span>.
                      </p>
                      <div className="flex items-center gap-2 text-[10px] text-[#6d77a3]">
                        <span className="text-[16px]">⬆</span>
                        <span>Safari → Share → Add to Home Screen</span>
                      </div>
                    </div>
                  )}
                  {pwaInstalled ? (
                    <div className="border-2 border-[#54f28b] bg-[#0a1a0e] px-3 py-2 flex items-center gap-2">
                      <span className="text-[#54f28b] text-[12px]">[✓]</span>
                      <p className="text-[11px] text-[#54f28b]">App installed — push notifications enabled</p>
                    </div>
                  ) : !isIosPwa && (
                    <button
                      onClick={async () => {
                        if (!pwaPrompt) return;
                        pwaPrompt.prompt();
                        const { outcome } = await pwaPrompt.userChoice;
                        if (outcome === "accepted") { setPwaInstalled(true); setPwaPrompt(null); }
                      }}
                      disabled={!pwaPrompt}
                      className={`w-full border-2 px-4 py-2.5 text-[12px] uppercase tracking-wide font-bold transition flex items-center justify-center gap-2 ${
                        pwaPrompt
                          ? "border-[#ffcc00] bg-[#0f1a08] text-[#ffcc00] hover:bg-[#1a2a10] shadow-[3px_3px_0_0_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0_0_#000]"
                          : "border-[#2a3450] bg-[#0b1020] text-[#3d4a6a] cursor-not-allowed"
                      }`}
                    >
                      <span className="text-[16px]">⬇</span>
                      {pwaPrompt ? "Install App for Notifications" : "Open in Chrome/Edge to Install"}
                    </button>
                  )}

                  <button
                    onClick={() => setStep("done")}
                    className="text-[12px] text-[#6d77a3] hover:text-[#9aa7cc] transition-colors text-center"
                  >
                    Skip →
                  </button>
                </>
              ) : (
                <>
                  <div className="border-2 border-[#54f28b] bg-[#0a1a0e] px-3 py-2">
                    <p className="text-[12px] text-[#54f28b]">[✓] Telegram Connected</p>
                  </div>

                  {/* ── PWA Install CTA (after Telegram connected) ── */}
                  {!pwaInstalled && isIosPwa && (
                    <div className="border-2 border-[#2a3450] bg-[#0b1020] px-3 py-3">
                      <p className="text-[11px] text-[#ffcc00] font-bold mb-1">[ INSTALL APP ]</p>
                      <p className="text-[10px] text-[#9aa7cc] leading-relaxed mb-2">
                        Also install the app for push alerts even when offline. Tap{" "}
                        <span className="text-white font-bold">Share ⬆</span> →{" "}
                        <span className="text-white font-bold">Add to Home Screen</span>.
                      </p>
                    </div>
                  )}
                  {!pwaInstalled && !isIosPwa && pwaPrompt && (
                    <button
                      onClick={async () => {
                        pwaPrompt.prompt();
                        const { outcome } = await pwaPrompt.userChoice;
                        if (outcome === "accepted") { setPwaInstalled(true); setPwaPrompt(null); }
                      }}
                      className="w-full border-2 border-[#ffcc00] bg-[#0f1a08] px-4 py-2.5 text-[12px] uppercase tracking-wide font-bold text-[#ffcc00] shadow-[3px_3px_0_0_#000] transition hover:bg-[#1a2a10] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0_0_#000] flex items-center justify-center gap-2"
                    >
                      <span className="text-[16px]">⬇</span>
                      Install App for Push Notifications
                    </button>
                  )}
                  {pwaInstalled && (
                    <div className="border-2 border-[#54f28b] bg-[#0a1a0e] px-3 py-2 flex items-center gap-2">
                      <span className="text-[#54f28b] text-[12px]">[✓]</span>
                      <p className="text-[11px] text-[#54f28b]">App installed — push notifications ready</p>
                    </div>
                  )}

                  <button
                    onClick={() => setStep("done")}
                    className="w-full border-4 border-black bg-[#54f28b] px-4 py-3 text-[13px] uppercase tracking-wide text-[#060d12] shadow-[4px_4px_0_0_#000] transition hover:bg-[#7bf5a8] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#000] font-bold"
                  >
                    {selectedPlan === "free"
                      ? "Enter World →"
                      : `Subscribe & Enter — ${PLANS.find((p) => p.id === selectedPlan)?.price}/mo`}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
