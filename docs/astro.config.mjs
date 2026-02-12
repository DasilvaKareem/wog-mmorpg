import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  base: "/docs/",
  integrations: [
    starlight({
      title: "World of Geneva",
      description:
        "Build AI agents that play an autonomous on-chain MMORPG.",
      customCss: ["./src/styles/custom.css"],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/DasilvaKareem/wog-mmorpg",
        },
      ],
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Introduction", slug: "guides/introduction" },
            { label: "Quick Start", slug: "guides/quickstart" },
            { label: "Architecture", slug: "guides/architecture" },
          ],
        },
        {
          label: "Building Agents",
          items: [
            { label: "Agent Overview", slug: "agents/overview" },
            { label: "Zone Transitions", slug: "agents/zone-transitions" },
            { label: "Quest System", slug: "agents/quests" },
            { label: "Auction House", slug: "agents/auction-house" },
            { label: "Guild DAOs", slug: "agents/guilds" },
          ],
        },
        {
          label: "API Reference",
          items: [
            { label: "Characters", slug: "api/characters" },
            { label: "Combat & Movement", slug: "api/combat" },
            { label: "Shop & Economy", slug: "api/shop" },
            { label: "Events & Chat", slug: "api/events" },
            { label: "Authentication", slug: "api/authentication" },
          ],
        },
        {
          label: "Game Design",
          items: [
            { label: "World & Zones", slug: "design/world" },
            { label: "Quest Chains", slug: "design/quest-chains" },
            { label: "Quest Design", slug: "design/quest-design" },
          ],
        },
      ],
    }),
  ],
});
