# my.remarkable

A web-based library browser and notebook splitter for the reMarkable tablet. Built with Python (FastAPI + Jinja2 + htmx).

## Setup

1. Install [uv](https://docs.astral.sh/uv/getting-started/installation/)

2. Copy `.env.example` to `.env` and add your one-time code from
   [my.remarkable.com/device/browser/connect](https://my.remarkable.com/device/browser/connect)

3. Register your device (exchange the one-time code for a persistent device token):

   ```
   uv run register_device.py
   ```

4. Start the server:

   ```
   uv run server.py
   ```

5. Open [http://localhost:8000](http://localhost:8000)

## Features

- Browse your reMarkable library (folders, notebooks, PDFs, ePubs)
- Grid and list views
- Search and sort
- Split multi-page notebooks into individual page notebooks
- Light and dark mode (follows system preference)
