"""Upload validation: extension allowlist, content sniffing, size limits, archive-bomb and macro
checks, and safe display filenames. Uploaded files are untrusted input (SECURITY.md §3)."""

from __future__ import annotations

import io
import re
import unicodedata
import zipfile
from dataclasses import dataclass

from charset_normalizer import from_bytes

ALLOWED_EXTENSIONS = {"pdf": "pdf", "docx": "docx", "txt": "txt", "md": "md", "markdown": "md"}
MIME_TYPES = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "txt": "text/plain",
    "md": "text/markdown",
}

DOCX_MAX_UNCOMPRESSED = 200 * 1024 * 1024
DOCX_MAX_RATIO = 100
DOCX_MAX_ENTRIES = 2000
_WINDOWS_RESERVED = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)),
                     *(f"lpt{i}" for i in range(1, 10))}


class UploadRejected(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True, slots=True)
class ValidatedFile:
    filename: str
    file_type: str
    mime_type: str
    size_bytes: int


def sanitize_filename(name: str | None) -> str:
    """Display name only — never used to build a filesystem path."""
    raw = (name or "").replace("\\", "/").split("/")[-1]
    raw = unicodedata.normalize("NFC", raw)
    cleaned = "".join(ch for ch in raw if unicodedata.category(ch)[0] != "C")
    cleaned = re.sub(r"\s+", " ", cleaned).strip().strip(".")
    stem = cleaned.split(".")[0].lower()
    if not cleaned or stem in _WINDOWS_RESERVED:
        cleaned = f"upload-{cleaned or 'file'}"
    if len(cleaned) > 200:
        base, dot, ext = cleaned.rpartition(".")
        cleaned = (base[: 190 - len(ext)] + dot + ext) if dot and len(ext) <= 10 else cleaned[:200]
    return cleaned


def _extension(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def _check_docx(data: bytes) -> None:
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise UploadRejected("CORRUPT_FILE", "The DOCX file is corrupt.") from exc
    with zf:
        infos = zf.infolist()
        if len(infos) > DOCX_MAX_ENTRIES:
            raise UploadRejected("ARCHIVE_TOO_COMPLEX", "The DOCX file has too many parts.")
        names = {i.filename for i in infos}
        if "[Content_Types].xml" not in names or "word/document.xml" not in names:
            raise UploadRejected("CONTENT_MISMATCH", "The file is not a valid DOCX document.")
        if any(n.lower().endswith("vbaproject.bin") for n in names):
            raise UploadRejected("MACROS_NOT_ALLOWED", "Macro-enabled documents are not allowed.")
        total = sum(i.file_size for i in infos)
        compressed = max(1, sum(i.compress_size for i in infos))
        if total > DOCX_MAX_UNCOMPRESSED or total / compressed > DOCX_MAX_RATIO:
            raise UploadRejected("ARCHIVE_BOMB", "The DOCX file expands to an unsafe size.")


def _check_text(data: bytes) -> None:
    if b"\x00" in data[:65536]:
        raise UploadRejected("CONTENT_MISMATCH", "The file is not a text document.")
    best = from_bytes(data[:262144]).best()
    if best is None:
        raise UploadRejected("CONTENT_MISMATCH", "The file is not a text document.")


def validate_upload(filename: str | None, data: bytes, *, max_bytes: int) -> ValidatedFile:
    safe_name = sanitize_filename(filename)
    ext = _extension(safe_name)
    file_type = ALLOWED_EXTENSIONS.get(ext)
    if file_type is None:
        raise UploadRejected(
            "UNSUPPORTED_TYPE", "Only PDF, DOCX, TXT and Markdown files are supported."
        )
    if len(data) == 0:
        raise UploadRejected("EMPTY_FILE", "The file is empty.")
    if len(data) > max_bytes:
        raise UploadRejected("FILE_TOO_LARGE", f"Files must be at most {max_bytes // 1048576} MiB.")

    if file_type == "pdf":
        if not data.lstrip()[:5] == b"%PDF-":
            raise UploadRejected("CONTENT_MISMATCH", "The file content is not a PDF.")
    elif file_type == "docx":
        if data[:4] != b"PK\x03\x04":
            raise UploadRejected("CONTENT_MISMATCH", "The file content is not a DOCX document.")
        _check_docx(data)
    else:
        if data[:5] == b"%PDF-" or data[:4] == b"PK\x03\x04":
            raise UploadRejected("CONTENT_MISMATCH", "The file content does not match its type.")
        _check_text(data)

    return ValidatedFile(filename=safe_name, file_type=file_type, mime_type=MIME_TYPES[file_type],
                         size_bytes=len(data))
