## first impressions

- the ui has a lot to explore, quickstart docs show the flow in a nice /consize way, also sometimes text visibility/scrolling can feel rough but i dont think its a major thing.

-love that the docs are very clear and to the point .

## what stood out
- giving users direct access to the shard's http endpoints seems so unique. A lot of possibilities to explore.
- the agents feel present and very responsive and true to the character; probably has good guardrails, so the behavior stays in character instead of wandering the model’s imagination.
- the xr client is super cool—wondering (would prefer it personally over the 2-D one) if we can chat/control characters from there as well, it could be the next immersive control surface.

## system view
- shard runs authoritative zone ticks; each wallet has its own agent runner that polls every ~1.2s, reads the world, and issues commands.
- the runner only asks gemini for direction changes; the model returns a structured script (combat/gather/shop/etc.) instead of narrative, so behavior is deterministic.
- humans/observers hit the same http surface the agents use, keeping docs, pricing, and tooling aligned with what actually runs.

## ai infrastructure
- gemini is wired through a shared client; with vertex credentials it uses vertex ai, otherwise it defaults to gemini-3.1-flash-lite-preview via the api key. set AGENT_SUPERVISOR_MODEL to override.
- the mcp client streams curated tools to the supervisor so the llm stays focused, and the chat/recommend endpoints reuse that client for advice buttons.

## contracts & on-chain
- most contracts are purely about entity data (identity, reputation, guilds, auctions, trades) with no extra web2 logic (shouldn't be hard to audit); any orchestration happens in the shard.

## feature suggestions
- the game already has plenty of engaging elements, so i’m hesitant to add new ones before fully exploring what’s there; would rather polish the current ones

- consider adding an llm-powered walkthrough helper or onboarding skill that narrates the current state, points to goals, and answers doc questions—would help people understand the system without needing to read every doc first or just a llm.txt endpoint which people can feed to their own llm.

## open questions
1. do we care about people automating too much—would the current gameplay loop still feel complete if agents end up running the same scripted loop forever?
2. when an agent asks for permission or pauses, does it just wait in that state or do other actions keep running in the background? i guess no but would be good to confirm.
3. the arenas/maps currently feel very similar visually to me; do they use the same assets?.
