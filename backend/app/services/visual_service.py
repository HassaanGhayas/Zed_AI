import json
import os
import re
import subprocess
import time
import importlib.util
from pathlib import Path
from typing import Any, Dict, List, Optional

from google import genai
from google.genai import types

from app.core.config import settings

BACKEND_DIR = Path(__file__).resolve().parents[2]
MEDIA_DIR = BACKEND_DIR / ".cache" / "media"
FRAMES_DIR = BACKEND_DIR / ".cache" / "frames"

# Suffixes yt-dlp uses for in-progress downloads; never treat these as a cache hit.
_PARTIAL_SUFFIXES = {".part", ".ytdl", ".temp", ".frag"}

_VIDEO_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{11}$")

# Max timestamp we accept (12h) — bounds the ffmpeg seek arg and the frame filename.
_MAX_TIMESTAMP = 12 * 60 * 60

# yt-dlp/ffmpeg colorize stderr with ANSI escape codes; strip them (and the bare
# "[0;31m" form left behind once ESC is lost in transit) before showing users.
_ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]|\[[0-9;]*m")

# Cached ffmpeg binary path (imageio-ffmpeg ships a static binary; no system install).
_ffmpeg_exe_cache: Optional[str] = None


class VisualService:
    """Gemini-vision layer over extracted video frames.

    Design mirrors segmenter_service/evaluator_service: a candidate-model
    fallback loop with JSON mime responses, on-disk caching under .cache, and
    graceful degradation when the media toolchain (yt-dlp + ffmpeg) is missing.
    """

    def __init__(self):
        pass

    # ── Gemini client & config ──

    def _get_client(self, custom_api_key: str = "") -> genai.Client:
        key = custom_api_key.strip() if custom_api_key else settings.google_api_key
        return genai.Client(api_key=key)

    # ── Toolchain availability ──

    @staticmethod
    def _ffmpeg_exe() -> str:
        global _ffmpeg_exe_cache
        if _ffmpeg_exe_cache:
            return _ffmpeg_exe_cache
        import imageio_ffmpeg  # lazy: optional dependency
        _ffmpeg_exe_cache = imageio_ffmpeg.get_ffmpeg_exe()
        return _ffmpeg_exe_cache

    def _media_status(self) -> Dict[str, Any]:
        has_ydl = importlib.util.find_spec("yt_dlp") is not None
        ffmpeg: Optional[str] = None
        try:
            ffmpeg = self._ffmpeg_exe()
        except Exception as e:
            print(f"[VisualService] ffmpeg unavailable: {e}")
            ffmpeg = None
        return {"has_yt_dlp": has_ydl, "ffmpeg": ffmpeg, "ready": bool(has_ydl and ffmpeg)}

    def availability(self) -> Dict[str, Any]:
        """Whether visual analysis can run: config flag AND media toolchain present."""
        status = self._media_status()
        cfg = bool(settings.enable_visual_analysis)
        return {
            "enabled": bool(cfg and status["ready"]),
            "media_ready": status["ready"],
            "config_enabled": cfg,
        }

    # ── Validation & cookies ──

    @staticmethod
    def _validated_id(video_id: str) -> str:
        vid = (video_id or "").strip()
        if not _VIDEO_ID_RE.match(vid):
            raise ValueError("Invalid YouTube video id.")
        return vid

    @staticmethod
    def _validated_time(t_seconds: float) -> float:
        t = float(t_seconds)
        if t != t or t < 0 or t > _MAX_TIMESTAMP:  # NaN guard + bounds
            raise ValueError("Timestamp out of range.")
        return t

    @staticmethod
    def _resolve_cookies_file() -> Optional[str]:
        """Reuse the same cookie resolution as transcript_service (bot-detection)."""
        cookie_path = os.getenv("YOUTUBE_COOKIES_TXT", "")
        if not cookie_path or not os.path.isfile(cookie_path):
            for name in ("cookies.txt", "yt_cookies.txt", "youtube_cookies.txt"):
                candidate = BACKEND_DIR / name
                if candidate.is_file():
                    cookie_path = str(candidate)
                    break
        return cookie_path if cookie_path and os.path.isfile(cookie_path) else None

    # ── Media download & frame extraction ──

    @staticmethod
    def _clean_error(msg: str) -> str:
        """Strip ANSI color codes + yt-dlp's ERROR: prefix; collapse to one line."""
        text = _ANSI_RE.sub("", msg or "")
        text = re.sub(r"^\s*ERROR:\s*", "", text.strip())
        text = re.sub(r"\s+", " ", text).strip()
        return text[:300]

    @staticmethod
    def _friendly_download_error(clean: str) -> str:
        """Map common yt-dlp failures to a clear, actionable user-facing message."""
        low = clean.lower()
        if "is not available" in low:
            return (
                "This video can't be downloaded for frame analysis "
                "(it may be private, members-only, or region/age-restricted). "
                "The transcript-only experience still works."
            )
        if "needs to be reloaded" in low or "bot" in low or "confirm" in low:
            return (
                "YouTube temporarily blocked the download (automated-traffic check). "
                "Try again in a moment, or refresh your YouTube cookies."
            )
        if "login" in low or "sign in" in low or "age-restricted" in low or "age restricted" in low:
            return (
                "This video requires signing in to YouTube for frame analysis. "
                "Provide valid YouTube cookies to enable it."
            )
        if "requested format is not available" in low:
            return "No downloadable video format was offered for this video."
        if clean:
            return f"Could not download this video for frame analysis: {clean}"
        return "Could not download this video for frame analysis."

    def _find_media(self, video_id: str) -> Optional[Path]:
        if not MEDIA_DIR.is_dir():
            return None
        for path in sorted(MEDIA_DIR.glob(f"{video_id}.*")):
            if path.suffix.lower() in _PARTIAL_SUFFIXES:
                continue
            if path.is_file() and path.stat().st_size > 0:
                return path
        return None

    def _prune_old_media(self) -> None:
        """Delete cached media older than the TTL to bound disk usage."""
        try:
            ttl = float(settings.media_cache_ttl_hours) * 3600.0
            if ttl <= 0 or not MEDIA_DIR.is_dir():
                return
            cutoff = time.time() - ttl
            for path in MEDIA_DIR.iterdir():
                try:
                    if path.is_file() and path.stat().st_mtime < cutoff:
                        path.unlink()
                        print(f"[VisualService] Pruned stale media cache: {path.name}")
                except Exception:
                    pass
        except Exception:
            pass

    def ensure_media(self, video_id: str) -> Path:
        """Download (once) a low-res cached copy of the video for frame extraction."""
        vid = self._validated_id(video_id)
        cached = self._find_media(vid)
        if cached:
            return cached

        self._prune_old_media()

        import yt_dlp  # lazy: optional dependency

        MEDIA_DIR.mkdir(parents=True, exist_ok=True)
        height = int(settings.visual_frame_height)
        # Frame extraction needs VIDEO only. YouTube serves most videos as separate
        # DASH video-only + audio-only streams with no combined "best" file, so a
        # plain "b" selector matches nothing ("Requested format is not available").
        # Prefer the best single video stream ≤ height (mp4/h264 first for fast
        # ffmpeg seeking), then widen to any video-only stream, then a combined file.
        fmt = (
            f"bv*[height<={height}][ext=mp4]/bv*[height<={height}]/"
            f"bv*[ext=mp4]/bv*/b[height<={height}]/b"
        )
        opts: Dict[str, Any] = {
            "format": fmt,
            "outtmpl": str(MEDIA_DIR / "%(id)s.%(ext)s"),
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "retries": 2,
        }
        cookies = self._resolve_cookies_file()
        if cookies:
            opts["cookiefile"] = cookies

        url = f"https://www.youtube.com/watch?v={vid}"
        print(f"[VisualService] Downloading {vid} (≤{height}p) for frame extraction…")
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.download([url])
        except Exception as e:
            # Clean up any partial download files for this video
            if MEDIA_DIR.is_dir():
                for partial in MEDIA_DIR.glob(f"{vid}.*"):
                    if partial.suffix.lower() in _PARTIAL_SUFFIXES:
                        try:
                            partial.unlink()
                        except Exception:
                            pass
            # Surface a clean, friendly reason (never raw ANSI-colored tool output).
            raise RuntimeError(self._friendly_download_error(self._clean_error(str(e)))) from e

        found = self._find_media(vid)
        if not found:
            raise RuntimeError("Download completed but no media file was produced.")
        return found

    def extract_frame(self, video_id: str, t_seconds: float) -> Path:
        """Fast-seek a single JPEG frame at t_seconds (cached by millisecond)."""
        vid = self._validated_id(video_id)
        t = self._validated_time(t_seconds)
        ms = int(round(t * 1000))

        frame_dir = FRAMES_DIR / vid
        frame_dir.mkdir(parents=True, exist_ok=True)
        out_path = frame_dir / f"{ms}.jpg"
        if out_path.is_file() and out_path.stat().st_size > 0:
            return out_path

        media = self.ensure_media(vid)
        ffmpeg = self._ffmpeg_exe()
        # -ss before -i = fast input seek; one frame, high-quality JPEG.
        cmd = [
            ffmpeg, "-y",
            "-ss", f"{t:.3f}",
            "-i", str(media),
            "-frames:v", "1",
            "-q:v", "3",
            str(out_path),
        ]
        result = subprocess.run(cmd, capture_output=True, timeout=90)
        if result.returncode != 0 or not out_path.is_file() or out_path.stat().st_size == 0:
            if out_path.is_file():
                try:
                    out_path.unlink()
                except Exception:
                    pass
            err = self._clean_error(result.stderr.decode("utf-8", "ignore")[-400:])
            raise RuntimeError(f"ffmpeg frame extraction failed: {err}")
        return out_path

    # ── Gemini vision ──

    def _call_gemini_json(
        self,
        prompt: str,
        image_bytes: bytes,
        custom_api_key: str = "",
        mime: str = "image/jpeg",
    ) -> Dict[str, Any]:
        """Run a vision prompt across candidate models; return parsed JSON dict or {}."""
        try:
            client = self._get_client(custom_api_key)
            for model_name in settings.gemini_candidate_models:
                try:
                    response = client.models.generate_content(
                        model=model_name,
                        contents=[prompt, types.Part.from_bytes(data=image_bytes, mime_type=mime)],
                        config=types.GenerateContentConfig(response_mime_type="application/json"),
                    )
                    raw = (response.text or "").strip()
                    if raw.startswith("```"):
                        raw = re.sub(r"^```(?:json)?\n?", "", raw)
                        raw = re.sub(r"\n?```$", "", raw)
                    data = json.loads(raw)
                    if isinstance(data, dict):
                        return data
                except Exception as model_err:
                    print(f"[VisualService] Model {model_name} failed: {model_err}")
                    continue
        except Exception as e:
            print(f"[VisualService] All Gemini vision calls failed: {e}")
        return {}

    @staticmethod
    def _normalize_equations(raw: Any) -> List[Dict[str, str]]:
        out: List[Dict[str, str]] = []
        if isinstance(raw, list):
            for item in raw:
                if isinstance(item, dict):
                    latex = str(item.get("latex", "")).strip()
                    if latex:
                        out.append({"latex": latex, "description": str(item.get("description", "")).strip()})
                elif isinstance(item, str) and item.strip():
                    out.append({"latex": item.strip(), "description": ""})
        return out

    # ── Prompts ──

    @staticmethod
    def _explain_prompt(
        t: float,
        question: str,
        segment_title: str,
        segment_summary: str,
        transcript_excerpt: str,
    ) -> str:
        mm, ss = int(t // 60), int(t % 60)
        q_line = question.strip() if question and question.strip() else "(none — give a general explanation)"
        return f"""You are a visual learning assistant. Below is ONE frame captured from an educational YouTube video at {mm:02d}:{ss:02d}.
Explain exactly what is shown on screen and how it connects to the concept being taught.

Segment title: {segment_title or "(unknown)"}
Segment summary: {segment_summary or "(none)"}
Transcript near this moment: {transcript_excerpt[:1500] or "(none)"}
Student's question: {q_line}

Reference visible labels, arrows, diagrams, charts, code, or equations concretely.
If the frame is just a talking head or has no informative visual content, set has_visual_content to false and explain briefly using the segment context instead.

Return ONLY valid JSON with this schema:
{{
  "has_visual_content": boolean,
  "explanation": "2-5 sentences: what is on screen and why it matters, tied to the student's question if present",
  "on_screen_text": "verbatim important titles/labels/text visible, or empty string",
  "equations": [{{"latex": "LaTeX source", "description": "what it means"}}],
  "diagram_description": "what any diagram/chart illustrates, or empty string",
  "key_concept": "the single core concept this frame illustrates"
}}
"""

    @staticmethod
    def _keyframe_prompt(segment_title: str, segment_summary: str) -> str:
        return f"""You are an educational visual summarizer. Below is a representative keyframe from a video segment.

Segment title: {segment_title or "(unknown)"}
Segment summary: {segment_summary or "(none)"}

Capture the on-screen text, any equations (as LaTeX), and what any diagram shows. Also create ONE active-recall flashcard based on the visual.

Return ONLY valid JSON with this schema:
{{
  "has_visual_content": boolean,
  "on_screen_text": "verbatim important titles/labels/text visible, or empty string",
  "equations": [{{"latex": "LaTeX source", "description": "what it means"}}],
  "diagram_description": "what any diagram/chart illustrates, or empty string",
  "key_concept": "the single core concept this frame illustrates",
  "flashcard": {{"front": "recall question", "back": "concise answer"}}
}}
"""

    # ── Public operations ──

    def explain_screen(
        self,
        video_id: str,
        t_seconds: float,
        question: str = "",
        segment_title: str = "",
        segment_summary: str = "",
        transcript_excerpt: str = "",
        custom_api_key: str = "",
    ) -> Dict[str, Any]:
        t = self._validated_time(t_seconds)
        frame_path = self.extract_frame(video_id, t)
        image_bytes = frame_path.read_bytes()
        prompt = self._explain_prompt(t, question, segment_title, segment_summary, transcript_excerpt)
        data = self._call_gemini_json(prompt, image_bytes, custom_api_key)
        return self._normalize_explain(data, segment_summary)

    def _normalize_explain(self, data: Dict[str, Any], segment_summary: str) -> Dict[str, Any]:
        if not data:
            fallback = "Visual analysis is temporarily unavailable. "
            fallback += (
                f"Based on the segment: {segment_summary}"
                if segment_summary
                else "Please try again in a moment."
            )
            return {
                "explanation": fallback,
                "on_screen_text": "",
                "equations": [],
                "diagram_description": "",
                "key_concept": "",
            }
        explanation = str(
            data.get("explanation") or data.get("diagram_description") or "Here's what's on screen."
        ).strip()
        return {
            "explanation": explanation,
            "on_screen_text": str(data.get("on_screen_text", "")).strip(),
            "equations": self._normalize_equations(data.get("equations")),
            "diagram_description": str(data.get("diagram_description", "")).strip(),
            "key_concept": str(data.get("key_concept", "")).strip(),
        }

    def segment_visual(
        self,
        video_id: str,
        start_time: float,
        end_time: float,
        title: str = "",
        summary: str = "",
        custom_api_key: str = "",
    ) -> Dict[str, Any]:
        """Analyze a representative keyframe (segment midpoint) for a chapter."""
        start = self._validated_time(start_time)
        end = self._validated_time(end_time)
        t = start + max(0.0, (end - start) / 2.0)
        frame_path = self.extract_frame(video_id, t)
        image_bytes = frame_path.read_bytes()
        prompt = self._keyframe_prompt(title, summary)
        data = self._call_gemini_json(prompt, image_bytes, custom_api_key)
        visual = self._normalize_visual(data)
        return {"timestamp": round(t, 3), "visual": visual}

    def _normalize_visual(self, data: Dict[str, Any]) -> Dict[str, Any]:
        if not data:
            return {
                "has_visual_content": False,
                "on_screen_text": "",
                "equations": [],
                "diagram_description": "",
                "key_concept": "",
                "flashcard": None,
            }
        flashcard = data.get("flashcard")
        if not isinstance(flashcard, dict):
            flashcard = None
        return {
            "has_visual_content": bool(data.get("has_visual_content", False)),
            "on_screen_text": str(data.get("on_screen_text", "")).strip(),
            "equations": self._normalize_equations(data.get("equations")),
            "diagram_description": str(data.get("diagram_description", "")).strip(),
            "key_concept": str(data.get("key_concept", "")).strip(),
            "flashcard": flashcard,
        }


visual_service = VisualService()
