#!/bin/bash
set -e
cd "$(dirname "$0")"

MODE=${1:-all}

echo "==============================================="
echo "  X Scraper — Phase Pipeline"
echo "==============================================="
echo ""

case $MODE in
  phase1)
    echo "► Phase 1: Fetch handles + profile URLs via xfetch (no browser, no login)"
    node src/phase1-xfetch.js
    ;;
  phase2)
    echo "► Phase 2: Enrich bios via xfetch (no account needed)"
    node src/phase2-enrich.js
    ;;
  phase3)
    echo "► Phase 3: Follows-of-follows IDs via xfetch (no account needed)"
    echo "   Resumes on 402. Top up and re-run until complete."
    node src/phase3-fof-ids.js
    ;;
  phase4)
    echo "► Phase 4: Enrich all profiles + rank (no account needed)"
    node src/phase4-enrich.js
    ;;
  phase5)
    echo "► Phase 5: Post sampling via xfetch (no account needed)"
    echo "   Resumes on 402. Top up and re-run until complete."
    node src/phase5-posts.js
    ;;
  all)
    echo "► Phase 1: Scrape handles"
    node src/phase1-xfetch.js
    echo ""
    echo "► Phase 2: Enrich bios"
    node src/phase2-enrich.js
    echo ""
    echo "► Phase 3: Follows-of-follows IDs"
    node src/phase3-fof-ids.js
    echo ""
    echo "► Phase 4: Enrich + rank"
    node src/phase4-enrich.js
    echo ""
    echo "==============================================="
    echo "  Output files:"
    echo "    data/my-follows-phase1.csv      — handles + URLs"
    echo "    data/my-follows-enriched.csv    — handles + bios"
    echo "    data/all-follow-of-follows.csv  — relationships"
    echo "    data/follow-worthy.csv          — ranked final"
    echo "==============================================="
    ;;
esac
