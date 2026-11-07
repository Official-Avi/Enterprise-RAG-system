"""Deciding what in a retrieved passage is evidence for a question. Pure functions; no I/O.

Used by the extractive provider, which has no model to judge relevance, and by citation quotes.

A passage is first turned into clean sentences: hard-wrapped lines are re-joined, headings are kept
as structure instead of being glued to the next line, and text that cannot be evidence (flagged
instructions, questions planted in a document) is removed. A sentence then supports a question
only if it covers most of what is being asked. Sharing one word with the question is not enough,
which is what lets an on-topic question with no answer in the documents abstain.
"""

from __future__ import annotations

import math
import re
from collections.abc import Sequence
from dataclasses import dataclass

from rackflow.rag.injection import looks_like_injection

MIN_COVERAGE = 0.7  # share of the asked terms a sentence, with its headings, has to cover
TITLE_WEIGHT = 0.5  # a document title sets the topic; it says little about this one sentence
NEAR_BEST = 0.1
MAX_PICKS_PER_CLAUSE = 2
MAX_FOLLOWING_STEPS = 2
MAX_SENTENCES = 5
MAX_SENTENCE_CHARS = 600
MIN_SENTENCE_CHARS = 12
MIN_SENTENCE_WORDS = 3
MAX_HEADING_WORDS = 10
MAX_HEADING_CHARS = 80
MAX_CONTEXT_CHARS = 300
MAX_HISTORY_LOOKBACK = 4

_WORD_RE = re.compile(r"[a-z0-9_]+")
_RAW_WORD_RE = re.compile(r"[A-Za-z0-9_]+")
_STOP = frozenset([
    "a", "about", "after", "again", "all", "also", "am", "an", "and", "any", "are", "as", "at",
    "be", "because", "been", "being", "but", "by", "can", "could", "did", "do", "document",
    "documents", "does", "done", "during", "each", "else", "explain", "file", "files", "for",
    "from", "get", "give", "had", "has", "have", "he", "her", "his", "how", "i", "if", "in",
    "into", "is", "it", "its", "just", "long", "many", "may", "me", "might", "more", "most",
    "much", "must", "my", "no", "not", "of", "off", "often", "on", "once", "or", "our", "out",
    "over", "per", "please", "say", "says", "she", "should", "show", "so", "some", "tell",
    "than", "that", "the", "their", "them", "then", "there", "these", "they", "this", "those",
    "to", "under", "up", "us", "via", "was", "we", "were", "what", "when", "where", "which",
    "who", "whom", "whose", "why", "will", "with", "would", "you", "your",
])
_ABBREVIATIONS = frozenset([
    "e.g", "i.e", "eg", "ie", "etc", "vs", "no", "nos", "fig", "figs", "dr", "mr", "mrs", "ms",
    "prof", "approx", "inc", "ltd", "st", "sec", "ref",
])
_MARKDOWN_HEADING_RE = re.compile(r"^#{1,6}\s+(.*)$")
_LIST_ITEM_RE = re.compile(r"^(?:\d{1,3}[.)]\s|[-*•]\s)")
_BULLET_RE = re.compile(r"^[-*•]\s+")
_SENTENCE_END_RE = re.compile(r"[.!?]+[\"')\]]*\s+")
_LAST_TOKEN_RE = re.compile(r"(\S+?)[.!?]*[\"')\]]*$")
_QUESTION_LINE_RE = re.compile(r"^(?:q|question|query)\s*[:.]", re.IGNORECASE)
_TERMINAL = (".", "!", "?")
_CLAUSE_RE = re.compile(
    r"[?;]\s+|\s+and\s+(?=(?:with\s+)?(?:how|what|when|where|which|who|why)\b)", re.IGNORECASE)
_SUPERSEDED_RE = re.compile(r"\bsuperseded\b", re.IGNORECASE)
_FILE_EXTENSION_RE = re.compile(r"\.[A-Za-z0-9]{1,5}$")

_ASKS_FREQUENCY_OR_AMOUNT_RE = re.compile(r"\bhow\s+(?:often|long|many|much)\b", re.IGNORECASE)
_AMOUNT_RE = re.compile(
    r"\d|\b(?:hourly|daily|nightly|weekly|fortnightly|monthly|quarterly|annually|yearly|every|"
    r"once|twice|one|two|three|four|five|six|seven|eight|nine|ten|twelve|hundred|thousand)\b",
    re.IGNORECASE)
_ASKS_PERSON_RE = re.compile(r"\bwho(?:m|se)?\b", re.IGNORECASE)
_PERSON_RE = re.compile(
    r"\b(?:team|group|owner|manager|lead|engineers?|admin|administrator|department|officer|"
    r"director|supervisor|committee|board|on-call|operator|technician)\b", re.IGNORECASE)
_NAME_AFTER_START_RE = re.compile(r"\s[A-Z][a-z]+")
_ASKS_PROCEDURE_RE = re.compile(
    r"\bhow\s+(?:do|does|to|should|can|would)\b|\bsteps?\b|\bprocedure\b", re.IGNORECASE)
# "What are the main rules in the backup policy?" asks about a document, not a fact in it.
_ASKS_OVERVIEW_RE = re.compile(
    r"\b(?:main|key|most important|summar(?:y|ise|ize)|overview|outline|listed|"
    r"responsible for what|amounts and due dates)\b", re.IGNORECASE)
MAX_OVERVIEW_SENTENCES = 3

_CONTINUATION_RE = re.compile(
    r"^\s*(?:and|also|then|so|but|or|what about|how about)\b", re.IGNORECASE)
_ANAPHOR_RE = re.compile(
    r"\b(?:it|its|it's|they|them|their|he|she|his|her)\b|\b(?:this|that|these|those)(?:\s+one)?\s*\??$",
    re.IGNORECASE)
_EXPLETIVE_RE = re.compile(
    r"\b(?:is\s+it|it(?:'s|\s+is|\s+was))\s+"
    r"(?:possible|ok|okay|safe|required|necessary|true|recommended|allowed|mandatory)\b"
    r"|\bdoes\s+it\s+(?:take|cost)\s+to\b",
    re.IGNORECASE)
# "What does it say about TLS?": "it" is the document in front of the reader.
_ABOUT_DOCUMENT_RE = re.compile(r"\b(?:do|does|did)\s+(?:it|they)\s+(?:say|state|mention)\b",
                                re.IGNORECASE)
# A pronoun in a later clause can refer to what the first clause is about.
_LATER_CLAUSE_RE = re.compile(
    r"\b(?:when|whenever|while|if|once|after|before|until|because|since|unless|and)\b",
    re.IGNORECASE)
# "How should engineers store their laptops?": the sentence's own subject owns what follows.
_OWN_SUBJECT_RE = re.compile(
    r"^\s*(?:(?:how(?:\s+(?:often|long|much|many))?|when|where|why|what|which)\s+)?"
    r"(?:do|does|did|should|must|can|could|will|would|may|might|has|have)\s+"
    r"(?:(?:the|all|our)\s+)?"
    r"(?!(?:i|we|you|they|he|she|it|its|their|his|her|this|that|these|those)\b)[a-z0-9_-]+",
    re.IGNORECASE)
_ENDS_WITH_PREPOSITION_RE = re.compile(r"\b(?:about|for|from|in|of|on|to|with)\s*$", re.IGNORECASE)
_POSSESSIVES = frozenset(["its", "their", "his", "her"])
_DEMONSTRATIVES = ("this", "that", "these", "those")


def _stem(word: str) -> str:
    """A light suffix stripper, so that rotated/rotate/rotation and approves/approver meet."""
    for suffix, replacement in (("ies", "y"), ("ied", "y")):
        if word.endswith(suffix) and len(word) - len(suffix) >= 2:
            return word[: -len(suffix)] + replacement
    stem = word
    for suffix in ("ions", "ion", "ings", "ing", "ers", "er", "als", "al", "es", "ed", "s", "e"):
        if not stem.endswith(suffix) or len(stem) - len(suffix) < 3:
            continue
        if suffix == "s" and stem.endswith("ss"):
            continue
        stem = stem[: -len(suffix)]
        break
    if len(stem) > 3 and stem[-1] == stem[-2] and stem[-1] not in "lsz":
        stem = stem[:-1]
    return stem


def terms(text: str) -> set[str]:
    """Content terms of a text, stemmed and without function words."""
    return {_stem(w) for w in _WORD_RE.findall(text.lower()) if w not in _STOP and len(w) > 1}


_FIGURE_TERMS = frozenset(terms("dates date deadlines deadline numbers number amounts amount due"))
_PEOPLE_TERMS = frozenset(terms("responsible"))
_NO_SUBJECT_TERMS = frozenset(terms("happen happens occur occurs go goes"))
_OVERVIEW_TERMS = _FIGURE_TERMS | _PEOPLE_TERMS | frozenset(terms(
    "main key important summary summarise summarize overview outline listed list rules rule steps "
    "step findings finding"))


def named_terms(text: str) -> set[str]:
    """Terms the writer marked as names: capitalised inside the text, acronyms, or with digits.

    A question about the Hyperion turbine is not answered by a passage about another turbine, so
    these must appear in the passage. Text in Title Case or capitals marks nothing as a name.
    """
    words = _RAW_WORD_RE.findall(text)
    marked = [w for w in words if not w.islower()]
    if words and len(marked) / len(words) > 0.6:
        return {_stem(w.lower()) for w in words if any(c.isdigit() for c in w)}
    found: set[str] = set()
    for position, word in enumerate(words):
        lowered = word.lower()
        if lowered in _STOP:
            continue
        starts_clause = position == 0 or text[: text.find(word)].rstrip().endswith(":")
        has_digit = any(c.isdigit() for c in word)
        is_acronym = len(word) > 1 and word.isupper()
        is_capitalised = word[0].isupper() and not starts_clause
        if has_digit or is_acronym or is_capitalised:
            found.add(_stem(lowered))
    return found


# ----------------------------------------------------------------- passage structure


@dataclass(frozen=True, slots=True)
class Sentence:
    text: str
    heading: str
    section: int


@dataclass(frozen=True, slots=True)
class Passage:
    title: str
    sentences: tuple[Sentence, ...]
    headings: tuple[str, ...]


def split_sentences(block: str) -> list[str]:
    """Split one run of prose. List markers, abbreviations and initials do not end a sentence."""
    out: list[str] = []
    start = 0
    for match in _SENTENCE_END_RE.finditer(block):
        end = match.end()
        following = block[end:end + 1]
        token_match = _LAST_TOKEN_RE.search(block[start:match.end()].rstrip())
        token = token_match.group(1) if token_match else ""
        is_list_marker = token.isdigit() and block[start:match.start()].strip() == token
        is_abbreviation = token.lower().lstrip("(") in _ABBREVIATIONS
        is_initial = len(token) == 1 and token.isupper()
        if is_list_marker or is_abbreviation or is_initial or following.islower():
            continue
        out.append(block[start:end].strip())
        start = end
    tail = block[start:].strip()
    if tail:
        out.append(tail)
    return out


def _is_plain_heading(line: str, previous_open: bool, following: str | None) -> bool:
    """A short line that stands alone, like the section titles PDFs lose their markup for."""
    if previous_open or _LIST_ITEM_RE.match(line) or any(c.isdigit() for c in line):
        return False
    words = line.split()
    if len(words) > MAX_HEADING_WORDS or len(line) > MAX_HEADING_CHARS:
        return False
    if not line[0].isupper() or line.endswith((*_TERMINAL, ",", ";")):
        return False
    if line.endswith(":") and len(words) > 5:
        return False
    if words[-1].lower().strip(":") in _STOP:
        return False  # "...is made by" continues on the next line
    next_line = (following or "").strip()
    return not next_line or next_line[0].isupper() or next_line[0].isdigit() \
        or bool(_LIST_ITEM_RE.match(next_line))


def _is_evidence(sentence: str) -> bool:
    """A question, flagged instruction or planted "Question:" line never supports an answer."""
    return not (sentence.endswith("?") or _QUESTION_LINE_RE.match(sentence)
                or looks_like_injection(sentence))


def parse_passage(text: str) -> Passage:
    """Clean sentences of a chunk, each with the heading it sits under."""
    lines = text.split("\n")
    title = ""
    heading = ""
    section = 0
    headings: list[str] = []
    sentences: list[Sentence] = []
    buffer: list[str] = []
    in_fence = False

    def flush() -> None:
        if not buffer:
            return
        block = _BULLET_RE.sub("", " ".join(" ".join(buffer).split()))
        buffer.clear()
        sentences.extend(Sentence(s, heading, section) for s in split_sentences(block)
                         if _is_evidence(s))

    def open_section(name: str) -> None:
        nonlocal title, heading, section
        flush()
        if looks_like_injection(name):
            return
        heading, section = name, section + 1
        headings.append(name)
        title = title or name

    for i, raw in enumerate(lines):
        line = raw.strip()
        if line.startswith("```"):
            flush()
            in_fence = not in_fence
            continue
        if not line:
            flush()
            continue
        if in_fence:
            flush()
            buffer.append(line)
            continue
        markdown = _MARKDOWN_HEADING_RE.match(line)
        if markdown:
            open_section(markdown.group(1).strip().rstrip("#").strip())
            continue
        if _LIST_ITEM_RE.match(line):
            flush()
            buffer.append(line)
            continue
        previous_open = bool(buffer) and not buffer[-1].endswith((*_TERMINAL, ":"))
        following = lines[i + 1] if i + 1 < len(lines) else None
        if _is_plain_heading(line, previous_open, following):
            open_section(line.rstrip(":"))
            continue
        if buffer and not previous_open:
            flush()
        buffer.append(line)
    flush()
    return Passage(title, tuple(sentences), tuple(headings))


def is_quotable(sentence: str) -> bool:
    return (MIN_SENTENCE_CHARS <= len(sentence) <= MAX_SENTENCE_CHARS
            and len(sentence.split()) >= MIN_SENTENCE_WORDS)


# ---------------------------------------------------------------------- follow-ups


def _pronoun_has_antecedent(pronoun: re.Match[str], question: str, named: set[str]) -> bool:
    """Does the question itself say what this pronoun refers to?"""
    word = pronoun.group(0).lower()
    if word.startswith(_DEMONSTRATIVES):
        return False
    possessive = word in _POSSESSIVES
    before = question[:pronoun.start()]
    # "What is the SLA for it?" names what is asked, not the "it" it is asked about.
    if named & terms(before) and (possessive or not _ENDS_WITH_PREPOSITION_RE.search(before)):
        return True
    if any(terms(before[:clause.start()]) - _NO_SUBJECT_TERMS
           for clause in _LATER_CLAUSE_RE.finditer(before)):
        return True
    return possessive and bool(_OWN_SUBJECT_RE.match(before))


def is_followup(question: str) -> bool:
    """Does this question lean on an earlier turn for what it is about?

    A name alone doesn't settle it: "What is its SLA?" names what is asked but not whose. A pronoun
    answered inside the question doesn't either: "restart the pump when it overheats" is complete.
    """
    if not terms(question):
        return True
    named = named_terms(question)
    stripped = _EXPLETIVE_RE.sub(" ", question)
    if named and _ABOUT_DOCUMENT_RE.search(stripped):
        return False
    if not named and _CONTINUATION_RE.search(stripped):
        return True
    return any(not _pronoun_has_antecedent(match, stripped, named)
               for match in _ANAPHOR_RE.finditer(stripped))


def _clip(text: str, limit: int) -> str:
    collapsed = " ".join(text.split())
    if len(collapsed) <= limit:
        return collapsed
    return collapsed[:limit].rsplit(" ", 1)[0]


def followup_context(question: str, history: Sequence[str]) -> str | None:
    """The earlier user question a follow-up refers to, bounded; None for a standalone question.

    `history` is the conversation's earlier user turns, oldest first. A follow-up to a follow-up
    walks back to the last turn that named its own subject, so "tell me more about it" after
    "when should its seal be replaced?" still knows which machine "it" is.
    """
    if not history or not is_followup(question):
        return None
    recent = [turn for turn in history[-MAX_HISTORY_LOOKBACK:] if turn.strip()]
    if not recent:
        return None
    for turn in reversed(recent):
        if not is_followup(turn):
            return _clip(turn, MAX_CONTEXT_CHARS)
    return _clip(recent[-1], MAX_CONTEXT_CHARS)


# ----------------------------------------------------------------------- selection


@dataclass(frozen=True, slots=True)
class Source:
    id: int
    filename: str
    text: str


@dataclass(frozen=True, slots=True)
class Evidence:
    source_id: int
    sentence: str


@dataclass(frozen=True, slots=True)
class _Clause:
    text: str
    terms: frozenset[str]
    named: frozenset[str]

    @property
    def asked(self) -> frozenset[str]:
        """What is being asked about the subject. Names are checked against the whole chunk."""
        return (self.terms - self.named) or self.terms


@dataclass(frozen=True, slots=True)
class _Parsed:
    source: Source
    passage: Passage
    vocabulary: frozenset[str]
    title_terms: frozenset[str]
    superseded: bool


@dataclass(frozen=True, slots=True)
class _Candidate:
    score: float
    own: int
    order: int
    index: int
    parsed: _Parsed


def _clauses(question: str) -> list[_Clause]:
    out: list[_Clause] = []
    for part in _CLAUSE_RE.split(question):
        found = terms(part)
        if found:
            out.append(_Clause(part, frozenset(found), frozenset(named_terms(part) & found)))
    return out


def _parse_source(source: Source) -> _Parsed:
    passage = parse_passage(source.text)
    title_terms = terms(passage.title) | terms(_FILE_EXTENSION_RE.sub("", source.filename))
    vocabulary = set(title_terms)
    for heading in passage.headings:
        vocabulary |= terms(heading)
    for sentence in passage.sentences:
        vocabulary |= terms(sentence.text)
    return _Parsed(source, passage, frozenset(vocabulary), frozenset(title_terms),
                   bool(_SUPERSEDED_RE.search(source.text)))


def _about_context(parsed: _Parsed, context: str | None) -> bool:
    """A follow-up's passage has to be about the thing the earlier question was about."""
    if not context:
        return True
    named = named_terms(context) & terms(context)
    if named:
        return named <= parsed.vocabulary
    wanted = terms(context)
    return len(wanted & parsed.vocabulary) >= math.ceil(len(wanted) / 2)


def _fits_question_type(clause: _Clause, sentence: str) -> bool:
    if _ASKS_FREQUENCY_OR_AMOUNT_RE.search(clause.text) and not _AMOUNT_RE.search(sentence):
        return False
    if _ASKS_PERSON_RE.search(clause.text):
        return bool(_PERSON_RE.search(sentence) or _NAME_AFTER_START_RE.search(sentence))
    return True


def _coverage(clause: _Clause, sentence: Sentence, parsed: _Parsed) -> tuple[float, int]:
    """Share of the asked terms a sentence covers, and how many are in the sentence itself.

    A section heading speaks for the sentences under it ("Root cause" over the sentence that gives
    it). A document title only sets the topic, so it counts in full only once the sentence itself
    matches, and every sentence of a document on the right topic does not become an answer.
    """
    own = terms(sentence.text)
    heading = terms(sentence.heading)
    title_only = sentence.heading == parsed.passage.title and not own & clause.terms
    full = own if title_only else own | heading
    score = 0.0
    for term in clause.asked:
        if term in full:
            score += 1.0
        elif term in parsed.title_terms or term in heading:
            score += TITLE_WEIGHT
    return score / len(clause.asked), len(own & clause.terms)


def _candidates(clause: _Clause, parsed_sources: list[_Parsed]) -> list[_Candidate]:
    found: list[_Candidate] = []
    for order, parsed in enumerate(parsed_sources):
        if not clause.named <= parsed.vocabulary:
            continue
        for index, sentence in enumerate(parsed.passage.sentences):
            if not is_quotable(sentence.text) or not _fits_question_type(clause, sentence.text):
                continue
            score, own = _coverage(clause, sentence, parsed)
            if score >= MIN_COVERAGE:
                found.append(_Candidate(score, own, order, index, parsed))
    if any(not c.parsed.superseded for c in found):  # prefer the version still in force
        found = [c for c in found if not c.parsed.superseded]
    found.sort(key=lambda c: (-c.score, -c.own, c.order, c.index))
    return found


def _top_picks(found: list[_Candidate]) -> list[_Candidate]:
    if not found:
        return []
    best = found[0]
    picks = [best]
    for candidate in found[1:]:
        if len(picks) == MAX_PICKS_PER_CLAUSE:
            break
        # Another document has to be as good a match: a weaker one is how unrelated quotes get in.
        floor = best.score - NEAR_BEST if candidate.parsed is best.parsed else best.score
        if candidate.score >= floor:
            picks.append(candidate)
    return picks


def _overview_picks(clause: _Clause, parsed_sources: list[_Parsed]) -> list[tuple[_Parsed, int]]:
    """Opening sentences of the document asked about, of the kind asked for. The rest of the
    question has to name that document, so this cannot answer a question about something else."""
    if not _ASKS_OVERVIEW_RE.search(clause.text):
        return []
    topic = clause.terms - _OVERVIEW_TERMS
    wants_figures = bool(clause.terms & _FIGURE_TERMS)
    wants_people = bool(clause.terms & _PEOPLE_TERMS)

    def fits(sentence: str) -> bool:
        if not is_quotable(sentence):
            return False
        if wants_figures and not any(c.isdigit() for c in sentence):
            return False
        return not wants_people or bool(_PERSON_RE.search(sentence)
                                        or _NAME_AFTER_START_RE.search(sentence))

    named_after_topic = [
        p for p in parsed_sources
        if topic <= (p.title_terms | {t for h in p.passage.headings for t in terms(h)})]
    if any(not p.superseded for p in named_after_topic):
        named_after_topic = [p for p in named_after_topic if not p.superseded]
    for parsed in named_after_topic:
        found = [i for i, s in enumerate(parsed.passage.sentences) if fits(s.text)]
        if found:
            return [(parsed, i) for i in found[:MAX_OVERVIEW_SENTENCES]]
    return []


def select_evidence(question: str, sources: Sequence[Source],
                    context: str | None = None) -> list[Evidence]:
    """The sentences that answer the question, best first. Empty means abstain."""
    clauses = _clauses(question)
    if not clauses and context:  # "tell me more about it": the earlier question is the subject
        clauses, context = _clauses(context), None
    if not clauses:
        return []
    parsed_sources = [p for p in map(_parse_source, sources) if _about_context(p, context)]

    per_clause: list[list[tuple[_Parsed, int]]] = []
    for clause in clauses:
        overview = _overview_picks(clause, parsed_sources)
        if overview:
            per_clause.append(overview)
            continue
        ordered: list[tuple[_Parsed, int]] = []
        for pick in _top_picks(_candidates(clause, parsed_sources)):
            ordered.append((pick.parsed, pick.index))
            if _ASKS_PROCEDURE_RE.search(clause.text):
                # A matching sentence often states the problem; the next ones state the action.
                sentences = pick.parsed.passage.sentences
                section = sentences[pick.index].section
                following = range(pick.index + 1,
                                  min(pick.index + 1 + MAX_FOLLOWING_STEPS, len(sentences)))
                ordered.extend((pick.parsed, i) for i in following
                               if sentences[i].section == section
                               and is_quotable(sentences[i].text))
        per_clause.append(ordered)

    # Round-robin, so that every part of a compound question gets its best sentence in.
    picked: list[tuple[_Parsed, int]] = []
    seen: set[tuple[int, int]] = set()
    for rank in range(max((len(o) for o in per_clause), default=0)):
        for ordered in per_clause:
            if rank < len(ordered):
                parsed, index = ordered[rank]
                key = (parsed.source.id, index)
                if key not in seen and len(picked) < MAX_SENTENCES:
                    seen.add(key)
                    picked.append((parsed, index))
    return [Evidence(p.source.id, p.passage.sentences[i].text) for p, i in picked]
