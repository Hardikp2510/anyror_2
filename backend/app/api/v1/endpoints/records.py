from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from pydantic import BaseModel
from typing import Dict, Any

from app.db.session import get_db
from app.db.models import LandRecord
from app.services.record_service import scrape_and_save_record
from app.core.logging import logger
from app.utils.encoding import fix_mojibake

router = APIRouter()

class ScrapeRequest(BaseModel):
    district: str
    taluka: str
    village: str
    survey: str

class ScrapeResponse(BaseModel):
    status: str
    message: str
    data: Dict[str, Any]

@router.post("/scrape", response_model=ScrapeResponse)
async def fetch_record(req: ScrapeRequest, db: AsyncSession = Depends(get_db)):
    cached_record = None
    try:
        # 1. Check for existing verified record in PostgreSQL repository
        query = select(LandRecord).where(
            LandRecord.district_code == req.district,
            LandRecord.taluka_code == req.taluka,
            LandRecord.village_code == req.village,
            LandRecord.survey_no == req.survey
        ).order_by(LandRecord.scraped_at.desc())
        
        result = await db.execute(query)
        cached_record = result.scalars().first()

        # 2. Launch Scraper (Pass cached_record for mid-flight date comparison)
        final_record, was_cached = await scrape_and_save_record(
            db=db,
            district=req.district,
            taluka=req.taluka,
            village=req.village,
            survey=req.survey,
            cached_record=cached_record
        )
        
        if was_cached:
            msg = f"Fast Retrieval: Verified record served from repository for Survey {req.survey}."
        else:
            msg = f"Live Scrape Complete: New updates extracted and saved for Survey {req.survey}."

        return ScrapeResponse(
            status="success",
            message=msg,
            data=fix_mojibake(final_record.extracted_data)
        )
        
    except Exception as e:
        error_msg = str(e)
        logger.warning(f"Live scrape notice for Survey {req.survey}: {error_msg}")
        
        # 3. If live portal is unreachable, return verified database record if cached
        if cached_record:
            return ScrapeResponse(
                status="warning",
                message=f"AnyRoR government portal is currently unreachable / rate-limiting connections. Serving verified record from repository for Survey {req.survey}.",
                data=fix_mojibake(cached_record.extracted_data)
            )
        
        # 4. Clean error response if no record exists in repository
        raise HTTPException(
            status_code=502,
            detail=f"Gujarat AnyRoR portal notice: {error_msg}"
        )

@router.get("/survey/{survey_no}")
async def get_record_by_survey(survey_no: str, village_code: str | None = None, db: AsyncSession = Depends(get_db)):
    query = select(LandRecord).where(
        LandRecord.survey_no == str(survey_no)
    )
    if village_code:
        query = query.where(LandRecord.village_code == str(village_code))
        
    query = query.order_by(LandRecord.scraped_at.desc())
    
    result = await db.execute(query)
    record = result.scalars().first()
    
    if not record:
        detail_msg = f"No record found for Survey No {survey_no}"
        if village_code:
            detail_msg += f" in Village {village_code}"
        raise HTTPException(status_code=404, detail=detail_msg)
        
    return {
        "id": record.id,
        "survey_no": record.survey_no,
        "village_code": record.village_code,
        "taluka_code": record.taluka_code,
        "district_code": record.district_code,
        "extracted_data": fix_mojibake(record.extracted_data),
        "pdf_file_path": record.pdf_file_path,
        "scraped_at": record.scraped_at.isoformat() if record.scraped_at else None
    }

@router.get("/village/{village_code}")
async def get_records_by_village(village_code: str, db: AsyncSession = Depends(get_db)):
    query = select(LandRecord).where(
        LandRecord.village_code == str(village_code)
    ).order_by(LandRecord.scraped_at.desc())
    
    result = await db.execute(query)
    records = result.scalars().all()
    
    rollup = []
    seen_surveys = set()
    
    for r in records:
        if r.survey_no in seen_surveys:
            continue
        seen_surveys.add(r.survey_no)
        
        data = r.extracted_data or {}
        basic = data.get("Basic Details", data.get("Basic_Details", {}))
        owners = data.get("Ownership Details", data.get("Ownership_Details", []))
        flags = data.get("Risk_Flags", {})
        
        # Determine owner display name
        owner_name = "Private Landholder"
        if owners and isinstance(owners, list) and len(owners) > 0 and isinstance(owners[0], dict):
            first_owner = owners[0]
            for key in ["Owner Name", "owner_name", "Owner", "Khatedar Name", "ખેડૂતનું નામ", "નામ"]:
                if key in first_owner and first_owner[key]:
                    owner_name = str(first_owner[key])
                    break
            else:
                # Find the first value that isn't just an integer/account number
                for val in first_owner.values():
                    val_str = str(val).strip()
                    if val_str and not val_str.isdigit():
                        owner_name = val_str
                        break
            
        # Determine parcel status
        status = "Clear"
        has_red = False
        has_yellow = False
        
        flag_colors = {}
        for k, v in flags.items():
            col = v.get("color", "green") if isinstance(v, dict) else "green"
            short_k = k.split("_")[-1].lower()
            flag_colors[short_k] = col
            if col == "red":
                has_red = True
            elif col == "yellow":
                has_yellow = True
                
        if has_red:
            status = "High Risk"
        elif has_yellow:
            status = "Review Needed"
            
        rollup.append({
            "survey_no": r.survey_no,
            "village_code": r.village_code,
            "owner": str(owner_name)[:50],
            "size": str(basic.get("Total Area", basic.get("Total_Area", "N/A"))),
            "flags": {
                "ownership": flag_colors.get("ownership", "green"),
                "tenure": flag_colors.get("tenure", "green"),
                "encumbrance": flag_colors.get("encumbrance", "green"),
                "litigation": flag_colors.get("litigation", "green")
            },
            "status": status
        })
        
    return {"data": rollup}