from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.models.schemas import HealthResponse
from app.routers.attendance import router as attendance_router
from app.routers.auth import router as auth_router
from app.routers.chat import router as chat_router
from app.routers.knowledge_base import router as knowledge_base_router
from app.routers.performance import router as performance_router
from app.routers.recruitment import router as recruitment_router


def create_app() -> FastAPI:
    """Build and configure the FastAPI application."""
    settings = get_settings()
    application = FastAPI(
        title="TalentAI HR Intelligence API",
        version="1.0.0",
    )

    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.frontend_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @application.get("/health", response_model=HealthResponse, tags=["health"])
    def health() -> HealthResponse:
        return HealthResponse(status="ok", service="talentai-backend")

    application.include_router(auth_router)
    application.include_router(recruitment_router)
    application.include_router(attendance_router)
    application.include_router(performance_router)
    application.include_router(knowledge_base_router)
    application.include_router(chat_router)
    return application


app = create_app()
