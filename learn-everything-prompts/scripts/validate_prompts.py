#!/usr/bin/env python3
"""
Validate all prompt templates and eval definitions in the learn-everything-prompts skill.
"""

import json
import sys
from pathlib import Path


REQUIRED_REFERENCES = [
    "references/core-pedagogy-modules.md",
    "references/syllabus-planning-prompt.md",
    "references/stem-courseware-prompt.md",
    "references/general-courseware-prompt.md",
    "references/english-reading-prompt.md",
    "references/runtime-user-prompts.md",
    "references/agent-mode-prompt.md",
    "references/chat-mode-prompt.md",
    "references/pdf-segmentation-prompt.md",
]


def main() -> int:
    skill_dir = Path(__file__).resolve().parent.parent
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.exists():
        print("ERROR: SKILL.md missing", file=sys.stderr)
        return 1

    for rel in REQUIRED_REFERENCES:
        ref_path = skill_dir / rel
        if not ref_path.exists():
            print(f"ERROR: Missing reference file {rel}", file=sys.stderr)
            return 1
        content = ref_path.read_text(encoding="utf-8")
        if len(content.strip()) < 200:
            print(f"ERROR: Reference file {rel} is too short", file=sys.stderr)
            return 1

    evals_path = skill_dir / "evals" / "evals.json"
    if not evals_path.exists():
        print("ERROR: evals/evals.json missing", file=sys.stderr)
        return 1

    evals_data = json.loads(evals_path.read_text(encoding="utf-8"))
    if evals_data.get("skill_name") != "learn-everything-prompts":
        print("ERROR: evals.json skill_name mismatch", file=sys.stderr)
        return 1

    print("All prompt references and eval schemas validated successfully.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
