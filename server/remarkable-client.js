import axios from "axios";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.join(__dirname, ".device-token");

const AUTH_HOST = "https://webapp-production-dot-remarkable-production.appspot.com";
const SYNC_HOST = "https://internal.cloud.remarkable.com";

// reMarkable Cloud API client
// Handles: device registration, auth token refresh, document listing, download, upload
export class RemarkableClient {
  constructor() {
    this.deviceToken = null;
    this.userToken = null;
    this.storageHost = null;
    this._loadDeviceToken();
  }

  _loadDeviceToken() {
    // Check env first, then file
    if (process.env.REMARKABLE_DEVICE_TOKEN) {
      this.deviceToken = process.env.REMARKABLE_DEVICE_TOKEN;
      return;
    }
    try {
      this.deviceToken = fs.readFileSync(TOKEN_FILE, "utf-8").trim();
    } catch {
      // No saved token
    }
  }

  _saveDeviceToken(token) {
    this.deviceToken = token;
    fs.writeFileSync(TOKEN_FILE, token, "utf-8");
  }

  isRegistered() {
    return !!this.deviceToken;
  }

  // Step 1: Register device with one-time code from https://my.remarkable.com/device/browser/connect
  async register(oneTimeCode) {
    const resp = await axios.post(
      `${AUTH_HOST}/token/json/2/device/new`,
      {
        code: oneTimeCode,
        deviceDesc: "browser-chrome",
        deviceID: randomUUID(),
      },
      { headers: { "Content-Type": "application/json" } }
    );
    this._saveDeviceToken(resp.data);
    return true;
  }

  // Step 2: Exchange device token for a short-lived user token
  async refreshToken() {
    if (!this.deviceToken) throw new Error("Not registered. Provide a one-time code first.");
    const resp = await axios.post(
      `${AUTH_HOST}/token/json/2/user/new`,
      null,
      { headers: { Authorization: `Bearer ${this.deviceToken}` } }
    );
    this.userToken = resp.data;
    return this.userToken;
  }

  async _ensureAuth() {
    if (!this.userToken) await this.refreshToken();
  }

  _headers() {
    return { Authorization: `Bearer ${this.userToken}` };
  }

  // Discover storage host
  async _getStorageHost() {
    if (this.storageHost) return this.storageHost;
    await this._ensureAuth();
    try {
      const resp = await axios.get(
        `${SYNC_HOST}/service/json/1/document-storage?environment=production&group=auth0%7C5a68dc51cb30df3877a1d7c4&apiVer=2`,
        { headers: this._headers() }
      );
      this.storageHost = `https://${resp.data.Host}`;
    } catch {
      // Fallback to known endpoint
      this.storageHost = "https://document-storage-production-dot-remarkable-production.appspot.com";
    }
    return this.storageHost;
  }

  // List all documents and folders (flat list)
  async listItems() {
    await this._ensureAuth();
    const host = await this._getStorageHost();
    const resp = await axios.get(`${host}/document-storage/json/2/docs`, {
      headers: this._headers(),
      params: { withBlob: true },
    });
    return resp.data;
  }

  // Download a document's zip blob
  async downloadDocument(blobUrl) {
    const resp = await axios.get(blobUrl, { responseType: "arraybuffer" });
    return Buffer.from(resp.data);
  }

  // Upload/update documents — used for split notes
  async uploadRequest(items) {
    await this._ensureAuth();
    const host = await this._getStorageHost();
    const resp = await axios.put(
      `${host}/document-storage/json/2/upload/request`,
      items,
      { headers: { ...this._headers(), "Content-Type": "application/json" } }
    );
    return resp.data;
  }

  async uploadBlob(uploadUrl, data) {
    await axios.put(uploadUrl, data, {
      headers: { "Content-Type": "application/octet-stream" },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
  }

  async updateMetadata(items) {
    await this._ensureAuth();
    const host = await this._getStorageHost();
    await axios.put(
      `${host}/document-storage/json/2/upload/update-status`,
      items,
      { headers: { ...this._headers(), "Content-Type": "application/json" } }
    );
  }

  // Delete a document
  async deleteDocument(id, version) {
    await this._ensureAuth();
    const host = await this._getStorageHost();
    await axios.put(
      `${host}/document-storage/json/2/delete`,
      [{ ID: id, Version: version }],
      { headers: { ...this._headers(), "Content-Type": "application/json" } }
    );
  }
}
