import * as React from "react";

import {
  TUTORIAL_MASTER_NAME,
  getTutorialMasterPortraitUrl,
  markTutorialMasterIntroSeen,
  warmTutorialMasterPortraitCache,
} from "@/lib/tutorialMaster";

interface TutorialMasterModalProps {
  open: boolean;
  onClose: () => void;
  onShowChat: () => void;
  onShowRanks: () => void;
  onShowWallet: () => void;
}

type TutorialStep = {
  id: string;
  title: string;
  body: string;
  selector?: string;
  accent: string;
  action?: () => void;
};

const BUBBLE_W = 360;
const BUBBLE_H = 200;
const VIEWPORT_MARGIN = 24;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function TutorialMasterModal({
  open,
  onClose,
  onShowChat,
  onShowRanks,
  onShowWallet,
}: TutorialMasterModalProps): React.ReactElement | null {
  const [imageFailed, setImageFailed] = React.useState(false);
  const [stepIndex, setStepIndex] = React.useState(0);
  const [targetRect, setTargetRect] = React.useState<DOMRect | null>(null);
  const [viewport, setViewport] = React.useState(() => ({
    width: typeof window === "undefined" ? 1280 : window.innerWidth,
    height: typeof window === "undefined" ? 720 : window.innerHeight,
  }));

  const steps = React.useMemo<TutorialStep[]>(() => [
    {
      id: "welcome",
      title: "Welcome To Geneva",
      body: "I will walk you through the core HUD like a guided strategy-game tutorial. Follow the highlights, then speak with Guard Captain Marcus to accept your first quest.",
      selector: "[data-tutorial-id='world-canvas']",
      accent: "#ffcc00",
    },
    {
      id: "hotkeys",
      title: "This Is Your Action Bar",
      body: "These hotkeys are your fast path through the world. Character, map, quests, inspect, chat, ranks, wallet, and settings are all reachable from here.",
      selector: "[data-tutorial-id='hotkey-bar']",
      accent: "#54f28b",
    },
    {
      id: "quests",
      title: "Track Quests Here",
      body: "Press Q to open your quest log. Use it to accept starter quests, follow objectives, and return to quest givers for rewards.",
      selector: "[data-tutorial-id='hotkey-questLog']",
      accent: "#5dadec",
    },
    {
      id: "character",
      title: "Manage Your Champion",
      body: "Press C for your character console. That is where you review your roster and redeploy a different champion later.",
      selector: "[data-tutorial-id='hotkey-character']",
      accent: "#ffcc00",
    },
    {
      id: "chat",
      title: "Deploy And Command Your Agent",
      body: "This chat panel is your command bridge. Deploy your agent here, tell it to quest, gather, fight, travel, or shop, and watch its activity log update live.",
      selector: "[data-tutorial-id='agent-chat-panel']",
      accent: "#54f28b",
      action: onShowChat,
    },
    {
      id: "ranks",
      title: "Check Rankings",
      body: "This panel shows the live lobby and the leaderboard. Use it to watch progression, compare power, and see who is climbing the rankings.",
      selector: "[data-tutorial-id='ranks-panel']",
      accent: "#7aa2f7",
      action: onShowRanks,
    },
    {
      id: "wallet",
      title: "Your Gold And Champion State",
      body: "Your wallet panel tracks your active champion, gold, plan, and quick links. This is where you monitor the resources your run is building.",
      selector: "[data-tutorial-id='wallet-panel']",
      accent: "#ffcc00",
      action: onShowWallet,
    },
    {
      id: "finish",
      title: "You're Ready",
      body: "Now step into the world. Talk to Guard Captain Marcus, start the village quest chain, deploy your agent when needed, and build your rank across Geneva.",
      selector: "[data-tutorial-id='world-canvas']",
      accent: "#ffcc00",
    },
  ], [onShowChat, onShowRanks, onShowWallet]);

  const step = steps[stepIndex] ?? steps[0];

  React.useEffect(() => {
    if (!open) return;
    setImageFailed(false);
    setStepIndex(0);
    void warmTutorialMasterPortraitCache();
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    step.action?.();
  }, [open, step]);

  React.useLayoutEffect(() => {
    if (!open) return;

    const update = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
      if (!step.selector) {
        setTargetRect(null);
        return;
      }

      const element = document.querySelector(step.selector);
      setTargetRect(element instanceof HTMLElement ? element.getBoundingClientRect() : null);
    };

    update();

    const intervalId = window.setInterval(update, 200);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, step]);

  if (!open) return null;

  const finish = () => {
    markTutorialMasterIntroSeen();
    onClose();
  };

  const spotlightStyle: React.CSSProperties | undefined = targetRect
    ? {
        left: clamp(targetRect.left - 10, VIEWPORT_MARGIN, viewport.width - VIEWPORT_MARGIN),
        top: clamp(targetRect.top - 10, VIEWPORT_MARGIN, viewport.height - VIEWPORT_MARGIN),
        width: Math.min(targetRect.width + 20, viewport.width - VIEWPORT_MARGIN * 2),
        height: Math.min(targetRect.height + 20, viewport.height - VIEWPORT_MARGIN * 2),
      }
    : undefined;

  const bubbleWidth = Math.min(BUBBLE_W, viewport.width - VIEWPORT_MARGIN * 2);

  const bubbleTop = targetRect
    ? clamp(
        targetRect.top > viewport.height * 0.55
          ? targetRect.top - BUBBLE_H - 28
          : targetRect.bottom + 24,
        VIEWPORT_MARGIN,
        viewport.height - BUBBLE_H - VIEWPORT_MARGIN
      )
    : viewport.height - BUBBLE_H - 36;

  const bubbleLeft = targetRect
    ? clamp(
        targetRect.left + targetRect.width / 2 - bubbleWidth / 2,
        VIEWPORT_MARGIN,
        viewport.width - bubbleWidth - VIEWPORT_MARGIN
      )
    : VIEWPORT_MARGIN;

  return (
    <div className="fixed inset-0 z-[220]">
      <div className="absolute inset-0 bg-black/72" />

      {spotlightStyle && (
        <div
          className="pointer-events-none absolute rounded-[20px] border-4 shadow-[0_0_0_9999px_rgba(0,0,0,0.72)] transition-all duration-300"
          style={{
            ...spotlightStyle,
            borderColor: step.accent,
            boxShadow: `0 0 0 9999px rgba(0,0,0,0.72), 0 0 0 4px ${step.accent}66, 0 0 28px ${step.accent}88`,
          }}
        >
          <div
            className="absolute -top-8 left-0 border-2 border-black px-3 py-1 text-[10px] font-bold uppercase tracking-[0.26em] text-black shadow-[3px_3px_0_0_#000]"
            style={{ backgroundColor: step.accent }}
          >
            {step.title}
          </div>
        </div>
      )}

      <div
        className="absolute border-4 border-black bg-[linear-gradient(180deg,#18213a,#0a1021)] text-[#edf2ff] shadow-[8px_8px_0_0_#000]"
        style={{
          width: bubbleWidth,
          minHeight: BUBBLE_H,
          left: bubbleLeft,
          top: bubbleTop,
        }}
      >
        <div className="flex items-start gap-3 p-4">
          {!imageFailed ? (
            <img
              alt={`${TUTORIAL_MASTER_NAME} portrait`}
              className="h-20 w-20 shrink-0 border-2 border-[#2a3450] bg-[#0b1020] object-cover"
              onError={() => setImageFailed(true)}
              src={getTutorialMasterPortraitUrl()}
            />
          ) : (
            <div className="flex h-20 w-20 shrink-0 items-end border-2 border-[#2a3450] bg-[radial-gradient(circle_at_top,#3a2b1c,#0b1020_70%)] p-2 text-[8px] leading-tight text-[#9aa7cc]">
              Add `tutorial-master.png`
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.28em] text-[#ffcc00]">Scout Kaela</p>
                <p className="text-[15px] font-bold">{step.title}</p>
              </div>
              <p className="text-[10px] text-[#8b95c2]">
                {stepIndex + 1}/{steps.length}
              </p>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-[#d6deff]">{step.body}</p>
          </div>
        </div>

        <div className="flex items-center justify-between border-t-2 border-[#2a3450] bg-[#0b1020] px-4 py-3">
          <div className="flex gap-2">
            <button
              className="border-2 border-[#2a3450] bg-[#10192d] px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-[#9aa7cc] hover:border-[#5dadec] hover:text-[#5dadec] disabled:opacity-40"
              disabled={stepIndex === 0}
              onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
              type="button"
            >
              Back
            </button>
            <button
              className="border-2 border-[#2a3450] bg-[#10192d] px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-[#8b95c2] hover:border-[#ff4d6d] hover:text-[#ff4d6d]"
              onClick={finish}
              type="button"
            >
              Skip
            </button>
          </div>

          <button
            className="border-2 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-black shadow-[3px_3px_0_0_#000]"
            onClick={() => {
              if (stepIndex === steps.length - 1) {
                finish();
                return;
              }
              setStepIndex((current) => Math.min(steps.length - 1, current + 1));
            }}
            style={{ borderColor: step.accent, backgroundColor: step.accent }}
            type="button"
          >
            {stepIndex === steps.length - 1 ? "Finish" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
