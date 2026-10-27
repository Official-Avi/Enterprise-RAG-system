"""Text extraction for supported formats. Parsers never execute embedded content."""

from __future__ import annotations

import io
import logging

from charset_normalizer import from_bytes

from rackflow.jobs.errors import PermanentJobError
from rackflow.providers.interfaces import ExtractedPage, ExtractionResult

log = logging.getLogger(__name__)


class PdfExtractor:
    def extract(self, data: bytes, *, max_pages: int) -> ExtractionResult:
        from pypdf import PdfReader
        from pypdf.errors import PdfReadError

        try:
            reader = PdfReader(io.BytesIO(data))
            if reader.is_encrypted:
                raise PermanentJobError("ENCRYPTED_PDF",
                                        "Password-protected PDFs are not supported.")
            total = len(reader.pages)
        except PermanentJobError:
            raise
        except (PdfReadError, ValueError, KeyError, TypeError, OSError) as exc:
            raise PermanentJobError("CORRUPT_FILE", "The PDF file could not be read.") from exc
        if total == 0:
            raise PermanentJobError("EMPTY_DOCUMENT", "The PDF has no pages.")
        if total > max_pages:
            raise PermanentJobError("TOO_MANY_PAGES", f"PDFs are limited to {max_pages} pages.")

        pages: list[ExtractedPage] = []
        warnings: list[str] = []
        failed = 0
        for i, page in enumerate(reader.pages, start=1):
            try:
                text = page.extract_text() or ""
            except Exception:  # noqa: BLE001 — one bad page must not fail the document
                failed += 1
                text = ""
            pages.append(ExtractedPage(page_number=i, text=text,
                                       method="text" if text.strip() else "none"))
        if failed:
            warnings.append(f"{failed} page(s) could not be parsed as text")
        return ExtractionResult(pages=pages, page_count=total, warnings=warnings)


class DocxExtractor:
    def extract(self, data: bytes, *, max_pages: int) -> ExtractionResult:
        import docx
        from docx.table import Table
        from docx.text.paragraph import Paragraph

        try:
            document = docx.Document(io.BytesIO(data))
        except Exception as exc:  # noqa: BLE001 — python-docx raises many types on bad input
            raise PermanentJobError("CORRUPT_FILE", "The DOCX file could not be read.") from exc

        parts: list[str] = []
        for block in document.element.body.iterchildren():
            tag = block.tag.rsplit("}", 1)[-1]
            if tag == "p":
                para = Paragraph(block, document)
                text = para.text.strip()
                if text:
                    style = (para.style.name or "").lower() if para.style is not None else ""
                    if style.startswith("heading"):
                        level = "".join(ch for ch in style if ch.isdigit()) or "1"
                        text = "#" * min(int(level), 6) + " " + text
                    parts.append(text)
            elif tag == "tbl":
                table = Table(block, document)
                for row in table.rows:
                    cells = [c.text.strip().replace("\n", " ") for c in row.cells]
                    parts.append("| " + " | ".join(cells) + " |")
        text = "\n\n".join(parts)
        return ExtractionResult(
            pages=[ExtractedPage(page_number=1, text=text, method="text" if text else "none")],
            page_count=1,
        )


class PlainTextExtractor:
    def extract(self, data: bytes, *, max_pages: int) -> ExtractionResult:
        best = from_bytes(data).best()
        if best is None:
            raise PermanentJobError("UNREADABLE_TEXT", "The text encoding could not be detected.")
        text = str(best)
        warnings = [] if best.encoding in ("utf_8", "ascii") else [
            f"Decoded using detected encoding {best.encoding}"
        ]
        return ExtractionResult(
            pages=[ExtractedPage(page_number=1, text=text,
                                 method="text" if text.strip() else "none")],
            page_count=1,
            warnings=warnings,
        )


_EXTRACTORS: dict[str, PdfExtractor | DocxExtractor | PlainTextExtractor] = {
    "pdf": PdfExtractor(), "docx": DocxExtractor(), "txt": PlainTextExtractor(),
    "md": PlainTextExtractor(),
}


def get_extractor(file_type: str) -> PdfExtractor | DocxExtractor | PlainTextExtractor:
    try:
        return _EXTRACTORS[file_type]
    except KeyError as exc:
        raise PermanentJobError("UNSUPPORTED_TYPE", "Unsupported file type.") from exc
