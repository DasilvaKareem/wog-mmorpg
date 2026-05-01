Place XR background music tracks here.

Standard naming convention for BGM: `lowercase-kebab-case.mp3`

Zone → track mapping (in `src/main.ts` → `ZONE_BGM_URLS`):

- Default (Title Screen) → `secrets-of-the-library.mp3`
- `village-square` → `chronicles-of-the-verdant-valley.mp3`
- `emerald-woods` → `emerald-woods.mp3`
- `moondancer-glade` → `moondancer-glade.mp3`
- `felsrock-citadel` → `felsrock-citadel.mp3`
- `lake-lumina` → `lake-lumina.mp3`
- `wild-meadow` → `wild-meadow.mp3`

For each track, `BgmManager` uses the direct URL resolved via `audioUrl()`.

When `VITE_ASSET_BASE_URL` is set (e.g. `https://assets.wog.gg`), all paths are
resolved against that CDN instead of the local `/audio` path.
