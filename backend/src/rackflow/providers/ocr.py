"""OCR for image-only PDF pages: pypdfium2 renders, RapidOCR (ONNX) recognises (ADR-015)."""

from __future__ import annotations

import io
import logging
import threading
from functools import lru_cache

log = logging.getLogger(__name__)

RENDER_SCALE = 200 / 72  # ~200 DPI


class RapidOcrProvider:
    name = "rapidocr-onnxruntime"

    def __init__(self) -> None:
        from rapidocr_onnxruntime import RapidOCR

        self._engine = RapidOCR()
        self._lock = threading.Lock()  # engine instances are not documented as thread-safe

    def ocr_image(self, image_png: bytes) -> tuple[str, float]:
        import numpy as np
        from PIL import Image

        image = np.array(Image.open(io.BytesIO(image_png)).convert("RGB"))
        with self._lock:
            result, _ = self._engine(image)
        if not result:
            return "", 0.0
        # result rows: [box, text, score]; sort top-to-bottom, then left-to-right.
        rows = sorted(result, key=lambda r: (round(r[0][0][1] / 12), r[0][0][0]))
        lines: list[str] = []
        last_y: float | None = None
        for box, text, _score in rows:
            y = box[0][1]
            if last_y is not None and abs(y - last_y) < 12 and lines:
                lines[-1] += " " + text
            else:
                lines.append(text)
            last_y = y
        confidence = sum(float(r[2]) for r in result) / len(result)
        return "\n".join(lines), confidence


def render_pdf_page_png(data: bytes, page_number: int) -> bytes:
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(data)
    try:
        page = pdf[page_number - 1]
        bitmap = page.render(scale=RENDER_SCALE)
        image = bitmap.to_pil()
        buf = io.BytesIO()
        image.save(buf, format="PNG")
        return buf.getvalue()
    finally:
        pdf.close()


@lru_cache(maxsize=1)
def get_ocr_provider() -> RapidOcrProvider | None:
    try:
        return RapidOcrProvider()
    except Exception:  # noqa: BLE001 — OCR is optional; callers record a warning
        log.warning("ocr_provider_unavailable")
        return None
