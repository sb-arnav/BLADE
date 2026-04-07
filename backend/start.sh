#!/bin/bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/venv/bin/activate"
uvicorn main:app --host 127.0.0.1 --port 7731 --reload --app-dir "$DIR"
