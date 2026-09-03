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
        """Synthesize video concepts with the student's verified answers into polished Markdown notes."""
        # Try Gemini generation
        try:
            client = self._get_client(custom_api_key)
            qa_summary = "\n".join([
                f"- **Topic**: {item.segment_title}\n  - **Question**: {item.question}\n  - **Student's Response**: {item.user_final_answer}\n  - **Feedback/Takeaway**: {item.ai_feedback}"
                for item in qa_history
            ])
            segments_summary = "\n".join([
                f"- **{s.title}** ({int(s.start_time // 60)}m{int(s.start_time % 60)}s - {int(s.end_time // 60)}m{int(s.end_time % 60)}s): {s.summary}"
                for s in segments
            ])

            prompt = f"""You are an expert educational note-taker and synthesis specialist.
Create comprehensive, polished, and beautifully structured study notes for:
Video: "{video_title}" (https://www.youtube.com/watch?v={video_id})

IMPORTANT REQUIREMENTS:
1. Harmonize the actual video content with the student's own responses and understanding demonstrated during the Q&A sessions.
2. Refine grammar, eliminate awkward phrasing, and integrate the student's insights with formal explanations.
3. Structure the notes with:
   - # [Video Title] - Comprehensive Study Notes
   - ## 📌 Executive Summary (Big Picture Takeaways)
   - ## 🧩 Topic Deep Dives (For each segment, combine video concepts with student's verified insights)
   - ## 💡 Active Recall Q&A & Pitfall Clarifications (Highlighting questions asked, key misconceptions addressed, and final accurate conclusions)
   - ## 📝 Review Checklist / Key Terminology Glossary
4. Use standard Markdown with bolding, lists, and callout sections (> [!NOTE]).

Source Data:
Segments Overview:
{segments_summary}

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

        # Fallback template notes generator
        lines = [
            f"# Study Notes: {video_title}",
            f"\n*Source Video: [YouTube Video](https://www.youtube.com/watch?v={video_id})*\n",
            "## 📌 Executive Summary",
            f"These study notes synthesize the fundamental principles covered across {len(segments)} topic segments, incorporating the active-recall exercises and conceptual clarifications completed during the study session.\n",
            "## 🧩 Topic Breakdown & Student Understanding\n"
        ]

        # Map QA by segment title
        qa_by_topic: Dict[str, List[QAHistoryItem]] = {}
        for qa in qa_history:
            qa_by_topic.setdefault(qa.segment_title, []).append(qa)

        for s in segments:
            lines.append(f"### {s.title}")
            lines.append(f"**Timestamp**: `{int(s.start_time // 60):02d}:{int(s.start_time % 60):02d}` - `{int(s.end_time // 60):02d}:{int(s.end_time % 60):02d}`\n")
            lines.append(f"**Concept Summary**: {s.summary}\n")
            
            topic_qas = qa_by_topic.get(s.title, [])
            if topic_qas:
                lines.append("**Your Verified Takeaways & Reflections:**")
                for item in topic_qas:
                    lines.append(f"- **Key Question**: {item.question}")
                    lines.append(f"  - **Your Explanation**: *\"{item.user_final_answer}\"*")
                    lines.append(f"  - **Concept Validation**: {item.ai_feedback}\n")
            lines.append("---")

        lines.append("\n## 💡 Active Recall Synthesis & Review")
        lines.append("- Review the questions above periodically to reinforce long-term memory retention.")
        lines.append("- Focus on concepts where initial misconceptions occurred, ensuring mental models remain precise.")

        return "\n".join(lines)

notes_service = NotesService()
