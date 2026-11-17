#!/bin/sh
set -e
# Build the Activity client before the bot serves it
[ -d activity/node_modules ] || (cd activity && bun install --frozen-lockfile)
bun run activity:build
bun run start
