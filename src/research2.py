"""research2: 29 US trading accounts → 15-day tweets → sentiment timeline (twscrape)"""
import asyncio, json, csv, os
from datetime import datetime, timedelta, timezone
from collections import defaultdict
from twscrape import API

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "research2")
HANDLES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "research2-handles.json")
DAYS_BACK = 15

os.makedirs(OUT_DIR, exist_ok=True)

BULLISH = ['bullish', 'breakout', 'rally', 'green', 'long', 'buy', 'strength',
           'upside', 'rip', 'moon', 'pump', 'ath', 'new high', 'upgrad',
           'beat', 'outperform', 'accumulat', 'add', 'conviction', 'bounce', 'oversold']
BEARISH = ['bearish', 'breakdown', 'sell', 'red', 'short', 'weak', 'downside',
           'dump', 'crash', 'correction', 'downgrad', 'miss', 'underperform',
           'distribution', 'caution', 'risk-off', 'defensive', 'overbought', 'recession']

def sentiment(text):
    t = (text or '').lower()
    b = sum(1 for w in BULLISH if w in t)
    be = sum(1 for w in BEARISH if w in t)
    return 'bullish' if b > be else ('bearish' if be > b else 'neutral')

def build_timeline(tweets):
    cutoff = datetime.now(timezone.utc) - timedelta(days=DAYS_BACK)
    daily = defaultdict(lambda: {'bullish': 0, 'bearish': 0, 'neutral': 0, 'total': 0, 'samples': []})

    for t in tweets:
        dt = t.get('created_at')
        if not dt: continue
        if dt.tzinfo is None: dt = dt.replace(tzinfo=timezone.utc)
        if dt < cutoff: continue
        key = dt.strftime("%Y-%m-%d")
        daily[key][t['sentiment']] += 1
        daily[key]['total'] += 1
        daily[key]['samples'].append(f"@{t['handle']}: {(t['text'] or '')[:120]}")

    return [{
        'date': d,
        'bullish': v['bullish'], 'bearish': v['bearish'], 'neutral': v['neutral'],
        'total': v['total'],
        'score': round(((v['bullish'] - v['bearish']) / v['total']) * 50 + 50, 1) if v['total'] else 50,
        'label': 'bullish' if v['bullish'] > v['bearish'] else ('bearish' if v['bearish'] > v['bullish'] else 'neutral'),
        'samples': v['samples'][:3],
    } for d, v in sorted(daily.items())]

async def main():
    with open(HANDLES_FILE) as f:
        targets = json.load(f)
    handles = [t['handle'] for t in targets]

    print(f"[research2] twscrape pipeline — {len(handles)} accounts")
    print(f"  Targets: {', '.join('@'+h for h in handles[:6])}...")

    api = API()
    all_tweets = []

    for i, handle in enumerate(handles):
        print(f"\n  [{i+1}/{len(handles)}] @{handle}")

        # Resolve handle → ID
        try:
            user = await api.user_by_login(handle)
            if not user:
                print(f"    Failed to resolve — skipping")
                continue
        except Exception as e:
            print(f"    Resolve error: {e}")
            continue

        # Fetch tweets
        try:
            raw_tweets = [t async for t in api.user_tweets(user.id, limit=200)]

            # Filter last 15 days
            cutoff = datetime.now(timezone.utc) - timedelta(days=DAYS_BACK)
            recent = []
            for t in raw_tweets:
                dt = t.date
                if dt and dt.replace(tzinfo=timezone.utc) >= cutoff:
                    recent.append({
                        'handle': handle,
                        'created_at': dt,
                        'text': t.rawContent or '',
                        'likes': t.likeCount or 0,
                        'retweets': t.retweetCount or 0,
                        'replies': t.replyCount or 0,
                        'sentiment': sentiment(t.rawContent or ''),
                    })

            all_tweets.extend(recent)
            print(f"    {len(recent)} tweets in last {DAYS_BACK} days (from {len(raw_tweets)} fetched)")

        except Exception as e:
            print(f"    Tweet fetch error: {e}")

    print(f"\n  Total: {len(all_tweets)} tweets from {len(set(t['handle'] for t in all_tweets))} accounts")

    # Sentiment
    sc = defaultdict(int)
    for t in all_tweets: sc[t['sentiment']] += 1
    print(f"  Bullish: {sc['bullish']} | Bearish: {sc['bearish']} | Neutral: {sc['neutral']}")

    # Timeline
    timeline = build_timeline(all_tweets)

    # Save CSVs
    with open(os.path.join(OUT_DIR, 'tweets.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=['handle', 'created_at', 'text', 'sentiment', 'likes', 'retweets', 'replies'])
        w.writeheader()
        for t in all_tweets:
            w.writerow({k: str(v).replace('\n', ' ') if v else '' for k, v in t.items()})

    with open(os.path.join(OUT_DIR, 'timeline.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=['date', 'bullish', 'bearish', 'neutral', 'total', 'sentiment_score', 'sentiment_label'])
        w.writeheader()
        for t in timeline:
            w.writerow({'date': t['date'], 'bullish': t['bullish'], 'bearish': t['bearish'],
                        'neutral': t['neutral'], 'total': t['total'],
                        'sentiment_score': t['score'], 'sentiment_label': t['label']})

    # Print timeline
    print(f"\n{'='*60}")
    print(f"  SENTIMENT TIMELINE ({len(timeline)} days)")
    print(f"{'='*60}")
    for t in timeline:
        bar = '█' * int(t['score'] / 5)
        label = {'bullish': '🟢', 'bearish': '🔴', 'neutral': '⚪'}[t['label']]
        print(f"  {t['date']}  {label} {t['label'].upper():8s}  {t['score']:5.1f}  {bar}")
        for s in t['samples'][:1]:
            print(f"            {s[:100]}")

    print(f"\n  research2 complete")
    print(f"  Outputs: {OUT_DIR}/tweets.csv, {OUT_DIR}/timeline.csv")

asyncio.run(main())
