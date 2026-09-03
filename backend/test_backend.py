import asyncio
from app.services.transcript_service import transcript_service
from app.services.segmenter_service import segmenter_service
from app.services.evaluator_service import evaluator_service
from app.services.notes_service import notes_service
from app.services.pdf_service import pdf_service
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

    print("Testing Evaluator...")
    eval_res = evaluator_service.evaluate_answer(
        question_prompt="What is a vector space?",
        expected_concept="A set closed under vector addition and scalar multiplication",
        segment_summary="Covers vector addition and scaling.",
        segment_transcript="Vectors can be added and scaled.",
        user_answer="It is a collection of objects that can be added together and scaled by numbers.",
        attempt_count=1
    )
    print(f"[OK] Evaluator returned: status={eval_res.status}, is_correct={eval_res.is_correct}")

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

if __name__ == "__main__":
    test_pipeline()
