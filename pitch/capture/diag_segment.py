"""Diagnose why Gemini chaptering falls back to heuristics. Reads key from env GEMINI_KEY.
Never prints the key. Run from D:\\ZED_AI\\backend:  python ..\\pitch\\capture\\diag_segment.py
"""
import json, os, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, os.getcwd())

key = os.environ.get("GEMINI_KEY", "")
print("GEMINI_KEY present in this shell:", bool(key), "| length:", len(key))
if not key:
    sys.exit("Set $env:GEMINI_KEY first (see instructions).")

from app.models.schemas import TranscriptCue
from app.services.segmenter_service import segmenter_service

raw = json.load(open(".cache/transcripts/aircAruvnKk.json", encoding="utf-8"))
cues = [TranscriptCue(**c) for c in raw]
print("cues:", len(cues))
segs = segmenter_service.segment_transcript("aircAruvnKk", "But what is a neural network?", cues, custom_api_key=key)
print("--- result ---")
for s in segs:
    print(s.segment_id, s.title, round(s.start_time), round(s.end_time))
