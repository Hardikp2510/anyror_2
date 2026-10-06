from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from app.core.config import settings

# Import all models so SQLAlchemy registers them with metadata
from app.db.models import Base, LandRecord, MutationEntry, VillageSurveyIndex, DistrictIndex, TalukaIndex

# Creates the engine using the DATABASE_URL from your config.py
engine = create_async_engine(settings.DATABASE_URL, echo=False)

# Creates a session factory for database transactions
AsyncSessionLocal = sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)
async_session_factory = AsyncSessionLocal

async def init_db():
    """Creates the tables in PostgreSQL if they don't exist yet."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

async def get_db():
    """Dependency to provide a database session to FastAPI routes."""
    async with AsyncSessionLocal() as session:
        yield session