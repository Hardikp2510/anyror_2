import os
from pathlib import Path
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent.parent

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore"
    )

    # Application Configuration
    PROJECT_NAME: str = "AnyROR Land Intelligence SaaS"
    ENVIRONMENT: str = Field(default="development", description="development | production | testing")
    DEBUG: bool = Field(default=True)

    # Database Settings
    DATABASE_URL: str = os.getenv("DATABASE_URL", "postgresql+asyncpg://anyror_admin:supersecretpassword123@localhost:5435/anyror_saas_db")
    DB_POOL_SIZE: int = Field(default=10)
    DB_MAX_OVERFLOW: int = Field(default=20)

    # Scraper & Navigation Settings
    BASE_URL: str = "https://anyror.gujarat.gov.in/LandRecordRural.aspx"
    HEADLESS: bool = Field(default=False)
    MAX_CAPTCHA_RETRIES: int = Field(default=5)
    NAVIGATION_TIMEOUT_MS: int = Field(default=60000, description="60 second explicit timeout")
    ELEMENT_TIMEOUT_MS: int = Field(default=60000, description="60 second explicit timeout")
    
    # Target Integrated Survey Number Value (8 on AnyROR dropdown)
    INTEGRATED_RECORD_TYPE_VALUE: str = "8"

    # CAPTCHA Model
    CAPTCHA_MODEL_PATH: Path = Field(default=BACKEND_DIR / "captcha" / "captcha_model_v1.pth")

    # File Storage Paths
    STORAGE_DIR: Path = Field(default=BACKEND_DIR / "storage")
    OUTPUT_DIR: Path = Field(default=BACKEND_DIR / "output")
    
    # Target CSS Selectors
    SELECTORS: dict[str, str] = {
        "record_type": "#ContentPlaceHolder1_drpLandRecord",
        "district": "#ContentPlaceHolder1_ddlDistrict",
        "taluka": "#ContentPlaceHolder1_ddlTaluka",
        "village": "#ContentPlaceHolder1_ddlVillage",
        "survey_no": "#ContentPlaceHolder1_ddlSurveyNo",
        "captcha_img": "#ContentPlaceHolder1_i_captcha_1",
        "captcha_input": "#ContentPlaceHolder1_txt_captcha_1",
        "submit_btn": "#ContentPlaceHolder1_btnGo",
        "refresh_btn": "#ContentPlaceHolder1_lb_refresh_1"
    }

    @property
    def pdf_storage_dir(self) -> Path:
        p = self.STORAGE_DIR / "pdfs"
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def html_storage_dir(self) -> Path:
        p = self.STORAGE_DIR / "html"
        p.mkdir(parents=True, exist_ok=True)
        return p

settings = Settings()