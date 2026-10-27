"""Token counting.

`RegexTokenizer` approximates sub-word tokenizers (words + punctuation). It is deterministic
and dependency-free, used for chunk budgeting and context limits. Counts are an estimate of
the embedding/LLM tokenizer, with a safety margin applied by callers (documented limitation).
"""

from __future__ import annotations

import re
from functools import lru_cache

_TOKEN_RE = re.compile(r"\w+|[^\w\s]", re.UNICODE)


class RegexTokenizer:
    name = "regex-approx-v1"

    def count(self, text: str) -> int:
        # Long words are split by sub-word tokenizers; approximate one token per ~6 chars.
        total = 0
        for tok in _TOKEN_RE.findall(text):
            total += max(1, (len(tok) + 5) // 6)
        return total


@lru_cache(maxsize=1)
def get_tokenizer() -> RegexTokenizer:
    return RegexTokenizer()
