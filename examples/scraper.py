#!/usr/bin/env python3
"""
SwapProxy – Example Web Scraper with Playwright

Usage:
    pip install playwright
    playwright install chromium
    python scraper.py https://example.com
"""

import sys
import asyncio
from playwright.async_api import async_playwright

PROXY_HOST = "swapproxy.com"   # or your VPS IP
PROXY_PORT = 3128
USERNAME = "demo"
PASSWORD = "swapproxy2024"
PROXY_URL = f"http://{USERNAME}:{PASSWORD}@{PROXY_HOST}:{PROXY_PORT}"

async def scrape(url: str):
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            proxy={"server": PROXY_URL},
        )
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/125.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1920, "height": 1080},
            locale="en-US",
        )
        page = await context.new_page()
        try:
            await page.goto(url, timeout=60000, wait_until="domcontentloaded")
            content = await page.content()
            print(f"[OK] {url} ({len(content)} bytes)")
            return content
        except Exception as e:
            print(f"[ERR] {url}: {e}")
            return None
        finally:
            await browser.close()


if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else "https://httpbin.org/ip"
    asyncio.run(scrape(url))
