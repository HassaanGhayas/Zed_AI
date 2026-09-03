"""Unit tests for SegmenterService._heuristic_segmentation — pure logic, no API calls."""
import pytest
from app.models.schemas import TranscriptCue, Segment, Question
from app.services.segmenter_service import SegmenterService


@pytest.fixture
def segmenter():
    return SegmenterService()


def _make_cues(texts, start=0.0, step=30.0):
    """Helper: build a list of TranscriptCue from a list of text strings."""
    cues = []
    for i, text in enumerate(texts):
        cues.append(TranscriptCue(start=start + i * step, duration=step, text=text))
    return cues


class TestHeuristicSegmentation:
    """Tests for the heuristic fallback segmenter."""

    def test_empty_cues_returns_single_segment(self, segmenter):
        segments = segmenter._heuristic_segmentation("Test Video", [], 0.0)
        assert len(segments) == 1
        assert segments[0].segment_id == 1
        assert "Test Video" in segments[0].title

    def test_short_video_produces_three_segments(self, segmenter):
        # 300 seconds total → < 600 → 3 segments
        cues = _make_cues([
            "Friction is a force that opposes motion between surfaces.",
            "There are two types: static and kinetic friction.",
            "Static friction prevents motion while kinetic friction slows moving objects.",
            "Surface roughness and normal force affect friction strength.",
            "Lubricants reduce friction by separating surfaces.",
            "In summary, friction is essential for everyday motion control.",
        ], step=50.0)
        total = cues[-1].start + cues[-1].duration
        segments = segmenter._heuristic_segmentation("Friction", cues, total)
        assert len(segments) == 3

    def test_medium_video_produces_four_segments(self, segmenter):
        # 900 seconds → >= 600 and < 1200 → 4 segments
        cues = _make_cues([f"Cue text number {i}" for i in range(20)], step=45.0)
        total = cues[-1].start + cues[-1].duration
        segments = segmenter._heuristic_segmentation("Physics", cues, total)
        assert len(segments) == 4

    def test_long_video_produces_five_segments(self, segmenter):
        # 1500 seconds → >= 1200 → 5 segments
        cues = _make_cues([f"Cue text number {i}" for i in range(30)], step=50.0)
        total = cues[-1].start + cues[-1].duration
        segments = segmenter._heuristic_segmentation("Chemistry", cues, total)
        assert len(segments) == 5

    def test_segments_are_contiguous(self, segmenter):
        cues = _make_cues([
            "Introduction to vectors and their properties.",
            "Vector addition follows the parallelogram law.",
            "Scalar multiplication changes magnitude.",
            "Linear independence means no vector is a combination of others.",
            "A basis spans the entire vector space.",
            "Dimension equals the number of basis vectors.",
        ], step=50.0)
        total = cues[-1].start + cues[-1].duration
        segments = segmenter._heuristic_segmentation("Linear Algebra", cues, total)

        # Each segment's end_time should equal the next segment's start_time
        for i in range(len(segments) - 1):
            assert segments[i].end_time == segments[i + 1].start_time

    def test_first_segment_starts_at_zero(self, segmenter):
        cues = _make_cues(["First cue text here.", "Second cue text here."], step=60.0)
        total = cues[-1].start + cues[-1].duration
        segments = segmenter._heuristic_segmentation("Test", cues, total)
        assert segments[0].start_time == 0.0

    def test_last_segment_ends_at_total_duration(self, segmenter):
        cues = _make_cues(["First cue text here.", "Second cue text here."], step=60.0)
        total = cues[-1].start + cues[-1].duration
        segments = segmenter._heuristic_segmentation("Test", cues, total)
        assert segments[-1].end_time == pytest.approx(total, abs=0.1)

    def test_each_segment_has_at_least_one_question(self, segmenter):
        cues = _make_cues([
            "Photosynthesis converts light energy to chemical energy.",
            "Chlorophyll absorbs red and blue light.",
            "The Calvin cycle fixes carbon dioxide into glucose.",
        ], step=100.0)
        total = cues[-1].start + cues[-1].duration
        segments = segmenter._heuristic_segmentation("Biology", cues, total)
        for seg in segments:
            assert len(seg.questions) >= 1

    def test_question_ids_are_unique(self, segmenter):
        cues = _make_cues([f"Topic text {i}" for i in range(8)], step=50.0)
        total = cues[-1].start + cues[-1].duration
        segments = segmenter._heuristic_segmentation("Ecology", cues, total)
        all_ids = [q.id for seg in segments for q in seg.questions]
        assert len(all_ids) == len(set(all_ids)), "Question IDs must be unique"

    def test_title_brackets_stripped(self, segmenter):
        cues = _make_cues(["Some content about the topic."], step=60.0)
        total = cues[-1].start + cues[-1].duration
        segments = segmenter._heuristic_segmentation("My Video (Episode 1)", cues, total)
        # Title should not contain the bracketed part
        assert "Episode 1" not in segments[0].title

    def test_filler_sentences_filtered_from_summary(self, segmenter):
        cues = _make_cues([
            "Hey everyone, welcome back to the channel.",
            "Gravity is the curvature of spacetime caused by mass.",
            "Objects follow geodesics in curved spacetime.",
        ], step=60.0)
        total = cues[-1].start + cues[-1].duration
        segments = segmenter._heuristic_segmentation("Gravity", cues, total)
        # The summary should not start with the filler greeting
        first_summary = segments[0].summary.lower()
        assert not first_summary.startswith("hey everyone")

    def test_segment_ids_are_one_indexed(self, segmenter):
        cues = _make_cues([f"Content line {i}" for i in range(6)], step=50.0)
        total = cues[-1].start + cues[-1].duration
        segments = segmenter._heuristic_segmentation("Math", cues, total)
        assert segments[0].segment_id == 1
        for i, seg in enumerate(segments):
            assert seg.segment_id == i + 1
