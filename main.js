"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => LqssblogPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  blogUrl: "https://lqssblog.serveblog.net",
  username: "",
  password: "",
  syncFolder: "blog",
  token: "",
  defaultZone: "ANIME",
  defaultVisibility: "LOGIN_ONLY",
  defaultPublished: false
};
var ZONE_SUBFOLDER = {
  ANIME: "2",
  REAL: "3",
  FOUR: "4"
};
var LqssblogPlugin = class extends import_obsidian.Plugin {
  async onload() {
    await this.loadSettings();
    this.addRibbonIcon("cloud", "lqssblog Sync", () => {
      new SyncModal(this.app, this).open();
    });
    this.addCommand({
      id: "push-current-note",
      name: "\u63A8\u9001\u5F53\u524D\u7B14\u8BB0\u5230\u535A\u5BA2",
      callback: () => {
        const file = this.app.workspace.getActiveFile();
        if (file) this.pushNote(file);
        else new import_obsidian.Notice("lqssblog: \u6CA1\u6709\u6253\u5F00\u7684\u7B14\u8BB0");
      }
    });
    this.addCommand({
      id: "pull-all-posts",
      name: "\u4ECE\u535A\u5BA2\u62C9\u53D6\u5168\u90E8\u6587\u7AE0",
      callback: () => this.pullAllPosts()
    });
    this.addCommand({
      id: "sync-all",
      name: "\u4E0E\u535A\u5BA2\u5168\u91CF\u53CC\u5411\u540C\u6B65",
      callback: () => this.syncAll()
    });
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof import_obsidian.TFile && file.extension === "md") {
          menu.addItem((item) => {
            item.setTitle("\u63A8\u9001\u5230 lqssblog").setIcon("upload-cloud").onClick(() => this.pushNote(file));
          });
        }
      })
    );
    this.addSettingTab(new LqssblogSettingTab(this.app, this));
  }
  onunload() {
  }
  // ===== Auth =====
  async login() {
    var _a, _b, _c;
    if (!this.settings.username || !this.settings.password) {
      return { ok: false, reason: "\u7528\u6237\u540D\u6216\u5BC6\u7801\u672A\u586B\u5199" };
    }
    let resp;
    try {
      resp = await (0, import_obsidian.requestUrl)({
        url: `${this.settings.blogUrl}/api/auth/login`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: this.settings.username,
          password: this.settings.password
        }),
        throw: false
      });
    } catch (e) {
      return { ok: false, reason: `\u7F51\u7EDC\u9519\u8BEF: ${String(e)}` };
    }
    if (resp.status !== 200) {
      let msg = "";
      try {
        msg = (_b = (_a = resp.json) == null ? void 0 : _a.error) != null ? _b : resp.text;
      } catch (e) {
        msg = String(resp.status);
      }
      return { ok: false, reason: `HTTP ${resp.status}: ${msg}` };
    }
    let token;
    try {
      token = (_c = resp.json) == null ? void 0 : _c.token;
    } catch (e) {
    }
    if (!token) {
      return { ok: false, reason: "\u54CD\u5E94\u4E2D\u6CA1\u6709 token \u5B57\u6BB5" };
    }
    this.settings.token = token;
    await this.saveSettings();
    return { ok: true, reason: "\u767B\u5F55\u6210\u529F" };
  }
  getHeaders() {
    return {
      "Content-Type": "application/json",
      Cookie: `token=${this.settings.token}`
    };
  }
  // Auto-retry with re-login on 401
  async apiReq(options, retried = false) {
    var _a;
    const resp = await (0, import_obsidian.requestUrl)({
      ...options,
      headers: { ...this.getHeaders(), ...(_a = options.headers) != null ? _a : {} },
      throw: false
    });
    if (resp.status === 401 && !retried) {
      const { ok } = await this.login();
      if (ok) return this.apiReq(options, true);
    }
    return resp;
  }
  // ===== API =====
  async fetchMyPosts() {
    var _a;
    const resp = await this.apiReq({
      url: `${this.settings.blogUrl}/api/user/posts`
    });
    if (resp.status !== 200) return [];
    return (_a = resp.json.posts) != null ? _a : [];
  }
  async createPost(data) {
    var _a, _b;
    const resp = await this.apiReq({
      url: `${this.settings.blogUrl}/api/posts`,
      method: "POST",
      body: JSON.stringify(data)
    });
    if (resp.status !== 201) {
      let msg = "";
      try {
        msg = (_b = (_a = resp.json) == null ? void 0 : _a.error) != null ? _b : "";
      } catch (e) {
      }
      return { error: `HTTP ${resp.status}${msg ? ": " + msg : ""}` };
    }
    return { post: resp.json.post };
  }
  async updatePost(id, data) {
    var _a, _b;
    const resp = await this.apiReq({
      url: `${this.settings.blogUrl}/api/posts/${id}`,
      method: "PUT",
      body: JSON.stringify(data)
    });
    if (resp.status === 200) return { ok: true };
    let msg = "";
    try {
      msg = (_b = (_a = resp.json) == null ? void 0 : _a.error) != null ? _b : "";
    } catch (e) {
    }
    return { ok: false, error: `HTTP ${resp.status}${msg ? ": " + msg : ""}` };
  }
  // ===== Core Sync =====
  /** Detect zone from file path (blog/2/ → ANIME, blog/3/ → REAL, blog/4/ → FOUR). */
  detectZoneFromPath(filePath) {
    for (const [zone, sub] of Object.entries(ZONE_SUBFOLDER)) {
      if (filePath.startsWith(`${this.settings.syncFolder}/${sub}/`)) {
        return zone;
      }
    }
    return null;
  }
  /** Push a single note. Zone priority: frontmatter > file path > settings default. */
  async pushNote(file) {
    var _a, _b, _c, _d;
    if (!this.settings.username || !this.settings.password) {
      new import_obsidian.Notice("lqssblog: \u8BF7\u5148\u5728\u63D2\u4EF6\u8BBE\u7F6E\u91CC\u586B\u5199\u7528\u6237\u540D\u548C\u5BC6\u7801");
      return;
    }
    const fm = (_b = (_a = this.app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter) != null ? _b : {};
    const zone = (_d = (_c = fm["blog-zone"]) != null ? _c : this.detectZoneFromPath(file.path)) != null ? _d : this.settings.defaultZone;
    await this.doPush(file, fm, fm["blog-id"], zone);
  }
  /** Actually push the note (called after zone is confirmed). */
  async doPush(file, fm, blogId, zone) {
    var _a, _b, _c;
    const rawContent = await this.app.vault.read(file);
    const body = stripFrontmatter(rawContent);
    const title = fm["title"] || file.basename;
    const visibility = fm["blog-visibility"] || this.settings.defaultVisibility;
    const published = (_a = fm["blog-published"]) != null ? _a : this.settings.defaultPublished;
    const tags = parseTags(fm["tags"]);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const data = { title, content: body, zone, visibility, published, tags };
    if (blogId) {
      const result = await this.updatePost(blogId, data);
      if (!result.ok) {
        new import_obsidian.Notice(`lqssblog: \u2717 \u66F4\u65B0\u5931\u8D25 \u2014\u300C${title}\u300D
${(_b = result.error) != null ? _b : ""}`, 8e3);
        return false;
      }
    } else {
      const result = await this.createPost(data);
      if (!result.post) {
        new import_obsidian.Notice(`lqssblog: \u2717 \u53D1\u5E03\u5931\u8D25 \u2014\u300C${title}\u300D
${(_c = result.error) != null ? _c : ""}`, 8e3);
        return false;
      }
      blogId = result.post.id;
    }
    await this.app.fileManager.processFrontMatter(file, (f) => {
      f["blog-id"] = blogId;
      f["blog-zone"] = zone;
      f["blog-visibility"] = visibility;
      f["blog-published"] = published;
      f["blog-synced-at"] = now;
      f["blog-updated-at"] = now;
    });
    new import_obsidian.Notice(`lqssblog: \u2713 \u5DF2\u63A8\u9001\u300C${title}\u300D${published ? "" : "\uFF08\u8349\u7A3F\uFF09"}`);
    return true;
  }
  /** Pull all user's posts from the blog into the sync folder. */
  async pullAllPosts() {
    var _a, _b;
    if (!this.settings.username || !this.settings.password) {
      new import_obsidian.Notice("lqssblog: \u8BF7\u5148\u5728\u63D2\u4EF6\u8BBE\u7F6E\u91CC\u586B\u5199\u7528\u6237\u540D\u548C\u5BC6\u7801");
      return;
    }
    new import_obsidian.Notice("lqssblog: \u6B63\u5728\u62C9\u53D6\u2026");
    const posts = await this.fetchMyPosts();
    if (!posts.length) {
      new import_obsidian.Notice("lqssblog: \u535A\u5BA2\u4E0A\u8FD8\u6CA1\u6709\u6587\u7AE0");
      return;
    }
    await this.ensureSyncFolder();
    let pulled = 0, skipped = 0;
    for (const post of posts) {
      const existing = this.findFileByBlogId(post.id);
      const syncedAt = existing ? (_b = (_a = this.app.metadataCache.getFileCache(existing)) == null ? void 0 : _a.frontmatter) == null ? void 0 : _b["blog-synced-at"] : void 0;
      const blogUpdatedAt = new Date(post.updatedAt).getTime();
      const lastSyncTime = syncedAt ? new Date(syncedAt).getTime() : 0;
      if (existing && blogUpdatedAt <= lastSyncTime) {
        skipped++;
        continue;
      }
      const content = buildNoteContent(post);
      if (existing) {
        await this.app.vault.modify(existing, content);
      } else {
        const path = await this.uniquePath(
          `${this.zoneFolder(post.zone)}/${safeFilename(post.title) || post.id}.md`
        );
        await this.app.vault.create(path, content);
      }
      pulled++;
    }
    new import_obsidian.Notice(`lqssblog: \u62C9\u53D6\u5B8C\u6210 \u2014\u2014 \u66F4\u65B0 ${pulled} \u7BC7\uFF0C\u8DF3\u8FC7 ${skipped} \u7BC7`);
  }
  /** Full bidirectional sync. */
  async syncAll() {
    var _a, _b, _c, _d;
    if (!this.settings.username || !this.settings.password) {
      new import_obsidian.Notice("lqssblog: \u8BF7\u5148\u5728\u63D2\u4EF6\u8BBE\u7F6E\u91CC\u586B\u5199\u7528\u6237\u540D\u548C\u5BC6\u7801");
      return;
    }
    const allFiles = this.app.vault.getMarkdownFiles();
    const withMeta = allFiles.filter((f) => {
      var _a2;
      const fm = (_a2 = this.app.metadataCache.getFileCache(f)) == null ? void 0 : _a2.frontmatter;
      return (fm == null ? void 0 : fm["blog-id"]) || (fm == null ? void 0 : fm["blog-zone"]) || this.detectZoneFromPath(f.path);
    });
    new import_obsidian.Notice(`lqssblog: \u5F00\u59CB\u540C\u6B65\u2026 \u626B\u63CF\u5230 ${withMeta.length} \u7BC7\u5173\u8054\u7B14\u8BB0`, 4e3);
    const posts = await this.fetchMyPosts();
    const blogMap = new Map(posts.map((p) => [p.id, p]));
    await this.ensureSyncFolder();
    let pushed = 0, pulled = 0, conflicts = 0, created = 0, upToDate = 0;
    const processedIds = /* @__PURE__ */ new Set();
    const BUFFER = 5e3;
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = (_b = (_a = this.app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter) != null ? _b : {};
      const blogId = fm["blog-id"];
      if (!blogId) {
        const detectedZone = (_c = fm["blog-zone"]) != null ? _c : this.detectZoneFromPath(file.path);
        const inSyncFolder = file.path.startsWith(this.settings.syncFolder + "/");
        if (detectedZone && (inSyncFolder || fm["blog-zone"])) {
          const ok = await this.doPush(file, fm, void 0, detectedZone);
          if (ok) created++;
        }
        continue;
      }
      processedIds.add(blogId);
      const blogPost = blogMap.get(blogId);
      if (!blogPost) continue;
      const syncedAt = fm["blog-synced-at"];
      const lastSyncTime = syncedAt ? new Date(syncedAt).getTime() : 0;
      const blogUpdatedAt = new Date(blogPost.updatedAt).getTime();
      const localUpdatedAt = file.stat.mtime;
      const blogNewer = blogUpdatedAt > lastSyncTime + BUFFER;
      const localNewer = localUpdatedAt > lastSyncTime + BUFFER;
      if (blogNewer && localNewer) {
        conflicts++;
        new import_obsidian.Notice(`lqssblog: \u26A0 \u51B2\u7A81 \u2014\u300C${file.basename}\u300D\u672C\u5730\u548C\u8FDC\u7AEF\u90FD\u6709\u66F4\u6539\uFF0C\u5DF2\u8DF3\u8FC7`);
        continue;
      }
      if (localNewer) {
        const zone = (_d = fm["blog-zone"]) != null ? _d : blogPost.zone;
        const ok = await this.doPush(file, fm, blogId, zone);
        if (ok) pushed++;
      } else if (blogNewer) {
        await this.app.vault.modify(file, buildNoteContent(blogPost));
        pulled++;
      } else {
        upToDate++;
      }
    }
    for (const post of posts) {
      if (processedIds.has(post.id)) continue;
      const path = await this.uniquePath(
        `${this.zoneFolder(post.zone)}/${safeFilename(post.title) || post.id}.md`
      );
      await this.app.vault.create(path, buildNoteContent(post));
      pulled++;
    }
    const summary = [
      `\u2191 ${pushed + created}`,
      `\u2193 ${pulled}`,
      upToDate ? `\u2713 ${upToDate} \u5DF2\u662F\u6700\u65B0` : "",
      conflicts ? `\u26A0 ${conflicts} \u51B2\u7A81` : ""
    ].filter(Boolean).join("   ");
    new import_obsidian.Notice(`lqssblog: \u540C\u6B65\u5B8C\u6210 \u2014\u2014 ${summary}`);
  }
  // ===== Helpers =====
  findFileByBlogId(blogId) {
    var _a;
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = (_a = this.app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter;
      if ((fm == null ? void 0 : fm["blog-id"]) === blogId) return file;
    }
    return null;
  }
  zoneFolder(zone) {
    return `${this.settings.syncFolder}/${ZONE_SUBFOLDER[zone]}`;
  }
  async ensureSyncFolder() {
    const root = this.settings.syncFolder;
    if (!await this.app.vault.adapter.exists(root)) {
      await this.app.vault.createFolder(root);
    }
    for (const sub of Object.values(ZONE_SUBFOLDER)) {
      const path = `${root}/${sub}`;
      if (!await this.app.vault.adapter.exists(path)) {
        await this.app.vault.createFolder(path);
      }
    }
  }
  async uniquePath(path) {
    if (!await this.app.vault.adapter.exists(path)) return path;
    const base = path.replace(/\.md$/, "");
    let i = 1;
    while (await this.app.vault.adapter.exists(`${base}-${i}.md`)) i++;
    return `${base}-${i}.md`;
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
var SyncModal = class extends import_obsidian.Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("lqss-modal");
    contentEl.createEl("h3", { text: "lqssblog Sync" });
    const grid = contentEl.createDiv({ cls: "lqss-grid" });
    this.btn(grid, "\u2191", "\u63A8\u9001\u5F53\u524D\u7B14\u8BB0", "upload-cloud", () => {
      const file = this.app.workspace.getActiveFile();
      if (file) this.plugin.pushNote(file);
      else new import_obsidian.Notice("lqssblog: \u6CA1\u6709\u6253\u5F00\u7684\u7B14\u8BB0");
    });
    this.btn(grid, "\u2193", "\u62C9\u53D6\u5168\u90E8\u6587\u7AE0", "download-cloud", () => {
      this.plugin.pullAllPosts();
    });
    this.btn(grid, "\u21C5", "\u5168\u91CF\u53CC\u5411\u540C\u6B65", "refresh-cw", () => {
      this.plugin.syncAll();
    });
  }
  btn(parent, icon, label, _lucide, onClick) {
    const btn = parent.createEl("button", { cls: "lqss-action-btn" });
    btn.createEl("span", { cls: "lqss-btn-icon", text: icon });
    btn.createEl("span", { cls: "lqss-btn-label", text: label });
    btn.onclick = () => {
      this.close();
      onClick();
    };
  }
  onClose() {
    this.contentEl.empty();
  }
};
var LqssblogSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "lqssblog Sync" });
    new import_obsidian.Setting(containerEl).setName("\u535A\u5BA2\u5730\u5740").setDesc("\u4E0D\u542B\u672B\u5C3E\u659C\u7EBF\uFF0C\u4F8B\u5982 https://lqssblog.serveblog.net").addText(
      (t) => t.setPlaceholder("https://lqssblog.serveblog.net").setValue(this.plugin.settings.blogUrl).onChange(async (v) => {
        this.plugin.settings.blogUrl = v.replace(/\/$/, "");
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u7528\u6237\u540D").addText(
      (t) => t.setPlaceholder("your-username").setValue(this.plugin.settings.username).onChange(async (v) => {
        this.plugin.settings.username = v.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u5BC6\u7801").addText((t) => {
      t.inputEl.type = "password";
      t.setValue(this.plugin.settings.password).onChange(async (v) => {
        this.plugin.settings.password = v;
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian.Setting(containerEl).setName("\u540C\u6B65\u6839\u6587\u4EF6\u5939").setDesc("\u6587\u7AE0\u6309\u5206\u533A\u4FDD\u5B58\u5230\u5B50\u6587\u4EF6\u5939\uFF1Ablog/2 \xB7 blog/3 \xB7 blog/4").addText(
      (t) => t.setPlaceholder("blog").setValue(this.plugin.settings.syncFolder).onChange(async (v) => {
        this.plugin.settings.syncFolder = v.trim().replace(/\/$/, "");
        await this.plugin.saveSettings();
      })
    );
    containerEl.createEl("h3", { text: "\u63A8\u9001\u9ED8\u8BA4\u503C" });
    containerEl.createEl("p", {
      text: "\u63A8\u9001\u6CA1\u6709 frontmatter \u7684\u7B14\u8BB0\u65F6\u4F7F\u7528\u8FD9\u4E9B\u9ED8\u8BA4\u503C\uFF0C\u65E0\u9700\u624B\u52A8\u586B\u5199\u3002",
      cls: "setting-item-description"
    });
    new import_obsidian.Setting(containerEl).setName("\u9ED8\u8BA4\u5206\u533A").addDropdown((d) => {
      d.addOption("ANIME", "2");
      d.addOption("REAL", "3");
      d.addOption("FOUR", "4");
      d.setValue(this.plugin.settings.defaultZone).onChange(async (v) => {
        this.plugin.settings.defaultZone = v;
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian.Setting(containerEl).setName("\u9ED8\u8BA4\u53EF\u89C1\u6027").addDropdown((d) => {
      d.addOption("LOGIN_ONLY", "\u4EC5\u767B\u5F55\u7528\u6237");
      d.addOption("PUBLIC", "\u516C\u5F00");
      d.addOption("FRIENDS_ONLY", "\u4EC5\u597D\u53CB");
      d.setValue(this.plugin.settings.defaultVisibility).onChange(async (v) => {
        this.plugin.settings.defaultVisibility = v;
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian.Setting(containerEl).setName("\u9ED8\u8BA4\u76F4\u63A5\u53D1\u5E03").setDesc("\u5173\u95ED\u5219\u4FDD\u5B58\u4E3A\u8349\u7A3F").addToggle(
      (t) => t.setValue(this.plugin.settings.defaultPublished).onChange(async (v) => {
        this.plugin.settings.defaultPublished = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u6D4B\u8BD5\u8FDE\u63A5").setDesc("\u9A8C\u8BC1\u7528\u6237\u540D\u548C\u5BC6\u7801\u662F\u5426\u6B63\u786E").addButton(
      (btn) => btn.setButtonText("\u6D4B\u8BD5").onClick(async () => {
        btn.setButtonText("\u8FDE\u63A5\u4E2D\u2026").setDisabled(true);
        const { ok, reason } = await this.plugin.login();
        btn.setDisabled(false);
        if (ok) {
          btn.setButtonText("\u2713 \u6210\u529F");
          new import_obsidian.Notice("lqssblog: \u767B\u5F55\u6210\u529F");
        } else {
          btn.setButtonText("\u2717 \u5931\u8D25");
          new import_obsidian.Notice(`lqssblog: \u767B\u5F55\u5931\u8D25 \u2014 ${reason}`, 8e3);
        }
        setTimeout(() => btn.setButtonText("\u6D4B\u8BD5"), 4e3);
      })
    );
  }
};
function stripFrontmatter(content) {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return content;
  return content.slice(end + 4).trimStart();
}
function parseTags(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === "string")
    return raw.split(",").map((t) => t.trim()).filter(Boolean);
  return [];
}
function safeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, "-").trim().slice(0, 100);
}
function buildNoteContent(post) {
  const tags = post.tags.map((t) => t.tag.name);
  const lines = [
    "---",
    `title: "${post.title.replace(/"/g, '\\"')}"`,
    `blog-id: "${post.id}"`,
    `blog-zone: ${post.zone}`,
    `blog-visibility: ${post.visibility}`,
    `blog-published: ${post.published}`
  ];
  if (tags.length) {
    lines.push(`tags: [${tags.map((t) => `"${t}"`).join(", ")}]`);
  }
  lines.push(
    `blog-synced-at: "${(/* @__PURE__ */ new Date()).toISOString()}"`,
    `blog-updated-at: "${post.updatedAt}"`,
    "---",
    "",
    post.content
  );
  return lines.join("\n");
}
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7XG4gIEFwcCxcbiAgTW9kYWwsXG4gIE5vdGljZSxcbiAgUGx1Z2luLFxuICBQbHVnaW5TZXR0aW5nVGFiLFxuICBTZXR0aW5nLFxuICBURmlsZSxcbiAgcmVxdWVzdFVybCxcbiAgUmVxdWVzdFVybFBhcmFtLFxuICBSZXF1ZXN0VXJsUmVzcG9uc2UsXG59IGZyb20gXCJvYnNpZGlhblwiO1xuXG4vLyA9PT09PSBUeXBlcyA9PT09PVxuXG50eXBlIFpvbmUgPSBcIkFOSU1FXCIgfCBcIlJFQUxcIiB8IFwiRk9VUlwiO1xudHlwZSBWaXNpYmlsaXR5ID0gXCJQVUJMSUNcIiB8IFwiTE9HSU5fT05MWVwiIHwgXCJGUklFTkRTX09OTFlcIjtcblxuaW50ZXJmYWNlIEJsb2dQb3N0IHtcbiAgaWQ6IHN0cmluZztcbiAgdGl0bGU6IHN0cmluZztcbiAgY29udGVudDogc3RyaW5nO1xuICB6b25lOiBab25lO1xuICB2aXNpYmlsaXR5OiBWaXNpYmlsaXR5O1xuICBwdWJsaXNoZWQ6IGJvb2xlYW47XG4gIGNyZWF0ZWRBdDogc3RyaW5nO1xuICB1cGRhdGVkQXQ6IHN0cmluZztcbiAgdGFnczogeyB0YWc6IHsgbmFtZTogc3RyaW5nIH0gfVtdO1xufVxuXG5pbnRlcmZhY2UgTHFzc2Jsb2dTZXR0aW5ncyB7XG4gIGJsb2dVcmw6IHN0cmluZztcbiAgdXNlcm5hbWU6IHN0cmluZztcbiAgcGFzc3dvcmQ6IHN0cmluZztcbiAgc3luY0ZvbGRlcjogc3RyaW5nO1xuICB0b2tlbjogc3RyaW5nO1xuICBkZWZhdWx0Wm9uZTogWm9uZTtcbiAgZGVmYXVsdFZpc2liaWxpdHk6IFZpc2liaWxpdHk7XG4gIGRlZmF1bHRQdWJsaXNoZWQ6IGJvb2xlYW47XG59XG5cbmNvbnN0IERFRkFVTFRfU0VUVElOR1M6IExxc3NibG9nU2V0dGluZ3MgPSB7XG4gIGJsb2dVcmw6IFwiaHR0cHM6Ly9scXNzYmxvZy5zZXJ2ZWJsb2cubmV0XCIsXG4gIHVzZXJuYW1lOiBcIlwiLFxuICBwYXNzd29yZDogXCJcIixcbiAgc3luY0ZvbGRlcjogXCJibG9nXCIsXG4gIHRva2VuOiBcIlwiLFxuICBkZWZhdWx0Wm9uZTogXCJBTklNRVwiLFxuICBkZWZhdWx0VmlzaWJpbGl0eTogXCJMT0dJTl9PTkxZXCIsXG4gIGRlZmF1bHRQdWJsaXNoZWQ6IGZhbHNlLFxufTtcblxuY29uc3QgWk9ORV9TVUJGT0xERVI6IFJlY29yZDxab25lLCBzdHJpbmc+ID0ge1xuICBBTklNRTogXCIyXCIsXG4gIFJFQUw6IFwiM1wiLFxuICBGT1VSOiBcIjRcIixcbn07XG5cbi8vID09PT09IFBsdWdpbiA9PT09PVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBMcXNzYmxvZ1BsdWdpbiBleHRlbmRzIFBsdWdpbiB7XG4gIHNldHRpbmdzOiBMcXNzYmxvZ1NldHRpbmdzO1xuXG4gIGFzeW5jIG9ubG9hZCgpIHtcbiAgICBhd2FpdCB0aGlzLmxvYWRTZXR0aW5ncygpO1xuXG4gICAgLy8gUmliYm9uIGljb25cbiAgICB0aGlzLmFkZFJpYmJvbkljb24oXCJjbG91ZFwiLCBcImxxc3NibG9nIFN5bmNcIiwgKCkgPT4ge1xuICAgICAgbmV3IFN5bmNNb2RhbCh0aGlzLmFwcCwgdGhpcykub3BlbigpO1xuICAgIH0pO1xuXG4gICAgLy8gQ29tbWFuZHNcbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwicHVzaC1jdXJyZW50LW5vdGVcIixcbiAgICAgIG5hbWU6IFwiXHU2M0E4XHU5MDAxXHU1RjUzXHU1MjREXHU3QjE0XHU4QkIwXHU1MjMwXHU1MzVBXHU1QkEyXCIsXG4gICAgICBjYWxsYmFjazogKCkgPT4ge1xuICAgICAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKTtcbiAgICAgICAgaWYgKGZpbGUpIHRoaXMucHVzaE5vdGUoZmlsZSk7XG4gICAgICAgIGVsc2UgbmV3IE5vdGljZShcImxxc3NibG9nOiBcdTZDQTFcdTY3MDlcdTYyNTNcdTVGMDBcdTc2ODRcdTdCMTRcdThCQjBcIik7XG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcInB1bGwtYWxsLXBvc3RzXCIsXG4gICAgICBuYW1lOiBcIlx1NEVDRVx1NTM1QVx1NUJBMlx1NjJDOVx1NTNENlx1NTE2OFx1OTBFOFx1NjU4N1x1N0FFMFwiLFxuICAgICAgY2FsbGJhY2s6ICgpID0+IHRoaXMucHVsbEFsbFBvc3RzKCksXG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwic3luYy1hbGxcIixcbiAgICAgIG5hbWU6IFwiXHU0RTBFXHU1MzVBXHU1QkEyXHU1MTY4XHU5MUNGXHU1M0NDXHU1NDExXHU1NDBDXHU2QjY1XCIsXG4gICAgICBjYWxsYmFjazogKCkgPT4gdGhpcy5zeW5jQWxsKCksXG4gICAgfSk7XG5cbiAgICAvLyBSaWdodC1jbGljayBjb250ZXh0IG1lbnVcbiAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXG4gICAgICB0aGlzLmFwcC53b3Jrc3BhY2Uub24oXCJmaWxlLW1lbnVcIiwgKG1lbnUsIGZpbGUpID0+IHtcbiAgICAgICAgaWYgKGZpbGUgaW5zdGFuY2VvZiBURmlsZSAmJiBmaWxlLmV4dGVuc2lvbiA9PT0gXCJtZFwiKSB7XG4gICAgICAgICAgbWVudS5hZGRJdGVtKChpdGVtKSA9PiB7XG4gICAgICAgICAgICBpdGVtXG4gICAgICAgICAgICAgIC5zZXRUaXRsZShcIlx1NjNBOFx1OTAwMVx1NTIzMCBscXNzYmxvZ1wiKVxuICAgICAgICAgICAgICAuc2V0SWNvbihcInVwbG9hZC1jbG91ZFwiKVxuICAgICAgICAgICAgICAub25DbGljaygoKSA9PiB0aGlzLnB1c2hOb3RlKGZpbGUpKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICApO1xuXG4gICAgdGhpcy5hZGRTZXR0aW5nVGFiKG5ldyBMcXNzYmxvZ1NldHRpbmdUYWIodGhpcy5hcHAsIHRoaXMpKTtcbiAgfVxuXG4gIG9udW5sb2FkKCkge31cblxuICAvLyA9PT09PSBBdXRoID09PT09XG5cbiAgYXN5bmMgbG9naW4oKTogUHJvbWlzZTx7IG9rOiBib29sZWFuOyByZWFzb246IHN0cmluZyB9PiB7XG4gICAgaWYgKCF0aGlzLnNldHRpbmdzLnVzZXJuYW1lIHx8ICF0aGlzLnNldHRpbmdzLnBhc3N3b3JkKSB7XG4gICAgICByZXR1cm4geyBvazogZmFsc2UsIHJlYXNvbjogXCJcdTc1MjhcdTYyMzdcdTU0MERcdTYyMTZcdTVCQzZcdTc4MDFcdTY3MkFcdTU4NkJcdTUxOTlcIiB9O1xuICAgIH1cbiAgICBsZXQgcmVzcDogUmVxdWVzdFVybFJlc3BvbnNlO1xuICAgIHRyeSB7XG4gICAgICByZXNwID0gYXdhaXQgcmVxdWVzdFVybCh7XG4gICAgICAgIHVybDogYCR7dGhpcy5zZXR0aW5ncy5ibG9nVXJsfS9hcGkvYXV0aC9sb2dpbmAsXG4gICAgICAgIG1ldGhvZDogXCJQT1NUXCIsXG4gICAgICAgIGhlYWRlcnM6IHsgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIgfSxcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIHVzZXJuYW1lOiB0aGlzLnNldHRpbmdzLnVzZXJuYW1lLFxuICAgICAgICAgIHBhc3N3b3JkOiB0aGlzLnNldHRpbmdzLnBhc3N3b3JkLFxuICAgICAgICB9KSxcbiAgICAgICAgdGhyb3c6IGZhbHNlLFxuICAgICAgfSk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgcmV0dXJuIHsgb2s6IGZhbHNlLCByZWFzb246IGBcdTdGNTFcdTdFRENcdTk1MTlcdThCRUY6ICR7U3RyaW5nKGUpfWAgfTtcbiAgICB9XG5cbiAgICBpZiAocmVzcC5zdGF0dXMgIT09IDIwMCkge1xuICAgICAgbGV0IG1zZyA9IFwiXCI7XG4gICAgICB0cnkgeyBtc2cgPSByZXNwLmpzb24/LmVycm9yID8/IHJlc3AudGV4dDsgfSBjYXRjaCB7IG1zZyA9IFN0cmluZyhyZXNwLnN0YXR1cyk7IH1cbiAgICAgIHJldHVybiB7IG9rOiBmYWxzZSwgcmVhc29uOiBgSFRUUCAke3Jlc3Auc3RhdHVzfTogJHttc2d9YCB9O1xuICAgIH1cblxuICAgIGxldCB0b2tlbjogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICAgIHRyeSB7IHRva2VuID0gcmVzcC5qc29uPy50b2tlbjsgfSBjYXRjaCB7IC8qIGlnbm9yZSAqLyB9XG4gICAgaWYgKCF0b2tlbikge1xuICAgICAgcmV0dXJuIHsgb2s6IGZhbHNlLCByZWFzb246IFwiXHU1NENEXHU1RTk0XHU0RTJEXHU2Q0ExXHU2NzA5IHRva2VuIFx1NUI1N1x1NkJCNVwiIH07XG4gICAgfVxuXG4gICAgdGhpcy5zZXR0aW5ncy50b2tlbiA9IHRva2VuO1xuICAgIGF3YWl0IHRoaXMuc2F2ZVNldHRpbmdzKCk7XG4gICAgcmV0dXJuIHsgb2s6IHRydWUsIHJlYXNvbjogXCJcdTc2N0JcdTVGNTVcdTYyMTBcdTUyOUZcIiB9O1xuICB9XG5cbiAgZ2V0SGVhZGVycygpOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHtcbiAgICByZXR1cm4ge1xuICAgICAgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIsXG4gICAgICBDb29raWU6IGB0b2tlbj0ke3RoaXMuc2V0dGluZ3MudG9rZW59YCxcbiAgICB9O1xuICB9XG5cbiAgLy8gQXV0by1yZXRyeSB3aXRoIHJlLWxvZ2luIG9uIDQwMVxuICBhc3luYyBhcGlSZXEoXG4gICAgb3B0aW9uczogUmVxdWVzdFVybFBhcmFtLFxuICAgIHJldHJpZWQgPSBmYWxzZVxuICApOiBQcm9taXNlPFJlcXVlc3RVcmxSZXNwb25zZT4ge1xuICAgIGNvbnN0IHJlc3AgPSBhd2FpdCByZXF1ZXN0VXJsKHtcbiAgICAgIC4uLm9wdGlvbnMsXG4gICAgICBoZWFkZXJzOiB7IC4uLnRoaXMuZ2V0SGVhZGVycygpLCAuLi4ob3B0aW9ucy5oZWFkZXJzID8/IHt9KSB9LFxuICAgICAgdGhyb3c6IGZhbHNlLFxuICAgIH0pO1xuICAgIGlmIChyZXNwLnN0YXR1cyA9PT0gNDAxICYmICFyZXRyaWVkKSB7XG4gICAgICBjb25zdCB7IG9rIH0gPSBhd2FpdCB0aGlzLmxvZ2luKCk7XG4gICAgICBpZiAob2spIHJldHVybiB0aGlzLmFwaVJlcShvcHRpb25zLCB0cnVlKTtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3A7XG4gIH1cblxuICAvLyA9PT09PSBBUEkgPT09PT1cblxuICBhc3luYyBmZXRjaE15UG9zdHMoKTogUHJvbWlzZTxCbG9nUG9zdFtdPiB7XG4gICAgY29uc3QgcmVzcCA9IGF3YWl0IHRoaXMuYXBpUmVxKHtcbiAgICAgIHVybDogYCR7dGhpcy5zZXR0aW5ncy5ibG9nVXJsfS9hcGkvdXNlci9wb3N0c2AsXG4gICAgfSk7XG4gICAgaWYgKHJlc3Auc3RhdHVzICE9PSAyMDApIHJldHVybiBbXTtcbiAgICByZXR1cm4gKHJlc3AuanNvbiBhcyB7IHBvc3RzOiBCbG9nUG9zdFtdIH0pLnBvc3RzID8/IFtdO1xuICB9XG5cbiAgYXN5bmMgY3JlYXRlUG9zdChkYXRhOiB7XG4gICAgdGl0bGU6IHN0cmluZztcbiAgICBjb250ZW50OiBzdHJpbmc7XG4gICAgem9uZTogWm9uZTtcbiAgICB2aXNpYmlsaXR5OiBWaXNpYmlsaXR5O1xuICAgIHB1Ymxpc2hlZDogYm9vbGVhbjtcbiAgICB0YWdzOiBzdHJpbmdbXTtcbiAgfSk6IFByb21pc2U8eyBwb3N0PzogQmxvZ1Bvc3Q7IGVycm9yPzogc3RyaW5nIH0+IHtcbiAgICBjb25zdCByZXNwID0gYXdhaXQgdGhpcy5hcGlSZXEoe1xuICAgICAgdXJsOiBgJHt0aGlzLnNldHRpbmdzLmJsb2dVcmx9L2FwaS9wb3N0c2AsXG4gICAgICBtZXRob2Q6IFwiUE9TVFwiLFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoZGF0YSksXG4gICAgfSk7XG4gICAgaWYgKHJlc3Auc3RhdHVzICE9PSAyMDEpIHtcbiAgICAgIGxldCBtc2cgPSBcIlwiO1xuICAgICAgdHJ5IHsgbXNnID0gcmVzcC5qc29uPy5lcnJvciA/PyBcIlwiOyB9IGNhdGNoIHsgLyogaWdub3JlICovIH1cbiAgICAgIHJldHVybiB7IGVycm9yOiBgSFRUUCAke3Jlc3Auc3RhdHVzfSR7bXNnID8gXCI6IFwiICsgbXNnIDogXCJcIn1gIH07XG4gICAgfVxuICAgIHJldHVybiB7IHBvc3Q6IChyZXNwLmpzb24gYXMgeyBwb3N0OiBCbG9nUG9zdCB9KS5wb3N0IH07XG4gIH1cblxuICBhc3luYyB1cGRhdGVQb3N0KFxuICAgIGlkOiBzdHJpbmcsXG4gICAgZGF0YToge1xuICAgICAgdGl0bGU6IHN0cmluZztcbiAgICAgIGNvbnRlbnQ6IHN0cmluZztcbiAgICAgIHpvbmU6IFpvbmU7XG4gICAgICB2aXNpYmlsaXR5OiBWaXNpYmlsaXR5O1xuICAgICAgcHVibGlzaGVkOiBib29sZWFuO1xuICAgICAgdGFnczogc3RyaW5nW107XG4gICAgfVxuICApOiBQcm9taXNlPHsgb2s6IGJvb2xlYW47IGVycm9yPzogc3RyaW5nIH0+IHtcbiAgICBjb25zdCByZXNwID0gYXdhaXQgdGhpcy5hcGlSZXEoe1xuICAgICAgdXJsOiBgJHt0aGlzLnNldHRpbmdzLmJsb2dVcmx9L2FwaS9wb3N0cy8ke2lkfWAsXG4gICAgICBtZXRob2Q6IFwiUFVUXCIsXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShkYXRhKSxcbiAgICB9KTtcbiAgICBpZiAocmVzcC5zdGF0dXMgPT09IDIwMCkgcmV0dXJuIHsgb2s6IHRydWUgfTtcbiAgICBsZXQgbXNnID0gXCJcIjtcbiAgICB0cnkgeyBtc2cgPSByZXNwLmpzb24/LmVycm9yID8/IFwiXCI7IH0gY2F0Y2ggeyAvKiBpZ25vcmUgKi8gfVxuICAgIHJldHVybiB7IG9rOiBmYWxzZSwgZXJyb3I6IGBIVFRQICR7cmVzcC5zdGF0dXN9JHttc2cgPyBcIjogXCIgKyBtc2cgOiBcIlwifWAgfTtcbiAgfVxuXG4gIC8vID09PT09IENvcmUgU3luYyA9PT09PVxuXG4gIC8qKiBEZXRlY3Qgem9uZSBmcm9tIGZpbGUgcGF0aCAoYmxvZy8yLyBcdTIxOTIgQU5JTUUsIGJsb2cvMy8gXHUyMTkyIFJFQUwsIGJsb2cvNC8gXHUyMTkyIEZPVVIpLiAqL1xuICBkZXRlY3Rab25lRnJvbVBhdGgoZmlsZVBhdGg6IHN0cmluZyk6IFpvbmUgfCBudWxsIHtcbiAgICBmb3IgKGNvbnN0IFt6b25lLCBzdWJdIG9mIE9iamVjdC5lbnRyaWVzKFpPTkVfU1VCRk9MREVSKSBhcyBbWm9uZSwgc3RyaW5nXVtdKSB7XG4gICAgICBpZiAoZmlsZVBhdGguc3RhcnRzV2l0aChgJHt0aGlzLnNldHRpbmdzLnN5bmNGb2xkZXJ9LyR7c3VifS9gKSkge1xuICAgICAgICByZXR1cm4gem9uZTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICAvKiogUHVzaCBhIHNpbmdsZSBub3RlLiBab25lIHByaW9yaXR5OiBmcm9udG1hdHRlciA+IGZpbGUgcGF0aCA+IHNldHRpbmdzIGRlZmF1bHQuICovXG4gIGFzeW5jIHB1c2hOb3RlKGZpbGU6IFRGaWxlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCF0aGlzLnNldHRpbmdzLnVzZXJuYW1lIHx8ICF0aGlzLnNldHRpbmdzLnBhc3N3b3JkKSB7XG4gICAgICBuZXcgTm90aWNlKFwibHFzc2Jsb2c6IFx1OEJGN1x1NTE0OFx1NTcyOFx1NjNEMlx1NEVGNlx1OEJCRVx1N0Y2RVx1OTFDQ1x1NTg2Qlx1NTE5OVx1NzUyOFx1NjIzN1x1NTQwRFx1NTQ4Q1x1NUJDNlx1NzgwMVwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBmbSA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpPy5mcm9udG1hdHRlciA/PyB7fTtcbiAgICBjb25zdCB6b25lID1cbiAgICAgIChmbVtcImJsb2ctem9uZVwiXSBhcyBab25lIHwgdW5kZWZpbmVkKSA/P1xuICAgICAgdGhpcy5kZXRlY3Rab25lRnJvbVBhdGgoZmlsZS5wYXRoKSA/P1xuICAgICAgdGhpcy5zZXR0aW5ncy5kZWZhdWx0Wm9uZTtcblxuICAgIGF3YWl0IHRoaXMuZG9QdXNoKGZpbGUsIGZtIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBmbVtcImJsb2ctaWRcIl0gYXMgc3RyaW5nIHwgdW5kZWZpbmVkLCB6b25lKTtcbiAgfVxuXG4gIC8qKiBBY3R1YWxseSBwdXNoIHRoZSBub3RlIChjYWxsZWQgYWZ0ZXIgem9uZSBpcyBjb25maXJtZWQpLiAqL1xuICBhc3luYyBkb1B1c2goXG4gICAgZmlsZTogVEZpbGUsXG4gICAgZm06IFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuICAgIGJsb2dJZDogc3RyaW5nIHwgdW5kZWZpbmVkLFxuICAgIHpvbmU6IFpvbmVcbiAgKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgY29uc3QgcmF3Q29udGVudCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LnJlYWQoZmlsZSk7XG4gICAgY29uc3QgYm9keSA9IHN0cmlwRnJvbnRtYXR0ZXIocmF3Q29udGVudCk7XG5cbiAgICBjb25zdCB0aXRsZSA9IChmbVtcInRpdGxlXCJdIGFzIHN0cmluZykgfHwgZmlsZS5iYXNlbmFtZTtcbiAgICBjb25zdCB2aXNpYmlsaXR5ID0gKGZtW1wiYmxvZy12aXNpYmlsaXR5XCJdIGFzIFZpc2liaWxpdHkpIHx8IHRoaXMuc2V0dGluZ3MuZGVmYXVsdFZpc2liaWxpdHk7XG4gICAgY29uc3QgcHVibGlzaGVkID0gKGZtW1wiYmxvZy1wdWJsaXNoZWRcIl0gYXMgYm9vbGVhbikgPz8gdGhpcy5zZXR0aW5ncy5kZWZhdWx0UHVibGlzaGVkO1xuICAgIGNvbnN0IHRhZ3MgPSBwYXJzZVRhZ3MoZm1bXCJ0YWdzXCJdKTtcblxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICBjb25zdCBkYXRhID0geyB0aXRsZSwgY29udGVudDogYm9keSwgem9uZSwgdmlzaWJpbGl0eSwgcHVibGlzaGVkLCB0YWdzIH07XG5cbiAgICBpZiAoYmxvZ0lkKSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnVwZGF0ZVBvc3QoYmxvZ0lkLCBkYXRhKTtcbiAgICAgIGlmICghcmVzdWx0Lm9rKSB7XG4gICAgICAgIG5ldyBOb3RpY2UoYGxxc3NibG9nOiBcdTI3MTcgXHU2NkY0XHU2NUIwXHU1OTMxXHU4RDI1IFx1MjAxNFx1MzAwQyR7dGl0bGV9XHUzMDBEXFxuJHtyZXN1bHQuZXJyb3IgPz8gXCJcIn1gLCA4MDAwKTtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmNyZWF0ZVBvc3QoZGF0YSk7XG4gICAgICBpZiAoIXJlc3VsdC5wb3N0KSB7XG4gICAgICAgIG5ldyBOb3RpY2UoYGxxc3NibG9nOiBcdTI3MTcgXHU1M0QxXHU1RTAzXHU1OTMxXHU4RDI1IFx1MjAxNFx1MzAwQyR7dGl0bGV9XHUzMDBEXFxuJHtyZXN1bHQuZXJyb3IgPz8gXCJcIn1gLCA4MDAwKTtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgICAgYmxvZ0lkID0gcmVzdWx0LnBvc3QuaWQ7XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5hcHAuZmlsZU1hbmFnZXIucHJvY2Vzc0Zyb250TWF0dGVyKGZpbGUsIChmKSA9PiB7XG4gICAgICBmW1wiYmxvZy1pZFwiXSA9IGJsb2dJZDtcbiAgICAgIGZbXCJibG9nLXpvbmVcIl0gPSB6b25lO1xuICAgICAgZltcImJsb2ctdmlzaWJpbGl0eVwiXSA9IHZpc2liaWxpdHk7XG4gICAgICBmW1wiYmxvZy1wdWJsaXNoZWRcIl0gPSBwdWJsaXNoZWQ7XG4gICAgICBmW1wiYmxvZy1zeW5jZWQtYXRcIl0gPSBub3c7XG4gICAgICBmW1wiYmxvZy11cGRhdGVkLWF0XCJdID0gbm93O1xuICAgIH0pO1xuXG4gICAgbmV3IE5vdGljZShgbHFzc2Jsb2c6IFx1MjcxMyBcdTVERjJcdTYzQThcdTkwMDFcdTMwMEMke3RpdGxlfVx1MzAwRCR7cHVibGlzaGVkID8gXCJcIiA6IFwiXHVGRjA4XHU4MzQ5XHU3QTNGXHVGRjA5XCJ9YCk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICAvKiogUHVsbCBhbGwgdXNlcidzIHBvc3RzIGZyb20gdGhlIGJsb2cgaW50byB0aGUgc3luYyBmb2xkZXIuICovXG4gIGFzeW5jIHB1bGxBbGxQb3N0cygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMuc2V0dGluZ3MudXNlcm5hbWUgfHwgIXRoaXMuc2V0dGluZ3MucGFzc3dvcmQpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJscXNzYmxvZzogXHU4QkY3XHU1MTQ4XHU1NzI4XHU2M0QyXHU0RUY2XHU4QkJFXHU3RjZFXHU5MUNDXHU1ODZCXHU1MTk5XHU3NTI4XHU2MjM3XHU1NDBEXHU1NDhDXHU1QkM2XHU3ODAxXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIG5ldyBOb3RpY2UoXCJscXNzYmxvZzogXHU2QjYzXHU1NzI4XHU2MkM5XHU1M0Q2XHUyMDI2XCIpO1xuICAgIGNvbnN0IHBvc3RzID0gYXdhaXQgdGhpcy5mZXRjaE15UG9zdHMoKTtcblxuICAgIGlmICghcG9zdHMubGVuZ3RoKSB7XG4gICAgICBuZXcgTm90aWNlKFwibHFzc2Jsb2c6IFx1NTM1QVx1NUJBMlx1NEUwQVx1OEZEOFx1NkNBMVx1NjcwOVx1NjU4N1x1N0FFMFwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmVuc3VyZVN5bmNGb2xkZXIoKTtcblxuICAgIGxldCBwdWxsZWQgPSAwLCBza2lwcGVkID0gMDtcblxuICAgIGZvciAoY29uc3QgcG9zdCBvZiBwb3N0cykge1xuICAgICAgY29uc3QgZXhpc3RpbmcgPSB0aGlzLmZpbmRGaWxlQnlCbG9nSWQocG9zdC5pZCk7XG4gICAgICBjb25zdCBzeW5jZWRBdCA9IGV4aXN0aW5nXG4gICAgICAgID8gKHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGV4aXN0aW5nKT8uZnJvbnRtYXR0ZXI/LltcbiAgICAgICAgICAgIFwiYmxvZy1zeW5jZWQtYXRcIlxuICAgICAgICAgIF0gYXMgc3RyaW5nIHwgdW5kZWZpbmVkKVxuICAgICAgICA6IHVuZGVmaW5lZDtcblxuICAgICAgY29uc3QgYmxvZ1VwZGF0ZWRBdCA9IG5ldyBEYXRlKHBvc3QudXBkYXRlZEF0KS5nZXRUaW1lKCk7XG4gICAgICBjb25zdCBsYXN0U3luY1RpbWUgPSBzeW5jZWRBdCA/IG5ldyBEYXRlKHN5bmNlZEF0KS5nZXRUaW1lKCkgOiAwO1xuXG4gICAgICBpZiAoZXhpc3RpbmcgJiYgYmxvZ1VwZGF0ZWRBdCA8PSBsYXN0U3luY1RpbWUpIHtcbiAgICAgICAgc2tpcHBlZCsrO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgY29udGVudCA9IGJ1aWxkTm90ZUNvbnRlbnQocG9zdCk7XG4gICAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQubW9kaWZ5KGV4aXN0aW5nLCBjb250ZW50KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IHBhdGggPSBhd2FpdCB0aGlzLnVuaXF1ZVBhdGgoXG4gICAgICAgICAgYCR7dGhpcy56b25lRm9sZGVyKHBvc3Quem9uZSl9LyR7c2FmZUZpbGVuYW1lKHBvc3QudGl0bGUpIHx8IHBvc3QuaWR9Lm1kYFxuICAgICAgICApO1xuICAgICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5jcmVhdGUocGF0aCwgY29udGVudCk7XG4gICAgICB9XG4gICAgICBwdWxsZWQrKztcbiAgICB9XG5cbiAgICBuZXcgTm90aWNlKGBscXNzYmxvZzogXHU2MkM5XHU1M0Q2XHU1QjhDXHU2MjEwIFx1MjAxNFx1MjAxNCBcdTY2RjRcdTY1QjAgJHtwdWxsZWR9IFx1N0JDN1x1RkYwQ1x1OERGM1x1OEZDNyAke3NraXBwZWR9IFx1N0JDN2ApO1xuICB9XG5cbiAgLyoqIEZ1bGwgYmlkaXJlY3Rpb25hbCBzeW5jLiAqL1xuICBhc3luYyBzeW5jQWxsKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghdGhpcy5zZXR0aW5ncy51c2VybmFtZSB8fCAhdGhpcy5zZXR0aW5ncy5wYXNzd29yZCkge1xuICAgICAgbmV3IE5vdGljZShcImxxc3NibG9nOiBcdThCRjdcdTUxNDhcdTU3MjhcdTYzRDJcdTRFRjZcdThCQkVcdTdGNkVcdTkxQ0NcdTU4NkJcdTUxOTlcdTc1MjhcdTYyMzdcdTU0MERcdTU0OENcdTVCQzZcdTc4MDFcIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgYWxsRmlsZXMgPSB0aGlzLmFwcC52YXVsdC5nZXRNYXJrZG93bkZpbGVzKCk7XG4gICAgY29uc3Qgd2l0aE1ldGEgPSBhbGxGaWxlcy5maWx0ZXIoKGYpID0+IHtcbiAgICAgIGNvbnN0IGZtID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUoZik/LmZyb250bWF0dGVyO1xuICAgICAgcmV0dXJuIGZtPy5bXCJibG9nLWlkXCJdIHx8IGZtPy5bXCJibG9nLXpvbmVcIl0gfHwgdGhpcy5kZXRlY3Rab25lRnJvbVBhdGgoZi5wYXRoKTtcbiAgICB9KTtcbiAgICBuZXcgTm90aWNlKGBscXNzYmxvZzogXHU1RjAwXHU1OUNCXHU1NDBDXHU2QjY1XHUyMDI2IFx1NjI2Qlx1NjNDRlx1NTIzMCAke3dpdGhNZXRhLmxlbmd0aH0gXHU3QkM3XHU1MTczXHU4MDU0XHU3QjE0XHU4QkIwYCwgNDAwMCk7XG4gICAgY29uc3QgcG9zdHMgPSBhd2FpdCB0aGlzLmZldGNoTXlQb3N0cygpO1xuICAgIGNvbnN0IGJsb2dNYXAgPSBuZXcgTWFwPHN0cmluZywgQmxvZ1Bvc3Q+KHBvc3RzLm1hcCgocCkgPT4gW3AuaWQsIHBdKSk7XG5cbiAgICBhd2FpdCB0aGlzLmVuc3VyZVN5bmNGb2xkZXIoKTtcblxuICAgIGxldCBwdXNoZWQgPSAwLCBwdWxsZWQgPSAwLCBjb25mbGljdHMgPSAwLCBjcmVhdGVkID0gMCwgdXBUb0RhdGUgPSAwO1xuICAgIGNvbnN0IHByb2Nlc3NlZElkcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgIGNvbnN0IEJVRkZFUiA9IDVfMDAwO1xuXG4gICAgLy8gUHJvY2VzcyBhbGwgbG9jYWwgZmlsZXNcbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgdGhpcy5hcHAudmF1bHQuZ2V0TWFya2Rvd25GaWxlcygpKSB7XG4gICAgICBjb25zdCBmbSA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpPy5mcm9udG1hdHRlciA/PyB7fTtcbiAgICAgIGNvbnN0IGJsb2dJZCA9IGZtW1wiYmxvZy1pZFwiXSBhcyBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cbiAgICAgIGlmICghYmxvZ0lkKSB7XG4gICAgICAgIC8vIE5vIGJsb2ctaWQgeWV0OiBwdXNoIGlmIG5vdGUgaGFzIGJsb2ctem9uZSBPUiBpcyBpbnNpZGUgc3luYyBmb2xkZXJcbiAgICAgICAgY29uc3QgZGV0ZWN0ZWRab25lID1cbiAgICAgICAgICAoZm1bXCJibG9nLXpvbmVcIl0gYXMgWm9uZSB8IHVuZGVmaW5lZCkgPz8gdGhpcy5kZXRlY3Rab25lRnJvbVBhdGgoZmlsZS5wYXRoKTtcbiAgICAgICAgY29uc3QgaW5TeW5jRm9sZGVyID0gZmlsZS5wYXRoLnN0YXJ0c1dpdGgodGhpcy5zZXR0aW5ncy5zeW5jRm9sZGVyICsgXCIvXCIpO1xuICAgICAgICBpZiAoZGV0ZWN0ZWRab25lICYmIChpblN5bmNGb2xkZXIgfHwgZm1bXCJibG9nLXpvbmVcIl0pKSB7XG4gICAgICAgICAgY29uc3Qgb2sgPSBhd2FpdCB0aGlzLmRvUHVzaChmaWxlLCBmbSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgdW5kZWZpbmVkLCBkZXRlY3RlZFpvbmUpO1xuICAgICAgICAgIGlmIChvaykgY3JlYXRlZCsrO1xuICAgICAgICB9XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBwcm9jZXNzZWRJZHMuYWRkKGJsb2dJZCk7XG4gICAgICBjb25zdCBibG9nUG9zdCA9IGJsb2dNYXAuZ2V0KGJsb2dJZCk7XG4gICAgICBpZiAoIWJsb2dQb3N0KSBjb250aW51ZTtcblxuICAgICAgY29uc3Qgc3luY2VkQXQgPSBmbVtcImJsb2ctc3luY2VkLWF0XCJdIGFzIHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICAgIGNvbnN0IGxhc3RTeW5jVGltZSA9IHN5bmNlZEF0ID8gbmV3IERhdGUoc3luY2VkQXQpLmdldFRpbWUoKSA6IDA7XG4gICAgICBjb25zdCBibG9nVXBkYXRlZEF0ID0gbmV3IERhdGUoYmxvZ1Bvc3QudXBkYXRlZEF0KS5nZXRUaW1lKCk7XG4gICAgICBjb25zdCBsb2NhbFVwZGF0ZWRBdCA9IGZpbGUuc3RhdC5tdGltZTtcblxuICAgICAgY29uc3QgYmxvZ05ld2VyID0gYmxvZ1VwZGF0ZWRBdCA+IGxhc3RTeW5jVGltZSArIEJVRkZFUjtcbiAgICAgIGNvbnN0IGxvY2FsTmV3ZXIgPSBsb2NhbFVwZGF0ZWRBdCA+IGxhc3RTeW5jVGltZSArIEJVRkZFUjtcblxuICAgICAgaWYgKGJsb2dOZXdlciAmJiBsb2NhbE5ld2VyKSB7XG4gICAgICAgIGNvbmZsaWN0cysrO1xuICAgICAgICBuZXcgTm90aWNlKGBscXNzYmxvZzogXHUyNkEwIFx1NTFCMlx1N0E4MSBcdTIwMTRcdTMwMEMke2ZpbGUuYmFzZW5hbWV9XHUzMDBEXHU2NzJDXHU1NzMwXHU1NDhDXHU4RkRDXHU3QUVGXHU5MEZEXHU2NzA5XHU2NkY0XHU2NTM5XHVGRjBDXHU1REYyXHU4REYzXHU4RkM3YCk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBpZiAobG9jYWxOZXdlcikge1xuICAgICAgICBjb25zdCB6b25lID0gKGZtW1wiYmxvZy16b25lXCJdIGFzIFpvbmUgfCB1bmRlZmluZWQpID8/IChibG9nUG9zdC56b25lIGFzIFpvbmUpO1xuICAgICAgICBjb25zdCBvayA9IGF3YWl0IHRoaXMuZG9QdXNoKGZpbGUsIGZtIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBibG9nSWQsIHpvbmUpO1xuICAgICAgICBpZiAob2spIHB1c2hlZCsrO1xuICAgICAgfSBlbHNlIGlmIChibG9nTmV3ZXIpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQubW9kaWZ5KGZpbGUsIGJ1aWxkTm90ZUNvbnRlbnQoYmxvZ1Bvc3QpKTtcbiAgICAgICAgcHVsbGVkKys7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB1cFRvRGF0ZSsrO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFB1bGwgcG9zdHMgZnJvbSBibG9nIHRoYXQgZG9uJ3QgZXhpc3QgbG9jYWxseSB5ZXRcbiAgICBmb3IgKGNvbnN0IHBvc3Qgb2YgcG9zdHMpIHtcbiAgICAgIGlmIChwcm9jZXNzZWRJZHMuaGFzKHBvc3QuaWQpKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IHBhdGggPSBhd2FpdCB0aGlzLnVuaXF1ZVBhdGgoXG4gICAgICAgIGAke3RoaXMuem9uZUZvbGRlcihwb3N0LnpvbmUpfS8ke3NhZmVGaWxlbmFtZShwb3N0LnRpdGxlKSB8fCBwb3N0LmlkfS5tZGBcbiAgICAgICk7XG4gICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5jcmVhdGUocGF0aCwgYnVpbGROb3RlQ29udGVudChwb3N0KSk7XG4gICAgICBwdWxsZWQrKztcbiAgICB9XG5cbiAgICBjb25zdCBzdW1tYXJ5ID0gW1xuICAgICAgYFx1MjE5MSAke3B1c2hlZCArIGNyZWF0ZWR9YCxcbiAgICAgIGBcdTIxOTMgJHtwdWxsZWR9YCxcbiAgICAgIHVwVG9EYXRlID8gYFx1MjcxMyAke3VwVG9EYXRlfSBcdTVERjJcdTY2MkZcdTY3MDBcdTY1QjBgIDogXCJcIixcbiAgICAgIGNvbmZsaWN0cyA/IGBcdTI2QTAgJHtjb25mbGljdHN9IFx1NTFCMlx1N0E4MWAgOiBcIlwiLFxuICAgIF1cbiAgICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICAgIC5qb2luKFwiICAgXCIpO1xuXG4gICAgbmV3IE5vdGljZShgbHFzc2Jsb2c6IFx1NTQwQ1x1NkI2NVx1NUI4Q1x1NjIxMCBcdTIwMTRcdTIwMTQgJHtzdW1tYXJ5fWApO1xuICB9XG5cbiAgLy8gPT09PT0gSGVscGVycyA9PT09PVxuXG4gIGZpbmRGaWxlQnlCbG9nSWQoYmxvZ0lkOiBzdHJpbmcpOiBURmlsZSB8IG51bGwge1xuICAgIGZvciAoY29uc3QgZmlsZSBvZiB0aGlzLmFwcC52YXVsdC5nZXRNYXJrZG93bkZpbGVzKCkpIHtcbiAgICAgIGNvbnN0IGZtID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUoZmlsZSk/LmZyb250bWF0dGVyO1xuICAgICAgaWYgKGZtPy5bXCJibG9nLWlkXCJdID09PSBibG9nSWQpIHJldHVybiBmaWxlO1xuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHpvbmVGb2xkZXIoem9uZTogWm9uZSk6IHN0cmluZyB7XG4gICAgcmV0dXJuIGAke3RoaXMuc2V0dGluZ3Muc3luY0ZvbGRlcn0vJHtaT05FX1NVQkZPTERFUlt6b25lXX1gO1xuICB9XG5cbiAgYXN5bmMgZW5zdXJlU3luY0ZvbGRlcigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCByb290ID0gdGhpcy5zZXR0aW5ncy5zeW5jRm9sZGVyO1xuICAgIGlmICghKGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIuZXhpc3RzKHJvb3QpKSkge1xuICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuY3JlYXRlRm9sZGVyKHJvb3QpO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IHN1YiBvZiBPYmplY3QudmFsdWVzKFpPTkVfU1VCRk9MREVSKSkge1xuICAgICAgY29uc3QgcGF0aCA9IGAke3Jvb3R9LyR7c3VifWA7XG4gICAgICBpZiAoIShhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLmV4aXN0cyhwYXRoKSkpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuY3JlYXRlRm9sZGVyKHBhdGgpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHVuaXF1ZVBhdGgocGF0aDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICBpZiAoIShhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLmV4aXN0cyhwYXRoKSkpIHJldHVybiBwYXRoO1xuICAgIGNvbnN0IGJhc2UgPSBwYXRoLnJlcGxhY2UoL1xcLm1kJC8sIFwiXCIpO1xuICAgIGxldCBpID0gMTtcbiAgICB3aGlsZSAoYXdhaXQgdGhpcy5hcHAudmF1bHQuYWRhcHRlci5leGlzdHMoYCR7YmFzZX0tJHtpfS5tZGApKSBpKys7XG4gICAgcmV0dXJuIGAke2Jhc2V9LSR7aX0ubWRgO1xuICB9XG5cbiAgYXN5bmMgbG9hZFNldHRpbmdzKCkge1xuICAgIHRoaXMuc2V0dGluZ3MgPSBPYmplY3QuYXNzaWduKHt9LCBERUZBVUxUX1NFVFRJTkdTLCBhd2FpdCB0aGlzLmxvYWREYXRhKCkpO1xuICB9XG5cbiAgYXN5bmMgc2F2ZVNldHRpbmdzKCkge1xuICAgIGF3YWl0IHRoaXMuc2F2ZURhdGEodGhpcy5zZXR0aW5ncyk7XG4gIH1cbn1cblxuLy8gPT09PT0gU3luYyBNb2RhbCAoUmliYm9uIGNsaWNrKSA9PT09PVxuXG5jbGFzcyBTeW5jTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIHBsdWdpbjogTHFzc2Jsb2dQbHVnaW47XG5cbiAgY29uc3RydWN0b3IoYXBwOiBBcHAsIHBsdWdpbjogTHFzc2Jsb2dQbHVnaW4pIHtcbiAgICBzdXBlcihhcHApO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICB9XG5cbiAgb25PcGVuKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5hZGRDbGFzcyhcImxxc3MtbW9kYWxcIik7XG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwiaDNcIiwgeyB0ZXh0OiBcImxxc3NibG9nIFN5bmNcIiB9KTtcblxuICAgIGNvbnN0IGdyaWQgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcImxxc3MtZ3JpZFwiIH0pO1xuXG4gICAgdGhpcy5idG4oZ3JpZCwgXCJcdTIxOTFcIiwgXCJcdTYzQThcdTkwMDFcdTVGNTNcdTUyNERcdTdCMTRcdThCQjBcIiwgXCJ1cGxvYWQtY2xvdWRcIiwgKCkgPT4ge1xuICAgICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVGaWxlKCk7XG4gICAgICBpZiAoZmlsZSkgdGhpcy5wbHVnaW4ucHVzaE5vdGUoZmlsZSk7XG4gICAgICBlbHNlIG5ldyBOb3RpY2UoXCJscXNzYmxvZzogXHU2Q0ExXHU2NzA5XHU2MjUzXHU1RjAwXHU3Njg0XHU3QjE0XHU4QkIwXCIpO1xuICAgIH0pO1xuXG4gICAgdGhpcy5idG4oZ3JpZCwgXCJcdTIxOTNcIiwgXCJcdTYyQzlcdTUzRDZcdTUxNjhcdTkwRThcdTY1ODdcdTdBRTBcIiwgXCJkb3dubG9hZC1jbG91ZFwiLCAoKSA9PiB7XG4gICAgICB0aGlzLnBsdWdpbi5wdWxsQWxsUG9zdHMoKTtcbiAgICB9KTtcblxuICAgIHRoaXMuYnRuKGdyaWQsIFwiXHUyMUM1XCIsIFwiXHU1MTY4XHU5MUNGXHU1M0NDXHU1NDExXHU1NDBDXHU2QjY1XCIsIFwicmVmcmVzaC1jd1wiLCAoKSA9PiB7XG4gICAgICB0aGlzLnBsdWdpbi5zeW5jQWxsKCk7XG4gICAgfSk7XG4gIH1cblxuICBidG4oXG4gICAgcGFyZW50OiBIVE1MRWxlbWVudCxcbiAgICBpY29uOiBzdHJpbmcsXG4gICAgbGFiZWw6IHN0cmluZyxcbiAgICBfbHVjaWRlOiBzdHJpbmcsXG4gICAgb25DbGljazogKCkgPT4gdm9pZFxuICApIHtcbiAgICBjb25zdCBidG4gPSBwYXJlbnQuY3JlYXRlRWwoXCJidXR0b25cIiwgeyBjbHM6IFwibHFzcy1hY3Rpb24tYnRuXCIgfSk7XG4gICAgYnRuLmNyZWF0ZUVsKFwic3BhblwiLCB7IGNsczogXCJscXNzLWJ0bi1pY29uXCIsIHRleHQ6IGljb24gfSk7XG4gICAgYnRuLmNyZWF0ZUVsKFwic3BhblwiLCB7IGNsczogXCJscXNzLWJ0bi1sYWJlbFwiLCB0ZXh0OiBsYWJlbCB9KTtcbiAgICBidG4ub25jbGljayA9ICgpID0+IHtcbiAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgIG9uQ2xpY2soKTtcbiAgICB9O1xuICB9XG5cbiAgb25DbG9zZSgpIHtcbiAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xuICB9XG59XG5cbi8vID09PT09IFB1Ymxpc2ggTW9kYWwgKGZpcnN0LXRpbWUgcHVzaCwgbm8gem9uZSBzZXQpID09PT09XG5cbmNsYXNzIFB1Ymxpc2hNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgcGx1Z2luOiBMcXNzYmxvZ1BsdWdpbjtcbiAgZmlsZTogVEZpbGU7XG5cbiAgY29uc3RydWN0b3IoYXBwOiBBcHAsIHBsdWdpbjogTHFzc2Jsb2dQbHVnaW4sIGZpbGU6IFRGaWxlKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgICB0aGlzLmZpbGUgPSBmaWxlO1xuICB9XG5cbiAgb25PcGVuKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnN0IGZtID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUodGhpcy5maWxlKT8uZnJvbnRtYXR0ZXIgPz8ge307XG5cbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJoM1wiLCB7IHRleHQ6IFwiXHU1M0QxXHU1RTAzXHU1MjMwIGxxc3NibG9nXCIgfSk7XG5cbiAgICBsZXQgdGl0bGUgPSAoZm1bXCJ0aXRsZVwiXSBhcyBzdHJpbmcpIHx8IHRoaXMuZmlsZS5iYXNlbmFtZTtcbiAgICBsZXQgem9uZTogWm9uZSA9IFwiQU5JTUVcIjtcbiAgICBsZXQgdmlzaWJpbGl0eTogVmlzaWJpbGl0eSA9IFwiTE9HSU5fT05MWVwiO1xuICAgIGxldCBwdWJsaXNoZWQgPSBmYWxzZTtcbiAgICBsZXQgdGFncyA9IHBhcnNlVGFncyhmbVtcInRhZ3NcIl0pLmpvaW4oXCIsIFwiKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5zZXROYW1lKFwiXHU2ODA3XHU5ODk4XCIpXG4gICAgICAuYWRkVGV4dCgodCkgPT5cbiAgICAgICAgdC5zZXRWYWx1ZSh0aXRsZSkub25DaGFuZ2UoKHYpID0+ICh0aXRsZSA9IHYpKVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5zZXROYW1lKFwiXHU1MjA2XHU1MzNBXCIpXG4gICAgICAuYWRkRHJvcGRvd24oKGQpID0+IHtcbiAgICAgICAgZC5hZGRPcHRpb24oXCJBTklNRVwiLCBcIjJcIik7XG4gICAgICAgIGQuYWRkT3B0aW9uKFwiUkVBTFwiLCBcIjNcIik7XG4gICAgICAgIGQuYWRkT3B0aW9uKFwiRk9VUlwiLCBcIjRcIik7XG4gICAgICAgIGQuc2V0VmFsdWUoem9uZSkub25DaGFuZ2UoKHYpID0+ICh6b25lID0gdiBhcyBab25lKSk7XG4gICAgICB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5zZXROYW1lKFwiXHU1M0VGXHU4OUMxXHU2MDI3XCIpXG4gICAgICAuYWRkRHJvcGRvd24oKGQpID0+IHtcbiAgICAgICAgZC5hZGRPcHRpb24oXCJMT0dJTl9PTkxZXCIsIFwiXHU0RUM1XHU3NjdCXHU1RjU1XHU3NTI4XHU2MjM3XCIpO1xuICAgICAgICBkLmFkZE9wdGlvbihcIlBVQkxJQ1wiLCBcIlx1NTE2Q1x1NUYwMFwiKTtcbiAgICAgICAgZC5hZGRPcHRpb24oXCJGUklFTkRTX09OTFlcIiwgXCJcdTRFQzVcdTU5N0RcdTUzQ0JcIik7XG4gICAgICAgIGQuc2V0VmFsdWUodmlzaWJpbGl0eSkub25DaGFuZ2UoKHYpID0+ICh2aXNpYmlsaXR5ID0gdiBhcyBWaXNpYmlsaXR5KSk7XG4gICAgICB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5zZXROYW1lKFwiXHU2ODA3XHU3QjdFXCIpXG4gICAgICAuc2V0RGVzYyhcIlx1NTkxQVx1NEUyQVx1NjgwN1x1N0I3RVx1NzUyOFx1OTAxN1x1NTNGN1x1NTIwNlx1OTY5NFwiKVxuICAgICAgLmFkZFRleHQoKHQpID0+XG4gICAgICAgIHRcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoXCJ0YWcxLCB0YWcyXCIpXG4gICAgICAgICAgLnNldFZhbHVlKHRhZ3MpXG4gICAgICAgICAgLm9uQ2hhbmdlKCh2KSA9PiAodGFncyA9IHYpKVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5zZXROYW1lKFwiXHU3QUNCXHU1MzczXHU1M0QxXHU1RTAzXCIpXG4gICAgICAuc2V0RGVzYyhcIlx1NTE3M1x1OTVFRFx1NTIxOVx1NEZERFx1NUI1OFx1NEUzQVx1ODM0OVx1N0EzRlwiKVxuICAgICAgLmFkZFRvZ2dsZSgodCkgPT5cbiAgICAgICAgdC5zZXRWYWx1ZShwdWJsaXNoZWQpLm9uQ2hhbmdlKCh2KSA9PiAocHVibGlzaGVkID0gdikpXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKS5hZGRCdXR0b24oKGJ0bikgPT5cbiAgICAgIGJ0blxuICAgICAgICAuc2V0QnV0dG9uVGV4dChcIlx1NTNEMVx1NUUwM1wiKVxuICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgICAgICBjb25zdCB0YWdMaXN0ID0gdGFnc1xuICAgICAgICAgICAgLnNwbGl0KFwiLFwiKVxuICAgICAgICAgICAgLm1hcCgodCkgPT4gdC50cmltKCkpXG4gICAgICAgICAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICAgICAgICAgIC8vIFdyaXRlIG1ldGEgdG8gZnJvbnRtYXR0ZXIgZmlyc3Qgc28gZG9QdXNoIGNhbiByZWFkIGl0XG4gICAgICAgICAgYXdhaXQgdGhpcy5hcHAuZmlsZU1hbmFnZXIucHJvY2Vzc0Zyb250TWF0dGVyKHRoaXMuZmlsZSwgKGYpID0+IHtcbiAgICAgICAgICAgIGZbXCJ0aXRsZVwiXSA9IHRpdGxlO1xuICAgICAgICAgICAgZltcImJsb2ctem9uZVwiXSA9IHpvbmU7XG4gICAgICAgICAgICBmW1wiYmxvZy12aXNpYmlsaXR5XCJdID0gdmlzaWJpbGl0eTtcbiAgICAgICAgICAgIGZbXCJibG9nLXB1Ymxpc2hlZFwiXSA9IHB1Ymxpc2hlZDtcbiAgICAgICAgICAgIGZbXCJ0YWdzXCJdID0gdGFnTGlzdDtcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5kb1B1c2goXG4gICAgICAgICAgICB0aGlzLmZpbGUsXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHRpdGxlLFxuICAgICAgICAgICAgICBcImJsb2ctem9uZVwiOiB6b25lLFxuICAgICAgICAgICAgICBcImJsb2ctdmlzaWJpbGl0eVwiOiB2aXNpYmlsaXR5LFxuICAgICAgICAgICAgICBcImJsb2ctcHVibGlzaGVkXCI6IHB1Ymxpc2hlZCxcbiAgICAgICAgICAgICAgXCJ0YWdzXCI6IHRhZ0xpc3QsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICAgICAgem9uZVxuICAgICAgICAgICk7XG4gICAgICAgIH0pXG4gICAgKTtcbiAgfVxuXG4gIG9uQ2xvc2UoKSB7XG4gICAgdGhpcy5jb250ZW50RWwuZW1wdHkoKTtcbiAgfVxufVxuXG4vLyA9PT09PSBTZXR0aW5ncyBUYWIgPT09PT1cblxuY2xhc3MgTHFzc2Jsb2dTZXR0aW5nVGFiIGV4dGVuZHMgUGx1Z2luU2V0dGluZ1RhYiB7XG4gIHBsdWdpbjogTHFzc2Jsb2dQbHVnaW47XG5cbiAgY29uc3RydWN0b3IoYXBwOiBBcHAsIHBsdWdpbjogTHFzc2Jsb2dQbHVnaW4pIHtcbiAgICBzdXBlcihhcHAsIHBsdWdpbik7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gIH1cblxuICBkaXNwbGF5KCkge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgY29udGFpbmVyRWwuZW1wdHkoKTtcbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcImgyXCIsIHsgdGV4dDogXCJscXNzYmxvZyBTeW5jXCIgfSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiXHU1MzVBXHU1QkEyXHU1NzMwXHU1NzQwXCIpXG4gICAgICAuc2V0RGVzYyhcIlx1NEUwRFx1NTQyQlx1NjcyQlx1NUMzRVx1NjU5Q1x1N0VCRlx1RkYwQ1x1NEY4Qlx1NTk4MiBodHRwczovL2xxc3NibG9nLnNlcnZlYmxvZy5uZXRcIilcbiAgICAgIC5hZGRUZXh0KCh0KSA9PlxuICAgICAgICB0XG4gICAgICAgICAgLnNldFBsYWNlaG9sZGVyKFwiaHR0cHM6Ly9scXNzYmxvZy5zZXJ2ZWJsb2cubmV0XCIpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmJsb2dVcmwpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2KSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ibG9nVXJsID0gdi5yZXBsYWNlKC9cXC8kLywgXCJcIik7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJcdTc1MjhcdTYyMzdcdTU0MERcIilcbiAgICAgIC5hZGRUZXh0KCh0KSA9PlxuICAgICAgICB0XG4gICAgICAgICAgLnNldFBsYWNlaG9sZGVyKFwieW91ci11c2VybmFtZVwiKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy51c2VybmFtZSlcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHYpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnVzZXJuYW1lID0gdi50cmltKCk7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJcdTVCQzZcdTc4MDFcIilcbiAgICAgIC5hZGRUZXh0KCh0KSA9PiB7XG4gICAgICAgIHQuaW5wdXRFbC50eXBlID0gXCJwYXNzd29yZFwiO1xuICAgICAgICB0LnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLnBhc3N3b3JkKS5vbkNoYW5nZShhc3luYyAodikgPT4ge1xuICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnBhc3N3b3JkID0gdjtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJcdTU0MENcdTZCNjVcdTY4MzlcdTY1ODdcdTRFRjZcdTU5MzlcIilcbiAgICAgIC5zZXREZXNjKFwiXHU2NTg3XHU3QUUwXHU2MzA5XHU1MjA2XHU1MzNBXHU0RkREXHU1QjU4XHU1MjMwXHU1QjUwXHU2NTg3XHU0RUY2XHU1OTM5XHVGRjFBYmxvZy8yIFx1MDBCNyBibG9nLzMgXHUwMEI3IGJsb2cvNFwiKVxuICAgICAgLmFkZFRleHQoKHQpID0+XG4gICAgICAgIHRcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoXCJibG9nXCIpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLnN5bmNGb2xkZXIpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2KSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5zeW5jRm9sZGVyID0gdi50cmltKCkucmVwbGFjZSgvXFwvJC8sIFwiXCIpO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcImgzXCIsIHsgdGV4dDogXCJcdTYzQThcdTkwMDFcdTlFRDhcdThCQTRcdTUwM0NcIiB9KTtcbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgdGV4dDogXCJcdTYzQThcdTkwMDFcdTZDQTFcdTY3MDkgZnJvbnRtYXR0ZXIgXHU3Njg0XHU3QjE0XHU4QkIwXHU2NUY2XHU0RjdGXHU3NTI4XHU4RkQ5XHU0RTlCXHU5RUQ4XHU4QkE0XHU1MDNDXHVGRjBDXHU2NUUwXHU5NzAwXHU2MjRCXHU1MkE4XHU1ODZCXHU1MTk5XHUzMDAyXCIsXG4gICAgICBjbHM6IFwic2V0dGluZy1pdGVtLWRlc2NyaXB0aW9uXCIsXG4gICAgfSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiXHU5RUQ4XHU4QkE0XHU1MjA2XHU1MzNBXCIpXG4gICAgICAuYWRkRHJvcGRvd24oKGQpID0+IHtcbiAgICAgICAgZC5hZGRPcHRpb24oXCJBTklNRVwiLCBcIjJcIik7XG4gICAgICAgIGQuYWRkT3B0aW9uKFwiUkVBTFwiLCBcIjNcIik7XG4gICAgICAgIGQuYWRkT3B0aW9uKFwiRk9VUlwiLCBcIjRcIik7XG4gICAgICAgIGQuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuZGVmYXVsdFpvbmUpLm9uQ2hhbmdlKGFzeW5jICh2KSA9PiB7XG4gICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuZGVmYXVsdFpvbmUgPSB2IGFzIFpvbmU7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiXHU5RUQ4XHU4QkE0XHU1M0VGXHU4OUMxXHU2MDI3XCIpXG4gICAgICAuYWRkRHJvcGRvd24oKGQpID0+IHtcbiAgICAgICAgZC5hZGRPcHRpb24oXCJMT0dJTl9PTkxZXCIsIFwiXHU0RUM1XHU3NjdCXHU1RjU1XHU3NTI4XHU2MjM3XCIpO1xuICAgICAgICBkLmFkZE9wdGlvbihcIlBVQkxJQ1wiLCBcIlx1NTE2Q1x1NUYwMFwiKTtcbiAgICAgICAgZC5hZGRPcHRpb24oXCJGUklFTkRTX09OTFlcIiwgXCJcdTRFQzVcdTU5N0RcdTUzQ0JcIik7XG4gICAgICAgIGQuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuZGVmYXVsdFZpc2liaWxpdHkpLm9uQ2hhbmdlKGFzeW5jICh2KSA9PiB7XG4gICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuZGVmYXVsdFZpc2liaWxpdHkgPSB2IGFzIFZpc2liaWxpdHk7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiXHU5RUQ4XHU4QkE0XHU3NkY0XHU2M0E1XHU1M0QxXHU1RTAzXCIpXG4gICAgICAuc2V0RGVzYyhcIlx1NTE3M1x1OTVFRFx1NTIxOVx1NEZERFx1NUI1OFx1NEUzQVx1ODM0OVx1N0EzRlwiKVxuICAgICAgLmFkZFRvZ2dsZSgodCkgPT5cbiAgICAgICAgdC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5kZWZhdWx0UHVibGlzaGVkKS5vbkNoYW5nZShhc3luYyAodikgPT4ge1xuICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmRlZmF1bHRQdWJsaXNoZWQgPSB2O1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJcdTZENEJcdThCRDVcdThGREVcdTYzQTVcIilcbiAgICAgIC5zZXREZXNjKFwiXHU5QThDXHU4QkMxXHU3NTI4XHU2MjM3XHU1NDBEXHU1NDhDXHU1QkM2XHU3ODAxXHU2NjJGXHU1NDI2XHU2QjYzXHU3ODZFXCIpXG4gICAgICAuYWRkQnV0dG9uKChidG4pID0+XG4gICAgICAgIGJ0bi5zZXRCdXR0b25UZXh0KFwiXHU2RDRCXHU4QkQ1XCIpLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGJ0bi5zZXRCdXR0b25UZXh0KFwiXHU4RkRFXHU2M0E1XHU0RTJEXHUyMDI2XCIpLnNldERpc2FibGVkKHRydWUpO1xuICAgICAgICAgIGNvbnN0IHsgb2ssIHJlYXNvbiB9ID0gYXdhaXQgdGhpcy5wbHVnaW4ubG9naW4oKTtcbiAgICAgICAgICBidG4uc2V0RGlzYWJsZWQoZmFsc2UpO1xuICAgICAgICAgIGlmIChvaykge1xuICAgICAgICAgICAgYnRuLnNldEJ1dHRvblRleHQoXCJcdTI3MTMgXHU2MjEwXHU1MjlGXCIpO1xuICAgICAgICAgICAgbmV3IE5vdGljZShcImxxc3NibG9nOiBcdTc2N0JcdTVGNTVcdTYyMTBcdTUyOUZcIik7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGJ0bi5zZXRCdXR0b25UZXh0KFwiXHUyNzE3IFx1NTkzMVx1OEQyNVwiKTtcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoYGxxc3NibG9nOiBcdTc2N0JcdTVGNTVcdTU5MzFcdThEMjUgXHUyMDE0ICR7cmVhc29ufWAsIDgwMDApO1xuICAgICAgICAgIH1cbiAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IGJ0bi5zZXRCdXR0b25UZXh0KFwiXHU2RDRCXHU4QkQ1XCIpLCA0MDAwKTtcbiAgICAgICAgfSlcbiAgICAgICk7XG4gIH1cbn1cblxuLy8gPT09PT0gVXRpbGl0eSA9PT09PVxuXG5mdW5jdGlvbiBzdHJpcEZyb250bWF0dGVyKGNvbnRlbnQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmICghY29udGVudC5zdGFydHNXaXRoKFwiLS0tXCIpKSByZXR1cm4gY29udGVudDtcbiAgY29uc3QgZW5kID0gY29udGVudC5pbmRleE9mKFwiXFxuLS0tXCIsIDMpO1xuICBpZiAoZW5kID09PSAtMSkgcmV0dXJuIGNvbnRlbnQ7XG4gIHJldHVybiBjb250ZW50LnNsaWNlKGVuZCArIDQpLnRyaW1TdGFydCgpO1xufVxuXG5mdW5jdGlvbiBwYXJzZVRhZ3MocmF3OiB1bmtub3duKTogc3RyaW5nW10ge1xuICBpZiAoIXJhdykgcmV0dXJuIFtdO1xuICBpZiAoQXJyYXkuaXNBcnJheShyYXcpKSByZXR1cm4gKHJhdyBhcyB1bmtub3duW10pLm1hcChTdHJpbmcpLmZpbHRlcihCb29sZWFuKTtcbiAgaWYgKHR5cGVvZiByYXcgPT09IFwic3RyaW5nXCIpXG4gICAgcmV0dXJuIHJhd1xuICAgICAgLnNwbGl0KFwiLFwiKVxuICAgICAgLm1hcCgodCkgPT4gdC50cmltKCkpXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICByZXR1cm4gW107XG59XG5cbmZ1bmN0aW9uIHNhZmVGaWxlbmFtZShuYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbmFtZS5yZXBsYWNlKC9bXFxcXC86Kj9cIjw+fF0vZywgXCItXCIpLnRyaW0oKS5zbGljZSgwLCAxMDApO1xufVxuXG5mdW5jdGlvbiBidWlsZE5vdGVDb250ZW50KHBvc3Q6IEJsb2dQb3N0KTogc3RyaW5nIHtcbiAgY29uc3QgdGFncyA9IHBvc3QudGFncy5tYXAoKHQpID0+IHQudGFnLm5hbWUpO1xuICBjb25zdCBsaW5lcyA9IFtcbiAgICBcIi0tLVwiLFxuICAgIGB0aXRsZTogXCIke3Bvc3QudGl0bGUucmVwbGFjZSgvXCIvZywgJ1xcXFxcIicpfVwiYCxcbiAgICBgYmxvZy1pZDogXCIke3Bvc3QuaWR9XCJgLFxuICAgIGBibG9nLXpvbmU6ICR7cG9zdC56b25lfWAsXG4gICAgYGJsb2ctdmlzaWJpbGl0eTogJHtwb3N0LnZpc2liaWxpdHl9YCxcbiAgICBgYmxvZy1wdWJsaXNoZWQ6ICR7cG9zdC5wdWJsaXNoZWR9YCxcbiAgXTtcbiAgaWYgKHRhZ3MubGVuZ3RoKSB7XG4gICAgbGluZXMucHVzaChgdGFnczogWyR7dGFncy5tYXAoKHQpID0+IGBcIiR7dH1cImApLmpvaW4oXCIsIFwiKX1dYCk7XG4gIH1cbiAgbGluZXMucHVzaChcbiAgICBgYmxvZy1zeW5jZWQtYXQ6IFwiJHtuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCl9XCJgLFxuICAgIGBibG9nLXVwZGF0ZWQtYXQ6IFwiJHtwb3N0LnVwZGF0ZWRBdH1cImAsXG4gICAgXCItLS1cIixcbiAgICBcIlwiLFxuICAgIHBvc3QuY29udGVudFxuICApO1xuICByZXR1cm4gbGluZXMuam9pbihcIlxcblwiKTtcbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLHNCQVdPO0FBOEJQLElBQU0sbUJBQXFDO0FBQUEsRUFDekMsU0FBUztBQUFBLEVBQ1QsVUFBVTtBQUFBLEVBQ1YsVUFBVTtBQUFBLEVBQ1YsWUFBWTtBQUFBLEVBQ1osT0FBTztBQUFBLEVBQ1AsYUFBYTtBQUFBLEVBQ2IsbUJBQW1CO0FBQUEsRUFDbkIsa0JBQWtCO0FBQ3BCO0FBRUEsSUFBTSxpQkFBdUM7QUFBQSxFQUMzQyxPQUFPO0FBQUEsRUFDUCxNQUFNO0FBQUEsRUFDTixNQUFNO0FBQ1I7QUFJQSxJQUFxQixpQkFBckIsY0FBNEMsdUJBQU87QUFBQSxFQUdqRCxNQUFNLFNBQVM7QUFDYixVQUFNLEtBQUssYUFBYTtBQUd4QixTQUFLLGNBQWMsU0FBUyxpQkFBaUIsTUFBTTtBQUNqRCxVQUFJLFVBQVUsS0FBSyxLQUFLLElBQUksRUFBRSxLQUFLO0FBQUEsSUFDckMsQ0FBQztBQUdELFNBQUssV0FBVztBQUFBLE1BQ2QsSUFBSTtBQUFBLE1B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
