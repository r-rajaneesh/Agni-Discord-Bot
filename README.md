# agni

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.2.18. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.

## Activity setup

Agni Valley runs as a Discord Activity, launched from `/farm play`.

1. In the Developer Portal, go to **Activities → Settings** and enable Activities.
2. Under **Activities → URL Mappings**, map `/` to your `PUBLIC_URL` host without `https://`.
3. Under **OAuth2 → Redirects**, add `https://127.0.0.1`. The SDK needs a redirect URI to exist, even though it's unused.
4. Set `.env` with `BOT_ID`, `BOT_SECRET` (the OAuth2 client secret), `PUBLIC_URL`, `PORT`, `VITE_DISCORD_CLIENT_ID` and the Razorpay variables (see `.example.env`).
5. For local dev, run `bun run dev` and `bun run activity:dev`, then `cloudflared tunnel --url http://localhost:5173`, and map `/` to the tunnel host in step 2.
6. Back up the database, then run `bun scripts/migrate-activity.ts --backup-dir ./backups` once.

Notes:

- All real-money sales go through Razorpay links the bot DMs to the buyer. The Activity never shows a checkout. Gems are earned in-game only and are never sold.
- Local dev needs a public HTTPS URL for Discord to reach, so use a cloudflared tunnel as in step 5.
- The migration script is a dry run unless you pass `--yes`. Without `--yes` it prints counts and changes nothing. With `--backup-dir <dir> --yes` it writes JSON backups of the old `game_worlds`, `game_players` and `game_tiles` collections, checks their counts, and only then drops those three. It never touches wallets, inventories, the ledger, purchases, subscriptions, ownerships or the new land collections.
- `start.sh` and `pm2.config.js` run `bun run activity:build` before the bot starts.
