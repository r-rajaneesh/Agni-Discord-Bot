# Art licences

Every frame in these atlases (`tiles`, `characters`, `animals`, `items`, `ui`) is **original (Agni)**: vector art drawn as code for Agni Valley in `scripts/art/`. `bun scripts/draw-art.ts` writes it to `art/<atlas>/<frame>.svg`, and `bun scripts/build-atlas.ts` turns those SVGs into the PNG atlases here. No third-party art is included, so there are no third-party licence terms and no attribution requirements.

| Atlas | Frames | Source |
|---|---|---|
| tiles | grass, path, water shimmer, farmland, tilled and watered soil, shop wall, roof, roof ridge and door, bridge, flowers, trees, rocks, portal, fences, house roof, wall, footing and door, locked-land veil, public fields, crop growth stages | original (Agni), `scripts/art/terrain.ts`, `scripts/art/crops.ts` |
| characters | farmer body (tintable shirt) and detail layers, 4 facings × 3 walk frames | original (Agni), `scripts/art/characters.ts` |
| animals | rabbit, deer, duck, boar, 4 facings × 3 walk frames | original (Agni), `scripts/art/animals.ts` |
| items | every item in `game/data/items.ts` | original (Agni), `scripts/art/items.ts` |
| ui | crown, player shadow | original (Agni), `scripts/art/characters.ts` |

## CC0 packs checked and not used

| Pack | URL | Licence | Why it is not used |
|---|---|---|---|
| Kenney, Top-down Shooter | https://kenney.nl/assets/top-down-shooter | CC0 1.0 (stated on the pack page) | Straight-overhead shooter style, with characters holding guns. It does not match the three-quarter farm view, and mixing it in would break the single style. |
| Kenney, Tower Defense (top-down) / Sokoban | https://kenney.nl/assets/tower-defense-top-down , https://kenney.nl/assets/sokoban | CC0 1.0 (stated on the pack pages) | No farm terrain, crops, characters or animals. |
| Kenney, Tiny Farm 1.0 | https://opengameart.org/content/tiny-farm | CC0 1.0 (bundled License.txt) | 16 px pixel art. The owner chose smooth vector art. |
