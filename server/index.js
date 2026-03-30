import "dotenv/config";
import express from "express";
import cors from "cors";
import { RemarkableClient } from "./remarkable-client.js";
import { splitNotebook } from "./split-notes.js";

const app = express();
app.use(cors());
app.use(express.json());

const client = new RemarkableClient();

// --- Auth ---

app.get("/api/status", (_req, res) => {
  res.json({ registered: client.isRegistered(), hasToken: !!client.userToken });
});

app.post("/api/register", async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: "Missing one-time code" });
    await client.register(code.trim());
    await client.refreshToken();
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/refresh", async (_req, res) => {
  try {
    await client.refreshToken();
    res.json({ ok: true });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// --- Documents ---

app.get("/api/docs", async (_req, res) => {
  try {
    await client._ensureAuth();
    const items = await client.listItems();
    res.json(items);
  } catch (err) {
    if (err.response?.status === 401) {
      // Token expired, try refresh
      try {
        await client.refreshToken();
        const items = await client.listItems();
        return res.json(items);
      } catch {
        // fall through
      }
    }
    res.status(500).json({ error: err.message });
  }
});

// --- Split Notes ---

app.post("/api/split-notes", async (req, res) => {
  try {
    const { documentId } = req.body;
    if (!documentId) return res.status(400).json({ error: "Missing documentId" });

    await client._ensureAuth();

    // Find the document in the listing
    const items = await client.listItems();
    const doc = items.find((d) => d.ID === documentId);
    if (!doc) return res.status(404).json({ error: "Document not found" });
    if (!doc.BlobURLGet) return res.status(400).json({ error: "No download URL available" });

    // Download the notebook zip
    const zipBuffer = await client.downloadDocument(doc.BlobURLGet);

    // Split into individual pages
    const pages = await splitNotebook(zipBuffer, doc.VissibleName || doc.visibleName, doc.Parent || "");

    // Upload each page as a new document
    const uploaded = [];
    for (const page of pages) {
      // Request upload slot
      const [uploadInfo] = await client.uploadRequest([
        {
          ID: page.id,
          Type: "DocumentType",
          Version: 1,
        },
      ]);

      // Upload the zip blob
      await client.uploadBlob(uploadInfo.BlobURLPut, page.zipBuffer);

      // Update metadata so it shows up in the library
      await client.updateMetadata([
        {
          ID: page.id,
          Type: "DocumentType",
          Version: 1,
          VissibleName: page.visibleName,
          Parent: page.parentId,
          ModifiedClient: new Date().toISOString(),
        },
      ]);

      uploaded.push({ id: page.id, visibleName: page.visibleName });
    }

    res.json({ ok: true, pages: uploaded, count: uploaded.length });
  } catch (err) {
    console.error("Split notes error:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[server] reMarkable API proxy on http://localhost:${PORT}`);
  console.log(`[server] registered: ${client.isRegistered()}`);
});
