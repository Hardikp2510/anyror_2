import os
import re
from pathlib import Path
from typing import Dict, Any, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Body, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.db.session import get_db
from app.db.models import MutationEntry, LandRecord
from app.utils.encoding import fix_mojibake
from app.services.ocr_engine import extract_mutation_from_text, extract_mutation_data, get_gemini_client
from app.core.logging import logger

router = APIRouter()

# 1. Fetch Next Unverified Node (Supports filtering by Survey No & Village Code)
@router.get("/unverified")
async def get_unverified_mutation(survey_no: str = None, village_code: str = None, db: AsyncSession = Depends(get_db)):
    query = select(MutationEntry, LandRecord.survey_no, LandRecord.village_code).join(LandRecord).filter(MutationEntry.is_verified == False)
    
    if survey_no:
        query = query.filter(LandRecord.survey_no == str(survey_no))
    if village_code:
        query = query.filter(LandRecord.village_code == str(village_code))

    # Mathematically force OCR Images to load before Digital HTML Text
    query = query.order_by(MutationEntry.image_file_path.is_(None), MutationEntry.id.asc())

    result = await db.execute(query)
    row = result.first()
    
    if not row:
        return {"data": None}
        
    entry, s_no, v_code = row

    # Automatic Extraction: Never return empty fields or require manual button click
    draft = entry.ai_draft_data if isinstance(entry.ai_draft_data, dict) else {}
    has_date = bool(draft.get("entry_date"))
    has_owners = bool(draft.get("previous_owners") or draft.get("new_owners"))

    if not has_date or not has_owners:
        extracted = {}
        api_key = os.getenv("GEMINI_API_KEY")
        if entry.scraped_html_text and isinstance(entry.scraped_html_text, dict):
            html = entry.scraped_html_text
            extracted = await extract_mutation_from_text(
                details_text=html.get("details") or html.get("Details") or "",
                trans_type=html.get("transaction_type") or html.get("Type") or "",
                officer_remarks=html.get("officer_remarks") or html.get("Officer Remarks") or "",
                survey_no=str(s_no),
                api_key=api_key
            )
        elif entry.image_file_path:
            filename = Path(entry.image_file_path).name
            disk_path = Path("output") / f"survey_{s_no}" / filename
            if not disk_path.exists():
                disk_path = Path(entry.image_file_path.lstrip("/"))
            ocr_res = await extract_mutation_data(str(disk_path), api_key=api_key)
            entries = ocr_res.get("entries", [])
            if entries:
                extracted = entries[0]

        if extracted:
            updated_draft = {
                **draft,
                "mutation_entry_number": str(entry.entry_number),
                "entry_date": extracted.get("entry_date") or draft.get("entry_date", ""),
                "transaction_type": extracted.get("transaction_type") or draft.get("transaction_type", ""),
                "survey_numbers": str(s_no),
                "previous_owners": extracted.get("previous_owners", []) or draft.get("previous_owners", []),
                "new_owners": extracted.get("new_owners", []) or draft.get("new_owners", []),
                "remarks_summary": extracted.get("remarks_summary") or draft.get("remarks_summary", ""),
                "officer_remarks": extracted.get("officer_remarks") or draft.get("officer_remarks", ""),
                "ai_source": extracted.get("source", "gemini_auto")
            }
            entry.ai_draft_data = fix_mojibake(updated_draft)
            await db.commit()
            await db.refresh(entry)

    return {
        "data": {
            "id": entry.id,
            "land_record_id": entry.land_record_id,
            "survey_no": s_no,
            "village_code": v_code,
            "entry_number": entry.entry_number,
            "image_file_path": entry.image_file_path,
            "scraped_html_text": fix_mojibake(entry.scraped_html_text),
            "ai_draft_data": fix_mojibake(entry.ai_draft_data),
            "final_verified_data": fix_mojibake(entry.final_verified_data),
            "is_verified": entry.is_verified
        }
    }

# 2. AI Auto-Fill Single Node via Gemini API (or robust Gujarati Revenue NLP)
@router.post("/{entry_id}/ai-autofill")
async def ai_autofill_mutation(
    entry_id: int, 
    payload: Dict[str, Any] = Body(default={}), 
    x_gemini_api_key: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(MutationEntry, LandRecord.survey_no)
        .join(LandRecord)
        .filter(MutationEntry.id == entry_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Mutation entry not found")
        
    entry, survey_no = row
    api_key = payload.get("api_key") or x_gemini_api_key or os.getenv("GEMINI_API_KEY")

    extracted: Dict[str, Any] = {}

    # Case A: Digital Table Entry
    if entry.scraped_html_text and isinstance(entry.scraped_html_text, dict):
        html = entry.scraped_html_text
        details = html.get("details") or html.get("Details") or ""
        trans_type = html.get("transaction_type") or html.get("Type") or ""
        officer = html.get("officer_remarks") or html.get("Officer Remarks") or ""
        
        extracted = await extract_mutation_from_text(
            details_text=details,
            trans_type=trans_type,
            officer_remarks=officer,
            survey_no=str(survey_no),
            api_key=api_key
        )
    # Case B: Scanned Handwritten Deed Image (VF-6)
    elif entry.image_file_path:
        filename = Path(entry.image_file_path).name
        disk_path = Path("output") / f"survey_{survey_no}" / filename
        if not disk_path.exists():
            disk_path = Path(entry.image_file_path.lstrip("/"))
            
        ocr_res = await extract_mutation_data(str(disk_path), api_key=api_key)
        entries = ocr_res.get("entries", [])
        if entries:
            extracted = entries[0]
        else:
            extracted = {
                "remarks_summary": f"Scanned VF-6 deed entry #{entry.entry_number}.",
                "transaction_type": "Historical Handwritten Entry (VF-6)",
                "previous_owners": [],
                "new_owners": [],
                "source": "manual"
            }

    current_draft = entry.ai_draft_data or {}
    updated_draft = {
        **current_draft,
        "mutation_entry_number": str(entry.entry_number),
        "entry_date": extracted.get("entry_date") or current_draft.get("entry_date", ""),
        "transaction_type": extracted.get("transaction_type") or current_draft.get("transaction_type", ""),
        "survey_numbers": str(survey_no),
        "previous_owners": extracted.get("previous_owners", []),
        "new_owners": extracted.get("new_owners", []),
        "remarks_summary": extracted.get("remarks_summary") or current_draft.get("remarks_summary", ""),
        "ai_source": extracted.get("source", "gemini")
    }

    entry.ai_draft_data = fix_mojibake(updated_draft)
    await db.commit()
    await db.refresh(entry)

    return {
        "status": "success",
        "id": entry.id,
        "ai_draft_data": entry.ai_draft_data
    }

# 3. Batch Auto-Fill all unverified nodes for a survey
@router.post("/survey/{survey_no}/batch-autofill")
async def batch_autofill_survey(
    survey_no: str, 
    village_code: str = None, 
    payload: Dict[str, Any] = Body(default={}), 
    db: AsyncSession = Depends(get_db)
):
    query = select(MutationEntry).join(LandRecord).filter(
        LandRecord.survey_no == str(survey_no),
        MutationEntry.is_verified == False
    )
    if village_code:
        query = query.filter(LandRecord.village_code == str(village_code))
        
    result = await db.execute(query)
    entries = result.scalars().all()
    api_key = payload.get("api_key") or os.getenv("GEMINI_API_KEY")
    
    updated_count = 0
    for entry in entries:
        if entry.scraped_html_text and isinstance(entry.scraped_html_text, dict):
            html = entry.scraped_html_text
            extracted = await extract_mutation_from_text(
                details_text=html.get("details", ""),
                trans_type=html.get("transaction_type", ""),
                officer_remarks=html.get("officer_remarks", ""),
                survey_no=str(survey_no),
                api_key=api_key
            )
            d = entry.ai_draft_data or {}
            entry.ai_draft_data = fix_mojibake({
                **d,
                "previous_owners": extracted.get("previous_owners", []),
                "new_owners": extracted.get("new_owners", []),
                "transaction_type": extracted.get("transaction_type") or d.get("transaction_type", ""),
                "remarks_summary": extracted.get("remarks_summary") or d.get("remarks_summary", ""),
                "ai_source": extracted.get("source", "gemini")
            })
            updated_count += 1
            
    await db.commit()
    return {"status": "success", "updated_count": updated_count}

# 4. Save Gemini API Key securely
@router.post("/settings/gemini-key")
async def save_gemini_key(payload: Dict[str, str] = Body(...)):
    key = payload.get("api_key", "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="API key cannot be empty")
        
    os.environ["GEMINI_API_KEY"] = key
    
    try:
        env_file = Path(".env")
        if env_file.exists():
            content = env_file.read_text(encoding="utf-8")
            if "GEMINI_API_KEY=" in content:
                content = re.sub(r'GEMINI_API_KEY=.*', f'GEMINI_API_KEY={key}', content)
            else:
                content += f"\nGEMINI_API_KEY={key}\n"
            env_file.write_text(content, encoding="utf-8")
    except Exception as e:
        logger.warning(f"Could not persist GEMINI_API_KEY to .env: {e}")

    return {"status": "saved", "message": "Gemini API key updated successfully"}

# 5. Gemini API Key Status
@router.get("/settings/gemini-status")
async def get_gemini_status():
    key = (os.getenv("GEMINI_API_KEY") or "").strip()
    has_key = bool(key and key != "your_gemini_api_key_here" and len(key) >= 10)
    return {
        "has_key": has_key,
        "masked_key": f"{key[:4]}...{key[-4:]}" if has_key else None,
        "model": os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
    }

# 6. Commit Resolution (Verify)
@router.patch("/{entry_id}/verify")
async def verify_mutation(entry_id: int, payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(MutationEntry).filter(MutationEntry.id == entry_id))
    entry = result.scalars().first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
        
    entry.is_verified = True
    entry.verified_at = datetime.now(timezone.utc)
    entry.final_verified_data = payload.get("final_verified_data", {})
    await db.commit()
    return {"status": "success", "id": entry.id}

# 7. Reopen Node (Send back to queue for re-editing)
@router.patch("/{entry_id}/reopen")
async def reopen_mutation(entry_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(MutationEntry).filter(MutationEntry.id == entry_id))
    entry = result.scalars().first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
        
    entry.is_verified = False # Kicks it back to the Advocate queue!
    entry.verified_at = None
    await db.commit()
    return {"status": "reopened", "id": entry.id}

# 7.5 Fetch Family Pedhinamu & Land Ownership Tree
@router.get("/survey/{survey_no}/pedhinamu-tree")
async def get_pedhinamu_tree_endpoint(
    survey_no: str, 
    village_code: Optional[str] = None, 
    db: AsyncSession = Depends(get_db)
):
    from app.services.genealogy_service import build_pedhinamu_tree
    return await build_pedhinamu_tree(db, survey_no, village_code)

# 8. Fetch Timeline for Final Report & Graph
@router.get("/survey/{survey_no}/timeline")
async def get_survey_timeline(survey_no: str, village_code: str = None, include_unverified: bool = False, db: AsyncSession = Depends(get_db)):
    query = select(MutationEntry).join(LandRecord).filter(
        LandRecord.survey_no == str(survey_no)
    )
    if village_code:
        query = query.filter(LandRecord.village_code == str(village_code))

    if not include_unverified:
        query = query.filter(MutationEntry.is_verified == True)
        
    query = query.order_by(MutationEntry.id.asc())
    
    result = await db.execute(query)
    entries = result.scalars().all()
    
    formatted = []
    for e in entries:
        formatted.append({
            "id": e.id,
            "land_record_id": e.land_record_id,
            "entry_number": e.entry_number,
            "source_image_url": e.image_file_path,
            "scraped_html_text": fix_mojibake(e.scraped_html_text),
            "ai_draft_data": fix_mojibake(e.ai_draft_data),
            "final_verified_data": fix_mojibake(e.final_verified_data or e.ai_draft_data),
            "is_verified": e.is_verified,
            "verified_at": e.verified_at.isoformat() if e.verified_at else None
        })
        
    return {"data": formatted}

# 9. Advocate Dashboard Stats
@router.get("/stats")
async def get_dashboard_stats(village_code: str = None, db: AsyncSession = Depends(get_db)):
    query = select(MutationEntry, LandRecord).join(LandRecord)
    if village_code:
        query = query.filter(LandRecord.village_code == str(village_code))

    result = await db.execute(query)
    rows = result.all()
    
    survey_stats: Dict[str, Dict[str, int]] = {}
    total_verified = 0
    
    for mutation, record in rows:
        survey = record.survey_no
        if survey not in survey_stats:
            survey_stats[survey] = {"verified": 0, "pending": 0}
            
        if mutation.is_verified:
            total_verified += 1
            survey_stats[survey]["verified"] += 1
        else:
            survey_stats[survey]["pending"] += 1
            
    active_cases = []
    closed_cases = []
    
    for s_no, counts in survey_stats.items():
        if counts["pending"] > 0:
            active_cases.append({"survey_no": s_no, "pending_nodes": counts["pending"]})
        elif counts["verified"] > 0:
            closed_cases.append({"survey_no": s_no, "verified_nodes": counts["verified"]})
            
    def sort_key(item):
        s = item["survey_no"]
        return int(s) if s.isdigit() else s

    active_cases.sort(key=sort_key)
    closed_cases.sort(key=sort_key)

    return {
        "total_verified_nodes": total_verified,
        "active_cases": active_cases,
        "closed_cases": closed_cases
    }