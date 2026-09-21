# ─── What this file does ─────────────────────────────────────────────────────
# Provides real-time terminal logging for the agent pipeline. When an agent
# runs, it prints what's happening step by step: which function started, what
# the AI returned, which database rows were written, how long each step took.
# ─────────────────────────────────────────────────────────────────────────────
"""
trace.py -- live, full-trace logging for the ExitAI LangGraph agents.

Prints to the terminal AS each agent runs: inputs on entry, every LLM call
(model, latency, token usage), every DB write, and the agent's output + total
time on exit. Nested calls indent, so you watch the supervisor hand off to each
agent live in the VS Code terminal.

Usage:
    from trace import traced_node, log_llm, log_db

    @traced_node("HR agent")
    def hr_agent(state):
        resp = log_llm("claude-sonnet-4-5", lambda: llm.invoke(prompt))
        log_db("insert", "exit_tasks", rows=7)
        return {"tasks": [...]}

Control with the TRACE_LEVEL env var: full | summary | off.

DEV/DEMO TOOL. For production, set TRACE_LEVEL=summary or off and send structured
logs to a real sink. Full inputs/outputs in a terminal can leak PII and get
noisy -- which is why long values are truncated and field names in REDACT are
masked. Add sensitive fields to REDACT as your schema grows.
"""

from __future__ import annotations

import functools
import json
import os
import sys
import time
from contextvars import ContextVar

# ---- config -------------------------------------------------------------
TRACE_LEVEL = os.getenv("TRACE_LEVEL", "full")   # full | summary | off
REDACT = {"password", "ssn", "email", "token", "api_key"}
MAX_VALUE_CHARS = 140

# ---- colors (auto-disabled when output is piped to a file) --------------
_C = {
    "reset": "\033[0m", "dim": "\033[2m", "bold": "\033[1m",
    "cyan": "\033[36m", "green": "\033[32m", "yellow": "\033[33m",
    "magenta": "\033[35m", "red": "\033[31m",
}


def _c(text: str, color: str) -> str:
    if not sys.stdout.isatty():
        return text
    return f"{_C[color]}{text}{_C['reset']}"


# ContextVar tracks how deeply nested the current call is (supervisor -> hr_agent -> etc.).
# Each level of nesting adds indentation (│) so the terminal trace reads as a tree.
_depth: ContextVar[int] = ContextVar("trace_depth", default=0)


def _emit(line: str) -> None:
    if TRACE_LEVEL == "off":
        return
    # flush=True is what makes it LIVE -- each line appears the instant it runs.
    print(f"{'│  ' * _depth.get()}{line}", flush=True)


def _fmt(value) -> str:
    """Compact, truncated, redacted rendering of an input/output value."""
    def scrub(v):
        if isinstance(v, dict):
            return {k: ("***" if k.lower() in REDACT else scrub(x))
                    for k, x in v.items()}
        if isinstance(v, list):
            return [scrub(x) for x in v[:5]]
        return v
    s = json.dumps(scrub(value), default=str, ensure_ascii=False)
    return s if len(s) <= MAX_VALUE_CHARS else s[:MAX_VALUE_CHARS] + "…"


# ---- public API ---------------------------------------------------------

# @traced_node("Some Name") is a decorator: wrap any agent function with it to get
# automatic start/end logging, timing, and input/output printing.
# Decorators in Python are a way to add behaviour to a function without editing
# the function itself -- "@traced_node(...)" above a def applies the wrapper.
def traced_node(name: str):
    """Decorator for a LangGraph node. Logs start/inputs, then done/output/time
    (or the failure). Nested traced nodes indent under their caller."""
    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(state, *args, **kwargs):
            if TRACE_LEVEL == "off":
                return fn(state, *args, **kwargs)

            start = time.perf_counter()
            _emit(_c(f"┌─ {name}", "cyan") + _c("  ▸ start", "dim"))
            token = _depth.set(_depth.get() + 1)
            if TRACE_LEVEL == "full":
                _emit(_c(f"inputs: {_fmt(state)}", "dim"))

            try:
                result = fn(state, *args, **kwargs)
            except Exception as exc:
                elapsed = time.perf_counter() - start
                _depth.reset(token)
                _emit(_c(f"└─ {name}", "cyan")
                      + _c(f"  ✗ failed  {elapsed:.2f}s  "
                           f"{type(exc).__name__}: {exc}", "red"))
                raise

            elapsed = time.perf_counter() - start
            if TRACE_LEVEL == "full" and result is not None:
                _emit(_c(f"output: {_fmt(result)}", "dim"))
            _depth.reset(token)
            _emit(_c(f"└─ {name}", "cyan")
                  + _c(f"  ✓ done  {elapsed:.2f}s", "green"))
            return result
        return wrapper
    return decorator


def log_llm(model: str, call):
    """Run an LLM call, time it, log token usage. `call` is a zero-arg lambda
    returning the response. Returns the response unchanged."""
    start = time.perf_counter()
    resp = call()
    elapsed = time.perf_counter() - start
    _emit(_c(f"↳ llm  {model}", "magenta")
          + _c(f"  {elapsed:.2f}s  {_tokens(resp)}", "dim"))
    if TRACE_LEVEL == "full":
        preview = _preview(resp)
        if preview:
            _emit(_c(f"   ⤷ {preview}", "dim"))
    return resp


def log_db(action: str, table: str, rows: int | None = None,
           detail: str = "") -> None:
    """Log a database write: log_db('insert', 'exit_tasks', rows=7)."""
    extra = f"  ({rows} rows)" if rows is not None else ""
    if detail:
        extra += f"  {detail}"
    _emit(_c(f"↳ db   {action} {table}", "yellow") + _c(extra, "dim"))


# ---- response introspection (Anthropic SDK + LangChain shapes) ----------

def _tokens(resp) -> str:
    usage = getattr(resp, "usage", None)                 # Anthropic SDK
    if usage is not None and getattr(usage, "input_tokens", None) is not None:
        return f"in={usage.input_tokens} out={usage.output_tokens} tok"
    meta = getattr(resp, "usage_metadata", None)          # LangChain AIMessage
    if meta:
        return f"in={meta.get('input_tokens')} out={meta.get('output_tokens')} tok"
    return "tokens n/a"


def _preview(resp) -> str:
    text = getattr(resp, "content", None)
    if isinstance(text, list) and text and hasattr(text[0], "text"):  # Anthropic
        text = text[0].text
    if not isinstance(text, str):
        text = str(text)
    text = text.replace("\n", " ").strip()
    return text[:100] + "…" if len(text) > 100 else text


# ---- demo: simulates a supervisor handing off to two agents -------------

if __name__ == "__main__":
    class _FakeResp:
        class usage:  # noqa: N801
            input_tokens, output_tokens = 412, 98
        content = "Generated a 7-item exit checklist for a Backend Engineer."

    @traced_node("HR agent")
    def hr_agent(state):
        log_llm("claude-sonnet-4-5", lambda: (time.sleep(0.3), _FakeResp())[1])
        log_db("insert", "exit_tasks", rows=7)
        return {"tasks_created": 7}

    @traced_node("Compliance & risk agent")
    def risk_agent(state):
        log_llm("claude-sonnet-4-5", lambda: (time.sleep(0.2), _FakeResp())[1])
        log_db("update", "exit_cases", rows=1, detail="risk_score=0.82")
        return {"risk_level": "high", "risk_score": 0.82}

    @traced_node("Supervisor")
    def supervisor(state):
        hr_agent(state)
        risk_agent(state)
        return {"status": "routed"}

    supervisor({"case_id": "abc-123", "role": "Backend Engineer",
                "department": "Sales", "email": "rahul@example.com"})
