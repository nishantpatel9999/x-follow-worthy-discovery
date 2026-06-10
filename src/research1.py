"""research1: Top trading accounts → 15-day tweets → sentiment timeline"""
import os, sys, json, csv
from datetime import datetime, timedelta, timezone
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from Scweet import Scweet

BASE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT_DIR = os.path.join(BASE_DIR, "data", "research1")
HANDLES_FILE = os.path.join(BASE_DIR, "data", "research1-handles.json")
COOKIES_FILE = os.path.join(BASE_DIR, "data", "cookies.json")
DAYS_BACK = 15

os.makedirs(OUT_DIR, exist_ok=True)

def load_handles(path):
    with open(path) as f:
        return json.load(f)

def parse_date(ts):
    if not ts:
        return None
    ts = str(ts).strip()
    formats = [
        "%a %b %d %H:%M:%S %z %Y",
        "%a %b %d %H:%M:%S %Y",
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%d %H:%M:%S",
    ]
    for fmt in formats:
        try:
            return datetime.strptime(ts, fmt)
        except:
            continue
    return None

def analyze_sentiment(tweets):
    bullish = ['bullish', 'breakout', 'rally', 'green', 'long', 'buy', 'strength',
               'upside', 'rip', 'moon', 'pump', 'ATH', 'new high', 'upgrad',
               'beat', 'outperform', 'accumulat', 'add', 'conviction']
    bearish = ['bearish', 'breakdown', 'sell', 'red', 'short', 'weak', 'downside',
               'dump', 'crash', 'correction', 'downgrad', 'miss', 'underperform',
               'distribution', 'caution', 'risk-off', 'defensive', 'overbought']

    for t in tweets:
        text = (t.get('text', '') or '').lower()
        b_count = sum(1 for w in bullish if w in text)
        be_count = sum(1 for w in bearish if w in text)
        if b_count > be_count:
            t['sentiment'] = 'bullish'
        elif be_count > b_count:
            t['sentiment'] = 'bearish'
        else:
            t['sentiment'] = 'neutral'
    return tweets

def build_timeline(tweets):
    daily = defaultdict(lambda: {'bullish': 0, 'bearish': 0, 'neutral': 0, 'total': 0, 'tweets': []})
    cutoff = datetime.now(timezone.utc) - timedelta(days=DAYS_BACK)

    for t in tweets:
        dt = parse_date(t.get('created_at'))
        if not dt:
            continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        if dt < cutoff:
            continue

        date_key = dt.strftime("%Y-%m-%d")
        sent = t.get('sentiment', 'neutral')
        daily[date_key][sent] += 1
        daily[date_key]['total'] += 1
        daily[date_key]['tweets'].append({
            'handle': t.get('handle', ''),
            'text': (t.get('text', '') or '')[:200],
            'sentiment': sent,
            'time': dt.strftime("%H:%M"),
        })

    timeline = []
    for date_key in sorted(daily.keys()):
        d = daily[date_key]
        total = d['total']
        if total == 0:
            score = 50
        else:
            score = ((d['bullish'] - d['bearish']) / total) * 50 + 50
        timeline.append({
            'date': date_key,
            'bullish': d['bullish'],
            'bearish': d['bearish'],
            'neutral': d['neutral'],
            'total': total,
            'sentiment_score': round(score, 1),
            'sentiment_label': 'bullish' if score > 60 else ('bearish' if score < 40 else 'neutral'),
            'sample_tweets': [d['tweets'][i]['text'][:120] for i in range(min(3, len(d['tweets'])))],
        })

    return timeline

def main():
    handles = load_handles(HANDLES_FILE)
    since_date = (datetime.now(timezone.utc) - timedelta(days=DAYS_BACK)).strftime("%Y-%m-%d")

    print(f"[research1] {len(handles)} target accounts: {', '.join('@'+h for h in handles)}")
    print(f"  Since: {since_date}")

    s = Scweet(
        cookies_file=COOKIES_FILE,
        db_path=os.path.join(OUT_DIR, "scweet_state.db"),
    )

    # Phase 1: Collect tweets via search (get_profile_tweets is broken in v5.3)
    all_tweets = []
    for i, handle in enumerate(handles):
        print(f"\n  [{i+1}/{len(handles)}] @{handle}")
        try:
            results = s.search(f"from:{handle}", since=since_date, limit=500)
            for t in results:
                t['handle'] = handle
                t['created_at'] = t.get('timestamp', '')
                t['text'] = t.get('text', '') or ''
                t['likes'] = t.get('likes', 0)
            all_tweets.extend(results)
            print(f"    Collected {len(results)} tweets")
        except Exception as e:
            print(f"    Error: {e}")

    print(f"\n  Total tweets collected: {len(all_tweets)}")

    # Phase 2: Sentiment analysis
    print("  Running sentiment analysis...")
    all_tweets = analyze_sentiment(all_tweets)

    # Phase 3: Build timeline
    print("  Building sentiment timeline...")
    timeline = build_timeline(all_tweets)

    # Phase 4: Save outputs
    csv_path = os.path.join(OUT_DIR, "tweets.csv")
    with open(csv_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=['handle', 'created_at', 'text', 'sentiment', 'likes', 'retweets', 'replies'])
        writer.writeheader()
        for t in all_tweets:
            dt = parse_date(t.get('created_at'))
            writer.writerow({
                'handle': t.get('handle', ''),
                'created_at': dt.isoformat() if dt else '',
                'text': (t.get('text', '') or '').replace('\n', ' ') if t.get('text') else '',
                'sentiment': t.get('sentiment', ''),
                'likes': t.get('likes', 0) or t.get('like_count', 0),
                'retweets': t.get('retweets', 0) or t.get('retweet_count', 0),
                'replies': t.get('comments', 0) or t.get('reply_count', 0),
            })
    print(f"  Saved tweets → {csv_path}")

    tl_path = os.path.join(OUT_DIR, "timeline.csv")
    with open(tl_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=['date', 'bullish', 'bearish', 'neutral', 'total', 'sentiment_score', 'sentiment_label'])
        writer.writeheader()
        for t in timeline:
            writer.writerow({
                'date': t['date'],
                'bullish': t['bullish'],
                'bearish': t['bearish'],
                'neutral': t['neutral'],
                'total': t['total'],
                'sentiment_score': t['sentiment_score'],
                'sentiment_label': t['sentiment_label'],
            })
    print(f"  Saved timeline → {tl_path}")

    # Print summary
    print(f"\n  {'='*60}")
    print(f"  SENTIMENT TIMELINE (last {len(timeline)} days)")
    print(f"  {'='*60}")
    for t in timeline:
        bar = '█' * int(t['sentiment_score'] / 5)
        label = {'bullish': '🟢', 'bearish': '🔴', 'neutral': '⚪'}.get(t['sentiment_label'], '?')
        print(f"  {t['date']}  {label} {t['sentiment_label'].upper():8s}  score:{t['sentiment_score']:5.1f}  {bar}")

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    print(f"\n  research1 complete @ {ts}")
    print(f"  Outputs: {OUT_DIR}/tweets.csv, {OUT_DIR}/timeline.csv")

    return all_tweets, timeline

if __name__ == "__main__":
    tweets, timeline = main()
