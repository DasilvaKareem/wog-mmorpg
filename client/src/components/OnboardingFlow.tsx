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
  trackUserSignedUp,
  trackCharacterCreated,
  trackAgentTaskStarted,
  trackAgentTaskCompleted,
} from "@/lib/analytics";
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

type CreateCharacterStep = "identity" | "appearance" | "review";

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

const CREATE_CHARACTER_STEPS: { id: CreateCharacterStep; label: string; shortLabel: string }[] = [
  { id: "identity", label: "Identity", shortLabel: "1" },
  { id: "appearance", label: "Appearance", shortLabel: "2" },
  { id: "review", label: "Origin + Review", shortLabel: "3" },
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
  const contentRef = React.useRef<HTMLDivElement | null>(null);

  const [step, setStep] = React.useState<Step>(() => modeToStep(initialMode));
  const [createCharacterStep, setCreateCharacterStep] = React.useState<CreateCharacterStep>("identity");
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
  const [isCompactLayout, setIsCompactLayout] = React.useState(() =>
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 767px), (pointer: coarse)").matches
  );
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

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    const query = window.matchMedia("(max-width: 767px), (pointer: coarse)");
    const onChange = () => setIsCompactLayout(query.matches);
    onChange();

    if (query.addEventListener) {
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    }

    query.addListener(onChange);
    return () => query.removeListener(onChange);
  }, []);

  React.useEffect(() => {
    if (!isCompactLayout || step !== "create-char") return;
    contentRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [createCharacterStep, isCompactLayout, step]);

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

  // No auto-advance — let the user click Continue at their own pace.

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
    trackUserSignedUp("onboarding", nextAddress);
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

  const identityMissing: string[] = [];
  if (!charName.trim()) identityMissing.push("Name");
  else if (nameValidationError) identityMissing.push("Valid Name");
  if (!selectedRace) identityMissing.push("Race");
  if (!selectedClass) identityMissing.push("Class");
  if (!gender) identityMissing.push("Gender");

  const appearanceMissing: string[] = [];
  if (!skinColor) appearanceMissing.push("Skin");
  if (!hairStyle) appearanceMissing.push("Hair");
  if (!eyeColor) appearanceMissing.push("Eyes");

  const reviewMissing: string[] = [];
  if (!origin) reviewMissing.push("Origin");

  const identityComplete = identityMissing.length === 0;
  const appearanceComplete = appearanceMissing.length === 0;
  const reviewComplete = reviewMissing.length === 0;

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
      trackCharacterCreated({
        name: charName.trim(),
        race: selectedRace?.name ?? raceId,
        class: selectedClass?.name ?? classId,
        origin,
        walletAddress: targetAddress!,
      });
      gameBus.emit("charactersChanged", { walletAddress: targetAddress });
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
        trackAgentTaskStarted({ walletAddress: targetAddress!, characterName: charName.trim() });
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
          trackAgentTaskCompleted({ walletAddress: targetAddress!, entityId: deployData.entityId, zoneId: deployData.zoneId });
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

  const remainingSelections = missingFields.length;
  const currentCreateCharacterStepIndex = CREATE_CHARACTER_STEPS.findIndex((item) => item.id === createCharacterStep);
  const currentCreateCharacterStep = CREATE_CHARACTER_STEPS[currentCreateCharacterStepIndex] ?? CREATE_CHARACTER_STEPS[0];
  const currentStepMissing =
    createCharacterStep === "identity"
      ? identityMissing
      : createCharacterStep === "appearance"
      ? appearanceMissing
      : reviewMissing;
  const currentStepComplete =
    createCharacterStep === "identity"
      ? identityComplete
      : createCharacterStep === "appearance"
      ? appearanceComplete
      : reviewComplete;
  const nextCreateCharacterStep = CREATE_CHARACTER_STEPS[currentCreateCharacterStepIndex + 1] ?? null;
  const title =
    step === "login" || step === "email-input" || step === "email-otp"
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
      : ">> CHARACTER CREATED!";

  const panelCls = [
    "w-full border-4 border-[#54f28b] bg-[#060d12] font-mono shadow-[8px_8px_0_0_#000]",
    isCompactLayout
      ? "h-[100dvh] max-w-none rounded-none border-x-0 border-b-0 shadow-none"
      : "max-w-2xl max-h-[90vh]",
  ].join(" ");

  return (
    <div
      className={`fixed inset-0 z-[200] flex bg-black/80 ${isCompactLayout ? "items-end justify-stretch px-0" : "items-center justify-center px-4"}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`${panelCls} flex flex-col`}>
        {/* Header bar */}
        <div className={`flex items-center justify-between border-b-2 border-[#54f28b] bg-[#0a1a0e] shrink-0 ${isCompactLayout ? "sticky top-0 z-20 px-3 py-3" : "px-4 py-2"}`}>
          <div className="min-w-0">
            <span className={`${isCompactLayout ? "text-[12px]" : "text-[13px]"} block truncate uppercase tracking-widest text-[#54f28b]`}>
              {title}
            </span>
            {step === "create-char" && isCompactLayout ? (
              <span className="mt-1 block text-[10px] uppercase tracking-[0.18em] text-[#6d77a3]">
                Step {currentCreateCharacterStepIndex + 1} of {CREATE_CHARACTER_STEPS.length} · {remainingSelections === 0 ? "Ready to mint" : `${remainingSelections} selections left`}
              </span>
            ) : null}
          </div>
          <button
            onClick={onClose}
            className={`shrink-0 text-[#54f28b] transition-colors hover:text-[#ffcc00] ${isCompactLayout ? "ml-3 text-[16px]" : "text-[14px]"}`}
          >
            [X]
          </button>
        </div>

        <div ref={contentRef} className={`flex-1 overflow-y-auto overscroll-contain ${isCompactLayout ? "px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3" : "p-5"}`}>
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
            <div className="flex flex-col gap-4">
              {connectedAddress && (
                <div className="text-[11px] text-[#54f28b] border border-[#1a3a22] bg-[#0a1a0e] px-3 py-2">
                  [AUTH] {connectedAddress.slice(0, 8)}...{connectedAddress.slice(-6)}
                </div>
              )}

              {isCompactLayout ? (
                <div className="grid grid-cols-3 gap-2">
                  {CREATE_CHARACTER_STEPS.map((item, index) => {
                    const isActive = createCharacterStep === item.id;
                    const isDone =
                      item.id === "identity"
                        ? identityComplete
                        : item.id === "appearance"
                        ? appearanceComplete
                        : reviewComplete;
                    return (
                      <button
                        key={item.id}
                        onClick={() => setCreateCharacterStep(item.id)}
                        className={`border px-2 py-2 text-left transition ${
                          isActive
                            ? "border-[#54f28b] bg-[#0a1a0e]"
                            : isDone
                            ? "border-[#ffcc00] bg-[#2a2210]"
                            : "border-[#2a3450] bg-[#0b1020]"
                        }`}
                      >
                        <span
                          className={`block text-[10px] font-bold uppercase tracking-[0.18em] ${
                            isActive ? "text-[#54f28b]" : isDone ? "text-[#ffcc00]" : "text-[#6d77a3]"
                          }`}
                        >
                          {item.shortLabel}
                        </span>
                        <span className="mt-1 block text-[10px] leading-tight text-[#d6deff]">
                          {item.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}

              <div className="border border-[#2a3450] bg-[#0b1020] px-3 py-3 text-[12px] leading-relaxed text-[#9aa7cc]">
                {isCompactLayout
                  ? createCharacterStep === "identity"
                    ? "Step 1: pick the core character details first."
                    : createCharacterStep === "appearance"
                    ? "Step 2: choose the look. Bigger touch targets make the color and hair picks easier on phones."
                    : "Step 3: pick an origin, review the build, then mint from the sticky footer."
                  : "Build the character from top to bottom. On mobile the mint action stays pinned at the bottom so you can move through the form without losing your place."}
              </div>

              {/* Top row: Preview + Name/Race/Class */}
              <div className={`gap-3 ${isCompactLayout ? "flex flex-col" : "flex"}`}>
                {/* Character preview with zone frame */}
                <div className="shrink-0 flex flex-col items-center">
                  <div className="relative border-2 border-[#2a3450] bg-gradient-to-b from-[#0f1a2e] via-[#0b1424] to-[#162210] p-3">
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

                {(!isCompactLayout || createCharacterStep === "identity") ? (
                  <div className="min-w-0 flex-1 flex flex-col gap-3">
                    {/* Name */}
                    <div className="border border-[#2a3450] bg-[#0b1020] px-3 py-3">
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
                    <div className="border border-[#2a3450] bg-[#0b1020] px-3 py-3">
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
                    <div className="border border-[#2a3450] bg-[#0b1020] px-3 py-3">
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
                    <div className="border border-[#2a3450] bg-[#0b1020] px-3 py-3">
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
                ) : (
                  <div className="border border-[#2a3450] bg-[#0b1020] px-3 py-3 text-[12px] text-[#9aa7cc]">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[#6d77a3]">Current Build</p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.16em] text-[#6d77a3]">Name</p>
                        <p className="mt-1 text-[#d6deff]">{charName.trim() || "Not set"}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.16em] text-[#6d77a3]">Race</p>
                        <p className="mt-1 text-[#d6deff]">{selectedRace?.name ?? "Not set"}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.16em] text-[#6d77a3]">Class</p>
                        <p className="mt-1 text-[#d6deff]">{selectedClass?.name ?? "Not set"}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.16em] text-[#6d77a3]">Gender</p>
                        <p className="mt-1 text-[#d6deff]">{gender ?? "Not set"}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Selected class/race description */}
              {(selectedClass || selectedRace) && (
                <div className="border border-[#2a3450] bg-[#0b1020] px-3 py-2 text-[11px] leading-relaxed text-[#8b95c2]">
                  {selectedRace && <p><span className="text-[#ffcc00]">{selectedRace.name}:</span> {selectedRace.description}</p>}
                  {selectedClass && <p className={selectedRace ? "mt-1" : ""}><span className="text-[#54f28b]">{selectedClass.name}:</span> {selectedClass.description}</p>}
                </div>
              )}

              {/* Appearance row: Skin + Eyes + Hair */}
              {(!isCompactLayout || createCharacterStep === "appearance") ? (
                <div className={`gap-3 ${isCompactLayout ? "grid grid-cols-1" : "grid grid-cols-3"}`}>
                  {/* Skin Color */}
                  <div className="border border-[#2a3450] bg-[#0b1020] px-3 py-3">
                    <label className="mb-1 block text-[11px] text-[#9aa7cc] uppercase tracking-wider">
                      Skin
                    </label>
                    <div className={`grid gap-1 ${isCompactLayout ? "grid-cols-2" : "grid-cols-3"}`}>
                      {SKIN_COLORS.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => setSkinColor(s.id)}
                          className={`h-10 border-2 transition flex items-end justify-center pb-0.5 ${
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
                  <div className="border border-[#2a3450] bg-[#0b1020] px-3 py-3">
                    <label className="mb-1 block text-[11px] text-[#9aa7cc] uppercase tracking-wider">
                      Eyes
                    </label>
                    <div className={`grid gap-1 ${isCompactLayout ? "grid-cols-2" : "grid-cols-3"}`}>
                      {EYE_COLORS.map((e) => (
                        <button
                          key={e.id}
                          onClick={() => setEyeColor(e.id)}
                          className={`h-10 border-2 transition flex items-end justify-center pb-0.5 ${
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
                  <div className="border border-[#2a3450] bg-[#0b1020] px-3 py-3">
                    <label className="mb-1 block text-[11px] text-[#9aa7cc] uppercase tracking-wider">
                      Hair
                    </label>
                    <div className={`grid gap-1 pr-0.5 ${isCompactLayout ? "grid-cols-2 max-h-[200px]" : "grid-cols-2 max-h-[136px]"} overflow-y-auto`}>
                      {HAIR_STYLES.map((h) => (
                        <button
                          key={h.id}
                          onClick={() => setHairStyle(h.id)}
                          className={`border-2 px-2 py-1.5 text-center ${isCompactLayout ? "text-[10px]" : "text-[9px]"} transition ${
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
              ) : null}

              {(!isCompactLayout || createCharacterStep === "review") ? (
                <>
                  {/* Origin */}
                  <div className="border border-[#2a3450] bg-[#0b1020] px-3 py-3">
                    <label className="mb-1 block text-[11px] text-[#9aa7cc] uppercase tracking-wider">
                      Origin
                    </label>
                    <div className={`grid gap-2 ${isCompactLayout ? "grid-cols-1" : "grid-cols-2"}`}>
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

                  <div className={`gap-3 ${isCompactLayout ? "grid grid-cols-1" : "grid grid-cols-2"}`}>
                    <div className="border border-[#2a3450] bg-[#0b1020] px-3 py-3">
                      <p className="mb-2 text-[10px] uppercase tracking-wider text-[#6d77a3]">Review</p>
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div>
                          <span className="text-[#6d77a3]">Name</span>
                          <p className="mt-1 text-[#d6deff]">{charName.trim() || "Not set"}</p>
                        </div>
                        <div>
                          <span className="text-[#6d77a3]">Race</span>
                          <p className="mt-1 text-[#d6deff]">{selectedRace?.name ?? "Not set"}</p>
                        </div>
                        <div>
                          <span className="text-[#6d77a3]">Class</span>
                          <p className="mt-1 text-[#d6deff]">{selectedClass?.name ?? "Not set"}</p>
                        </div>
                        <div>
                          <span className="text-[#6d77a3]">Origin</span>
                          <p className="mt-1 text-[#d6deff]">{ORIGINS.find((item) => item.id === origin)?.label ?? "Not set"}</p>
                        </div>
                      </div>
                    </div>

                    {/* Stat preview */}
                    {previewStats ? (
                      <div className="border border-[#2a3450] bg-[#0b1020] px-3 py-3">
                        <p className="mb-1 text-[10px] uppercase tracking-wider text-[#6d77a3]">
                          Stats — {selectedRace?.name} {selectedClass?.name}
                        </p>
                        <div className={`grid gap-x-3 gap-y-0 ${isCompactLayout ? "grid-cols-2" : "grid-cols-3"}`}>
                          <StatRow label="STR" value={previewStats.str ?? 0} />
                          <StatRow label="DEF" value={previewStats.def ?? 0} />
                          <StatRow label="HP" value={previewStats.hp ?? 0} />
                          <StatRow label="AGI" value={previewStats.agi ?? 0} />
                          <StatRow label="INT" value={previewStats.int ?? 0} />
                          <StatRow label="LUCK" value={previewStats.luck ?? 0} />
                        </div>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}

              {error && (
                <p className="text-[12px] text-[#ff4d6d] border border-[#ff4d6d] px-3 py-2 bg-[#1a0a0e]">
                  [ERR] {error}
                </p>
              )}

              <div className={`sticky bottom-0 z-10 -mx-3 border-t-2 border-[#24314d] bg-[#060d12f2] px-3 pt-3 ${isCompactLayout ? "pb-[max(0.75rem,env(safe-area-inset-bottom))]" : "pb-0"}`}>
                <div className="mb-3 flex items-center justify-between gap-3 text-[11px]">
                  {isCompactLayout ? (
                    <>
                      <span className="text-[#6d77a3]">
                        {currentCreateCharacterStep.label}
                      </span>
                      <span className="truncate text-right text-[#9aa7cc]">
                        {currentStepComplete ? "Ready" : currentStepMissing.join(", ")}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-[#6d77a3]">
                        {canCreate ? "All sections complete" : `${remainingSelections} step${remainingSelections === 1 ? "" : "s"} left`}
                      </span>
                      {!canCreate ? (
                        <span className="truncate text-right text-[#9aa7cc]">
                          {missingFields.join(", ")}
                        </span>
                      ) : null}
                    </>
                  )}
                </div>
                {isCompactLayout ? (
                  <div className={`grid gap-2 ${createCharacterStep === "identity" ? "grid-cols-1" : "grid-cols-2"}`}>
                    {createCharacterStep !== "identity" ? (
                      <button
                        onClick={() => setCreateCharacterStep(CREATE_CHARACTER_STEPS[Math.max(0, currentCreateCharacterStepIndex - 1)].id)}
                        className="w-full border-2 border-[#2a3450] bg-[#0b1020] px-4 py-3 text-[12px] font-bold uppercase tracking-wide text-[#9aa7cc] transition hover:border-[#54f28b] hover:text-[#54f28b]"
                      >
                        Back
                      </button>
                    ) : null}

                    {createCharacterStep === "review" ? (
                      <button
                        onClick={handleRequestMint}
                        disabled={!canCreate}
                        className="w-full border-4 border-black bg-[#0a1a0e] px-4 py-3 text-[13px] font-bold uppercase tracking-wide text-[#54f28b] shadow-[4px_4px_0_0_#000] transition hover:bg-[#112a1b] disabled:cursor-not-allowed disabled:opacity-40 active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#000]"
                      >
                        {canCreate
                          ? connectedAddress
                            ? "[→] Mint Character — $0.00"
                            : "[→] Sign In to Mint Character"
                          : "Complete required selections"}
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          if (!nextCreateCharacterStep || !currentStepComplete) return;
                          setCreateCharacterStep(nextCreateCharacterStep.id);
                        }}
                        disabled={!currentStepComplete || !nextCreateCharacterStep}
                        className="w-full border-4 border-black bg-[#0a1a0e] px-4 py-3 text-[13px] font-bold uppercase tracking-wide text-[#54f28b] shadow-[4px_4px_0_0_#000] transition hover:bg-[#112a1b] disabled:cursor-not-allowed disabled:opacity-40 active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#000]"
                      >
                        {nextCreateCharacterStep ? `Next: ${nextCreateCharacterStep.label}` : "Continue"}
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={handleRequestMint}
                    disabled={!canCreate}
                    className="w-full border-4 border-black bg-[#0a1a0e] px-4 py-3 text-[13px] font-bold uppercase tracking-wide text-[#54f28b] shadow-[4px_4px_0_0_#000] transition hover:bg-[#112a1b] disabled:cursor-not-allowed disabled:opacity-40 active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#000]"
                  >
                    {canCreate
                      ? connectedAddress
                        ? "[→] Mint Character — $0.00"
                        : "[→] Sign In to Mint Character"
                      : "Complete required selections"}
                  </button>
                )}
              </div>
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
              >
                Continue →
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

              <div className={`grid gap-2 ${isCompactLayout ? "grid-cols-1" : "grid-cols-3"}`}>
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
