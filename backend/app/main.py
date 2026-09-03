from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.routes_video import router as video_router
from app.api.routes_qa import router as qa_router
from app.api.routes_notes import router as notes_router

app = FastAPI(
    title="Active Recall Video Learning API",
    description="Interactive Socratic YouTube Video Learning Platform with Adaptive Misconception Resolution",
    version="1.0.0"
)

# CORS middleware for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(video_router)
app.include_router(qa_router)
app.include_router(notes_router)

@app.get("/api/health")
async def health_check():
    return {
        "status": "online",
        "service": "active-recall-video-tutor",
        "gemini_model": settings.gemini_model
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
