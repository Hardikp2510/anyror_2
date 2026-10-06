from fastapi import APIRouter, UploadFile, File, BackgroundTasks, HTTPException
import csv
import io
import asyncio
from typing import List

from app.db.session import AsyncSessionLocal
from app.services.record_service import scrape_and_save_record
from app.core.logging import logger

router = APIRouter()

# The Background Worker
async def process_portfolio_batch(rows: List[dict]):
    """
    Processes parcels in the background with human delays to avoid IP rate limits.
    """
    for row in rows:
        survey_no = row.get("Survey No.") or row.get("Survey No") or row.get("survey_no") or row.get("Survey")
        village_code = row.get("Village Code") or row.get("village_code") or row.get("Village") or "001"
        dist = row.get("District") or row.get("district") or "07"
        tal = row.get("Taluka") or row.get("taluka") or "08"

        if not survey_no:
            continue

        logger.info(f"Processing portfolio Survey {survey_no} in Village {village_code}...")
        try:
            async with AsyncSessionLocal() as db:
                await scrape_and_save_record(
                    db=db,
                    district=str(dist).strip(),
                    taluka=str(tal).strip(),
                    village=str(village_code).strip(),
                    survey=str(survey_no).strip()
                )
            logger.info(f"Successfully processed portfolio Survey {survey_no}")
        except Exception as err:
            logger.warning(f"Error processing portfolio Survey {survey_no}: {err}")
            
        # Delay between scrapes to avoid triggering rate-limiting WAFs
        await asyncio.sleep(5)

@router.post("/upload-csv")
async def upload_portfolio_csv(
    background_tasks: BackgroundTasks, 
    file: UploadFile = File(...)
):
    if not file.filename.lower().endswith('.csv'):
        raise HTTPException(status_code=400, detail="Invalid file type. Please upload a CSV file.")
    
    # Read and parse the CSV with encoding fallback
    contents = await file.read()
    decoded = None
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            decoded = contents.decode(enc)
            break
        except UnicodeDecodeError:
            continue

    if decoded is None:
        raise HTTPException(status_code=400, detail="Unable to decode CSV. Please ensure standard UTF-8 encoding.")

    csv_reader = csv.DictReader(io.StringIO(decoded))
    rows = [row for row in csv_reader if any(row.values())]
    
    if len(rows) > 500:
        raise HTTPException(status_code=400, detail="Batch limit exceeded. Max 500 parcels per upload.")

    if len(rows) == 0:
        raise HTTPException(status_code=400, detail="CSV file appears to be empty or has no readable rows.")

    # Hand the heavy lifting off to the background worker
    background_tasks.add_task(process_portfolio_batch, rows)
    
    est_mins = round((len(rows) * 6) / 60, 1)
    est_str = f"{est_mins} minutes" if est_mins >= 1 else f"{len(rows) * 6} seconds"

    return {
        "status": "success", 
        "message": f"Successfully queued {len(rows)} parcels for asynchronous processing.",
        "estimated_completion_time": est_str
    }