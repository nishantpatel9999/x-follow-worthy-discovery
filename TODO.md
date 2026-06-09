# TODO

## Completed

- [x] Phase 1: Fetch 168 seed handles + profile URLs via xfetch (181 credits)
- [x] Phase 2: Enrich all 168 seed accounts with bios, follower counts, verification status (336 credits)
- [x] Clean architecture: xfetch-client.js shared module, resumable state files, CSV output
- [x] FxTwitter attempted — guest API dead, confirmed non-viable
- [x] Playwright attempted — X flagged automated browser, confirmed non-viable
- [x] Phase 3+4 code written, ready to execute
- [x] Documentation: README.md, PROJECT.md, TODO.md, .env.example, .gitignore

## Ready (awaiting go-ahead)

- [ ] Phase 3: Fetch follows-of-follows for all 168 seeds (~2,500 credits). `./run.sh phase3`
- [ ] Phase 4: Enrich unique discovered handles + rank by endorsement count (~5,000 credits). `./run.sh phase4`

## Planned

- [ ] Phase 5: Sample recent posts for top ~500 handles via xfetch (`GET /users/:id/tweets`)
- [ ] Phase 6: LLM classification — topic taxonomy, signal density, post style summaries
- [ ] Phase 6: Weighted scoring — endorsement × 30 + trading relevance × 24 + signal density × 14 + ...
- [ ] Final `follow-worthy.csv` with: score, topic tags, post summary, "why follow" reason
- [ ] Add `already_followed` flag to final CSV (cross-reference seed list)

## Nice to have

- [ ] Remove Playwright deps from package.json (no longer needed)
- [ ] Add progress bar indicators for long-running phases
- [ ] Streaming LLM for post classification (reduce latency)
- [ ] Filter edges: only include seeds with online_status=active (skip suspended)
