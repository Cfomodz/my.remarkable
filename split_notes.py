"""Split a multi-page reMarkable notebook zip into individual single-page zips.

reMarkable notebook .zip structure:
  <uuid>.content              JSON with page list, file type, etc.
  <uuid>/<pageId>.rm          raw stroke data for each page
  <uuid>.metadata             optional metadata
  <uuid>.pagedata             optional per-page template info (one line per page)
"""

from __future__ import annotations

import io
import json
import uuid
import zipfile


def split_notebook(
    zip_bytes: bytes,
    doc_name: str,
    parent_id: str,
) -> list[dict]:
    """Return a list of ``{id, visible_name, parent_id, zip_bytes}`` dicts,
    one per page in the original notebook."""

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        content_file = next(
            (n for n in zf.namelist() if n.endswith(".content")),
            None,
        )
        if content_file is None:
            raise ValueError("No .content file found in notebook zip")

        doc_id = content_file.removesuffix(".content")
        content_json = json.loads(zf.read(content_file))

        # Ordered page IDs — handle both legacy and newer cPages formats
        c_pages = content_json.get("cPages", {})
        if c_pages and "pages" in c_pages:
            page_ids = [p["id"] for p in c_pages["pages"]]
        else:
            page_ids = content_json.get("pages", [])

        if len(page_ids) <= 1:
            raise ValueError("Notebook has only one page — nothing to split.")

        # Per-page template strings
        pagedata_path = f"{doc_id}.pagedata"
        page_templates: list[str] = []
        if pagedata_path in zf.namelist():
            page_templates = zf.read(pagedata_path).decode().strip().split("\n")

        results: list[dict] = []

        for i, page_id in enumerate(page_ids):
            new_id = str(uuid.uuid4())
            buf = io.BytesIO()

            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as new_zf:
                # .content — single-page version
                new_content = {**content_json, "pages": [page_id], "pageCount": 1}
                if c_pages and "pages" in c_pages:
                    new_content["cPages"] = {
                        **c_pages,
                        "pages": [c_pages["pages"][i]],
                    }
                new_zf.writestr(f"{new_id}.content", json.dumps(new_content))

                # Copy all files belonging to this page
                prefix = f"{doc_id}/{page_id}"
                for entry in zf.namelist():
                    if entry.startswith(prefix) and not entry.endswith("/"):
                        data = zf.read(entry)
                        rel = entry.replace(f"{doc_id}/", f"{new_id}/", 1)
                        new_zf.writestr(rel, data)

                # Per-page template
                if i < len(page_templates) and page_templates[i]:
                    new_zf.writestr(f"{new_id}.pagedata", page_templates[i] + "\n")

            results.append(
                {
                    "id": new_id,
                    "visible_name": f"{doc_name} — Page {i + 1}",
                    "parent_id": parent_id,
                    "zip_bytes": buf.getvalue(),
                }
            )

    return results
