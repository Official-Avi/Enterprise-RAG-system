"""Chat model providers behind one interface (FR-050..FR-053).

- ExtractiveProvider  — NO LLM. Quotes the most relevant retrieved sentences with citations.
                        Development/CI fallback; always labelled as such in API responses.
- AnthropicProvider   — hosted Claude via the official SDK (default model claude-opus-5-5).
- OpenAICompatibleProvider — any OpenAI-compatible endpoint, e.g. a local Ollama/vLLM server
                        running Qwen2.5 for the ADR-004 experiment.

All providers enforce a timeout and a process-wide concurrency limit and raise `ModelError`
with safe codes; provider error bodies are never surfaced.
"""

from __future__ import annotations

import re
import threading
import time
from collections.abc import Sequence
from functools import lru_cache
from typing import Any, Literal, cast
from urllib.parse import urlparse

import httpx

from rackflow.core.config import get_settings
from rackflow.core.errors import AppError
from rackflow.providers.interfaces import ChatCompletion, ChatTurn, ProviderHealth

DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5"
_CONCURRENCY_WAIT_SECONDS = 10.0


class ModelError(AppError):
    status_code = 503
    code = "MODEL_UNAVAILABLE"
    message = "The language model is temporarily unavailable."


def _model_error(code: str) -> ModelError:
    messages = {
        "MODEL_TIMEOUT": ("The language model did not respond in time.", 504),
        "MODEL_OVERLOADED": ("The language model is busy. Please retry shortly.", 503),
        "MODEL_UNAVAILABLE": ("The language model is temporarily unavailable.", 503),
        "MODEL_REFUSED": ("The language model declined to answer this request.", 422),
        "MODEL_MISCONFIGURED": ("The language model is not configured correctly.", 503),
    }
    message, status = messages[code]
    return ModelError(message, code=code, status_code=status)


class _Limiter:
    def __init__(self, limit: int) -> None:
        self._sem = threading.BoundedSemaphore(limit)

    def __enter__(self) -> None:
        if not self._sem.acquire(timeout=_CONCURRENCY_WAIT_SECONDS):
            raise _model_error("MODEL_OVERLOADED")

    def __exit__(self, *exc: object) -> None:
        self._sem.release()


# ------------------------------------------------------------------ extractive

_SOURCE_RE = re.compile(r'<source id="(\d+)"[^>]*>\n(.*?)\n</source>', re.DOTALL)
_QUESTION_RE = re.compile(r"\nQuestion:\s*(.+)\s*$", re.DOTALL)
_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+|\n+")
_HARD_WRAP_RE = re.compile(r"(?<![.!?:])\n(?!\n|\d+\.|[-*•] )")
_WORD_RE = re.compile(r"[a-z0-9_]+")
_STOP = frozenset([
    "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "does", "for", "from", "has",
    "have", "how", "i", "if", "in", "is", "it", "of", "on", "or", "should", "the", "this", "to",
    "was", "what", "when", "where", "which", "who", "why", "will", "with", "you", "your",
])


def _terms(text: str) -> set[str]:
    return {w for w in _WORD_RE.findall(text.lower()) if w not in _STOP and len(w) > 1}


class ExtractiveProvider:
    """Deterministic, offline answer synthesis by quoting evidence. Not a language model."""

    provider = "extractive"
    model = "extractive-no-llm"
    deployment_mode: Literal["local", "remote", "builtin"] = "builtin"

    def complete(self, *, system: str, turns: Sequence[ChatTurn], max_tokens: int,
                 temperature: float) -> ChatCompletion:
        started = time.perf_counter()
        prompt = turns[-1].content if turns else ""
        match = _QUESTION_RE.search(prompt)
        question_terms = _terms(match.group(1)) if match else set()
        scored: list[tuple[float, int, int]] = []
        sentences: dict[int, list[str]] = {}
        for sid_text, body in _SOURCE_RE.findall(prompt):
            sid = int(sid_text)
            # Re-join hard-wrapped lines (PDF extraction) so sentences are not cut mid-way.
            body = _HARD_WRAP_RE.sub(" ", body)
            sentences[sid] = [s.strip() for s in _SENTENCE_RE.split(body) if s.strip()]
            for idx, sentence in enumerate(sentences[sid]):
                overlap = len(question_terms & _terms(sentence))
                if overlap and 20 <= len(sentence) <= 600:
                    scored.append((overlap + 1 / (1 + sid), sid, idx))
        scored.sort(key=lambda s: -s[0])
        picked: list[tuple[int, int]] = []
        for _, sid, idx in scored[:2]:
            # A matching sentence often states the problem; the next one states the action.
            for i in (idx, idx + 1):
                if i < len(sentences[sid]) and (sid, i) not in picked:
                    picked.append((sid, i))
        if not picked:
            text = "INSUFFICIENT_EVIDENCE: none of the retrieved passages address the question."
        else:
            text = " ".join(f"{sentences[sid][i]} [{sid}]" for sid, i in picked[:4])
        return ChatCompletion(text=text, provider=self.provider, model=self.model,
                              latency_ms=int((time.perf_counter() - started) * 1000))

    def health(self) -> ProviderHealth:
        return ProviderHealth(ok=True, provider=self.provider, model=self.model,
                              deployment_mode="builtin",
                              detail="Built-in extractive mode: answers quote sources; no LLM.")


# ------------------------------------------------------------------- anthropic


class AnthropicProvider:
    provider = "anthropic"
    deployment_mode: Literal["local", "remote", "builtin"] = "remote"

    def __init__(self, model: str, api_key: str, timeout: float, max_concurrency: int) -> None:
        import anthropic

        self.model = model
        self._anthropic = anthropic
        self._client = anthropic.Anthropic(api_key=api_key, timeout=timeout, max_retries=1)
        self._limiter = _Limiter(max_concurrency)

    def complete(self, *, system: str, turns: Sequence[ChatTurn], max_tokens: int,
                 temperature: float) -> ChatCompletion:
        # `temperature` is accepted for interface compatibility but not sent: the Messages API
        # rejects sampling parameters (temperature/top_p/top_k) since 2026-10-21.
        a = self._anthropic
        started = time.perf_counter()
        with self._limiter:
            try:
                response = self._client.beta.messages.create(
                    model=self.model,
                    max_tokens=max_tokens,
                    system=system,
                    messages=cast(Any, [{"role": t.role, "content": t.content} for t in turns]),
                    betas=["server-side-fallback-2026-07-01"],
                    fallbacks="default",
                )
            except a.APITimeoutError as exc:
                raise _model_error("MODEL_TIMEOUT") from exc
            except (a.RateLimitError, a.OverloadedError, a.ServiceUnavailableError) as exc:
                raise _model_error("MODEL_OVERLOADED") from exc
            except (a.AuthenticationError, a.PermissionDeniedError, a.NotFoundError,
                    a.BadRequestError) as exc:
                raise _model_error("MODEL_MISCONFIGURED") from exc
            except (a.APIStatusError, a.APIConnectionError) as exc:
                raise _model_error("MODEL_UNAVAILABLE") from exc
        if response.stop_reason == "refusal":
            raise _model_error("MODEL_REFUSED")
        text = "".join(getattr(b, "text", "") for b in response.content if b.type == "text")
        return ChatCompletion(
            text=text, provider=self.provider, model=response.model,
            latency_ms=int((time.perf_counter() - started) * 1000),
            prompt_tokens=response.usage.input_tokens,
            completion_tokens=response.usage.output_tokens,
        )

    def health(self) -> ProviderHealth:
        started = time.perf_counter()
        try:
            self._client.models.retrieve(self.model)  # no token spend
            ok, detail = True, "Model endpoint reachable."
        except Exception:  # noqa: BLE001 — health reports, never raises
            ok, detail = False, "Model endpoint unreachable or credentials rejected."
        return ProviderHealth(ok=ok, provider=self.provider, model=self.model,
                              deployment_mode="remote", detail=detail,
                              latency_ms=int((time.perf_counter() - started) * 1000))


# ---------------------------------------------------------- openai-compatible


class OpenAICompatibleProvider:
    provider = "openai_compatible"

    def __init__(self, model: str, base_url: str, api_key: str | None, timeout: float,
                 max_concurrency: int) -> None:
        self.model = model
        self.base_url = base_url.rstrip("/")
        host = (urlparse(self.base_url).hostname or "").lower()
        self.deployment_mode: Literal["local", "remote", "builtin"] = (
            "local" if host in {"127.0.0.1", "localhost", "::1"} else "remote")
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        self._http = httpx.Client(timeout=timeout, headers=headers)
        self._limiter = _Limiter(max_concurrency)

    def complete(self, *, system: str, turns: Sequence[ChatTurn], max_tokens: int,
                 temperature: float) -> ChatCompletion:
        started = time.perf_counter()
        body = {
            "model": self.model,
            "messages": [{"role": "system", "content": system},
                         *({"role": t.role, "content": t.content} for t in turns)],
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": False,
        }
        with self._limiter:
            try:
                resp = self._http.post(f"{self.base_url}/chat/completions", json=body)
            except httpx.TimeoutException as exc:
                raise _model_error("MODEL_TIMEOUT") from exc
            except httpx.HTTPError as exc:
                raise _model_error("MODEL_UNAVAILABLE") from exc
        if resp.status_code in (429, 503):
            raise _model_error("MODEL_OVERLOADED")
        if resp.status_code in (400, 401, 403, 404):
            raise _model_error("MODEL_MISCONFIGURED")
        if resp.status_code >= 400:
            raise _model_error("MODEL_UNAVAILABLE")
        try:
            data = resp.json()
            text = data["choices"][0]["message"]["content"] or ""
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise _model_error("MODEL_UNAVAILABLE") from exc
        usage = data.get("usage") or {}
        return ChatCompletion(
            text=text, provider=self.provider, model=str(data.get("model") or self.model),
            latency_ms=int((time.perf_counter() - started) * 1000),
            prompt_tokens=usage.get("prompt_tokens"),
            completion_tokens=usage.get("completion_tokens"),
        )

    def health(self) -> ProviderHealth:
        started = time.perf_counter()
        try:
            ok = self._http.get(f"{self.base_url}/models").status_code < 400
        except httpx.HTTPError:
            ok = False
        return ProviderHealth(ok=ok, provider=self.provider, model=self.model,
                              deployment_mode=self.deployment_mode,
                              detail="Endpoint reachable." if ok else "Endpoint unreachable.",
                              latency_ms=int((time.perf_counter() - started) * 1000))


ChatProvider = ExtractiveProvider | AnthropicProvider | OpenAICompatibleProvider


@lru_cache(maxsize=1)
def get_chat_provider() -> ChatProvider:
    s = get_settings()
    key = s.model_api_key.get_secret_value() if s.model_api_key else None
    if s.model_provider == "anthropic":
        return AnthropicProvider(s.model_name or DEFAULT_ANTHROPIC_MODEL, key or "",
                                 s.model_timeout_seconds, s.model_max_concurrency)
    if s.model_provider == "openai_compatible":
        return OpenAICompatibleProvider(s.model_name or "qwen2.5:1.5b", s.model_base_url, key,
                                        s.model_timeout_seconds, s.model_max_concurrency)
    return ExtractiveProvider()
