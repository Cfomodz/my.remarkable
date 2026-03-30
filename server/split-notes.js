import { randomUUID } from "crypto";
import JSZip from "jszip";

// reMarkable notebook .zip structure:
// <uuid>.content    — JSON with page list, file type, etc.
// <uuid>/<pageId>.rm   — raw stroke data for each page
// <uuid>.metadata   — optional metadata
// <uuid>.pagedata   — optional per-page template info

// Split a multi-page notebook zip into N single-page notebook zips.
// Returns array of { id, visibleName, parentId, zipBuffer }
export async function splitNotebook(zipBuffer, docName, parentId) {
  const zip = await JSZip.loadAsync(zipBuffer);

  // Find the .content file to get the page list
  const contentFile = Object.keys(zip.files).find((f) => f.endsWith(".content"));
  if (!contentFile) throw new Error("No .content file found in notebook zip");

  const docId = contentFile.replace(".content", "");
  const contentJson = JSON.parse(await zip.file(contentFile).async("string"));

  // Get ordered page IDs
  const pageIds = contentJson.cPages?.pages?.map((p) => p.id) ?? contentJson.pages ?? [];
  if (pageIds.length <= 1) {
    throw new Error("Notebook has only one page — nothing to split.");
  }

  // Read pagedata if it exists (one line per page, specifying template)
  let pageTemplates = [];
  const pagedataFile = `${docId}.pagedata`;
  if (zip.files[pagedataFile]) {
    const raw = await zip.file(pagedataFile).async("string");
    pageTemplates = raw.trim().split("\n");
  }

  const results = [];

  for (let i = 0; i < pageIds.length; i++) {
    const pageId = pageIds[i];
    const newId = randomUUID();
    const newZip = new JSZip();

    // Build new .content with single page
    const newContent = {
      ...contentJson,
      pages: [pageId],
      pageCount: 1,
    };
    // Handle newer cPages format
    if (contentJson.cPages) {
      newContent.cPages = {
        ...contentJson.cPages,
        pages: [contentJson.cPages.pages[i]],
      };
    }
    newZip.file(`${newId}.content`, JSON.stringify(newContent));

    // Copy the page's .rm stroke file
    const rmPath = `${docId}/${pageId}.rm`;
    if (zip.files[rmPath]) {
      const rmData = await zip.file(rmPath).async("uint8array");
      newZip.file(`${newId}/${pageId}.rm`, rmData);
    }

    // Copy any page-specific metadata (-metadata.json)
    const pageMetaPath = `${docId}/${pageId}-metadata.json`;
    if (zip.files[pageMetaPath]) {
      const metaData = await zip.file(pageMetaPath).async("string");
      newZip.file(`${newId}/${pageId}-metadata.json`, metaData);
    }

    // Copy any highlights/layers
    for (const filePath of Object.keys(zip.files)) {
      if (filePath.startsWith(`${docId}/${pageId}`) && !zip.files[filePath].dir) {
        const relPath = filePath.replace(`${docId}/`, `${newId}/`);
        if (!newZip.files[relPath]) {
          const data = await zip.file(filePath).async("uint8array");
          newZip.file(relPath, data);
        }
      }
    }

    // Build pagedata for single page
    if (pageTemplates[i]) {
      newZip.file(`${newId}.pagedata`, pageTemplates[i] + "\n");
    }

    const pageName = `${docName} — Page ${i + 1}`;
    const zipBuf = await newZip.generateAsync({ type: "nodebuffer" });

    results.push({
      id: newId,
      visibleName: pageName,
      parentId,
      zipBuffer: zipBuf,
    });
  }

  return results;
}
