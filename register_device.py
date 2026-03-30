# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx", "python-dotenv"]
# ///
"""Exchange a reMarkable one-time code for a persistent device token."""

import uuid
import os
from pathlib import Path
from dotenv import load_dotenv
import httpx

load_dotenv()

AUTH_HOST = "https://webapp.cloud.remarkable.com"

one_time_code = os.environ.get("REMARKABLE_ONE_TIME_CODE", "").strip()
if not one_time_code:
    print("ERROR: REMARKABLE_ONE_TIME_CODE is not set in .env")
    raise SystemExit(1)

print(f"Registering with one-time code: {one_time_code}")

resp = httpx.post(
    f"{AUTH_HOST}/token/json/2/device/new",
    json={
        "code": one_time_code,
        "deviceDesc": "browser-chrome",
        "deviceID": str(uuid.uuid4()),
    },
    headers={
        "Content-Type": "application/json",
        "Authorization": "Bearer",
    },
    timeout=60.0,
)

if resp.status_code != 200:
    print(f"ERROR: Registration failed (HTTP {resp.status_code})")
    print(resp.text)
    raise SystemExit(1)

device_token = resp.text.strip()
print(f"Device token received ({len(device_token)} chars)")

env_path = Path(".env")
env_content = env_path.read_text()
env_content = env_content.replace(
    "REMARKABLE_DEVICE_TOKEN=",
    f"REMARKABLE_DEVICE_TOKEN={device_token}",
)
env_path.write_text(env_content)
print("Saved device token to .env (REMARKABLE_DEVICE_TOKEN)")
