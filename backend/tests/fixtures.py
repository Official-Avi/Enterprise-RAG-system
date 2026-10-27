"""Builders for test documents (generated in code; no binary fixtures in the repo)."""

from __future__ import annotations

import io
import zipfile


def _pdf_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def make_text_pdf(pages: list[str]) -> bytes:
    """Minimal valid PDF with a Helvetica text layer; one string per page (lines split on \\n)."""
    objects: list[bytes] = []
    n_pages = len(pages)
    page_ids = [4 + 2 * i for i in range(n_pages)]
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    kids = " ".join(f"{pid} 0 R" for pid in page_ids)
    objects.append(f"<< /Type /Pages /Kids [{kids}] /Count {n_pages} >>".encode())
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    for i, text in enumerate(pages):
        lines = text.split("\n")
        ops = ["BT", "/F1 11 Tf", "14 TL", "50 780 Td"]
        for line in lines:
            ops.append(f"({_pdf_escape(line)}) Tj T*")
        ops.append("ET")
        stream = "\n".join(ops).encode("latin-1")
        content_id = page_ids[i] + 1
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] "
            f"/Resources << /Font << /F1 3 0 R >> >> /Contents {content_id} 0 R >>".encode()
        )
        objects.append(b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n"
                       + stream + b"\nendstream")
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for num, body in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(f"{num} 0 obj\n".encode() + body + b"\nendobj\n")
    xref = out.tell()
    out.write(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for off in offsets:
        out.write(f"{off:010d} 00000 n \n".encode())
    out.write(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
              .encode())
    return out.getvalue()


def make_scanned_pdf(lines: list[str]) -> bytes:
    """Image-only PDF (no text layer) with large rendered text, for OCR tests."""
    from PIL import Image, ImageDraw, ImageFont

    image = Image.new("RGB", (1240, 1754), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=44)
    y = 120
    for line in lines:
        draw.text((100, y), line, fill="black", font=font)
        y += 80
    buf = io.BytesIO()
    image.save(buf, format="PDF", resolution=150)
    return buf.getvalue()


def make_blank_pdf() -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (600, 800), "white").save(buf, format="PDF")
    return buf.getvalue()


def make_docx(heading: str, paragraphs: list[str], table: list[list[str]] | None = None) -> bytes:
    import docx

    document = docx.Document()
    document.add_heading(heading, level=1)
    for p in paragraphs:
        document.add_paragraph(p)
    if table:
        t = document.add_table(rows=len(table), cols=len(table[0]))
        for r, row in enumerate(table):
            for c, value in enumerate(row):
                t.cell(r, c).text = value
    buf = io.BytesIO()
    document.save(buf)
    return buf.getvalue()


def make_zip_bomb_docx() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", "<Types/>")
        zf.writestr("word/document.xml", "<w:document/>")
        zf.writestr("word/media/bomb.bin", b"\x00" * (60 * 1024 * 1024))
    return buf.getvalue()


def make_macro_docx() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("[Content_Types].xml", "<Types/>")
        zf.writestr("word/document.xml", "<w:document/>")
        zf.writestr("word/vbaProject.bin", b"macro")
    return buf.getvalue()
