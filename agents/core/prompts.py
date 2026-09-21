# ── What this file does ──────────────────────────────────────────────────
# Loads prompt text files from the /prompts/ directory at the repo root.
# Every agent that talks to the LLM reads its system prompt through this
# helper, so all prompt files stay outside the Python code in one place.
# ─────────────────────────────────────────────────────────────────────────
from pathlib import Path

# _ROOT resolves to the /prompts/ folder two levels above agents/core/,
# i.e. the repo root / prompts. Path(__file__) is this file itself.
_ROOT = Path(__file__).resolve().parent.parent.parent / "prompts"


def load_prompt(rel_path: str) -> str:
    # Read the prompt file (e.g. "interview/summary_system.md") as plain text.
    # rstrip("\n") removes a trailing newline so the LLM call looks clean.
    return (_ROOT / rel_path).read_text(encoding="utf-8").rstrip("\n")
