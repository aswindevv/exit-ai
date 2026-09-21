"""LLM access for the agents.

Plain HTTP to the same gateway + model the /ask Edge Function calls
(ANTHROPIC_BASE_URL/v1/messages) -- no SDK needed, and it sidesteps
SDK base_url/env-var plumbing that isn't set up for the Portkey gateway in
this project. Every call goes through trace.log_llm for the live terminal
trace (model, latency, token usage).

The ANTHROPIC_* names describe the wire PROTOCOL, not the vendor: Portkey
translates this Anthropic Messages request to whatever ANTHROPIC_MODEL routes
to (currently an Azure OpenAI model) and translates the reply back into
Anthropic shape, so agents need no per-vendor branching. The same three names
are also Edge Function secrets in the Supabase dashboard -- rename in both
places or not at all.
"""
from __future__ import annotations

import json
import re
from types import SimpleNamespace

import requests

from .config import ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, ANTHROPIC_MODEL
from .trace import log_llm


def _post(system: str, user: str, max_tokens: int) -> SimpleNamespace:
    resp = requests.post(
        f"{ANTHROPIC_BASE_URL.rstrip('/')}/v1/messages",
        headers={
            "Authorization": f"Bearer {ANTHROPIC_API_KEY}",
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        },
        json={
            "model": ANTHROPIC_MODEL,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        },
        timeout=60,
    )
    resp.raise_for_status()
    body = resp.json()
    # Gateway model has extended thinking on, so content[0] is sometimes a
    # 'thinking' block with no 'text' key -- find the actual text block
    # instead of assuming index 0.
    text_block = next((b for b in body["content"] if b.get("type") == "text"), None)
    if text_block is None:
        # Reasoning models spend max_tokens on reasoning before emitting any
        # text, and return content:[] rather than a partial block -- without
        # this the caller just sees a bare StopIteration.
        raise RuntimeError(
            f"{ANTHROPIC_MODEL} returned no text block "
            f"(stop_reason={body.get('stop_reason')!r}, usage={body.get('usage')}). "
            "If stop_reason is 'max_tokens', raise max_tokens for this call."
        )
    # Wrapped as SimpleNamespace (not the raw dict) so trace.log_llm's
    # attribute-based introspection (resp.usage.input_tokens, resp.content[0].text)
    # works and the terminal trace shows real token counts, not "tokens n/a".
    return SimpleNamespace(
        content=[SimpleNamespace(text=text_block["text"])],
        usage=SimpleNamespace(**body.get("usage", {})),
    )


def ask_claude(system: str, user: str, max_tokens: int = 500) -> str:
    resp = log_llm(ANTHROPIC_MODEL, lambda: _post(system, user, max_tokens))
    return resp.content[0].text


def ask_claude_json(system: str, user: str, max_tokens: int = 500) -> dict:
    """Same as ask_claude, but parses the JSON object the prompt asked for
    (tolerates ```-fenced output by grabbing the first {...} block)."""
    text = ask_claude(system, user, max_tokens)
    match = re.search(r"\{.*\}", text, re.DOTALL)
    return json.loads(match.group(0) if match else text)
