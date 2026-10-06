import asyncio
from fastapi import APIRouter, Depends, Query, BackgroundTasks, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func
from typing import List, Dict, Any, Optional
from pydantic import BaseModel

from app.db.session import get_db, async_session_factory
from app.db.models import VillageSurveyIndex, DistrictIndex, TalukaIndex
from app.utils.encoding import fix_mojibake
from app.core.logging import logger
from app.scraper.hierarchy_scraper import hierarchy_scraper, CRAWLER_PROGRESS

router = APIRouter()


class CrawlRequest(BaseModel):
    district_code: Optional[str] = None
    taluka_code: Optional[str] = None
    include_surveys: bool = True
    max_villages: Optional[int] = None


@router.get("/districts")
async def get_districts(
    live_sync: bool = Query(False, description="Attempt live AnyRoR sync"),
    db: AsyncSession = Depends(get_db)
):
    """
    Returns all Gujarat districts from database.
    If live_sync=True, scrapes live AnyRoR portal and updates the database.
    """
    live_status = "cached"
    if live_sync:
        try:
            logger.info("Live sync requested for all districts...")
            await hierarchy_scraper.scrape_all_districts(db)
            live_status = "synced_live"
        except Exception as e:
            logger.warning(f"Live sync of districts failed ({e}), falling back to cached DB data.")
            live_status = f"sync_failed_using_cached: {e}"

    query = select(DistrictIndex).order_by(DistrictIndex.district_code.asc())
    res = await db.execute(query)
    rows = res.scalars().all()

    districts = []
    for r in rows:
        districts.append({
            "code": r.district_code,
            "name": fix_mojibake(r.district_name)
        })

    return {
        "status": "success",
        "live_status": live_status,
        "total": len(districts),
        "data": districts
    }


@router.get("/talukas")
async def get_talukas(
    district_code: str = Query(..., description="District code (e.g. 07)"),
    live_sync: bool = Query(False, description="Attempt live AnyRoR sync"),
    db: AsyncSession = Depends(get_db)
):
    """
    Returns all talukas for a specific district.
    If live_sync=True or no records exist in DB, attempts live scrape from AnyRoR.
    """
    d_code = str(district_code).zfill(2)
    query = select(TalukaIndex).where(TalukaIndex.district_code == d_code).order_by(TalukaIndex.taluka_code.asc())
    res = await db.execute(query)
    rows = res.scalars().all()

    live_status = "cached"
    if (not rows or live_sync):
        try:
            logger.info(f"Scraping live talukas for district {d_code}...")
            await hierarchy_scraper.scrape_talukas_for_district(db, d_code)
            live_status = "synced_live"
            # Re-query
            res = await db.execute(query)
            rows = res.scalars().all()
        except Exception as e:
            logger.warning(f"Live scrape of talukas failed ({e}), using cached DB data.")
            live_status = f"sync_failed_using_cached: {e}"

    talukas = []
    for r in rows:
        talukas.append({
            "code": r.taluka_code,
            "name": fix_mojibake(r.taluka_name),
            "district_code": r.district_code
        })

    return {
        "status": "success",
        "district_code": d_code,
        "live_status": live_status,
        "total": len(talukas),
        "data": talukas
    }


@router.get("/villages")
async def get_indexed_villages(
    district_code: str = Query(..., description="District code (e.g. 07)"),
    taluka_code: str = Query(..., description="Taluka code (e.g. 08)"),
    live_sync: bool = Query(False, description="Attempt live AnyRoR sync"),
    db: AsyncSession = Depends(get_db)
):
    """
    Returns the list of indexed villages for a given district and taluka.
    If no records exist or live_sync=True, scrapes live villages from AnyRoR.
    """
    d_code = str(district_code).zfill(2)
    t_code = str(taluka_code).zfill(2)

    query = select(VillageSurveyIndex).where(
        VillageSurveyIndex.district_code == d_code,
        VillageSurveyIndex.taluka_code == t_code
    ).order_by(VillageSurveyIndex.village_name.asc())

    res = await db.execute(query)
    rows = res.scalars().all()

    live_status = "cached"
    if (not rows or live_sync):
        try:
            logger.info(f"Scraping live villages for district {d_code}, taluka {t_code}...")
            await hierarchy_scraper.scrape_villages_for_taluka(db, d_code, t_code)
            live_status = "synced_live"
            # Re-query
            res = await db.execute(query)
            rows = res.scalars().all()
        except Exception as e:
            logger.warning(f"Live scrape of villages failed ({e}), using cached DB data.")
            live_status = f"sync_failed_using_cached: {e}"

    villages = []
    for r in rows:
        villages.append({
            "code": r.village_code,
            "name": fix_mojibake(r.village_name),
            "total_surveys": r.total_surveys
        })

    return {
        "status": "success",
        "district_code": d_code,
        "taluka_code": t_code,
        "live_status": live_status,
        "total": len(villages),
        "data": villages
    }


@router.get("/surveys")
async def get_indexed_surveys(
    district_code: str = Query(..., description="District code (e.g. 07)"),
    taluka_code: str = Query(..., description="Taluka code (e.g. 08)"),
    village_code: str = Query(..., description="Village code (e.g. 001)"),
    db: AsyncSession = Depends(get_db)
):
    """
    Returns the list of survey numbers for a specific village.
    """
    d_code = str(district_code).zfill(2)
    t_code = str(taluka_code).zfill(2)
    v_code = str(village_code).zfill(3)

    query = select(VillageSurveyIndex).where(
        VillageSurveyIndex.district_code == d_code,
        VillageSurveyIndex.taluka_code == t_code,
        VillageSurveyIndex.village_code == v_code
    )

    res = await db.execute(query)
    record = res.scalars().first()

    if not record or not record.survey_numbers:
        return {
            "status": "success",
            "data": [],
            "village_name": record.village_name if record else None,
            "total": 0
        }

    return {
        "status": "success",
        "data": record.survey_numbers,
        "village_name": fix_mojibake(record.village_name),
        "total": record.total_surveys
    }


async def _run_crawl_background(
    district_code: Optional[str],
    taluka_code: Optional[str],
    include_surveys: bool,
    max_villages: Optional[int]
):
    """Executes the crawl task in background with dedicated DB session."""
    async with async_session_factory() as session:
        try:
            logger.info(f"Starting background hierarchy crawl: dist={district_code}, tal={taluka_code}")
            await hierarchy_scraper.crawl_hierarchy(
                db=session,
                target_district=district_code,
                target_taluka=taluka_code,
                include_surveys=include_surveys,
                max_villages=max_villages
            )
        except Exception as e:
            logger.error(f"Background crawler failed: {e}")


@router.post("/crawl")
async def trigger_hierarchy_crawl(
    payload: CrawlRequest,
    background_tasks: BackgroundTasks
):
    """
    Triggers live background crawl of AnyRoR hierarchy (Districts -> Talukas -> Villages -> Surveys).
    Tracks real-time progress via GET /api/v1/hierarchy/crawl/status.
    """
    if CRAWLER_PROGRESS.get("is_running"):
        return {
            "status": "already_running",
            "message": "Crawler is already executing in the background.",
            "progress": CRAWLER_PROGRESS
        }

    background_tasks.add_task(
        _run_crawl_background,
        district_code=payload.district_code,
        taluka_code=payload.taluka_code,
        include_surveys=payload.include_surveys,
        max_villages=payload.max_villages
    )

    return {
        "status": "started",
        "message": "Background hierarchy crawl started.",
        "progress": CRAWLER_PROGRESS
    }


@router.get("/crawl/status")
async def get_crawl_status():
    """
    Returns the real-time progress and telemetry of the active background crawler.
    """
    return {
        "status": "success",
        "progress": CRAWLER_PROGRESS
    }


@router.get("/stats")
async def get_hierarchy_stats(db: AsyncSession = Depends(get_db)):
    """
    Returns summary metrics of the geographic index.
    """
    districts_count_res = await db.execute(select(func.count(DistrictIndex.id)))
    districts_count = districts_count_res.scalar() or 0

    talukas_count_res = await db.execute(select(func.count(TalukaIndex.id)))
    talukas_count = talukas_count_res.scalar() or 0

    total_villages_res = await db.execute(select(func.count(VillageSurveyIndex.id)))
    total_villages = total_villages_res.scalar() or 0

    total_surveys_res = await db.execute(select(func.sum(VillageSurveyIndex.total_surveys)))
    total_surveys = total_surveys_res.scalar() or 0

    return {
        "districts_indexed": districts_count,
        "talukas_indexed": talukas_count,
        "villages_indexed": total_villages,
        "surveys_indexed": total_surveys
    }
