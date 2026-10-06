import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from sqlalchemy.future import select

from app.db.session import async_session_factory, init_db
from app.db.models import DistrictIndex, TalukaIndex, VillageSurveyIndex
from app.utils.encoding import fix_mojibake
from app.core.logging import logger

SEED_FILE = os.path.join(os.path.dirname(__file__), "..", "app", "db", "gujarat_hierarchy_seed.json")

async def seed_hierarchy():
    if not os.path.exists(SEED_FILE):
        print(f"Seed file not found: {SEED_FILE}")
        return

    with open(SEED_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    districts = data.get("districts", [])
    bavla_villages = data.get("bavla_villages", [])
    hasannagar_surveys = data.get("hasannagar_surveys", [])

    print(f"Seeding {len(districts)} districts and their talukas...")

    await init_db()

    async with async_session_factory() as session:
        dist_count = 0
        tal_count = 0

        for d in districts:
            d_code = d["code"]
            d_name = fix_mojibake(d["name"])

            existing_d = (await session.execute(
                select(DistrictIndex).where(DistrictIndex.district_code == d_code)
            )).scalars().first()

            if existing_d:
                existing_d.district_name = d_name
            else:
                session.add(DistrictIndex(
                    district_code=d_code,
                    district_name=d_name,
                    scraped_at=datetime.now(timezone.utc)
                ))
            dist_count += 1

            for t in d.get("talukas", []):
                t_code = t["code"]
                t_name = fix_mojibake(t["name"])

                existing_t = (await session.execute(
                    select(TalukaIndex).where(
                        TalukaIndex.district_code == d_code,
                        TalukaIndex.taluka_code == t_code
                    )
                )).scalars().first()

                if existing_t:
                    existing_t.taluka_name = t_name
                else:
                    session.add(TalukaIndex(
                        district_code=d_code,
                        taluka_code=t_code,
                        taluka_name=t_name,
                        scraped_at=datetime.now(timezone.utc)
                    ))
                tal_count += 1

        await session.commit()
        print(f"Committed {dist_count} districts and {tal_count} talukas.")

        # Seed Bavla villages
        print(f"Seeding {len(bavla_villages)} villages for Ahmedabad (07) -> Bavla (08)...")
        vil_count = 0
        for v in bavla_villages:
            v_code = v["code"]
            v_name = fix_mojibake(v["name"])
            surveys = hasannagar_surveys if v_code == "001" else []

            existing_v = (await session.execute(
                select(VillageSurveyIndex).where(
                    VillageSurveyIndex.district_code == "07",
                    VillageSurveyIndex.taluka_code == "08",
                    VillageSurveyIndex.village_code == v_code
                )
            )).scalars().first()

            if existing_v:
                existing_v.village_name = v_name
                if v_code == "001" and (not existing_v.survey_numbers or existing_v.total_surveys == 0):
                    existing_v.survey_numbers = surveys
                    existing_v.total_surveys = len(surveys)
            else:
                session.add(VillageSurveyIndex(
                    district_code="07",
                    district_name="અમદાવાદ (Ahmedabad)",
                    taluka_code="08",
                    taluka_name="બાવળા (Bavla)",
                    village_code=v_code,
                    village_name=v_name,
                    survey_numbers=surveys,
                    total_surveys=len(surveys),
                    scraped_at=datetime.now(timezone.utc)
                ))
            vil_count += 1

        await session.commit()
        print(f"Committed {vil_count} villages in Bavla taluka.")

if __name__ == "__main__":
    asyncio.run(seed_hierarchy())
