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
        """Convert markdown bold (**text**), italics (*text*), code (`code`), and LaTeX ($...$) to ReportLab tags."""
        # 1. Escape XML entities
        t = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        # 2. Convert LaTeX math expressions  ($F_n$ → F<sub>n</sub>, $\mu$ → μ, etc.)
        t = self._replace_latex_dollars(t)
        # 3. Bold: **word** -> <b>word</b>
        t = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', t)
        # 4. Italic: *word* -> <i>word</i>
        t = re.sub(r'(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)', r'<i>\1</i>', t)
        # 5. Inline code: `code` -> <font name="Courier">\1</font>
        t = re.sub(r'`(.*?)`', r'<font name="Courier" color="#0f766e">\1</font>', t)
        return t

pdf_service = PdfService()
