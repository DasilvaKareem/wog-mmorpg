import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useGameBridge } from "@/hooks/useGameBridge";
import type { Entity } from "@/types";

interface Guild {
  guildId: number;
  name: string;
  description: string;
  founder: string;
  treasury: number;
  level: number;
  reputation: number;
  status: string;
  createdAt: number;
  memberCount: number;
  members?: Member[];
}

interface Member {
  address: string;
  rank: string;
  joinedAt: number;
  contributedGold: number;
}

interface Proposal {
  proposalId: number;
  guildId: number;
  proposer: string;
  proposalType: string;
  description: string;
  createdAt: number;
  votingEndsAt: number;
  timeRemaining: number;
  yesVotes: number;
  noVotes: number;
  status: string;
  targetAddress: string;
  targetAmount: number;
}

interface RegistrarResponse {
  npcId: string;
  npcName: string;
  npcType: string;
  zoneId: string;
  description: string;
  activeGuilds: Guild[];
  endpoints: {
    createGuild: string;
    listGuilds: string;
    viewGuild: string;
  };
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000 - timestamp);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatTimeRemaining(seconds: number): string {
  if (seconds <= 0) return "Expired";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function GuildDialog(): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [registrar, setRegistrar] = React.useState<Entity | null>(null);
  const [zoneId, setZoneId] = React.useState("human-meadow");
  const [guilds, setGuilds] = React.useState<Guild[]>([]);
  const [selectedGuild, setSelectedGuild] = React.useState<Guild | null>(null);
  const [proposals, setProposals] = React.useState<Proposal[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [loadingDetails, setLoadingDetails] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState("guilds");

  const loadRegistrar = React.useCallback(async (nextZoneId: string, entityId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/guild/registrar/${nextZoneId}/${entityId}`);
      if (!res.ok) {
        setGuilds([]);
        return;
      }
      const data: RegistrarResponse = await res.json();
      setGuilds(data.activeGuilds);
    } catch {
      setGuilds([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadGuildDetails = React.useCallback(async (guildId: number) => {
    setLoadingDetails(true);
    try {
      // Load guild details with members
      const guildRes = await fetch(`/guild/${guildId}`);
      if (guildRes.ok) {
        const guildData: Guild = await guildRes.json();
        setSelectedGuild(guildData);
      }

      // Load proposals for this guild
      const proposalsRes = await fetch(`/guild/${guildId}/proposals`);
      if (proposalsRes.ok) {
        const proposalsData: Proposal[] = await proposalsRes.json();
        setProposals(proposalsData);
      }
    } catch (error) {
      console.error("Failed to load guild details:", error);
    } finally {
      setLoadingDetails(false);
    }
  }, []);

  useGameBridge("zoneChanged", ({ zoneId: nextZoneId }) => {
    setZoneId(nextZoneId);
  });

  useGameBridge("guildRegistrarClick", (entity: Entity) => {
    if (entity.type !== "guild-registrar") return;
    setRegistrar(entity);
    setOpen(true);
    setSelectedGuild(null);
    setProposals([]);
    setActiveTab("guilds");
    void loadRegistrar(zoneId, entity.id);
  });

  const handleGuildClick = (guild: Guild) => {
    setSelectedGuild(guild);
    setActiveTab("details");
    void loadGuildDetails(guild.guildId);
  };

  const handleBackToGuilds = () => {
    setSelectedGuild(null);
    setProposals([]);
    setActiveTab("guilds");
  };

  const getRankBadgeVariant = (rank: string) => {
    if (rank === "Founder") return "destructive";
    if (rank === "Officer") return "default";
    return "secondary";
  };

  const getProposalTypeBadge = (type: string) => {
    const typeMap: Record<string, string> = {
      "withdraw-gold": "💰",
      "kick-member": "👢",
      "promote-officer": "⬆️",
      "demote-officer": "⬇️",
      "disband-guild": "💥",
    };
    return typeMap[type] || "📝";
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[80vh] max-w-4xl overflow-y-auto border-4 border-[#29334d] bg-[#11182b] p-0 text-[#f1f5ff]">
        <DialogHeader className="border-b-2 border-[#29334d] bg-[#1a2340] p-4">
          <DialogTitle className="font-mono text-sm text-[#00ff88]">
            {registrar ? `${registrar.name} - Guild Registry` : "Guild Registry"}
          </DialogTitle>
          <DialogDescription className="font-mono text-[9px] text-[#9aa7cc]">
            {selectedGuild ? `Viewing: ${selectedGuild.name}` : "Browse active guilds and their operations"}
          </DialogDescription>
        </DialogHeader>

        <div className="p-4">
          {selectedGuild ? (
            // Guild Details View
            <div className="space-y-4">
              <Button onClick={handleBackToGuilds} size="sm" variant="outline">
                ← Back to Guilds
              </Button>

              {/* Guild Info Card */}
              <Card className="border-2 border-[#29334d] bg-[#1a2340]">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-base text-[#00ff88]">
                        {selectedGuild.name}
                      </CardTitle>
                      <CardDescription className="text-[9px]">
                        {selectedGuild.description}
                      </CardDescription>
                    </div>
                    <Badge>{selectedGuild.status}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-[9px]">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex items-center justify-between border-2 border-[#29334d] bg-[#11182b] p-2">
                      <span className="text-[#9aa7cc]">Treasury</span>
                      <Badge variant="success">{selectedGuild.treasury.toFixed(2)} gold</Badge>
                    </div>
                    <div className="flex items-center justify-between border-2 border-[#29334d] bg-[#11182b] p-2">
                      <span className="text-[#9aa7cc]">Members</span>
                      <Badge variant="secondary">{selectedGuild.memberCount}</Badge>
                    </div>
                    <div className="flex items-center justify-between border-2 border-[#29334d] bg-[#11182b] p-2">
                      <span className="text-[#9aa7cc]">Level</span>
                      <Badge variant="secondary">{selectedGuild.level}</Badge>
                    </div>
                    <div className="flex items-center justify-between border-2 border-[#29334d] bg-[#11182b] p-2">
                      <span className="text-[#9aa7cc]">Reputation</span>
                      <Badge variant="secondary">{selectedGuild.reputation}</Badge>
                    </div>
                  </div>
                  <div className="border-2 border-[#29334d] bg-[#11182b] p-2">
                    <span className="text-[#9aa7cc]">Founder:</span> {truncateAddress(selectedGuild.founder)}
                  </div>
                  <div className="border-2 border-[#29334d] bg-[#11182b] p-2">
                    <span className="text-[#9aa7cc]">Created:</span> {formatTimeAgo(selectedGuild.createdAt)}
                  </div>
                </CardContent>
              </Card>

              {/* Tabs for Members and Proposals */}
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-2 bg-[#1a2340]">
                  <TabsTrigger value="details">Members</TabsTrigger>
                  <TabsTrigger value="proposals">
                    Proposals {proposals.length > 0 && `(${proposals.length})`}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="details" className="mt-4">
                  {loadingDetails ? (
                    <div className="text-center text-[9px] text-[#9aa7cc]">Loading members...</div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-[8px]">Address</TableHead>
                          <TableHead className="text-[8px]">Rank</TableHead>
                          <TableHead className="text-[8px]">Joined</TableHead>
                          <TableHead className="text-[8px]">Contributed</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedGuild.members?.map((member) => (
                          <TableRow key={member.address}>
                            <TableCell className="font-mono text-[9px]">
                              {truncateAddress(member.address)}
                            </TableCell>
                            <TableCell>
                              <Badge size="sm" variant={getRankBadgeVariant(member.rank)}>
                                {member.rank}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-[9px] text-[#9aa7cc]">
                              {formatTimeAgo(member.joinedAt)}
                            </TableCell>
                            <TableCell className="text-[9px] text-[#00ff88]">
                              {member.contributedGold.toFixed(2)} gold
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </TabsContent>

                <TabsContent value="proposals" className="mt-4">
                  {loadingDetails ? (
                    <div className="text-center text-[9px] text-[#9aa7cc]">Loading proposals...</div>
                  ) : proposals.length === 0 ? (
                    <div className="text-center text-[9px] text-[#9aa7cc]">
                      No proposals for this guild yet
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {proposals.map((proposal) => (
                        <Card
                          key={proposal.proposalId}
                          className="border-2 border-[#29334d] bg-[#1a2340]"
                        >
                          <CardHeader className="pb-2">
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-lg">{getProposalTypeBadge(proposal.proposalType)}</span>
                                <div>
                                  <CardTitle className="text-sm">
                                    Proposal #{proposal.proposalId}
                                  </CardTitle>
                                  <CardDescription className="text-[8px]">
                                    {proposal.proposalType.replace(/-/g, " ")}
                                  </CardDescription>
                                </div>
                              </div>
                              <Badge variant={proposal.status === "active" ? "default" : "secondary"}>
                                {proposal.status}
                              </Badge>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-2 text-[9px]">
                            <p className="text-[#f1f5ff]">{proposal.description}</p>
                            <div className="grid grid-cols-2 gap-2 border-t-2 border-[#29334d] pt-2">
                              <div>
                                <span className="text-[#9aa7cc]">Proposer:</span> {truncateAddress(proposal.proposer)}
                              </div>
                              <div>
                                <span className="text-[#9aa7cc]">Time Left:</span> {formatTimeRemaining(proposal.timeRemaining)}
                              </div>
                              <div>
                                <span className="text-[#00ff88]">Yes:</span> {proposal.yesVotes}
                              </div>
                              <div>
                                <span className="text-[#ff6b6b]">No:</span> {proposal.noVotes}
                              </div>
                              {proposal.targetAmount > 0 && (
                                <div className="col-span-2">
                                  <span className="text-[#9aa7cc]">Amount:</span> {proposal.targetAmount} gold
                                </div>
                              )}
                              {proposal.targetAddress !== "0x0000000000000000000000000000000000000000" && (
                                <div className="col-span-2">
                                  <span className="text-[#9aa7cc]">Target:</span> {truncateAddress(proposal.targetAddress)}
                                </div>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          ) : (
            // Guild List View
            <div className="space-y-4">
              <Card className="border-2 border-[#29334d] bg-[#1a2340]">
                <CardHeader>
                  <CardTitle className="text-sm text-[#00ff88]">Guild Creation</CardTitle>
                  <CardDescription className="text-[9px]">
                    Cost: 50 gold (creation fee) + 100 gold (minimum deposit) = 150 gold total
                  </CardDescription>
                </CardHeader>
              </Card>

              {loading ? (
                <div className="text-center text-[9px] text-[#9aa7cc]">Loading guilds...</div>
              ) : guilds.length === 0 ? (
                <Card className="border-2 border-[#29334d] bg-[#1a2340] p-6 text-center">
                  <p className="text-[9px] text-[#9aa7cc]">No active guilds in this zone yet</p>
                  <p className="mt-2 text-[8px] text-[#9aa7cc]">Be the first to create one!</p>
                </Card>
              ) : (
                <div className="space-y-2">
                  {guilds.map((guild) => (
                    <Card
                      key={guild.guildId}
                      className="cursor-pointer border-2 border-[#29334d] bg-[#1a2340] transition-colors hover:border-[#00ff88]"
                      onClick={() => handleGuildClick(guild)}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between">
                          <div>
                            <CardTitle className="text-sm text-[#00ff88]">{guild.name}</CardTitle>
                            <CardDescription className="text-[9px]">
                              {guild.description}
                            </CardDescription>
                          </div>
                          <Badge variant="secondary">{guild.memberCount} members</Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-2 text-[9px]">
                        <div className="flex items-center justify-between">
                          <span className="text-[#9aa7cc]">Treasury</span>
                          <Badge variant="success">{guild.treasury.toFixed(2)} gold</Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[#9aa7cc]">Level</span>
                          <Badge variant="secondary">Lvl {guild.level}</Badge>
                        </div>
                        <div className="text-[8px] text-[#9aa7cc]">
                          Founded by {truncateAddress(guild.founder)} • {formatTimeAgo(guild.createdAt)}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
