import json
import os
import re
import time
from pathlib import Path
from typing import List, Dict, Any, Optional
import httpx
import requests
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import TranscriptsDisabled, NoTranscriptFound, VideoUnavailable
from app.models.schemas import TranscriptCue

BACKEND_DIR = Path(__file__).resolve().parents[2]
TRANSCRIPT_CACHE_DIR = BACKEND_DIR / ".cache" / "transcripts"

class TranscriptService:
    def __init__(self):
        self.api = YouTubeTranscriptApi(http_client=self._build_http_client())

    @staticmethod
    def _build_http_client() -> requests.Session:
        """Browser-like session with optional cookies/proxy to work around
        YouTube bot detection (see youtube-transcript-api README, "Working
        around IP bans"). Drop a Netscape cookies.txt at backend/cookies.txt
        (or set YOUTUBE_COOKIES_TXT) and/or YOUTUBE_PROXY=http://...:port."""
        session = requests.Session()
        session.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "en-US,en;q=0.9",
        })
        cookie_path = os.getenv("YOUTUBE_COOKIES_TXT", "")
        if not cookie_path or not os.path.isfile(cookie_path):
            for name in ("cookies.txt", "yt_cookies.txt", "youtube_cookies.txt"):
                candidate = BACKEND_DIR / name
                if candidate.is_file():
                    cookie_path = str(candidate)
                    break
        if cookie_path and os.path.isfile(cookie_path):
            try:
                from http.cookiejar import MozillaCookieJar
                jar = MozillaCookieJar(cookie_path)
                jar.load(ignore_discard=True, ignore_expires=True)
                session.cookies = jar
                print(f"[TranscriptService] Using YouTube cookies from {cookie_path}")
            except Exception as e:
                print(f"[TranscriptService] Failed to load cookies from {cookie_path}: {e}")
        proxy = os.getenv("YOUTUBE_PROXY", "")
        if proxy:
            session.proxies = {"http": proxy, "https": proxy}
        return session

    # ── transcript disk cache: hit YouTube once per video, never again ──

    def _cache_path(self, video_id: str) -> Path:
        return TRANSCRIPT_CACHE_DIR / f"{video_id}.json"

    def _load_cached_cues(self, video_id: str) -> Optional[List[TranscriptCue]]:
        path = self._cache_path(video_id)
        if not path.is_file():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            cues = [TranscriptCue(**item) for item in data]
            if cues:
                print(f"[TranscriptService] Transcript cache hit for {video_id}")
                return cues
        except Exception:
            pass
        return None

    def _save_cached_cues(self, video_id: str, cues: List[TranscriptCue]) -> None:
        try:
            TRANSCRIPT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
            self._cache_path(video_id).write_text(
                json.dumps([c.model_dump() for c in cues]), encoding="utf-8"
            )
        except Exception as e:
            print(f"[TranscriptService] Could not write transcript cache: {e}")

    @staticmethod
    def extract_video_id(url: str) -> Optional[str]:
        """Extract YouTube 11-char video ID from various URL patterns."""
        if not url:
            return None
        url = url.strip()
        # Direct video ID
        if re.match(r'^[a-zA-Z0-9_-]{11}$', url):
            return url
        
        patterns = [
            r'(?:v=|\/v\/|embed\/|shorts\/|youtu\.be\/|\/e\/)([a-zA-Z0-9_-]{11})',
            r'(?:[?&]v=)([a-zA-Z0-9_-]{11})',
            r'youtube\.com\/live\/([a-zA-Z0-9_-]{11})'
        ]
        for pattern in patterns:
            match = re.search(pattern, url)
            if match:
                return match.group(1)
        return None

    async def get_video_metadata(self, video_id: str) -> Dict[str, Any]:
        """Fetch video title and author using YouTube oEmbed endpoint (no API key required)."""
        oembed_url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
        try:
            async with httpx.AsyncClient(
                timeout=10.0,
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
                    ),
                    "Accept-Language": "en-US,en;q=0.9",
                },
            ) as client:
                resp = await client.get(oembed_url)
                if resp.status_code == 200:
                    data = resp.json()
                    return {
                        "title": data.get("title", f"YouTube Video ({video_id})"),
                        "author": data.get("author_name", "Unknown Author"),
                        "thumbnail_url": data.get("thumbnail_url", f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg")
                    }
        except Exception:
            pass
        
        return {
            "title": f"YouTube Video ({video_id})",
            "author": "YouTube Creator",
            "thumbnail_url": f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg"
        }

    def _fetch_raw_cues(self, video_id: str) -> List[Dict[str, Any]]:
        """One uncached attempt at YouTube.

        Some videos publish a broken manual subtitle track alongside good
        auto-captions (e.g. a 3-cue "en" file next to a full-length generated
        "en"), so we enumerate tracks and keep the English candidate with the
        widest real coverage instead of trusting the first language match.
        """
        transcript_list = self.api.list(video_id)
        available = list(transcript_list)
        if not available:
            raise RuntimeError("No transcripts published for this video.")

        def _span(raw: List[Dict[str, Any]]) -> float:
            return (raw[-1]["start"] + raw[-1]["duration"]) if raw else 0.0

        # English candidates: keep the widest-coverage track (manual or generated).
        en_candidates = [t for t in available if t.language_code.startswith("en")]
        best_raw: Optional[List[Dict[str, Any]]] = None
        best_span = 0.0
        for t in en_candidates:
            try:
                raw = t.fetch().to_raw_data()
            except Exception:
                continue
            if raw and _span(raw) > best_span:
                best_raw, best_span = raw, _span(raw)
        if best_raw:
            return best_raw

        # No usable English track: translate the widest-coverage track to English.
        fallback = None
        fallback_span = 0.0
        for t in available:
            try:
                raw = t.fetch().to_raw_data()
            except Exception:
                continue
            if raw and _span(raw) > fallback_span:
                fallback, fallback_span = t, _span(raw)
        if fallback is not None:
            t = fallback.translate("en") if fallback.is_translatable else fallback
            return t.fetch().to_raw_data()
        raise RuntimeError("No suitable transcript found for this video.")

    def fetch_transcript_cues(self, video_id: str) -> List[TranscriptCue]:
        """Fetch timestamped transcript cues (cache first, then YouTube with retries)."""
        cached = self._load_cached_cues(video_id)
        if cached is not None:
            return cached

        # YouTube rate-limits bot-like IPs; back off and retry a couple of times
        raw_cues: Optional[List[Dict[str, Any]]] = None
        last_error: Optional[Exception] = None
        for attempt in range(3):
            try:
                raw_cues = self._fetch_raw_cues(video_id)
                break
            except Exception as e:
                last_error = e
                if attempt < 2:
                    wait = 3 * (attempt + 1)
                    print(f"[TranscriptService] Fetch attempt {attempt + 1} failed; retrying in {wait}s")
                    time.sleep(wait)
        if raw_cues is None:
            raise RuntimeError(
                f"Could not retrieve transcript for video {video_id}: {last_error} "
                "YouTube may be rate-limiting this IP temporarily — wait a while and retry, "
                "or place an exported cookies.txt in backend/ (see transcript_service notes). "
                "Successful fetches are cached, so this only happens once per video."
            )

        # Convert to TranscriptCue models
        cues: List[TranscriptCue] = []
        for item in raw_cues:
            text = item.get("text", "").replace("\n", " ").strip()
            if text:
                cues.append(TranscriptCue(
                    start=float(item.get("start", 0.0)),
                    duration=float(item.get("duration", 0.0)),
                    text=text
                ))

        if not cues:
            raise RuntimeError("Retrieved transcript is empty.")

        self._save_cached_cues(video_id, cues)
        return cues

transcript_service = TranscriptService()
