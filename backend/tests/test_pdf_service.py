import pytest

from app.services.pdf_service import pdf_service


@pytest.mark.parametrize(
    "md",
    [
        "**a *b** c*",
        "*a **b* c**",
        "<b>unclosed",
        "[x](https://a.com/?a=1&b=2) **bold** `code`",
        "| a | b |\n|---|---|\n| 1 | 2 |",
    ],
)
def test_markdown_to_pdf_never_raises_on_odd_markdown(md):
    out = pdf_service.markdown_to_pdf("T", md)
    assert out.startswith(b"%PDF")


def test_misnested_emphasis_degrades_instead_of_breaking():
    t = pdf_service._format_inline_markdown("**a *b** c*")
    assert pdf_service._is_wellformed(t)
    assert "a" in t and "b" in t and "c" in t


def test_wellformed_markdown_keeps_formatting():
    t = pdf_service._format_inline_markdown("**bold** and *it*")
    assert "<b>bold</b>" in t and "<i>it</i>" in t
