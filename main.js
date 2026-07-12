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
    var _a, _b, _c, _d;
    if (!this.settings.username || !this.settings.password) {
      new import_obsidian.Notice("lqssblog: \u8BF7\u5148\u5728\u63D2\u4EF6\u8BBE\u7F6E\u91CC\u586B\u5199\u7528\u6237\u540D\u548C\u5BC6\u7801");
      return;
    }
    new import_obsidian.Notice("lqssblog: \u5F00\u59CB\u53CC\u5411\u540C\u6B65\u2026");
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7XG4gIEFwcCxcbiAgTW9kYWwsXG4gIE5vdGljZSxcbiAgUGx1Z2luLFxuICBQbHVnaW5TZXR0aW5nVGFiLFxuICBTZXR0aW5nLFxuICBURmlsZSxcbiAgcmVxdWVzdFVybCxcbiAgUmVxdWVzdFVybFBhcmFtLFxuICBSZXF1ZXN0VXJsUmVzcG9uc2UsXG59IGZyb20gXCJvYnNpZGlhblwiO1xuXG4vLyA9PT09PSBUeXBlcyA9PT09PVxuXG50eXBlIFpvbmUgPSBcIkFOSU1FXCIgfCBcIlJFQUxcIiB8IFwiRk9VUlwiO1xudHlwZSBWaXNpYmlsaXR5ID0gXCJQVUJMSUNcIiB8IFwiTE9HSU5fT05MWVwiIHwgXCJGUklFTkRTX09OTFlcIjtcblxuaW50ZXJmYWNlIEJsb2dQb3N0IHtcbiAgaWQ6IHN0cmluZztcbiAgdGl0bGU6IHN0cmluZztcbiAgY29udGVudDogc3RyaW5nO1xuICB6b25lOiBab25lO1xuICB2aXNpYmlsaXR5OiBWaXNpYmlsaXR5O1xuICBwdWJsaXNoZWQ6IGJvb2xlYW47XG4gIGNyZWF0ZWRBdDogc3RyaW5nO1xuICB1cGRhdGVkQXQ6IHN0cmluZztcbiAgdGFnczogeyB0YWc6IHsgbmFtZTogc3RyaW5nIH0gfVtdO1xufVxuXG5pbnRlcmZhY2UgTHFzc2Jsb2dTZXR0aW5ncyB7XG4gIGJsb2dVcmw6IHN0cmluZztcbiAgdXNlcm5hbWU6IHN0cmluZztcbiAgcGFzc3dvcmQ6IHN0cmluZztcbiAgc3luY0ZvbGRlcjogc3RyaW5nO1xuICB0b2tlbjogc3RyaW5nO1xuICBkZWZhdWx0Wm9uZTogWm9uZTtcbiAgZGVmYXVsdFZpc2liaWxpdHk6IFZpc2liaWxpdHk7XG4gIGRlZmF1bHRQdWJsaXNoZWQ6IGJvb2xlYW47XG59XG5cbmNvbnN0IERFRkFVTFRfU0VUVElOR1M6IExxc3NibG9nU2V0dGluZ3MgPSB7XG4gIGJsb2dVcmw6IFwiaHR0cHM6Ly9scXNzYmxvZy5zZXJ2ZWJsb2cubmV0XCIsXG4gIHVzZXJuYW1lOiBcIlwiLFxuICBwYXNzd29yZDogXCJcIixcbiAgc3luY0ZvbGRlcjogXCJibG9nXCIsXG4gIHRva2VuOiBcIlwiLFxuICBkZWZhdWx0Wm9uZTogXCJBTklNRVwiLFxuICBkZWZhdWx0VmlzaWJpbGl0eTogXCJMT0dJTl9PTkxZXCIsXG4gIGRlZmF1bHRQdWJsaXNoZWQ6IGZhbHNlLFxufTtcblxuY29uc3QgWk9ORV9TVUJGT0xERVI6IFJlY29yZDxab25lLCBzdHJpbmc+ID0ge1xuICBBTklNRTogXCIyXCIsXG4gIFJFQUw6IFwiM1wiLFxuICBGT1VSOiBcIjRcIixcbn07XG5cbi8vID09PT09IFBsdWdpbiA9PT09PVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBMcXNzYmxvZ1BsdWdpbiBleHRlbmRzIFBsdWdpbiB7XG4gIHNldHRpbmdzOiBMcXNzYmxvZ1NldHRpbmdzO1xuXG4gIGFzeW5jIG9ubG9hZCgpIHtcbiAgICBhd2FpdCB0aGlzLmxvYWRTZXR0aW5ncygpO1xuXG4gICAgLy8gUmliYm9uIGljb25cbiAgICB0aGlzLmFkZFJpYmJvbkljb24oXCJjbG91ZFwiLCBcImxxc3NibG9nIFN5bmNcIiwgKCkgPT4ge1xuICAgICAgbmV3IFN5bmNNb2RhbCh0aGlzLmFwcCwgdGhpcykub3BlbigpO1xuICAgIH0pO1xuXG4gICAgLy8gQ29tbWFuZHNcbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwicHVzaC1jdXJyZW50LW5vdGVcIixcbiAgICAgIG5hbWU6IFwiXHU2M0E4XHU5MDAxXHU1RjUzXHU1MjREXHU3QjE0XHU4QkIwXHU1MjMwXHU1MzVBXHU1QkEyXCIsXG4gICAgICBjYWxsYmFjazogKCkgPT4ge1xuICAgICAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKTtcbiAgICAgICAgaWYgKGZpbGUpIHRoaXMucHVzaE5vdGUoZmlsZSk7XG4gICAgICAgIGVsc2UgbmV3IE5vdGljZShcImxxc3NibG9nOiBcdTZDQTFcdTY3MDlcdTYyNTNcdTVGMDBcdTc2ODRcdTdCMTRcdThCQjBcIik7XG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcInB1bGwtYWxsLXBvc3RzXCIsXG4gICAgICBuYW1lOiBcIlx1NEVDRVx1NTM1QVx1NUJBMlx1NjJDOVx1NTNENlx1NTE2OFx1OTBFOFx1NjU4N1x1N0FFMFwiLFxuICAgICAgY2FsbGJhY2s6ICgpID0+IHRoaXMucHVsbEFsbFBvc3RzKCksXG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwic3luYy1hbGxcIixcbiAgICAgIG5hbWU6IFwiXHU0RTBFXHU1MzVBXHU1QkEyXHU1MTY4XHU5MUNGXHU1M0NDXHU1NDExXHU1NDBDXHU2QjY1XCIsXG4gICAgICBjYWxsYmFjazogKCkgPT4gdGhpcy5zeW5jQWxsKCksXG4gICAgfSk7XG5cbiAgICAvLyBSaWdodC1jbGljayBjb250ZXh0IG1lbnVcbiAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXG4gICAgICB0aGlzLmFwcC53b3Jrc3BhY2Uub24oXCJmaWxlLW1lbnVcIiwgKG1lbnUsIGZpbGUpID0+IHtcbiAgICAgICAgaWYgKGZpbGUgaW5zdGFuY2VvZiBURmlsZSAmJiBmaWxlLmV4dGVuc2lvbiA9PT0gXCJtZFwiKSB7XG4gICAgICAgICAgbWVudS5hZGRJdGVtKChpdGVtKSA9PiB7XG4gICAgICAgICAgICBpdGVtXG4gICAgICAgICAgICAgIC5zZXRUaXRsZShcIlx1NjNBOFx1OTAwMVx1NTIzMCBscXNzYmxvZ1wiKVxuICAgICAgICAgICAgICAuc2V0SWNvbihcInVwbG9hZC1jbG91ZFwiKVxuICAgICAgICAgICAgICAub25DbGljaygoKSA9PiB0aGlzLnB1c2hOb3RlKGZpbGUpKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICApO1xuXG4gICAgdGhpcy5hZGRTZXR0aW5nVGFiKG5ldyBMcXNzYmxvZ1NldHRpbmdUYWIodGhpcy5hcHAsIHRoaXMpKTtcbiAgfVxuXG4gIG9udW5sb2FkKCkge31cblxuICAvLyA9PT09PSBBdXRoID09PT09XG5cbiAgYXN5bmMgbG9naW4oKTogUHJvbWlzZTx7IG9rOiBib29sZWFuOyByZWFzb246IHN0cmluZyB9PiB7XG4gICAgaWYgKCF0aGlzLnNldHRpbmdzLnVzZXJuYW1lIHx8ICF0aGlzLnNldHRpbmdzLnBhc3N3b3JkKSB7XG4gICAgICByZXR1cm4geyBvazogZmFsc2UsIHJlYXNvbjogXCJcdTc1MjhcdTYyMzdcdTU0MERcdTYyMTZcdTVCQzZcdTc4MDFcdTY3MkFcdTU4NkJcdTUxOTlcIiB9O1xuICAgIH1cbiAgICBsZXQgcmVzcDogUmVxdWVzdFVybFJlc3BvbnNlO1xuICAgIHRyeSB7XG4gICAgICByZXNwID0gYXdhaXQgcmVxdWVzdFVybCh7XG4gICAgICAgIHVybDogYCR7dGhpcy5zZXR0aW5ncy5ibG9nVXJsfS9hcGkvYXV0aC9sb2dpbmAsXG4gICAgICAgIG1ldGhvZDogXCJQT1NUXCIsXG4gICAgICAgIGhlYWRlcnM6IHsgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIgfSxcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIHVzZXJuYW1lOiB0aGlzLnNldHRpbmdzLnVzZXJuYW1lLFxuICAgICAgICAgIHBhc3N3b3JkOiB0aGlzLnNldHRpbmdzLnBhc3N3b3JkLFxuICAgICAgICB9KSxcbiAgICAgICAgdGhyb3c6IGZhbHNlLFxuICAgICAgfSk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgcmV0dXJuIHsgb2s6IGZhbHNlLCByZWFzb246IGBcdTdGNTFcdTdFRENcdTk1MTlcdThCRUY6ICR7U3RyaW5nKGUpfWAgfTtcbiAgICB9XG5cbiAgICBpZiAocmVzcC5zdGF0dXMgIT09IDIwMCkge1xuICAgICAgbGV0IG1zZyA9IFwiXCI7XG4gICAgICB0cnkgeyBtc2cgPSByZXNwLmpzb24/LmVycm9yID8/IHJlc3AudGV4dDsgfSBjYXRjaCB7IG1zZyA9IFN0cmluZyhyZXNwLnN0YXR1cyk7IH1cbiAgICAgIHJldHVybiB7IG9rOiBmYWxzZSwgcmVhc29uOiBgSFRUUCAke3Jlc3Auc3RhdHVzfTogJHttc2d9YCB9O1xuICAgIH1cblxuICAgIGxldCB0b2tlbjogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICAgIHRyeSB7IHRva2VuID0gcmVzcC5qc29uPy50b2tlbjsgfSBjYXRjaCB7IC8qIGlnbm9yZSAqLyB9XG4gICAgaWYgKCF0b2tlbikge1xuICAgICAgcmV0dXJuIHsgb2s6IGZhbHNlLCByZWFzb246IFwiXHU1NENEXHU1RTk0XHU0RTJEXHU2Q0ExXHU2NzA5IHRva2VuIFx1NUI1N1x1NkJCNVwiIH07XG4gICAgfVxuXG4gICAgdGhpcy5zZXR0aW5ncy50b2tlbiA9IHRva2VuO1xuICAgIGF3YWl0IHRoaXMuc2F2ZVNldHRpbmdzKCk7XG4gICAgcmV0dXJuIHsgb2s6IHRydWUsIHJlYXNvbjogXCJcdTc2N0JcdTVGNTVcdTYyMTBcdTUyOUZcIiB9O1xuICB9XG5cbiAgZ2V0SGVhZGVycygpOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHtcbiAgICByZXR1cm4ge1xuICAgICAgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIsXG4gICAgICBDb29raWU6IGB0b2tlbj0ke3RoaXMuc2V0dGluZ3MudG9rZW59YCxcbiAgICB9O1xuICB9XG5cbiAgLy8gQXV0by1yZXRyeSB3aXRoIHJlLWxvZ2luIG9uIDQwMVxuICBhc3luYyBhcGlSZXEoXG4gICAgb3B0aW9uczogUmVxdWVzdFVybFBhcmFtLFxuICAgIHJldHJpZWQgPSBmYWxzZVxuICApOiBQcm9taXNlPFJlcXVlc3RVcmxSZXNwb25zZT4ge1xuICAgIGNvbnN0IHJlc3AgPSBhd2FpdCByZXF1ZXN0VXJsKHtcbiAgICAgIC4uLm9wdGlvbnMsXG4gICAgICBoZWFkZXJzOiB7IC4uLnRoaXMuZ2V0SGVhZGVycygpLCAuLi4ob3B0aW9ucy5oZWFkZXJzID8/IHt9KSB9LFxuICAgICAgdGhyb3c6IGZhbHNlLFxuICAgIH0pO1xuICAgIGlmIChyZXNwLnN0YXR1cyA9PT0gNDAxICYmICFyZXRyaWVkKSB7XG4gICAgICBjb25zdCB7IG9rIH0gPSBhd2FpdCB0aGlzLmxvZ2luKCk7XG4gICAgICBpZiAob2spIHJldHVybiB0aGlzLmFwaVJlcShvcHRpb25zLCB0cnVlKTtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3A7XG4gIH1cblxuICAvLyA9PT09PSBBUEkgPT09PT1cblxuICBhc3luYyBmZXRjaE15UG9zdHMoKTogUHJvbWlzZTxCbG9nUG9zdFtdPiB7XG4gICAgY29uc3QgcmVzcCA9IGF3YWl0IHRoaXMuYXBpUmVxKHtcbiAgICAgIHVybDogYCR7dGhpcy5zZXR0aW5ncy5ibG9nVXJsfS9hcGkvdXNlci9wb3N0c2AsXG4gICAgfSk7XG4gICAgaWYgKHJlc3Auc3RhdHVzICE9PSAyMDApIHJldHVybiBbXTtcbiAgICByZXR1cm4gKHJlc3AuanNvbiBhcyB7IHBvc3RzOiBCbG9nUG9zdFtdIH0pLnBvc3RzID8/IFtdO1xuICB9XG5cbiAgYXN5bmMgY3JlYXRlUG9zdChkYXRhOiB7XG4gICAgdGl0bGU6IHN0cmluZztcbiAgICBjb250ZW50OiBzdHJpbmc7XG4gICAgem9uZTogWm9uZTtcbiAgICB2aXNpYmlsaXR5OiBWaXNpYmlsaXR5O1xuICAgIHB1Ymxpc2hlZDogYm9vbGVhbjtcbiAgICB0YWdzOiBzdHJpbmdbXTtcbiAgfSk6IFByb21pc2U8QmxvZ1Bvc3QgfCBudWxsPiB7XG4gICAgY29uc3QgcmVzcCA9IGF3YWl0IHRoaXMuYXBpUmVxKHtcbiAgICAgIHVybDogYCR7dGhpcy5zZXR0aW5ncy5ibG9nVXJsfS9hcGkvcG9zdHNgLFxuICAgICAgbWV0aG9kOiBcIlBPU1RcIixcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KGRhdGEpLFxuICAgIH0pO1xuICAgIGlmIChyZXNwLnN0YXR1cyAhPT0gMjAxKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4gKHJlc3AuanNvbiBhcyB7IHBvc3Q6IEJsb2dQb3N0IH0pLnBvc3QgPz8gbnVsbDtcbiAgfVxuXG4gIGFzeW5jIHVwZGF0ZVBvc3QoXG4gICAgaWQ6IHN0cmluZyxcbiAgICBkYXRhOiB7XG4gICAgICB0aXRsZTogc3RyaW5nO1xuICAgICAgY29udGVudDogc3RyaW5nO1xuICAgICAgem9uZTogWm9uZTtcbiAgICAgIHZpc2liaWxpdHk6IFZpc2liaWxpdHk7XG4gICAgICBwdWJsaXNoZWQ6IGJvb2xlYW47XG4gICAgICB0YWdzOiBzdHJpbmdbXTtcbiAgICB9XG4gICk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGNvbnN0IHJlc3AgPSBhd2FpdCB0aGlzLmFwaVJlcSh7XG4gICAgICB1cmw6IGAke3RoaXMuc2V0dGluZ3MuYmxvZ1VybH0vYXBpL3Bvc3RzLyR7aWR9YCxcbiAgICAgIG1ldGhvZDogXCJQVVRcIixcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KGRhdGEpLFxuICAgIH0pO1xuICAgIHJldHVybiByZXNwLnN0YXR1cyA9PT0gMjAwO1xuICB9XG5cbiAgLy8gPT09PT0gQ29yZSBTeW5jID09PT09XG5cbiAgLyoqIERldGVjdCB6b25lIGZyb20gZmlsZSBwYXRoIChibG9nLzIvIFx1MjE5MiBBTklNRSwgYmxvZy8zLyBcdTIxOTIgUkVBTCwgYmxvZy80LyBcdTIxOTIgRk9VUikuICovXG4gIGRldGVjdFpvbmVGcm9tUGF0aChmaWxlUGF0aDogc3RyaW5nKTogWm9uZSB8IG51bGwge1xuICAgIGZvciAoY29uc3QgW3pvbmUsIHN1Yl0gb2YgT2JqZWN0LmVudHJpZXMoWk9ORV9TVUJGT0xERVIpIGFzIFtab25lLCBzdHJpbmddW10pIHtcbiAgICAgIGlmIChmaWxlUGF0aC5zdGFydHNXaXRoKGAke3RoaXMuc2V0dGluZ3Muc3luY0ZvbGRlcn0vJHtzdWJ9L2ApKSB7XG4gICAgICAgIHJldHVybiB6b25lO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIC8qKiBQdXNoIGEgc2luZ2xlIG5vdGUuIFpvbmUgcHJpb3JpdHk6IGZyb250bWF0dGVyID4gZmlsZSBwYXRoID4gc2V0dGluZ3MgZGVmYXVsdC4gKi9cbiAgYXN5bmMgcHVzaE5vdGUoZmlsZTogVEZpbGUpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMuc2V0dGluZ3MudXNlcm5hbWUgfHwgIXRoaXMuc2V0dGluZ3MucGFzc3dvcmQpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJscXNzYmxvZzogXHU4QkY3XHU1MTQ4XHU1NzI4XHU2M0QyXHU0RUY2XHU4QkJFXHU3RjZFXHU5MUNDXHU1ODZCXHU1MTk5XHU3NTI4XHU2MjM3XHU1NDBEXHU1NDhDXHU1QkM2XHU3ODAxXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGZtID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUoZmlsZSk/LmZyb250bWF0dGVyID8/IHt9O1xuICAgIGNvbnN0IHpvbmUgPVxuICAgICAgKGZtW1wiYmxvZy16b25lXCJdIGFzIFpvbmUgfCB1bmRlZmluZWQpID8/XG4gICAgICB0aGlzLmRldGVjdFpvbmVGcm9tUGF0aChmaWxlLnBhdGgpID8/XG4gICAgICB0aGlzLnNldHRpbmdzLmRlZmF1bHRab25lO1xuXG4gICAgYXdhaXQgdGhpcy5kb1B1c2goZmlsZSwgZm0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIGZtW1wiYmxvZy1pZFwiXSBhcyBzdHJpbmcgfCB1bmRlZmluZWQsIHpvbmUpO1xuICB9XG5cbiAgLyoqIEFjdHVhbGx5IHB1c2ggdGhlIG5vdGUgKGNhbGxlZCBhZnRlciB6b25lIGlzIGNvbmZpcm1lZCkuICovXG4gIGFzeW5jIGRvUHVzaChcbiAgICBmaWxlOiBURmlsZSxcbiAgICBmbTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4gICAgYmxvZ0lkOiBzdHJpbmcgfCB1bmRlZmluZWQsXG4gICAgem9uZTogWm9uZVxuICApOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBjb25zdCByYXdDb250ZW50ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQucmVhZChmaWxlKTtcbiAgICBjb25zdCBib2R5ID0gc3RyaXBGcm9udG1hdHRlcihyYXdDb250ZW50KTtcblxuICAgIGNvbnN0IHRpdGxlID0gKGZtW1widGl0bGVcIl0gYXMgc3RyaW5nKSB8fCBmaWxlLmJhc2VuYW1lO1xuICAgIGNvbnN0IHZpc2liaWxpdHkgPSAoZm1bXCJibG9nLXZpc2liaWxpdHlcIl0gYXMgVmlzaWJpbGl0eSkgfHwgdGhpcy5zZXR0aW5ncy5kZWZhdWx0VmlzaWJpbGl0eTtcbiAgICBjb25zdCBwdWJsaXNoZWQgPSAoZm1bXCJibG9nLXB1Ymxpc2hlZFwiXSBhcyBib29sZWFuKSA/PyB0aGlzLnNldHRpbmdzLmRlZmF1bHRQdWJsaXNoZWQ7XG4gICAgY29uc3QgdGFncyA9IHBhcnNlVGFncyhmbVtcInRhZ3NcIl0pO1xuXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgIGNvbnN0IGRhdGEgPSB7IHRpdGxlLCBjb250ZW50OiBib2R5LCB6b25lLCB2aXNpYmlsaXR5LCBwdWJsaXNoZWQsIHRhZ3MgfTtcblxuICAgIGlmIChibG9nSWQpIHtcbiAgICAgIGNvbnN0IG9rID0gYXdhaXQgdGhpcy51cGRhdGVQb3N0KGJsb2dJZCwgZGF0YSk7XG4gICAgICBpZiAoIW9rKSB7XG4gICAgICAgIG5ldyBOb3RpY2UoYGxxc3NibG9nOiBcdTI3MTcgXHU2NkY0XHU2NUIwXHU1OTMxXHU4RDI1IFx1MjAxNFx1MzAwQyR7dGl0bGV9XHUzMDBEYCk7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgcG9zdCA9IGF3YWl0IHRoaXMuY3JlYXRlUG9zdChkYXRhKTtcbiAgICAgIGlmICghcG9zdCkge1xuICAgICAgICBuZXcgTm90aWNlKGBscXNzYmxvZzogXHUyNzE3IFx1NTNEMVx1NUUwM1x1NTkzMVx1OEQyNSBcdTIwMTRcdTMwMEMke3RpdGxlfVx1MzAwRGApO1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgICBibG9nSWQgPSBwb3N0LmlkO1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuYXBwLmZpbGVNYW5hZ2VyLnByb2Nlc3NGcm9udE1hdHRlcihmaWxlLCAoZikgPT4ge1xuICAgICAgZltcImJsb2ctaWRcIl0gPSBibG9nSWQ7XG4gICAgICBmW1wiYmxvZy16b25lXCJdID0gem9uZTtcbiAgICAgIGZbXCJibG9nLXZpc2liaWxpdHlcIl0gPSB2aXNpYmlsaXR5O1xuICAgICAgZltcImJsb2ctcHVibGlzaGVkXCJdID0gcHVibGlzaGVkO1xuICAgICAgZltcImJsb2ctc3luY2VkLWF0XCJdID0gbm93O1xuICAgICAgZltcImJsb2ctdXBkYXRlZC1hdFwiXSA9IG5vdztcbiAgICB9KTtcblxuICAgIG5ldyBOb3RpY2UoYGxxc3NibG9nOiBcdTI3MTMgXHU1REYyXHU2M0E4XHU5MDAxXHUzMDBDJHt0aXRsZX1cdTMwMEQke3B1Ymxpc2hlZCA/IFwiXCIgOiBcIlx1RkYwOFx1ODM0OVx1N0EzRlx1RkYwOVwifWApO1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgLyoqIFB1bGwgYWxsIHVzZXIncyBwb3N0cyBmcm9tIHRoZSBibG9nIGludG8gdGhlIHN5bmMgZm9sZGVyLiAqL1xuICBhc3luYyBwdWxsQWxsUG9zdHMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCF0aGlzLnNldHRpbmdzLnVzZXJuYW1lIHx8ICF0aGlzLnNldHRpbmdzLnBhc3N3b3JkKSB7XG4gICAgICBuZXcgTm90aWNlKFwibHFzc2Jsb2c6IFx1OEJGN1x1NTE0OFx1NTcyOFx1NjNEMlx1NEVGNlx1OEJCRVx1N0Y2RVx1OTFDQ1x1NTg2Qlx1NTE5OVx1NzUyOFx1NjIzN1x1NTQwRFx1NTQ4Q1x1NUJDNlx1NzgwMVwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBuZXcgTm90aWNlKFwibHFzc2Jsb2c6IFx1NkI2M1x1NTcyOFx1NjJDOVx1NTNENlx1MjAyNlwiKTtcbiAgICBjb25zdCBwb3N0cyA9IGF3YWl0IHRoaXMuZmV0Y2hNeVBvc3RzKCk7XG5cbiAgICBpZiAoIXBvc3RzLmxlbmd0aCkge1xuICAgICAgbmV3IE5vdGljZShcImxxc3NibG9nOiBcdTUzNUFcdTVCQTJcdTRFMEFcdThGRDhcdTZDQTFcdTY3MDlcdTY1ODdcdTdBRTBcIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5lbnN1cmVTeW5jRm9sZGVyKCk7XG5cbiAgICBsZXQgcHVsbGVkID0gMCwgc2tpcHBlZCA9IDA7XG5cbiAgICBmb3IgKGNvbnN0IHBvc3Qgb2YgcG9zdHMpIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5maW5kRmlsZUJ5QmxvZ0lkKHBvc3QuaWQpO1xuICAgICAgY29uc3Qgc3luY2VkQXQgPSBleGlzdGluZ1xuICAgICAgICA/ICh0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShleGlzdGluZyk/LmZyb250bWF0dGVyPy5bXG4gICAgICAgICAgICBcImJsb2ctc3luY2VkLWF0XCJcbiAgICAgICAgICBdIGFzIHN0cmluZyB8IHVuZGVmaW5lZClcbiAgICAgICAgOiB1bmRlZmluZWQ7XG5cbiAgICAgIGNvbnN0IGJsb2dVcGRhdGVkQXQgPSBuZXcgRGF0ZShwb3N0LnVwZGF0ZWRBdCkuZ2V0VGltZSgpO1xuICAgICAgY29uc3QgbGFzdFN5bmNUaW1lID0gc3luY2VkQXQgPyBuZXcgRGF0ZShzeW5jZWRBdCkuZ2V0VGltZSgpIDogMDtcblxuICAgICAgaWYgKGV4aXN0aW5nICYmIGJsb2dVcGRhdGVkQXQgPD0gbGFzdFN5bmNUaW1lKSB7XG4gICAgICAgIHNraXBwZWQrKztcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNvbnRlbnQgPSBidWlsZE5vdGVDb250ZW50KHBvc3QpO1xuICAgICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0Lm1vZGlmeShleGlzdGluZywgY29udGVudCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCBwYXRoID0gYXdhaXQgdGhpcy51bmlxdWVQYXRoKFxuICAgICAgICAgIGAke3RoaXMuem9uZUZvbGRlcihwb3N0LnpvbmUpfS8ke3NhZmVGaWxlbmFtZShwb3N0LnRpdGxlKSB8fCBwb3N0LmlkfS5tZGBcbiAgICAgICAgKTtcbiAgICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuY3JlYXRlKHBhdGgsIGNvbnRlbnQpO1xuICAgICAgfVxuICAgICAgcHVsbGVkKys7XG4gICAgfVxuXG4gICAgbmV3IE5vdGljZShgbHFzc2Jsb2c6IFx1NjJDOVx1NTNENlx1NUI4Q1x1NjIxMCBcdTIwMTRcdTIwMTQgXHU2NkY0XHU2NUIwICR7cHVsbGVkfSBcdTdCQzdcdUZGMENcdThERjNcdThGQzcgJHtza2lwcGVkfSBcdTdCQzdgKTtcbiAgfVxuXG4gIC8qKiBGdWxsIGJpZGlyZWN0aW9uYWwgc3luYy4gKi9cbiAgYXN5bmMgc3luY0FsbCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMuc2V0dGluZ3MudXNlcm5hbWUgfHwgIXRoaXMuc2V0dGluZ3MucGFzc3dvcmQpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJscXNzYmxvZzogXHU4QkY3XHU1MTQ4XHU1NzI4XHU2M0QyXHU0RUY2XHU4QkJFXHU3RjZFXHU5MUNDXHU1ODZCXHU1MTk5XHU3NTI4XHU2MjM3XHU1NDBEXHU1NDhDXHU1QkM2XHU3ODAxXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIG5ldyBOb3RpY2UoXCJscXNzYmxvZzogXHU1RjAwXHU1OUNCXHU1M0NDXHU1NDExXHU1NDBDXHU2QjY1XHUyMDI2XCIpO1xuICAgIGNvbnN0IHBvc3RzID0gYXdhaXQgdGhpcy5mZXRjaE15UG9zdHMoKTtcbiAgICBjb25zdCBibG9nTWFwID0gbmV3IE1hcDxzdHJpbmcsIEJsb2dQb3N0Pihwb3N0cy5tYXAoKHApID0+IFtwLmlkLCBwXSkpO1xuXG4gICAgYXdhaXQgdGhpcy5lbnN1cmVTeW5jRm9sZGVyKCk7XG5cbiAgICBsZXQgcHVzaGVkID0gMCwgcHVsbGVkID0gMCwgY29uZmxpY3RzID0gMCwgY3JlYXRlZCA9IDAsIHVwVG9EYXRlID0gMDtcbiAgICBjb25zdCBwcm9jZXNzZWRJZHMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICBjb25zdCBCVUZGRVIgPSA1XzAwMDtcblxuICAgIC8vIFByb2Nlc3MgYWxsIGxvY2FsIGZpbGVzXG4gICAgZm9yIChjb25zdCBmaWxlIG9mIHRoaXMuYXBwLnZhdWx0LmdldE1hcmtkb3duRmlsZXMoKSkge1xuICAgICAgY29uc3QgZm0gPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShmaWxlKT8uZnJvbnRtYXR0ZXIgPz8ge307XG4gICAgICBjb25zdCBibG9nSWQgPSBmbVtcImJsb2ctaWRcIl0gYXMgc3RyaW5nIHwgdW5kZWZpbmVkO1xuXG4gICAgICBpZiAoIWJsb2dJZCkge1xuICAgICAgICAvLyBObyBibG9nLWlkIHlldDogcHVzaCBpZiBub3RlIGhhcyBibG9nLXpvbmUgT1IgaXMgaW5zaWRlIHN5bmMgZm9sZGVyXG4gICAgICAgIGNvbnN0IGRldGVjdGVkWm9uZSA9XG4gICAgICAgICAgKGZtW1wiYmxvZy16b25lXCJdIGFzIFpvbmUgfCB1bmRlZmluZWQpID8/IHRoaXMuZGV0ZWN0Wm9uZUZyb21QYXRoKGZpbGUucGF0aCk7XG4gICAgICAgIGNvbnN0IGluU3luY0ZvbGRlciA9IGZpbGUucGF0aC5zdGFydHNXaXRoKHRoaXMuc2V0dGluZ3Muc3luY0ZvbGRlciArIFwiL1wiKTtcbiAgICAgICAgaWYgKGRldGVjdGVkWm9uZSAmJiAoaW5TeW5jRm9sZGVyIHx8IGZtW1wiYmxvZy16b25lXCJdKSkge1xuICAgICAgICAgIGNvbnN0IG9rID0gYXdhaXQgdGhpcy5kb1B1c2goZmlsZSwgZm0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIHVuZGVmaW5lZCwgZGV0ZWN0ZWRab25lKTtcbiAgICAgICAgICBpZiAob2spIGNyZWF0ZWQrKztcbiAgICAgICAgfVxuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgcHJvY2Vzc2VkSWRzLmFkZChibG9nSWQpO1xuICAgICAgY29uc3QgYmxvZ1Bvc3QgPSBibG9nTWFwLmdldChibG9nSWQpO1xuICAgICAgaWYgKCFibG9nUG9zdCkgY29udGludWU7XG5cbiAgICAgIGNvbnN0IHN5bmNlZEF0ID0gZm1bXCJibG9nLXN5bmNlZC1hdFwiXSBhcyBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gICAgICBjb25zdCBsYXN0U3luY1RpbWUgPSBzeW5jZWRBdCA/IG5ldyBEYXRlKHN5bmNlZEF0KS5nZXRUaW1lKCkgOiAwO1xuICAgICAgY29uc3QgYmxvZ1VwZGF0ZWRBdCA9IG5ldyBEYXRlKGJsb2dQb3N0LnVwZGF0ZWRBdCkuZ2V0VGltZSgpO1xuICAgICAgY29uc3QgbG9jYWxVcGRhdGVkQXQgPSBmaWxlLnN0YXQubXRpbWU7XG5cbiAgICAgIGNvbnN0IGJsb2dOZXdlciA9IGJsb2dVcGRhdGVkQXQgPiBsYXN0U3luY1RpbWUgKyBCVUZGRVI7XG4gICAgICBjb25zdCBsb2NhbE5ld2VyID0gbG9jYWxVcGRhdGVkQXQgPiBsYXN0U3luY1RpbWUgKyBCVUZGRVI7XG5cbiAgICAgIGlmIChibG9nTmV3ZXIgJiYgbG9jYWxOZXdlcikge1xuICAgICAgICBjb25mbGljdHMrKztcbiAgICAgICAgbmV3IE5vdGljZShgbHFzc2Jsb2c6IFx1MjZBMCBcdTUxQjJcdTdBODEgXHUyMDE0XHUzMDBDJHtmaWxlLmJhc2VuYW1lfVx1MzAwRFx1NjcyQ1x1NTczMFx1NTQ4Q1x1OEZEQ1x1N0FFRlx1OTBGRFx1NjcwOVx1NjZGNFx1NjUzOVx1RkYwQ1x1NURGMlx1OERGM1x1OEZDN2ApO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgaWYgKGxvY2FsTmV3ZXIpIHtcbiAgICAgICAgY29uc3Qgem9uZSA9IChmbVtcImJsb2ctem9uZVwiXSBhcyBab25lIHwgdW5kZWZpbmVkKSA/PyAoYmxvZ1Bvc3Quem9uZSBhcyBab25lKTtcbiAgICAgICAgY29uc3Qgb2sgPSBhd2FpdCB0aGlzLmRvUHVzaChmaWxlLCBmbSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgYmxvZ0lkLCB6b25lKTtcbiAgICAgICAgaWYgKG9rKSBwdXNoZWQrKztcbiAgICAgIH0gZWxzZSBpZiAoYmxvZ05ld2VyKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0Lm1vZGlmeShmaWxlLCBidWlsZE5vdGVDb250ZW50KGJsb2dQb3N0KSk7XG4gICAgICAgIHB1bGxlZCsrO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdXBUb0RhdGUrKztcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBQdWxsIHBvc3RzIGZyb20gYmxvZyB0aGF0IGRvbid0IGV4aXN0IGxvY2FsbHkgeWV0XG4gICAgZm9yIChjb25zdCBwb3N0IG9mIHBvc3RzKSB7XG4gICAgICBpZiAocHJvY2Vzc2VkSWRzLmhhcyhwb3N0LmlkKSkgY29udGludWU7XG4gICAgICBjb25zdCBwYXRoID0gYXdhaXQgdGhpcy51bmlxdWVQYXRoKFxuICAgICAgICBgJHt0aGlzLnpvbmVGb2xkZXIocG9zdC56b25lKX0vJHtzYWZlRmlsZW5hbWUocG9zdC50aXRsZSkgfHwgcG9zdC5pZH0ubWRgXG4gICAgICApO1xuICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuY3JlYXRlKHBhdGgsIGJ1aWxkTm90ZUNvbnRlbnQocG9zdCkpO1xuICAgICAgcHVsbGVkKys7XG4gICAgfVxuXG4gICAgY29uc3Qgc3VtbWFyeSA9IFtcbiAgICAgIGBcdTIxOTEgJHtwdXNoZWQgKyBjcmVhdGVkfWAsXG4gICAgICBgXHUyMTkzICR7cHVsbGVkfWAsXG4gICAgICB1cFRvRGF0ZSA/IGBcdTI3MTMgJHt1cFRvRGF0ZX0gXHU1REYyXHU2NjJGXHU2NzAwXHU2NUIwYCA6IFwiXCIsXG4gICAgICBjb25mbGljdHMgPyBgXHUyNkEwICR7Y29uZmxpY3RzfSBcdTUxQjJcdTdBODFgIDogXCJcIixcbiAgICBdXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pXG4gICAgICAuam9pbihcIiAgIFwiKTtcblxuICAgIG5ldyBOb3RpY2UoYGxxc3NibG9nOiBcdTU0MENcdTZCNjVcdTVCOENcdTYyMTAgXHUyMDE0XHUyMDE0ICR7c3VtbWFyeX1gKTtcbiAgfVxuXG4gIC8vID09PT09IEhlbHBlcnMgPT09PT1cblxuICBmaW5kRmlsZUJ5QmxvZ0lkKGJsb2dJZDogc3RyaW5nKTogVEZpbGUgfCBudWxsIHtcbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgdGhpcy5hcHAudmF1bHQuZ2V0TWFya2Rvd25GaWxlcygpKSB7XG4gICAgICBjb25zdCBmbSA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpPy5mcm9udG1hdHRlcjtcbiAgICAgIGlmIChmbT8uW1wiYmxvZy1pZFwiXSA9PT0gYmxvZ0lkKSByZXR1cm4gZmlsZTtcbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICB6b25lRm9sZGVyKHpvbmU6IFpvbmUpOiBzdHJpbmcge1xuICAgIHJldHVybiBgJHt0aGlzLnNldHRpbmdzLnN5bmNGb2xkZXJ9LyR7Wk9ORV9TVUJGT0xERVJbem9uZV19YDtcbiAgfVxuXG4gIGFzeW5jIGVuc3VyZVN5bmNGb2xkZXIoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgcm9vdCA9IHRoaXMuc2V0dGluZ3Muc3luY0ZvbGRlcjtcbiAgICBpZiAoIShhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLmV4aXN0cyhyb290KSkpIHtcbiAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNyZWF0ZUZvbGRlcihyb290KTtcbiAgICB9XG4gICAgZm9yIChjb25zdCBzdWIgb2YgT2JqZWN0LnZhbHVlcyhaT05FX1NVQkZPTERFUikpIHtcbiAgICAgIGNvbnN0IHBhdGggPSBgJHtyb290fS8ke3N1Yn1gO1xuICAgICAgaWYgKCEoYXdhaXQgdGhpcy5hcHAudmF1bHQuYWRhcHRlci5leGlzdHMocGF0aCkpKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNyZWF0ZUZvbGRlcihwYXRoKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBhc3luYyB1bmlxdWVQYXRoKHBhdGg6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgaWYgKCEoYXdhaXQgdGhpcy5hcHAudmF1bHQuYWRhcHRlci5leGlzdHMocGF0aCkpKSByZXR1cm4gcGF0aDtcbiAgICBjb25zdCBiYXNlID0gcGF0aC5yZXBsYWNlKC9cXC5tZCQvLCBcIlwiKTtcbiAgICBsZXQgaSA9IDE7XG4gICAgd2hpbGUgKGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIuZXhpc3RzKGAke2Jhc2V9LSR7aX0ubWRgKSkgaSsrO1xuICAgIHJldHVybiBgJHtiYXNlfS0ke2l9Lm1kYDtcbiAgfVxuXG4gIGFzeW5jIGxvYWRTZXR0aW5ncygpIHtcbiAgICB0aGlzLnNldHRpbmdzID0gT2JqZWN0LmFzc2lnbih7fSwgREVGQVVMVF9TRVRUSU5HUywgYXdhaXQgdGhpcy5sb2FkRGF0YSgpKTtcbiAgfVxuXG4gIGFzeW5jIHNhdmVTZXR0aW5ncygpIHtcbiAgICBhd2FpdCB0aGlzLnNhdmVEYXRhKHRoaXMuc2V0dGluZ3MpO1xuICB9XG59XG5cbi8vID09PT09IFN5bmMgTW9kYWwgKFJpYmJvbiBjbGljaykgPT09PT1cblxuY2xhc3MgU3luY01vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBwbHVnaW46IExxc3NibG9nUGx1Z2luO1xuXG4gIGNvbnN0cnVjdG9yKGFwcDogQXBwLCBwbHVnaW46IExxc3NibG9nUGx1Z2luKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgfVxuXG4gIG9uT3BlbigpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuYWRkQ2xhc3MoXCJscXNzLW1vZGFsXCIpO1xuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcImgzXCIsIHsgdGV4dDogXCJscXNzYmxvZyBTeW5jXCIgfSk7XG5cbiAgICBjb25zdCBncmlkID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJscXNzLWdyaWRcIiB9KTtcblxuICAgIHRoaXMuYnRuKGdyaWQsIFwiXHUyMTkxXCIsIFwiXHU2M0E4XHU5MDAxXHU1RjUzXHU1MjREXHU3QjE0XHU4QkIwXCIsIFwidXBsb2FkLWNsb3VkXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpO1xuICAgICAgaWYgKGZpbGUpIHRoaXMucGx1Z2luLnB1c2hOb3RlKGZpbGUpO1xuICAgICAgZWxzZSBuZXcgTm90aWNlKFwibHFzc2Jsb2c6IFx1NkNBMVx1NjcwOVx1NjI1M1x1NUYwMFx1NzY4NFx1N0IxNFx1OEJCMFwiKTtcbiAgICB9KTtcblxuICAgIHRoaXMuYnRuKGdyaWQsIFwiXHUyMTkzXCIsIFwiXHU2MkM5XHU1M0Q2XHU1MTY4XHU5MEU4XHU2NTg3XHU3QUUwXCIsIFwiZG93bmxvYWQtY2xvdWRcIiwgKCkgPT4ge1xuICAgICAgdGhpcy5wbHVnaW4ucHVsbEFsbFBvc3RzKCk7XG4gICAgfSk7XG5cbiAgICB0aGlzLmJ0bihncmlkLCBcIlx1MjFDNVwiLCBcIlx1NTE2OFx1OTFDRlx1NTNDQ1x1NTQxMVx1NTQwQ1x1NkI2NVwiLCBcInJlZnJlc2gtY3dcIiwgKCkgPT4ge1xuICAgICAgdGhpcy5wbHVnaW4uc3luY0FsbCgpO1xuICAgIH0pO1xuICB9XG5cbiAgYnRuKFxuICAgIHBhcmVudDogSFRNTEVsZW1lbnQsXG4gICAgaWNvbjogc3RyaW5nLFxuICAgIGxhYmVsOiBzdHJpbmcsXG4gICAgX2x1Y2lkZTogc3RyaW5nLFxuICAgIG9uQ2xpY2s6ICgpID0+IHZvaWRcbiAgKSB7XG4gICAgY29uc3QgYnRuID0gcGFyZW50LmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgY2xzOiBcImxxc3MtYWN0aW9uLWJ0blwiIH0pO1xuICAgIGJ0bi5jcmVhdGVFbChcInNwYW5cIiwgeyBjbHM6IFwibHFzcy1idG4taWNvblwiLCB0ZXh0OiBpY29uIH0pO1xuICAgIGJ0bi5jcmVhdGVFbChcInNwYW5cIiwgeyBjbHM6IFwibHFzcy1idG4tbGFiZWxcIiwgdGV4dDogbGFiZWwgfSk7XG4gICAgYnRuLm9uY2xpY2sgPSAoKSA9PiB7XG4gICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICBvbkNsaWNrKCk7XG4gICAgfTtcbiAgfVxuXG4gIG9uQ2xvc2UoKSB7XG4gICAgdGhpcy5jb250ZW50RWwuZW1wdHkoKTtcbiAgfVxufVxuXG4vLyA9PT09PSBQdWJsaXNoIE1vZGFsIChmaXJzdC10aW1lIHB1c2gsIG5vIHpvbmUgc2V0KSA9PT09PVxuXG5jbGFzcyBQdWJsaXNoTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIHBsdWdpbjogTHFzc2Jsb2dQbHVnaW47XG4gIGZpbGU6IFRGaWxlO1xuXG4gIGNvbnN0cnVjdG9yKGFwcDogQXBwLCBwbHVnaW46IExxc3NibG9nUGx1Z2luLCBmaWxlOiBURmlsZSkge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gICAgdGhpcy5maWxlID0gZmlsZTtcbiAgfVxuXG4gIG9uT3BlbigpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb25zdCBmbSA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKHRoaXMuZmlsZSk/LmZyb250bWF0dGVyID8/IHt9O1xuXG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwiaDNcIiwgeyB0ZXh0OiBcIlx1NTNEMVx1NUUwM1x1NTIzMCBscXNzYmxvZ1wiIH0pO1xuXG4gICAgbGV0IHRpdGxlID0gKGZtW1widGl0bGVcIl0gYXMgc3RyaW5nKSB8fCB0aGlzLmZpbGUuYmFzZW5hbWU7XG4gICAgbGV0IHpvbmU6IFpvbmUgPSBcIkFOSU1FXCI7XG4gICAgbGV0IHZpc2liaWxpdHk6IFZpc2liaWxpdHkgPSBcIkxPR0lOX09OTFlcIjtcbiAgICBsZXQgcHVibGlzaGVkID0gZmFsc2U7XG4gICAgbGV0IHRhZ3MgPSBwYXJzZVRhZ3MoZm1bXCJ0YWdzXCJdKS5qb2luKFwiLCBcIik7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuc2V0TmFtZShcIlx1NjgwN1x1OTg5OFwiKVxuICAgICAgLmFkZFRleHQoKHQpID0+XG4gICAgICAgIHQuc2V0VmFsdWUodGl0bGUpLm9uQ2hhbmdlKCh2KSA9PiAodGl0bGUgPSB2KSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuc2V0TmFtZShcIlx1NTIwNlx1NTMzQVwiKVxuICAgICAgLmFkZERyb3Bkb3duKChkKSA9PiB7XG4gICAgICAgIGQuYWRkT3B0aW9uKFwiQU5JTUVcIiwgXCIyXCIpO1xuICAgICAgICBkLmFkZE9wdGlvbihcIlJFQUxcIiwgXCIzXCIpO1xuICAgICAgICBkLmFkZE9wdGlvbihcIkZPVVJcIiwgXCI0XCIpO1xuICAgICAgICBkLnNldFZhbHVlKHpvbmUpLm9uQ2hhbmdlKCh2KSA9PiAoem9uZSA9IHYgYXMgWm9uZSkpO1xuICAgICAgfSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuc2V0TmFtZShcIlx1NTNFRlx1ODlDMVx1NjAyN1wiKVxuICAgICAgLmFkZERyb3Bkb3duKChkKSA9PiB7XG4gICAgICAgIGQuYWRkT3B0aW9uKFwiTE9HSU5fT05MWVwiLCBcIlx1NEVDNVx1NzY3Qlx1NUY1NVx1NzUyOFx1NjIzN1wiKTtcbiAgICAgICAgZC5hZGRPcHRpb24oXCJQVUJMSUNcIiwgXCJcdTUxNkNcdTVGMDBcIik7XG4gICAgICAgIGQuYWRkT3B0aW9uKFwiRlJJRU5EU19PTkxZXCIsIFwiXHU0RUM1XHU1OTdEXHU1M0NCXCIpO1xuICAgICAgICBkLnNldFZhbHVlKHZpc2liaWxpdHkpLm9uQ2hhbmdlKCh2KSA9PiAodmlzaWJpbGl0eSA9IHYgYXMgVmlzaWJpbGl0eSkpO1xuICAgICAgfSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuc2V0TmFtZShcIlx1NjgwN1x1N0I3RVwiKVxuICAgICAgLnNldERlc2MoXCJcdTU5MUFcdTRFMkFcdTY4MDdcdTdCN0VcdTc1MjhcdTkwMTdcdTUzRjdcdTUyMDZcdTk2OTRcIilcbiAgICAgIC5hZGRUZXh0KCh0KSA9PlxuICAgICAgICB0XG4gICAgICAgICAgLnNldFBsYWNlaG9sZGVyKFwidGFnMSwgdGFnMlwiKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0YWdzKVxuICAgICAgICAgIC5vbkNoYW5nZSgodikgPT4gKHRhZ3MgPSB2KSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuc2V0TmFtZShcIlx1N0FDQlx1NTM3M1x1NTNEMVx1NUUwM1wiKVxuICAgICAgLnNldERlc2MoXCJcdTUxNzNcdTk1RURcdTUyMTlcdTRGRERcdTVCNThcdTRFM0FcdTgzNDlcdTdBM0ZcIilcbiAgICAgIC5hZGRUb2dnbGUoKHQpID0+XG4gICAgICAgIHQuc2V0VmFsdWUocHVibGlzaGVkKS5vbkNoYW5nZSgodikgPT4gKHB1Ymxpc2hlZCA9IHYpKVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbCkuYWRkQnV0dG9uKChidG4pID0+XG4gICAgICBidG5cbiAgICAgICAgLnNldEJ1dHRvblRleHQoXCJcdTUzRDFcdTVFMDNcIilcbiAgICAgICAgLnNldEN0YSgpXG4gICAgICAgIC5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICAgICAgY29uc3QgdGFnTGlzdCA9IHRhZ3NcbiAgICAgICAgICAgIC5zcGxpdChcIixcIilcbiAgICAgICAgICAgIC5tYXAoKHQpID0+IHQudHJpbSgpKVxuICAgICAgICAgICAgLmZpbHRlcihCb29sZWFuKTtcbiAgICAgICAgICAvLyBXcml0ZSBtZXRhIHRvIGZyb250bWF0dGVyIGZpcnN0IHNvIGRvUHVzaCBjYW4gcmVhZCBpdFxuICAgICAgICAgIGF3YWl0IHRoaXMuYXBwLmZpbGVNYW5hZ2VyLnByb2Nlc3NGcm9udE1hdHRlcih0aGlzLmZpbGUsIChmKSA9PiB7XG4gICAgICAgICAgICBmW1widGl0bGVcIl0gPSB0aXRsZTtcbiAgICAgICAgICAgIGZbXCJibG9nLXpvbmVcIl0gPSB6b25lO1xuICAgICAgICAgICAgZltcImJsb2ctdmlzaWJpbGl0eVwiXSA9IHZpc2liaWxpdHk7XG4gICAgICAgICAgICBmW1wiYmxvZy1wdWJsaXNoZWRcIl0gPSBwdWJsaXNoZWQ7XG4gICAgICAgICAgICBmW1widGFnc1wiXSA9IHRhZ0xpc3Q7XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uZG9QdXNoKFxuICAgICAgICAgICAgdGhpcy5maWxlLFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICB0aXRsZSxcbiAgICAgICAgICAgICAgXCJibG9nLXpvbmVcIjogem9uZSxcbiAgICAgICAgICAgICAgXCJibG9nLXZpc2liaWxpdHlcIjogdmlzaWJpbGl0eSxcbiAgICAgICAgICAgICAgXCJibG9nLXB1Ymxpc2hlZFwiOiBwdWJsaXNoZWQsXG4gICAgICAgICAgICAgIFwidGFnc1wiOiB0YWdMaXN0LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHVuZGVmaW5lZCxcbiAgICAgICAgICAgIHpvbmVcbiAgICAgICAgICApO1xuICAgICAgICB9KVxuICAgICk7XG4gIH1cblxuICBvbkNsb3NlKCkge1xuICAgIHRoaXMuY29udGVudEVsLmVtcHR5KCk7XG4gIH1cbn1cblxuLy8gPT09PT0gU2V0dGluZ3MgVGFiID09PT09XG5cbmNsYXNzIExxc3NibG9nU2V0dGluZ1RhYiBleHRlbmRzIFBsdWdpblNldHRpbmdUYWIge1xuICBwbHVnaW46IExxc3NibG9nUGx1Z2luO1xuXG4gIGNvbnN0cnVjdG9yKGFwcDogQXBwLCBwbHVnaW46IExxc3NibG9nUGx1Z2luKSB7XG4gICAgc3VwZXIoYXBwLCBwbHVnaW4pO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICB9XG5cbiAgZGlzcGxheSgpIHtcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xuICAgIGNvbnRhaW5lckVsLmVtcHR5KCk7XG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IFwibHFzc2Jsb2cgU3luY1wiIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlx1NTM1QVx1NUJBMlx1NTczMFx1NTc0MFwiKVxuICAgICAgLnNldERlc2MoXCJcdTRFMERcdTU0MkJcdTY3MkJcdTVDM0VcdTY1OUNcdTdFQkZcdUZGMENcdTRGOEJcdTU5ODIgaHR0cHM6Ly9scXNzYmxvZy5zZXJ2ZWJsb2cubmV0XCIpXG4gICAgICAuYWRkVGV4dCgodCkgPT5cbiAgICAgICAgdFxuICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcihcImh0dHBzOi8vbHFzc2Jsb2cuc2VydmVibG9nLm5ldFwiKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5ibG9nVXJsKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodikgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuYmxvZ1VybCA9IHYucmVwbGFjZSgvXFwvJC8sIFwiXCIpO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiXHU3NTI4XHU2MjM3XHU1NDBEXCIpXG4gICAgICAuYWRkVGV4dCgodCkgPT5cbiAgICAgICAgdFxuICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcihcInlvdXItdXNlcm5hbWVcIilcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MudXNlcm5hbWUpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2KSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy51c2VybmFtZSA9IHYudHJpbSgpO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiXHU1QkM2XHU3ODAxXCIpXG4gICAgICAuYWRkVGV4dCgodCkgPT4ge1xuICAgICAgICB0LmlucHV0RWwudHlwZSA9IFwicGFzc3dvcmRcIjtcbiAgICAgICAgdC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5wYXNzd29yZCkub25DaGFuZ2UoYXN5bmMgKHYpID0+IHtcbiAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5wYXNzd29yZCA9IHY7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiXHU1NDBDXHU2QjY1XHU2ODM5XHU2NTg3XHU0RUY2XHU1OTM5XCIpXG4gICAgICAuc2V0RGVzYyhcIlx1NjU4N1x1N0FFMFx1NjMwOVx1NTIwNlx1NTMzQVx1NEZERFx1NUI1OFx1NTIzMFx1NUI1MFx1NjU4N1x1NEVGNlx1NTkzOVx1RkYxQWJsb2cvMiBcdTAwQjcgYmxvZy8zIFx1MDBCNyBibG9nLzRcIilcbiAgICAgIC5hZGRUZXh0KCh0KSA9PlxuICAgICAgICB0XG4gICAgICAgICAgLnNldFBsYWNlaG9sZGVyKFwiYmxvZ1wiKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5zeW5jRm9sZGVyKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodikgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Muc3luY0ZvbGRlciA9IHYudHJpbSgpLnJlcGxhY2UoL1xcLyQvLCBcIlwiKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJoM1wiLCB7IHRleHQ6IFwiXHU2M0E4XHU5MDAxXHU5RUQ4XHU4QkE0XHU1MDNDXCIgfSk7XG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgIHRleHQ6IFwiXHU2M0E4XHU5MDAxXHU2Q0ExXHU2NzA5IGZyb250bWF0dGVyIFx1NzY4NFx1N0IxNFx1OEJCMFx1NjVGNlx1NEY3Rlx1NzUyOFx1OEZEOVx1NEU5Qlx1OUVEOFx1OEJBNFx1NTAzQ1x1RkYwQ1x1NjVFMFx1OTcwMFx1NjI0Qlx1NTJBOFx1NTg2Qlx1NTE5OVx1MzAwMlwiLFxuICAgICAgY2xzOiBcInNldHRpbmctaXRlbS1kZXNjcmlwdGlvblwiLFxuICAgIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlx1OUVEOFx1OEJBNFx1NTIwNlx1NTMzQVwiKVxuICAgICAgLmFkZERyb3Bkb3duKChkKSA9PiB7XG4gICAgICAgIGQuYWRkT3B0aW9uKFwiQU5JTUVcIiwgXCIyXCIpO1xuICAgICAgICBkLmFkZE9wdGlvbihcIlJFQUxcIiwgXCIzXCIpO1xuICAgICAgICBkLmFkZE9wdGlvbihcIkZPVVJcIiwgXCI0XCIpO1xuICAgICAgICBkLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmRlZmF1bHRab25lKS5vbkNoYW5nZShhc3luYyAodikgPT4ge1xuICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmRlZmF1bHRab25lID0gdiBhcyBab25lO1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlx1OUVEOFx1OEJBNFx1NTNFRlx1ODlDMVx1NjAyN1wiKVxuICAgICAgLmFkZERyb3Bkb3duKChkKSA9PiB7XG4gICAgICAgIGQuYWRkT3B0aW9uKFwiTE9HSU5fT05MWVwiLCBcIlx1NEVDNVx1NzY3Qlx1NUY1NVx1NzUyOFx1NjIzN1wiKTtcbiAgICAgICAgZC5hZGRPcHRpb24oXCJQVUJMSUNcIiwgXCJcdTUxNkNcdTVGMDBcIik7XG4gICAgICAgIGQuYWRkT3B0aW9uKFwiRlJJRU5EU19PTkxZXCIsIFwiXHU0RUM1XHU1OTdEXHU1M0NCXCIpO1xuICAgICAgICBkLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmRlZmF1bHRWaXNpYmlsaXR5KS5vbkNoYW5nZShhc3luYyAodikgPT4ge1xuICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmRlZmF1bHRWaXNpYmlsaXR5ID0gdiBhcyBWaXNpYmlsaXR5O1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlx1OUVEOFx1OEJBNFx1NzZGNFx1NjNBNVx1NTNEMVx1NUUwM1wiKVxuICAgICAgLnNldERlc2MoXCJcdTUxNzNcdTk1RURcdTUyMTlcdTRGRERcdTVCNThcdTRFM0FcdTgzNDlcdTdBM0ZcIilcbiAgICAgIC5hZGRUb2dnbGUoKHQpID0+XG4gICAgICAgIHQuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuZGVmYXVsdFB1Ymxpc2hlZCkub25DaGFuZ2UoYXN5bmMgKHYpID0+IHtcbiAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5kZWZhdWx0UHVibGlzaGVkID0gdjtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiXHU2RDRCXHU4QkQ1XHU4RkRFXHU2M0E1XCIpXG4gICAgICAuc2V0RGVzYyhcIlx1OUE4Q1x1OEJDMVx1NzUyOFx1NjIzN1x1NTQwRFx1NTQ4Q1x1NUJDNlx1NzgwMVx1NjYyRlx1NTQyNlx1NkI2M1x1Nzg2RVwiKVxuICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PlxuICAgICAgICBidG4uc2V0QnV0dG9uVGV4dChcIlx1NkQ0Qlx1OEJENVwiKS5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICBidG4uc2V0QnV0dG9uVGV4dChcIlx1OEZERVx1NjNBNVx1NEUyRFx1MjAyNlwiKS5zZXREaXNhYmxlZCh0cnVlKTtcbiAgICAgICAgICBjb25zdCB7IG9rLCByZWFzb24gfSA9IGF3YWl0IHRoaXMucGx1Z2luLmxvZ2luKCk7XG4gICAgICAgICAgYnRuLnNldERpc2FibGVkKGZhbHNlKTtcbiAgICAgICAgICBpZiAob2spIHtcbiAgICAgICAgICAgIGJ0bi5zZXRCdXR0b25UZXh0KFwiXHUyNzEzIFx1NjIxMFx1NTI5RlwiKTtcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoXCJscXNzYmxvZzogXHU3NjdCXHU1RjU1XHU2MjEwXHU1MjlGXCIpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBidG4uc2V0QnV0dG9uVGV4dChcIlx1MjcxNyBcdTU5MzFcdThEMjVcIik7XG4gICAgICAgICAgICBuZXcgTm90aWNlKGBscXNzYmxvZzogXHU3NjdCXHU1RjU1XHU1OTMxXHU4RDI1IFx1MjAxNCAke3JlYXNvbn1gLCA4MDAwKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgc2V0VGltZW91dCgoKSA9PiBidG4uc2V0QnV0dG9uVGV4dChcIlx1NkQ0Qlx1OEJENVwiKSwgNDAwMCk7XG4gICAgICAgIH0pXG4gICAgICApO1xuICB9XG59XG5cbi8vID09PT09IFV0aWxpdHkgPT09PT1cblxuZnVuY3Rpb24gc3RyaXBGcm9udG1hdHRlcihjb250ZW50OiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoIWNvbnRlbnQuc3RhcnRzV2l0aChcIi0tLVwiKSkgcmV0dXJuIGNvbnRlbnQ7XG4gIGNvbnN0IGVuZCA9IGNvbnRlbnQuaW5kZXhPZihcIlxcbi0tLVwiLCAzKTtcbiAgaWYgKGVuZCA9PT0gLTEpIHJldHVybiBjb250ZW50O1xuICByZXR1cm4gY29udGVudC5zbGljZShlbmQgKyA0KS50cmltU3RhcnQoKTtcbn1cblxuZnVuY3Rpb24gcGFyc2VUYWdzKHJhdzogdW5rbm93bik6IHN0cmluZ1tdIHtcbiAgaWYgKCFyYXcpIHJldHVybiBbXTtcbiAgaWYgKEFycmF5LmlzQXJyYXkocmF3KSkgcmV0dXJuIChyYXcgYXMgdW5rbm93bltdKS5tYXAoU3RyaW5nKS5maWx0ZXIoQm9vbGVhbik7XG4gIGlmICh0eXBlb2YgcmF3ID09PSBcInN0cmluZ1wiKVxuICAgIHJldHVybiByYXdcbiAgICAgIC5zcGxpdChcIixcIilcbiAgICAgIC5tYXAoKHQpID0+IHQudHJpbSgpKVxuICAgICAgLmZpbHRlcihCb29sZWFuKTtcbiAgcmV0dXJuIFtdO1xufVxuXG5mdW5jdGlvbiBzYWZlRmlsZW5hbWUobmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5hbWUucmVwbGFjZSgvW1xcXFwvOio/XCI8PnxdL2csIFwiLVwiKS50cmltKCkuc2xpY2UoMCwgMTAwKTtcbn1cblxuZnVuY3Rpb24gYnVpbGROb3RlQ29udGVudChwb3N0OiBCbG9nUG9zdCk6IHN0cmluZyB7XG4gIGNvbnN0IHRhZ3MgPSBwb3N0LnRhZ3MubWFwKCh0KSA9PiB0LnRhZy5uYW1lKTtcbiAgY29uc3QgbGluZXMgPSBbXG4gICAgXCItLS1cIixcbiAgICBgdGl0bGU6IFwiJHtwb3N0LnRpdGxlLnJlcGxhY2UoL1wiL2csICdcXFxcXCInKX1cImAsXG4gICAgYGJsb2ctaWQ6IFwiJHtwb3N0LmlkfVwiYCxcbiAgICBgYmxvZy16b25lOiAke3Bvc3Quem9uZX1gLFxuICAgIGBibG9nLXZpc2liaWxpdHk6ICR7cG9zdC52aXNpYmlsaXR5fWAsXG4gICAgYGJsb2ctcHVibGlzaGVkOiAke3Bvc3QucHVibGlzaGVkfWAsXG4gIF07XG4gIGlmICh0YWdzLmxlbmd0aCkge1xuICAgIGxpbmVzLnB1c2goYHRhZ3M6IFske3RhZ3MubWFwKCh0KSA9PiBgXCIke3R9XCJgKS5qb2luKFwiLCBcIil9XWApO1xuICB9XG4gIGxpbmVzLnB1c2goXG4gICAgYGJsb2ctc3luY2VkLWF0OiBcIiR7bmV3IERhdGUoKS50b0lTT1N0cmluZygpfVwiYCxcbiAgICBgYmxvZy11cGRhdGVkLWF0OiBcIiR7cG9zdC51cGRhdGVkQXR9XCJgLFxuICAgIFwiLS0tXCIsXG4gICAgXCJcIixcbiAgICBwb3N0LmNvbnRlbnRcbiAgKTtcbiAgcmV0dXJuIGxpbmVzLmpvaW4oXCJcXG5cIik7XG59XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxzQkFXTztBQThCUCxJQUFNLG1CQUFxQztBQUFBLEVBQ3pDLFNBQVM7QUFBQSxFQUNULFVBQVU7QUFBQSxFQUNWLFVBQVU7QUFBQSxFQUNWLFlBQVk7QUFBQSxFQUNaLE9BQU87QUFBQSxFQUNQLGFBQWE7QUFBQSxFQUNiLG1CQUFtQjtBQUFBLEVBQ25CLGtCQUFrQjtBQUNwQjtBQUVBLElBQU0saUJBQXVDO0FBQUEsRUFDM0MsT0FBTztBQUFBLEVBQ1AsTUFBTTtBQUFBLEVBQ04sTUFBTTtBQUNSO0FBSUEsSUFBcUIsaUJBQXJCLGNBQTRDLHVCQUFPO0FBQUEsRUFHakQsTUFBTSxTQUFTO0FBQ2IsVUFBTSxLQUFLLGFBQWE7QUFHeEIsU0FBSyxjQUFjLFNBQVMsaUJBQWlCLE1BQU07QUFDakQsVUFBSSxVQUFVLEtBQUssS0FB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
