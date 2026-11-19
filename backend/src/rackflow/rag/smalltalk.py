"""Greetings, thanks and "what can you do": answered directly instead of searching the documents.

Before this, "hi" went through retrieval, matched nothing useful and came back as "Your documents
don't answer this", which reads as a failure. Only short messages that are nothing but small talk
are caught; anything with a real question in it still goes to the documents.
"""

from __future__ import annotations

import re

_GREETING = re.compile(
    r"^(hi+|hey+|hello+|hiya|howdy|yo|greetings|good (morning|afternoon|evening|day)|namaste|"
    r"hi there|hello there|hey there)( (there|all|team|rackflow|bot))?$")
_THANKS = re.compile(
    r"^(thanks?|thank you|thank you so much|thanks a lot|thx|ty|cheers|great|awesome|perfect|"
    r"nice|cool|ok(ay)?|got it|understood|that helps|that's helpful|appreciate it)( thanks?)?$")
_BYE = re.compile(r"^(bye|goodbye|see you|see ya|good night|later)$")
_HELP = re.compile(
    r"^(help|what can you do|what do you do|how does this work|how do i use (this|you|it)|"
    r"who are you|what are you|what is this|what is rackflow( ai)?|how can you help( me)?)$")

GREETING_REPLY = (
    "Hi! I answer questions from your documents, and every answer quotes the passage and the "
    "page it came from. Try asking something like \"How long are backups retained?\", or add a "
    "PDF, Word, text or Markdown file and ask about it.")
THANKS_REPLY = "You're welcome. Ask me anything else about your documents whenever you like."
BYE_REPLY = "Goodbye! Your chats are saved here when you come back."
HELP_REPLY = (
    "I'm RackFlow AI. I read the documents in your workspace (PDF, Word, text, Markdown and "
    "scanned PDFs) and answer questions in plain words. Every answer shows the exact passage "
    "and page it came from, and if your documents don't cover something, I say so instead of "
    "guessing. Ask a question below, or add files to search them.")


def _normalise(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[\s]+", " ", text)
    return re.sub(r"[!?.,;:~'\"`*_()\[\]-]+", "", text).strip()


_THANKS_SYMBOLS = ("👍", "🙏", "❤", "♥", "🙌", "👌")


def small_talk_reply(question: str) -> str | None:
    """The direct reply for a message that is only small talk, else None (search the documents)."""
    stripped = question.strip()
    if stripped and len(stripped) <= 40 and not any(ch.isalnum() for ch in stripped):
        # "👋", "🙂", "👍": nothing to search for. Thumbs-up and the like read as thanks.
        return THANKS_REPLY if any(sym in stripped for sym in _THANKS_SYMBOLS) else GREETING_REPLY
    text = _normalise(question).replace("’", "")
    if not text or len(text) > 40:
        return None
    if _GREETING.match(text):
        return GREETING_REPLY
    if _THANKS.match(text):
        return THANKS_REPLY
    if _BYE.match(text):
        return BYE_REPLY
    if _HELP.match(text):
        return HELP_REPLY
    return None
