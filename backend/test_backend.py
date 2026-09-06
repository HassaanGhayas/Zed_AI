import asyncio
import json
from app.services.transcript_service import transcript_service
from app.services.segmenter_service import segmenter_service
from app.services.evaluator_service import evaluator_service
from app.services.notes_service import notes_service
from app.services.pdf_service import pdf_service
from app.services.visual_service import visual_service
from app.core.config import settings
from app.models.schemas import TranscriptCue, Question, Segment, QAHistoryItem

def test_pipeline():
    print("Testing TranscriptService URL extraction...")
    video_id = transcript_service.extract_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    assert video_id == "dQw4w9WgXcQ", f"Expected dQw4w9WgXcQ, got {video_id}"
    print("[OK] Video ID extraction passed.")

    print("Testing Heuristic Segmenter...")
    mock_cues = [
        TranscriptCue(start=0.0, duration=30.0, text="Welcome to linear algebra and vector spaces."),
        TranscriptCue(start=30.0, duration=30.0, text="Vectors can be added and scaled."),
        TranscriptCue(start=60.0, duration=40.0, text="A basis is a linearly independent spanning set."),
        TranscriptCue(start=100.0, duration=50.0, text="In summary, span and independence determine dimensionality.")
    ]
    segments = segmenter_service.segment_transcript(
        video_id=video_id,
        video_title="Introduction to Vectors",
        cues=mock_cues
    )
    assert len(segments) >= 1, "Segments should not be empty"
    print(f"[OK] Generated {len(segments)} segments successfully.")

    print("Testing Evaluator (Substantive Correct)...")
    eval_res = evaluator_service.evaluate_answer(
        question_prompt="What is a vector space?",
        expected_concept="A set closed under vector addition and scalar multiplication",
        segment_summary="Covers vector addition and scaling.",
        segment_transcript="Vectors can be added and scaled.",
        user_answer="It is a collection of objects that can be added together and scaled by numbers.",
        attempt_count=1
    )
    print(f"[OK] Evaluator returned: status={eval_res.status}, is_correct={eval_res.is_correct}, score={eval_res.score}")
    assert eval_res.is_correct is True
    assert eval_res.score >= 80
    assert eval_res.can_advance is True
    assert eval_res.needs_review is False

    print("Testing Evaluator (Attempt 1 Retry Prompt)...")
    eval_retry = evaluator_service.evaluate_answer(
        question_prompt="What is a vector space?",
        expected_concept="A set closed under vector addition and scalar multiplication",
        segment_summary="Covers vector addition and scaling.",
        segment_transcript="Vectors can be added and scaled.",
        user_answer="It has numbers.",
        attempt_count=1
    )
    assert eval_retry.is_correct is False
    assert eval_retry.can_advance is False
    assert eval_retry.needs_review is False
    assert eval_retry.retry_question is not None
    print(f"[OK] Retry question generated: {eval_retry.retry_question}")

    print("Testing Evaluator (Strict 3-Attempt Ceiling - No Auto-Pass)...")
    eval_ceiling = evaluator_service.evaluate_answer(
        question_prompt="What is a vector space?",
        expected_concept="A set closed under vector addition and scalar multiplication",
        segment_summary="Covers vector addition and scaling.",
        segment_transcript="Vectors can be added and scaled.",
        user_answer="It is just lines.",
        attempt_count=3
    )
    assert eval_ceiling.is_correct is False, "Failed attempt 3 must NOT auto-pass as correct"
    assert eval_ceiling.can_advance is True, "Student must be permitted to advance after 3 attempts"
    assert eval_ceiling.needs_review is True, "Segment must be flagged as Needs Review"
    assert eval_ceiling.retry_question is None, "No more retry questions after attempt 3"
    print(f"[OK] Strict 3-attempt ceiling verified: needs_review={eval_ceiling.needs_review}, can_advance={eval_ceiling.can_advance}")

    print("Testing Notes & PDF Generation...")
    qa_history = [
        QAHistoryItem(
            segment_title=segments[0].title,
            question="What is a vector space?",
            user_final_answer="A set closed under addition and scaling",
            ai_feedback="Great intuition!",
            attempts=1
        )
    ]
    notes = notes_service.generate_personalized_notes(
        video_title="Introduction to Vectors",
        video_id=video_id,
        segments=segments,
        qa_history=qa_history
    )
    assert len(notes) > 50, "Generated notes should have substantial content"
    print(f"[OK] Notes generated ({len(notes)} chars).")

    pdf_bytes = pdf_service.markdown_to_pdf(
        title="Introduction to Vectors",
        markdown_content=notes
    )
    assert len(pdf_bytes) > 500, "PDF bytes should be generated"
    print(f"[OK] PDF successfully compiled ({len(pdf_bytes)} bytes).")

    print("\nALL BACKEND VERIFICATION TESTS PASSED SUCCESSFULLY!")


# ─────────────────────── Visual analysis (Gemini vision) ───────────────────────

class _FakeModels:
    """Mimics genai client.models: fails the first candidate, then returns fenced JSON."""
    def __init__(self, fail_first=True):
        self.calls = 0
        self.fail_first = fail_first

    def generate_content(self, model=None, contents=None, config=None):
        self.calls += 1
        if self.fail_first and self.calls == 1:
            raise RuntimeError("primary model unavailable")
        class _R:
            text = (
                '```json\n'
                '{"has_visual_content": true, '
                '"explanation": "A diagram showing vector addition.", '
                '"on_screen_text": "v + w", '
                '"key_concept": "vector addition", '
                '"diagram_description": "Two arrows forming a parallelogram.", '
                '"equations": [{"latex": "v + w", "description": "sum of vectors"}]}'
                '\n```'
            )
        return _R()


class _FakeClient:
    def __init__(self, fail_first=True):
        self.models = _FakeModels(fail_first)


class _AllFailClient:
    """Every candidate model raises — exercises the empty/{} fallback path."""
    def __init__(self):
        self.models = self

    def generate_content(self, **kwargs):
        raise RuntimeError("no models available")


def test_visual_service():
    print("\nTesting VisualService validation guards...")
    for bad in ["../etc/passwd", "abc", "dQw4w9WgXcQextra", "id/slash0000", "", "...........\n"]:
        try:
            visual_service._validated_id(bad)
            assert False, f"Expected ValueError for video_id={bad!r}"
        except ValueError:
            pass
    assert visual_service._validated_id("dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    for bad_t in [-1.0, float("nan"), float("inf"), 1e9]:
        try:
            visual_service._validated_time(bad_t)
            assert False, f"Expected ValueError for t={bad_t!r}"
        except ValueError:
            pass
    assert visual_service._validated_time(12.5) == 12.5
    print("[OK] Validation guards (path traversal / bounds) passed.")

    print("Testing error-message sanitization (ANSI strip + friendly mapping)...")
    raw = "\x1b[0;31mERROR:\x1b[0m [youtube] pVCeZfBNE9Y: This video is not available"
    cleaned = visual_service._clean_error(raw)
    assert "\x1b" not in cleaned and "[0;31m" not in cleaned, cleaned
    assert "This video is not available" in cleaned, cleaned
    # Bare-ANSI form (ESC byte lost in transit) must also be stripped.
    bare = visual_service._clean_error("[0;31mERROR:[0m [youtube] abc: This video is not available")
    assert "[0;31m" not in bare and bare.startswith("[youtube]"), bare
    friendly = visual_service._friendly_download_error(cleaned)
    assert "can't be downloaded" in friendly and "\x1b" not in friendly, friendly
    assert "cookies" in visual_service._friendly_download_error("The page needs to be reloaded.")
    print("[OK] Error sanitization + friendly mapping passed.")

    print("Testing Gemini JSON parsing + candidate-model fallback (mocked client)...")
    orig_get_client = visual_service._get_client
    orig_models = settings.gemini_candidate_models
    try:
        fake = _FakeClient(fail_first=True)
        visual_service._get_client = lambda custom_api_key="": fake
        settings.gemini_candidate_models = ["model-primary", "model-fallback"]
        data = visual_service._call_gemini_json("prompt", b"\xff\xd8\xfffakejpeg")
        assert data.get("has_visual_content") is True, data
        assert data.get("key_concept") == "vector addition", data
        assert fake.models.calls == 2, f"Expected candidate fallback (2 calls), got {fake.models.calls}"
        norm = visual_service._normalize_explain(data, "segment summary")
        assert norm["equations"][0]["latex"] == "v + w", norm
        assert "parallelogram" in norm["diagram_description"], norm
        vis = visual_service._normalize_visual(data)
        assert vis["has_visual_content"] is True and vis["flashcard"] is None, vis

        # Every model failing → {} → graceful fallback explanation (never raises).
        visual_service._get_client = lambda custom_api_key="": _AllFailClient()
        settings.gemini_candidate_models = ["m1", "m2"]
        empty = visual_service._call_gemini_json("prompt", b"x")
        assert empty == {}, empty
        fb = visual_service._normalize_explain(empty, "Segment about vectors.")
        assert fb["explanation"] and "vectors" in fb["explanation"].lower(), fb
    finally:
        visual_service._get_client = orig_get_client
        settings.gemini_candidate_models = orig_models
    print("[OK] Gemini JSON parsing + candidate fallback + empty fallback passed.")


def test_visual_frame_extraction_live():
    """Optional live check: real ffmpeg frame extraction + cache hit/miss.
    Skips cleanly when the media toolchain (ffmpeg) is unavailable."""
    status = visual_service._media_status()
    if not status.get("ffmpeg"):
        print("\n[SKIP] ffmpeg unavailable — skipping live frame-extraction test.")
        return
    import subprocess
    from app.services.visual_service import MEDIA_DIR, FRAMES_DIR

    vid = "testvid0001"  # 11 chars → satisfies the id regex
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    media_path = MEDIA_DIR / f"{vid}.mp4"
    ffmpeg = status["ffmpeg"]
    if not (media_path.is_file() and media_path.stat().st_size > 0):
        # Generate a tiny 2s clip locally (no network) so ensure_media() cache-hits.
        gen = subprocess.run(
            [ffmpeg, "-y", "-f", "lavfi", "-i",
             "testsrc=size=320x240:rate=10:duration=2", "-pix_fmt", "yuv420p",
             str(media_path)],
            capture_output=True, timeout=60,
        )
        if gen.returncode != 0 or not media_path.is_file():
            print("\n[SKIP] Could not synthesize a local test clip — skipping live test.")
            return
    try:
        frame_dir = FRAMES_DIR / vid
        if frame_dir.is_dir():
            for f in frame_dir.glob("*.jpg"):
                f.unlink()
        # Cache miss → real extraction
        p1 = visual_service.extract_frame(vid, 1.0)
        assert p1.is_file() and p1.stat().st_size > 0, "frame must be a non-empty JPEG"
        size, mtime1 = p1.stat().st_size, p1.stat().st_mtime
        # Cache hit → identical path, not re-extracted (mtime unchanged)
        p2 = visual_service.extract_frame(vid, 1.0)
        assert p2 == p1 and p2.stat().st_mtime == mtime1, "second call must hit the cache"
        print(f"\n[OK] Live frame extraction + cache hit/miss passed ({size} bytes).")
    finally:
        # Tidy up the synthetic fixtures so they never pollute the real cache.
        try:
            if media_path.is_file():
                media_path.unlink()
            if frame_dir.is_dir():
                for f in frame_dir.glob("*.jpg"):
                    f.unlink()
                frame_dir.rmdir()
        except Exception:
            pass


def test_visual_routes():
    """Availability/degradation: endpoints return a friendly 503 when the toolchain
    is unavailable, and invalid ids are rejected with 400 before any download."""
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    orig = visual_service.availability
    try:
        # Unsupported toolchain → availability.enabled False + 503 on every endpoint.
        visual_service.availability = lambda: {
            "enabled": False, "media_ready": False, "config_enabled": False,
        }
        r = client.get("/api/video/visual/availability")
        assert r.status_code == 200 and r.json()["enabled"] is False, r.text
        r = client.get("/api/video/frame", params={"video_id": "dQw4w9WgXcQ", "t": 5})
        assert r.status_code == 503, r.status_code
        assert "unavailable" in r.json()["detail"].lower(), r.text
        r = client.post("/api/video/explain-frame",
                        json={"video_id": "dQw4w9WgXcQ", "timestamp": 5})
        assert r.status_code == 503, r.status_code
        r = client.post("/api/video/segment-visual",
                        json={"video_id": "dQw4w9WgXcQ", "start_time": 0, "end_time": 10})
        assert r.status_code == 503, r.status_code

        # Enabled but invalid id → 400 (validation runs before any media access).
        visual_service.availability = lambda: {
            "enabled": True, "media_ready": True, "config_enabled": True,
        }
        r = client.get("/api/video/frame", params={"video_id": "bad../../id", "t": 5})
        assert r.status_code == 400, r.status_code
    finally:
        visual_service.availability = orig
    print("[OK] Visual route degradation (503) + invalid-id (400) passed.")


class _FixedPayloadModels:
    """Mimics a model that returns a canned JSON payload (e.g. a hallucinated timeline)."""
    def __init__(self, payload):
        self._payload = payload

    def generate_content(self, model=None, contents=None, config=None):
        class _R:
            text = self._payload
        return _R()


class _FixedPayloadClient:
    def __init__(self, payload):
        self.models = _FixedPayloadModels(payload)


def test_segmenter_timeline_repair():
    """A model returning a compressed 0-10 timeline for a ~5min video must be
    rescaled onto the real duration, kept contiguous, and keep its titles."""
    print("\nTesting SegmenterService timeline repair (compressed model timeline)...")
    cues = [
        TranscriptCue(start=5.96, duration=4.12, text="Hey, kids."),
        TranscriptCue(start=160.0, duration=4.0, text="Friction opposes motion between surfaces."),
        TranscriptCue(start=324.919, duration=3.601, text="videos. See you soon."),
    ]
    total = round(cues[-1].start + cues[-1].duration, 1)  # 328.5

    def seg(sid, title, s, e):
        return {
            "segment_id": sid, "title": title, "start_time": s, "end_time": e,
            "summary": f"Summary {sid}.",
            "questions": [{"id": f"x{sid}", "prompt": "p", "expected_concept": "e", "hints": ["h"]}],
        }

    compressed = json.dumps([
        seg(1, "Defining Force and Motion", 0.0, 4.0),
        seg(2, "Categorizing Forces", 4.0, 7.0),
        seg(3, "Empirical Observation", 7.0, 10.0),
    ])

    orig = segmenter_service._get_client
    try:
        segmenter_service._get_client = lambda custom_api_key="": _FixedPayloadClient(compressed)
        segs = segmenter_service.segment_transcript("pVCeZfBNE9Y", "What is Friction", cues)
    finally:
        segmenter_service._get_client = orig

    assert len(segs) == 3, f"expected 3 segments, got {len(segs)}"
    assert segs[0].start_time == 0.0, segs[0].start_time
    assert abs(segs[-1].end_time - total) < 0.01, segs[-1].end_time
    for a, b in zip(segs, segs[1:]):
        assert abs(a.end_time - b.start_time) < 0.01, "segments must be contiguous"
    for s in segs:
        assert s.end_time - s.start_time > 30.0, f"segment too short after repair: {s.start_time}-{s.end_time}"
    assert segs[0].title == "Defining Force and Motion", "titles must survive repair"
    assert [q.id for s in segs for q in s.questions] == ["s1_q1", "s2_q1", "s3_q1"]
    print(f"[OK] Compressed 0-10 timeline repaired to 0-{segs[-1].end_time}: "
          f"{[(s.start_time, s.end_time) for s in segs]}")


if __name__ == "__main__":
    test_pipeline()
    test_segmenter_timeline_repair()
    test_visual_service()
    test_visual_frame_extraction_live()
    test_visual_routes()
    print("\nVISUAL ANALYSIS TESTS COMPLETE.")
