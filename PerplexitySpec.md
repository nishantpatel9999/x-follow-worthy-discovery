# Revised X Follow-Worthy Discovery Plan Using xfetch

This document is a build brief for an AI IDE / coding agent to implement a hybrid X-account discovery pipeline that uses xfetch where it provides cleaner public-read data access, while keeping browser automation or export tools only for the parts that still require follow-list collection. xfetch presents itself as a Twitter/X data API alternative for public read workflows, exposes normalized read endpoints, includes profile and recent-tweet retrieval, and advertises a free-credit tier, which makes it a better fit than pure browser automation for enrichment and content analysis stages.[cite:70][cite:72][cite:76]

The core idea is to stop treating the whole project as a scraper. Instead, use the lightest possible method for each stage:

- get the operator's seed following list through export or slow browser automation,
- collect second-degree follows from those seed accounts,
- shift profile and timeline enrichment to xfetch,
- then run a trading-specific scoring and summarization pipeline on normalized JSON outputs.[cite:70][cite:72][cite:76]

## Executive summary

This revised plan does not eliminate all scraping, but it significantly reduces the most fragile and risky part of the workflow. Browser automation is still needed for the seed graph if xfetch does not fully cover all required follow-list endpoints at the needed breadth, but xfetch can likely replace most profile enrichment, recent-post sampling, and part of the post-context workload, which should reduce both development complexity and ban-risk exposure compared with a full Playwright-only architecture.[cite:70][cite:72][cite:76]

## What xfetch appears to solve

xfetch is useful because it is an API-shaped read layer rather than a browser-runtime convenience layer. Its site explicitly positions it as a self-serve X/Twitter API alternative for public read workflows and references support for search, profiles, timelines, audience graph, tweet context, and X API-compatible read endpoints.[cite:70][cite:72][cite:76]

That directly helps with these project needs:

| Project need | xfetch fit | Why it matters |
|---|---|---|
| Profile enrichment | Strong[cite:70][cite:76] | Reduces brittle selector-based scraping for bios, metadata, and profile fields |
| Recent-post sampling | Strong[cite:70][cite:76] | Lets the classifier work from normalized JSON instead of page DOM extraction |
| Tweet context / content analysis | Strong[cite:70][cite:72] | Helps summarize posting style and detect trading-related content |
| Audience-graph style reads | Potentially useful[cite:70][cite:72] | Could reduce some graph-query friction if the right endpoint coverage exists |
| Seed and second-degree following list collection | Unclear / must verify[cite:70][cite:76] | This is the one area that still may require export tools or browser automation |

## What remains unresolved

The one question that must be verified before final architecture lock-in is whether xfetch exposes the exact following-list breadth needed for:

1. the operator's own following list, and
2. the following lists of each seed account,

at acceptable quota and price. The site clearly advertises read workflows and X API-compatible read endpoints, but the operational suitability for a full second-degree follow crawl still depends on exact endpoint coverage, pagination behavior, pricing, and quotas.[cite:70][cite:72][cite:76]

Because of that, the safest plan is a hybrid architecture rather than an xfetch-only architecture.

## Revised architecture

### Principle

Use xfetch for all normalized public-read enrichment that can be offloaded from the browser. Keep browser automation or export tools only for graph acquisition gaps.

### Recommended split

| Stage | Primary method | Fallback method |
|---|---|---|
| Seed following list | Exporter or browser automation | Browser automation |
| Second-degree following collection | xfetch if supported; otherwise browser automation/exporter | Browser automation |
| Profile metadata enrichment | xfetch | Browser automation |
| Recent-post sampling | xfetch | Browser automation |
| Topic classification | Internal code + LLM | Same |
| Trading scoring | Internal code | Same |
| Final CSV generation | Internal code | Same |

## Implementation plan

### Stage 1: Seed acquisition

Acquire the operator's own following list exactly once. The practical choices are:

- a CSV exporter tool that already supports following-list export, or
- slow browser automation with a burner account if export tooling is insufficient.[cite:75][cite:79][cite:83]

Output:

- `seed_accounts.csv`

Fields:

- `seed_handle`
- `seed_display_name`
- `seed_profile_url`
- `captured_at`

### Stage 2: Second-degree graph acquisition

For each `seed_handle`, retrieve the accounts that seed follows. Before implementing this stage, the agent should first probe xfetch's endpoint coverage and pagination to determine whether this can be done through xfetch directly. If xfetch fully supports this stage, use it; if not, fall back to browser/exporter collection only for this graph step.[cite:70][cite:72][cite:76]

Output:

- `edges.csv`

Fields:

- `seed_handle`
- `discovered_handle`
- `discovered_display_name`
- `source_method` (`xfetch`, `browser`, `exporter`)
- `captured_at`

### Stage 3: xfetch-based profile enrichment

For each unique `discovered_handle`, call xfetch profile endpoints to retrieve normalized user information. The site explicitly advertises profile reads and endpoint compatibility, which makes this stage a strong fit for xfetch.[cite:70][cite:76]

Target fields:

- handle
- display name
- bio
- location
- website
- joined date
- verified flag
- followers count
- following count
- post count or equivalent
- profile image URL if available
- account accessibility status if inferable

Output:

- `profiles.csv`

### Stage 4: xfetch-based recent-post sampling

For each discovered handle, use xfetch timeline or recent-tweet retrieval instead of DOM scraping where possible. The site describes profiles, timelines, and tweet context as supported public-read workflows, which should make this stage much cleaner than manual browser scraping.[cite:70][cite:72][cite:76]

Target sample size:

- 10 to 20 recent posts when available

Fields per sampled post:

- `handle`
- `post_id`
- `created_at`
- `text`
- `is_reply` if available
- `is_repost` if available
- `is_quote` if available
- `like_count` if available
- `reply_count` if available
- `repost_count` if available
- `quote_count` if available

Output:

- `posts_sample.csv`

### Stage 5: Topic classification and summary

Run topic classification on the enriched profile plus recent-post sample. Because xfetch likely returns structured content rather than raw browser text fragments, the classifier should become more stable and cheaper to run than a browser-scrape-first approach.[cite:70][cite:72]

Recommended topic taxonomy:

- Indian equities
- U.S. equities
- Macro / rates / FX
- Options / volatility
- Futures / commodities
- Crypto
- Quant / systematic trading
- Market microstructure / order flow
- Fundamental investing
- AI / coding / tooling for traders
- Finance news aggregation
- General business / startups
- Personal / lifestyle / memes

Outputs:

- `topics_primary`
- `topics_secondary`
- `trading_domain_tags`
- `post_style_summary`
- `signal_examples`

### Stage 6: Trading-specific scoring

Use the same trading-optimized scoring framework, but apply it to cleaner xfetch-derived profile and timeline data.

The recommended final score remains:

\[
FollowWorthy = 30E + 24T + 14S + 10Q + 8C + 6A + 8F - 20P
\]

Where:

- `E` = endorsement score from the second-degree graph
- `T` = trading relevance score from bio plus posts
- `S` = signal density score
- `Q` = specialization score
- `C` = credibility score
- `A` = activity quality score
- `F` = operator-fit score
- `P` = penalty score

This formula remains appropriate because xfetch changes the data acquisition layer, not the ranking objective. The goal is still to surface accounts that are useful for trading research rather than merely popular, so co-follow endorsement and trading relevance remain the most important components.[cite:70][cite:72]

## Why the hybrid model is better

Compared with a pure Playwright design, the hybrid model has four advantages.

### 1. Lower fragility

Profile and timeline extraction no longer depend as heavily on brittle selectors, scroll timing, and UI changes. API-shaped responses are generally easier to parse, validate, and retry than dynamic page DOMs.[cite:70][cite:76]

### 2. Lower account-risk exposure

The most repetitive part of the workflow becomes API-style public reads instead of repeated logged-in page browsing. That does not guarantee zero risk, but it should reduce how often the burner account must perform high-friction interactive scraping.[cite:70][cite:72]

### 3. Faster iteration

A coding agent can work from structured JSON for enrichment and post analysis, which simplifies testing, debugging, and feature engineering for the scoring model. The xfetch site also advertises machine-readable docs and endpoint compatibility, which is useful for AI-assisted implementation.[cite:70][cite:76]

### 4. Cleaner resumability

A pipeline built around deterministic API calls plus local CSV/SQLite state is easier to checkpoint than a fully browser-driven workflow.

## Verification checklist before build

The AI IDE agent should explicitly verify these xfetch details before writing the full production pipeline:

- Does xfetch expose following-list retrieval for the exact targets needed?
- What are the pagination semantics and page sizes?
- Are rate limits and quotas sufficient for the estimated workload?
- Can profile endpoints return both metadata and recent tweets in one call or linked sequence?
- Which fields are guaranteed versus optional?
- How are failures signaled, and which calls are free versus billable? The homepage states failed requests are not charged.[cite:70]

If any of these checks fail, keep xfetch for enrichment only and retain browser/export tooling for graph collection.

## Data model

The final dataset should remain the same even if upstream acquisition methods differ.

### Core files

- `seed_accounts.csv`
- `edges.csv`
- `profiles.csv`
- `posts_sample.csv`
- `final_follow_worthy.csv`
- `crawl_state.db`

### Final CSV schema

| Column | Description |
|---|---|
| `handle` | Discovered handle |
| `display_name` | Display name |
| `bio` | Full bio if captured |
| `location` | Public location if captured |
| `followers_count` | Public followers count if captured |
| `following_count` | Public following count if captured |
| `verified` | Boolean or enum |
| `cofollow_count` | Number of seed accounts following this handle |
| `seed_examples` | Sample seed handles |
| `topics_primary` | Primary topic tags |
| `topics_secondary` | Secondary topic tags |
| `post_style_summary` | One or two sentence summary |
| `endorsement_score` | `E` |
| `trading_relevance_score` | `T` |
| `signal_density_score` | `S` |
| `specialization_score` | `Q` |
| `credibility_score` | `C` |
| `activity_quality_score` | `A` |
| `operator_fit_score` | `F` |
| `penalty_score` | `P` |
| `follow_worthy_score` | Final 0 to 100 score |
| `follow_worthy_reason` | Human-readable reason |
| `already_followed` | Boolean |
| `source_mix` | Acquisition sources used |
| `last_seen_at` | Timestamp |

## Engineering requirements

The AI IDE agent should implement:

- a modular source layer with `xfetch_client.py` and `browser_graph_collector.py`
- feature flags for `USE_XFETCH_FOR_GRAPH`, `USE_XFETCH_FOR_PROFILES`, and `USE_XFETCH_FOR_POSTS`
- SQLite-backed checkpoints and queue states
- idempotent writes to raw and final outputs
- clear separation between data acquisition, enrichment, classification, and scoring
- a rebuild path so `final_follow_worthy.csv` can be regenerated without re-fetching upstream data

## Suggested repository structure

```text
x-follow-discovery/
  README.md
  pyproject.toml
  .env.example
  data/
    raw/
    interim/
    final/
  state/
    crawl.db
    browser-profile/
  src/
    config.py
    models.py
    db.py
    xfetch_client.py
    browser_graph_collector.py
    graph_service.py
    enrich_profiles.py
    sample_posts.py
    classify_topics.py
    score_accounts.py
    build_final_csv.py
  prompts/
    summarize_posts.md
    classify_topics.md
    generate_reason.md
```

## Suggested execution order

1. Verify xfetch endpoint coverage and quotas.[cite:70][cite:72][cite:76]
2. Build seed acquisition.
3. Build graph collection with xfetch first, browser fallback second.
4. Build xfetch profile enrichment.
5. Build xfetch post sampling.
6. Build topic classification.
7. Build scoring and final CSV generation.
8. Run a pilot on 10 seed accounts.
9. Expand to the full seed set.

## Minimum viable version

The MVP should be:

1. seed following acquisition,
2. second-degree edge collection,
3. xfetch profile enrichment,
4. xfetch recent-post sampling,
5. co-follow plus trading-relevance ranking,
6. final CSV with concise post summaries.

That version is already substantially better than a pure browser-only pipeline because it reduces DOM scraping burden while preserving the graph-based discovery logic.[cite:70][cite:72][cite:76]

## Acceptance criteria

The revised project is complete when it can:

- ingest the operator's seed following list,
- collect one outward following layer,
- enrich discovered accounts using xfetch where supported,
- summarize posting style from structured recent-post data,
- score discovered accounts with the trading-optimized formula,
- emit one deduplicated ranked CSV for follow decisions.

