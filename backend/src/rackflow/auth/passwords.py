from __future__ import annotations

import re

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

_hasher = PasswordHasher()  # argon2id with library-maintained defaults

# Verified against when the user does not exist, so login timing does not reveal accounts.
_DUMMY_HASH = _hasher.hash("rackflow-dummy-password-for-timing")

MIN_PASSWORD_LENGTH = 12
MAX_PASSWORD_LENGTH = 512

# Passwords (compared lower-cased, with separators and a trailing run of digits or symbols
# removed) that are well known, appear in breach lists, or appear in this project's docs and tests.
COMMON_PASSWORDS = frozenset({
    "password", "passw0rd", "p@ssword", "p@ssw0rd", "letmein", "welcome", "changeme", "changeit",
    "qwerty", "qwertyuiop", "asdfghjkl", "zxcvbnm", "iloveyou", "admin", "administrator", "root",
    "secret", "default", "trustno1", "monkey", "dragon", "football", "baseball", "sunshine",
    "princess", "superman", "batman", "master", "shadow", "abc", "abcdef", "abcdefgh",
    "correcthorsebatterystaple", "rackflow", "rackflowdemo", "rackflowadmin", "demo",
    "demopassword", "test", "testing", "testpassword", "example", "acme", "globex",
})

# Fragments that make a password guessable however long it is.
_COMMON_FRAGMENTS = (
    "password", "passw0rd", "p@ssw", "changeme", "letmein", "qwerty", "123456", "abcdef",
    "rackflow", "correcthorse",
)

_SEPARATORS = re.compile(r"[\s._\-+@!]+")
_TRAILING_JUNK = re.compile(r"[\d\W_]+$")


class WeakPasswordError(ValueError):
    """A password that the policy refuses. The message never contains the password."""


def password_problems(password: str, *, emails: tuple[str, ...] = ()) -> list[str]:
    """Reasons the password is not acceptable for a new account; empty when it is.

    Used wherever an operator sets a password (CLI). Existing accounts are never re-checked, and
    login is unaffected."""
    problems: list[str] = []
    if len(password) < MIN_PASSWORD_LENGTH:
        problems.append(f"must be at least {MIN_PASSWORD_LENGTH} characters")
    if len(password) > MAX_PASSWORD_LENGTH:
        problems.append(f"must be at most {MAX_PASSWORD_LENGTH} characters")
    lowered = password.lower()
    compact = _SEPARATORS.sub("", lowered)
    if (lowered in COMMON_PASSWORDS or compact in COMMON_PASSWORDS
            or _TRAILING_JUNK.sub("", compact) in COMMON_PASSWORDS
            or any(f in lowered or f in compact for f in _COMMON_FRAGMENTS)):
        problems.append("is a common or well-known password")
    elif len(set(password)) < 5:
        problems.append("repeats too few different characters")
    for email in emails:
        local = email.strip().lower().split("@", 1)[0]
        parts = {local, *(p for p in _SEPARATORS.split(local) if len(p) >= 4)}
        if any(len(p) >= 3 and p in lowered for p in parts):
            problems.append("must not contain the account's email name")
            break
    return problems


def check_password_policy(password: str, *, emails: tuple[str, ...] = ()) -> None:
    """Raise WeakPasswordError if the password fails the policy (see password_problems)."""
    problems = password_problems(password, emails=emails)
    if problems:
        raise WeakPasswordError("Password " + "; ".join(problems) + ".")


def hash_password(password: str) -> str:
    # Only the length floor here: the API's create-member path and the test fixtures rely on it.
    # New passwords chosen by operators go through check_password_policy first.
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False
