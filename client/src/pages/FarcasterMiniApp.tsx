import * as React from "react";
import { sdk } from "@farcaster/miniapp-sdk";
import type { Context } from "@farcaster/miniapp-sdk";
import { fetchClasses, fetchRaces, createCharacter } from "@/ShardClient";
import { API_URL } from "@/config";
import type { RaceInfo, ClassInfo, CharacterStats } from "@/types";

type Step =
  | "loading"
  | "create-char"
  | "minting"
  | "success"
  | "error-init";

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

export function FarcasterMiniApp(): React.ReactElement {
  const [step, setStep] = React.useState<Step>("loading");
  const [error, setError] = React.useState<string | null>(null);
  const [initError, setInitError] = React.useState<string | null>(null);

  // Farcaster context
  const [fcUser, setFcUser] = React.useState<Context.UserContext | null>(null);
  const [walletAddress, setWalletAddress] = React.useState<string | null>(null);
  const [wogToken, setWogToken] = React.useState<string | null>(null);

  // Character creation
  const [races, setRaces] = React.useState<RaceInfo[]>([]);
  const [classes, setClasses] = React.useState<ClassInfo[]>([]);
  const [charName, setCharName] = React.useState("");
  const [raceId, setRaceId] = React.useState("");
  const [classId, setClassId] = React.useState("");
  const [successData, setSuccessData] = React.useState<SuccessData | null>(null);

  // Whether we're actually running inside Warpcast
  const [isMiniApp, setIsMiniApp] = React.useState(true);

  React.useEffect(() => {
    init();
  }, []);

  async function init() {
    try {
      // Check if running inside a Farcaster client
      const inMiniApp = await sdk.isInMiniApp();
      setIsMiniApp(inMiniApp);

      if (!inMiniApp) {
        setInitError("Open this page inside Warpcast to create a character.");
        setStep("error-init");
        // Still signal ready so the page renders
        return;
      }

      // Signal ready to hide the Warpcast splash screen
      await sdk.actions.ready();

      // Get user context (FID, username, pfp)
      const context = await sdk.context;
      setFcUser(context.user);

      // Pre-fill character name from Farcaster display name
      if (context.user.displayName) {
        setCharName(context.user.displayName.slice(0, 24));
      }

      // Get authenticated Farcaster token
      const { token: fcToken } = await sdk.quickAuth.getToken();

      // Get the user's Ethereum wallet address from Warpcast
      const provider = await sdk.wallet.getEthereumProvider();
      if (!provider) {
        setInitError("Wallet not available. Please update Warpcast.");
        setStep("error-init");
        return;
      }
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      if (!accounts.length) {
        setInitError("No wallet accounts found.");
        setStep("error-init");
        return;
      }
      const wallet = accounts[0];
      setWalletAddress(wallet);

      // Bridge Farcaster auth -> WoG auth (get a WoG JWT)
      const authRes = await fetch(`${API_URL}/auth/farcaster`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ farcasterToken: fcToken, walletAddress: wallet }),
      });

      if (authRes.ok) {
        const authData = await authRes.json();
        setWogToken(authData.token);
      }
      // Auth failure is non-fatal — character creation doesn't require it,
      // but agent deploy does. We'll handle that later.

      // Load races & classes
      const [raceData, classData] = await Promise.all([fetchRaces(), fetchClasses()]);
      setRaces(raceData);
      setClasses(classData);

      setStep("create-char");
    } catch (err: any) {
      console.error("[FarcasterMiniApp] init error:", err);
      setInitError(err.message || "Failed to initialize");
      setStep("error-init");
    }
  }

  const selectedRace = races.find((r) => r.id === raceId);
  const selectedClass = classes.find((c) => c.id === classId);
  const previewStats =
    selectedRace && selectedClass
      ? combineStats(selectedClass.baseStats, selectedRace.statModifiers)
      : null;

  const canCreate =
    Boolean(walletAddress) &&
    charName.trim().length >= 2 &&
    charName.trim().length <= 24 &&
    Boolean(selectedRace) &&
    Boolean(selectedClass);

  async function handleCreate() {
    if (!walletAddress || !canCreate) return;
    setError(null);
    setStep("minting");

    try {
      const result = await createCharacter(walletAddress, charName.trim(), raceId, classId);
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

      // Deploy AI agent in the background
      if (wogToken) {
        try {
          const deployRes = await fetch(`${API_URL}/agent/deploy`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${wogToken}`,
            },
            body: JSON.stringify({
              walletAddress,
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
            setSuccessData({
              ...successBase,
              agentDeploying: false,
              agentError: deployData.error,
            });
          }
        } catch (deployErr: any) {
          setSuccessData({
            ...successBase,
            agentDeploying: false,
            agentError: deployErr.message,
          });
        }
      } else {
        setSuccessData({ ...successBase, agentDeploying: false, agentError: "Auth not available" });
      }
    } catch (e: any) {
      setError(e.message || "Minting failed. Please try again.");
      setStep("create-char");
    }
  }

  async function handleShareToCast() {
    if (!successData) return;
    try {
      await sdk.actions.composeCast({
        text: `I just created ${successData.name}, a ${successData.race} ${successData.className} in World of Guilds!\n\nCreate yours and let your AI agent battle, quest, and trade in a fully onchain MMORPG.`,
        embeds: [window.location.origin + "/farcaster"],
      });
    } catch {
      // User may have dismissed the composer — non-fatal
    }
  }

  const panelCls =
    "w-full max-w-sm border-4 border-[#54f28b] bg-[#060d12] shadow-[8px_8px_0_0_#000] font-mono mx-auto";

  return (
    <div className="min-h-screen bg-[#060d12] flex items-center justify-center px-4 py-8">
      <div className={panelCls}>
        {/* Header bar */}
        <div className="flex items-center justify-between border-b-2 border-[#54f28b] bg-[#0a1a0e] px-4 py-2">
          <span className="text-[9px] uppercase tracking-widest text-[#54f28b]">
            {step === "loading"
              ? ">> CONNECTING..."
              : step === "error-init"
              ? ">> ERROR"
              : step === "create-char"
              ? ">> CREATE CHARACTER"
              : step === "minting"
              ? ">> MINTING NFT..."
              : ">> CHARACTER CREATED!"}
          </span>
          {fcUser && (
            <span className="text-[7px] text-[#3a4260]">
              @{fcUser.username || `fid:${fcUser.fid}`}
            </span>
          )}
        </div>

        <div className="p-5">
          {/* ── LOADING ── */}
          {step === "loading" && (
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="text-[20px] text-[#54f28b] animate-pulse">{">>>"}</div>
              <p className="text-[9px] text-[#9aa7cc]">Connecting to Warpcast...</p>
              <p className="text-[7px] text-[#3a4260]">
                Getting your wallet and Farcaster identity
              </p>
            </div>
          )}

          {/* ── INIT ERROR ── */}
          {step === "error-init" && (
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="text-[20px] text-[#ff4d6d]">!</div>
              <p className="text-[9px] text-[#ff4d6d] text-center">{initError}</p>
              {!isMiniApp && (
                <p className="text-[7px] text-[#3a4260] text-center">
                  This page is a Farcaster Mini App.
                  Open it from the Warpcast app store or a shared cast.
                </p>
              )}
            </div>
          )}

          {/* ── CREATE CHARACTER ── */}
          {step === "create-char" && (
            <div className="flex flex-col gap-3">
              {/* Farcaster identity badge */}
              {fcUser && (
                <div className="flex items-center gap-2 border border-[#1a3a22] bg-[#0a1a0e] px-2 py-1.5">
                  {fcUser.pfpUrl && (
                    <img
                      src={fcUser.pfpUrl}
                      alt=""
                      className="w-5 h-5 rounded-sm border border-[#54f28b]"
                    />
                  )}
                  <div className="flex flex-col">
                    <span className="text-[8px] text-[#54f28b]">
                      {fcUser.displayName || fcUser.username}
                    </span>
                    <span className="text-[6px] text-[#3a4260]">
                      FID {fcUser.fid} · {walletAddress?.slice(0, 6)}...{walletAddress?.slice(-4)}
                    </span>
                  </div>
                </div>
              )}

              {/* Name */}
              <div>
                <label className="mb-1 block text-[8px] text-[#9aa7cc] uppercase tracking-wider">
                  Character Name
                </label>
                <input
                  type="text"
                  placeholder="2-24 characters"
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
                onClick={() => void handleCreate()}
                disabled={!canCreate}
                className="mt-1 w-full border-4 border-black bg-[#0a1a0e] px-4 py-3 text-[11px] uppercase tracking-wide text-[#54f28b] shadow-[4px_4px_0_0_#000] transition hover:bg-[#112a1b] disabled:opacity-40 disabled:cursor-not-allowed active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#000]"
              >
                [&gt;] Mint Character
              </button>

              <p className="text-[7px] text-[#3a4260] text-center">
                Zero gas fees — powered by SKALE
              </p>
            </div>
          )}

          {/* ── MINTING ── */}
          {step === "minting" && (
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="text-[20px] text-[#ffcc00] animate-pulse">{"$$"}</div>
              <p className="text-[9px] text-[#9aa7cc]">
                Minting your character NFT on SKALE...
              </p>
              <p className="text-[7px] text-[#3a4260]">Zero gas fees — powered by sFUEL</p>
            </div>
          )}

          {/* ── SUCCESS ── */}
          {step === "success" && successData && (
            <div className="flex flex-col gap-3">
              <div className="border-2 border-[#54f28b] bg-[#0a1a0e] px-4 py-3">
                <p className="text-[8px] text-[#54f28b] mb-2">[OK] CHARACTER MINTED</p>
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
                  <p className="text-[#9aa7cc] animate-pulse mb-1">
                    {">>>"} Deploying AI agent...
                  </p>
                  <p className="text-[#565f89]">
                    Creating custodial wallet + spawning character
                  </p>
                </div>
              ) : successData.agentEntityId ? (
                <div className="border border-[#54f28b] bg-[#0a1a0e] px-3 py-2 text-[7px]">
                  <p className="text-[#54f28b] mb-1">[OK] AGENT DEPLOYED</p>
                  <p className="text-[#9aa7cc]">
                    Your AI agent is live in{" "}
                    <span className="text-[#ffcc00]">{successData.agentZoneId}</span>
                  </p>
                  <p className="text-[#565f89] mt-1">
                    It will autonomously fight, quest, and trade.
                  </p>
                </div>
              ) : (
                <div className="border border-[#2a3450] bg-[#0b1020] px-3 py-2 text-[7px] text-[#565f89]">
                  {successData.agentError ? (
                    <p className="text-[#ff4d6d]">
                      [!] Agent deploy skipped: {successData.agentError.slice(0, 80)}
                    </p>
                  ) : (
                    <p className="text-[#9aa7cc]">Your character NFT is ready.</p>
                  )}
                </div>
              )}

              {/* Share to Farcaster feed */}
              <button
                onClick={() => void handleShareToCast()}
                className="w-full border-4 border-black bg-[#7c3aed] px-4 py-3 text-[11px] uppercase tracking-wide text-white shadow-[4px_4px_0_0_#000] transition hover:bg-[#6d28d9] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#000] font-bold"
              >
                Cast About Your Character
              </button>

              <a
                href={`${window.location.origin}/world`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full border-4 border-black bg-[#54f28b] px-4 py-3 text-[11px] uppercase tracking-wide text-[#060d12] shadow-[4px_4px_0_0_#000] transition hover:bg-[#7bf5a8] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#000] font-bold text-center block"
              >
                Watch In World View
              </a>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[#1a3a22] px-4 py-2">
          <p className="text-[6px] text-[#3a4260] text-center">
            World of Guilds — AI agents play, humans watch. Powered by SKALE.
          </p>
        </div>
      </div>
    </div>
  );
}
