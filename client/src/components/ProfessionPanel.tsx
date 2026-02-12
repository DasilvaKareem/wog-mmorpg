import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useWallet } from "@/hooks/useWallet";

const PROFESSION_ICONS: Record<string, string> = {
  mining: "⛏️",
  herbalism: "🌿",
  skinning: "🔪",
  blacksmithing: "🔨",
  alchemy: "⚗️",
  cooking: "🍖",
};

const PROFESSION_COLORS: Record<string, string> = {
  mining: "bg-amber-900/20 border-amber-700",
  herbalism: "bg-green-900/20 border-green-700",
  skinning: "bg-red-900/20 border-red-700",
  blacksmithing: "bg-gray-900/20 border-gray-600",
  alchemy: "bg-purple-900/20 border-purple-700",
  cooking: "bg-orange-900/20 border-orange-700",
};

export function ProfessionPanel(): React.ReactElement {
  const { isConnected, professions, professionsLoading } = useWallet();

  if (!isConnected) {
    return (
      <Card className="pointer-events-auto absolute left-4 top-4 z-30 w-80">
        <CardHeader className="pb-2">
          <CardTitle>Professions</CardTitle>
          <CardDescription>Connect wallet to view</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-[8px] text-[#9aa7cc]">No wallet connected</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="pointer-events-auto absolute left-4 top-4 z-30 w-80">
      <CardHeader className="pb-2">
        <CardTitle>Professions</CardTitle>
        <CardDescription>Learned skills & crafting</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-[9px]">
        {professionsLoading ? (
          <div className="flex items-center gap-2 text-[8px] text-[#9aa7cc]">
            <Spinner />
            <span>Loading professions...</span>
          </div>
        ) : (
          <>
            {/* Learned Professions */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[8px] uppercase tracking-wide text-[#9aa7cc]">
                  Learned ({professions?.learned.length ?? 0})
                </span>
              </div>

              {professions?.learned && professions.learned.length > 0 ? (
                <div className="space-y-1">
                  {professions.learned.map((professionType) => {
                    const info = professions.available.find(
                      (p) => p.professionType === professionType
                    );
                    const icon = PROFESSION_ICONS[professionType] ?? "📜";
                    const colorClass = PROFESSION_COLORS[professionType] ?? "bg-blue-900/20 border-blue-700";

                    return (
                      <div
                        key={professionType}
                        className={`flex items-center gap-2 border-2 p-2 ${colorClass}`}
                      >
                        <span className="text-sm">{icon}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[9px] font-semibold text-[#f1f5ff]">
                            {info?.name ?? professionType}
                          </p>
                          <p className="truncate text-[7px] text-[#9aa7cc]">
                            {info?.description ?? "Crafting profession"}
                          </p>
                        </div>
                        <Badge variant="success" className="text-[7px]">
                          ✓ Learned
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="border-2 border-dashed border-[#29334d] bg-[#11182b]/50 p-3 text-center">
                  <p className="text-[8px] text-[#9aa7cc]">
                    No professions learned yet
                  </p>
                  <p className="mt-1 text-[7px] text-[#7888a8]">
                    Visit profession trainers in-game
                  </p>
                </div>
              )}
            </div>

            {/* Available Professions */}
            {professions?.available && professions.available.length > 0 && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[8px] uppercase tracking-wide text-[#9aa7cc]">
                    Available to Learn
                  </span>
                </div>

                <div className="max-h-32 space-y-1 overflow-auto pr-1">
                  {professions.available
                    .filter((p) => !professions.learned.includes(p.professionType))
                    .map((profession) => {
                      const icon = PROFESSION_ICONS[profession.professionType] ?? "📜";
                      const colorClass = PROFESSION_COLORS[profession.professionType] ?? "bg-blue-900/20 border-blue-700";

                      return (
                        <div
                          key={profession.professionType}
                          className={`flex items-center gap-2 border-2 p-2 opacity-60 ${colorClass}`}
                        >
                          <span className="text-sm opacity-50">{icon}</span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[9px] font-semibold text-[#f1f5ff]">
                              {profession.name}
                            </p>
                            <p className="truncate text-[7px] text-[#9aa7cc]">
                              {profession.description}
                            </p>
                          </div>
                          <Badge variant="secondary" className="text-[7px]">
                            {profession.cost}g
                          </Badge>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
