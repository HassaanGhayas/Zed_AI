import json
import re
from typing import List
from collections import Counter
from google import genai
from google.genai import types
from app.core.config import settings
from app.models.schemas import TranscriptCue, Segment, Question

class SegmenterService:
    def __init__(self):
        pass

    def _get_client(self, custom_api_key: str = "") -> genai.Client:
        key = custom_api_key.strip() if custom_api_key else settings.google_api_key
        return genai.Client(api_key=key)

    def segment_transcript(
        self,
        video_id: str,
        video_title: str,
        cues: List[TranscriptCue],
        custom_api_key: str = ""
    ) -> List[Segment]:
        """Divide the transcript cues into pedagogical segments with active recall questions."""
        total_duration = cues[-1].start + cues[-1].duration if cues else 0.0
        
        # Build timestamped transcript text
        transcript_text = "\n".join(
            f"[{int(c.start // 60):02d}:{int(c.start % 60):02d}] {c.text}"
            for c in cues
        )
        
        # Attempt Gemini segmentation across candidate models
        try:
            client = self._get_client(custom_api_key)
            prompt = f"""You are an elite educational instructional designer.
Analyze the following timestamped video transcript for "{video_title}".
Your task is to break the video into 3 to 6 logical pedagogical segments based on topic shifts.
For EACH segment, you must provide:
1. segment_id (1-indexed integer)
2. title (short, clear topic title representing the concept covered)
3. start_time (start in SECONDS, float, on the same 0..{total_duration:.1f} scale as the transcript timestamps)
4. end_time (end in SECONDS, float, must align with where the topic naturally concludes)
5. summary (2-3 concise sentences explaining the scientific/conceptual mechanism explained in this segment. Do NOT include greetings or video filler)
6. questions: 1 to 2 targeted active-recall conceptual questions. Each question must have:
   - id: unique string e.g. "s1_q1"
   - prompt: specific question asking user to explain the mechanism/reasoning in their own words (e.g. "What causes friction to oppose the motion of objects?", NOT generic "summarize the video")
   - expected_concept: concise core criteria of the concept (e.g. "force opposing relative motion when surfaces interact")
   - hints: 1-2 helpful nudges

Ensure segments are contiguous and cover from 0.0 to {total_duration:.1f} seconds.

Return ONLY a valid JSON array of segments conforming to this structure:
[
  {{
    "segment_id": 1,
    "title": "Introduction to Friction",
    "start_time": 0.0,
    "end_time": 120.5,
    "summary": "Friction is a resistive force that opposes the motion of surfaces sliding or attempting to slide against each other.",
    "questions": [
      {{
        "id": "s1_q1",
        "prompt": "How does friction affect moving objects, and what causes it between surfaces?",
        "expected_concept": "Opposes motion due to surface roughness or microscopic contact",
        "hints": ["Consider what happens when two surfaces rub together."]
      }}
    ]
  }}
]

Transcript:
{transcript_text[:25000]}
"""
            for model_name in settings.gemini_candidate_models:
                try:
                    response = client.models.generate_content(
                        model=model_name,
                        contents=prompt,
                        config=types.GenerateContentConfig(
                            response_mime_type="application/json"
                        )
                    )
                    raw_text = response.text.strip()
                    if raw_text.startswith("```"):
                        raw_text = re.sub(r"^```(?:json)?\n?", "", raw_text)
                        raw_text = re.sub(r"\n?```$", "", raw_text)
                    
                    data = json.loads(raw_text)
                    segments = [Segment(**item) for item in data]
                    if segments:
                        fixed = self._sanitize_segments(segments, total_duration)
                        if fixed:
                            return fixed
                        print(f"[SegmenterService] Model {model_name} returned an unusable timeline; trying next.")
                except Exception as model_err:
                    print(f"[SegmenterService] Model {model_name} attempt failed: {model_err}")
                    continue

        except Exception as e:
            print(f"[SegmenterService] All Gemini calls failed ({e}). Falling back to heuristic segmenter.")

        # Fallback heuristic segmenter:
        return self._heuristic_segmentation(video_title, cues, total_duration)

    def _sanitize_segments(
        self,
        segments: List[Segment],
        total_duration: float
    ) -> List[Segment]:
        """Repair model-produced timelines so segments always cover the real video.

        Models sometimes return a compressed/hallucinated scale (e.g. 0-10 for a
        5-minute video). Rescale proportionally onto the true duration, force
        contiguity and full coverage, and reject degenerate partitions.
        Returns None when the timeline is unusable (caller falls back).
        """
        if not segments or total_duration <= 0:
            return None

        segs = sorted(segments, key=lambda s: s.start_time)
        last_end = segs[-1].end_time
        if last_end <= 0:
            return None

        # Rescale when the model's timeline doesn't match the real duration.
        if abs(last_end - total_duration) > max(5.0, 0.1 * total_duration):
            factor = total_duration / last_end
            for s in segs:
                s.start_time = round(s.start_time * factor, 1)
                s.end_time = round(s.end_time * factor, 1)

        # Force exact, contiguous coverage of [0, total_duration].
        segs[0].start_time = 0.0
        for i in range(len(segs) - 1):
            segs[i].end_time = segs[i + 1].start_time
        segs[-1].end_time = round(total_duration, 1)

        # Reject partitions with degenerate (sub-second) or reversed segments.
        for s in segs:
            if s.end_time - s.start_time < 1.0:
                return None

        for i, s in enumerate(segs, 1):
            s.segment_id = i
            # Keep question ids unique and consistent with the repaired ordering.
            for qi, q in enumerate(s.questions, 1):
                q.id = f"s{s.segment_id}_q{qi}"
        return segs

    def _heuristic_segmentation(
        self,
        video_title: str,
        cues: List[TranscriptCue],
        total_duration: float
    ) -> List[Segment]:
        """Heuristic fallback that partitions transcript into balanced logical segments with meaningful concepts."""
        clean_title = re.sub(r'[\(\[\{].*?[\)\]\}]', '', video_title).strip()
        
        if not cues:
            return [
                Segment(
                    segment_id=1,
                    title=f"Core Concepts of {clean_title[:30]}",
                    start_time=0.0,
                    end_time=max(total_duration, 60.0),
                    summary=f"Overview of the fundamental mechanisms in {clean_title}.",
                    questions=[
                        Question(
                            id="s1_q1",
                            prompt=f"In your own words, what is the primary mechanism or force discussed in {clean_title}, and how does it work?",
                            expected_concept=f"Core explanation of {clean_title} and how it functions.",
                            hints=["Reflect on the real-world examples given in this section."]
                        )
                    ]
                )
            ]

        # Target 3 to 4 segments depending on duration
        num_segments = 3 if total_duration < 600 else 4 if total_duration < 1200 else 5
        segment_duration = total_duration / num_segments
        segments: List[Segment] = []

        cue_idx = 0
        num_cues = len(cues)

        stopwords = {
            "the", "a", "an", "is", "in", "it", "of", "and", "to", "that", "this",
            "we", "you", "i", "hey", "kids", "today", "video", "welcome", "ready",
            "let", "lets", "begin", "there", "are", "have", "ever", "wondered", "why",
            "your", "when", "or", "on", "can", "so", "what", "with", "as", "for"
        }

        for i in range(num_segments):
            seg_id = i + 1
            start_t = i * segment_duration
            end_t = (i + 1) * segment_duration if seg_id < num_segments else total_duration

            # Gather cues within this time window
            seg_cues: List[TranscriptCue] = []
            while cue_idx < num_cues and (cues[cue_idx].start < end_t or seg_id == num_segments):
                seg_cues.append(cues[cue_idx])
                cue_idx += 1

            seg_text = " ".join(c.text for c in seg_cues) if seg_cues else clean_title

            # Filter conversational filler sentences for a cleaner summary
            sentences = [s.strip() for s in re.split(r'[.!?]+', seg_text) if s.strip()]
            informative_sentences = [
                s for s in sentences
                if not any(s.lower().startswith(f) for f in ["hey", "hello", "welcome", "in today", "let's begin", "are you ready"])
                and len(s.split()) >= 4
            ]

            if informative_sentences:
                clean_summary = ". ".join(informative_sentences[:2]) + "."
            else:
                clean_summary = f"Discussion of the main principles of {clean_title}."

            # Find top salient domain keywords UNIQUE to this segment
            words = re.findall(r'\b[a-zA-Z]{4,}\b', seg_text.lower())
            keywords = [w for w in words if w not in stopwords]
            freq = Counter(keywords).most_common(6)
            top_terms = [w for w, _ in freq] if freq else ["mechanism", "properties"]

            # Primary label: most frequent non-stopword
            topic_label = top_terms[0].capitalize() if top_terms else "Fundamentals"
            # Secondary label: second-most frequent — gives differentiation between segments
            second_term = top_terms[1].capitalize() if len(top_terms) > 1 else (top_terms[0].capitalize() if top_terms else "properties")
            # Tertiary — for final segment variety
            third_term = top_terms[2].capitalize() if len(top_terms) > 2 else second_term

            if seg_id == 1:
                title = f"Introduction to {topic_label}"
            elif seg_id == num_segments:
                title = f"Applications & Key Properties of {third_term}"
            else:
                title = f"{second_term}: Types & Interactions"

            # --- Distinct question per segment based on cognitive dimension ---
            # Segment 1 → DEFINITION: what is it, how does it arise?
            # Segment 2+ middle → CLASSIFICATION / MECHANISM: types, differences, how it works
            # Final segment → FACTORS / APPLICATION: what affects it, why does it matter?
            if seg_id == 1:
                prompt = (
                    f"How would you define {topic_label.lower()} in your own words, "
                    f"and what real-world scenario from the video best demonstrates why it matters?"
                )
                expected = (
                    f"A definition of {topic_label.lower()} identifying its cause and a concrete real-world example"
                )
                hints = [
                    f"Think about what physically causes {topic_label.lower()} to occur — what interaction is happening?",
                    "What everyday situation was used at the start of the video to introduce it?"
                ]

            elif seg_id == num_segments:
                prompt = (
                    f"What key factors affect the strength of {topic_label.lower()}, "
                    f"and what would happen if {third_term.lower()} were changed in a real experiment?"
                )
                expected = (
                    f"Factors controlling {topic_label.lower()} (surface texture, material, weight) and how changing {third_term.lower()} affects the outcome"
                )
                hints = [
                    f"What surface or material properties were discussed as increasing or decreasing {topic_label.lower()}?",
                    f"Think about a scenario where {third_term.lower()} is different — smoother vs rougher, heavier vs lighter."
                ]

            else:
                # Middle segments — probe classification, types, or mechanism
                prompt = (
                    f"The video described different types or states of {topic_label.lower()}. "
                    f"Can you explain the key distinction involving {second_term.lower()} — "
                    f"what makes it different from the other type?"
                )
                expected = (
                    f"Clear distinction between types of {topic_label.lower()}, specifically what makes {second_term.lower()} different in terms of motion or state"
                )
                hints = [
                    f"Does {second_term.lower()} occur when the object is still moving or before it starts to move?",
                    f"Think about what changes physically between the two types — is the object stationary or in motion?"
                ]

            q = Question(
                id=f"s{seg_id}_q1",
                prompt=prompt,
                expected_concept=expected,
                hints=hints
            )

            segments.append(Segment(
                segment_id=seg_id,
                title=title,
                start_time=round(start_t, 1),
                end_time=round(end_t, 1),
                summary=clean_summary,
                questions=[q]
            ))

        return segments

segmenter_service = SegmenterService()
