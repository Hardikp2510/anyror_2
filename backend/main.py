import sys
import asyncio
import os

# Enable subprocess support on Windows for Playwright browser automation
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.api.v1.endpoints import portfolio

from app.core.config import settings
from app.db.session import init_db
from app.api.v1.endpoints import records, mutations, hierarchy
from app.scraper.browser import browser_manager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Initialize the database tables
    await init_db()
    
    # Ensure output and storage directories exist
    settings.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    settings.STORAGE_DIR.mkdir(parents=True, exist_ok=True)

    # Ensure Xvfb virtual display is active on Linux for full headed Chromium stealth
    xvfb_process = None
    if sys.platform != "win32" and "DISPLAY" not in os.environ:
        import subprocess
        import shutil
        if shutil.which("Xvfb"):
            try:
                xvfb_process = subprocess.Popen(
                    ["Xvfb", ":99", "-screen", "0", "1920x1080x24", "-ac"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
                os.environ["DISPLAY"] = ":99"
                print("Auto-started Xvfb on DISPLAY=:99 for full Headed Chromium support.")
            except Exception as e:
                print(f"Warning: Could not start Xvfb: {e}")
    
    yield
    # Shutdown logic
    await browser_manager.shutdown()
    if xvfb_process:
        try:
            xvfb_process.terminate()
        except Exception:
            pass

app = FastAPI(title="TitleNode API (AnyRoR Intelligence)", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve downloaded mutation images over the network for the HitL UI
app.mount("/static/images", StaticFiles(directory=str(settings.OUTPUT_DIR)), name="static_images")

# Register API Routers
app.include_router(records.router, prefix="/api/v1/records", tags=["Records"])
app.include_router(mutations.router, prefix="/api/v1/mutations", tags=["Mutations Review"])
app.include_router(portfolio.router, prefix="/api/v1/portfolio", tags=["Portfolio Bulk Processing"])
app.include_router(hierarchy.router, prefix="/api/v1/hierarchy", tags=["Administrative Hierarchy"])

@app.get("/")
def read_root():
    return {"message": "AnyROR Scraper API is running!"}