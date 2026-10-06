import asyncio
import json
import os
import glob
from app.db.session import AsyncSessionLocal
from app.db.models import LandRecord, MutationEntry
from sqlalchemy import select
from sqlalchemy.orm import selectinload

async def check():
    async with AsyncSessionLocal() as session:
        res = await session.execute(
            select(LandRecord).options(selectinload(LandRecord.mutations)).where(LandRecord.survey_no == '2')
        )
        record = res.scalars().first()
        if not record:
            print("No LandRecord found for Survey 2")
            return

        print("==================================================")
        print("1. LAND RECORD DETAILS (SURVEY 2)")
        print("==================================================")
        print(f"ID: {record.id}")
        print(f"District: {record.district_code}, Taluka: {record.taluka_code}, Village: {record.village_code}, Survey: {record.survey_no}")
        print(f"PDF File: {record.pdf_file_path}")
        print(f"Images Dir: {record.mutation_images_dir}")
        print(f"Scraped At: {record.scraped_at}")
        
        extracted = record.extracted_data or {}
        vf7 = extracted.get("vf7_details", {})
        print("\n--- VF-7 / 7-12 Scraped Basic Details ---")
        for k, v in vf7.items():
            print(f"  {k}: {v}")

        mut_table = extracted.get("mutation_table", [])
        print(f"\n--- Scraped Mutation Table Rows (in extracted_data): {len(mut_table)} ---")
        for idx, row in enumerate(mut_table):
            e_num = row.get("entry_no") or row.get("entry_number")
            e_type = row.get("type") or row.get("transaction_type")
            e_date = row.get("date") or row.get("entry_date")
            print(f"  [{idx+1}] Entry #{e_num} | Date: {e_date} | Type: {e_type}")

        print(f"\n==================================================")
        print(f"2. MUTATION_ENTRIES TABLE RECORDS IN DB: {len(record.mutations)}")
        print("==================================================")
        for m in sorted(record.mutations, key=lambda x: int(x.entry_number) if x.entry_number.isdigit() else 9999):
            html = m.scraped_html_text or {}
            ai = m.ai_draft_data or {}
            verified = m.final_verified_data or {}
            print(f"\n--- DB Entry #{m.entry_number} (ID: {m.id}, is_verified: {m.is_verified}) ---")
            print(f"  Image file: {m.image_file_path}")
            print(f"  HTML Scraped Type: {html.get('transaction_type')} | Date: {html.get('entry_date')} | Status: {html.get('status')}")
            print(f"  HTML Survey Numbers: {html.get('survey_numbers')}")
            print(f"  HTML Details: {repr((html.get('details') or '')[:120])}")
            print(f"  AI Draft Type: {ai.get('type') or ai.get('transaction_type')}")
            print(f"  AI Prev Owners: {ai.get('previous_owners')}")
            print(f"  AI New Owners: {ai.get('new_owners')}")
            print(f"  AI Family Tree: {ai.get('family_tree')}")
            print(f"  AI Source: {ai.get('ai_source')}")

        print("\n==================================================")
        print("3. IMAGES ON DISK in backend/output/survey_2")
        print("==================================================")
        disk_files = sorted(glob.glob("/app/output/survey_2/*"))
        print(f"Total files on disk: {len(disk_files)}")
        for f in disk_files:
            size_kb = os.path.getsize(f) / 1024
            print(f"  {os.path.basename(f)} ({size_kb:.1f} KB)")

if __name__ == "__main__":
    asyncio.run(check())
