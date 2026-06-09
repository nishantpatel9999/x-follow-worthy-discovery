# X Follow-Worthy Discovery Pipeline

Multi-phase pipeline to discover trading-relevant X/Twitter accounts by analyzing your follow graph.

## Status

| Phase | Description | Status | Credits Used |
|-------|-------------|--------|:--:|
| **Phase 1** | Seed follows — handles + profile URLs | ✅ Complete | 181 |
| **Phase 2** | Enrich seed bios — profiles via xfetch | ✅ Complete | 336 |
| **Phase 3** | Follows-of-follows — graph edges | ⏳ Ready | ~2,500 |
| **Phase 4** | Enrich discoveries + rank | ⏳ Ready | ~5,000 |
| **Phase 5** | Post sampling via xfetch | 🔜 Planned | ~3,000 |
| **Phase 6** | LLM classification + scoring + final CSV | 🔜 Planned | 0 |

**So far:** 168 seed accounts enriched, 66,968 credits remaining (~$10 worth on free tier).

## Quick Start

```bash
cp .env.example .env
# Fill in YOUR_HANDLE, XFETCH_API_KEY

npm install
./run.sh           # full pipeline (resumes on credit exhaustion)
./run.sh phase3    # run specific phase
```

## Architecture

```
x-scraper/
  src/
    xfetch-client.js       # xfetch REST client, rate limit retry, CSV/JSON utils
    phase1-xfetch.js        # GET /users/by-username, GET /users/:id/following?mode=ids
    phase2-enrich.js        # GET /users/by-username/:handle → bios, stats
    phase3-fof-ids.js       # GET /users/:id/following?mode=ids for each seed
    phase4-enrich.js        # GET /users?ids=... batch resolve → ranked CSV
  data/                     # Output CSVs (git ignored)
  state/                    # Resume state (git ignored)
```

## Requirements

- Node.js 18+
- [xfetch](https://xfetch.io) API key — free 1,000 credits, PAYG $0.15/1K

## Cost

~$1-2 total for full pipeline (168 seeds → ~30K edges → top ~500 ranked).  
Free tier covers Phases 1-2 + partial Phase 3.

## Outputs

| File | Contents |
|------|----------|
| `data/my-follows-phase1.csv` | handles, profile_urls |
| `data/my-follows-enriched.csv` | + bios, followers, verified, joined |
| `data/all-follow-of-follows.csv` | source_id, source_handle, follows_id |
| `data/follow-worthy.csv` | ranked: verified → endorsement count → followers |
