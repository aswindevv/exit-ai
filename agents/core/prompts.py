from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent.parent / "prompts"


def load_prompt(rel_path: str) -> str:
    return (_ROOT / rel_path).read_text(encoding="utf-8").rstrip("\n")
