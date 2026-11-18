#!/usr/bin/env sh
# Entry point used by BotHost when the runtime is plain Python.
set -e
python -m pip install --quiet --disable-pip-version-check -r requirements.txt
exec python main.py
