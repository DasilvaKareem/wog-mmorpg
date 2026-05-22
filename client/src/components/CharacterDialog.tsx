import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCharacters } from "@/hooks/useCharacters";
import { useWallet } from "@/hooks/useWallet";
import { getAuthToken } from "@/lib/agentAuth";
import { WalletManager } from "@/lib/walletManager";
import { gameBus } from "@/lib/eventBus";
import { API_URL } from "@/config";
import { fetchDiary, type DiaryEntry } from "@/ShardClient";
import { trackViewCharacter, trackAgentTaskStarted, trackAgentTaskCompleted } from "@/lib/analytics";

type View = "list" | "detail";

interface CharacterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRequestCreate?: () => void;
}

/* ── Rarity colors ───────────────────────────────────────────────── */

const RARITY_COLORS: Record<string, string> = {
  common: "#9aa7cc",
  uncommon: "#54f28b",
  rare: "#5dadec",
  epic: "#b48efa",
  legendary: "#ffcc00",
};

/* ── Diary helpers ───────────────────────────────────────────────── */

const DIARY_COLORS: Record<string, string> = {
  kill: "#54f28b",
  death: "#f25454",
  level_up: "#f2c854",
  zone_transition: "#5dadec",
  equip: "#9aa7cc",
  unequip: "#9aa7cc",
  buy: "#ffcc00",
  sell: "#ffcc00",
  craft: "#b48efa",
  brew: "#b48efa",
  cook: "#b48efa",
  mine: "#f2a854",
  gather_herb: "#f2a854",
  skin: "#f2a854",
  spawn: "#54f28b",
  consume: "#b48efa",
  repair: "#9aa7cc",
  quest_complete: "#5dadec",
};

const DIARY_TAGS: Record<string, string> = {
  kill: "KILL",
  death: "DEATH",
  level_up: "LEVEL",
  zone_transition: "ZONE",
  equip: "EQUIP",
  unequip: "EQUIP",
  buy: "TRADE",
  sell: "TRADE",
  craft: "CRAFT",
  brew: "CRAFT",
  cook: "CRAFT",
  mine: "GATHER",
  gather_herb: "GATHER",
  skin: "GATHER",
  spawn: "SPAWN",
  consume: "USE",
  repair: "REPAIR",
  quest_complete: "QUEST",
};

function diaryTimeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function CharacterDialog({ open, onOpenChange, onRequestCreate }: CharacterDialogProps): React.ReactElement {
  const { address, isConnected, balance } = useWallet();
  const { characters, loading, load } = useCharacters();

  const [view, setView] = React.useState<View>("list");
  const [selectedCharacter, setSelectedCharacter] = React.useState<typeof characters[number] | null>(null);
  const [deploying, setDeploying] = React.useState(false);
  const [deployResult, setDeployResult] = React.useState<string | null>(null);
  const [diaryEntries, setDiaryEntries] = React.useState<DiaryEntry[]>([]);
  const [diaryLoading, setDiaryLoading] = React.useState(false);
  const [expandedEntry, setExpandedEntry] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || !address) return;
    void load(address);
  }, [open, address, load]);

  React.useEffect(() => {
    if (!open) {
      setView("list");
      setDeployResult(null);
      setDiaryEntries([]);
      setExpandedEntry(null);
    }
  }, [open]);

  React.useEffect(() => {
    if (view !== "detail" || !address) return;
    setDiaryLoading(true);
    // Strip class suffix to get the base character name for filtering
    const baseName = selectedCharacter?.name?.replace(/\s+the\s+\w+$/i, "").trim() ?? "";
    void fetchDiary(address, 50).then((entries) => {
      // Filter to only this character's diary entries
      const filtered = baseName
        ? entries.filter((e) => e.characterName === baseName)
        : entries;
      setDiaryEntries(filtered.slice(0, 20));
      setDiaryLoading(false);
    });
  }, [view, address, selectedCharacter]);

  async function handleDeploy(character: typeof characters[number]) {
    if (!address || deploying) return;
    setDeploying(true);
    setDeployResult(null);
    try {
      const token = await getAuthToken(address);
      if (!token) {
        setDeployResult("Failed to authenticate. Try reconnecting your wallet.");
        return;
      }

      // Stop existing agent first (saves + despawns old entity)
      await fetch(`${API_URL}/agent/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ walletAddress: address }),
      });

      // Deploy the selected character
      trackAgentTaskStarted({ walletAddress: address, characterName: character.name, zoneId: undefined });
      const res = await fetch(`${API_URL}/agent/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          walletAddress: address,
          characterName: character.name.replace(/\s+the\s+\w+$/i, ""),
          characterTokenId: character.characterTokenId ?? character.tokenId,
          raceId: character.properties.race,
          classId: character.properties.class,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.custodialWallet) {
          WalletManager.getInstance().setCustodialAddress(data.custodialWallet);
        }
        gameBus.emit("charactersChanged", { walletAddress: address });
        trackAgentTaskCompleted({ walletAddress: address, entityId: data.entityId, zoneId: data.zoneId });
        setDeployResult(`Deployed! Agent spawned in ${data.zoneId}`);
        if (data.zoneId) {
          gameBus.emit("followPlayer", { zoneId: data.zoneId, walletAddress: address });
        } else {
          gameBus.emit("lockToPlayer", { walletAddress: address });
        }
      } else {
        setDeployResult(data.error ?? "Deploy failed");
      }
    } catch (err: any) {
      setDeployResult(err.message ?? "Deploy failed");
    } finally {
      setDeploying(false);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="text-[9px]">
        <DialogHeader>
          <DialogTitle>Character Console</DialogTitle>
          <DialogDescription>
            {isConnected
              ? "View your roster or mint a new character."
              : "Connect wallet to view and create characters."}
          </DialogDescription>
        </DialogHeader>

        {!isConnected ? (
          <div className="border-2 border-black bg-[#ff4d6d] p-3 text-[8px] text-black shadow-[3px_3px_0_0_#000]">
            Wallet not connected.
          </div>
        ) : null}

        {isConnected && view === "list" ? (
          <div className="space-y-3">
            {loading ? <p className="text-[8px] text-[#9aa7cc]">Loading characters...</p> : null}

            {!loading && characters.length === 0 ? (
              <p className="border-2 border-[#2a3450] bg-[#11192d] p-3 text-[8px] text-[#9aa7cc]">
                No characters found.
              </p>
            ) : null}

            {!loading && characters.length > 0 ? (
              <div className="max-h-72 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Race</TableHead>
                      <TableHead>Class</TableHead>
                      <TableHead>Lvl</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {characters.map((character) => (
                      <TableRow key={`${character.tokenId}-${character.name}`}>
                        <TableCell>{character.name}</TableCell>
                        <TableCell>{character.properties.race}</TableCell>
                        <TableCell>{character.properties.class}</TableCell>
                        <TableCell>{character.properties.level}</TableCell>
                        <TableCell>
                          <Button
                            className="h-6 px-2 text-[7px]"
                            onClick={() => {
                              setSelectedCharacter(character);
                              setView("detail");
                              trackViewCharacter({
                                characterName: character.name,
                                level: character.properties.level,
                                race: character.properties.race,
                                class: character.properties.class,
                              });
                            }}
                            type="button"
                            variant="secondary"
                          >
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}

            <DialogFooter>
              <Button onClick={() => onOpenChange(false)} type="button" variant="secondary">
                Close
              </Button>
              <Button onClick={() => onRequestCreate?.()} type="button">
                Create Character
              </Button>
            </DialogFooter>
          </div>
        ) : null}

        {isConnected && view === "detail" && selectedCharacter ? (
          <div className="space-y-3">
            {/* Character header */}
            <div className="border-2 border-[#2a3450] bg-[#11192d] p-3">
              <p className="text-[10px] text-[#f1f5ff] font-bold">{selectedCharacter.name}</p>
              <div className="flex gap-2 mt-1">
                <Badge variant="secondary">{selectedCharacter.properties.race}</Badge>
                <Badge variant="secondary">{selectedCharacter.properties.class}</Badge>
                <Badge variant="default">Lvl {selectedCharacter.properties.level}</Badge>
              </div>
              <p className="mt-2 text-[8px] text-[#9aa7cc]">XP: {selectedCharacter.properties.xp ?? 0}</p>
              <p className="text-[7px] text-[#565f89] mt-1">Token ID: {selectedCharacter.tokenId}</p>
            </div>

            {/* Stats */}
            <div>
              <p className="mb-1 text-[8px] uppercase tracking-wide text-[#9aa7cc]">Base Stats</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(selectedCharacter.properties.stats || {}).map(([key, value]) => (
                  <Badge key={key} variant="secondary">
                    {key.toUpperCase()}: {value}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Equipment */}
            {selectedCharacter.properties.equipment && Object.keys(selectedCharacter.properties.equipment).length > 0 ? (
              <div>
                <p className="mb-1 text-[8px] uppercase tracking-wide text-[#9aa7cc]">Equipped Items</p>
                <div className="space-y-1 max-h-32 overflow-auto">
                  {Object.entries(selectedCharacter.properties.equipment).map(([slot, item]: [string, any]) => (
                    <div
                      key={slot}
                      className="border-2 border-[#29334d] bg-[#11182b] px-2 py-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[8px] text-[#9aa7cc] uppercase">{slot}</span>
                        <Badge variant="secondary">#{item.tokenId}</Badge>
                      </div>
                      <p className="text-[8px] text-[#f1f5ff] mt-0.5">
                        Durability: {item.durability}/{item.maxDurability}
                        {item.broken && <span className="text-[#ff4d6d] ml-2">BROKEN</span>}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="border-2 border-[#29334d] bg-[#11182b] p-2 text-center text-[8px] text-[#9aa7cc]">
                No equipment equipped
              </div>
            )}

            {/* Active quests */}
            {selectedCharacter.properties.activeQuests && selectedCharacter.properties.activeQuests.length > 0 ? (
              <div>
                <p className="mb-1 text-[8px] uppercase tracking-wide text-[#9aa7cc]">Active Quests</p>
                <div className="space-y-1">
                  {selectedCharacter.properties.activeQuests.map((quest: any, idx: number) => (
                    <div
                      key={idx}
                      className="border-2 border-[#29334d] bg-[#11182b] px-2 py-1 text-[8px]"
                    >
                      <p className="text-[#f1f5ff]">{quest.questId}</p>
                      <p className="text-[#9aa7cc]">Progress: {quest.progress}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Gold + Inventory */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-[8px] uppercase tracking-wide text-[#9aa7cc]">Wallet</p>
                <div className="bg-[#54f28b] border-2 border-black px-1.5 py-0.5 shadow-[2px_2px_0_0_#000]">
                  <span className="text-[8px] font-bold text-black" style={{ fontFamily: "monospace" }}>
                    {balance?.gold ? `${balance.gold} GOLD` : "..."}
                  </span>
                </div>
              </div>
              <div
                className="border-2 overflow-y-auto"
                style={{
                  borderColor: "#29334d",
                  background: "#0a0e18",
                  maxHeight: 120,
                }}
              >
                {balance?.items?.length ? (
                  balance.items.map((item) => {
                    const rarityColor = RARITY_COLORS[item.rarity ?? "common"] ?? RARITY_COLORS.common;
                    return (
                      <div
                        key={`${item.tokenId}-${item.name}`}
                        className="flex items-center justify-between gap-2 border-b px-2 py-0.5 text-[8px]"
                        style={{ borderColor: "#1a2240" }}
                      >
                        <span className="truncate font-bold" style={{ color: rarityColor }}>
                          {item.name}
                        </span>
                        <span className="shrink-0 text-[#6b7a9e]" style={{ fontFamily: "monospace" }}>
                          x{item.balance}
                          {item.equipSlot ? ` | ${item.equipSlot}` : ""}
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <p className="p-2 text-[8px] text-[#6b7a9e]">No items</p>
                )}
              </div>
            </div>

            {/* Adventure Diary */}
            <div>
              <p className="mb-1 text-[8px] uppercase tracking-wide text-[#9aa7cc]">Adventure Diary</p>
              <div
                className="border-2 overflow-y-auto"
                style={{
                  borderColor: "#29334d",
                  background: "#0a0e18",
                  maxHeight: 160,
                  fontFamily: "monospace",
                }}
              >
                {diaryLoading ? (
                  <p className="p-2 text-[8px] text-[#6b7a9e]">Loading diary...</p>
                ) : diaryEntries.length === 0 ? (
                  <p className="p-2 text-[8px] text-[#6b7a9e]">No diary entries yet</p>
                ) : (
                  diaryEntries.map((entry) => {
                    const color = DIARY_COLORS[entry.action] ?? "#6b7a9e";
                    const tag = DIARY_TAGS[entry.action] ?? entry.action.toUpperCase().slice(0, 5);
                    const isExpanded = expandedEntry === entry.id;
                    return (
                      <div
                        key={entry.id}
                        className="border-b px-2 py-0.5 cursor-pointer hover:bg-[#11182b]"
                        style={{ borderColor: "#1a2240" }}
                        onClick={() => setExpandedEntry(isExpanded ? null : entry.id)}
                      >
                        <div className="flex items-start gap-1 text-[8px]">
                          <span
                            className="shrink-0 font-bold"
                            style={{ color, width: 48, display: "inline-block" }}
                          >
                            [{tag}]
                          </span>
                          <span className="flex-1 text-[#f1f5ff]">{entry.headline}</span>
                          <span className="shrink-0 text-[#6b7a9e]">{diaryTimeAgo(entry.timestamp)}</span>
                        </div>
                        {isExpanded && entry.narrative && (
                          <p className="mt-0.5 text-[7px] text-[#9aa7cc] pl-[52px] pb-0.5">
                            {entry.narrative}
                          </p>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Deploy result message */}
            {deployResult && (
              <div className={`border-2 p-2 text-[8px] shadow-[3px_3px_0_0_#000] ${
                deployResult.startsWith("Deployed")
                  ? "border-black bg-[#54f28b] text-black"
                  : "border-black bg-[#ff4d6d] text-black"
              }`}>
                {deployResult}
              </div>
            )}

            <DialogFooter>
              <Button onClick={() => { setView("list"); setDeployResult(null); }} type="button" variant="secondary">
                Back to List
              </Button>
              <Button
                disabled={deploying}
                onClick={() => { if (selectedCharacter) void handleDeploy(selectedCharacter); }}
                type="button"
              >
                {deploying ? "Deploying..." : "Deploy Agent"}
              </Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
