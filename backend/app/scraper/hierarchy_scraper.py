import sys
import os
import asyncio
import random
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
from playwright.async_api import async_playwright, Browser, BrowserContext, Page
from sqlalchemy.future import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import logger
from app.db.models import VillageSurveyIndex, DistrictIndex, TalukaIndex
from app.utils.encoding import fix_mojibake


# Global Crawler Progress Tracker
CRAWLER_PROGRESS: Dict[str, Any] = {
    "is_running": False,
    "current_action": "Idle",
    "district_code": None,
    "taluka_code": None,
    "districts_count": 0,
    "talukas_count": 0,
    "villages_count": 0,
    "surveys_count": 0,
    "started_at": None,
    "finished_at": None,
    "error": None
}


class AnyRoRHierarchyScraper:
    """
    Stealth Headed / Headless Browser Scraper for crawling AnyRoR Gujarat administrative dropdowns:
    Districts -> Talukas -> Villages -> Survey Numbers.
    
    Equipped with:
    - Visible Headed Chrome window (evades headless bot fingerprints)
    - Fallback to headless with full stealth flags if X11 display is unavailable
    - Anti-detection args and navigator.webdriver sanitization
    - Humanized hesitation delays (random jitter)
    - Database upsert into DistrictIndex, TalukaIndex, and VillageSurveyIndex
    """

    def __init__(
        self,
        headless: bool = False,
        min_delay: float = 1.2,
        max_delay: float = 2.4,
        target_record_type: str = "8"
    ):
        self.headless = headless
        self.min_delay = min_delay
        self.max_delay = max_delay
        self.target_record_type = target_record_type
        self.url = "https://anyror.gujarat.gov.in/LandRecordRural.aspx"

        self.selectors = {
            "record_type": "#ContentPlaceHolder1_drpLandRecord",
            "district": "#ContentPlaceHolder1_ddlDistrict",
            "taluka": "#ContentPlaceHolder1_ddlTaluka",
            "village": "#ContentPlaceHolder1_ddlVillage",
            "survey": "#ContentPlaceHolder1_ddlSurveyNo"
        }

    async def _human_pause(self, custom_min: Optional[float] = None, custom_max: Optional[float] = None):
        low = custom_min or self.min_delay
        high = custom_max or self.max_delay
        await asyncio.sleep(random.uniform(low, high))

    async def _create_stealth_context(self, playwright) -> tuple[Browser, BrowserContext, Page]:
        launch_args = [
            "--disable-blink-features=AutomationControlled",
            "--disable-dev-shm-usage",
            "--no-sandbox",
            "--disable-infobars",
            "--start-maximized",
            "--window-size=1366,768",
            "--host-resolver-rules=MAP anyror.gujarat.gov.in 103.234.162.103"
        ]
        try:
            browser = await playwright.chromium.launch(
                headless=self.headless,
                args=launch_args
            )
        except Exception as launch_err:
            logger.warning(f"Headed launch failed in hierarchy scraper ({launch_err}). Falling back to Headless mode...")
            browser = await playwright.chromium.launch(
                headless=True,
                args=launch_args
            )

        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            viewport={"width": 1366, "height": 768},
            locale="gu-IN",
            timezone_id="Asia/Kolkata"
        )

        await context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            window.chrome = { runtime: {} };
            Object.defineProperty(navigator, 'languages', { get: () => ['gu-IN', 'gu', 'en-US', 'en'] });
        """)

        page = await context.new_page()
        page.set_default_timeout(60000)
        return browser, context, page

    async def _read_dropdown_options(self, page: Page, selector: str) -> List[Dict[str, str]]:
        """Reads non-empty options from an ASP.NET dropdown element."""
        options = []
        await page.wait_for_selector(selector, state="attached", timeout=20000)
        locators = await page.locator(f"{selector} option").all()
        for loc in locators:
            val = (await loc.get_attribute("value") or "").strip()
            name = (await loc.inner_text()).strip()
            name = fix_mojibake(name)
            if val and val not in ["0", "-1", ""]:
                options.append({"code": val, "name": name})
        return options

    async def _select_and_wait(self, page: Page, selector: str, value: str, next_selector: Optional[str] = None):
        """Selects an option and waits for the ASP.NET postback to complete."""
        await page.wait_for_selector(selector, state="visible", timeout=20000)
        
        old_count = 0
        if next_selector:
            try:
                old_count = await page.locator(f"{next_selector} option").count()
            except Exception:
                pass

        await page.select_option(selector, value)
        await self._human_pause(1.5, 2.5)

        if next_selector:
            try:
                await page.wait_for_function(
                    f"document.querySelector('{next_selector}') && document.querySelector('{next_selector}').options.length !== {old_count}",
                    timeout=15000
                )
            except Exception:
                pass
            await self._human_pause(0.8, 1.6)

    async def scrape_all_districts(self, db: AsyncSession) -> List[Dict[str, str]]:
        """Scrapes all 34 districts from live AnyRoR and stores them in DistrictIndex."""
        async with async_playwright() as p:
            browser, context, page = await self._create_stealth_context(p)
            try:
                logger.info(f"Connecting to AnyRoR live portal {self.url} to scrape districts...")
                await page.goto(self.url, wait_until="domcontentloaded", timeout=45000)
                await self._human_pause(1.5, 2.5)

                # Select record type 8 (Integrated)
                await self._select_and_wait(page, self.selectors["record_type"], self.target_record_type, self.selectors["district"])

                # Read all districts
                districts = await self._read_dropdown_options(page, self.selectors["district"])
                logger.info(f"Found {len(districts)} districts on live AnyRoR portal.")

                for dist in districts:
                    d_code = dist["code"]
                    d_name = dist["name"]

                    existing = await db.execute(select(DistrictIndex).where(DistrictIndex.district_code == d_code))
                    item = existing.scalars().first()
                    if item:
                        item.district_name = d_name
                        item.scraped_at = datetime.now(timezone.utc)
                    else:
                        db.add(DistrictIndex(
                            district_code=d_code,
                            district_name=d_name,
                            scraped_at=datetime.now(timezone.utc)
                        ))

                await db.commit()
                return districts
            finally:
                await browser.close()

    async def scrape_talukas_for_district(self, db: AsyncSession, district_code: str) -> List[Dict[str, str]]:
        """Scrapes all talukas for a specific district and stores them in TalukaIndex."""
        async with async_playwright() as p:
            browser, context, page = await self._create_stealth_context(p)
            try:
                await page.goto(self.url, wait_until="domcontentloaded", timeout=45000)
                await self._select_and_wait(page, self.selectors["record_type"], self.target_record_type, self.selectors["district"])
                await self._select_and_wait(page, self.selectors["district"], district_code, self.selectors["taluka"])

                talukas = await self._read_dropdown_options(page, self.selectors["taluka"])
                logger.info(f"Found {len(talukas)} talukas for district {district_code}.")

                for tal in talukas:
                    t_code = tal["code"]
                    t_name = tal["name"]

                    existing = await db.execute(
                        select(TalukaIndex).where(
                            TalukaIndex.district_code == district_code,
                            TalukaIndex.taluka_code == t_code
                        )
                    )
                    item = existing.scalars().first()
                    if item:
                        item.taluka_name = t_name
                        item.scraped_at = datetime.now(timezone.utc)
                    else:
                        db.add(TalukaIndex(
                            district_code=district_code,
                            taluka_code=t_code,
                            taluka_name=t_name,
                            scraped_at=datetime.now(timezone.utc)
                        ))

                await db.commit()
                return talukas
            finally:
                await browser.close()

    async def scrape_villages_for_taluka(self, db: AsyncSession, district_code: str, taluka_code: str) -> List[Dict[str, str]]:
        """Scrapes all villages for a specific taluka and stores them in VillageSurveyIndex."""
        async with async_playwright() as p:
            browser, context, page = await self._create_stealth_context(p)
            try:
                await page.goto(self.url, wait_until="domcontentloaded", timeout=45000)
                await self._select_and_wait(page, self.selectors["record_type"], self.target_record_type, self.selectors["district"])
                await self._select_and_wait(page, self.selectors["district"], district_code, self.selectors["taluka"])
                await self._select_and_wait(page, self.selectors["taluka"], taluka_code, self.selectors["village"])

                villages = await self._read_dropdown_options(page, self.selectors["village"])
                logger.info(f"Found {len(villages)} villages for taluka {taluka_code} in district {district_code}.")

                # Get district and taluka names
                d_row = (await db.execute(select(DistrictIndex).where(DistrictIndex.district_code == district_code))).scalars().first()
                d_name = d_row.district_name if d_row else f"District {district_code}"

                t_row = (await db.execute(select(TalukaIndex).where(TalukaIndex.district_code == district_code, TalukaIndex.taluka_code == taluka_code))).scalars().first()
                t_name = t_row.taluka_name if t_row else f"Taluka {taluka_code}"

                for vil in villages:
                    v_code = vil["code"]
                    v_name = vil["name"]

                    existing = await db.execute(
                        select(VillageSurveyIndex).where(
                            VillageSurveyIndex.district_code == district_code,
                            VillageSurveyIndex.taluka_code == taluka_code,
                            VillageSurveyIndex.village_code == v_code
                        )
                    )
                    item = existing.scalars().first()
                    if item:
                        item.village_name = v_name
                    else:
                        db.add(VillageSurveyIndex(
                            district_code=district_code,
                            district_name=d_name,
                            taluka_code=taluka_code,
                            taluka_name=t_name,
                            village_code=v_code,
                            village_name=v_name,
                            survey_numbers=[],
                            total_surveys=0,
                            scraped_at=datetime.now(timezone.utc)
                        ))

                await db.commit()
                return villages
            finally:
                await browser.close()

    async def crawl_hierarchy(
        self,
        db: AsyncSession,
        target_district: Optional[str] = None,
        target_taluka: Optional[str] = None,
        include_surveys: bool = True,
        max_villages: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Orchestrates full AnyRoR live hierarchy crawling:
        Districts -> Talukas -> Villages -> Survey Numbers.
        """
        global CRAWLER_PROGRESS
        CRAWLER_PROGRESS["is_running"] = True
        CRAWLER_PROGRESS["started_at"] = datetime.now(timezone.utc).isoformat()
        CRAWLER_PROGRESS["error"] = None
        CRAWLER_PROGRESS["district_code"] = target_district
        CRAWLER_PROGRESS["taluka_code"] = target_taluka

        villages_indexed = 0
        surveys_indexed = 0

        async with async_playwright() as p:
            browser, context, page = await self._create_stealth_context(p)
            try:
                CRAWLER_PROGRESS["current_action"] = "Opening AnyRoR Rural Portal..."
                logger.info(f"Opening {self.url} for hierarchy crawl...")
                await page.goto(self.url, wait_until="domcontentloaded", timeout=45000)
                await self._human_pause(1.5, 2.5)

                # Step 1: Select record type
                CRAWLER_PROGRESS["current_action"] = "Selecting Integrated Record Type 8..."
                await self._select_and_wait(page, self.selectors["record_type"], self.target_record_type, self.selectors["district"])

                # Step 2: Extract districts
                CRAWLER_PROGRESS["current_action"] = "Extracting Gujarat Districts..."
                districts = await self._read_dropdown_options(page, self.selectors["district"])
                CRAWLER_PROGRESS["districts_count"] = len(districts)
                logger.info(f"Found {len(districts)} districts on AnyRoR portal.")

                # Save all districts into DB
                for dist in districts:
                    d_code = dist["code"]
                    d_name = dist["name"]
                    existing_dist = (await db.execute(select(DistrictIndex).where(DistrictIndex.district_code == d_code))).scalars().first()
                    if existing_dist:
                        existing_dist.district_name = d_name
                    else:
                        db.add(DistrictIndex(district_code=d_code, district_name=d_name))
                await db.commit()

                for dist in districts:
                    d_code = dist["code"]
                    d_name = dist["name"]

                    if target_district and d_code != target_district:
                        continue

                    CRAWLER_PROGRESS["current_action"] = f"Processing District {d_name} ({d_code})..."
                    logger.info(f"Processing District: {d_name} ({d_code})...")
                    await self._select_and_wait(page, self.selectors["district"], d_code, self.selectors["taluka"])

                    # Step 3: Extract talukas
                    talukas = await self._read_dropdown_options(page, self.selectors["taluka"])
                    CRAWLER_PROGRESS["talukas_count"] += len(talukas)
                    logger.info(f"  Found {len(talukas)} talukas in District {d_name}.")

                    # Save talukas into DB
                    for tal in talukas:
                        t_code = tal["code"]
                        t_name = tal["name"]
                        existing_tal = (await db.execute(
                            select(TalukaIndex).where(
                                TalukaIndex.district_code == d_code,
                                TalukaIndex.taluka_code == t_code
                            )
                        )).scalars().first()
                        if existing_tal:
                            existing_tal.taluka_name = t_name
                        else:
                            db.add(TalukaIndex(district_code=d_code, taluka_code=t_code, taluka_name=t_name))
                    await db.commit()

                    for tal in talukas:
                        t_code = tal["code"]
                        t_name = tal["name"]

                        if target_taluka and t_code != target_taluka:
                            continue

                        CRAWLER_PROGRESS["current_action"] = f"Processing Taluka {t_name} in {d_name}..."
                        logger.info(f"  Processing Taluka: {t_name} ({t_code})...")
                        await self._select_and_wait(page, self.selectors["taluka"], t_code, self.selectors["village"])

                        # Step 4: Extract villages
                        villages = await self._read_dropdown_options(page, self.selectors["village"])
                        logger.info(f"    Found {len(villages)} villages in Taluka {t_name}.")

                        for v_idx, vil in enumerate(villages):
                            if max_villages and villages_indexed >= max_villages:
                                logger.info(f"Reached requested limit of {max_villages} villages.")
                                CRAWLER_PROGRESS["current_action"] = f"Finished: reached limit of {max_villages} villages."
                                return {
                                    "status": "completed_limit",
                                    "villages_indexed": villages_indexed,
                                    "surveys_indexed": surveys_indexed
                                }

                            v_code = vil["code"]
                            v_name = vil["name"]

                            # Check existing in DB
                            existing_item = (await db.execute(
                                select(VillageSurveyIndex).where(
                                    VillageSurveyIndex.district_code == d_code,
                                    VillageSurveyIndex.taluka_code == t_code,
                                    VillageSurveyIndex.village_code == v_code
                                )
                            )).scalars().first()

                            survey_numbers = []
                            if include_surveys:
                                if existing_item and existing_item.total_surveys > 0:
                                    logger.info(f"    [SKIP] Already indexed with {existing_item.total_surveys} surveys: {v_name}")
                                    villages_indexed += 1
                                    continue

                                CRAWLER_PROGRESS["current_action"] = f"Indexing Surveys for {v_name} ({v_code})..."
                                logger.info(f"    Indexing Surveys for Village: {v_name} ({v_code})...")
                                await self._select_and_wait(page, self.selectors["village"], v_code, self.selectors["survey"])

                                survey_options = await self._read_dropdown_options(page, self.selectors["survey"])
                                survey_numbers = [s["code"] for s in survey_options]

                            # Upsert record
                            if existing_item:
                                existing_item.village_name = v_name
                                if include_surveys:
                                    existing_item.survey_numbers = survey_numbers
                                    existing_item.total_surveys = len(survey_numbers)
                                existing_item.scraped_at = datetime.now(timezone.utc)
                            else:
                                db.add(VillageSurveyIndex(
                                    district_code=d_code,
                                    district_name=d_name,
                                    taluka_code=t_code,
                                    taluka_name=t_name,
                                    village_code=v_code,
                                    village_name=v_name,
                                    survey_numbers=survey_numbers,
                                    total_surveys=len(survey_numbers),
                                    scraped_at=datetime.now(timezone.utc)
                                ))

                            await db.commit()
                            villages_indexed += 1
                            surveys_indexed += len(survey_numbers)
                            CRAWLER_PROGRESS["villages_count"] = villages_indexed
                            CRAWLER_PROGRESS["surveys_count"] = surveys_indexed

                            # Human hesitation between villages (1.5 to 3s)
                            await self._human_pause(1.5, 3.0)

                CRAWLER_PROGRESS["current_action"] = "Crawl Completed Successfully."
                return {
                    "status": "success",
                    "villages_indexed": villages_indexed,
                    "surveys_indexed": surveys_indexed
                }

            except Exception as e:
                CRAWLER_PROGRESS["error"] = str(e)
                CRAWLER_PROGRESS["current_action"] = f"Error: {e}"
                logger.error(f"Hierarchy crawl error: {e}")
                raise e
            finally:
                CRAWLER_PROGRESS["is_running"] = False
                CRAWLER_PROGRESS["finished_at"] = datetime.now(timezone.utc).isoformat()
                await browser.close()


hierarchy_scraper = AnyRoRHierarchyScraper()
