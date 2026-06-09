# Project Details

## Goal

Build a fully automated pipeline that discovers high-signal X/Twitter accounts in the trading/finance domain by analyzing your personal follow graph. Pipeline runs entirely via xfetch API — no browser, no X login, no account risk.

## Phases

### Phase 1 — Seed Acquisition ✅

Fetch all accounts you follow using xfetch's graph endpoints.

- `GET /users/by-username/:handle` → resolve your numeric ID
- `GET /users/:id/following?mode=ids` → paginate all following IDs (1 credit per 20 IDs)
- `GET /users?ids=...` → batch resolve IDs to usernames + profile URLs (100 per call)

**Output:** `data/my-follows-phase1.csv` — `handle, profile_url`
**Credits:** ~180 for 168 follows

### Phase 2 — Seed Enrichment ✅

Enrich each seed account with profile metadata.

- `GET /users/by-username/:handle` → id, name, bio, followers, following, tweets, verified, joined, location

**Output:** `data/my-follows-enriched.csv` — 12 columns including bios and stats
**Credits:** 1 per handle (~168 for full set)

### Phase 3 — Graph Acquisition ⏳

For each seed account, fetch their following list to build the second-degree graph.

- `GET /users/:id/following?mode=ids` → paginated following IDs (1 credit per 20 IDs)
- Auto-resumes on 402 (credit exhaustion)

**Output:** `data/all-follow-of-follows.csv` — `source_id, source_handle, follows_id`
**Credits:** ~2,500 for 168 seeds × average 300 follows

### Phase 4 — Discovery Enrichment + Ranking ⏳

Resolve all discovered handles to profile objects, then rank by endorsement count.

- `GET /users?ids=...` → batch 100 IDs per call
- Ranking: verified → endorsement_count → follower_count

**Output:** `data/follow-worthy.csv` — ranked by "how many of your follows endorse this account"
**Credits:** ~5,000 for ~5,000 unique handles

### Phase 5 — Post Sampling 🔜

Sample recent posts for top-ranked handles to enable content classification.

- `GET /users/:id/tweets` → 10-20 recent tweets per handle
- Only run on top ~500 handles to control cost

**Output:** `data/posts_sample.csv`
**Credits:** ~3,000

### Phase 6 — LLM Classification + Scoring 🔜

Classify posting style, detect trading-relevant signals, apply weighted scoring.

- LLM prompt: classify by topic taxonomy + summarize posting style
- Weighted formula: endorsement (30) + trading relevance (24) + signal density (14) + specialization (10) + credibility (8) + activity (6) + fit (8) − penalty (20)

**Output:** `data/follow-worthy.csv` (final)
**Cost:** LLM API tokens only (no xfetch credits)

## Technical Decisions

| Decision | Why |
|----------|-----|
| Node.js over Python | Existing tooling, single language stack, native fetch API |
| xfetch over Playwright | No browser fingerprinting, no login, no rate limits, proper API contracts |
| CSV over SQLite | Human-readable, git-diffable, simpler resume logic, no native deps |
| FxTwitter abandoned | Guest API dead — every handle returned 404/failed in testing |
| Playwright abandoned | X flagged automated browser on first attempt — "temporarily limited login" |
| Dotenv for config | Secrets stay out of git, simple KEY=value format |
| Incremental state files | Every phase auto-resumes — never lose progress on credit exhaustion |

## Rules

1. **Never commit secrets.** `.env` is gitignored. `.env.example` is the template.
2. **Every phase is resumable.** State files in `state/` checkpoint progress. Delete state file to re-run a phase.
3. **xfetch is the sole data source.** No browser automation, no X login, no burner accounts.
4. **No token sharing.** xfetch API key is personal and billed per credit.
5. **Idempotent output.** Phases deduplicate on write. Re-running the same phase doesn't create duplicate rows.
6. **Proceed phase-gated.** Each phase runs only when the previous phase's output file exists.
7. **Wait for go-ahead between phases.** Per user preference, do not auto-advance to the next phase without confirmation.
