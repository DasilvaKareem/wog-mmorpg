/**
 * Building material definitions — tokenId 190n-199n.
 * Used for the progressive building system on claimed plots.
 */

export interface BuildingMaterialDef {
  tokenId: bigint;
  name: string;
  description: string;
  copperPrice: number;
}

export const BUILDING_MATERIALS: BuildingMaterialDef[] = [
  { tokenId: 190n, name: "Lumber", description: "Sturdy planks cut from hardwood trees. The backbone of any structure.", copperPrice: 15 },
  { tokenId: 191n, name: "Stone Blocks", description: "Quarried stone blocks, smooth and heavy. Essential for foundations.", copperPrice: 20 },
  { tokenId: 192n, name: "Iron Nails", description: "Forged iron nails for securing wooden joints. Sold in bundles of 50.", copperPrice: 10 },
  { tokenId: 193n, name: "Thatch Bundle", description: "Dried reed bundles for roofing. Waterproof when layered properly.", copperPrice: 8 },
  { tokenId: 194n, name: "Clay Bricks", description: "Kiln-fired bricks for sturdy walls and chimneys.", copperPrice: 18 },
  { tokenId: 195n, name: "Glass Panes", description: "Clear glass panes for windows. Fragile but lets in light.", copperPrice: 25 },
  { tokenId: 196n, name: "Timber Frame", description: "Pre-cut A-frame timbers for structural support.", copperPrice: 30 },
  { tokenId: 197n, name: "Mortar", description: "Cement-like paste for bonding stone and brick together.", copperPrice: 12 },
  { tokenId: 198n, name: "Roof Tiles", description: "Terracotta tiles for weatherproof roofing.", copperPrice: 22 },
  { tokenId: 199n, name: "Carpenter's Hammer", description: "A heavy claw hammer used for construction work.", copperPrice: 35 },
];
