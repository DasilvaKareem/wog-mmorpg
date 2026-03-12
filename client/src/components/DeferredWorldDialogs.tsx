import * as React from "react";

import { AuctionHouseDialog } from "@/components/AuctionHouseDialog";
import { ColiseumDialog } from "@/components/ColiseumDialog";
import { GuildDialog } from "@/components/GuildDialog";
import { InspectDialog } from "@/components/InspectDialog";
import { NpcInfoDialog } from "@/components/NpcInfoDialog";
import { ShopDialog } from "@/components/ShopDialog";

export function DeferredWorldDialogs(): React.ReactElement {
  return (
    <>
      <ShopDialog />
      <GuildDialog />
      <AuctionHouseDialog />
      <ColiseumDialog />
      <InspectDialog />
      <NpcInfoDialog />
    </>
  );
}
