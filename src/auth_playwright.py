"""Extract X auth cookies via Playwright → feed to twscrape"""
import asyncio, json, os
from playwright.async_api import async_playwright
from twscrape import API

TMP_PROFILE = os.path.join(os.path.dirname(__file__), "..", "data", "chrome-tmp")
os.makedirs(TMP_PROFILE, exist_ok=True)

async def main():
    print("[Auth] Launching browser with persistent profile...")
    print(f"  Profile: {TMP_PROFILE}")
    print("  A Chrome window will open. Log in to x.com if needed.")
    print("  Press Enter in this terminal once you're logged in.\n")

    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context(
            TMP_PROFILE,
            headless=False,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--disable-features=ChromeWhatsNewUI",
            ],
            viewport={"width": 1280, "height": 800},
        )
        page = await context.new_page()
        await page.goto("https://x.com/home", wait_until="domcontentloaded", timeout=30000)

        input("Press Enter once logged into x.com... ")

        # Extract cookies
        cookies = await context.cookies()
        auth_token = None
        ct0 = None
        for c in cookies:
            if c["name"] == "auth_token" and c.get("domain", "").endswith("x.com"):
                auth_token = c["value"]
            if c["name"] == "ct0" and c.get("domain", "").endswith("x.com"):
                ct0 = c["value"]

        if not auth_token:
            print("  ❌ auth_token not found in cookies. Make sure you're logged in.")
            await context.close()
            return

        print(f"  ✓ auth_token: {auth_token[:10]}...")
        print(f"  ✓ ct0: {ct0[:10]}..." if ct0 else "  ⚠ ct0 not found")

        await context.close()

    # Feed to twscrape
    print("\n  Adding to twscrape...")
    import aiosqlite
    db = await aiosqlite.connect("accounts.db")
    await db.execute("DELETE FROM accounts")
    await db.commit()
    await db.close()

    api = API()
    await api.pool.add_account(
        "playwright1", "", "", "",
        cookies=f"auth_token={auth_token}; ct0={ct0}"
    )
    print("  Account added. Testing...")

    user = await api.user_by_login("jimcramer")
    if user and user.id:
        print(f"  ✅ Working! @{user.displayname} — {user.followersCount} followers")
        print(f"\n  auth_token={auth_token}")
        print(f"  ct0={ct0}")
        print("\n  Save these values in .env for future use.")
    else:
        print("  ❌ Still failing — token rejected.")

asyncio.run(main())
