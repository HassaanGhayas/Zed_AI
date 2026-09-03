"""Unit tests for TranscriptService.extract_video_id — pure URL parsing logic."""
import pytest
from app.services.transcript_service import TranscriptService


class TestExtractVideoId:
    """Tests for YouTube video ID extraction from various URL formats."""

    # --- Standard watch URLs ---
    def test_standard_watch_url(self):
        url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        assert TranscriptService.extract_video_id(url) == "dQw4w9WgXcQ"

    def test_watch_url_without_www(self):
        url = "https://youtube.com/watch?v=dQw4w9WgXcQ"
        assert TranscriptService.extract_video_id(url) == "dQw4w9WgXcQ"

    def test_http_watch_url(self):
        url = "http://www.youtube.com/watch?v=dQw4w9WgXcQ"
        assert TranscriptService.extract_video_id(url) == "dQw4w9WgXcQ"

    # --- Shortened youtu.be URLs ---
    def test_short_url(self):
        url = "https://youtu.be/dQw4w9WgXcQ"
        assert TranscriptService.extract_video_id(url) == "dQw4w9WgXcQ"

    def test_short_url_with_timestamp(self):
        url = "https://youtu.be/dQw4w9WgXcQ?t=42"
        assert TranscriptService.extract_video_id(url) == "dQw4w9WgXcQ"

    # --- Embed URLs ---
    def test_embed_url(self):
        url = "https://www.youtube.com/embed/dQw4w9WgXcQ"
        assert TranscriptService.extract_video_id(url) == "dQw4w9WgXcQ"

    # --- Shorts URLs ---
    def test_shorts_url(self):
        url = "https://www.youtube.com/shorts/dQw4w9WgXcQ"
        assert TranscriptService.extract_video_id(url) == "dQw4w9WgXcQ"

    # --- Live URLs ---
    def test_live_url(self):
        url = "https://www.youtube.com/live/dQw4w9WgXcQ"
        assert TranscriptService.extract_video_id(url) == "dQw4w9WgXcQ"

    # --- Direct video ID passthrough ---
    def test_bare_video_id(self):
        assert TranscriptService.extract_video_id("dQw4w9WgXcQ") == "dQw4w9WgXcQ"

    def test_video_id_with_hyphens_underscores(self):
        # 11-char IDs can contain hyphens and underscores
        assert TranscriptService.extract_video_id("abc_-1234XY") == "abc_-1234XY"

    # --- Edge cases ---
    def test_empty_string_returns_none(self):
        assert TranscriptService.extract_video_id("") is None

    def test_none_returns_none(self):
        assert TranscriptService.extract_video_id(None) is None

    def test_whitespace_only_returns_none(self):
        assert TranscriptService.extract_video_id("   ") is None

    def test_url_with_extra_whitespace(self):
        url = "  https://youtu.be/dQw4w9WgXcQ  "
        assert TranscriptService.extract_video_id(url) == "dQw4w9WgXcQ"

    def test_garbage_url_returns_none(self):
        assert TranscriptService.extract_video_id("https://example.com/foo") is None

    def test_too_short_id_returns_none(self):
        assert TranscriptService.extract_video_id("abc123") is None

    def test_url_with_query_params_after_video_id(self):
        url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf"
        assert TranscriptService.extract_video_id(url) == "dQw4w9WgXcQ"

    # --- /v/ and /e/ path variants ---
    def test_slash_v_path(self):
        url = "https://www.youtube.com/v/dQw4w9WgXcQ"
        assert TranscriptService.extract_video_id(url) == "dQw4w9WgXcQ"

    def test_slash_e_path(self):
        url = "https://www.youtube.com/e/dQw4w9WgXcQ"
        assert TranscriptService.extract_video_id(url) == "dQw4w9WgXcQ"
