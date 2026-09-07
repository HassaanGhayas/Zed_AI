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

    def polish_student_grammar(self, text: str) -> str:
        """Rule-based grammar and spelling polisher for student explanations.
        
        Fixes common student typos, phonetic slips, capitalization, spacing,
        and punctuation so study notes remain clear and academic.
        """
        if not text or not text.strip():
            return ""
        
        s = text.strip()

        # Dictionary of common typos and speech-to-text / quick-typing slips
        corrections = {
            r'\btransportaton\b': 'transportation',
            r'\benerjy\b': 'energy',
            r'\bend etc\.?\b': 'etc.',
            r'\band etc\.?\b': 'etc.',
            r'\bteh\b': 'the',
            r'\bwaht\b': 'what',
            r'\bbecuase\b': 'because',
            r'\bdefination\b': 'definition',
            r'\boccurrs\b': 'occurs',
            r'\boccuring\b': 'occurring',
            r'\buntill\b': 'until',
            r'\bseperate\b': 'separate',
            r'\bdiffrent\b': 'different',
            r'\beletronegativity\b': 'electronegativity',
            r'\belectromagetic\b': 'electromagnetic',
            r'\bpartical\b': 'particle',
            r'\bparticals\b': 'particles',
            r'\bmeduim\b': 'medium',
            r'\boccilation\b': 'oscillation',
            r'\boccillations\b': 'oscillations',
            r'\bvibraton\b': 'vibration',
            r'\bvibratons\b': 'vibrations',
            r'\bfrequence\b': 'frequency',
            r'\bwavelenth\b': 'wavelength',
            r'\bamplitud\b': 'amplitude',
        }

        import re
        for pattern, replacement in corrections.items():
            s = re.sub(pattern, replacement, s, flags=re.IGNORECASE)

        # Fix spacing before commas and periods
        s = re.sub(r'\s+([,.:;?!])', r'\1', s)
        # Fix missing space after commas
        s = re.sub(r',([^\s\d])', r', \1', s)
        # Fix multiple spaces
        s = re.sub(r'\s{2,}', ' ', s)

        # Capitalize isolated 'i' -> 'I'
        s = re.sub(r'\b(i)\b', 'I', s)

        # Capitalize first letter of sentences
        def cap_sentence(m):
            return m.group(1) + m.group(2).upper()
        s = re.sub(r'(^|[.?!]\s+)([a-z])', cap_sentence, s)

        # Ensure terminal punctuation if missing, avoid double dots
        s = re.sub(r'\.{2,}', '.', s)
        if s and s[-1] not in '.?!':
            s += '.'

        return s

    def generate_personalized_notes(
        self,
        video_title: str,
        video_id: str,
        segments: List[Segment],
        qa_history: List[QAHistoryItem],
        custom_api_key: str = ""
    ) -> str:
        """Synthesize video concepts with the student's grammar-refined answers into polished Markdown notes."""
        # 1. Build segment overview
        segments_summary = "\n".join([
            f"- **{s.title}** ({int(s.start_time // 60):02d}:{int(s.start_time % 60):02d} - {int(s.end_time // 60):02d}:{int(s.end_time % 60):02d}): {s.summary}"
            for s in segments
        ])

        # 2. Extract visual context from keyframes (Gemini Vision)
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
        visual_context = "\n".join(visual_lines) if visual_lines else "None recorded."

        # 3. Pre-audit student grammar on QA history items
        qa_details = []
        flagged_items = []
        for item in qa_history:
            flag_txt = " [NEEDS REVIEW]" if item.needs_review else " [MASTERED]"
            misc_txt = f", Misconceptions: {', '.join(item.misconceptions)}" if item.misconceptions else ""
            concepts_txt = f", Understood: {', '.join(item.understood_concepts)}" if item.understood_concepts else ""
            cleaned_answer = self.polish_student_grammar(item.user_final_answer)
            qa_details.append(
                f"- **Topic**: {item.segment_title}{flag_txt}\n"
                f"  - **Question**: {item.question}\n"
                f"  - **Student's Articulation (Raw)**: {item.user_final_answer}\n"
                f"  - **Student's Articulation (Pre-Polished)**: {cleaned_answer}\n"
                f"  - **Tutor Feedback**: {item.ai_feedback}{concepts_txt}{misc_txt}"
            )
            if item.needs_review or item.misconceptions:
                flagged_items.append(
                    f"- **{item.segment_title}**: Concept: {item.question} | Notes: {', '.join(item.misconceptions) or 'Requires conceptual revision'}"
                )
        qa_summary = "\n".join(qa_details) if qa_details else "No active-recall checkpoints recorded."
        flagged_summary = "\n".join(flagged_items) if flagged_items else "None (All checkpoints mastered)."

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
            prompt = f"""You are an expert personalized educational synthesis tutor and editor.
Synthesize high-value, personalized study notes for the lecture: "{video_title}" (https://www.youtube.com/watch?v={video_id}).

CRITICAL PEDAGOGICAL & EDITORIAL RULES:
1. MANDATORY GRAMMAR & SPELLING AUDIT:
   For every student response, you MUST perform a thorough grammar, spelling, and phrasing check (e.g. fix typos like "transportaton" -> "transportation", "enerjy" -> "energy", "end etc." -> "etc.").
   Preserve the student's authentic concepts, intuitions, and real-world analogies, but formulate them in polished, grammatically impeccable English.

2. SYNTHESIS STRUCTURE (FOLLOW THIS EXACT MARKDOWN PATTERN):
   For each topic segment with completed questions:
   ## [Segment Title]
   ### [Question Prompt]
   **Answer:** [Grammar-checked, polished version of the student's answer]

   CRITICAL PROHIBITIONS:
   - NO TIMESTAMPS. Do NOT include ([mm:ss] - [mm:ss]) anywhere.
   - NO CHECKPOINT LABELS. Do NOT write "Checkpoint N:" or status labels like "[Mastered]" or "[Needs Review]". Just the question itself as a ### heading.
   - NO "Validated Concepts" or "Tutor Insight" sections. Do NOT include these under any circumstances.
   - Use exactly "**Answer:**" as the heading for the student's response.

3. CONCEPTS TO REVISIT SECTION:
   If any question is marked [NEEDS REVIEW] or has misconceptions, conclude the notes with:
   ## Concepts to Revisit
   The following topics encountered difficulties during active recall. Review before your exam:
   - **[Topic Title]**: [Specific misconception or gap identified and guidance on the correct conceptual model]

4. GENERAL FORMATTING RULES:
   - Use standard Markdown (## for topic sections, ### for questions, **bold** labels, and bullet points).
   - Do NOT use emojis (the PDF export engine cannot render emoji glyphs).
   - Do NOT repeat the video title as a top heading (the viewer header prints it).

Source Data:
Segments Overview:
{segments_summary}

Keyframe Visual Insights (use where equations/diagrams were discussed):
{visual_context}

Student Question History:
{qa_summary}

Flagged Questions Requiring Review:
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

        # Fallback template notes generator — clean, grammar-refined synthesis without emojis.
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
                polished_answer = self.polish_student_grammar(item.user_final_answer)
                lines.append(f"### Checkpoint {i}: {item.question}{status_label}")
                lines.append(f"**Your Explanation:** {polished_answer}")
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

