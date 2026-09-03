import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    google_api_key: str = os.getenv("GOOGLE_API_KEY", "")
    gemini_model: str = "gemini-2.0-flash"
    gemini_candidate_models: list[str] = [
        "gemini-2.0-flash",
        "gemini-1.5-flash",
        "gemini-2.0-flash-lite",
        "gemini-2.5-flash"
    ]
    cors_origins: list[str] = ["*"]

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
