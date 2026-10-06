import asyncio
from pathlib import Path
from datetime import datetime, timezone
from sqlalchemy.future import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import logger
from app.core.exceptions import (
    AnyRORError,
    AnyRoROfflineError,
    AnyRoRBlockedError,
    ScrapingTimeoutError,
    CaptchaSolveError
)
from app.db.models import LandRecord, MutationEntry
from app.scraper.browser import browser_manager
from app.scraper.client import AnyRORIntegratedClient
from app.utils.risk_engine import calculate_risk_flags, calculate_outstanding_dues
from app.services.ocr_engine import extract_mutation_data, extract_mutation_from_text
from app.utils.encoding import fix_mojibake


async def scrape_and_save_record(
    db: AsyncSession,
    district: str,
    taluka: str,
    village: str,
    survey: str,
    cached_record: LandRecord | None = None
) -> tuple[LandRecord, bool]:
    """
    Orchestrates the land record extraction pipeline:
    1. Obtains clean browser page from BrowserManager (stealth args, anti-detection, Gujarati locale).
    2. Runs AnyRORIntegratedClient to navigate, cascade dropdowns, solve CAPTCHA, and extract data.
    3. Handles date-based caching check.
    4. Computes risk flags and outstanding dues.
    5. Saves parent LandRecord and processes historical scans via AI OCR & digital mutations.
    6. Gracefully serves verified database records if AnyRoR is temporarily offline or rate-limiting.
    """
    logger.info(
        f"Triggered extraction for Survey {survey} (District: {district}, Taluka: {taluka}, Village: {village})"
    )

    output_dir = Path(f"output/survey_{survey}")
    output_dir.mkdir(parents=True, exist_ok=True)

    # Extract existing processing date from DB if record exists
    cached_date = None
    if cached_record and cached_record.extracted_data:
        basic_old = cached_record.extracted_data.get("Basic Details", cached_record.extracted_data.get("Basic_Details", {}))
        cached_date = str(basic_old.get("PROCESSING DATE", basic_old.get("Processing Date", ""))).strip()

    try:
        # Launch browser page through BrowserManager
        async with browser_manager.get_page() as page:
            client = AnyRORIntegratedClient(page)
            parsed_result, html_content, pdf_path_str, downloaded_images, is_unchanged = await client.fetch_integrated_record(
                district=district,
                taluka=taluka,
                village=village,
                survey=survey,
                output_dir=output_dir,
                cached_processing_date=cached_date
            )

        # FAST CACHE RETURN: If portal date matches database, skip downloading & parsing
        if is_unchanged and cached_record:
            logger.info(f"[CACHE HIT] Portal processing date matches database for Survey {survey}. Returning cached verified record.")
            return cached_record, True

        final_extracted_data = fix_mojibake(parsed_result.extracted_data)

        # Clean crop details & enrich with risk flags and outstanding dues
        final_extracted_data.pop("Crop Details", None)
        final_extracted_data.pop("Crop_Details", None)
        final_extracted_data["Risk_Flags"] = calculate_risk_flags(final_extracted_data)
        final_extracted_data["Outstanding_Dues"] = calculate_outstanding_dues(final_extracted_data)

        # 1. Upsert Parent LandRecord
        check_query = select(LandRecord).where(
            LandRecord.district_code == str(district),
            LandRecord.taluka_code == str(taluka),
            LandRecord.village_code == str(village),
            LandRecord.survey_no == str(survey)
        )
        res = await db.execute(check_query)
        db_record = res.scalars().first()

        now_utc = datetime.now(timezone.utc)
        if db_record:
            db_record.extracted_data = final_extracted_data
            if pdf_path_str:
                db_record.pdf_file_path = pdf_path_str
            db_record.mutation_images_dir = str(output_dir)
            db_record.is_successful = True
            db_record.scraped_at = now_utc
        else:
            db_record = LandRecord(
                district_code=str(district),
                taluka_code=str(taluka),
                village_code=str(village),
                survey_no=str(survey),
                extracted_data=final_extracted_data,
                pdf_file_path=pdf_path_str,
                mutation_images_dir=str(output_dir),
                is_successful=True,
                scraped_at=now_utc
            )
            db.add(db_record)
        await db.flush()

        # Query existing mutations for this parcel to prevent duplicate rows
        existing_mutations_res = await db.execute(
            select(MutationEntry).where(MutationEntry.land_record_id == db_record.id)
        )
        existing_mutations_map = {m.entry_number: m for m in existing_mutations_res.scalars().all()}

        # 2. Process Downloaded Mutation Scans (Uncropped, One Image Per Mutation Entry)
        if downloaded_images:
            logger.info(f"Processing {len(downloaded_images)} scanned handwritten mutation images...")
            
            # Group downloaded images by entry number to guarantee EXACTLY ONE entry per mutation number
            grouped_images: dict[str, list[str]] = {}
            for img_path in downloaded_images:
                raw_stem = Path(img_path).stem.replace("mutation_entry_", "")
                # Extract clean base entry number: e.g. '1_p0' -> '1', '122_p3' -> '122', '123' -> '123'
                match = re.match(r'^([0-9A-Za-z\u0A80-\u0AFF]+?)(?:_p[0-9]+|_crop_[0-9]+)?$', raw_stem)
                base_entry_no = match.group(1).strip() if match else raw_stem.split('_')[0].strip()
                if base_entry_no not in grouped_images:
                    grouped_images[base_entry_no] = []
                grouped_images[base_entry_no].append(img_path)

            for entry_num, img_list in grouped_images.items():
                # Primary uncropped image is the first page
                primary_img_path = img_list[0]
                primary_img_name = Path(primary_img_path).name
                client_img_url = f"/static/images/survey_{survey}/{primary_img_name}"
                all_page_urls = [f"/static/images/survey_{survey}/{Path(p).name}" for p in img_list]

                # Run OCR or fallback
                ocr_result = await extract_mutation_data(primary_img_path)
                entries = ocr_result.get("entries", [])
                
                if entries:
                    entry_data = fix_mojibake(entries[0])
                    entry_data["mutation_entry_number"] = str(entry_num)
                    entry_data["survey_numbers"] = str(survey)
                    entry_data["all_page_urls"] = all_page_urls
                    draft_data = entry_data
                else:
                    draft_data = {
                        "mutation_entry_number": str(entry_num),
                        "entry_date": "",
                        "transaction_type": "Historical Handwritten Entry (VF-6)",
                        "survey_numbers": str(survey),
                        "previous_owners": [],
                        "new_owners": [],
                        "remarks_summary": f"Scanned VF-6 deed entry #{entry_num}. Requires advocate review.",
                        "all_page_urls": all_page_urls,
                        "low_confidence_flags": ["Handwritten scan requiring manual verification"]
                    }

                draft_data = fix_mojibake(draft_data)

                if entry_num in existing_mutations_map:
                    ex_entry = existing_mutations_map[entry_num]
                    ex_entry.image_file_path = client_img_url
                    if not ex_entry.is_verified:
                        ex_entry.ai_draft_data = draft_data
                else:
                    mutation_db_entry = MutationEntry(
                        land_record_id=db_record.id,
                        entry_number=str(entry_num),
                        image_file_path=client_img_url,
                        scraped_html_text=None,
                        ai_draft_data=draft_data
                    )
                    db.add(mutation_db_entry)
                    existing_mutations_map[entry_num] = mutation_db_entry

        # 3. Process Modern Digital HTML Entries from AnyRoR Table (Every Single Data Point)
        entry_details = (
            final_extracted_data.get("Mutation_Entries") or
            final_extracted_data.get("Entry Details") or
            final_extracted_data.get("Entry_Details") or
            []
        )
        if isinstance(entry_details, list) and len(entry_details) > 0:
            for row in entry_details:
                if not isinstance(row, dict):
                    continue
                row = fix_mojibake(row)

                entry_no = ""
                entry_date = ""
                trans_type = "ફેરફાર નોંધ"
                status = "પ્રમાણિત"
                details_text = ""
                survey_nums = str(survey)
                officer_remarks = ""

                for k, v in row.items():
                    k_str = str(k).strip()
                    v_str = str(v).strip()
                    if "વિગત" in k_str:
                        details_text = v_str
                    elif "સરવે" in k_str or "સર્વે" in k_str:
                        survey_nums = v_str
                    elif "અધિકારી" in k_str or "શેરો" in k_str:
                        officer_remarks = v_str
                    elif "નોંધ" in k_str or "તારીખ" in k_str or "સ્થિતિ" in k_str or "Column_0" in k_str:
                        parts = [p.strip() for p in re.split(r'[\r\n|]+', v_str) if p.strip()]
                        if len(parts) >= 1 and parts[0]:
                            entry_no = parts[0]
                        if len(parts) >= 2 and parts[1]:
                            entry_date = parts[1]
                        if len(parts) >= 3 and parts[2]:
                            trans_type = parts[2]
                        if len(parts) >= 4 and parts[3]:
                            status = parts[3]

                if not entry_no:
                    continue

                clean_html_payload = {
                    "entry_number": str(entry_no),
                    "entry_date": str(entry_date),
                    "transaction_type": str(trans_type),
                    "status": str(status),
                    "details": str(details_text),
                    "survey_numbers": str(survey_nums),
                    "officer_remarks": str(officer_remarks),
                    "raw_row": row
                }

                # Auto-fill using Gemini AI or robust Gujarati revenue NLP
                extracted_ai = await extract_mutation_from_text(
                    details_text=details_text,
                    trans_type=trans_type,
                    officer_remarks=officer_remarks,
                    survey_no=str(survey)
                )

                raw_draft = {
                    "mutation_entry_number": str(entry_no),
                    "entry_date": str(entry_date) or extracted_ai.get("entry_date", ""),
                    "transaction_type": str(trans_type) or extracted_ai.get("transaction_type", ""),
                    "status": str(status),
                    "survey_numbers": str(survey_nums) or str(survey),
                    "remarks_summary": extracted_ai.get("remarks_summary") or str(details_text),
                    "officer_remarks": str(officer_remarks),
                    "previous_owners": extracted_ai.get("previous_owners", []),
                    "new_owners": extracted_ai.get("new_owners", []),
                    "ai_source": extracted_ai.get("source", "gemini")
                }
                raw_draft = fix_mojibake(raw_draft)
                clean_html_payload = fix_mojibake(clean_html_payload)

                if entry_no in existing_mutations_map:
                    ex_entry = existing_mutations_map[entry_no]
                    ex_entry.scraped_html_text = clean_html_payload
                    if not ex_entry.is_verified:
                        if not ex_entry.image_file_path:
                            ex_entry.ai_draft_data = raw_draft
                        else:
                            ex_entry.ai_draft_data["entry_date"] = entry_date or ex_entry.ai_draft_data.get("entry_date", "")
                            ex_entry.ai_draft_data["transaction_type"] = trans_type or ex_entry.ai_draft_data.get("transaction_type", "")
                            ex_entry.ai_draft_data["officer_remarks"] = officer_remarks
                            ex_entry.ai_draft_data["survey_numbers"] = survey_nums
                            if not ex_entry.ai_draft_data.get("previous_owners"):
                                ex_entry.ai_draft_data["previous_owners"] = extracted_ai.get("previous_owners", [])
                            if not ex_entry.ai_draft_data.get("new_owners"):
                                ex_entry.ai_draft_data["new_owners"] = extracted_ai.get("new_owners", [])
                else:
                    text_db_entry = MutationEntry(
                        land_record_id=db_record.id,
                        entry_number=str(entry_no),
                        image_file_path=None,
                        scraped_html_text=clean_html_payload,
                        ai_draft_data=raw_draft
                    )
                    db.add(text_db_entry)
                    existing_mutations_map[entry_no] = text_db_entry

        await db.commit()
        await db.refresh(db_record)
        return db_record, False

    except (AnyRoRBlockedError, AnyRoROfflineError) as conn_err:
        logger.warning(
            f"Government AnyRoR portal connection issue: {conn_err}. Checking database repository for Survey {survey}..."
        )
        if cached_record:
            return cached_record, True
        raise

    except Exception as scrape_err:
        logger.error(f"Scraper execution error: {scrape_err}")
        if cached_record:
            return cached_record, True
        raise