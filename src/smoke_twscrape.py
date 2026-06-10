"""Smoke test: twscrape → resolve handle + fetch tweets"""
import asyncio
from twscrape import API

async def main():
    api = API()  # uses default accounts.db where account was added

    # Test 1: Resolve handle
    print("[Smoke] twscrape v0.18.1")
    print("\n  Test 1: user_by_login → jimcramer")
    user = await api.user_by_login("jimcramer")
    print(f"    id: {user.id} | name: {user.displayname} | followers: {user.followersCount}")

    # Test 2: Fetch tweets
    print(f"\n  Test 2: user_tweets({user.id}, limit=20)")
    tweets = [t async for t in api.user_tweets(user.id, limit=20)]
    print(f"    Got {len(tweets)} tweets")

    for t in tweets[:5]:
        text = (t.rawContent or '')[:100].replace('\n', ' ')
        print(f"    [{t.date}] {text} ...{t.likeCount}❤ {t.retweetCount}🔁")

    print(f"\n  ✅ Smoke test PASSED. Ready for research2.")

if __name__ == "__main__":
    asyncio.run(main())
