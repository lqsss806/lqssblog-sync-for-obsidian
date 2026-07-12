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
    var _a;
    const resp = await this.apiReq({
      url: `${this.settings.blogUrl}/api/posts`,
      method: "POST",
      body: JSON.stringify(data)
    });
    if (resp.status !== 201) return null;
    return (_a = resp.json.post) != null ? _a : null;
  }
  async updatePost(id, data) {
    const resp = await this.apiReq({
      url: `${this.settings.blogUrl}/api/posts/${id}`,
      method: "PUT",
      body: JSON.stringify(data)
    });
    return resp.status === 200;
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
    var _a;
    const rawContent = await this.app.vault.read(file);
    const body = stripFrontmatter(rawContent);
    const title = fm["title"] || file.basename;
    const visibility = fm["blog-visibility"] || this.settings.defaultVisibility;
    const published = (_a = fm["blog-published"]) != null ? _a : this.settings.defaultPublished;
    const tags = parseTags(fm["tags"]);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const data = { title, content: body, zone, visibility, published, tags };
    if (blogId) {
      const ok = await this.updatePost(blogId, data);
      if (!ok) {
        new import_obsidian.Notice(`lqssblog: \u2717 \u66F4\u65B0\u5931\u8D25 \u2014\u300C${title}\u300D`);
        return false;
      }
    } else {
      const post = await this.createPost(data);
      if (!post) {
        new import_obsidian.Notice(`lqssblog: \u2717 \u53D1\u5E03\u5931\u8D25 \u2014\u300C${title}\u300D`);
        return false;
      }
      blogId = post.id;
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
    var _a, _b, _c;
    if (!this.settings.username || !this.settings.password) {
      new import_obsidian.Notice("lqssblog: \u8BF7\u5148\u5728\u63D2\u4EF6\u8BBE\u7F6E\u91CC\u586B\u5199\u7528\u6237\u540D\u548C\u5BC6\u7801");
      return;
    }
    new import_obsidian.Notice("lqssblog: \u5F00\u59CB\u53CC\u5411\u540C\u6B65\u2026");
    const posts = await this.fetchMyPosts();
    const blogMap = new Map(posts.map((p) => [p.id, p]));
    await this.ensureSyncFolder();
    let pushed = 0, pulled = 0, conflicts = 0, created = 0;
    const processedIds = /* @__PURE__ */ new Set();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = (_b = (_a = this.app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter) != null ? _b : {};
      const blogId = fm["blog-id"];
      const zone = fm["blog-zone"];
      if (!blogId) {
        const detectedZone = (_c = fm["blog-zone"]) != null ? _c : this.detectZoneFromPath(file.path);
        if (detectedZone && file.path.startsWith(this.settings.syncFolder + "/")) {
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
      const BUFFER = 5e3;
      const blogNewer = blogUpdatedAt > lastSyncTime + BUFFER;
      const localNewer = localUpdatedAt > lastSyncTime + BUFFER;
      if (blogNewer && localNewer) {
        conflicts++;
        new import_obsidian.Notice(
          `lqssblog: \u26A0 \u51B2\u7A81 \u2014\u300C${file.basename}\u300D\u672C\u5730\u548C\u8FDC\u7AEF\u90FD\u6709\u66F4\u6539\uFF0C\u5DF2\u8DF3\u8FC7\uFF0C\u8BF7\u624B\u52A8\u5904\u7406`
        );
        continue;
      }
      if (localNewer) {
        const ok = await this.doPush(
          file,
          fm,
          blogId,
          zone != null ? zone : blogPost.zone
        );
        if (ok) pushed++;
      } else if (blogNewer) {
        await this.app.vault.modify(file, buildNoteContent(blogPost));
        pulled++;
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
      `\u2191 \u63A8\u9001 ${pushed + created}`,
      `\u2193 \u62C9\u53D6 ${pulled}`,
      conflicts ? `\u26A0 ${conflicts} \u4E2A\u51B2\u7A81` : ""
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7XG4gIEFwcCxcbiAgTW9kYWwsXG4gIE5vdGljZSxcbiAgUGx1Z2luLFxuICBQbHVnaW5TZXR0aW5nVGFiLFxuICBTZXR0aW5nLFxuICBURmlsZSxcbiAgcmVxdWVzdFVybCxcbiAgUmVxdWVzdFVybFBhcmFtLFxuICBSZXF1ZXN0VXJsUmVzcG9uc2UsXG59IGZyb20gXCJvYnNpZGlhblwiO1xuXG4vLyA9PT09PSBUeXBlcyA9PT09PVxuXG50eXBlIFpvbmUgPSBcIkFOSU1FXCIgfCBcIlJFQUxcIiB8IFwiRk9VUlwiO1xudHlwZSBWaXNpYmlsaXR5ID0gXCJQVUJMSUNcIiB8IFwiTE9HSU5fT05MWVwiIHwgXCJGUklFTkRTX09OTFlcIjtcblxuaW50ZXJmYWNlIEJsb2dQb3N0IHtcbiAgaWQ6IHN0cmluZztcbiAgdGl0bGU6IHN0cmluZztcbiAgY29udGVudDogc3RyaW5nO1xuICB6b25lOiBab25lO1xuICB2aXNpYmlsaXR5OiBWaXNpYmlsaXR5O1xuICBwdWJsaXNoZWQ6IGJvb2xlYW47XG4gIGNyZWF0ZWRBdDogc3RyaW5nO1xuICB1cGRhdGVkQXQ6IHN0cmluZztcbiAgdGFnczogeyB0YWc6IHsgbmFtZTogc3RyaW5nIH0gfVtdO1xufVxuXG5pbnRlcmZhY2UgTHFzc2Jsb2dTZXR0aW5ncyB7XG4gIGJsb2dVcmw6IHN0cmluZztcbiAgdXNlcm5hbWU6IHN0cmluZztcbiAgcGFzc3dvcmQ6IHN0cmluZztcbiAgc3luY0ZvbGRlcjogc3RyaW5nO1xuICB0b2tlbjogc3RyaW5nO1xuICBkZWZhdWx0Wm9uZTogWm9uZTtcbiAgZGVmYXVsdFZpc2liaWxpdHk6IFZpc2liaWxpdHk7XG4gIGRlZmF1bHRQdWJsaXNoZWQ6IGJvb2xlYW47XG59XG5cbmNvbnN0IERFRkFVTFRfU0VUVElOR1M6IExxc3NibG9nU2V0dGluZ3MgPSB7XG4gIGJsb2dVcmw6IFwiaHR0cHM6Ly9scXNzYmxvZy5zZXJ2ZWJsb2cubmV0XCIsXG4gIHVzZXJuYW1lOiBcIlwiLFxuICBwYXNzd29yZDogXCJcIixcbiAgc3luY0ZvbGRlcjogXCJibG9nXCIsXG4gIHRva2VuOiBcIlwiLFxuICBkZWZhdWx0Wm9uZTogXCJBTklNRVwiLFxuICBkZWZhdWx0VmlzaWJpbGl0eTogXCJMT0dJTl9PTkxZXCIsXG4gIGRlZmF1bHRQdWJsaXNoZWQ6IGZhbHNlLFxufTtcblxuY29uc3QgWk9ORV9TVUJGT0xERVI6IFJlY29yZDxab25lLCBzdHJpbmc+ID0ge1xuICBBTklNRTogXCIyXCIsXG4gIFJFQUw6IFwiM1wiLFxuICBGT1VSOiBcIjRcIixcbn07XG5cbi8vID09PT09IFBsdWdpbiA9PT09PVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBMcXNzYmxvZ1BsdWdpbiBleHRlbmRzIFBsdWdpbiB7XG4gIHNldHRpbmdzOiBMcXNzYmxvZ1NldHRpbmdzO1xuXG4gIGFzeW5jIG9ubG9hZCgpIHtcbiAgICBhd2FpdCB0aGlzLmxvYWRTZXR0aW5ncygpO1xuXG4gICAgLy8gUmliYm9uIGljb25cbiAgICB0aGlzLmFkZFJpYmJvbkljb24oXCJjbG91ZFwiLCBcImxxc3NibG9nIFN5bmNcIiwgKCkgPT4ge1xuICAgICAgbmV3IFN5bmNNb2RhbCh0aGlzLmFwcCwgdGhpcykub3BlbigpO1xuICAgIH0pO1xuXG4gICAgLy8gQ29tbWFuZHNcbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwicHVzaC1jdXJyZW50LW5vdGVcIixcbiAgICAgIG5hbWU6IFwiXHU2M0E4XHU5MDAxXHU1RjUzXHU1MjREXHU3QjE0XHU4QkIwXHU1MjMwXHU1MzVBXHU1QkEyXCIsXG4gICAgICBjYWxsYmFjazogKCkgPT4ge1xuICAgICAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKTtcbiAgICAgICAgaWYgKGZpbGUpIHRoaXMucHVzaE5vdGUoZmlsZSk7XG4gICAgICAgIGVsc2UgbmV3IE5vdGljZShcImxxc3NibG9nOiBcdTZDQTFcdTY3MDlcdTYyNTNcdTVGMDBcdTc2ODRcdTdCMTRcdThCQjBcIik7XG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcInB1bGwtYWxsLXBvc3RzXCIsXG4gICAgICBuYW1lOiBcIlx1NEVDRVx1NTM1QVx1NUJBMlx1NjJDOVx1NTNENlx1NTE2OFx1OTBFOFx1NjU4N1x1N0FFMFwiLFxuICAgICAgY2FsbGJhY2s6ICgpID0+IHRoaXMucHVsbEFsbFBvc3RzKCksXG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwic3luYy1hbGxcIixcbiAgICAgIG5hbWU6IFwiXHU0RTBFXHU1MzVBXHU1QkEyXHU1MTY4XHU5MUNGXHU1M0NDXHU1NDExXHU1NDBDXHU2QjY1XCIsXG4gICAgICBjYWxsYmFjazogKCkgPT4gdGhpcy5zeW5jQWxsKCksXG4gICAgfSk7XG5cbiAgICAvLyBSaWdodC1jbGljayBjb250ZXh0IG1lbnVcbiAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXG4gICAgICB0aGlzLmFwcC53b3Jrc3BhY2Uub24oXCJmaWxlLW1lbnVcIiwgKG1lbnUsIGZpbGUpID0+IHtcbiAgICAgICAgaWYgKGZpbGUgaW5zdGFuY2VvZiBURmlsZSAmJiBmaWxlLmV4dGVuc2lvbiA9PT0gXCJtZFwiKSB7XG4gICAgICAgICAgbWVudS5hZGRJdGVtKChpdGVtKSA9PiB7XG4gICAgICAgICAgICBpdGVtXG4gICAgICAgICAgICAgIC5zZXRUaXRsZShcIlx1NjNBOFx1OTAwMVx1NTIzMCBscXNzYmxvZ1wiKVxuICAgICAgICAgICAgICAuc2V0SWNvbihcInVwbG9hZC1jbG91ZFwiKVxuICAgICAgICAgICAgICAub25DbGljaygoKSA9PiB0aGlzLnB1c2hOb3RlKGZpbGUpKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICApO1xuXG4gICAgdGhpcy5hZGRTZXR0aW5nVGFiKG5ldyBMcXNzYmxvZ1NldHRpbmdUYWIodGhpcy5hcHAsIHRoaXMpKTtcbiAgfVxuXG4gIG9udW5sb2FkKCkge31cblxuICAvLyA9PT09PSBBdXRoID09PT09XG5cbiAgYXN5bmMgbG9naW4oKTogUHJvbWlzZTx7IG9rOiBib29sZWFuOyByZWFzb246IHN0cmluZyB9PiB7XG4gICAgaWYgKCF0aGlzLnNldHRpbmdzLnVzZXJuYW1lIHx8ICF0aGlzLnNldHRpbmdzLnBhc3N3b3JkKSB7XG4gICAgICByZXR1cm4geyBvazogZmFsc2UsIHJlYXNvbjogXCJcdTc1MjhcdTYyMzdcdTU0MERcdTYyMTZcdTVCQzZcdTc4MDFcdTY3MkFcdTU4NkJcdTUxOTlcIiB9O1xuICAgIH1cbiAgICBsZXQgcmVzcDogUmVxdWVzdFVybFJlc3BvbnNlO1xuICAgIHRyeSB7XG4gICAgICByZXNwID0gYXdhaXQgcmVxdWVzdFVybCh7XG4gICAgICAgIHVybDogYCR7dGhpcy5zZXR0aW5ncy5ibG9nVXJsfS9hcGkvYXV0aC9sb2dpbmAsXG4gICAgICAgIG1ldGhvZDogXCJQT1NUXCIsXG4gICAgICAgIGhlYWRlcnM6IHsgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIgfSxcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIHVzZXJuYW1lOiB0aGlzLnNldHRpbmdzLnVzZXJuYW1lLFxuICAgICAgICAgIHBhc3N3b3JkOiB0aGlzLnNldHRpbmdzLnBhc3N3b3JkLFxuICAgICAgICB9KSxcbiAgICAgICAgdGhyb3c6IGZhbHNlLFxuICAgICAgfSk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgcmV0dXJuIHsgb2s6IGZhbHNlLCByZWFzb246IGBcdTdGNTFcdTdFRENcdTk1MTlcdThCRUY6ICR7U3RyaW5nKGUpfWAgfTtcbiAgICB9XG5cbiAgICBpZiAocmVzcC5zdGF0dXMgIT09IDIwMCkge1xuICAgICAgbGV0IG1zZyA9IFwiXCI7XG4gICAgICB0cnkgeyBtc2cgPSByZXNwLmpzb24/LmVycm9yID8/IHJlc3AudGV4dDsgfSBjYXRjaCB7IG1zZyA9IFN0cmluZyhyZXNwLnN0YXR1cyk7IH1cbiAgICAgIHJldHVybiB7IG9rOiBmYWxzZSwgcmVhc29uOiBgSFRUUCAke3Jlc3Auc3RhdHVzfTogJHttc2d9YCB9O1xuICAgIH1cblxuICAgIGxldCB0b2tlbjogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICAgIHRyeSB7IHRva2VuID0gcmVzcC5qc29uPy50b2tlbjsgfSBjYXRjaCB7IC8qIGlnbm9yZSAqLyB9XG4gICAgaWYgKCF0b2tlbikge1xuICAgICAgcmV0dXJuIHsgb2s6IGZhbHNlLCByZWFzb246IFwiXHU1NENEXHU1RTk0XHU0RTJEXHU2Q0ExXHU2NzA5IHRva2VuIFx1NUI1N1x1NkJCNVwiIH07XG4gICAgfVxuXG4gICAgdGhpcy5zZXR0aW5ncy50b2tlbiA9IHRva2VuO1xuICAgIGF3YWl0IHRoaXMuc2F2ZVNldHRpbmdzKCk7XG4gICAgcmV0dXJuIHsgb2s6IHRydWUsIHJlYXNvbjogXCJcdTc2N0JcdTVGNTVcdTYyMTBcdTUyOUZcIiB9O1xuICB9XG5cbiAgZ2V0SGVhZGVycygpOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHtcbiAgICByZXR1cm4ge1xuICAgICAgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIsXG4gICAgICBDb29raWU6IGB0b2tlbj0ke3RoaXMuc2V0dGluZ3MudG9rZW59YCxcbiAgICB9O1xuICB9XG5cbiAgLy8gQXV0by1yZXRyeSB3aXRoIHJlLWxvZ2luIG9uIDQwMVxuICBhc3luYyBhcGlSZXEoXG4gICAgb3B0aW9uczogUmVxdWVzdFVybFBhcmFtLFxuICAgIHJldHJpZWQgPSBmYWxzZVxuICApOiBQcm9taXNlPFJlcXVlc3RVcmxSZXNwb25zZT4ge1xuICAgIGNvbnN0IHJlc3AgPSBhd2FpdCByZXF1ZXN0VXJsKHtcbiAgICAgIC4uLm9wdGlvbnMsXG4gICAgICBoZWFkZXJzOiB7IC4uLnRoaXMuZ2V0SGVhZGVycygpLCAuLi4ob3B0aW9ucy5oZWFkZXJzID8/IHt9KSB9LFxuICAgICAgdGhyb3c6IGZhbHNlLFxuICAgIH0pO1xuICAgIGlmIChyZXNwLnN0YXR1cyA9PT0gNDAxICYmICFyZXRyaWVkKSB7XG4gICAgICBjb25zdCB7IG9rIH0gPSBhd2FpdCB0aGlzLmxvZ2luKCk7XG4gICAgICBpZiAob2spIHJldHVybiB0aGlzLmFwaVJlcShvcHRpb25zLCB0cnVlKTtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3A7XG4gIH1cblxuICAvLyA9PT09PSBBUEkgPT09PT1cblxuICBhc3luYyBmZXRjaE15UG9zdHMoKTogUHJvbWlzZTxCbG9nUG9zdFtdPiB7XG4gICAgY29uc3QgcmVzcCA9IGF3YWl0IHRoaXMuYXBpUmVxKHtcbiAgICAgIHVybDogYCR7dGhpcy5zZXR0aW5ncy5ibG9nVXJsfS9hcGkvdXNlci9wb3N0c2AsXG4gICAgfSk7XG4gICAgaWYgKHJlc3Auc3RhdHVzICE9PSAyMDApIHJldHVybiBbXTtcbiAgICByZXR1cm4gKHJlc3AuanNvbiBhcyB7IHBvc3RzOiBCbG9nUG9zdFtdIH0pLnBvc3RzID8/IFtdO1xuICB9XG5cbiAgYXN5bmMgY3JlYXRlUG9zdChkYXRhOiB7XG4gICAgdGl0bGU6IHN0cmluZztcbiAgICBjb250ZW50OiBzdHJpbmc7XG4gICAgem9uZTogWm9uZTtcbiAgICB2aXNpYmlsaXR5OiBWaXNpYmlsaXR5O1xuICAgIHB1Ymxpc2hlZDogYm9vbGVhbjtcbiAgICB0YWdzOiBzdHJpbmdbXTtcbiAgfSk6IFByb21pc2U8QmxvZ1Bvc3QgfCBudWxsPiB7XG4gICAgY29uc3QgcmVzcCA9IGF3YWl0IHRoaXMuYXBpUmVxKHtcbiAgICAgIHVybDogYCR7dGhpcy5zZXR0aW5ncy5ibG9nVXJsfS9hcGkvcG9zdHNgLFxuICAgICAgbWV0aG9kOiBcIlBPU1RcIixcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KGRhdGEpLFxuICAgIH0pO1xuICAgIGlmIChyZXNwLnN0YXR1cyAhPT0gMjAxKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4gKHJlc3AuanNvbiBhcyB7IHBvc3Q6IEJsb2dQb3N0IH0pLnBvc3QgPz8gbnVsbDtcbiAgfVxuXG4gIGFzeW5jIHVwZGF0ZVBvc3QoXG4gICAgaWQ6IHN0cmluZyxcbiAgICBkYXRhOiB7XG4gICAgICB0aXRsZTogc3RyaW5nO1xuICAgICAgY29udGVudDogc3RyaW5nO1xuICAgICAgem9uZTogWm9uZTtcbiAgICAgIHZpc2liaWxpdHk6IFZpc2liaWxpdHk7XG4gICAgICBwdWJsaXNoZWQ6IGJvb2xlYW47XG4gICAgICB0YWdzOiBzdHJpbmdbXTtcbiAgICB9XG4gICk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGNvbnN0IHJlc3AgPSBhd2FpdCB0aGlzLmFwaVJlcSh7XG4gICAgICB1cmw6IGAke3RoaXMuc2V0dGluZ3MuYmxvZ1VybH0vYXBpL3Bvc3RzLyR7aWR9YCxcbiAgICAgIG1ldGhvZDogXCJQVVRcIixcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KGRhdGEpLFxuICAgIH0pO1xuICAgIHJldHVybiByZXNwLnN0YXR1cyA9PT0gMjAwO1xuICB9XG5cbiAgLy8gPT09PT0gQ29yZSBTeW5jID09PT09XG5cbiAgLyoqIERldGVjdCB6b25lIGZyb20gZmlsZSBwYXRoIChibG9nLzIvIFx1MjE5MiBBTklNRSwgYmxvZy8zLyBcdTIxOTIgUkVBTCwgYmxvZy80LyBcdTIxOTIgRk9VUikuICovXG4gIGRldGVjdFpvbmVGcm9tUGF0aChmaWxlUGF0aDogc3RyaW5nKTogWm9uZSB8IG51bGwge1xuICAgIGZvciAoY29uc3QgW3pvbmUsIHN1Yl0gb2YgT2JqZWN0LmVudHJpZXMoWk9ORV9TVUJGT0xERVIpIGFzIFtab25lLCBzdHJpbmddW10pIHtcbiAgICAgIGlmIChmaWxlUGF0aC5zdGFydHNXaXRoKGAke3RoaXMuc2V0dGluZ3Muc3luY0ZvbGRlcn0vJHtzdWJ9L2ApKSB7XG4gICAgICAgIHJldHVybiB6b25lO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIC8qKiBQdXNoIGEgc2luZ2xlIG5vdGUuIFpvbmUgcHJpb3JpdHk6IGZyb250bWF0dGVyID4gZmlsZSBwYXRoID4gc2V0dGluZ3MgZGVmYXVsdC4gKi9cbiAgYXN5bmMgcHVzaE5vdGUoZmlsZTogVEZpbGUpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMuc2V0dGluZ3MudXNlcm5hbWUgfHwgIXRoaXMuc2V0dGluZ3MucGFzc3dvcmQpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJscXNzYmxvZzogXHU4QkY3XHU1MTQ4XHU1NzI4XHU2M0QyXHU0RUY2XHU4QkJFXHU3RjZFXHU5MUNDXHU1ODZCXHU1MTk5XHU3NTI4XHU2MjM3XHU1NDBEXHU1NDhDXHU1QkM2XHU3ODAxXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGZtID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUoZmlsZSk/LmZyb250bWF0dGVyID8/IHt9O1xuICAgIGNvbnN0IHpvbmUgPVxuICAgICAgKGZtW1wiYmxvZy16b25lXCJdIGFzIFpvbmUgfCB1bmRlZmluZWQpID8/XG4gICAgICB0aGlzLmRldGVjdFpvbmVGcm9tUGF0aChmaWxlLnBhdGgpID8/XG4gICAgICB0aGlzLnNldHRpbmdzLmRlZmF1bHRab25lO1xuXG4gICAgYXdhaXQgdGhpcy5kb1B1c2goZmlsZSwgZm0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIGZtW1wiYmxvZy1pZFwiXSBhcyBzdHJpbmcgfCB1bmRlZmluZWQsIHpvbmUpO1xuICB9XG5cbiAgLyoqIEFjdHVhbGx5IHB1c2ggdGhlIG5vdGUgKGNhbGxlZCBhZnRlciB6b25lIGlzIGNvbmZpcm1lZCkuICovXG4gIGFzeW5jIGRvUHVzaChcbiAgICBmaWxlOiBURmlsZSxcbiAgICBmbTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4gICAgYmxvZ0lkOiBzdHJpbmcgfCB1bmRlZmluZWQsXG4gICAgem9uZTogWm9uZVxuICApOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBjb25zdCByYXdDb250ZW50ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQucmVhZChmaWxlKTtcbiAgICBjb25zdCBib2R5ID0gc3RyaXBGcm9udG1hdHRlcihyYXdDb250ZW50KTtcblxuICAgIGNvbnN0IHRpdGxlID0gKGZtW1widGl0bGVcIl0gYXMgc3RyaW5nKSB8fCBmaWxlLmJhc2VuYW1lO1xuICAgIGNvbnN0IHZpc2liaWxpdHkgPSAoZm1bXCJibG9nLXZpc2liaWxpdHlcIl0gYXMgVmlzaWJpbGl0eSkgfHwgdGhpcy5zZXR0aW5ncy5kZWZhdWx0VmlzaWJpbGl0eTtcbiAgICBjb25zdCBwdWJsaXNoZWQgPSAoZm1bXCJibG9nLXB1Ymxpc2hlZFwiXSBhcyBib29sZWFuKSA/PyB0aGlzLnNldHRpbmdzLmRlZmF1bHRQdWJsaXNoZWQ7XG4gICAgY29uc3QgdGFncyA9IHBhcnNlVGFncyhmbVtcInRhZ3NcIl0pO1xuXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgIGNvbnN0IGRhdGEgPSB7IHRpdGxlLCBjb250ZW50OiBib2R5LCB6b25lLCB2aXNpYmlsaXR5LCBwdWJsaXNoZWQsIHRhZ3MgfTtcblxuICAgIGlmIChibG9nSWQpIHtcbiAgICAgIGNvbnN0IG9rID0gYXdhaXQgdGhpcy51cGRhdGVQb3N0KGJsb2dJZCwgZGF0YSk7XG4gICAgICBpZiAoIW9rKSB7XG4gICAgICAgIG5ldyBOb3RpY2UoYGxxc3NibG9nOiBcdTI3MTcgXHU2NkY0XHU2NUIwXHU1OTMxXHU4RDI1IFx1MjAxNFx1MzAwQyR7dGl0bGV9XHUzMDBEYCk7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgcG9zdCA9IGF3YWl0IHRoaXMuY3JlYXRlUG9zdChkYXRhKTtcbiAgICAgIGlmICghcG9zdCkge1xuICAgICAgICBuZXcgTm90aWNlKGBscXNzYmxvZzogXHUyNzE3IFx1NTNEMVx1NUUwM1x1NTkzMVx1OEQyNSBcdTIwMTRcdTMwMEMke3RpdGxlfVx1MzAwRGApO1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgICBibG9nSWQgPSBwb3N0LmlkO1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuYXBwLmZpbGVNYW5hZ2VyLnByb2Nlc3NGcm9udE1hdHRlcihmaWxlLCAoZikgPT4ge1xuICAgICAgZltcImJsb2ctaWRcIl0gPSBibG9nSWQ7XG4gICAgICBmW1wiYmxvZy16b25lXCJdID0gem9uZTtcbiAgICAgIGZbXCJibG9nLXZpc2liaWxpdHlcIl0gPSB2aXNpYmlsaXR5O1xuICAgICAgZltcImJsb2ctcHVibGlzaGVkXCJdID0gcHVibGlzaGVkO1xuICAgICAgZltcImJsb2ctc3luY2VkLWF0XCJdID0gbm93O1xuICAgICAgZltcImJsb2ctdXBkYXRlZC1hdFwiXSA9IG5vdztcbiAgICB9KTtcblxuICAgIG5ldyBOb3RpY2UoYGxxc3NibG9nOiBcdTI3MTMgXHU1REYyXHU2M0E4XHU5MDAxXHUzMDBDJHt0aXRsZX1cdTMwMEQke3B1Ymxpc2hlZCA/IFwiXCIgOiBcIlx1RkYwOFx1ODM0OVx1N0EzRlx1RkYwOVwifWApO1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgLyoqIFB1bGwgYWxsIHVzZXIncyBwb3N0cyBmcm9tIHRoZSBibG9nIGludG8gdGhlIHN5bmMgZm9sZGVyLiAqL1xuICBhc3luYyBwdWxsQWxsUG9zdHMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCF0aGlzLnNldHRpbmdzLnVzZXJuYW1lIHx8ICF0aGlzLnNldHRpbmdzLnBhc3N3b3JkKSB7XG4gICAgICBuZXcgTm90aWNlKFwibHFzc2Jsb2c6IFx1OEJGN1x1NTE0OFx1NTcyOFx1NjNEMlx1NEVGNlx1OEJCRVx1N0Y2RVx1OTFDQ1x1NTg2Qlx1NTE5OVx1NzUyOFx1NjIzN1x1NTQwRFx1NTQ4Q1x1NUJDNlx1NzgwMVwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBuZXcgTm90aWNlKFwibHFzc2Jsb2c6IFx1NkI2M1x1NTcyOFx1NjJDOVx1NTNENlx1MjAyNlwiKTtcbiAgICBjb25zdCBwb3N0cyA9IGF3YWl0IHRoaXMuZmV0Y2hNeVBvc3RzKCk7XG5cbiAgICBpZiAoIXBvc3RzLmxlbmd0aCkge1xuICAgICAgbmV3IE5vdGljZShcImxxc3NibG9nOiBcdTUzNUFcdTVCQTJcdTRFMEFcdThGRDhcdTZDQTFcdTY3MDlcdTY1ODdcdTdBRTBcIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5lbnN1cmVTeW5jRm9sZGVyKCk7XG5cbiAgICBsZXQgcHVsbGVkID0gMCwgc2tpcHBlZCA9IDA7XG5cbiAgICBmb3IgKGNvbnN0IHBvc3Qgb2YgcG9zdHMpIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5maW5kRmlsZUJ5QmxvZ0lkKHBvc3QuaWQpO1xuICAgICAgY29uc3Qgc3luY2VkQXQgPSBleGlzdGluZ1xuICAgICAgICA/ICh0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShleGlzdGluZyk/LmZyb250bWF0dGVyPy5bXG4gICAgICAgICAgICBcImJsb2ctc3luY2VkLWF0XCJcbiAgICAgICAgICBdIGFzIHN0cmluZyB8IHVuZGVmaW5lZClcbiAgICAgICAgOiB1bmRlZmluZWQ7XG5cbiAgICAgIGNvbnN0IGJsb2dVcGRhdGVkQXQgPSBuZXcgRGF0ZShwb3N0LnVwZGF0ZWRBdCkuZ2V0VGltZSgpO1xuICAgICAgY29uc3QgbGFzdFN5bmNUaW1lID0gc3luY2VkQXQgPyBuZXcgRGF0ZShzeW5jZWRBdCkuZ2V0VGltZSgpIDogMDtcblxuICAgICAgaWYgKGV4aXN0aW5nICYmIGJsb2dVcGRhdGVkQXQgPD0gbGFzdFN5bmNUaW1lKSB7XG4gICAgICAgIHNraXBwZWQrKztcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNvbnRlbnQgPSBidWlsZE5vdGVDb250ZW50KHBvc3QpO1xuICAgICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0Lm1vZGlmeShleGlzdGluZywgY29udGVudCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCBwYXRoID0gYXdhaXQgdGhpcy51bmlxdWVQYXRoKFxuICAgICAgICAgIGAke3RoaXMuem9uZUZvbGRlcihwb3N0LnpvbmUpfS8ke3NhZmVGaWxlbmFtZShwb3N0LnRpdGxlKSB8fCBwb3N0LmlkfS5tZGBcbiAgICAgICAgKTtcbiAgICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuY3JlYXRlKHBhdGgsIGNvbnRlbnQpO1xuICAgICAgfVxuICAgICAgcHVsbGVkKys7XG4gICAgfVxuXG4gICAgbmV3IE5vdGljZShgbHFzc2Jsb2c6IFx1NjJDOVx1NTNENlx1NUI4Q1x1NjIxMCBcdTIwMTRcdTIwMTQgXHU2NkY0XHU2NUIwICR7cHVsbGVkfSBcdTdCQzdcdUZGMENcdThERjNcdThGQzcgJHtza2lwcGVkfSBcdTdCQzdgKTtcbiAgfVxuXG4gIC8qKiBGdWxsIGJpZGlyZWN0aW9uYWwgc3luYy4gKi9cbiAgYXN5bmMgc3luY0FsbCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMuc2V0dGluZ3MudXNlcm5hbWUgfHwgIXRoaXMuc2V0dGluZ3MucGFzc3dvcmQpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJscXNzYmxvZzogXHU4QkY3XHU1MTQ4XHU1NzI4XHU2M0QyXHU0RUY2XHU4QkJFXHU3RjZFXHU5MUNDXHU1ODZCXHU1MTk5XHU3NTI4XHU2MjM3XHU1NDBEXHU1NDhDXHU1QkM2XHU3ODAxXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIG5ldyBOb3RpY2UoXCJscXNzYmxvZzogXHU1RjAwXHU1OUNCXHU1M0NDXHU1NDExXHU1NDBDXHU2QjY1XHUyMDI2XCIpO1xuICAgIGNvbnN0IHBvc3RzID0gYXdhaXQgdGhpcy5mZXRjaE15UG9zdHMoKTtcbiAgICBjb25zdCBibG9nTWFwID0gbmV3IE1hcDxzdHJpbmcsIEJsb2dQb3N0Pihwb3N0cy5tYXAoKHApID0+IFtwLmlkLCBwXSkpO1xuXG4gICAgYXdhaXQgdGhpcy5lbnN1cmVTeW5jRm9sZGVyKCk7XG5cbiAgICBsZXQgcHVzaGVkID0gMCwgcHVsbGVkID0gMCwgY29uZmxpY3RzID0gMCwgY3JlYXRlZCA9IDA7XG4gICAgY29uc3QgcHJvY2Vzc2VkSWRzID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgICAvLyBQcm9jZXNzIGFsbCBsb2NhbCBmaWxlc1xuICAgIGZvciAoY29uc3QgZmlsZSBvZiB0aGlzLmFwcC52YXVsdC5nZXRNYXJrZG93bkZpbGVzKCkpIHtcbiAgICAgIGNvbnN0IGZtID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUoZmlsZSk/LmZyb250bWF0dGVyID8/IHt9O1xuICAgICAgY29uc3QgYmxvZ0lkID0gZm1bXCJibG9nLWlkXCJdIGFzIHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICAgIGNvbnN0IHpvbmUgPSBmbVtcImJsb2ctem9uZVwiXSBhcyBab25lIHwgdW5kZWZpbmVkO1xuXG4gICAgICBpZiAoIWJsb2dJZCkge1xuICAgICAgICAvLyBOZXcgbG9jYWwgZmlsZTogZGV0ZWN0IHpvbmUgZnJvbSBwYXRoIG9yIGZyb250bWF0dGVyXG4gICAgICAgIGNvbnN0IGRldGVjdGVkWm9uZSA9XG4gICAgICAgICAgKGZtW1wiYmxvZy16b25lXCJdIGFzIFpvbmUgfCB1bmRlZmluZWQpID8/IHRoaXMuZGV0ZWN0Wm9uZUZyb21QYXRoKGZpbGUucGF0aCk7XG4gICAgICAgIGlmIChkZXRlY3RlZFpvbmUgJiYgZmlsZS5wYXRoLnN0YXJ0c1dpdGgodGhpcy5zZXR0aW5ncy5zeW5jRm9sZGVyICsgXCIvXCIpKSB7XG4gICAgICAgICAgY29uc3Qgb2sgPSBhd2FpdCB0aGlzLmRvUHVzaChmaWxlLCBmbSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgdW5kZWZpbmVkLCBkZXRlY3RlZFpvbmUpO1xuICAgICAgICAgIGlmIChvaykgY3JlYXRlZCsrO1xuICAgICAgICB9XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBwcm9jZXNzZWRJZHMuYWRkKGJsb2dJZCk7XG4gICAgICBjb25zdCBibG9nUG9zdCA9IGJsb2dNYXAuZ2V0KGJsb2dJZCk7XG4gICAgICBpZiAoIWJsb2dQb3N0KSBjb250aW51ZTsgLy8gcG9zdCBkZWxldGVkIG9uIGJsb2cgc2lkZSBcdTIwMTQgc2tpcFxuXG4gICAgICBjb25zdCBzeW5jZWRBdCA9IGZtW1wiYmxvZy1zeW5jZWQtYXRcIl0gYXMgc3RyaW5nIHwgdW5kZWZpbmVkO1xuICAgICAgY29uc3QgbGFzdFN5bmNUaW1lID0gc3luY2VkQXQgPyBuZXcgRGF0ZShzeW5jZWRBdCkuZ2V0VGltZSgpIDogMDtcbiAgICAgIGNvbnN0IGJsb2dVcGRhdGVkQXQgPSBuZXcgRGF0ZShibG9nUG9zdC51cGRhdGVkQXQpLmdldFRpbWUoKTtcbiAgICAgIGNvbnN0IGxvY2FsVXBkYXRlZEF0ID0gZmlsZS5zdGF0Lm10aW1lO1xuICAgICAgY29uc3QgQlVGRkVSID0gNV8wMDA7IC8vIDVzIHRvbGVyYW5jZSBmb3IgY2xvY2sgc2tld1xuXG4gICAgICBjb25zdCBibG9nTmV3ZXIgPSBibG9nVXBkYXRlZEF0ID4gbGFzdFN5bmNUaW1lICsgQlVGRkVSO1xuICAgICAgY29uc3QgbG9jYWxOZXdlciA9IGxvY2FsVXBkYXRlZEF0ID4gbGFzdFN5bmNUaW1lICsgQlVGRkVSO1xuXG4gICAgICBpZiAoYmxvZ05ld2VyICYmIGxvY2FsTmV3ZXIpIHtcbiAgICAgICAgY29uZmxpY3RzKys7XG4gICAgICAgIG5ldyBOb3RpY2UoXG4gICAgICAgICAgYGxxc3NibG9nOiBcdTI2QTAgXHU1MUIyXHU3QTgxIFx1MjAxNFx1MzAwQyR7ZmlsZS5iYXNlbmFtZX1cdTMwMERcdTY3MkNcdTU3MzBcdTU0OENcdThGRENcdTdBRUZcdTkwRkRcdTY3MDlcdTY2RjRcdTY1MzlcdUZGMENcdTVERjJcdThERjNcdThGQzdcdUZGMENcdThCRjdcdTYyNEJcdTUyQThcdTU5MDRcdTc0MDZgXG4gICAgICAgICk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBpZiAobG9jYWxOZXdlcikge1xuICAgICAgICBjb25zdCBvayA9IGF3YWl0IHRoaXMuZG9QdXNoKFxuICAgICAgICAgIGZpbGUsXG4gICAgICAgICAgZm0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4gICAgICAgICAgYmxvZ0lkLFxuICAgICAgICAgIHpvbmUgPz8gKGJsb2dQb3N0LnpvbmUgYXMgWm9uZSlcbiAgICAgICAgKTtcbiAgICAgICAgaWYgKG9rKSBwdXNoZWQrKztcbiAgICAgIH0gZWxzZSBpZiAoYmxvZ05ld2VyKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0Lm1vZGlmeShmaWxlLCBidWlsZE5vdGVDb250ZW50KGJsb2dQb3N0KSk7XG4gICAgICAgIHB1bGxlZCsrO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFB1bGwgcG9zdHMgZnJvbSBibG9nIHRoYXQgZG9uJ3QgZXhpc3QgbG9jYWxseSB5ZXRcbiAgICBmb3IgKGNvbnN0IHBvc3Qgb2YgcG9zdHMpIHtcbiAgICAgIGlmIChwcm9jZXNzZWRJZHMuaGFzKHBvc3QuaWQpKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IHBhdGggPSBhd2FpdCB0aGlzLnVuaXF1ZVBhdGgoXG4gICAgICAgIGAke3RoaXMuem9uZUZvbGRlcihwb3N0LnpvbmUpfS8ke3NhZmVGaWxlbmFtZShwb3N0LnRpdGxlKSB8fCBwb3N0LmlkfS5tZGBcbiAgICAgICk7XG4gICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5jcmVhdGUocGF0aCwgYnVpbGROb3RlQ29udGVudChwb3N0KSk7XG4gICAgICBwdWxsZWQrKztcbiAgICB9XG5cbiAgICBjb25zdCBzdW1tYXJ5ID0gW1xuICAgICAgYFx1MjE5MSBcdTYzQThcdTkwMDEgJHtwdXNoZWQgKyBjcmVhdGVkfWAsXG4gICAgICBgXHUyMTkzIFx1NjJDOVx1NTNENiAke3B1bGxlZH1gLFxuICAgICAgY29uZmxpY3RzID8gYFx1MjZBMCAke2NvbmZsaWN0c30gXHU0RTJBXHU1MUIyXHU3QTgxYCA6IFwiXCIsXG4gICAgXVxuICAgICAgLmZpbHRlcihCb29sZWFuKVxuICAgICAgLmpvaW4oXCIgICBcIik7XG5cbiAgICBuZXcgTm90aWNlKGBscXNzYmxvZzogXHU1NDBDXHU2QjY1XHU1QjhDXHU2MjEwIFx1MjAxNFx1MjAxNCAke3N1bW1hcnl9YCk7XG4gIH1cblxuICAvLyA9PT09PSBIZWxwZXJzID09PT09XG5cbiAgZmluZEZpbGVCeUJsb2dJZChibG9nSWQ6IHN0cmluZyk6IFRGaWxlIHwgbnVsbCB7XG4gICAgZm9yIChjb25zdCBmaWxlIG9mIHRoaXMuYXBwLnZhdWx0LmdldE1hcmtkb3duRmlsZXMoKSkge1xuICAgICAgY29uc3QgZm0gPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShmaWxlKT8uZnJvbnRtYXR0ZXI7XG4gICAgICBpZiAoZm0/LltcImJsb2ctaWRcIl0gPT09IGJsb2dJZCkgcmV0dXJuIGZpbGU7XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgem9uZUZvbGRlcih6b25lOiBab25lKTogc3RyaW5nIHtcbiAgICByZXR1cm4gYCR7dGhpcy5zZXR0aW5ncy5zeW5jRm9sZGVyfS8ke1pPTkVfU1VCRk9MREVSW3pvbmVdfWA7XG4gIH1cblxuICBhc3luYyBlbnN1cmVTeW5jRm9sZGVyKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHJvb3QgPSB0aGlzLnNldHRpbmdzLnN5bmNGb2xkZXI7XG4gICAgaWYgKCEoYXdhaXQgdGhpcy5hcHAudmF1bHQuYWRhcHRlci5leGlzdHMocm9vdCkpKSB7XG4gICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5jcmVhdGVGb2xkZXIocm9vdCk7XG4gICAgfVxuICAgIGZvciAoY29uc3Qgc3ViIG9mIE9iamVjdC52YWx1ZXMoWk9ORV9TVUJGT0xERVIpKSB7XG4gICAgICBjb25zdCBwYXRoID0gYCR7cm9vdH0vJHtzdWJ9YDtcbiAgICAgIGlmICghKGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIuZXhpc3RzKHBhdGgpKSkge1xuICAgICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5jcmVhdGVGb2xkZXIocGF0aCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgdW5pcXVlUGF0aChwYXRoOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGlmICghKGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIuZXhpc3RzKHBhdGgpKSkgcmV0dXJuIHBhdGg7XG4gICAgY29uc3QgYmFzZSA9IHBhdGgucmVwbGFjZSgvXFwubWQkLywgXCJcIik7XG4gICAgbGV0IGkgPSAxO1xuICAgIHdoaWxlIChhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLmV4aXN0cyhgJHtiYXNlfS0ke2l9Lm1kYCkpIGkrKztcbiAgICByZXR1cm4gYCR7YmFzZX0tJHtpfS5tZGA7XG4gIH1cblxuICBhc3luYyBsb2FkU2V0dGluZ3MoKSB7XG4gICAgdGhpcy5zZXR0aW5ncyA9IE9iamVjdC5hc3NpZ24oe30sIERFRkFVTFRfU0VUVElOR1MsIGF3YWl0IHRoaXMubG9hZERhdGEoKSk7XG4gIH1cblxuICBhc3luYyBzYXZlU2V0dGluZ3MoKSB7XG4gICAgYXdhaXQgdGhpcy5zYXZlRGF0YSh0aGlzLnNldHRpbmdzKTtcbiAgfVxufVxuXG4vLyA9PT09PSBTeW5jIE1vZGFsIChSaWJib24gY2xpY2spID09PT09XG5cbmNsYXNzIFN5bmNNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgcGx1Z2luOiBMcXNzYmxvZ1BsdWdpbjtcblxuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgcGx1Z2luOiBMcXNzYmxvZ1BsdWdpbikge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gIH1cblxuICBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmFkZENsYXNzKFwibHFzcy1tb2RhbFwiKTtcbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJoM1wiLCB7IHRleHQ6IFwibHFzc2Jsb2cgU3luY1wiIH0pO1xuXG4gICAgY29uc3QgZ3JpZCA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwibHFzcy1ncmlkXCIgfSk7XG5cbiAgICB0aGlzLmJ0bihncmlkLCBcIlx1MjE5MVwiLCBcIlx1NjNBOFx1OTAwMVx1NUY1M1x1NTI0RFx1N0IxNFx1OEJCMFwiLCBcInVwbG9hZC1jbG91ZFwiLCAoKSA9PiB7XG4gICAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKTtcbiAgICAgIGlmIChmaWxlKSB0aGlzLnBsdWdpbi5wdXNoTm90ZShmaWxlKTtcbiAgICAgIGVsc2UgbmV3IE5vdGljZShcImxxc3NibG9nOiBcdTZDQTFcdTY3MDlcdTYyNTNcdTVGMDBcdTc2ODRcdTdCMTRcdThCQjBcIik7XG4gICAgfSk7XG5cbiAgICB0aGlzLmJ0bihncmlkLCBcIlx1MjE5M1wiLCBcIlx1NjJDOVx1NTNENlx1NTE2OFx1OTBFOFx1NjU4N1x1N0FFMFwiLCBcImRvd25sb2FkLWNsb3VkXCIsICgpID0+IHtcbiAgICAgIHRoaXMucGx1Z2luLnB1bGxBbGxQb3N0cygpO1xuICAgIH0pO1xuXG4gICAgdGhpcy5idG4oZ3JpZCwgXCJcdTIxQzVcIiwgXCJcdTUxNjhcdTkxQ0ZcdTUzQ0NcdTU0MTFcdTU0MENcdTZCNjVcIiwgXCJyZWZyZXNoLWN3XCIsICgpID0+IHtcbiAgICAgIHRoaXMucGx1Z2luLnN5bmNBbGwoKTtcbiAgICB9KTtcbiAgfVxuXG4gIGJ0bihcbiAgICBwYXJlbnQ6IEhUTUxFbGVtZW50LFxuICAgIGljb246IHN0cmluZyxcbiAgICBsYWJlbDogc3RyaW5nLFxuICAgIF9sdWNpZGU6IHN0cmluZyxcbiAgICBvbkNsaWNrOiAoKSA9PiB2b2lkXG4gICkge1xuICAgIGNvbnN0IGJ0biA9IHBhcmVudC5jcmVhdGVFbChcImJ1dHRvblwiLCB7IGNsczogXCJscXNzLWFjdGlvbi1idG5cIiB9KTtcbiAgICBidG4uY3JlYXRlRWwoXCJzcGFuXCIsIHsgY2xzOiBcImxxc3MtYnRuLWljb25cIiwgdGV4dDogaWNvbiB9KTtcbiAgICBidG4uY3JlYXRlRWwoXCJzcGFuXCIsIHsgY2xzOiBcImxxc3MtYnRuLWxhYmVsXCIsIHRleHQ6IGxhYmVsIH0pO1xuICAgIGJ0bi5vbmNsaWNrID0gKCkgPT4ge1xuICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgb25DbGljaygpO1xuICAgIH07XG4gIH1cblxuICBvbkNsb3NlKCkge1xuICAgIHRoaXMuY29udGVudEVsLmVtcHR5KCk7XG4gIH1cbn1cblxuLy8gPT09PT0gUHVibGlzaCBNb2RhbCAoZmlyc3QtdGltZSBwdXNoLCBubyB6b25lIHNldCkgPT09PT1cblxuY2xhc3MgUHVibGlzaE1vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBwbHVnaW46IExxc3NibG9nUGx1Z2luO1xuICBmaWxlOiBURmlsZTtcblxuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgcGx1Z2luOiBMcXNzYmxvZ1BsdWdpbiwgZmlsZTogVEZpbGUpIHtcbiAgICBzdXBlcihhcHApO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICAgIHRoaXMuZmlsZSA9IGZpbGU7XG4gIH1cblxuICBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29uc3QgZm0gPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZSh0aGlzLmZpbGUpPy5mcm9udG1hdHRlciA/PyB7fTtcblxuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcImgzXCIsIHsgdGV4dDogXCJcdTUzRDFcdTVFMDNcdTUyMzAgbHFzc2Jsb2dcIiB9KTtcblxuICAgIGxldCB0aXRsZSA9IChmbVtcInRpdGxlXCJdIGFzIHN0cmluZykgfHwgdGhpcy5maWxlLmJhc2VuYW1lO1xuICAgIGxldCB6b25lOiBab25lID0gXCJBTklNRVwiO1xuICAgIGxldCB2aXNpYmlsaXR5OiBWaXNpYmlsaXR5ID0gXCJMT0dJTl9PTkxZXCI7XG4gICAgbGV0IHB1Ymxpc2hlZCA9IGZhbHNlO1xuICAgIGxldCB0YWdzID0gcGFyc2VUYWdzKGZtW1widGFnc1wiXSkuam9pbihcIiwgXCIpO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgLnNldE5hbWUoXCJcdTY4MDdcdTk4OThcIilcbiAgICAgIC5hZGRUZXh0KCh0KSA9PlxuICAgICAgICB0LnNldFZhbHVlKHRpdGxlKS5vbkNoYW5nZSgodikgPT4gKHRpdGxlID0gdikpXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgLnNldE5hbWUoXCJcdTUyMDZcdTUzM0FcIilcbiAgICAgIC5hZGREcm9wZG93bigoZCkgPT4ge1xuICAgICAgICBkLmFkZE9wdGlvbihcIkFOSU1FXCIsIFwiMlwiKTtcbiAgICAgICAgZC5hZGRPcHRpb24oXCJSRUFMXCIsIFwiM1wiKTtcbiAgICAgICAgZC5hZGRPcHRpb24oXCJGT1VSXCIsIFwiNFwiKTtcbiAgICAgICAgZC5zZXRWYWx1ZSh6b25lKS5vbkNoYW5nZSgodikgPT4gKHpvbmUgPSB2IGFzIFpvbmUpKTtcbiAgICAgIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgLnNldE5hbWUoXCJcdTUzRUZcdTg5QzFcdTYwMjdcIilcbiAgICAgIC5hZGREcm9wZG93bigoZCkgPT4ge1xuICAgICAgICBkLmFkZE9wdGlvbihcIkxPR0lOX09OTFlcIiwgXCJcdTRFQzVcdTc2N0JcdTVGNTVcdTc1MjhcdTYyMzdcIik7XG4gICAgICAgIGQuYWRkT3B0aW9uKFwiUFVCTElDXCIsIFwiXHU1MTZDXHU1RjAwXCIpO1xuICAgICAgICBkLmFkZE9wdGlvbihcIkZSSUVORFNfT05MWVwiLCBcIlx1NEVDNVx1NTk3RFx1NTNDQlwiKTtcbiAgICAgICAgZC5zZXRWYWx1ZSh2aXNpYmlsaXR5KS5vbkNoYW5nZSgodikgPT4gKHZpc2liaWxpdHkgPSB2IGFzIFZpc2liaWxpdHkpKTtcbiAgICAgIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgLnNldE5hbWUoXCJcdTY4MDdcdTdCN0VcIilcbiAgICAgIC5zZXREZXNjKFwiXHU1OTFBXHU0RTJBXHU2ODA3XHU3QjdFXHU3NTI4XHU5MDE3XHU1M0Y3XHU1MjA2XHU5Njk0XCIpXG4gICAgICAuYWRkVGV4dCgodCkgPT5cbiAgICAgICAgdFxuICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcihcInRhZzEsIHRhZzJcIilcbiAgICAgICAgICAuc2V0VmFsdWUodGFncylcbiAgICAgICAgICAub25DaGFuZ2UoKHYpID0+ICh0YWdzID0gdikpXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgLnNldE5hbWUoXCJcdTdBQ0JcdTUzNzNcdTUzRDFcdTVFMDNcIilcbiAgICAgIC5zZXREZXNjKFwiXHU1MTczXHU5NUVEXHU1MjE5XHU0RkREXHU1QjU4XHU0RTNBXHU4MzQ5XHU3QTNGXCIpXG4gICAgICAuYWRkVG9nZ2xlKCh0KSA9PlxuICAgICAgICB0LnNldFZhbHVlKHB1Ymxpc2hlZCkub25DaGFuZ2UoKHYpID0+IChwdWJsaXNoZWQgPSB2KSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpLmFkZEJ1dHRvbigoYnRuKSA9PlxuICAgICAgYnRuXG4gICAgICAgIC5zZXRCdXR0b25UZXh0KFwiXHU1M0QxXHU1RTAzXCIpXG4gICAgICAgIC5zZXRDdGEoKVxuICAgICAgICAub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgICAgIGNvbnN0IHRhZ0xpc3QgPSB0YWdzXG4gICAgICAgICAgICAuc3BsaXQoXCIsXCIpXG4gICAgICAgICAgICAubWFwKCh0KSA9PiB0LnRyaW0oKSlcbiAgICAgICAgICAgIC5maWx0ZXIoQm9vbGVhbik7XG4gICAgICAgICAgLy8gV3JpdGUgbWV0YSB0byBmcm9udG1hdHRlciBmaXJzdCBzbyBkb1B1c2ggY2FuIHJlYWQgaXRcbiAgICAgICAgICBhd2FpdCB0aGlzLmFwcC5maWxlTWFuYWdlci5wcm9jZXNzRnJvbnRNYXR0ZXIodGhpcy5maWxlLCAoZikgPT4ge1xuICAgICAgICAgICAgZltcInRpdGxlXCJdID0gdGl0bGU7XG4gICAgICAgICAgICBmW1wiYmxvZy16b25lXCJdID0gem9uZTtcbiAgICAgICAgICAgIGZbXCJibG9nLXZpc2liaWxpdHlcIl0gPSB2aXNpYmlsaXR5O1xuICAgICAgICAgICAgZltcImJsb2ctcHVibGlzaGVkXCJdID0gcHVibGlzaGVkO1xuICAgICAgICAgICAgZltcInRhZ3NcIl0gPSB0YWdMaXN0O1xuICAgICAgICAgIH0pO1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLmRvUHVzaChcbiAgICAgICAgICAgIHRoaXMuZmlsZSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgdGl0bGUsXG4gICAgICAgICAgICAgIFwiYmxvZy16b25lXCI6IHpvbmUsXG4gICAgICAgICAgICAgIFwiYmxvZy12aXNpYmlsaXR5XCI6IHZpc2liaWxpdHksXG4gICAgICAgICAgICAgIFwiYmxvZy1wdWJsaXNoZWRcIjogcHVibGlzaGVkLFxuICAgICAgICAgICAgICBcInRhZ3NcIjogdGFnTGlzdCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgICAgICB6b25lXG4gICAgICAgICAgKTtcbiAgICAgICAgfSlcbiAgICApO1xuICB9XG5cbiAgb25DbG9zZSgpIHtcbiAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xuICB9XG59XG5cbi8vID09PT09IFNldHRpbmdzIFRhYiA9PT09PVxuXG5jbGFzcyBMcXNzYmxvZ1NldHRpbmdUYWIgZXh0ZW5kcyBQbHVnaW5TZXR0aW5nVGFiIHtcbiAgcGx1Z2luOiBMcXNzYmxvZ1BsdWdpbjtcblxuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgcGx1Z2luOiBMcXNzYmxvZ1BsdWdpbikge1xuICAgIHN1cGVyKGFwcCwgcGx1Z2luKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgfVxuXG4gIGRpc3BsYXkoKSB7XG4gICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcbiAgICBjb250YWluZXJFbC5lbXB0eSgpO1xuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiaDJcIiwgeyB0ZXh0OiBcImxxc3NibG9nIFN5bmNcIiB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJcdTUzNUFcdTVCQTJcdTU3MzBcdTU3NDBcIilcbiAgICAgIC5zZXREZXNjKFwiXHU0RTBEXHU1NDJCXHU2NzJCXHU1QzNFXHU2NTlDXHU3RUJGXHVGRjBDXHU0RjhCXHU1OTgyIGh0dHBzOi8vbHFzc2Jsb2cuc2VydmVibG9nLm5ldFwiKVxuICAgICAgLmFkZFRleHQoKHQpID0+XG4gICAgICAgIHRcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoXCJodHRwczovL2xxc3NibG9nLnNlcnZlYmxvZy5uZXRcIilcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuYmxvZ1VybClcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHYpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmJsb2dVcmwgPSB2LnJlcGxhY2UoL1xcLyQvLCBcIlwiKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlx1NzUyOFx1NjIzN1x1NTQwRFwiKVxuICAgICAgLmFkZFRleHQoKHQpID0+XG4gICAgICAgIHRcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoXCJ5b3VyLXVzZXJuYW1lXCIpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLnVzZXJuYW1lKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodikgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudXNlcm5hbWUgPSB2LnRyaW0oKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlx1NUJDNlx1NzgwMVwiKVxuICAgICAgLmFkZFRleHQoKHQpID0+IHtcbiAgICAgICAgdC5pbnB1dEVsLnR5cGUgPSBcInBhc3N3b3JkXCI7XG4gICAgICAgIHQuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MucGFzc3dvcmQpLm9uQ2hhbmdlKGFzeW5jICh2KSA9PiB7XG4gICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MucGFzc3dvcmQgPSB2O1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlx1NTQwQ1x1NkI2NVx1NjgzOVx1NjU4N1x1NEVGNlx1NTkzOVwiKVxuICAgICAgLnNldERlc2MoXCJcdTY1ODdcdTdBRTBcdTYzMDlcdTUyMDZcdTUzM0FcdTRGRERcdTVCNThcdTUyMzBcdTVCNTBcdTY1ODdcdTRFRjZcdTU5MzlcdUZGMUFibG9nLzIgXHUwMEI3IGJsb2cvMyBcdTAwQjcgYmxvZy80XCIpXG4gICAgICAuYWRkVGV4dCgodCkgPT5cbiAgICAgICAgdFxuICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcihcImJsb2dcIilcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3Muc3luY0ZvbGRlcilcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHYpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnN5bmNGb2xkZXIgPSB2LnRyaW0oKS5yZXBsYWNlKC9cXC8kLywgXCJcIik7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiaDNcIiwgeyB0ZXh0OiBcIlx1NjNBOFx1OTAwMVx1OUVEOFx1OEJBNFx1NTAzQ1wiIH0pO1xuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICB0ZXh0OiBcIlx1NjNBOFx1OTAwMVx1NkNBMVx1NjcwOSBmcm9udG1hdHRlciBcdTc2ODRcdTdCMTRcdThCQjBcdTY1RjZcdTRGN0ZcdTc1MjhcdThGRDlcdTRFOUJcdTlFRDhcdThCQTRcdTUwM0NcdUZGMENcdTY1RTBcdTk3MDBcdTYyNEJcdTUyQThcdTU4NkJcdTUxOTlcdTMwMDJcIixcbiAgICAgIGNsczogXCJzZXR0aW5nLWl0ZW0tZGVzY3JpcHRpb25cIixcbiAgICB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJcdTlFRDhcdThCQTRcdTUyMDZcdTUzM0FcIilcbiAgICAgIC5hZGREcm9wZG93bigoZCkgPT4ge1xuICAgICAgICBkLmFkZE9wdGlvbihcIkFOSU1FXCIsIFwiMlwiKTtcbiAgICAgICAgZC5hZGRPcHRpb24oXCJSRUFMXCIsIFwiM1wiKTtcbiAgICAgICAgZC5hZGRPcHRpb24oXCJGT1VSXCIsIFwiNFwiKTtcbiAgICAgICAgZC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5kZWZhdWx0Wm9uZSkub25DaGFuZ2UoYXN5bmMgKHYpID0+IHtcbiAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5kZWZhdWx0Wm9uZSA9IHYgYXMgWm9uZTtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJcdTlFRDhcdThCQTRcdTUzRUZcdTg5QzFcdTYwMjdcIilcbiAgICAgIC5hZGREcm9wZG93bigoZCkgPT4ge1xuICAgICAgICBkLmFkZE9wdGlvbihcIkxPR0lOX09OTFlcIiwgXCJcdTRFQzVcdTc2N0JcdTVGNTVcdTc1MjhcdTYyMzdcIik7XG4gICAgICAgIGQuYWRkT3B0aW9uKFwiUFVCTElDXCIsIFwiXHU1MTZDXHU1RjAwXCIpO1xuICAgICAgICBkLmFkZE9wdGlvbihcIkZSSUVORFNfT05MWVwiLCBcIlx1NEVDNVx1NTk3RFx1NTNDQlwiKTtcbiAgICAgICAgZC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5kZWZhdWx0VmlzaWJpbGl0eSkub25DaGFuZ2UoYXN5bmMgKHYpID0+IHtcbiAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5kZWZhdWx0VmlzaWJpbGl0eSA9IHYgYXMgVmlzaWJpbGl0eTtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJcdTlFRDhcdThCQTRcdTc2RjRcdTYzQTVcdTUzRDFcdTVFMDNcIilcbiAgICAgIC5zZXREZXNjKFwiXHU1MTczXHU5NUVEXHU1MjE5XHU0RkREXHU1QjU4XHU0RTNBXHU4MzQ5XHU3QTNGXCIpXG4gICAgICAuYWRkVG9nZ2xlKCh0KSA9PlxuICAgICAgICB0LnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmRlZmF1bHRQdWJsaXNoZWQpLm9uQ2hhbmdlKGFzeW5jICh2KSA9PiB7XG4gICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuZGVmYXVsdFB1Ymxpc2hlZCA9IHY7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlx1NkQ0Qlx1OEJENVx1OEZERVx1NjNBNVwiKVxuICAgICAgLnNldERlc2MoXCJcdTlBOENcdThCQzFcdTc1MjhcdTYyMzdcdTU0MERcdTU0OENcdTVCQzZcdTc4MDFcdTY2MkZcdTU0MjZcdTZCNjNcdTc4NkVcIilcbiAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT5cbiAgICAgICAgYnRuLnNldEJ1dHRvblRleHQoXCJcdTZENEJcdThCRDVcIikub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgYnRuLnNldEJ1dHRvblRleHQoXCJcdThGREVcdTYzQTVcdTRFMkRcdTIwMjZcIikuc2V0RGlzYWJsZWQodHJ1ZSk7XG4gICAgICAgICAgY29uc3QgeyBvaywgcmVhc29uIH0gPSBhd2FpdCB0aGlzLnBsdWdpbi5sb2dpbigpO1xuICAgICAgICAgIGJ0bi5zZXREaXNhYmxlZChmYWxzZSk7XG4gICAgICAgICAgaWYgKG9rKSB7XG4gICAgICAgICAgICBidG4uc2V0QnV0dG9uVGV4dChcIlx1MjcxMyBcdTYyMTBcdTUyOUZcIik7XG4gICAgICAgICAgICBuZXcgTm90aWNlKFwibHFzc2Jsb2c6IFx1NzY3Qlx1NUY1NVx1NjIxMFx1NTI5RlwiKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgYnRuLnNldEJ1dHRvblRleHQoXCJcdTI3MTcgXHU1OTMxXHU4RDI1XCIpO1xuICAgICAgICAgICAgbmV3IE5vdGljZShgbHFzc2Jsb2c6IFx1NzY3Qlx1NUY1NVx1NTkzMVx1OEQyNSBcdTIwMTQgJHtyZWFzb259YCwgODAwMCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4gYnRuLnNldEJ1dHRvblRleHQoXCJcdTZENEJcdThCRDVcIiksIDQwMDApO1xuICAgICAgICB9KVxuICAgICAgKTtcbiAgfVxufVxuXG4vLyA9PT09PSBVdGlsaXR5ID09PT09XG5cbmZ1bmN0aW9uIHN0cmlwRnJvbnRtYXR0ZXIoY29udGVudDogc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKCFjb250ZW50LnN0YXJ0c1dpdGgoXCItLS1cIikpIHJldHVybiBjb250ZW50O1xuICBjb25zdCBlbmQgPSBjb250ZW50LmluZGV4T2YoXCJcXG4tLS1cIiwgMyk7XG4gIGlmIChlbmQgPT09IC0xKSByZXR1cm4gY29udGVudDtcbiAgcmV0dXJuIGNvbnRlbnQuc2xpY2UoZW5kICsgNCkudHJpbVN0YXJ0KCk7XG59XG5cbmZ1bmN0aW9uIHBhcnNlVGFncyhyYXc6IHVua25vd24pOiBzdHJpbmdbXSB7XG4gIGlmICghcmF3KSByZXR1cm4gW107XG4gIGlmIChBcnJheS5pc0FycmF5KHJhdykpIHJldHVybiAocmF3IGFzIHVua25vd25bXSkubWFwKFN0cmluZykuZmlsdGVyKEJvb2xlYW4pO1xuICBpZiAodHlwZW9mIHJhdyA9PT0gXCJzdHJpbmdcIilcbiAgICByZXR1cm4gcmF3XG4gICAgICAuc3BsaXQoXCIsXCIpXG4gICAgICAubWFwKCh0KSA9PiB0LnRyaW0oKSlcbiAgICAgIC5maWx0ZXIoQm9vbGVhbik7XG4gIHJldHVybiBbXTtcbn1cblxuZnVuY3Rpb24gc2FmZUZpbGVuYW1lKG5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBuYW1lLnJlcGxhY2UoL1tcXFxcLzoqP1wiPD58XS9nLCBcIi1cIikudHJpbSgpLnNsaWNlKDAsIDEwMCk7XG59XG5cbmZ1bmN0aW9uIGJ1aWxkTm90ZUNvbnRlbnQocG9zdDogQmxvZ1Bvc3QpOiBzdHJpbmcge1xuICBjb25zdCB0YWdzID0gcG9zdC50YWdzLm1hcCgodCkgPT4gdC50YWcubmFtZSk7XG4gIGNvbnN0IGxpbmVzID0gW1xuICAgIFwiLS0tXCIsXG4gICAgYHRpdGxlOiBcIiR7cG9zdC50aXRsZS5yZXBsYWNlKC9cIi9nLCAnXFxcXFwiJyl9XCJgLFxuICAgIGBibG9nLWlkOiBcIiR7cG9zdC5pZH1cImAsXG4gICAgYGJsb2ctem9uZTogJHtwb3N0LnpvbmV9YCxcbiAgICBgYmxvZy12aXNpYmlsaXR5OiAke3Bvc3QudmlzaWJpbGl0eX1gLFxuICAgIGBibG9nLXB1Ymxpc2hlZDogJHtwb3N0LnB1Ymxpc2hlZH1gLFxuICBdO1xuICBpZiAodGFncy5sZW5ndGgpIHtcbiAgICBsaW5lcy5wdXNoKGB0YWdzOiBbJHt0YWdzLm1hcCgodCkgPT4gYFwiJHt0fVwiYCkuam9pbihcIiwgXCIpfV1gKTtcbiAgfVxuICBsaW5lcy5wdXNoKFxuICAgIGBibG9nLXN5bmNlZC1hdDogXCIke25ldyBEYXRlKCkudG9JU09TdHJpbmcoKX1cImAsXG4gICAgYGJsb2ctdXBkYXRlZC1hdDogXCIke3Bvc3QudXBkYXRlZEF0fVwiYCxcbiAgICBcIi0tLVwiLFxuICAgIFwiXCIsXG4gICAgcG9zdC5jb250ZW50XG4gICk7XG4gIHJldHVybiBsaW5lcy5qb2luKFwiXFxuXCIpO1xufVxuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsc0JBV087QUE4QlAsSUFBTSxtQkFBcUM7QUFBQSxFQUN6QyxTQUFTO0FBQUEsRUFDVCxVQUFVO0FBQUEsRUFDVixVQUFVO0FBQUEsRUFDVixZQUFZO0FBQUEsRUFDWixPQUFPO0FBQUEsRUFDUCxhQUFhO0FBQUEsRUFDYixtQkFBbUI7QUFBQSxFQUNuQixrQkFBa0I7QUFDcEI7QUFFQSxJQUFNLGlCQUF1QztBQUFBLEVBQzNDLE9BQU87QUFBQSxFQUNQLE1BQU07QUFBQSxFQUNOLE1BQU07QUFDUjtBQUlBLElBQXFCLGlCQUFyQixjQUE0Qyx1QkFBTztBQUFBLEVBR2pELE1BQU0sU0FBUztBQUNiLFVBQU0sS0FBSyxhQUFhO0FBR3hCLFNBQUssY0FBYyxTQUFTLGlCQUFpQixNQUFNO0FBQ2pELFVBQUksVUFB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
