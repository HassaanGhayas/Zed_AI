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
            qa_summary = "\n".join([
                f"- **Topic**: {item.segment_title}\n  - **Question**: {item.question}\n  - **Student's Response**: {item.user_final_answer}"
                for item in qa_history
            ])
            segments_summary = "\n".join([
                f"- **{s.title}** ({int(s.start_time // 60):02d}:{int(s.start_time % 60):02d} - {int(s.end_time // 60):02d}:{int(s.end_time % 60):02d})"
                for s in segments
            ])

            # Visual context captured from keyframes (Gemini vision), when present.
            # Fed in as SOURCE CONTEXT only so answers can reference diagrams/equations;
            # it intentionally does not add new sections (notes stay minimal Q&A).
            visual_lines = []
            for s in segments:
                v = getattr(s, "visual", None)
                if not v:
                    continue
                bits = []
                if getattr(v, "diagram_description", ""):
                    bits.append(f"diagram: {v.diagram_description}")
                if getattr(v, "key_concept", ""):
                    bits.append(f"key concept: {v.key_concept}")
                for eq in (getattr(v, "equations", []) or []):
                    latex = getattr(eq, "latex", "")
                    if latex:
                        desc = getattr(eq, "description", "")
                        bits.append(f"equation: ${latex}$" + (f" ({desc})" if desc else ""))
                if bits:
                    visual_lines.append(f"- **{s.title}**: " + "; ".join(bits))
            visual_context = "\n".join(visual_lines)

            prompt = f"""You are an expert educational note-taker.
Create MINIMAL, clean study notes for the video: "{video_title}" (https://www.youtube.com/watch?v={video_id})

STRICT FORMAT RULES:
1. Output ONLY straight question/answer pairs grouped by topic segment. No executive summary, no concept summaries, no glossary, no checklists, no feedback or commentary, no emojis, and do NOT repeat the video title as a heading (the document already prints one).
2. For each segment that has Q&A history, write exactly:
   ## [Segment Title] ([mm:ss] - [mm:ss])
   **Q1:** [question, verbatim]
   **A1:** [student's final answer; keep it verbatim, at most fix spelling/grammar]
   (number questions Q1/Q2... per segment)
3. Skip segments with no Q&A history entirely.
4. Use plain Markdown only (## headings and **bold** labels). Nothing else.

Source Data:
Segments Overview:
{segments_summary}

Visual Context (from keyframes; may be empty — use ONLY to enrich answers where relevant, do NOT add headings or new sections):
{visual_context}

Student Q&A History:
{qa_summary}
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

        # Fallback template notes generator — minimal, straight Q&A only.
        # No emojis: the PDF's Helvetica font cannot encode them (garbled glyphs).
        lines = [
            f"*Source Video: [YouTube Video](https://www.youtube.com/watch?v={video_id})*\n",
        ]

        # Map QA by segment title
        qa_by_topic: Dict[str, List[QAHistoryItem]] = {}
        for qa in qa_history:
            qa_by_topic.setdefault(qa.segment_title, []).append(qa)

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
                lines.append(f"**Q{i}:** {item.question}")
                lines.append(f"**A{i}:** {item.user_final_answer}\n")

        if len(lines) == 1:
            lines.append("_No active-recall questions were completed in this session._")

        return "\n".join(lines)

notes_service = NotesService()
