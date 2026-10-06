from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()

class LandRecord(Base):
    __tablename__ = "land_records"

    id = Column(Integer, primary_key=True, index=True)
    
    # Search parameters
    district_code = Column(String, index=True, nullable=False)
    taluka_code = Column(String, index=True, nullable=False)
    village_code = Column(String, index=True, nullable=False)
    survey_no = Column(String, index=True, nullable=False)
    
    # The JSON dump from the parser (Basic Details, Risk Flags, etc. - EXCEPT OCR data)
    extracted_data = Column(JSONB, nullable=False)
    
    # File paths for the downloaded documents
    pdf_file_path = Column(String, nullable=True)
    mutation_images_dir = Column(String, nullable=True)
    
    # Metadata
    is_successful = Column(Boolean, default=True)
    scraped_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    # Link to the individual mutation entries
    mutations = relationship("MutationEntry", back_populates="land_record", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("district_code", "taluka_code", "village_code", "survey_no", name="uq_district_taluka_village_survey"),
    )

    def __repr__(self):
        return f"<LandRecord(survey_no='{self.survey_no}', village='{self.village_code}')>"


class MutationEntry(Base):
    __tablename__ = "mutation_entries"

    id = Column(Integer, primary_key=True, index=True)
    land_record_id = Column(Integer, ForeignKey("land_records.id"), nullable=False)
    
    # The header for the UI
    entry_number = Column(String, index=True, nullable=False)
    
    # The Left Screen of UI: The source data
    image_file_path = Column(String, nullable=True) # Path to the raw .jpg
    scraped_html_text = Column(JSONB, nullable=True) # The official text from the AnyRoR table
    
    # The Right Screen of UI: The AI Draft vs. Final Verified Data
    ai_draft_data = Column(JSONB, nullable=False) # Gemini's original extraction
    final_verified_data = Column(JSONB, nullable=True) # Saves here after lawyer clicks "Approve/Update"
    
    # The HitL (Human-in-the-Loop) Tracking
    is_verified = Column(Boolean, default=False)
    verified_at = Column(DateTime(timezone=True), nullable=True)

    # Relationship back to the parent record
    land_record = relationship("LandRecord", back_populates="mutations")

    __table_args__ = (
        UniqueConstraint("land_record_id", "entry_number", name="uq_land_record_entry_number"),
    )

    def __repr__(self):
        return f"<MutationEntry(entry='{self.entry_number}', verified={self.is_verified})>"


class VillageSurveyIndex(Base):
    __tablename__ = "village_survey_index"

    id = Column(Integer, primary_key=True, index=True)
    district_code = Column(String, index=True, nullable=False)
    district_name = Column(String, nullable=False)
    taluka_code = Column(String, index=True, nullable=False)
    taluka_name = Column(String, nullable=False)
    village_code = Column(String, index=True, nullable=False)
    village_name = Column(String, nullable=False)
    survey_numbers = Column(JSONB, nullable=False, default=list) # Array of strings e.g. ["2", "3", "4", ...]
    total_surveys = Column(Integer, default=0)
    scraped_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        UniqueConstraint("district_code", "taluka_code", "village_code", name="uq_district_taluka_village_index"),
    )

    def __repr__(self):
        return f"<VillageSurveyIndex({self.district_name} - {self.taluka_name} - {self.village_name}: {self.total_surveys} surveys)>"


class DistrictIndex(Base):
    __tablename__ = "district_index"

    id = Column(Integer, primary_key=True, index=True)
    district_code = Column(String, unique=True, index=True, nullable=False)
    district_name = Column(String, nullable=False)
    scraped_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    def __repr__(self):
        return f"<DistrictIndex({self.district_name} - {self.district_code})>"


class TalukaIndex(Base):
    __tablename__ = "taluka_index"

    id = Column(Integer, primary_key=True, index=True)
    district_code = Column(String, index=True, nullable=False)
    taluka_code = Column(String, index=True, nullable=False)
    taluka_name = Column(String, nullable=False)
    scraped_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        UniqueConstraint("district_code", "taluka_code", name="uq_district_taluka_index"),
    )

    def __repr__(self):
        return f"<TalukaIndex({self.taluka_name} - {self.taluka_code} in District {self.district_code})>"