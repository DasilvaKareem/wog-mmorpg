import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCharacters } from "@/hooks/useCharacters";
import { useWallet } from "@/hooks/useWallet";
import type { CharacterCreateResponse, CharacterStats } from "@/types";

type View = "list" | "create" | "result" | "detail";

interface CharacterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function combineStats(base: CharacterStats, modifiers: CharacterStats): CharacterStats {
  const keys = Object.keys(base) as (keyof CharacterStats)[];
  const result = {} as CharacterStats;
  for (const key of keys) {
    result[key] = Math.floor(base[key] * modifiers[key]);
  }
  return result;
}

export function CharacterDialog({ open, onOpenChange }: CharacterDialogProps): React.ReactElement {
  const { address, isConnected } = useWallet();
  const { classes, races, characters, loading, load, create } = useCharacters();

  const [view, setView] = React.useState<View>("list");
  const [name, setName] = React.useState("");
  const [raceId, setRaceId] = React.useState("");
  const [classId, setClassId] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<CharacterCreateResponse | null>(null);
  const [selectedCharacter, setSelectedCharacter] = React.useState<typeof characters[number] | null>(null);

  React.useEffect(() => {
    if (!open || !address) return;
    void load(address);
  }, [open, address, load]);

  React.useEffect(() => {
    if (!open) {
      setView("list");
      setName("");
      setRaceId("");
      setClassId("");
      setResult(null);
      setSubmitting(false);
    }
  }, [open]);

  const selectedRace = races.find((race) => race.id === raceId);
  const selectedClass = classes.find((classInfo) => classInfo.id === classId);

  const previewStats =
    selectedRace && selectedClass
      ? combineStats(selectedClass.baseStats, selectedRace.statModifiers)
      : null;

  const canCreate = Boolean(
    address &&
      name.trim().length >= 2 &&
      name.trim().length <= 24 &&
      selectedRace &&
      selectedClass &&
      !submitting
  );

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
              <Button onClick={() => setView("create")} type="button">
                Create Character
              </Button>
            </DialogFooter>
          </div>
        ) : null}

        {isConnected && view === "create" ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[8px] uppercase tracking-wide text-[#9aa7cc]">Name</label>
                <Input
                  maxLength={24}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="2-24 characters"
                  value={name}
                />
              </div>

              <div>
                <label className="mb-1 block text-[8px] uppercase tracking-wide text-[#9aa7cc]">Race</label>
                <Select
                  onChange={(event) => setRaceId(event.target.value)}
                  value={raceId}
                >
                  <option value="">Select race...</option>
                  {races.map((race) => (
                    <option key={race.id} value={race.id}>
                      {race.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <label className="mb-1 block text-[8px] uppercase tracking-wide text-[#9aa7cc]">Class</label>
                <Select
                  onChange={(event) => setClassId(event.target.value)}
                  value={classId}
                >
                  <option value="">Select class...</option>
                  {classes.map((classInfo) => (
                    <option key={classInfo.id} value={classInfo.id}>
                      {classInfo.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="border-2 border-[#2a3450] bg-[#11192d] p-2 text-[8px] text-[#d6deff]">
                <p className="mb-1 uppercase tracking-wide text-[#9aa7cc]">Selection</p>
                <p>{selectedRace?.name ?? "No race"}</p>
                <p>{selectedClass?.name ?? "No class"}</p>
              </div>
            </div>

            {previewStats ? (
              <div className="border-2 border-[#2a3450] bg-[#11192d] p-2">
                <p className="mb-2 text-[8px] uppercase tracking-wide text-[#9aa7cc]">Stat Preview</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(previewStats).map(([key, value]) => (
                    <Badge key={key} variant="secondary">
                      {key}: {value}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}

            <DialogFooter>
              <Button onClick={() => setView("list")} type="button" variant="secondary">
                Back
              </Button>
              <Button
                disabled={!canCreate}
                onClick={() => {
                  if (!address || !selectedRace || !selectedClass) return;
                  setSubmitting(true);
                  void create({
                    walletAddress: address,
                    name: name.trim(),
                    race: selectedRace.id,
                    className: selectedClass.id,
                  })
                    .then((createResult) => {
                      if ("ok" in createResult && createResult.ok) {
                        setResult(createResult);
                        setView("result");
                      }
                    })
                    .finally(() => {
                      setSubmitting(false);
                    });
                }}
                type="button"
              >
                {submitting ? "Creating..." : "Mint Character"}
              </Button>
            </DialogFooter>
          </div>
        ) : null}

        {isConnected && view === "result" && result ? (
          <div className="space-y-3">
            <div className="border-2 border-black bg-[#54f28b] p-3 text-[8px] text-black shadow-[3px_3px_0_0_#000]">
              Character created successfully.
            </div>

            <div className="border-2 border-[#2a3450] bg-[#11192d] p-3">
              <p className="text-[9px] text-[#f1f5ff]">{result.character.name}</p>
              <p className="text-[8px] text-[#9aa7cc]">{result.character.description}</p>
              <p className="mt-2 break-all text-[8px] text-[#9aa7cc]">tx: {result.txHash}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              {Object.entries(result.character.stats).map(([key, value]) => (
                <Badge key={key} variant="secondary">
                  {key}: {value}
                </Badge>
              ))}
            </div>

            <DialogFooter>
              <Button
                onClick={() => {
                  if (!address) return;
                  void load(address).then(() => {
                    setView("list");
                  });
                }}
                type="button"
              >
                Done
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

            <DialogFooter>
              <Button onClick={() => setView("list")} type="button" variant="secondary">
                Back to List
              </Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
