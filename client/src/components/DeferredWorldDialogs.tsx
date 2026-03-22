import * as React from "react";

import { AuctionHouseDialog } from "@/components/AuctionHouseDialog";
import { ColiseumDialog } from "@/components/ColiseumDialog";
import { GuildDialog } from "@/components/GuildDialog";
import { InspectDialog } from "@/components/InspectDialog";
import { NpcInfoDialog } from "@/components/NpcInfoDialog";
import { NpcDialogueOverlay } from "@/components/NpcDialogueOverlay";
import { InventoryDialog } from "@/components/InventoryDialog";

export function DeferredWorldDialogs(): React.ReactElement {
  return (
    <>
      <GuildDialog />
      <AuctionHouseDialog />
      <ColiseumDialog />
      <InspectDialog />
      <NpcInfoDialog />
      <NpcDialogueOverlay />
      <InventoryDialog />
    </>
  );
}
