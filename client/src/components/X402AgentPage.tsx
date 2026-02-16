import * as React from "react";
import { API_URL } from "../config.js";

const RACES = [
  { id: "human", name: "Human", desc: "+2 STR, +1 CHA — versatile warriors" },
  { id: "elf", name: "Elf", desc: "+2 DEX, +1 INT — agile spellcasters" },
  { id: "dwarf", name: "Dwarf", desc: "+2 CON, +1 STR — tough fighters" },
  { id: "beastkin", name: "Beastkin", desc: "+2 DEX, +1 CON — feral hunters" },
];

const CLASSES = [
  { id: "warrior", name: "Warrior", desc: "Heavy armor, high STR melee" },
  { id: "paladin", name: "Paladin", desc: "Holy warrior, STR + healing" },
  { id: "rogue", name: "Rogue", desc: "Stealth, crits, DEX melee" },
  { id: "ranger", name: "Ranger", desc: "Ranged DEX, nature skills" },
  { id: "mage", name: "Mage", desc: "Arcane INT spellcaster" },
  { id: "cleric", name: "Cleric", desc: "WIS healer, support buffs" },
  { id: "warlock", name: "Warlock", desc: "Dark INT caster, DOTs" },
  { id: "monk", name: "Monk", desc: "Unarmed DEX/WIS martial arts" },
];

const ZONES = [
  { id: "village-square", name: "Village Square", desc: "Lv 1-5, peaceful starter zone" },
  { id: "wild-meadow", name: "Wild Meadow", desc: "Lv 5-10, moderate danger" },
  { id: "dark-forest", name: "Dark Forest", desc: "Lv 10-16, high danger" },
];

type Step = "greeting" | "race" | "class" | "name" | "zone" | "confirm" | "deploying" | "done" | "error";

interface Message {
  from: "agent" | "user" | "system";
  text: string;
}

interface DeployResult {
  success: boolean;
  deploymentId?: string;
  credentials?: {
    walletAddress: string;
    jwtToken: string;
    expiresIn: string;
  };
  character?: {
    nftTokenId: string;
    txHash: string;
    name: string;
    race: string;
    class: string;
    level: number;
    stats: Record<string, number>;
  };
  gameState?: {
    entityId: string;
    zoneId: string;
    position: { x: number; y: number };
    goldBalance: string;
  };
  message?: string;
  error?: string;
}

interface X402AgentPageProps {
  onBack: () => void;
}

export function X402AgentPage({ onBack }: X402AgentPageProps): React.ReactElement {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [step, setStep] = React.useState<Step>("greeting");
  const [selectedRace, setSelectedRace] = React.useState<string | null>(null);
  const [selectedClass, setSelectedClass] = React.useState<string | null>(null);
  const [characterName, setCharacterName] = React.useState("");
  const [selectedZone, setSelectedZone] = React.useState<string | null>(null);
  const [nameInput, setNameInput] = React.useState("");
  const [deployResult, setDeployResult] = React.useState<DeployResult | null>(null);
  const [typingText, setTypingText] = React.useState("");
  const [isTyping, setIsTyping] = React.useState(false);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom
  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typingText]);

  // Focus input when on name step
  React.useEffect(() => {
    if (step === "name") {
      inputRef.current?.focus();
    }
  }, [step]);

  // Typewriter effect for agent messages
  const typeMessage = React.useCallback(
    (text: string, from: "agent" | "system"): Promise<void> => {
      return new Promise((resolve) => {
        setIsTyping(true);
        setTypingText("");
        let i = 0;
        const interval = setInterval(() => {
          if (i < text.length) {
            setTypingText(text.slice(0, i + 1));
            i++;
          } else {
            clearInterval(interval);
            setTypingText("");
            setIsTyping(false);
            setMessages((prev) => [...prev, { from, text }]);
            resolve();
          }
        }, 18);
      });
    },
    []
  );

  // Greeting on mount
  React.useEffect(() => {
    const greet = async () => {
      await typeMessage(
        ">> X402 AGENT DEPLOYMENT PROTOCOL v1.0",
        "system"
      );
      await typeMessage(
        "Hey there! I'm the WoG deployment agent. I can instantly spin up a fully on-chain character for you on the SKALE testnet — wallet, NFT, gold, the works.",
        "agent"
      );
      await typeMessage(
        "Let's build your character. First — what race do you want?",
        "agent"
      );
      setStep("race");
    };
    greet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addUserMessage = (text: string) => {
    setMessages((prev) => [...prev, { from: "user", text }]);
  };

  const handleRaceSelect = async (raceId: string) => {
    const race = RACES.find((r) => r.id === raceId);
    if (!race) return;
    setSelectedRace(raceId);
    addUserMessage(race.name);

    await typeMessage(
      `${race.name} — solid pick. ${race.desc}. Now, what class should they be?`,
      "agent"
    );
    setStep("class");
  };

  const handleClassSelect = async (classId: string) => {
    const cls = CLASSES.find((c) => c.id === classId);
    if (!cls) return;
    setSelectedClass(classId);
    addUserMessage(cls.name);

    await typeMessage(
      `A ${RACES.find((r) => r.id === selectedRace)?.name} ${cls.name}. Nice combo. What do you want to name your character?`,
      "agent"
    );
    setStep("name");
  };

  const handleNameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = nameInput.trim();
    if (!name || name.length < 2 || name.length > 20) return;
    setCharacterName(name);
    setNameInput("");
    addUserMessage(name);

    await typeMessage(
      `"${name}" — I like it. Last thing: which zone should we deploy into?`,
      "agent"
    );
    setStep("zone");
  };

  const handleZoneSelect = async (zoneId: string) => {
    const zone = ZONES.find((z) => z.id === zoneId);
    if (!zone) return;
    setSelectedZone(zoneId);
    addUserMessage(zone.name);

    const race = RACES.find((r) => r.id === selectedRace);
    const cls = CLASSES.find((c) => c.id === selectedClass);

    await typeMessage(
      `Alright, here's the plan:\n\n` +
        `  Character: ${characterName}\n` +
        `  Race:      ${race?.name}\n` +
        `  Class:     ${cls?.name}\n` +
        `  Zone:      ${zone.name}\n` +
        `  Payment:   Free tier (50 GOLD bonus)\n\n` +
        `I'll create a custodial wallet, mint the character NFT, distribute gold and sFUEL, and spawn them in-world. Ready to deploy?`,
      "agent"
    );
    setStep("confirm");
  };

  const handleDeploy = async () => {
    addUserMessage("Deploy it!");
    setStep("deploying");

    await typeMessage(">> Initiating atomic deployment sequence...", "system");
    await typeMessage("Creating custodial wallet...", "agent");

    try {
      const response = await fetch(`${API_URL}/x402/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentName: `x402-web-agent-${Date.now()}`,
          character: {
            name: characterName,
            race: selectedRace,
            class: selectedClass,
          },
          payment: { method: "free" },
          deploymentZone: selectedZone,
          metadata: {
            source: "x402-web-ui",
            version: "1.0",
          },
        }),
      });

      const data: DeployResult = await response.json();

      if (data.success && data.credentials && data.character && data.gameState) {
        setDeployResult(data);
        await typeMessage("Minting character NFT on SKALE testnet...", "agent");
        await typeMessage("Distributing GOLD tokens...", "agent");
        await typeMessage("Distributing sFUEL for gas...", "agent");
        await typeMessage("Spawning entity in game world...", "agent");
        await typeMessage(">> DEPLOYMENT COMPLETE", "system");
        await typeMessage(
          `Your character is live! Here are your credentials:\n\n` +
            `  Wallet:    ${data.credentials.walletAddress}\n` +
            `  NFT Tx:    ${data.character.txHash.slice(0, 20)}...\n` +
            `  Token:     ${data.credentials.jwtToken.slice(0, 20)}...\n` +
            `  Entity ID: ${data.gameState.entityId.slice(0, 20)}...\n` +
            `  Zone:      ${data.gameState.zoneId}\n` +
            `  Gold:      ${data.gameState.goldBalance} GOLD\n` +
            `  Position:  (${data.gameState.position.x}, ${data.gameState.position.y})\n\n` +
            `Your agent is ready to play. Use the JWT token to authenticate API calls. Happy adventuring!`,
          "agent"
        );
        setStep("done");
      } else {
        await typeMessage(
          `>> DEPLOYMENT FAILED: ${data.message || data.error || "Unknown error"}`,
          "system"
        );
        await typeMessage(
          "Something went wrong during deployment. You can try again or go back to the landing page.",
          "agent"
        );
        setStep("error");
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Network error";
      await typeMessage(`>> DEPLOYMENT FAILED: ${errMsg}`, "system");
      await typeMessage(
        "Couldn't reach the deployment server. Make sure the game server is running and try again.",
        "agent"
      );
      setStep("error");
    }
  };

  const handleRestart = () => {
    setMessages([]);
    setStep("greeting");
    setSelectedRace(null);
    setSelectedClass(null);
    setCharacterName("");
    setSelectedZone(null);
    setNameInput("");
    setDeployResult(null);

    const greet = async () => {
      await typeMessage(">> X402 AGENT DEPLOYMENT PROTOCOL v1.0", "system");
      await typeMessage(
        "Let's try again. What race do you want for your character?",
        "agent"
      );
      setStep("race");
    };
    greet();
  };

  return (
    <div className="relative flex min-h-full w-full flex-col items-center overflow-y-auto overflow-x-hidden">
      {/* Scanline overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-50"
        style={{
          background:
            "repeating-linear-gradient(0deg, rgba(0,0,0,0.15) 0px, rgba(0,0,0,0.15) 1px, transparent 1px, transparent 3px)",
        }}
      />

      <div className="z-10 flex w-full max-w-2xl flex-col px-4 pt-8 pb-8">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between border-b-4 border-[#54f28b] pb-3">
          <div>
            <h1
              className="text-[14px] uppercase tracking-widest text-[#54f28b]"
              style={{ textShadow: "2px 2px 0 #000" }}
            >
              x402 Agent Deployer
            </h1>
            <p className="mt-1 text-[8px] text-[#565f89]">
              SKALE Testnet | Atomic Character Deployment
            </p>
          </div>
          <button
            onClick={onBack}
            className="border-2 border-[#2a3450] bg-[#11192d] px-3 py-1.5 text-[9px] text-[#9aa7cc] transition hover:border-[#ffcc00] hover:text-[#ffcc00]"
          >
            {"<"} Back
          </button>
        </div>

        {/* Chat area */}
        <div className="mb-4 flex flex-1 flex-col gap-2 border-2 border-[#2a3450] bg-[#080d18] p-4"
          style={{ minHeight: "400px" }}
        >
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.from === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] px-3 py-2 text-[10px] leading-relaxed whitespace-pre-wrap ${
                  msg.from === "system"
                    ? "border border-[#54f28b]/30 bg-[#0a1a10] text-[#54f28b]"
                    : msg.from === "agent"
                    ? "border border-[#2a3450] bg-[#11192d] text-[#d6deff]"
                    : "border border-[#ffcc00]/30 bg-[#1a1800] text-[#ffcc00]"
                }`}
              >
                {msg.from === "agent" && (
                  <span className="mr-1 text-[8px] text-[#565f89]">[agent]</span>
                )}
                {msg.from === "system" && (
                  <span className="mr-1 text-[8px] text-[#54f28b]/60">[sys]</span>
                )}
                {msg.text}
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {isTyping && typingText && (
            <div className="flex justify-start">
              <div className="max-w-[85%] border border-[#2a3450] bg-[#11192d] px-3 py-2 text-[10px] leading-relaxed whitespace-pre-wrap text-[#d6deff]">
                <span className="mr-1 text-[8px] text-[#565f89]">[agent]</span>
                {typingText}
                <span className="animate-pulse text-[#54f28b]">_</span>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input area - changes based on step */}
        <div className="border-2 border-[#2a3450] bg-[#11192d] p-4">
          {step === "greeting" && (
            <p className="text-center text-[9px] text-[#565f89]">Initializing agent...</p>
          )}

          {step === "race" && !isTyping && (
            <div>
              <p className="mb-3 text-[9px] text-[#9aa7cc]">Choose a race:</p>
              <div className="grid grid-cols-2 gap-2">
                {RACES.map((race) => (
                  <button
                    key={race.id}
                    onClick={() => handleRaceSelect(race.id)}
                    className="border-2 border-[#2a3450] bg-[#080d18] px-3 py-2.5 text-left transition hover:border-[#54f28b] hover:bg-[#0a1a10]"
                  >
                    <span className="block text-[10px] text-[#ffcc00]">{race.name}</span>
                    <span className="block text-[8px] text-[#565f89]">{race.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === "class" && !isTyping && (
            <div>
              <p className="mb-3 text-[9px] text-[#9aa7cc]">Choose a class:</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {CLASSES.map((cls) => (
                  <button
                    key={cls.id}
                    onClick={() => handleClassSelect(cls.id)}
                    className="border-2 border-[#2a3450] bg-[#080d18] px-3 py-2.5 text-left transition hover:border-[#54f28b] hover:bg-[#0a1a10]"
                  >
                    <span className="block text-[10px] text-[#ffcc00]">{cls.name}</span>
                    <span className="block text-[8px] text-[#565f89]">{cls.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === "name" && !isTyping && (
            <form onSubmit={handleNameSubmit} className="flex gap-2">
              <span className="flex items-center text-[10px] text-[#54f28b]">{">"}</span>
              <input
                ref={inputRef}
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Enter character name (2-20 chars)"
                maxLength={20}
                className="flex-1 border-2 border-[#2a3450] bg-[#080d18] px-3 py-2 text-[10px] text-[#d6deff] placeholder-[#565f89] outline-none focus:border-[#54f28b]"
              />
              <button
                type="submit"
                disabled={nameInput.trim().length < 2}
                className="border-2 border-[#54f28b] bg-[#0a1a10] px-4 py-2 text-[9px] text-[#54f28b] transition hover:bg-[#112a1b] disabled:opacity-40"
              >
                Enter
              </button>
            </form>
          )}

          {step === "zone" && !isTyping && (
            <div>
              <p className="mb-3 text-[9px] text-[#9aa7cc]">Choose a deployment zone:</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                {ZONES.map((zone) => (
                  <button
                    key={zone.id}
                    onClick={() => handleZoneSelect(zone.id)}
                    className="flex-1 border-2 border-[#2a3450] bg-[#080d18] px-3 py-2.5 text-left transition hover:border-[#54f28b] hover:bg-[#0a1a10]"
                  >
                    <span className="block text-[10px] text-[#ffcc00]">{zone.name}</span>
                    <span className="block text-[8px] text-[#565f89]">{zone.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === "confirm" && !isTyping && (
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={handleDeploy}
                className="border-4 border-black bg-[#54f28b] px-6 py-2.5 text-[11px] uppercase tracking-wide text-black shadow-[4px_4px_0_0_#000] transition hover:bg-[#7ff5a8] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#000]"
              >
                Deploy Character
              </button>
              <button
                onClick={handleRestart}
                className="border-2 border-[#2a3450] bg-[#11192d] px-4 py-2 text-[9px] text-[#9aa7cc] transition hover:border-[#ffcc00] hover:text-[#ffcc00]"
              >
                Start Over
              </button>
            </div>
          )}

          {step === "deploying" && (
            <div className="flex items-center justify-center gap-2 py-2">
              <span className="animate-pulse text-[10px] text-[#54f28b]">{">>>"}</span>
              <span className="text-[10px] text-[#9aa7cc]">
                Deploying to SKALE testnet...
              </span>
              <span className="animate-pulse text-[10px] text-[#54f28b]">{"<<<"}</span>
            </div>
          )}

          {step === "done" && !isTyping && (
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <button
                onClick={onBack}
                className="border-4 border-black bg-[#ffcc00] px-6 py-2.5 text-[11px] uppercase tracking-wide text-black shadow-[4px_4px_0_0_#000] transition hover:bg-[#ffd84d] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#000]"
              >
                Enter World
              </button>
              <button
                onClick={handleRestart}
                className="border-2 border-[#2a3450] bg-[#11192d] px-4 py-2 text-[9px] text-[#9aa7cc] transition hover:border-[#54f28b] hover:text-[#54f28b]"
              >
                Deploy Another
              </button>
            </div>
          )}

          {step === "error" && !isTyping && (
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={handleRestart}
                className="border-4 border-black bg-[#ffcc00] px-6 py-2.5 text-[11px] uppercase tracking-wide text-black shadow-[4px_4px_0_0_#000] transition hover:bg-[#ffd84d] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#000]"
              >
                Try Again
              </button>
              <button
                onClick={onBack}
                className="border-2 border-[#2a3450] bg-[#11192d] px-4 py-2 text-[9px] text-[#9aa7cc] transition hover:border-[#ffcc00] hover:text-[#ffcc00]"
              >
                Back to Home
              </button>
            </div>
          )}

          {isTyping && step !== "greeting" && step !== "deploying" && (
            <p className="text-center text-[9px] text-[#565f89]">Agent is typing...</p>
          )}
        </div>

        {/* Deployment details panel (shown after success) */}
        {deployResult?.success && step === "done" && !isTyping && (
          <div className="mt-4 border-2 border-[#54f28b]/30 bg-[#0a1a10] p-4">
            <h3 className="mb-3 text-[10px] uppercase tracking-wider text-[#54f28b]">
              Deployment Receipt
            </h3>
            <div className="grid gap-2 text-[9px] sm:grid-cols-2">
              <div>
                <span className="text-[#565f89]">Deployment ID: </span>
                <span className="text-[#d6deff] break-all">{deployResult.deploymentId}</span>
              </div>
              <div>
                <span className="text-[#565f89]">Wallet: </span>
                <span className="text-[#d6deff] break-all">{deployResult.credentials?.walletAddress}</span>
              </div>
              <div>
                <span className="text-[#565f89]">NFT Tx: </span>
                <span className="text-[#d6deff] break-all">{deployResult.character?.txHash}</span>
              </div>
              <div>
                <span className="text-[#565f89]">Entity ID: </span>
                <span className="text-[#d6deff] break-all">{deployResult.gameState?.entityId}</span>
              </div>
              <div>
                <span className="text-[#565f89]">Character: </span>
                <span className="text-[#ffcc00]">
                  {deployResult.character?.name} — Lv{deployResult.character?.level}{" "}
                  {deployResult.character?.race} {deployResult.character?.class}
                </span>
              </div>
              <div>
                <span className="text-[#565f89]">Gold: </span>
                <span className="text-[#ffcc00]">{deployResult.gameState?.goldBalance} GOLD</span>
              </div>
            </div>
            {deployResult.character?.stats && (
              <div className="mt-3 border-t border-[#54f28b]/20 pt-2">
                <span className="text-[8px] text-[#565f89]">Stats: </span>
                <span className="text-[8px] text-[#9aa7cc]">
                  {Object.entries(deployResult.character.stats)
                    .map(([k, v]) => `${k.toUpperCase()} ${v}`)
                    .join(" | ")}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
