#!/usr/bin/env bash
# Safe SQLite backup (works with WAL mode). Keeps the last 30 copies.
# Manual run:   bash /opt/dev-tracker/deploy/backup.sh
# Daily cron (3am):  0 3 * * * /bin/bash /opt/dev-tracker/deploy/backup.sh >> /var/log/dev-tracker-backup.log 2>&1
set -euo pipefail

DB=/opt/dev-tracker/data/tracker.db
DEST=/opt/dev-tracker/backups
mkdir -p "$DEST"

STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$DEST/tracker-$STAMP.db"

# .backup makes a consistent copy even while the app is running.
sqlite3 "$DB" ".backup '$OUT'"
echo "Backup written: $OUT"

# Retain only the 30 most recent backups.
ls -1t "$DEST"/tracker-*.db | tail -n +31 | xargs -r rm -f
