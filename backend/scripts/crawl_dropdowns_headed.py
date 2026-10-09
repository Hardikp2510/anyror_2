"""
AnyRoR Gujarat Administrative Hierarchy & Survey Numbers Crawler
================================================================
Crawls all 4 cascading dropdowns from:
https://anyror.gujarat.gov.in/LandRecordRural.aspx

1. Record Type: "INTEGRATED SURVEY NO DETAILS (સરવે નંબરને લગતી સંપૂર્ણ માહિતી)" (Value: 8)
2. District (ddlDistrict)
3. Taluka (ddlTaluka)
4. Village (ddlVillage)
5. Survey / Block Number (ddlSurveyNo)

Features:
- Headed Chrome Browser (visible window, evades headless bot blocks)
- Anti-detection flags (navigator.webdriver sanitization, humanized jitter delays)
- Direct PostgreSQL upsert into district_index, taluka_index, and village_survey_index
- Resume / Checkpoint support: skips villages already indexed in DB
- Safe retry and cooldown logic to avoid IP blocks
"""

import sys
import os
import time
import random
import argparse
import json
from datetime import datetime, timezone

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import Select, WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, WebDriverException, StaleElementReferenceException

import psycopg2
from psycopg2.extras import Json

# Default database connection for TitleNode SaaS (port 5435 when running locally on Windows)
DEFAULT_DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://anyror_admin:supersecretpassword123@127.0.0.1:5435/anyror_saas_db"
)

TARGET_URL = "https://anyror.gujarat.gov.in/LandRecordRural.aspx"
RECORD_TYPE_VALUE = "8" # INTEGRATED SURVEY NO DETAILS

SELECTORS = {
    "record_type": "ContentPlaceHolder1_drpLandRecord",
    "district": "ContentPlaceHolder1_ddlDistrict",
    "taluka": "ContentPlaceHolder1_ddlTaluka",
    "village": "ContentPlaceHolder1_ddlVillage",
    "survey": "ContentPlaceHolder1_ddlSurveyNo"
}


def clean_text(text: str) -> str:
    """Cleans up text, normalizes whitespace and encoding."""
    if not text:
        return ""
    text = text.strip()
    try:
        # Fix common mojibake if encountered
        if "Ã" in text or "â" in text:
            text = text.encode("latin-1").decode("utf-8")
    except Exception:
        pass
    return text.strip()


def get_db_connection(db_url: str):
    """Establishes connection to PostgreSQL database."""
    conn = psycopg2.connect(db_url)
    conn.autocommit = True
    return conn


def init_db_tables(conn):
    """Ensures index tables exist in PostgreSQL."""
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS district_index (
                id SERIAL PRIMARY KEY,
                district_code VARCHAR(10) UNIQUE NOT NULL,
                district_name VARCHAR(150) NOT NULL,
                scraped_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS taluka_index (
                id SERIAL PRIMARY KEY,
                district_code VARCHAR(10) NOT NULL,
                taluka_code VARCHAR(10) NOT NULL,
                taluka_name VARCHAR(150) NOT NULL,
                scraped_at TIMESTAMPTZ DEFAULT NOW(),
                CONSTRAINT uq_district_taluka_index UNIQUE (district_code, taluka_code)
            );

            CREATE TABLE IF NOT EXISTS village_survey_index (
                id SERIAL PRIMARY KEY,
                district_code VARCHAR(10) NOT NULL,
                district_name VARCHAR(150) NOT NULL,
                taluka_code VARCHAR(10) NOT NULL,
                taluka_name VARCHAR(150) NOT NULL,
                village_code VARCHAR(20) NOT NULL,
                village_name VARCHAR(150) NOT NULL,
                survey_numbers JSONB NOT NULL DEFAULT '[]'::jsonb,
                total_surveys INTEGER DEFAULT 0,
                scraped_at TIMESTAMPTZ DEFAULT NOW(),
                CONSTRAINT uq_district_taluka_village_index UNIQUE (district_code, taluka_code, village_code)
            );
        """)


def is_village_already_indexed(conn, district_code: str, taluka_code: str, village_code: str) -> bool:
    """Checks if a village is already fully indexed in the database."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT total_surveys FROM village_survey_index
            WHERE district_code = %s AND taluka_code = %s AND village_code = %s;
        """, (str(district_code).zfill(2), str(taluka_code).zfill(2), str(village_code).zfill(3)))
        row = cur.fetchone()
        return bool(row and row[0] is not None and row[0] > 0)


def human_delay(min_sec: float = 1.8, max_sec: float = 3.2):
    """Introduces humanized hesitation delay with random jitter."""
    delay = random.uniform(min_sec, max_sec)
    time.sleep(delay)


def create_browser(headless: bool = False, profile_dir: str = None, proxy: str = None) -> webdriver.Chrome:
    """Initializes a Chrome instance configured with stealth flags to avoid detection."""
    options = Options()
    if headless:
        options.add_argument("--headless=new")
    
    # Anti-bot detection switches
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option("useAutomationExtension", False)
    
    # Proxy configuration if provided
    if proxy:
        options.add_argument(f"--proxy-server={proxy}")
        print(f"[*] Routing Chrome traffic through proxy: {proxy}")
    
    # Window size & realistic User-Agent
    options.add_argument("--start-maximized")
    options.add_argument("--window-size=1400,900")
    options.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
    options.add_argument("--lang=gu-IN,gu,en-US,en")
    
    # Resolve anyror directly to IPv4 to prevent Windows IPv6 route timeouts
    options.add_argument("--host-resolver-rules=MAP anyror.gujarat.gov.in 103.234.162.103")
    
    if not profile_dir:
        import tempfile
        profile_dir = os.path.join(tempfile.gettempdir(), "anyror_crawler_profile")
    
    options.add_argument(f"--user-data-dir={profile_dir}")
    options.add_argument("--no-first-run")
    options.add_argument("--no-default-browser-check")

    driver = webdriver.Chrome(options=options)
    
    # Sanitize navigator.webdriver
    try:
        driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {
            "source": """
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                window.chrome = { runtime: {} };
                Object.defineProperty(navigator, 'languages', { get: () => ['gu-IN', 'gu', 'en-US', 'en'] });
            """
        })
    except Exception:
        pass

    return driver


def wait_for_postback(driver, timeout: int = 20):
    """Waits for ASP.NET WebForms postback or AJAX update to finish."""
    try:
        WebDriverWait(driver, timeout).until(
            lambda d: d.execute_script("""
                var ready = document.readyState === 'complete';
                var prm = window.Sys && window.Sys.WebForms && window.Sys.WebForms.PageRequestManager ? 
                          !window.Sys.WebForms.PageRequestManager.getInstance().get_isInAsyncPostBack() : true;
                return ready && prm;
            """)
        )
    except Exception:
        pass


def get_options_from_select(driver, select_id: str) -> list[dict]:
    """Reads non-empty options from a dropdown element."""
    try:
        elem = driver.find_element(By.ID, select_id)
        select_obj = Select(elem)
        result = []
        for opt in select_obj.options:
            val = opt.get_attribute("value") or ""
            text = clean_text(opt.text)
            if val and val not in ["0", "-1", ""]:
                result.append({"code": val, "name": text})
        return result
    except Exception as e:
        print(f"    [!] Error reading options from #{select_id}: {e}")
        return []


def select_dropdown_value(driver, select_id: str, value: str, min_delay: float, max_delay: float, wait_for_target_id: str = None) -> bool:
    """Selects an option by value in an ASP.NET dropdown and waits for the postback update."""
    try:
        elem = WebDriverWait(driver, 15).until(
            EC.presence_of_element_located((By.ID, select_id))
        )
        select_obj = Select(elem)
        
        # Capture old target options if target selector is provided
        old_target_count = 0
        if wait_for_target_id:
            try:
                target_elem = driver.find_element(By.ID, wait_for_target_id)
                old_target_count = len(Select(target_elem).options)
            except Exception:
                pass

        # Perform selection
        select_obj.select_by_value(value)
        
        # Wait for page/postback to settle
        wait_for_postback(driver, timeout=20)
        
        # If waiting for child dropdown, ensure child options update
        if wait_for_target_id:
            try:
                WebDriverWait(driver, 15).until(
                    lambda d: len(Select(d.find_element(By.ID, wait_for_target_id)).options) != old_target_count
                )
            except Exception:
                pass

        human_delay(min_delay, max_delay)
        return True
    except Exception as e:
        print(f"    [!] Failed to select value '{value}' in #{select_id}: {e}")
        return False


def run_crawler(
    district_filter: str = None,
    taluka_filter: str = None,
    include_surveys: bool = True,
    skip_existing: bool = True,
    delay_min: float = 1.8,
    delay_max: float = 3.2,
    headless: bool = False,
    proxy: str = None,
    db_url: str = DEFAULT_DB_URL
):
    print("=" * 70)
    print("   AnyRoR Gujarat Live Hierarchy & Survey Numbers Crawler")
    print("=" * 70)
    print(f"Target URL:        {TARGET_URL}")
    print(f"Target Record:     INTEGRATED SURVEY NO DETAILS (Value: {RECORD_TYPE_VALUE})")
    print(f"Browser Mode:      {'HEADLESS' if headless else 'VISIBLE HEADED CHROME (Anti-Ban)'}")
    print(f"Proxy Setting:     {proxy or 'DIRECT (No proxy)'}")
    print(f"Human Delay:       {delay_min}s - {delay_max}s jitter")
    print(f"District Filter:   {district_filter or 'ALL 34 DISTRICTS'}")
    print(f"Taluka Filter:     {taluka_filter or 'ALL TALUKAS'}")
    print(f"Skip Existing:     {skip_existing}")
    print(f"Include Surveys:   {include_surveys}")
    print("=" * 70)

    # Initialize DB connection
    print("\n[*] Connecting to PostgreSQL database...")
    try:
        conn = get_db_connection(db_url)
        init_db_tables(conn)
        print("[OK] Database connected and schema verified.")
    except Exception as e:
        print(f"[!] Database connection failed: {e}")
        print("    Make sure PostgreSQL container 'anyror_db_fresh' is running on port 5435.")
        return

    # Launch Chrome
    print("[*] Launching Chrome browser...")
    driver = create_browser(headless=headless, proxy=proxy)

    try:
        print(f"[*] Navigating to {TARGET_URL}...")
        driver.get(TARGET_URL)
        wait_for_postback(driver, timeout=30)
        human_delay(2.5, 4.0)

        # Step 1: Select Record Type 8 (INTEGRATED SURVEY NO DETAILS)
        print("[*] Selecting 'INTEGRATED SURVEY NO DETAILS' (Code: 8)...")
        success = select_dropdown_value(
            driver,
            SELECTORS["record_type"],
            RECORD_TYPE_VALUE,
            delay_min,
            delay_max,
            wait_for_target_id=SELECTORS["district"]
        )
        if not success:
            print("[!] Could not select Record Type 8. Retrying page load...")
            driver.get(TARGET_URL)
            wait_for_postback(driver)
            select_dropdown_value(driver, SELECTORS["record_type"], RECORD_TYPE_VALUE, delay_min, delay_max)

        # Step 2: Read Districts
        districts = get_options_from_select(driver, SELECTORS["district"])
        print(f"\n[OK] Found {len(districts)} Districts on AnyRoR live portal.")

        # Save all districts in DB
        with conn.cursor() as cur:
            for dist in districts:
                cur.execute("""
                    INSERT INTO district_index (district_code, district_name, scraped_at)
                    VALUES (%s, %s, NOW())
                    ON CONFLICT (district_code) DO UPDATE 
                    SET district_name = EXCLUDED.district_name, scraped_at = NOW();
                """, (dist["code"], dist["name"]))

        # Filter districts if requested
        if district_filter:
            dist_code_padded = str(district_filter).zfill(2)
            districts = [d for d in districts if d["code"] == dist_code_padded]
            if not districts:
                print(f"[!] No district found matching code: {district_filter}")
                return

        # Iterate Districts
        for dist_idx, dist in enumerate(districts, start=1):
            d_code = dist["code"]
            d_name = dist["name"]
            print(f"\n[{dist_idx}/{len(districts)}] DISTRICT: {d_name} (Code: {d_code})")
            print("-" * 60)

            # Select District
            select_dropdown_value(
                driver,
                SELECTORS["district"],
                d_code,
                delay_min,
                delay_max,
                wait_for_target_id=SELECTORS["taluka"]
            )

            # Read Talukas
            talukas = get_options_from_select(driver, SELECTORS["taluka"])
            print(f"  Found {len(talukas)} Talukas in District {d_name}.")

            # Save Talukas in DB
            with conn.cursor() as cur:
                for tal in talukas:
                    cur.execute("""
                        INSERT INTO taluka_index (district_code, taluka_code, taluka_name, scraped_at)
                        VALUES (%s, %s, %s, NOW())
                        ON CONFLICT (district_code, taluka_code) DO UPDATE 
                        SET taluka_name = EXCLUDED.taluka_name, scraped_at = NOW();
                    """, (d_code, tal["code"], tal["name"]))

            if taluka_filter:
                tal_code_padded = str(taluka_filter).zfill(2)
                talukas = [t for t in talukas if t["code"] == tal_code_padded]

            # Iterate Talukas
            for tal_idx, tal in enumerate(talukas, start=1):
                t_code = tal["code"]
                t_name = tal["name"]
                print(f"\n  ({tal_idx}/{len(talukas)}) TALUKA: {t_name} (Code: {t_code})")

                # Select Taluka
                select_dropdown_value(
                    driver,
                    SELECTORS["taluka"],
                    t_code,
                    delay_min,
                    delay_max,
                    wait_for_target_id=SELECTORS["village"]
                )

                # Read Villages
                villages = get_options_from_select(driver, SELECTORS["village"])
                print(f"    Found {len(villages)} Villages in Taluka {t_name}.", flush=True)

                if not include_surveys:
                    # Fast-mode: Bulk save all villages in this taluka in a single transaction
                    print(f"    [+] Fast Mode: Bulk saving {len(villages)} villages for {t_name}...", flush=True)
                    with conn.cursor() as cur:
                        for vil in villages:
                            cur.execute("""
                                INSERT INTO village_survey_index (
                                    district_code, district_name,
                                    taluka_code, taluka_name,
                                    village_code, village_name,
                                    survey_numbers, total_surveys,
                                    scraped_at
                                )
                                VALUES (%s, %s, %s, %s, %s, %s, '[]'::jsonb, 0, NOW())
                                ON CONFLICT (district_code, taluka_code, village_code) DO UPDATE
                                SET village_name = EXCLUDED.village_name;
                            """, (d_code, d_name, t_code, t_name, vil["code"], vil["name"]))
                    print(f"    [OK] Successfully saved all {len(villages)} villages of {t_name} to database.", flush=True)
                    continue

                # Full-mode: Iterate Villages and fetch Survey Numbers
                for v_idx, vil in enumerate(villages, start=1):
                    v_code = vil["code"]
                    v_name = vil["name"]

                    # Check if already indexed
                    if skip_existing and is_village_already_indexed(conn, d_code, t_code, v_code):
                        print(f"    [{v_idx}/{len(villages)}] Village: {v_name} ({v_code}) -> [SKIPPED - Already in DB]", flush=True)
                        continue

                    # Select Village
                    select_dropdown_value(
                        driver,
                        SELECTORS["village"],
                        v_code,
                        delay_min,
                        delay_max,
                        wait_for_target_id=SELECTORS["survey"]
                    )

                    # Read Survey Numbers
                    surv_opts = get_options_from_select(driver, SELECTORS["survey"])
                    survey_numbers = [s["code"] for s in surv_opts]

                    # Save Village & Surveys into DB
                    with conn.cursor() as cur:
                        cur.execute("""
                            INSERT INTO village_survey_index (
                                district_code, district_name,
                                taluka_code, taluka_name,
                                village_code, village_name,
                                survey_numbers, total_surveys,
                                scraped_at
                            )
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
                            ON CONFLICT (district_code, taluka_code, village_code) DO UPDATE
                            SET village_name = EXCLUDED.village_name,
                                survey_numbers = EXCLUDED.survey_numbers,
                                total_surveys = EXCLUDED.total_surveys,
                                scraped_at = NOW();
                        """, (
                            d_code, d_name,
                            t_code, t_name,
                            v_code, v_name,
                            Json(survey_numbers),
                            len(survey_numbers)
                        ))

                    print(f"    [{v_idx}/{len(villages)}] Village: {v_name} ({v_code}) -> [SAVED] {len(survey_numbers)} surveys", flush=True)

                    # Anti-ban human pause between villages
                    human_delay(delay_min, delay_max)

                # Short rest after finishing a taluka
                print(f"  [OK] Completed Taluka: {t_name}. Cooling down 5s...", flush=True)
                time.sleep(5)

        print("\n" + "=" * 70)
        print("   ALL REQUESTED DISTRICTS & VILLAGES CRAWLED SUCCESSFULLY!")
        print("=" * 70)

    except KeyboardInterrupt:
        print("\n[!] Crawler paused by user (Ctrl+C). Progress is safely saved in the database.")
    except Exception as e:
        print(f"\n[!] Unexpected crawler error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        try:
            driver.quit()
        except Exception:
            pass
        if conn:
            conn.close()
        print("[*] Browser closed and database connection released.")


def main():
    parser = argparse.ArgumentParser(description="AnyRoR Gujarat Live Hierarchy & Survey Dropdown Scraper")
    parser.add_argument("--district", help="Specific District code (e.g. 01 for Kutch, 07 for Ahmedabad)", default=None)
    parser.add_argument("--taluka", help="Specific Taluka code (e.g. 01 for Lakhpat, 08 for Bavla)", default=None)
    parser.add_argument("--no-surveys", action="store_true", help="Only scrape District -> Taluka -> Village (skip survey numbers)")
    parser.add_argument("--re-crawl-all", action="store_true", help="Re-crawl all villages even if already in database")
    parser.add_argument("--delay-min", type=float, default=1.8, help="Minimum human delay in seconds (default: 1.8)")
    parser.add_argument("--delay-max", type=float, default=3.2, help="Maximum human delay in seconds (default: 3.2)")
    parser.add_argument("--headless", action="store_true", help="Run in headless mode (not recommended for AnyRoR)")
    parser.add_argument("--proxy", help="HTTP or SOCKS5 proxy server (e.g. http://127.0.0.1:8080 or socks5://127.0.0.1:1080)", default=None)
    parser.add_argument("--db-url", default=DEFAULT_DB_URL, help="PostgreSQL connection string")

    args = parser.parse_args()
    run_crawler(
        district_filter=args.district,
        taluka_filter=args.taluka,
        include_surveys=not args.no_surveys,
        skip_existing=not args.re_crawl_all,
        delay_min=args.delay_min,
        delay_max=args.delay_max,
        headless=args.headless,
        proxy=args.proxy,
        db_url=args.db_url
    )


if __name__ == "__main__":
    main()
