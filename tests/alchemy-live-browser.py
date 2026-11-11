#!/usr/bin/env python3
"""Exercise actual sandboxed online HTML card DOM, never a screenshot mock."""
import asyncio
import os
import shutil
from playwright.async_api import async_playwright

URL = "http://127.0.0.1:5189/alchemy-live-render-visual.html"
OUTPUT = "/tmp/alchemy-live-card-shots"


async def main():
    os.makedirs(OUTPUT, exist_ok=True)
    browser_path = (shutil.which("google-chrome")
                    or shutil.which("chromium")
                    or shutil.which("chromium-browser"))
    if not browser_path:
        raise RuntimeError("No Chromium binary on CI runner")
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            executable_path=browser_path, headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        try:
            page = await browser.new_page(viewport={"width": 390, "height": 920},
                                         device_scale_factor=1, is_mobile=True,
                                         has_touch=True)
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            await page.goto(URL, wait_until="domcontentloaded", timeout=20000)
            try:
                await page.wait_for_function(
                    "document.body.dataset.alchemyLiveCardReady === 'true'",
                    timeout=16000,
                )
            except Exception:
                report = await page.evaluate(
                    "document.body.dataset.alchemyLiveCardReport || 'not-started'"
                )
                raise AssertionError(
                    f"Live HTML card iframe failed to load/resize: {report}, errors={errors}"
                )
            if await page.locator("iframe[sandbox='allow-scripts']").count() != 2:
                raise AssertionError("Two actual HTML cards were not rendered")
            await page.screenshot(path=f"{OUTPUT}/online-automatic-html.png",
                                  full_page=True)

            # Original WeChat packet uses a CSS :checked native interaction.
            packet = page.frame_locator("iframe").nth(0)
            label = packet.locator('label[for="hb"]')
            await label.click(timeout=5000)
            if not await packet.locator("#hb").is_checked():
                raise AssertionError("Imported packet click-to-open is broken")
            if not await packet.locator(".al-hb-open").is_visible():
                raise AssertionError("Imported packet CSS-controlled view did not open")

            # Original scratch-card's onerror bootstrap was replaced with
            # locally bundled canvas drawing, not removed as dead markup.
            scratch = page.frame_locator("iframe").nth(1)
            canvas = scratch.locator("canvas[data-alchemy-scratch='1']")
            box = await canvas.bounding_box(timeout=5000)
            if not box or box["width"] < 100 or box["height"] < 40:
                raise AssertionError("Scratch canvas has no useful layout")
            before = await canvas.evaluate(
                "(element) => element.getContext('2d').getImageData(40,40,1,1).data[3]"
            )
            x = box["x"] + min(40, box["width"] * 0.17)
            y = box["y"] + min(40, box["height"] * 0.4)
            await page.mouse.move(x, y)
            await page.mouse.down()
            await page.mouse.move(x + 20, y + 4, steps=8)
            await page.mouse.up()
            after = await canvas.evaluate(
                "(element) => element.getContext('2d').getImageData(40,40,1,1).data[3]"
            )
            if not (before > 0 and after == 0):
                raise AssertionError(f"Canvas scratch gesture did not change pixels: {before} -> {after}")
            await page.screenshot(path=f"{OUTPUT}/online-card-opened-and-scratched.png",
                                  full_page=True)
            print("PASS: two automatic imported HTML cards, real sandbox bridge, "
                  "native packet opening and canvas scratch input")
        finally:
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
