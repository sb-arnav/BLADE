import subprocess
import json

def ask_claude(messages: list[dict]) -> str:
    """Send conversation to claude -p and return response."""
    # Build prompt with conversation history
    prompt_parts = []
    for msg in messages:
        role = msg["role"].upper()
        content = msg["content"]
        prompt_parts.append(f"{role}: {content}")
    prompt_parts.append("ASSISTANT:")
    prompt = "\n\n".join(prompt_parts)

    result = subprocess.run(
        ["claude", "-p", prompt],
        capture_output=True,
        text=True,
        timeout=60
    )

    if result.returncode != 0:
        raise RuntimeError(f"Claude error: {result.stderr}")

    return result.stdout.strip()
