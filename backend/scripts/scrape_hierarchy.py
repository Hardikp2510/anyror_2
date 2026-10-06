import asyncio
import sys
import argparse
from typing import Optional

from app.db.session import async_session_factory, init_db
from app.scraper.hierarchy_scraper import hierarchy_scraper
from app.core.logging import logger

async def run_crawler(
    mode: str,
    district_code: Optional[str] = None,
    taluka_code: Optional[str] = None,
    include_surveys: bool = True,
    max_villages: Optional[int] = None
):
    await init_db()
    async with async_session_factory() as session:
        if mode == "districts":
            logger.info("Scraping all Gujarat districts from AnyRoR...")
            districts = await hierarchy_scraper.scrape_all_districts(session)
            print(f"Successfully scraped and stored {len(districts)} districts.")
            for d in districts:
                print(f"  {d['code']}: {d['name']}")

        elif mode == "talukas":
            if not district_code:
                print("Error: --district is required for mode 'talukas'")
                sys.exit(1)
            logger.info(f"Scraping talukas for district {district_code}...")
            talukas = await hierarchy_scraper.scrape_talukas_for_district(session, district_code)
            print(f"Successfully scraped and stored {len(talukas)} talukas.")
            for t in talukas:
                print(f"  {t['code']}: {t['name']}")

        elif mode == "villages":
            if not district_code or not taluka_code:
                print("Error: --district and --taluka are required for mode 'villages'")
                sys.exit(1)
            logger.info(f"Scraping villages for district {district_code}, taluka {taluka_code}...")
            villages = await hierarchy_scraper.scrape_villages_for_taluka(session, district_code, taluka_code)
            print(f"Successfully scraped and stored {len(villages)} villages.")
            for v in villages:
                print(f"  {v['code']}: {v['name']}")

        elif mode == "full" or mode == "crawl":
            logger.info(f"Starting hierarchical crawl (dist={district_code}, tal={taluka_code}, surveys={include_surveys}, max={max_villages})...")
            result = await hierarchy_scraper.crawl_hierarchy(
                db=session,
                target_district=district_code,
                target_taluka=taluka_code,
                include_surveys=include_surveys,
                max_villages=max_villages
            )
            print("Crawl completed:", result)
        else:
            print(f"Unknown mode: {mode}")

def main():
    parser = argparse.ArgumentParser(description="AnyRoR Hierarchy Scraper CLI")
    parser.add_argument("--mode", choices=["districts", "talukas", "villages", "crawl", "full"], default="districts")
    parser.add_argument("--district", help="District Code (e.g. 07 for Ahmedabad)", default=None)
    parser.add_argument("--taluka", help="Taluka Code (e.g. 08 for Bavla)", default=None)
    parser.add_argument("--no-surveys", action="store_true", help="Do not scrape survey numbers (only villages)")
    parser.add_argument("--max-villages", type=int, default=None, help="Max villages to scrape")

    args = parser.parse_args()
    asyncio.run(run_crawler(
        mode=args.mode,
        district_code=args.district,
        taluka_code=args.taluka,
        include_surveys=not args.no_surveys,
        max_villages=args.max_villages
    ))

if __name__ == "__main__":
    main()
