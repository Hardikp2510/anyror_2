import sys
import os
import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from playwright.async_api import async_playwright, Browser, BrowserContext, Page
from app.core.config import settings
from app.core.logging import logger

class BrowserManager:
    def __init__(self):
        self._playwright = None
        self._browser: Browser | None = None
        self._lock = asyncio.Lock()

    async def initialize(self) -> None:
        async with self._lock:
            # On Linux without an active DISPLAY, auto-launch Xvfb to support Headed mode without errors
            if sys.platform != "win32" and "DISPLAY" not in os.environ:
                import subprocess
                import shutil
                if shutil.which("Xvfb"):
                    try:
                        subprocess.Popen(
                            ["Xvfb", ":99", "-screen", "0", "1920x1080x24", "-ac"],
                            stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL
                        )
                        os.environ["DISPLAY"] = ":99"
                        await asyncio.sleep(1.0)
                        logger.info("Initialized Xvfb on DISPLAY=:99 for Headed Chromium mode.")
                    except Exception as e:
                        logger.warning(f"Could not auto-start Xvfb: {e}")

            if self._playwright is None:
                self._playwright = await async_playwright().start()
            if self._browser is None or not self._browser.is_connected():
                launch_args = [
                    "--disable-blink-features=AutomationControlled",
                    "--disable-dev-shm-usage",
                    "--no-sandbox",
                    "--disable-infobars",
                    "--start-maximized",
                    "--window-size=1366,768"
                ]
                try:
                    self._browser = await self._playwright.chromium.launch(
                        headless=settings.HEADLESS,
                        args=launch_args
                    )
                    logger.info(
                        "Playwright Chromium browser initialized.",
                        headless=settings.HEADLESS
                    )
                except Exception as launch_err:
                    logger.warning(
                        f"Headed browser launch encountered display issue: {launch_err}. Falling back to Headless Chromium with stealth args..."
                    )
                    self._browser = await self._playwright.chromium.launch(
                        headless=True,
                        args=launch_args
                    )
                    logger.info("Playwright Chromium browser safely initialized in Headless stealth mode.")

    async def shutdown(self) -> None:
        async with self._lock:
            if self._browser:
                try:
                    await self._browser.close()
                except Exception:
                    pass
                self._browser = None
            if self._playwright:
                try:
                    await self._playwright.stop()
                except Exception:
                    pass
                self._playwright = None
            logger.info("Playwright Browser shut down.")

    @asynccontextmanager
    async def get_page(self) -> AsyncIterator[Page]:
        if self._browser is None or not self._browser.is_connected():
            await self.initialize()

        context: BrowserContext = await self._browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            viewport={"width": 1366, "height": 768},
            locale="gu-IN",
            timezone_id="Asia/Kolkata"
        )
        await context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
            window.chrome = { runtime: {}, loadTimes: function() {}, csi: function() {}, app: {} };
            Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
            Object.defineProperty(navigator, 'languages', {get: () => ['gu-IN', 'gu', 'en-US', 'en']});
        """)
        page = await context.new_page()

        try:
            yield page
        finally:
            await page.close()
            await context.close()

browser_manager = BrowserManager()