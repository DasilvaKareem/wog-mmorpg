Place XR background music tracks here.

Zone → track mapping (in `src/main.ts` → `ZONE_BGM_TRACKS`):

- `village-square` → `world-theme`  (default fallback)
- `emerald-woods` → `Emerald Woods`
- `moondancer-glade` → `007 moondancer glade`
- `felsrock-citadel` → `008 Felsrock Citadel`
- `lake-lumina` → `009 Lake Lumina`

For each track `T`, `BgmManager` tries these URLs in order and uses the first
that loads (parity with the `client/` hook):

1. `/audio/<T>.mp3`
2. `/audio/<T>.ogg`
3. `/audio/bgm/<T>.mp3`
4. `/audio/bgm/<T>.ogg`
5. `/audio/bgm/bgm_<normalized>.ogg`
6. `/audio/bgm/bgm_<normalized>.mp3`

`<normalized>` lowercases, strips a leading numeric prefix (e.g. `007 `), and
replaces non-alphanumerics with underscores. Example: `007 moondancer glade` →
`moondancer_glade`, so `bgm_moondancer_glade.ogg` is accepted.

When `VITE_ASSET_BASE_URL` is set (e.g. `https://assets.wog.gg`), all paths are
resolved against that CDN instead of `/audio`.
