"""Citation marker formats that real OpenAI-compatible models produce."""

from types import SimpleNamespace

import pytest

from rackflow.rag.answer import verify_citations

SOURCES = [SimpleNamespace(text="Nightly backups are retained for 45 days in the vault.")]


@pytest.mark.parametrize("reply", [
    "Backups are retained for **45 days** [1].",
    "Backups are retained for **45 days**【1】.",
    "Backups are retained for **45 days**【1†L1-L2】.",
])
def test_supported_marker_styles_become_verified_citations(reply: str) -> None:
    cleaned, citations = verify_citations(reply, SOURCES)
    assert [c.marker for c in citations] == [1]
    assert "[1]" in cleaned
    assert "【" not in cleaned


def test_fullwidth_marker_outside_the_sources_is_still_rejected() -> None:
    cleaned, citations = verify_citations("Backups last 45 days【9】.", SOURCES)
    assert citations == []
    assert "【" not in cleaned
    assert "[9]" not in cleaned
