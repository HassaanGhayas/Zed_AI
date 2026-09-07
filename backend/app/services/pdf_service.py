import io
import re
from datetime import date
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, HRFlowable, Table, TableStyle, PageBreak,
    Image as RLImage
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader

# ── Light-theme palette (mirrors frontend [data-theme="light"]) ──
SURFACE = colors.HexColor("#faf3f0")   # page background
RAISED = colors.HexColor("#ffffff")    # cards
SUNKEN = colors.HexColor("#f1e3de")    # question band / soft blobs
LINE = colors.HexColor("#dfc4bd")      # borders
INK = colors.HexColor("#1e0808")       # headings
INK_MUTED = colors.HexColor("#57201b") # body
INK_FAINT = colors.HexColor("#7c3a32") # meta / footer
EMBER = colors.HexColor("#ff5100")     # brand pop
EMBER_MID = colors.HexColor("#e85d04")
EMBER_DEEP = colors.HexColor("#c2410c")  # readable ember text
EMBER_DARK = colors.HexColor("#a72906")
SUCCESS = colors.HexColor("#3d7a24")

PAGE_W, PAGE_H = letter
MARGIN_X = 0.75 * inch
AVAIL_W = PAGE_W - 2 * MARGIN_X


class PdfService:
    def __init__(self):
        pass

    # ───────────────────────────── page decor ─────────────────────────────

    def _cover_page(self, canvas, doc):
        """Fancy cover: cream wash, ember rings, soft blob, thin rounded frame."""
        canvas.saveState()
        canvas.setFillColor(SURFACE)
        canvas.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)

        # Top-right concentric ember rings + solid core
        canvas.setStrokeColor(colors.Color(1.0, 0.32, 0.0, alpha=0.28))
        canvas.setLineWidth(1.4)
        canvas.circle(PAGE_W - 46, PAGE_H - 64, 96, stroke=1, fill=0)
        canvas.circle(PAGE_W - 46, PAGE_H - 64, 66, stroke=1, fill=0)
        canvas.setFillColor(colors.Color(1.0, 0.32, 0.0, alpha=0.9))
        canvas.circle(PAGE_W - 46, PAGE_H - 64, 30, stroke=0, fill=1)
        canvas.setFillColor(colors.Color(1.0, 0.95, 0.92, alpha=1.0))
        canvas.circle(PAGE_W - 46, PAGE_H - 64, 10, stroke=0, fill=1)

        # Bottom-left soft sunken blob + ember ring
        canvas.setFillColor(colors.Color(0.945, 0.89, 0.87, alpha=1.0))
        canvas.circle(40, 52, 78, stroke=0, fill=1)
        canvas.setStrokeColor(colors.Color(0.76, 0.255, 0.075, alpha=0.45))
        canvas.setLineWidth(1.2)
        canvas.circle(40, 52, 46, stroke=1, fill=0)

        # Thin rounded frame around the cover
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.9)
        canvas.roundRect(34, 34, PAGE_W - 68, PAGE_H - 68, 20, stroke=1, fill=0)
        canvas.restoreState()

    def _later_page(self, canvas, doc):
        """Content pages: cream wash, brand header rule, warm footer."""
        canvas.saveState()
        canvas.setFillColor(SURFACE)
        canvas.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)

        # Header: brand + ember tick + hairline
        canvas.setFillColor(EMBER_DEEP)
        canvas.setFont("Helvetica-Bold", 8.5)
        canvas.drawString(MARGIN_X, PAGE_H - 42, "STUDIFY AI")
        canvas.setFillColor(INK_FAINT)
        canvas.setFont("Helvetica", 8.5)
        canvas.drawString(MARGIN_X + 64, PAGE_H - 42, "•  Personalized Study Notes")
        canvas.setStrokeColor(EMBER_MID)
        canvas.setLineWidth(2)
        canvas.line(MARGIN_X, PAGE_H - 48, MARGIN_X + 46, PAGE_H - 48)
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.6)
        canvas.line(MARGIN_X, PAGE_H - 48, PAGE_W - MARGIN_X, PAGE_H - 48)

        # Footer
        canvas.setFillColor(INK_FAINT)
        canvas.setFont("Helvetica", 8)
        canvas.drawString(MARGIN_X, 34, "Learned through active recall — review often.")
        canvas.drawRightString(PAGE_W - MARGIN_X, 34, f"Page {doc.page}")
        canvas.restoreState()

    # ───────────────────────────── main entry ─────────────────────────────

    def markdown_to_pdf(self, title: str, markdown_content: str, video_id: str = "", keyframes=None) -> bytes:
        """Render the session notes into a warm, light-themed PDF with a cover page.

        When video_id + keyframes are supplied (and visual analysis is available),
        a representative keyframe JPEG is embedded under each matching section.
        """
        keyframes = keyframes or []
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=letter,
            rightMargin=MARGIN_X,
            leftMargin=MARGIN_X,
            topMargin=0.95 * inch,
            bottomMargin=0.75 * inch,
            title=title,
            author="Studify AI",
        )

        styles = getSampleStyleSheet()

        # Cover styles
        brand_style = ParagraphStyle(
            'CoverBrand', parent=styles['Normal'], fontName='Helvetica-Bold',
            fontSize=11, leading=14, textColor=EMBER_DEEP, alignment=TA_CENTER,
        )
        cover_title_style = ParagraphStyle(
            'CoverTitle', parent=styles['Normal'], fontName='Helvetica-Bold',
            fontSize=26, leading=32, textColor=INK, alignment=TA_CENTER,
        )
        cover_sub_style = ParagraphStyle(
            'CoverSub', parent=styles['Normal'], fontName='Helvetica-Oblique',
            fontSize=13, leading=18, textColor=INK_MUTED, alignment=TA_CENTER,
        )
        cover_meta_style = ParagraphStyle(
            'CoverMeta', parent=styles['Normal'], fontName='Helvetica',
            fontSize=9.5, leading=14, textColor=INK_FAINT, alignment=TA_CENTER,
        )

        # Content styles
        section_style = ParagraphStyle(
            'SectionCard', parent=styles['Normal'], fontName='Helvetica-Bold',
            fontSize=13, leading=17, textColor=INK,
        )
        subheading_style = ParagraphStyle(
            'Subheading', parent=styles['Normal'], fontName='Helvetica-Bold',
            fontSize=11, leading=15, textColor=INK,
        )
        body_style = ParagraphStyle(
            'BodyText', parent=styles['Normal'], fontName='Helvetica',
            fontSize=10, leading=14.5, textColor=INK_MUTED,
        )
        bullet_style = ParagraphStyle(
            'BulletText', parent=styles['Normal'], fontName='Helvetica',
            fontSize=10, leading=14.5, textColor=INK_MUTED, leftIndent=16, firstLineIndent=-10,
        )
        q_style = ParagraphStyle(
            'QCard', parent=styles['Normal'], fontName='Helvetica',
            fontSize=10, leading=14.5, textColor=INK,
        )
        a_style = ParagraphStyle(
            'ACard', parent=styles['Normal'], fontName='Helvetica',
            fontSize=10, leading=14.5, textColor=INK_MUTED,
        )
        small_style = ParagraphStyle(
            'SmallNote', parent=styles['Normal'], fontName='Helvetica-Oblique',
            fontSize=9, leading=13, textColor=INK_FAINT,
        )
        cap_style = ParagraphStyle(
            'KeyframeCaption', parent=styles['Normal'], fontName='Helvetica-Oblique',
            fontSize=8.5, leading=12, textColor=INK_FAINT, alignment=TA_CENTER,
        )
        card_text_style = ParagraphStyle(
            'CardText', parent=styles['Normal'], fontName='Helvetica',
            fontSize=10, leading=14.5, textColor=INK,
        )
        revisit_title_style = ParagraphStyle(
            'RevisitTitle', parent=styles['Normal'], fontName='Helvetica-Bold',
            fontSize=11.5, leading=15, textColor=colors.HexColor("#92400e"),
        )
        revisit_bullet_style = ParagraphStyle(
            'RevisitBullet', parent=styles['Normal'], fontName='Helvetica',
            fontSize=9.5, leading=14, textColor=colors.HexColor("#78350f"), leftIndent=16, firstLineIndent=-10,
        )

        story = []

        # ── Cover page ──
        lines = [l.strip() for l in markdown_content.split('\n')]
        n_sections = sum(1 for l in lines if l.startswith('## ') and not l.lower().startswith('## concepts to revisit'))
        n_qa = len(re.findall(r'(?m)^\*\*Q\d+:?\*\*|^### ', markdown_content))
        story.append(Spacer(1, 1.9 * inch))
        story.append(Paragraph("M I N D F L O W&nbsp;&nbsp;A I", brand_style))
        story.append(Spacer(1, 22))
        story.append(Paragraph(self._format_inline_markdown(self._clean_text(title)), cover_title_style))
        story.append(Spacer(1, 8))
        story.append(Paragraph("Personalized Study Notes", cover_sub_style))
        story.append(Spacer(1, 26))
        story.append(HRFlowable(width="42%", thickness=2.5, color=EMBER_MID,
                                spaceBefore=0, spaceAfter=18, hAlign='CENTER'))
        meta = f"{n_sections} topic{'s' if n_sections != 1 else ''}" \
               f"&nbsp;&nbsp;•&nbsp;&nbsp;{n_qa} active-recall answer{'s' if n_qa != 1 else ''}" \
               f"&nbsp;&nbsp;•&nbsp;&nbsp;{date.today().strftime('%B %d, %Y')}"
        story.append(Paragraph(meta, cover_meta_style))
        story.append(PageBreak())

        # ── Content pages ──
        in_revisit_section = False
        pending_q = None  # (label, text) waiting for its answer line

        for line in markdown_content.split('\n'):
            raw = line.rstrip()
            line_str = raw.strip()
            if not line_str:
                continue

            # Check if this is the "Concepts to Revisit" section
            if line_str.lower().startswith('## concepts to revisit'):
                in_revisit_section = True
                heading_raw = line_str[3:].strip()
                callout_p = Paragraph(
                    f'<b>⚠️ &nbsp; {self._format_inline_markdown(heading_raw).upper()}</b>',
                    revisit_title_style
                )
                tbl = Table([[callout_p]], colWidths=[AVAIL_W])
                tbl.setStyle(TableStyle([
                    ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#fef3c7")),
                    ('LINEBEFORE', (0, 0), (0, -1), 4, colors.HexColor("#d97706")),
                    ('BOX', (0, 0), (-1, -1), 0.75, colors.HexColor("#f59e0b")),
                    ('ROUNDEDCORNERS', [0, 8, 8, 0]),
                    ('LEFTPADDING', (0, 0), (-1, -1), 12),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 10),
                    ('TOPPADDING', (0, 0), (-1, -1), 8),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
                ]))
                story.append(Spacer(1, 14))
                story.append(tbl)
                story.append(Spacer(1, 8))
                continue

            # Section heading → accent-bar card (strip timestamps)
            if line_str.startswith('## '):
                in_revisit_section = False
                heading_raw = line_str[3:].strip()
                heading_clean = re.sub(r'\s*\(\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?\)', '', heading_raw).strip()
                text = self._format_inline_markdown(heading_clean)
                tbl = Table([[Paragraph(text, section_style)]], colWidths=[AVAIL_W])
                tbl.setStyle(TableStyle([
                    ('BACKGROUND', (0, 0), (-1, -1), RAISED),
                    ('LINEBEFORE', (0, 0), (0, -1), 4, EMBER_MID),
                    ('BOX', (0, 0), (-1, -1), 0.75, LINE),
                    ('ROUNDEDCORNERS', [0, 8, 8, 0]),
                    ('LEFTPADDING', (0, 0), (-1, -1), 12),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 10),
                    ('TOPPADDING', (0, 0), (-1, -1), 7),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
                ]))
                story.append(Spacer(1, 12))
                story.append(tbl)
                story.append(Spacer(1, 8))
                # Embed the matching keyframe (guarded; skips silently on any failure)
                kf = self._match_keyframe(heading_clean, keyframes)
                if kf:
                    self._append_keyframe_image(story, kf, video_id, cap_style)
                continue

            # Question banner: ### [Question] (no checkpoint labels, no timestamps)
            if line_str.startswith('### '):
                sub_raw = line_str[4:].strip()
                clean_sub = re.sub(r'\s*\(\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?\)', '', sub_raw).strip()
                clean_sub = re.sub(r'^Checkpoint\s*\d*:\s*', '', clean_sub, flags=re.IGNORECASE).strip()
                clean_sub = re.sub(r'\s*\((?:Mastered|Needs\s*Review)\)', '', clean_sub, flags=re.IGNORECASE).strip()

                header_text = f"<b>{self._format_inline_markdown(clean_sub)}</b>"
                card_p = Paragraph(header_text, card_text_style)
                tbl = Table([[card_p]], colWidths=[AVAIL_W])
                tbl.setStyle(TableStyle([
                    ('BACKGROUND', (0, 0), (-1, -1), SUNKEN),
                    ('BOX', (0, 0), (-1, -1), 0.75, LINE),
                    ('ROUNDEDCORNERS', [6, 6, 6, 6]),
                    ('LEFTPADDING', (0, 0), (-1, -1), 10),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 10),
                    ('TOPPADDING', (0, 0), (-1, -1), 7),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
                ]))
                story.append(Spacer(1, 8))
                story.append(tbl)
                story.append(Spacer(1, 4))
                continue

            # Student Answer card: **Answer:** ... (heading is "Answer:")
            exp_match = re.match(r'^\*\*(?:Answer|Your\s+Answer|Your\s+Explanation|Your\s+Articulation|Articulation\s*(?:Concept)?|Explanation):?\*\*\s*(.*)$', line_str, re.IGNORECASE)
            if exp_match:
                exp_text = exp_match.group(1).strip()
                content_html = (
                    f'<font name="Helvetica-Bold" color="#a72906">Answer:</font><br/>'
                    f'<font name="Helvetica" color="#1e0808">{self._format_inline_markdown(exp_text)}</font>'
                )
                exp_p = Paragraph(content_html, body_style)
                tbl = Table([[exp_p]], colWidths=[AVAIL_W])
                tbl.setStyle(TableStyle([
                    ('BACKGROUND', (0, 0), (-1, -1), RAISED),
                    ('LINEBEFORE', (0, 0), (0, -1), 3.5, EMBER_MID),
                    ('BOX', (0, 0), (-1, -1), 0.75, LINE),
                    ('ROUNDEDCORNERS', [0, 6, 6, 0]),
                    ('LEFTPADDING', (0, 0), (-1, -1), 10),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 10),
                    ('TOPPADDING', (0, 0), (-1, -1), 6),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
                ]))
                story.append(tbl)
                story.append(Spacer(1, 6))
                continue

            # Validated concepts and tutor insights must NOT appear in the PDF
            if re.match(r'^\*\*(?:Validated\s+Concepts|Key\s+Concepts\s+Validated):?\*\*', line_str, re.IGNORECASE):
                continue
            if re.match(r'^\*\*(?:Tutor\s+Insight|Tutor\s+Takeaway|Tutor\s+Feedback):?\*\*', line_str, re.IGNORECASE):
                continue

            # Q / A lines → collect into a card pair (for legacy formats)
            q_match = re.match(r'^\*\*(Q\d+):?\*\*\s*(.*)$', line_str)
            a_match = re.match(r'^\*\*(A\d+):?\*\*\s*(.*)$', line_str)
            if q_match:
                pending_q = (q_match.group(1), q_match.group(2))
                continue
            if a_match and pending_q:
                q_label, q_text = pending_q
                a_label, a_text = a_match.group(1), a_match.group(2)
                pending_q = None
                q_para = Paragraph(
                    f'<font name="Helvetica-Bold" color="#a72906">{q_label}.</font>'
                    f'&nbsp; {self._format_inline_markdown(q_text)}', q_style)
                a_para = Paragraph(
                    f'<font name="Helvetica-Bold" color="#3d7a24">{a_label}.</font>'
                    f'&nbsp; {self._format_inline_markdown(a_text)}', a_style)
                card = Table([[q_para], [a_para]], colWidths=[AVAIL_W])
                card.setStyle(TableStyle([
                    ('BACKGROUND', (0, 0), (0, 0), SUNKEN),
                    ('BACKGROUND', (0, 1), (0, 1), RAISED),
                    ('BOX', (0, 0), (-1, -1), 0.75, LINE),
                    ('LINEBELOW', (0, 0), (0, 0), 0.6, LINE),
                    ('ROUNDEDCORNERS', [8, 8, 8, 8]),
                    ('LEFTPADDING', (0, 0), (-1, -1), 12),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 12),
                    ('TOPPADDING', (0, 0), (-1, -1), 8),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
                ]))
                story.append(card)
                story.append(Spacer(1, 8))
                continue
            if a_match:  # answer without a question — render as plain card row
                pending_q = None
                story.append(Paragraph(
                    f'<font name="Helvetica-Bold" color="#3d7a24">{a_match.group(1)}.</font>'
                    f'&nbsp; {self._format_inline_markdown(a_match.group(2))}', a_style))
                story.append(Spacer(1, 6))
                continue
            if pending_q:  # question continuation line
                q_label, q_text = pending_q
                pending_q = (q_label, f"{q_text} {line_str}")
                continue

            # Bullet points: lines starting with '-' or '*'
            if line_str.startswith('- ') or line_str.startswith('* '):
                bullet_content = line_str[2:].strip()
                cur_bullet_style = revisit_bullet_style if in_revisit_section else bullet_style
                bullet_p = Paragraph(
                    f'&bull;&nbsp;&nbsp;{self._format_inline_markdown(bullet_content)}',
                    cur_bullet_style
                )
                story.append(bullet_p)
                story.append(Spacer(1, 4))
                continue

            # Source video link or italicized note
            if line_str.startswith('*Source Video:') or line_str.startswith('_No active-recall'):
                story.append(Paragraph(self._format_inline_markdown(line_str), small_style))
                story.append(Spacer(1, 6))
                continue

            # Default body paragraph (rendered in clear normal Helvetica font, never faint italics)
            cur_body_style = revisit_bullet_style if in_revisit_section else body_style
            story.append(Paragraph(self._format_inline_markdown(line_str), cur_body_style))
            story.append(Spacer(1, 6))

        if not story:
            story.append(Paragraph("No notes were generated for this session.", small_style))

        doc.build(story, onFirstPage=self._cover_page, onLaterPages=self._later_page)
        pdf_data = buffer.getvalue()
        buffer.close()
        return pdf_data

    def _match_keyframe(self, heading_text: str, keyframes):
        """Match a '## Title (mm:ss - mm:ss)' heading to a keyframe by title."""
        if not keyframes:
            return None
        base = re.sub(r'\s*\(\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*\)\s*$', '', heading_text).strip().lower()
        if not base:
            return None
        for kf in keyframes:
            title = (kf.get("title") or "").strip().lower()
            if title and (title == base or base.startswith(title) or title.startswith(base)):
                return kf
        return None

    def _append_keyframe_image(self, story, kf, video_id: str, cap_style) -> None:
        """Embed a representative keyframe JPEG under a section. Fully guarded: any
        failure (no media toolchain, download/extract error, bad image) is swallowed
        so the PDF still builds without it."""
        try:
            if not video_id:
                return
            from app.services.visual_service import visual_service
            if not visual_service.availability().get("enabled"):
                return
            ts = float(kf.get("timestamp", 0.0))
            path = visual_service.extract_frame(video_id, ts)
            iw, ih = ImageReader(str(path)).getSize()
            if not iw or not ih:
                return
            max_w = AVAIL_W * 0.92
            max_h = 2.6 * inch
            draw_w = min(max_w, float(iw))
            draw_h = float(ih) * (draw_w / float(iw))
            if draw_h > max_h:
                draw_h = max_h
                draw_w = float(iw) * (draw_h / float(ih))
            img = RLImage(str(path), width=draw_w, height=draw_h)
            img.hAlign = 'CENTER'
            story.append(img)
            caption = (kf.get("caption") or "").strip()
            cap_text = f"Key frame @ {int(ts // 60):02d}:{int(ts % 60):02d}"
            if caption:
                cap_text += f" - {caption}"
            story.append(Paragraph(self._format_inline_markdown(cap_text), cap_style))
            story.append(Spacer(1, 8))
        except Exception as e:
            print(f"[PdfService] Keyframe embed skipped: {e}")

    def _clean_text(self, text: str) -> str:
        """Escape basic XML entities for ReportLab Paragraphs."""
        return (
            text.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
        )

    # LaTeX → Unicode Greek letter mapping
    _GREEK_LETTERS = {
        r'\alpha': 'α', r'\beta': 'β', r'\gamma': 'γ', r'\delta': 'δ',
        r'\epsilon': 'ε', r'\varepsilon': 'ε', r'\zeta': 'ζ', r'\eta': 'η',
        r'\theta': 'θ', r'\vartheta': 'ϑ', r'\iota': 'ι', r'\kappa': 'κ',
        r'\lambda': 'λ', r'\mu': 'μ', r'\nu': 'ν', r'\xi': 'ξ',
        r'\pi': 'π', r'\varpi': 'ϖ', r'\rho': 'ρ', r'\varrho': 'ϱ',
        r'\sigma': 'σ', r'\varsigma': 'ς', r'\tau': 'τ', r'\upsilon': 'υ',
        r'\phi': 'φ', r'\varphi': 'φ', r'\chi': 'χ', r'\psi': 'ψ',
        r'\omega': 'ω',
        r'\Gamma': 'Γ', r'\Delta': 'Δ', r'\Theta': 'Θ', r'\Lambda': 'Λ',
        r'\Xi': 'Ξ', r'\Pi': 'Π', r'\Sigma': 'Σ', r'\Phi': 'Φ',
        r'\Psi': 'Ψ', r'\Omega': 'Ω',
    }

    # LaTeX → Unicode math symbol mapping
    _MATH_SYMBOLS = {
        r'\times': '×', r'\cdot': '·', r'\div': '÷', r'\pm': '±',
        r'\mp': '∓', r'\leq': '≤', r'\geq': '≥', r'\neq': '≠',
        r'\approx': '≈', r'\equiv': '≡', r'\sim': '∼', r'\propto': '∝',
        r'\infty': '∞', r'\partial': '∂', r'\nabla': '∇',
        r'\sum': 'Σ', r'\prod': 'Π', r'\int': '∫',
        r'\rightarrow': '→', r'\leftarrow': '←', r'\Rightarrow': '⇒',
        r'\Leftarrow': '⇐', r'\leftrightarrow': '↔',
        r'\forall': '∀', r'\exists': '∃', r'\in': '∈', r'\notin': '∉',
        r'\subset': '⊂', r'\supset': '⊃', r'\cup': '∪', r'\cap': '∩',
        r'\circ': '∘', r'\bullet': '•', r'\ldots': '…', r'\dots': '…',
        r'\deg': '°', r'\angle': '∠', r'\perp': '⊥', r'\parallel': '∥',
    }

    def _convert_latex_expr(self, expr: str) -> str:
        """Convert a single LaTeX math expression (content between $ signs) to ReportLab markup."""
        result = expr

        # Replace \frac{num}{den} → (num/den)
        result = re.sub(r'\\frac\{([^}]*)\}\{([^}]*)\}', r'(\1/\2)', result)

        # Replace \sqrt{x} → √x
        result = re.sub(r'\\sqrt\{([^}]*)\}', r'√\1', result)

        # Replace \overline{x} → x̄  (best-effort: just keep the content)
        result = re.sub(r'\\overline\{([^}]*)\}', r'\1̄', result)

        # Replace \text{...} or \mathrm{...} → just the text
        result = re.sub(r'\\(?:text|mathrm|mathit|mathbf)\{([^}]*)\}', r'\1', result)

        # Replace Greek letters and math symbols (longest commands first to avoid partial matches)
        all_symbols = {**self._GREEK_LETTERS, **self._MATH_SYMBOLS}
        for latex_cmd in sorted(all_symbols, key=len, reverse=True):
            result = result.replace(latex_cmd, all_symbols[latex_cmd])

        # Replace subscripts: x_{text} → x<sub>text</sub>
        result = re.sub(r'_\{([^}]*)\}', r'<sub>\1</sub>', result)
        # Single-char subscript: x_n → x<sub>n</sub>
        result = re.sub(r'_([a-zA-Z0-9])', r'<sub>\1</sub>', result)

        # Replace superscripts: x^{text} → x<super>text</super>
        result = re.sub(r'\^\{([^}]*)\}', r'<super>\1</super>', result)
        # Single-char superscript: x^2 → x<super>2</super>
        result = re.sub(r'\^([a-zA-Z0-9])', r'<super>\1</super>', result)

        # Strip any remaining unknown backslash commands
        result = re.sub(r'\\[a-zA-Z]+', '', result)
        # Clean up stray braces left over
        result = result.replace('{', '').replace('}', '')

        return result

    def _replace_latex_dollars(self, text: str) -> str:
        """Find all $...$ inline math in *text* and convert to ReportLab markup."""
        def _repl(match):
            return self._convert_latex_expr(match.group(1))
        # Match single $...$ but skip $$...$$ (display math)
        return re.sub(r'(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)', _repl, text)

    def _format_inline_markdown(self, text: str) -> str:
        """Convert markdown bold/italic/code/links/LaTeX to ReportLab tags."""
        # 1. Escape XML entities
        t = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        # 2. Convert LaTeX math expressions
        t = self._replace_latex_dollars(t)
        # 3. Links: [text](url) -> clickable anchor
        t = re.sub(r'\[([^\]]+)\]\((https?://[^)\s]+)\)',
                   r'<a href="\2" color="#c2410c">\1</a>', t)
        # 4. Bold: **word** -> <b>word</b>
        t = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', t)
        # 5. Italic: *word* -> <i>word</i>
        t = re.sub(r'(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)', r'<i>\1</i>', t)
        # 6. Inline code: `code`
        t = re.sub(r'`(.*?)`', r'<font name="Courier" color="#a72906">\1</font>', t)
        return t


pdf_service = PdfService()
