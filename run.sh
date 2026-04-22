#!/usr/bin/env bash

# Aladí Library Portal launcher

cd "$(dirname "$0")"

# Create virtual environment and install dependencies if it doesn't exist
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
    .venv/bin/pip install -r requirements.txt
fi

# Kill all current apps using port 5000
fuser -k 5000/tcp

# Launch the app
.venv/bin/python app.py &
sleep 1
xdg-open http://localhost:5000