import io
import re
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, HRFlowable, KeepTogether
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch

class PdfService:
    def __init__(self):
        pass

    def markdown_to_pdf(self, title: str, markdown_content: str) -> bytes:
        """Render markdown text into a styled, professional PDF document."""
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=letter,
            rightMargin=0.75 * inch,
            leftMargin=0.75 * inch,
            topMargin=0.75 * inch,
            bottomMargin=0.75 * inch
        )

        styles = getSampleStyleSheet()

        # Define custom styles
        primary_color = colors.HexColor("#1e293b")  # slate-800
        accent_color = colors.HexColor("#2563eb")   # blue-600
        text_color = colors.HexColor("#334155")     # slate-700
        quote_bg = colors.HexColor("#f8fafc")       # slate-50

        title_style = ParagraphStyle(
            'DocTitle',
            parent=styles['Heading1'],
            fontName='Helvetica-Bold',
            fontSize=22,
            leading=26,
            textColor=primary_color,
            spaceAfter=12
        )

        h1_style = ParagraphStyle(
            'Heading1_Custom',
            parent=styles['Heading1'],
            fontName='Helvetica-Bold',
            fontSize=16,
            leading=20,
            textColor=accent_color,
            spaceBefore=14,
            spaceAfter=6
        )

        h2_style = ParagraphStyle(
            'Heading2_Custom',
            parent=styles['Heading2'],
            fontName='Helvetica-Bold',
            fontSize=13,
            leading=17,
            textColor=primary_color,
            spaceBefore=10,
            spaceAfter=4
        )

        body_style = ParagraphStyle(
            'Body_Custom',
            parent=styles['Normal'],
            fontName='Helvetica',
            fontSize=10,
            leading=14,
            textColor=text_color,
            spaceAfter=6
        )

        bullet_style = ParagraphStyle(
            'Bullet_Custom',
            parent=styles['Normal'],
            fontName='Helvetica',
            fontSize=10,
            leading=14,
            textColor=text_color,
            leftIndent=15,
            firstLineIndent=-10,
            spaceAfter=3
        )

        quote_style = ParagraphStyle(
            'Quote_Custom',
            parent=styles['Normal'],
            fontName='Helvetica-Oblique',
            fontSize=9.5,
            leading=13.5,
            textColor=colors.HexColor("#475569"),
            leftIndent=20,
            spaceBefore=4,
            spaceAfter=6
        )

        story = []

        # Document Header
        story.append(Paragraph(self._clean_text(title), title_style))
        story.append(HRFlowable(width="100%", thickness=1.5, color=accent_color, spaceBefore=4, spaceAfter=14))

        # Process Markdown lines
        lines = markdown_content.split('\n')
        for line in lines:
            line_str = line.strip()
            if not line_str:
                story.append(Spacer(1, 4))
                continue

            # Markdown H1 (# ...)
            if line_str.startswith("# "):
                text = line_str[2:].strip()
                story.append(Spacer(1, 8))
                story.append(Paragraph(self._format_inline_markdown(text), h1_style))
                story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#cbd5e1"), spaceBefore=2, spaceAfter=6))
            # Markdown H2 (## ...)
            elif line_str.startswith("## "):
                text = line_str[3:].strip()
                story.append(Spacer(1, 6))
                story.append(Paragraph(self._format_inline_markdown(text), h1_style))
            # Markdown H3 (### ...)
            elif line_str.startswith("### "):
                text = line_str[4:].strip()
                story.append(Spacer(1, 4))
                story.append(Paragraph(self._format_inline_markdown(text), h2_style))
            # Horizontal Rule (---)
            elif line_str == "---":
                story.append(Spacer(1, 4))
                story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#e2e8f0"), spaceBefore=4, spaceAfter=4))
            # Bullet point (- or *)
            elif line_str.startswith("- ") or line_str.startswith("* "):
                text = line_str[2:].strip()
                story.append(Paragraph(f"• {self._format_inline_markdown(text)}", bullet_style))
            # Nested or sub-bullet (  - or   *)
            elif line.startswith("    - ") or line.startswith("  - "):
                text = line_str[2:].strip()
                sub_bullet = ParagraphStyle('SubBullet', parent=bullet_style, leftIndent=25)
                story.append(Paragraph(f"– {self._format_inline_markdown(text)}", sub_bullet))
            # Blockquote (> ...)
            elif line_str.startswith("> "):
                text = line_str[2:].strip()
                story.append(Paragraph(self._format_inline_markdown(text), quote_style))
            # Regular paragraph
            else:
                story.append(Paragraph(self._format_inline_markdown(line_str), body_style))

        doc.build(story)
        pdf_data = buffer.getvalue()
        buffer.close()
        return pdf_data

    def _clean_text(self, text: str) -> str:
        """Escape basic XML entities for ReportLab Paragraphs."""
        return (
            text.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
        )

    def _format_inline_markdown(self, text: str) -> str:
        """Convert markdown bold (**text**), italics (*text*), and code (`code`) to ReportLab tags."""
        # Clean entities first
        t = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        # Bold: **word** -> <b>word</b>
        t = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', t)
        # Italic: *word* -> <i>word</i>
        t = re.sub(r'(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)', r'<i>\1</i>', t)
        # Inline code: `code` -> <font name="Courier">\1</font>
        t = re.sub(r'`(.*?)`', r'<font name="Courier" color="#0f766e">\1</font>', t)
        return t

pdf_service = PdfService()
