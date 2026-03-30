"""reMarkable Cloud API client.

Handles device registration, auth token refresh, document listing,
download, upload, and deletion.
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path

import httpx

_DIR = Path(__file__).resolve().parent
_TOKEN_FILE = _DIR / "server" / ".device-token"
_TOKEN_FILE_ROOT = _DIR / ".device-token"

AUTH_HOST = "https://webapp.cloud.remarkable.com"
SYNC_HOST = "https://internal.cloud.remarkable.com"
STORAGE_FALLBACK = (
    "https://document-storage-production-dot-remarkable-production.appspot.com"
)

REQUEST_TIMEOUT = 60.0


class RemarkableClient:
    def __init__(self) -> None:
        self.device_token: str | None = None
        self.user_token: str | None = None
        self.storage_host: str | None = None
        self._http = httpx.AsyncClient(timeout=REQUEST_TIMEOUT)
        self._load_device_token()

    def _load_device_token(self) -> None:
        tok = os.environ.get("REMARKABLE_DEVICE_TOKEN", "").strip()
        if tok:
            self.device_token = tok
            return
        for path in (_TOKEN_FILE_ROOT, _TOKEN_FILE):
            try:
                self.device_token = path.read_text().strip()
                return
            except FileNotFoundError:
                continue

    def _save_device_token(self, token: str) -> None:
        self.device_token = token
        _TOKEN_FILE_ROOT.write_text(token)

    def is_registered(self) -> bool:
        return bool(self.device_token)

    async def register(self, one_time_code: str) -> bool:
        resp = await self._http.post(
            f"{AUTH_HOST}/token/json/2/device/new",
            json={
                "code": one_time_code,
                "deviceDesc": "browser-chrome",
                "deviceID": str(uuid.uuid4()),
            },
            headers={"Content-Type": "application/json", "Authorization": "Bearer"},
        )
        resp.raise_for_status()
        self._save_device_token(resp.text.strip())
        return True

    async def refresh_token(self) -> str:
        if not self.device_token:
            raise RuntimeError("Not registered. Provide a one-time code first.")
        resp = await self._http.post(
            f"{AUTH_HOST}/token/json/2/user/new",
            headers={"Authorization": f"Bearer {self.device_token}"},
        )
        resp.raise_for_status()
        self.user_token = resp.text.strip()
        return self.user_token

    async def _ensure_auth(self) -> None:
        if not self.user_token:
            await self.refresh_token()

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.user_token}"}

    async def _get_storage_host(self) -> str:
        if self.storage_host:
            return self.storage_host
        await self._ensure_auth()
        try:
            resp = await self._http.get(
                f"{SYNC_HOST}/service/json/1/document-storage",
                params={
                    "environment": "production",
                    "group": "auth0|5a68dc51cb30df3877a1d7c4",
                    "apiVer": "2",
                },
                headers=self._headers(),
            )
            resp.raise_for_status()
            self.storage_host = f"https://{resp.json()['Host']}"
        except Exception:
            self.storage_host = STORAGE_FALLBACK
        return self.storage_host

    async def list_items(self) -> list[dict]:
        await self._ensure_auth()
        host = await self._get_storage_host()
        resp = await self._http.get(
            f"{host}/document-storage/json/2/docs",
            params={"withBlob": "true"},
            headers=self._headers(),
        )
        resp.raise_for_status()
        return resp.json()

    async def download_document(self, blob_url: str) -> bytes:
        resp = await self._http.get(blob_url, timeout=120.0)
        resp.raise_for_status()
        return resp.content

    async def upload_request(self, items: list[dict]) -> list[dict]:
        await self._ensure_auth()
        host = await self._get_storage_host()
        resp = await self._http.put(
            f"{host}/document-storage/json/2/upload/request",
            json=items,
            headers={**self._headers(), "Content-Type": "application/json"},
        )
        resp.raise_for_status()
        return resp.json()

    async def upload_blob(self, upload_url: str, data: bytes) -> None:
        await self._http.put(
            upload_url,
            content=data,
            headers={"Content-Type": "application/octet-stream"},
            timeout=300.0,
        )

    async def update_metadata(self, items: list[dict]) -> None:
        await self._ensure_auth()
        host = await self._get_storage_host()
        await self._http.put(
            f"{host}/document-storage/json/2/upload/update-status",
            json=items,
            headers={**self._headers(), "Content-Type": "application/json"},
        )

    async def delete_document(self, doc_id: str, version: int) -> None:
        await self._ensure_auth()
        host = await self._get_storage_host()
        await self._http.put(
            f"{host}/document-storage/json/2/delete",
            json=[{"ID": doc_id, "Version": version}],
            headers={**self._headers(), "Content-Type": "application/json"},
        )
