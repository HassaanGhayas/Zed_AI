import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    google_api_key: str = os.getenv("GOOGLE_API_KEY", "")
    gemini_model: str = "gemini-2.0-flash"
    gemini_candidate_models: list[str] = [
        "gemini-3.6-flash",
        "gemini-2.5-flash",
        "gemini-2.0-flash",
        "gemini-1.5-flash",
        "gemini-2.0-flash-lite"
    ]
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "https://studify-ai-three.vercel.app",
    ]
    cors_origin_regex: str | None = None

    # ── Visual analysis (Gemini vision over extracted video frames) ──
    # Toggled via ENABLE_VISUAL_ANALYSIS env var; degrades gracefully when the
    # media toolchain (yt-dlp + ffmpeg) is unavailable.
    enable_visual_analysis: bool = True
    visual_frame_height: int = 480
    visual_clip_seconds: float = 6.0
    media_cache_ttl_hours: int = 72

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
