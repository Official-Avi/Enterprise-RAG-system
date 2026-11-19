"""Greetings and thanks get a friendly direct reply, not "Your documents don't answer this".

2026-11-18: typing "hi" in /ask showed the not-found card, because every message was searched.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from rackflow.db.models import Role
from rackflow.rag.smalltalk import GREETING_REPLY, HELP_REPLY, THANKS_REPLY, small_talk_reply
from tests.conftest import Factory
from tests.rag.test_rag import QUESTION, ask, indexed_collection


@pytest.mark.parametrize("text", [
    "hi", "Hi!", "hello", "hey there", "Good morning", "hiii", "  HELLO  "])
def test_greetings(text: str) -> None:
    assert small_talk_reply(text) == GREETING_REPLY


@pytest.mark.parametrize("text", ["thanks", "Thank you!", "thanks a lot", "ok", "got it"])
def test_thanks(text: str) -> None:
    assert small_talk_reply(text) == THANKS_REPLY


@pytest.mark.parametrize("text", [
    "help", "What can you do?", "who are you", "what is RackFlow AI?"])
def test_help(text: str) -> None:
    assert small_talk_reply(text) == HELP_REPLY


@pytest.mark.parametrize("text", [
    "hi, how long are backups retained?",
    "hello what does the policy say about retention",
    "How do I fix an exhausted connection pool?",
    "thanks, and who approves a failover?",
    "is he eligible for python developer role?",
    "help me find the backup policy",
    "",
])
def test_real_questions_still_search_the_documents(text: str) -> None:
    assert small_talk_reply(text) is None


@pytest.mark.integration
@pytest.mark.qdrant
def test_hi_gets_a_greeting_through_the_api(client: TestClient, factory: Factory) -> None:
    eng = factory.actor(Role.ENGINEER)
    cid = indexed_collection(client, eng)
    sid, r = ask(client, eng, [cid], question="hi")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["evidence_status"] == "conversational"
    assert body["answer"] == GREETING_REPLY
    assert body["citations"] == [] and body["retrieved_count"] == 0

    # The saved chat replays the same reply, and the greeting is not context for the next question.
    detail = client.get(f"/api/v1/chat/sessions/{sid}", headers=eng.headers).json()
    assert detail["messages"][1]["evidence_status"] == "conversational"
    follow = client.post(f"/api/v1/chat/sessions/{sid}/messages", json={"message": QUESTION},
                         headers=eng.headers)
    assert follow.status_code == 200, follow.text
    assert follow.json()["evidence_status"] == "supported"


# 2026-11-19 live check: "👋" was searched and came back "couldn't produce a verified answer".
@pytest.mark.parametrize(("text", "reply"), [
    ("👋", GREETING_REPLY), ("🙂", GREETING_REPLY), (" 👋👋 ", GREETING_REPLY),
    ("👍", THANKS_REPLY), ("🙏", THANKS_REPLY)])
def test_emoji_only_messages_are_small_talk(text: str, reply: str) -> None:
    assert small_talk_reply(text) == reply


def test_emoji_with_a_question_still_searches() -> None:
    assert small_talk_reply("👋 how long are backups retained?") is None
    assert small_talk_reply("बैकअप कितने दिन रखे जाते हैं?") is None


@pytest.mark.integration
def test_blank_message_is_a_validation_error_not_a_model_call(
        client: TestClient, factory: Factory) -> None:
    # 2026-11-19 live check: "   " passed min_length=1, was stripped to "" and sent to the model.
    eng = factory.actor(Role.ENGINEER)
    s = client.post("/api/v1/chat/sessions", json={"collection_ids": [
        client.post("/api/v1/collections", json={"name": "Blank", "visibility": "tenant"},
                    headers=eng.headers).json()["id"]]}, headers=eng.headers)
    assert s.status_code == 201, s.text
    for message in ["   ", "\n\t "]:
        r = client.post(f"/api/v1/chat/sessions/{s.json()['id']}/messages",
                        json={"message": message}, headers=eng.headers)
        assert r.status_code == 422, r.text
