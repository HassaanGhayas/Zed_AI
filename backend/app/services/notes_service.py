from typing import List, Dict, Any
from google import genai
from app.core.config import settings
from app.models.schemas import Segment, QAHistoryItem

class NotesService:
    def __init__(self):
        pass

    def _get_client(self, custom_api_key: str = "") -> genai.Client:
        key = custom_api_key.strip() if custom_api_key else settings.google_api_key
        return genai.Client(api_key=key)

    def generate_personalized_notes(
        self,
        video_title: str,
        video_id: str,
        segments: List[Segment],
        qa_history: List[QAHistoryItem],
        custom_api_key: str = ""
    ) -> str:
        """Synthesize the session's Q&A into minimal, straight question/answer Markdown notes."""
        # Try Gemini generation
        try:
            client = self._get_client(custom_api_key)
            qa_details = []
            flagged_items = []
            for item in qa_history:
                flag_txt = " [NEEDS REVIEW]" if item.needs_review else " [MASTERED]"
                misc_txt = f", Misconceptions: {', '.join(item.misconceptions)}" if item.misconceptions else ""
                concepts_txt = f", Understood: {', '.join(item.understood_concepts)}" if item.understood_concepts else ""
                qa_details.append(
                    f"- **Topic**: {item.segment_title}{flag_txt}\n"
                    f"  - **Question**: {item.question}\n"
                    f"  - **Student's Articulation**: {item.user_final_answer}\n"
                    f"  - **Tutor Feedback**: {item.ai_feedback}{concepts_txt}{misc_txt}"
                )
                if item.needs_review or item.misconceptions:
                    flagged_items.append(
                        f"- **{item.segment_title}**: Concept: {item.question} | Notes: {', '.join(item.misconceptions) or 'Requires conceptual revision'}"
                    )
            qa_summary = "\n".join(qa_details)
            flagged_summary = "\n".join(flagged_items) if flagged_items else "None (All checkpoints mastered)."
            segments_summary = "\n".join([f"- **{s.title}**: {s.summary}" for s in segments]) or "No segment summaries available."
            visual_context = "\n".join([
                f"- **{s.title}**: {s.visual.key_concept or s.visual.diagram_description}"
                for s in segments
                if getattr(s, "visual", None) and (getattr(s.visual, "key_concept", None) or getattr(s.visual, "diagram_description", None))
            ]) or "None recorded."

            prompt = f"""You are an expert personalized educational synthesis tutor.
Create high-value, personalized study notes for the lecture: "{video_title}" (https://www.youtube.com/watch?v={video_id})

IMPORTANT PEDAGOGICAL RULES:
1. Personalization: Synthesize each segment by honoring the student's own wording, intuitions, and analogies where they showed genuine mastery.
2. If the student had misconceptions or a segment is marked [NEEDS REVIEW], do NOT pretend it was mastered. Instead, include a dedicated "## Concepts to Revisit" section at the end detailing the exact conceptual gaps and how to think about them correctly.
3. Keep the notes clean, structured, and easy to review before an exam. Use Markdown headings (## and ###) and bullet points.
4. Do NOT use emojis (PDF export standard fonts cannot render emoji glyphs).
5. Do NOT repeat the video title as the top heading (the viewer header prints it).

Source Data:
Segments Overview:
{segments_summary}

Keyframe Visual Insights (use where equations/diagrams were discussed):
{visual_context}

Student Checkpoint History:
{qa_summary}

Flagged Checkpoints Requiring Review:
{flagged_summary}
"""
            for model_name in settings.gemini_candidate_models:
                try:
                    response = client.models.generate_content(
                        model=model_name,
                        contents=prompt
                    )
                    if response.text and response.text.strip():
                        return response.text.strip()
                except Exception as model_err:
                    print(f"[NotesService] Model {model_name} failed: {model_err}")
                    continue
        except Exception as e:
            print(f"[NotesService] Gemini call failed ({e}). Falling back to template synthesis.")

        # Fallback template notes generator — clean, personalized synthesis without emojis.
        lines = [
            f"*Source Video: [YouTube Lecture](https://www.youtube.com/watch?v={video_id})*\n",
        ]

        # Map QA by segment title
        qa_by_topic: Dict[str, List[QAHistoryItem]] = {}
        for qa in qa_history:
            qa_by_topic.setdefault(qa.segment_title, []).append(qa)

        revisit_items: List[str] = []

        for s in segments:
            topic_qas = qa_by_topic.get(s.title, [])
            if not topic_qas:
                continue
            lines.append(
                f"## {s.title} "
                f"({int(s.start_time // 60):02d}:{int(s.start_time % 60):02d} - "
                f"{int(s.end_time // 60):02d}:{int(s.end_time % 60):02d})\n"
            )
            for i, item in enumerate(topic_qas, 1):
                status_label = " (Needs Review)" if item.needs_review else " (Mastered)"
                lines.append(f"### Checkpoint {i}: {item.question}{status_label}")
                lines.append(f"**Your Explanation:** {item.user_final_answer}")
                if item.understood_concepts:
                    lines.append(f"**Validated Concepts:** {', '.join(item.understood_concepts)}")
                lines.append(f"**Tutor Insight:** {item.ai_feedback}\n")

                if item.needs_review or item.misconceptions:
                    misc_desc = ", ".join(item.misconceptions) if item.misconceptions else "Review key mechanisms"
                    revisit_items.append(f"- **{s.title}**: {misc_desc} (Question: {item.question})")

        if revisit_items:
            lines.append("## Concepts to Revisit\n")
            lines.append("The following topics encountered difficulties during active recall. Review before your exam:\n")
            for r in revisit_items:
                lines.append(r)
            lines.append("")

        if len(lines) == 1:
            lines.append("_No active-recall questions were completed in this session._")

        return "\n".join(lines)

notes_service = NotesService()
