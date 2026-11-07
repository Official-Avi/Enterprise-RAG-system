"""Unit tests: upload validation, extraction, cleaning, quality and chunking (no database)."""

from __future__ import annotations

import logging
from collections.abc import Callable
from unittest.mock import MagicMock

import pytest

from rackflow.ingestion.chunking import chunk_pages
from rackflow.ingestion.cleaning import clean_pages
from rackflow.ingestion.quality import assess_quality
from rackflow.ingestion.validation import UploadRejected, sanitize_filename, validate_upload
from rackflow.jobs.errors import PermanentJobError
from rackflow.providers.extractors import get_extractor
from rackflow.providers.storage import LocalObjectStorage
from rackflow.providers.tokenizer import get_tokenizer
from rackflow.providers.vectorstore import QdrantVectorStore
from tests.fixtures import make_docx, make_macro_docx, make_text_pdf, make_zip_bomb_docx

MAX = 25 * 1024 * 1024


@pytest.mark.parametrize(("raw", "expected"), [
    ("../../etc/passwd.txt", "passwd.txt"),
    ("C:\\Windows\\system32\\evil.pdf", "evil.pdf"),
    ("re\x00port\x1f.md", "report.md"),
    ("CON.txt", "upload-CON.txt"),
    ("", "upload-file"),
])
def test_sanitize_filename(raw: str, expected: str) -> None:
    assert sanitize_filename(raw) == expected


def test_valid_files_accepted() -> None:
    assert validate_upload("a.pdf", make_text_pdf(["hello"]), max_bytes=MAX).file_type == "pdf"
    assert validate_upload("a.docx", make_docx("T", ["p"]), max_bytes=MAX).file_type == "docx"
    assert validate_upload("a.markdown", b"# Title\n\ntext", max_bytes=MAX).file_type == "md"


@pytest.mark.parametrize(("name", "data", "code"), [
    ("a.exe", b"MZ....", "UNSUPPORTED_TYPE"),
    ("a.pdf", b"", "EMPTY_FILE"),
    ("a.pdf", b"not a pdf at all", "CONTENT_MISMATCH"),
    ("a.txt", b"%PDF-1.4 sneaky", "CONTENT_MISMATCH"),
    ("a.txt", b"bin\x00ary", "CONTENT_MISMATCH"),
    ("a.docx", b"PK\x03\x04garbage", "CORRUPT_FILE"),
    ("a.docx", make_macro_docx(), "MACROS_NOT_ALLOWED"),
    ("a.docx", make_zip_bomb_docx(), "ARCHIVE_BOMB"),
], ids=["exe", "empty", "fake-pdf", "pdf-as-txt", "binary-txt", "corrupt-docx", "macro-docx",
        "zip-bomb"])
def test_invalid_files_rejected(name: str, data: bytes, code: str) -> None:
    with pytest.raises(UploadRejected) as err:
        validate_upload(name, data, max_bytes=MAX)
    assert err.value.code == code


def _crafted_docx(patch: Callable[[bytearray, int], None]) -> bytes:
    """A real DOCX with its first central directory entry changed, which ZipFile() parses."""
    data = bytearray(make_docx("T", ["p"]))
    patch(data, data.index(b"PK\x01\x02"))
    return bytes(data)


def _future_zip_version(data: bytearray, entry: int) -> None:
    data[entry + 6] = 99  # "extract version 9.9": ZipFile raises NotImplementedError


def _bad_utf8_name(data: bytearray, entry: int) -> None:
    data[entry + 9] |= 0x08  # flag bit 11, "the name is UTF-8"
    data[entry + 46] = 0xFF  # the first byte of the name: ZipFile raises UnicodeDecodeError


@pytest.mark.parametrize("patch", [_future_zip_version, _bad_utf8_name])
def test_docx_that_breaks_the_zip_parser_is_a_rejection(
        patch: Callable[[bytearray, int], None]) -> None:
    with pytest.raises(UploadRejected) as err:
        validate_upload("a.docx", _crafted_docx(patch), max_bytes=MAX)
    assert err.value.code == "CORRUPT_FILE"


@pytest.mark.parametrize("encoding", ["utf-16", "utf-16-be-bom"])
def test_utf16_text_with_a_byte_order_mark_is_accepted_and_readable(encoding: str) -> None:
    text = "hello world notes\nRotate the certificates every ninety days.\n"
    data = (b"\xfe\xff" + text.encode("utf-16-be") if encoding == "utf-16-be-bom"
            else text.encode("utf-16"))
    assert validate_upload("a.txt", data, max_bytes=MAX).file_type == "txt"
    assert validate_upload("a.md", data, max_bytes=MAX).file_type == "md"
    extracted = get_extractor("txt").extract(data, max_pages=10).pages[0].text
    assert "Rotate the certificates" in extracted


def test_recreating_a_missing_vector_collection_leaves_a_trace(
        caplog: pytest.LogCaptureFixture) -> None:
    client = MagicMock()
    client.collection_exists.return_value = False
    store = QdrantVectorStore(client, "rackflow_test_units")
    with caplog.at_level(logging.WARNING):
        store.ensure_collection(4)
    assert "vector_collection_created" in caplog.messages
    client.create_collection.assert_called_once()


def test_oversized_rejected() -> None:
    with pytest.raises(UploadRejected) as err:
        validate_upload("a.txt", b"x" * 2048, max_bytes=1024)
    assert err.value.code == "FILE_TOO_LARGE"


def test_storage_rejects_traversal(tmp_path) -> None:  # type: ignore[no-untyped-def]
    storage = LocalObjectStorage(tmp_path)
    storage.put("tenants/t/documents/d/original", b"ok")
    assert storage.get("tenants/t/documents/d/original") == b"ok"
    for bad in ("../outside", "tenants/../../x", "/abs/path", "a\\..\\b"):
        with pytest.raises(ValueError):
            storage.put(bad, b"x")
    storage.delete("tenants/t/documents/d/original")
    storage.delete("tenants/t/documents/d/original")  # idempotent


def test_pdf_extraction_per_page() -> None:
    result = get_extractor("pdf").extract(make_text_pdf(["Page one text", "Page two text"]),
                                          max_pages=10)
    assert result.page_count == 2
    assert "Page one" in result.pages[0].text and "Page two" in result.pages[1].text
    assert result.method == "text"


def test_pdf_page_limit_and_corrupt() -> None:
    with pytest.raises(PermanentJobError) as err:
        get_extractor("pdf").extract(make_text_pdf(["a", "b", "c"]), max_pages=2)
    assert err.value.code == "TOO_MANY_PAGES"
    with pytest.raises(PermanentJobError) as err:
        get_extractor("pdf").extract(b"%PDF-1.4\ngarbage", max_pages=2)
    assert err.value.code in {"CORRUPT_FILE", "EMPTY_DOCUMENT"}


def test_docx_extraction_keeps_headings_and_tables() -> None:
    data = make_docx("Runbook", ["Restart the service."], [["Port", "5432"], ["Host", "db"]])
    text = get_extractor("docx").extract(data, max_pages=10).pages[0].text
    assert "# Runbook" in text
    assert "| Port | 5432 |" in text


def test_cleaning_dehyphenates_and_strips_repeated_headers() -> None:
    pages = [(i, f"ACME CONFIDENTIAL\nBody {i} con-\ntinues here.\nPage {i}") for i in range(1, 5)]
    cleaned = clean_pages(pages)
    assert all("ACME CONFIDENTIAL" not in t for _, t in cleaned)
    assert all("Page " not in t for _, t in cleaned)
    assert "continues here." in cleaned[0][1]


def test_cleaning_preserves_code_fences() -> None:
    text = "Intro    text\n\n```\nif  x:\n    run()\n```"
    (_, out), = clean_pages([(1, text)])
    assert "Intro text" in out
    assert "if  x:\n    run()" in out


def test_quality_flags_empty_and_garbage() -> None:
    assert not assess_quality([(1, ""), (2, "   ")]).usable
    good = assess_quality([(1, "The database connection pool is exhausted under load. " * 5)])
    assert good.usable and good.score > 0.8
    junk = assess_quality([(1, "#$%^&*()_+{}|:<>?~`" * 20)])
    assert junk.score < 0.6


def test_chunking_respects_budget_overlap_and_pages() -> None:
    tok = get_tokenizer()
    para = "Sentence number {n} explains the failover procedure in detail."
    pages = [(p, "\n\n".join(para.format(n=f"{p}-{i}") for i in range(12))) for p in (1, 2, 3)]
    chunks = chunk_pages(pages, tok, chunk_size=80, overlap=20)
    assert len(chunks) > 3
    assert all(c.token_count <= 80 for c in chunks)
    assert [c.index for c in chunks] == list(range(len(chunks)))
    assert chunks[0].page_start == 1 and chunks[-1].page_end == 3
    # Overlap: the start of each chunk repeats the end of the previous one on the same page.
    # Across a page break there is none (test_overlap_does_not_cross_a_page_boundary).
    for prev, cur in zip(chunks, chunks[1:], strict=False):
        if prev.page_end == cur.page_start:
            assert cur.text.split("\n\n")[0] in prev.text


def test_chunking_splits_oversized_paragraph_and_keeps_code_whole() -> None:
    tok = get_tokenizer()
    long_para = " ".join(f"Word{i} is part of a very long paragraph." for i in range(200))
    code = "```\n" + "\n".join(f"step_{i}()" for i in range(10)) + "\n```"
    chunks = chunk_pages([(1, long_para + "\n\n" + code)], tok, chunk_size=100, overlap=10)
    assert all(c.token_count <= 100 for c in chunks)
    assert any(code in c.text for c in chunks)


def test_chunking_rejects_bad_config() -> None:
    with pytest.raises(ValueError):
        chunk_pages([(1, "x")], get_tokenizer(), chunk_size=10, overlap=10)


def test_chunks_never_span_pages() -> None:
    """A citation names one page, so a chunk may only hold one page's text. Short pages used to be
    packed together and cited by the first page in the chunk."""
    tok = get_tokenizer()
    pages = [(1, "Commissioning needs two engineers."), (2, "The valve opens at 14.2 bar."),
             (3, "The filter is swapped every 620 hours."), (5, "Oil is grade ISO VG 46.")]
    chunks = chunk_pages(pages, tok, chunk_size=400, overlap=60)
    assert [(c.page_start, c.page_end) for c in chunks] == [(1, 1), (2, 2), (3, 3), (5, 5)]
    assert [c.text for c in chunks] == [text for _, text in pages]


def test_overlap_does_not_cross_a_page_boundary() -> None:
    tok = get_tokenizer()
    para = "Sentence number {n} explains the failover procedure in detail."
    pages = [(p, "\n\n".join(para.format(n=f"{p}-{i}") for i in range(12))) for p in (1, 2, 3)]
    chunks = chunk_pages(pages, tok, chunk_size=80, overlap=20)
    assert all(c.page_start == c.page_end for c in chunks)
    for chunk in chunks:
        # Every sentence is numbered with its own page, so foreign text is easy to spot.
        for other in {1, 2, 3} - {chunk.page_start}:
            assert f"number {other}-" not in chunk.text
    # Overlap still works inside a page.
    same_page = [(a, b) for a, b in zip(chunks, chunks[1:], strict=False)
                 if a.page_end == b.page_start]
    assert same_page
    for prev, cur in same_page:
        assert cur.text.split("\n\n")[0] in prev.text
