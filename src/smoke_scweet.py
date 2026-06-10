"""Smoke test: Scweet → 1 target account → profile + 15-day tweets"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from Scweet import Scweet

AUTH_TOKEN = "97852c300a490ad6cbfd7311fece9f8e48f6e00a"
CT0 = "1de533ebe0788497c80209a4b52227b1da8638330c3d281c73f53a592e30d34ad54b4bc1bcddb8f4baaf180c3f7f45f1b3ba019e9341662bd93a72c721d7c832cf95b1b9464b1b7236eb30fb776c1b31"

TARGET = "RealSimpleAriel"
OUT_DIR = "../data/research1"

os.makedirs(OUT_DIR, exist_ok=True)

print(f"[Smoke] Scweet → @{TARGET}")
print(f"  Scweet v5.3 | Target: {TARGET}")

s = Scweet(
    auth_token=AUTH_TOKEN,
    db_path=os.path.join(OUT_DIR, "scweet_state.db"),
)

# Test 1: Profile
print("\n  Test 1: get_user_info...")
try:
    profiles = s.get_user_info([TARGET])
    if profiles:
        p = profiles[0]
        print(f"    @{p.get('screen_name', TARGET)} | {p.get('name', '?')}")
        print(f"    Followers: {p.get('followers_count', '?')} | Following: {p.get('friends_count', '?')}")
        print(f"    Tweets: {p.get('statuses_count', '?')} | Verified: {p.get('verified', False)}")
        print(f"    Bio: {(p.get('description', '') or '')[:100]}")
    else:
        print("    No data returned")
except Exception as e:
    print(f"    Error: {e}")

# Test 2: Recent tweets (15 days)
print("\n  Test 2: get_profile_tweets (last ~15 days)...")
try:
    tweets = s.get_profile_tweets([TARGET], limit=100)
    if tweets:
        print(f"    Got {len(tweets)} tweets")
        tweets.sort(key=lambda t: t.get('created_at', ''), reverse=True)
        for t in tweets[:5]:
            text = (t.get('text', '') or '')[:120].replace('\n', ' ')
            date = t.get('created_at', '?')
            print(f"    [{date}] {text}")
    else:
        print("    No tweets returned")
except Exception as e:
    print(f"    Error: {e}")

print("\n  ✅ Smoke test complete.")
