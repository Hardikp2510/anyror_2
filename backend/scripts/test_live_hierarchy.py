import asyncio
import sys
from playwright.async_api import async_playwright

async def test_live():
    sys.stdout.reconfigure(encoding='utf-8')
    url = "https://anyror.gujarat.gov.in/LandRecordRural.aspx"
    print(f"Connecting to live AnyRoR at {url}...")
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=False,
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-dev-shm-usage"]
        )
        context = await browser.new_context(locale="gu-IN")
        page = await context.new_page()
        
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=45000)
            
            # 1. Select record type 8
            rec_sel = "#ContentPlaceHolder1_drpLandRecord"
            await page.wait_for_selector(rec_sel, timeout=15000)
            await page.select_option(rec_sel, "8")
            await asyncio.sleep(2.5)
            
            # 2. Select District 07 (Ahmedabad)
            dist_sel = "#ContentPlaceHolder1_ddlDistrict"
            await page.wait_for_selector(dist_sel, timeout=15000)
            print("Selecting District 07 (Ahmedabad)...")
            await page.select_option(dist_sel, "07")
            await asyncio.sleep(2.5)
            
            # 3. Read Talukas
            tal_sel = "#ContentPlaceHolder1_ddlTaluka"
            await page.wait_for_selector(tal_sel, timeout=15000)
            tal_opts = await page.locator(f"{tal_sel} option").all()
            print(f"\nTotal Talukas in Ahmedabad: {len(tal_opts)}")
            for opt in tal_opts:
                val = await opt.get_attribute("value")
                txt = (await opt.inner_text()).strip()
                if val and val not in ["0", "-1"]:
                    print(f"  Taluka code='{val}': {txt}")
                    
            # 4. Select Taluka 08 (Bavla)
            print("\nSelecting Taluka 08 (Bavla)...")
            await page.select_option(tal_sel, "08")
            await asyncio.sleep(2.5)
            
            # 5. Read Villages
            vil_sel = "#ContentPlaceHolder1_ddlVillage"
            await page.wait_for_selector(vil_sel, timeout=15000)
            vil_opts = await page.locator(f"{vil_sel} option").all()
            print(f"\nTotal Villages in Bavla: {len(vil_opts)}")
            for opt in vil_opts[:10]:
                val = await opt.get_attribute("value")
                txt = (await opt.inner_text()).strip()
                if val and val not in ["0", "-1"]:
                    print(f"  Village code='{val}': {txt}")
                    
            # 6. Select Village 001 (Hasannagar)
            print("\nSelecting Village 001 (Hasannagar)...")
            await page.select_option(vil_sel, "001")
            await asyncio.sleep(2.5)
            
            # 7. Read Survey numbers
            surv_sel = "#ContentPlaceHolder1_ddlSurveyNo"
            await page.wait_for_selector(surv_sel, timeout=15000)
            surv_opts = await page.locator(f"{surv_sel} option").all()
            print(f"\nTotal Survey numbers in Hasannagar: {len(surv_opts)}")
            surv_vals = [await opt.get_attribute("value") for opt in surv_opts]
            print("Sample survey numbers:", [s for s in surv_vals if s and s not in ["0", "-1"]][:15])
                    
        except Exception as e:
            print("Error connecting to live AnyRoR:", e)
        finally:
            await browser.close()

if __name__ == "__main__":
    asyncio.run(test_live())
