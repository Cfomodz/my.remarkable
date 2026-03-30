# /// script
# requires-python = ">=3.11"
# dependencies = ["fastapi", "uvicorn[standard]", "httpx", "jinja2", "python-dotenv", "python-multipart"]
# ///
"""my.remarkable — reMarkable library browser & notebook splitter."""

from __future__ import annotations

import datetime as dt
import uuid
from pathlib import Path

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, Form, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from remarkable_client import RemarkableClient
from split_notes import split_notebook

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent

app = FastAPI()
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=BASE_DIR / "templates")

client = RemarkableClient()

# ── Cached document list ──────────────────────────────────────────────

_cached_items: list[dict] = []


async def _fetch_items(*, force: bool = False) -> list[dict]:
    global _cached_items
    if _cached_items and not force:
        return _cached_items
    try:
        raw = await client.list_items()
        _cached_items = raw
    except Exception:
        try:
            await client.refresh_token()
            raw = await client.list_items()
            _cached_items = raw
        except Exception:
            pass
    return _cached_items


# ── Helpers ───────────────────────────────────────────────────────────

def _normalize(item: dict) -> dict:
    return {
        "id": item.get("ID", ""),
        "name": item.get("VissibleName") or item.get("visibleName") or "Untitled",
        "parent": item.get("Parent", ""),
        "type": item.get("Type", ""),
        "last_modified": item.get("ModifiedClient", ""),
        "blob_url": item.get("BlobURLGet", ""),
        "version": item.get("Version", 1),
        "file_type": item.get("fileType", "notebook"),
    }


def _rel_time(iso: str) -> str:
    if not iso:
        return ""
    try:
        d = dt.datetime.fromisoformat(iso.replace("Z", "+00:00"))
        now = dt.datetime.now(dt.timezone.utc)
        diff = now - d
        mins = int(diff.total_seconds() // 60)
        if mins < 1:
            return "just now"
        if mins < 60:
            return f"{mins}m ago"
        hrs = mins // 60
        if hrs < 24:
            return f"{hrs}h ago"
        days = hrs // 24
        if days < 7:
            return f"{days}d ago"
        return d.strftime("%b") + " " + str(d.day)
    except Exception:
        return iso


def _type_label(file_type: str) -> str:
    return {"notebook": "NB", "epub": "EP"}.get(file_type, "PDF")


def _badge_variant(file_type: str) -> str:
    return {"notebook": "success", "epub": "info"}.get(file_type, "warning")


def _enrich_doc(d: dict) -> dict:
    """Add display-ready fields to a normalized document dict."""
    d["rel_time"] = _rel_time(d["last_modified"])
    d["type_label"] = _type_label(d["file_type"])
    d["badge_variant"] = _badge_variant(d["file_type"])
    d["pages"] = d.get("pages")
    d["can_split"] = d["file_type"] == "notebook"
    return d


def _enrich_folder(f: dict) -> dict:
    f["rel_time"] = _rel_time(f["last_modified"])
    return f


def _build_folder_tree(all_folders: list[dict]) -> list[dict]:
    """Return nested folder tree with children lists."""
    by_parent: dict[str, list[dict]] = {}
    for f in all_folders:
        by_parent.setdefault(f["parent"], []).append(f)

    def _children(parent_id: str) -> list[dict]:
        return [
            {**f, "children": _children(f["id"])}
            for f in by_parent.get(parent_id, [])
        ]

    return _children("")


def _build_breadcrumbs(
    current_folder: str | None, folders_by_id: dict[str, dict]
) -> list[dict]:
    crumbs = [{"id": None, "name": "My files"}]
    fid = current_folder
    while fid:
        folder = folders_by_id.get(fid)
        if not folder:
            break
        crumbs.insert(1, {"id": folder["id"], "name": folder["name"]})
        fid = folder["parent"] or None
    return crumbs


def _build_stats(docs: list[dict], folders: list[dict]) -> dict:
    notebooks = sum(1 for d in docs if d["file_type"] == "notebook")
    pdfs = sum(1 for d in docs if d["file_type"] not in ("notebook", "epub"))
    epubs = sum(1 for d in docs if d["file_type"] == "epub")
    return {
        "total": len(docs),
        "notebooks": notebooks,
        "pdfs": pdfs,
        "epubs": epubs,
        "folders": len(folders),
    }


def _library_context(
    items: list[dict],
    *,
    folder: str | None = None,
    query: str = "",
    view: str = "grid",
    sort_by: str = "lastModified",
    sort_dir: str = "desc",
) -> dict:
    """Build the full template context for the library page."""
    normalized = [_normalize(i) for i in items]
    all_folders = [n for n in normalized if n["type"] == "CollectionType"]
    all_docs = [n for n in normalized if n["type"] == "DocumentType"]
    folders_by_id = {f["id"]: f for f in all_folders}

    if query:
        q = query.lower()
        cur_folders = [f for f in all_folders if q in f["name"].lower()]
        cur_docs = [d for d in all_docs if q in d["name"].lower()]
    else:
        target = folder or ""
        cur_folders = [f for f in all_folders if (f["parent"] or "") == target]
        cur_docs = [d for d in all_docs if (d["parent"] or "") == target]

    reverse = sort_dir == "desc"
    if sort_by == "name":
        key = lambda x: x["name"].lower()
    else:
        key = lambda x: x["last_modified"] or ""
    cur_folders.sort(key=key, reverse=reverse)
    cur_docs.sort(key=key, reverse=reverse)

    cur_folders = [_enrich_folder(f) for f in cur_folders]
    cur_docs = [_enrich_doc(d) for d in cur_docs]

    return {
        "current_folder": folder,
        "query": query,
        "view": view,
        "sort_by": sort_by,
        "sort_dir": sort_dir,
        "breadcrumbs": _build_breadcrumbs(folder, folders_by_id),
        "folder_tree": _build_folder_tree(all_folders),
        "folders": cur_folders,
        "docs": cur_docs,
        "total_items": len(cur_folders) + len(cur_docs),
        "stats": _build_stats(all_docs, all_folders),
    }


# ── Routes ────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    if not client.is_registered():
        return templates.TemplateResponse(request, "register.html")
    return RedirectResponse("/library", status_code=302)


@app.post("/register", response_class=HTMLResponse)
async def register(request: Request, code: str = Form(...)):
    try:
        await client.register(code.strip())
        await client.refresh_token()
        return RedirectResponse("/library", status_code=303)
    except Exception as exc:
        return templates.TemplateResponse(
            request, "register.html", {"error": str(exc)}
        )


@app.get("/library", response_class=HTMLResponse)
async def library(
    request: Request,
    folder: str | None = Query(None),
    q: str = Query(""),
    view: str = Query("grid"),
    sort: str = Query("lastModified"),
    dir: str = Query("desc"),
    partial: str = Query(""),
    refresh: str = Query(""),
):
    if not client.is_registered():
        return RedirectResponse("/", status_code=302)

    items = await _fetch_items(force=bool(refresh))
    ctx = _library_context(
        items, folder=folder, query=q, view=view, sort_by=sort, sort_dir=dir
    )

    if partial:
        return templates.TemplateResponse(request, "partials/content.html", ctx)
    return templates.TemplateResponse(request, "library.html", ctx)


@app.post("/split/{doc_id}", response_class=HTMLResponse)
async def split_notes_route(request: Request, doc_id: str):
    try:
        await client._ensure_auth()
        items = await client.list_items()
        doc = next((i for i in items if i.get("ID") == doc_id), None)
        if not doc:
            return _toast_html("Document not found", error=True)

        blob_url = doc.get("BlobURLGet")
        if not blob_url:
            return _toast_html("No download URL available", error=True)

        zip_bytes = await client.download_document(blob_url)
        doc_name = doc.get("VissibleName") or doc.get("visibleName") or "Untitled"
        parent_id = doc.get("Parent", "")
        pages = split_notebook(zip_bytes, doc_name, parent_id)

        for page in pages:
            upload_info = await client.upload_request(
                [{"ID": page["id"], "Type": "DocumentType", "Version": 1}]
            )
            await client.upload_blob(upload_info[0]["BlobURLPut"], page["zip_bytes"])
            await client.update_metadata(
                [
                    {
                        "ID": page["id"],
                        "Type": "DocumentType",
                        "Version": 1,
                        "VissibleName": page["visible_name"],
                        "Parent": page["parent_id"],
                        "ModifiedClient": dt.datetime.now(
                            dt.timezone.utc
                        ).isoformat(),
                    }
                ]
            )

        global _cached_items
        _cached_items = []

        return _toast_html(f"Split into {len(pages)} notebooks!")
    except Exception as exc:
        return _toast_html(f"Split failed: {exc}", error=True)


def _toast_html(message: str, *, error: bool = False) -> HTMLResponse:
    toast_id = uuid.uuid4().hex[:8]
    return HTMLResponse(
        templates.get_template("partials/toast.html").render(
            id=toast_id, message=message
        )
    )


# ── Entrypoint ────────────────────────────────────────────────────────

def main():
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=True)


if __name__ == "__main__":
    main()
