from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # Reads GOOGLE_API_KEY from the environment or .env.
    google_api_key: str = Field(default="", validation_alias=AliasChoices("GOOGLE_API_KEY", "google_api_key"))
    gemini_model: str = "gemini-3.8-flash"
    gemini_candidate_models: list[str] = [
        "gemini-3.8-flash",
        "gemini-3.6-flash",
        "gemini-3.5-flash-lite"
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

    # ── Abuse protection ──
    max_audio_bytes: int = 10 * 1024 * 1024
    rate_limit_enabled: bool = True
    rate_limit_per_minute: int = 30          # per IP, per endpoint group
    rate_limit_frame_per_minute: int = 120   # frame images load in bursts

    # ── Supabase (optional: auth, cloud sync, shared cache) ──
    supabase_url: str = ""
    supabase_service_key: str = ""   # service role; backend only, never sent to the browser
    supabase_jwt_secret: str = ""    # only for legacy HS256 projects

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
