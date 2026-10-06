import asyncio
import re
from pathlib import Path
from sqlalchemy.future import select
from app.db.session import AsyncSessionLocal
from app.db.models import LandRecord, MutationEntry
from app.utils.encoding import fix_mojibake
from app.services.ocr_engine import extract_mutation_from_text, extract_mutation_data

async def repopulate():
    async with AsyncSessionLocal() as db:
        records_res = await db.execute(select(LandRecord))
        land_records = records_res.scalars().all()
        
        print(f"Found {len(land_records)} land records to process.")
        
        for record in land_records:
            survey = record.survey_no
            print(f"\n--- Repopulating Mutation Entries for Survey {survey} (ID: {record.id}) ---")
            
            # Delete old mutation rows for this record to clean duplicates (e.g. 1_p0..1_p16)
            delete_entries = await db.execute(
                select(MutationEntry).where(MutationEntry.land_record_id == record.id)
            )
            for old_m in delete_entries.scalars().all():
                await db.delete(old_m)
            await db.flush()
            
            existing_mutations_map = {}
            output_dir = Path(f"output/survey_{survey}")
            
            # 1. Scanned Handwritten Deeds from output folder
            if output_dir.exists():
                all_images = sorted(list(output_dir.glob("mutation_entry_*.jpg")))
                grouped_images = {}
                for img_path in all_images:
                    # Filter out any crop files if they exist
                    if "_crop_" in img_path.name:
                        continue
                    raw_stem = img_path.stem.replace("mutation_entry_", "")
                    # Extract clean base entry number: e.g. '1_p0' -> '1', '122_p3' -> '122', '123' -> '123'
                    match = re.match(r'^([0-9A-Za-z\u0A80-\u0AFF]+?)(?:_p[0-9]+)?$', raw_stem)
                    base_entry_no = match.group(1).strip() if match else raw_stem.split('_')[0].strip()
                    if base_entry_no not in grouped_images:
                        grouped_images[base_entry_no] = []
                    grouped_images[base_entry_no].append(str(img_path))
                
                print(f"Grouped into {len(grouped_images)} unique deed entries: {list(grouped_images.keys())}")
                
                for entry_num, img_list in grouped_images.items():
                    primary_img_name = Path(img_list[0]).name
                    client_img_url = f"/static/images/survey_{survey}/{primary_img_name}"
                    all_page_urls = [f"/static/images/survey_{survey}/{Path(p).name}" for p in img_list]
                    
                    # Try OCR or build structured draft
                    ocr_res = await extract_mutation_data(img_list[0])
                    entries = ocr_res.get("entries", [])
                    if entries:
                        ocr_data = entries[0]
                        draft_data = {
                            "mutation_entry_number": str(entry_num),
                            "entry_date": ocr_data.get("entry_date", ""),
                            "transaction_type": ocr_data.get("transaction_type", "Historical Handwritten Entry (VF-6)"),
                            "survey_numbers": str(survey),
                            "previous_owners": ocr_data.get("previous_owners", []),
                            "new_owners": ocr_data.get("new_owners", []),
                            "remarks_summary": ocr_data.get("remarks_summary", f"Scanned VF-6 deed entry #{entry_num}."),
                            "all_page_urls": all_page_urls,
                            "low_confidence_flags": ocr_data.get("low_confidence_flags", []),
                            "ai_source": ocr_data.get("source", "gemini")
                        }
                    else:
                        draft_data = {
                            "mutation_entry_number": str(entry_num),
                            "entry_date": "",
                            "transaction_type": "Historical Handwritten Entry (VF-6)",
                            "survey_numbers": str(survey),
                            "previous_owners": [],
                            "new_owners": [],
                            "remarks_summary": f"Scanned VF-6 deed entry #{entry_num}. Authentic uncropped scan.",
                            "all_page_urls": all_page_urls,
                            "low_confidence_flags": ["Handwritten scan requiring advocate verification"],
                            "ai_source": "manual"
                        }
                    draft_data = fix_mojibake(draft_data)
                    
                    mutation_db_entry = MutationEntry(
                        land_record_id=record.id,
                        entry_number=str(entry_num),
                        image_file_path=client_img_url,
                        scraped_html_text=None,
                        ai_draft_data=draft_data,
                        is_verified=False
                    )
                    db.add(mutation_db_entry)
                    existing_mutations_map[entry_num] = mutation_db_entry
            
            await db.flush()
            
            # 2. Modern Digital Table Entries from extracted_data
            extracted_data = record.extracted_data or {}
            entry_details = (
                extracted_data.get("Mutation_Entries") or
                extracted_data.get("Entry Details") or
                extracted_data.get("Entry_Details") or
                []
            )
            
            print(f"Found {len(entry_details)} digital table rows.")
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
                
                # Auto-fill using Gemini AI or robust Gujarati revenue NLP
                extracted_ai = await extract_mutation_from_text(
                    details_text=details_text,
                    trans_type=trans_type,
                    officer_remarks=officer_remarks,
                    survey_no=str(survey)
                )

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
                        land_record_id=record.id,
                        entry_number=str(entry_no),
                        image_file_path=None,
                        scraped_html_text=clean_html_payload,
                        ai_draft_data=raw_draft,
                        is_verified=False
                    )
                    db.add(text_db_entry)
                    existing_mutations_map[entry_no] = text_db_entry
            
            await db.commit()
            print(f"Successfully committed {len(existing_mutations_map)} auto-filled mutation entries for Survey {survey}.")

if __name__ == "__main__":
    asyncio.run(repopulate())
