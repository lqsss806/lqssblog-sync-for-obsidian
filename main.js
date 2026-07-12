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
  token: ""
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
    var _a;
    if (!this.settings.username || !this.settings.password) return false;
    try {
      const resp = await (0, import_obsidian.requestUrl)({
        url: `${this.settings.blogUrl}/api/auth/login`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: this.settings.username,
          password: this.settings.password
        }),
        throw: false
      });
      if (resp.status !== 200) return false;
      const token = (_a = resp.json) == null ? void 0 : _a.token;
      if (!token) return false;
      this.settings.token = token;
      await this.saveSettings();
      return true;
    } catch (e) {
      return false;
    }
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
      const ok = await this.login();
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
  /** Push a single note to the blog. Shows PublishModal if zone not set. */
  async pushNote(file) {
    var _a, _b;
    if (!this.settings.username || !this.settings.password) {
      new import_obsidian.Notice("lqssblog: \u8BF7\u5148\u5728\u63D2\u4EF6\u8BBE\u7F6E\u91CC\u586B\u5199\u7528\u6237\u540D\u548C\u5BC6\u7801");
      return;
    }
    const fm = (_b = (_a = this.app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter) != null ? _b : {};
    const zone = fm["blog-zone"];
    if (!zone) {
      new PublishModal(this.app, this, file).open();
      return;
    }
    await this.doPush(file, fm, fm["blog-id"], zone);
  }
  /** Actually push the note (called after zone is confirmed). */
  async doPush(file, fm, blogId, zone) {
    var _a;
    const rawContent = await this.app.vault.read(file);
    const body = stripFrontmatter(rawContent);
    const title = fm["title"] || file.basename;
    const visibility = fm["blog-visibility"] || "LOGIN_ONLY";
    const published = (_a = fm["blog-published"]) != null ? _a : false;
    const tags = parseTags(fm["blog-tags"]);
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
      f["blog-synced-at"] = now;
      f["blog-updated-at"] = now;
    });
    new import_obsidian.Notice(`lqssblog: \u2713 \u5DF2\u63A8\u9001\u300C${title}\u300D`);
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
          `${this.settings.syncFolder}/${safeFilename(post.title) || post.id}.md`
        );
        await this.app.vault.create(path, content);
      }
      pulled++;
    }
    new import_obsidian.Notice(`lqssblog: \u62C9\u53D6\u5B8C\u6210 \u2014\u2014 \u66F4\u65B0 ${pulled} \u7BC7\uFF0C\u8DF3\u8FC7 ${skipped} \u7BC7`);
  }
  /** Full bidirectional sync. */
  async syncAll() {
    var _a, _b;
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
        if (zone && file.path.startsWith(this.settings.syncFolder + "/")) {
          const ok = await this.doPush(file, fm, void 0, zone);
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
        `${this.settings.syncFolder}/${safeFilename(post.title) || post.id}.md`
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
  async ensureSyncFolder() {
    const folder = this.settings.syncFolder;
    if (!await this.app.vault.adapter.exists(folder)) {
      await this.app.vault.createFolder(folder);
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
var PublishModal = class extends import_obsidian.Modal {
  constructor(app, plugin, file) {
    super(app);
    this.plugin = plugin;
    this.file = file;
  }
  onOpen() {
    var _a, _b;
    const { contentEl } = this;
    const fm = (_b = (_a = this.app.metadataCache.getFileCache(this.file)) == null ? void 0 : _a.frontmatter) != null ? _b : {};
    contentEl.createEl("h3", { text: "\u53D1\u5E03\u5230 lqssblog" });
    let title = fm["title"] || this.file.basename;
    let zone = "ANIME";
    let visibility = "LOGIN_ONLY";
    let published = false;
    let tags = parseTags(fm["blog-tags"]).join(", ");
    new import_obsidian.Setting(contentEl).setName("\u6807\u9898").addText(
      (t) => t.setValue(title).onChange((v) => title = v)
    );
    new import_obsidian.Setting(contentEl).setName("\u5206\u533A").addDropdown((d) => {
      d.addOption("ANIME", "\u4E8C\u6B21\u5143\uFF08ANIME\uFF09");
      d.addOption("REAL", "\u4E09\u6B21\u5143\uFF08REAL\uFF09");
      d.addOption("FOUR", "4\u9891\u9053\uFF08FOUR\uFF09");
      d.setValue(zone).onChange((v) => zone = v);
    });
    new import_obsidian.Setting(contentEl).setName("\u53EF\u89C1\u6027").addDropdown((d) => {
      d.addOption("LOGIN_ONLY", "\u4EC5\u767B\u5F55\u7528\u6237");
      d.addOption("PUBLIC", "\u516C\u5F00");
      d.addOption("FRIENDS_ONLY", "\u4EC5\u597D\u53CB");
      d.setValue(visibility).onChange((v) => visibility = v);
    });
    new import_obsidian.Setting(contentEl).setName("\u6807\u7B7E").setDesc("\u591A\u4E2A\u6807\u7B7E\u7528\u9017\u53F7\u5206\u9694").addText(
      (t) => t.setPlaceholder("tag1, tag2").setValue(tags).onChange((v) => tags = v)
    );
    new import_obsidian.Setting(contentEl).setName("\u7ACB\u5373\u53D1\u5E03").setDesc("\u5173\u95ED\u5219\u4FDD\u5B58\u4E3A\u8349\u7A3F").addToggle(
      (t) => t.setValue(published).onChange((v) => published = v)
    );
    new import_obsidian.Setting(contentEl).addButton(
      (btn) => btn.setButtonText("\u53D1\u5E03").setCta().onClick(async () => {
        this.close();
        const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
        await this.app.fileManager.processFrontMatter(this.file, (f) => {
          f["title"] = title;
          f["blog-zone"] = zone;
          f["blog-visibility"] = visibility;
          f["blog-published"] = published;
          f["blog-tags"] = tagList;
        });
        await this.plugin.doPush(
          this.file,
          {
            title,
            "blog-zone": zone,
            "blog-visibility": visibility,
            "blog-published": published,
            "blog-tags": tagList
          },
          void 0,
          zone
        );
      })
    );
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
    new import_obsidian.Setting(containerEl).setName("\u540C\u6B65\u6587\u4EF6\u5939").setDesc("\u62C9\u53D6\u7684\u6587\u7AE0\u4FDD\u5B58\u5230\u6B64\u6587\u4EF6\u5939\uFF08\u76F8\u5BF9 vault \u6839\u76EE\u5F55\uFF09").addText(
      (t) => t.setPlaceholder("blog").setValue(this.plugin.settings.syncFolder).onChange(async (v) => {
        this.plugin.settings.syncFolder = v.trim().replace(/\/$/, "");
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u6D4B\u8BD5\u8FDE\u63A5").setDesc("\u9A8C\u8BC1\u7528\u6237\u540D\u548C\u5BC6\u7801\u662F\u5426\u6B63\u786E").addButton(
      (btn) => btn.setButtonText("\u6D4B\u8BD5").onClick(async () => {
        btn.setButtonText("\u8FDE\u63A5\u4E2D\u2026").setDisabled(true);
        const ok = await this.plugin.login();
        btn.setDisabled(false);
        if (ok) {
          btn.setButtonText("\u2713 \u6210\u529F");
          new import_obsidian.Notice("lqssblog: \u767B\u5F55\u6210\u529F");
        } else {
          btn.setButtonText("\u2717 \u5931\u8D25");
          new import_obsidian.Notice("lqssblog: \u767B\u5F55\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7528\u6237\u540D/\u5BC6\u7801/\u535A\u5BA2\u5730\u5740");
        }
        setTimeout(() => btn.setButtonText("\u6D4B\u8BD5"), 3e3);
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
    lines.push(`blog-tags: [${tags.map((t) => `"${t}"`).join(", ")}]`);
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7XG4gIEFwcCxcbiAgTW9kYWwsXG4gIE5vdGljZSxcbiAgUGx1Z2luLFxuICBQbHVnaW5TZXR0aW5nVGFiLFxuICBTZXR0aW5nLFxuICBURmlsZSxcbiAgcmVxdWVzdFVybCxcbiAgUmVxdWVzdFVybFBhcmFtLFxuICBSZXF1ZXN0VXJsUmVzcG9uc2UsXG59IGZyb20gXCJvYnNpZGlhblwiO1xuXG4vLyA9PT09PSBUeXBlcyA9PT09PVxuXG50eXBlIFpvbmUgPSBcIkFOSU1FXCIgfCBcIlJFQUxcIiB8IFwiRk9VUlwiO1xudHlwZSBWaXNpYmlsaXR5ID0gXCJQVUJMSUNcIiB8IFwiTE9HSU5fT05MWVwiIHwgXCJGUklFTkRTX09OTFlcIjtcblxuaW50ZXJmYWNlIEJsb2dQb3N0IHtcbiAgaWQ6IHN0cmluZztcbiAgdGl0bGU6IHN0cmluZztcbiAgY29udGVudDogc3RyaW5nO1xuICB6b25lOiBab25lO1xuICB2aXNpYmlsaXR5OiBWaXNpYmlsaXR5O1xuICBwdWJsaXNoZWQ6IGJvb2xlYW47XG4gIGNyZWF0ZWRBdDogc3RyaW5nO1xuICB1cGRhdGVkQXQ6IHN0cmluZztcbiAgdGFnczogeyB0YWc6IHsgbmFtZTogc3RyaW5nIH0gfVtdO1xufVxuXG5pbnRlcmZhY2UgTHFzc2Jsb2dTZXR0aW5ncyB7XG4gIGJsb2dVcmw6IHN0cmluZztcbiAgdXNlcm5hbWU6IHN0cmluZztcbiAgcGFzc3dvcmQ6IHN0cmluZztcbiAgc3luY0ZvbGRlcjogc3RyaW5nO1xuICB0b2tlbjogc3RyaW5nO1xufVxuXG5jb25zdCBERUZBVUxUX1NFVFRJTkdTOiBMcXNzYmxvZ1NldHRpbmdzID0ge1xuICBibG9nVXJsOiBcImh0dHBzOi8vbHFzc2Jsb2cuc2VydmVibG9nLm5ldFwiLFxuICB1c2VybmFtZTogXCJcIixcbiAgcGFzc3dvcmQ6IFwiXCIsXG4gIHN5bmNGb2xkZXI6IFwiYmxvZ1wiLFxuICB0b2tlbjogXCJcIixcbn07XG5cbi8vID09PT09IFBsdWdpbiA9PT09PVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBMcXNzYmxvZ1BsdWdpbiBleHRlbmRzIFBsdWdpbiB7XG4gIHNldHRpbmdzOiBMcXNzYmxvZ1NldHRpbmdzO1xuXG4gIGFzeW5jIG9ubG9hZCgpIHtcbiAgICBhd2FpdCB0aGlzLmxvYWRTZXR0aW5ncygpO1xuXG4gICAgLy8gUmliYm9uIGljb25cbiAgICB0aGlzLmFkZFJpYmJvbkljb24oXCJjbG91ZFwiLCBcImxxc3NibG9nIFN5bmNcIiwgKCkgPT4ge1xuICAgICAgbmV3IFN5bmNNb2RhbCh0aGlzLmFwcCwgdGhpcykub3BlbigpO1xuICAgIH0pO1xuXG4gICAgLy8gQ29tbWFuZHNcbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwicHVzaC1jdXJyZW50LW5vdGVcIixcbiAgICAgIG5hbWU6IFwiXHU2M0E4XHU5MDAxXHU1RjUzXHU1MjREXHU3QjE0XHU4QkIwXHU1MjMwXHU1MzVBXHU1QkEyXCIsXG4gICAgICBjYWxsYmFjazogKCkgPT4ge1xuICAgICAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKTtcbiAgICAgICAgaWYgKGZpbGUpIHRoaXMucHVzaE5vdGUoZmlsZSk7XG4gICAgICAgIGVsc2UgbmV3IE5vdGljZShcImxxc3NibG9nOiBcdTZDQTFcdTY3MDlcdTYyNTNcdTVGMDBcdTc2ODRcdTdCMTRcdThCQjBcIik7XG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcInB1bGwtYWxsLXBvc3RzXCIsXG4gICAgICBuYW1lOiBcIlx1NEVDRVx1NTM1QVx1NUJBMlx1NjJDOVx1NTNENlx1NTE2OFx1OTBFOFx1NjU4N1x1N0FFMFwiLFxuICAgICAgY2FsbGJhY2s6ICgpID0+IHRoaXMucHVsbEFsbFBvc3RzKCksXG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwic3luYy1hbGxcIixcbiAgICAgIG5hbWU6IFwiXHU0RTBFXHU1MzVBXHU1QkEyXHU1MTY4XHU5MUNGXHU1M0NDXHU1NDExXHU1NDBDXHU2QjY1XCIsXG4gICAgICBjYWxsYmFjazogKCkgPT4gdGhpcy5zeW5jQWxsKCksXG4gICAgfSk7XG5cbiAgICAvLyBSaWdodC1jbGljayBjb250ZXh0IG1lbnVcbiAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXG4gICAgICB0aGlzLmFwcC53b3Jrc3BhY2Uub24oXCJmaWxlLW1lbnVcIiwgKG1lbnUsIGZpbGUpID0+IHtcbiAgICAgICAgaWYgKGZpbGUgaW5zdGFuY2VvZiBURmlsZSAmJiBmaWxlLmV4dGVuc2lvbiA9PT0gXCJtZFwiKSB7XG4gICAgICAgICAgbWVudS5hZGRJdGVtKChpdGVtKSA9PiB7XG4gICAgICAgICAgICBpdGVtXG4gICAgICAgICAgICAgIC5zZXRUaXRsZShcIlx1NjNBOFx1OTAwMVx1NTIzMCBscXNzYmxvZ1wiKVxuICAgICAgICAgICAgICAuc2V0SWNvbihcInVwbG9hZC1jbG91ZFwiKVxuICAgICAgICAgICAgICAub25DbGljaygoKSA9PiB0aGlzLnB1c2hOb3RlKGZpbGUpKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICApO1xuXG4gICAgdGhpcy5hZGRTZXR0aW5nVGFiKG5ldyBMcXNzYmxvZ1NldHRpbmdUYWIodGhpcy5hcHAsIHRoaXMpKTtcbiAgfVxuXG4gIG9udW5sb2FkKCkge31cblxuICAvLyA9PT09PSBBdXRoID09PT09XG5cbiAgYXN5bmMgbG9naW4oKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgaWYgKCF0aGlzLnNldHRpbmdzLnVzZXJuYW1lIHx8ICF0aGlzLnNldHRpbmdzLnBhc3N3b3JkKSByZXR1cm4gZmFsc2U7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3AgPSBhd2FpdCByZXF1ZXN0VXJsKHtcbiAgICAgICAgdXJsOiBgJHt0aGlzLnNldHRpbmdzLmJsb2dVcmx9L2FwaS9hdXRoL2xvZ2luYCxcbiAgICAgICAgbWV0aG9kOiBcIlBPU1RcIixcbiAgICAgICAgaGVhZGVyczogeyBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIiB9LFxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgdXNlcm5hbWU6IHRoaXMuc2V0dGluZ3MudXNlcm5hbWUsXG4gICAgICAgICAgcGFzc3dvcmQ6IHRoaXMuc2V0dGluZ3MucGFzc3dvcmQsXG4gICAgICAgIH0pLFxuICAgICAgICB0aHJvdzogZmFsc2UsXG4gICAgICB9KTtcbiAgICAgIGlmIChyZXNwLnN0YXR1cyAhPT0gMjAwKSByZXR1cm4gZmFsc2U7XG5cbiAgICAgIC8vIFJlYWQgdG9rZW4gZnJvbSByZXNwb25zZSBib2R5IChtb3JlIHJlbGlhYmxlIHRoYW4gc2V0LWNvb2tpZSBoZWFkZXIpXG4gICAgICBjb25zdCB0b2tlbiA9IChyZXNwLmpzb24gYXMgeyB0b2tlbj86IHN0cmluZyB9KT8udG9rZW47XG4gICAgICBpZiAoIXRva2VuKSByZXR1cm4gZmFsc2U7XG5cbiAgICAgIHRoaXMuc2V0dGluZ3MudG9rZW4gPSB0b2tlbjtcbiAgICAgIGF3YWl0IHRoaXMuc2F2ZVNldHRpbmdzKCk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICBnZXRIZWFkZXJzKCk6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4ge1xuICAgIHJldHVybiB7XG4gICAgICBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIixcbiAgICAgIENvb2tpZTogYHRva2VuPSR7dGhpcy5zZXR0aW5ncy50b2tlbn1gLFxuICAgIH07XG4gIH1cblxuICAvLyBBdXRvLXJldHJ5IHdpdGggcmUtbG9naW4gb24gNDAxXG4gIGFzeW5jIGFwaVJlcShcbiAgICBvcHRpb25zOiBSZXF1ZXN0VXJsUGFyYW0sXG4gICAgcmV0cmllZCA9IGZhbHNlXG4gICk6IFByb21pc2U8UmVxdWVzdFVybFJlc3BvbnNlPiB7XG4gICAgY29uc3QgcmVzcCA9IGF3YWl0IHJlcXVlc3RVcmwoe1xuICAgICAgLi4ub3B0aW9ucyxcbiAgICAgIGhlYWRlcnM6IHsgLi4udGhpcy5nZXRIZWFkZXJzKCksIC4uLihvcHRpb25zLmhlYWRlcnMgPz8ge30pIH0sXG4gICAgICB0aHJvdzogZmFsc2UsXG4gICAgfSk7XG4gICAgaWYgKHJlc3Auc3RhdHVzID09PSA0MDEgJiYgIXJldHJpZWQpIHtcbiAgICAgIGNvbnN0IG9rID0gYXdhaXQgdGhpcy5sb2dpbigpO1xuICAgICAgaWYgKG9rKSByZXR1cm4gdGhpcy5hcGlSZXEob3B0aW9ucywgdHJ1ZSk7XG4gICAgfVxuICAgIHJldHVybiByZXNwO1xuICB9XG5cbiAgLy8gPT09PT0gQVBJID09PT09XG5cbiAgYXN5bmMgZmV0Y2hNeVBvc3RzKCk6IFByb21pc2U8QmxvZ1Bvc3RbXT4ge1xuICAgIGNvbnN0IHJlc3AgPSBhd2FpdCB0aGlzLmFwaVJlcSh7XG4gICAgICB1cmw6IGAke3RoaXMuc2V0dGluZ3MuYmxvZ1VybH0vYXBpL3VzZXIvcG9zdHNgLFxuICAgIH0pO1xuICAgIGlmIChyZXNwLnN0YXR1cyAhPT0gMjAwKSByZXR1cm4gW107XG4gICAgcmV0dXJuIChyZXNwLmpzb24gYXMgeyBwb3N0czogQmxvZ1Bvc3RbXSB9KS5wb3N0cyA/PyBbXTtcbiAgfVxuXG4gIGFzeW5jIGNyZWF0ZVBvc3QoZGF0YToge1xuICAgIHRpdGxlOiBzdHJpbmc7XG4gICAgY29udGVudDogc3RyaW5nO1xuICAgIHpvbmU6IFpvbmU7XG4gICAgdmlzaWJpbGl0eTogVmlzaWJpbGl0eTtcbiAgICBwdWJsaXNoZWQ6IGJvb2xlYW47XG4gICAgdGFnczogc3RyaW5nW107XG4gIH0pOiBQcm9taXNlPEJsb2dQb3N0IHwgbnVsbD4ge1xuICAgIGNvbnN0IHJlc3AgPSBhd2FpdCB0aGlzLmFwaVJlcSh7XG4gICAgICB1cmw6IGAke3RoaXMuc2V0dGluZ3MuYmxvZ1VybH0vYXBpL3Bvc3RzYCxcbiAgICAgIG1ldGhvZDogXCJQT1NUXCIsXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShkYXRhKSxcbiAgICB9KTtcbiAgICBpZiAocmVzcC5zdGF0dXMgIT09IDIwMSkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIChyZXNwLmpzb24gYXMgeyBwb3N0OiBCbG9nUG9zdCB9KS5wb3N0ID8/IG51bGw7XG4gIH1cblxuICBhc3luYyB1cGRhdGVQb3N0KFxuICAgIGlkOiBzdHJpbmcsXG4gICAgZGF0YToge1xuICAgICAgdGl0bGU6IHN0cmluZztcbiAgICAgIGNvbnRlbnQ6IHN0cmluZztcbiAgICAgIHpvbmU6IFpvbmU7XG4gICAgICB2aXNpYmlsaXR5OiBWaXNpYmlsaXR5O1xuICAgICAgcHVibGlzaGVkOiBib29sZWFuO1xuICAgICAgdGFnczogc3RyaW5nW107XG4gICAgfVxuICApOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBjb25zdCByZXNwID0gYXdhaXQgdGhpcy5hcGlSZXEoe1xuICAgICAgdXJsOiBgJHt0aGlzLnNldHRpbmdzLmJsb2dVcmx9L2FwaS9wb3N0cy8ke2lkfWAsXG4gICAgICBtZXRob2Q6IFwiUFVUXCIsXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShkYXRhKSxcbiAgICB9KTtcbiAgICByZXR1cm4gcmVzcC5zdGF0dXMgPT09IDIwMDtcbiAgfVxuXG4gIC8vID09PT09IENvcmUgU3luYyA9PT09PVxuXG4gIC8qKiBQdXNoIGEgc2luZ2xlIG5vdGUgdG8gdGhlIGJsb2cuIFNob3dzIFB1Ymxpc2hNb2RhbCBpZiB6b25lIG5vdCBzZXQuICovXG4gIGFzeW5jIHB1c2hOb3RlKGZpbGU6IFRGaWxlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCF0aGlzLnNldHRpbmdzLnVzZXJuYW1lIHx8ICF0aGlzLnNldHRpbmdzLnBhc3N3b3JkKSB7XG4gICAgICBuZXcgTm90aWNlKFwibHFzc2Jsb2c6IFx1OEJGN1x1NTE0OFx1NTcyOFx1NjNEMlx1NEVGNlx1OEJCRVx1N0Y2RVx1OTFDQ1x1NTg2Qlx1NTE5OVx1NzUyOFx1NjIzN1x1NTQwRFx1NTQ4Q1x1NUJDNlx1NzgwMVwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBmbSA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpPy5mcm9udG1hdHRlciA/PyB7fTtcbiAgICBjb25zdCB6b25lID0gZm1bXCJibG9nLXpvbmVcIl0gYXMgWm9uZSB8IHVuZGVmaW5lZDtcblxuICAgIGlmICghem9uZSkge1xuICAgICAgbmV3IFB1Ymxpc2hNb2RhbCh0aGlzLmFwcCwgdGhpcywgZmlsZSkub3BlbigpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuZG9QdXNoKGZpbGUsIGZtIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBmbVtcImJsb2ctaWRcIl0gYXMgc3RyaW5nIHwgdW5kZWZpbmVkLCB6b25lKTtcbiAgfVxuXG4gIC8qKiBBY3R1YWxseSBwdXNoIHRoZSBub3RlIChjYWxsZWQgYWZ0ZXIgem9uZSBpcyBjb25maXJtZWQpLiAqL1xuICBhc3luYyBkb1B1c2goXG4gICAgZmlsZTogVEZpbGUsXG4gICAgZm06IFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuICAgIGJsb2dJZDogc3RyaW5nIHwgdW5kZWZpbmVkLFxuICAgIHpvbmU6IFpvbmVcbiAgKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgY29uc3QgcmF3Q29udGVudCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LnJlYWQoZmlsZSk7XG4gICAgY29uc3QgYm9keSA9IHN0cmlwRnJvbnRtYXR0ZXIocmF3Q29udGVudCk7XG5cbiAgICBjb25zdCB0aXRsZSA9IChmbVtcInRpdGxlXCJdIGFzIHN0cmluZykgfHwgZmlsZS5iYXNlbmFtZTtcbiAgICBjb25zdCB2aXNpYmlsaXR5ID0gKGZtW1wiYmxvZy12aXNpYmlsaXR5XCJdIGFzIFZpc2liaWxpdHkpIHx8IFwiTE9HSU5fT05MWVwiO1xuICAgIGNvbnN0IHB1Ymxpc2hlZCA9IChmbVtcImJsb2ctcHVibGlzaGVkXCJdIGFzIGJvb2xlYW4pID8/IGZhbHNlO1xuICAgIGNvbnN0IHRhZ3MgPSBwYXJzZVRhZ3MoZm1bXCJibG9nLXRhZ3NcIl0pO1xuXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgIGNvbnN0IGRhdGEgPSB7IHRpdGxlLCBjb250ZW50OiBib2R5LCB6b25lLCB2aXNpYmlsaXR5LCBwdWJsaXNoZWQsIHRhZ3MgfTtcblxuICAgIGlmIChibG9nSWQpIHtcbiAgICAgIGNvbnN0IG9rID0gYXdhaXQgdGhpcy51cGRhdGVQb3N0KGJsb2dJZCwgZGF0YSk7XG4gICAgICBpZiAoIW9rKSB7XG4gICAgICAgIG5ldyBOb3RpY2UoYGxxc3NibG9nOiBcdTI3MTcgXHU2NkY0XHU2NUIwXHU1OTMxXHU4RDI1IFx1MjAxNFx1MzAwQyR7dGl0bGV9XHUzMDBEYCk7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgcG9zdCA9IGF3YWl0IHRoaXMuY3JlYXRlUG9zdChkYXRhKTtcbiAgICAgIGlmICghcG9zdCkge1xuICAgICAgICBuZXcgTm90aWNlKGBscXNzYmxvZzogXHUyNzE3IFx1NTNEMVx1NUUwM1x1NTkzMVx1OEQyNSBcdTIwMTRcdTMwMEMke3RpdGxlfVx1MzAwRGApO1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgICBibG9nSWQgPSBwb3N0LmlkO1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuYXBwLmZpbGVNYW5hZ2VyLnByb2Nlc3NGcm9udE1hdHRlcihmaWxlLCAoZikgPT4ge1xuICAgICAgZltcImJsb2ctaWRcIl0gPSBibG9nSWQ7XG4gICAgICBmW1wiYmxvZy1zeW5jZWQtYXRcIl0gPSBub3c7XG4gICAgICBmW1wiYmxvZy11cGRhdGVkLWF0XCJdID0gbm93O1xuICAgIH0pO1xuXG4gICAgbmV3IE5vdGljZShgbHFzc2Jsb2c6IFx1MjcxMyBcdTVERjJcdTYzQThcdTkwMDFcdTMwMEMke3RpdGxlfVx1MzAwRGApO1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgLyoqIFB1bGwgYWxsIHVzZXIncyBwb3N0cyBmcm9tIHRoZSBibG9nIGludG8gdGhlIHN5bmMgZm9sZGVyLiAqL1xuICBhc3luYyBwdWxsQWxsUG9zdHMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCF0aGlzLnNldHRpbmdzLnVzZXJuYW1lIHx8ICF0aGlzLnNldHRpbmdzLnBhc3N3b3JkKSB7XG4gICAgICBuZXcgTm90aWNlKFwibHFzc2Jsb2c6IFx1OEJGN1x1NTE0OFx1NTcyOFx1NjNEMlx1NEVGNlx1OEJCRVx1N0Y2RVx1OTFDQ1x1NTg2Qlx1NTE5OVx1NzUyOFx1NjIzN1x1NTQwRFx1NTQ4Q1x1NUJDNlx1NzgwMVwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBuZXcgTm90aWNlKFwibHFzc2Jsb2c6IFx1NkI2M1x1NTcyOFx1NjJDOVx1NTNENlx1MjAyNlwiKTtcbiAgICBjb25zdCBwb3N0cyA9IGF3YWl0IHRoaXMuZmV0Y2hNeVBvc3RzKCk7XG5cbiAgICBpZiAoIXBvc3RzLmxlbmd0aCkge1xuICAgICAgbmV3IE5vdGljZShcImxxc3NibG9nOiBcdTUzNUFcdTVCQTJcdTRFMEFcdThGRDhcdTZDQTFcdTY3MDlcdTY1ODdcdTdBRTBcIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5lbnN1cmVTeW5jRm9sZGVyKCk7XG5cbiAgICBsZXQgcHVsbGVkID0gMCwgc2tpcHBlZCA9IDA7XG5cbiAgICBmb3IgKGNvbnN0IHBvc3Qgb2YgcG9zdHMpIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5maW5kRmlsZUJ5QmxvZ0lkKHBvc3QuaWQpO1xuICAgICAgY29uc3Qgc3luY2VkQXQgPSBleGlzdGluZ1xuICAgICAgICA/ICh0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShleGlzdGluZyk/LmZyb250bWF0dGVyPy5bXG4gICAgICAgICAgICBcImJsb2ctc3luY2VkLWF0XCJcbiAgICAgICAgICBdIGFzIHN0cmluZyB8IHVuZGVmaW5lZClcbiAgICAgICAgOiB1bmRlZmluZWQ7XG5cbiAgICAgIGNvbnN0IGJsb2dVcGRhdGVkQXQgPSBuZXcgRGF0ZShwb3N0LnVwZGF0ZWRBdCkuZ2V0VGltZSgpO1xuICAgICAgY29uc3QgbGFzdFN5bmNUaW1lID0gc3luY2VkQXQgPyBuZXcgRGF0ZShzeW5jZWRBdCkuZ2V0VGltZSgpIDogMDtcblxuICAgICAgaWYgKGV4aXN0aW5nICYmIGJsb2dVcGRhdGVkQXQgPD0gbGFzdFN5bmNUaW1lKSB7XG4gICAgICAgIHNraXBwZWQrKztcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNvbnRlbnQgPSBidWlsZE5vdGVDb250ZW50KHBvc3QpO1xuICAgICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0Lm1vZGlmeShleGlzdGluZywgY29udGVudCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCBwYXRoID0gYXdhaXQgdGhpcy51bmlxdWVQYXRoKFxuICAgICAgICAgIGAke3RoaXMuc2V0dGluZ3Muc3luY0ZvbGRlcn0vJHtzYWZlRmlsZW5hbWUocG9zdC50aXRsZSkgfHwgcG9zdC5pZH0ubWRgXG4gICAgICAgICk7XG4gICAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNyZWF0ZShwYXRoLCBjb250ZW50KTtcbiAgICAgIH1cbiAgICAgIHB1bGxlZCsrO1xuICAgIH1cblxuICAgIG5ldyBOb3RpY2UoYGxxc3NibG9nOiBcdTYyQzlcdTUzRDZcdTVCOENcdTYyMTAgXHUyMDE0XHUyMDE0IFx1NjZGNFx1NjVCMCAke3B1bGxlZH0gXHU3QkM3XHVGRjBDXHU4REYzXHU4RkM3ICR7c2tpcHBlZH0gXHU3QkM3YCk7XG4gIH1cblxuICAvKiogRnVsbCBiaWRpcmVjdGlvbmFsIHN5bmMuICovXG4gIGFzeW5jIHN5bmNBbGwoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCF0aGlzLnNldHRpbmdzLnVzZXJuYW1lIHx8ICF0aGlzLnNldHRpbmdzLnBhc3N3b3JkKSB7XG4gICAgICBuZXcgTm90aWNlKFwibHFzc2Jsb2c6IFx1OEJGN1x1NTE0OFx1NTcyOFx1NjNEMlx1NEVGNlx1OEJCRVx1N0Y2RVx1OTFDQ1x1NTg2Qlx1NTE5OVx1NzUyOFx1NjIzN1x1NTQwRFx1NTQ4Q1x1NUJDNlx1NzgwMVwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBuZXcgTm90aWNlKFwibHFzc2Jsb2c6IFx1NUYwMFx1NTlDQlx1NTNDQ1x1NTQxMVx1NTQwQ1x1NkI2NVx1MjAyNlwiKTtcbiAgICBjb25zdCBwb3N0cyA9IGF3YWl0IHRoaXMuZmV0Y2hNeVBvc3RzKCk7XG4gICAgY29uc3QgYmxvZ01hcCA9IG5ldyBNYXA8c3RyaW5nLCBCbG9nUG9zdD4ocG9zdHMubWFwKChwKSA9PiBbcC5pZCwgcF0pKTtcblxuICAgIGF3YWl0IHRoaXMuZW5zdXJlU3luY0ZvbGRlcigpO1xuXG4gICAgbGV0IHB1c2hlZCA9IDAsIHB1bGxlZCA9IDAsIGNvbmZsaWN0cyA9IDAsIGNyZWF0ZWQgPSAwO1xuICAgIGNvbnN0IHByb2Nlc3NlZElkcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4gICAgLy8gUHJvY2VzcyBhbGwgbG9jYWwgZmlsZXNcbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgdGhpcy5hcHAudmF1bHQuZ2V0TWFya2Rvd25GaWxlcygpKSB7XG4gICAgICBjb25zdCBmbSA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpPy5mcm9udG1hdHRlciA/PyB7fTtcbiAgICAgIGNvbnN0IGJsb2dJZCA9IGZtW1wiYmxvZy1pZFwiXSBhcyBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gICAgICBjb25zdCB6b25lID0gZm1bXCJibG9nLXpvbmVcIl0gYXMgWm9uZSB8IHVuZGVmaW5lZDtcblxuICAgICAgaWYgKCFibG9nSWQpIHtcbiAgICAgICAgLy8gTmV3IGxvY2FsIGZpbGUgaW4gc3luYyBmb2xkZXIgd2l0aCB6b25lIHNldCBcdTIxOTIgcHVzaCB0byBjcmVhdGVcbiAgICAgICAgaWYgKHpvbmUgJiYgZmlsZS5wYXRoLnN0YXJ0c1dpdGgodGhpcy5zZXR0aW5ncy5zeW5jRm9sZGVyICsgXCIvXCIpKSB7XG4gICAgICAgICAgY29uc3Qgb2sgPSBhd2FpdCB0aGlzLmRvUHVzaChmaWxlLCBmbSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgdW5kZWZpbmVkLCB6b25lKTtcbiAgICAgICAgICBpZiAob2spIGNyZWF0ZWQrKztcbiAgICAgICAgfVxuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgcHJvY2Vzc2VkSWRzLmFkZChibG9nSWQpO1xuICAgICAgY29uc3QgYmxvZ1Bvc3QgPSBibG9nTWFwLmdldChibG9nSWQpO1xuICAgICAgaWYgKCFibG9nUG9zdCkgY29udGludWU7IC8vIHBvc3QgZGVsZXRlZCBvbiBibG9nIHNpZGUgXHUyMDE0IHNraXBcblxuICAgICAgY29uc3Qgc3luY2VkQXQgPSBmbVtcImJsb2ctc3luY2VkLWF0XCJdIGFzIHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICAgIGNvbnN0IGxhc3RTeW5jVGltZSA9IHN5bmNlZEF0ID8gbmV3IERhdGUoc3luY2VkQXQpLmdldFRpbWUoKSA6IDA7XG4gICAgICBjb25zdCBibG9nVXBkYXRlZEF0ID0gbmV3IERhdGUoYmxvZ1Bvc3QudXBkYXRlZEF0KS5nZXRUaW1lKCk7XG4gICAgICBjb25zdCBsb2NhbFVwZGF0ZWRBdCA9IGZpbGUuc3RhdC5tdGltZTtcbiAgICAgIGNvbnN0IEJVRkZFUiA9IDVfMDAwOyAvLyA1cyB0b2xlcmFuY2UgZm9yIGNsb2NrIHNrZXdcblxuICAgICAgY29uc3QgYmxvZ05ld2VyID0gYmxvZ1VwZGF0ZWRBdCA+IGxhc3RTeW5jVGltZSArIEJVRkZFUjtcbiAgICAgIGNvbnN0IGxvY2FsTmV3ZXIgPSBsb2NhbFVwZGF0ZWRBdCA+IGxhc3RTeW5jVGltZSArIEJVRkZFUjtcblxuICAgICAgaWYgKGJsb2dOZXdlciAmJiBsb2NhbE5ld2VyKSB7XG4gICAgICAgIGNvbmZsaWN0cysrO1xuICAgICAgICBuZXcgTm90aWNlKFxuICAgICAgICAgIGBscXNzYmxvZzogXHUyNkEwIFx1NTFCMlx1N0E4MSBcdTIwMTRcdTMwMEMke2ZpbGUuYmFzZW5hbWV9XHUzMDBEXHU2NzJDXHU1NzMwXHU1NDhDXHU4RkRDXHU3QUVGXHU5MEZEXHU2NzA5XHU2NkY0XHU2NTM5XHVGRjBDXHU1REYyXHU4REYzXHU4RkM3XHVGRjBDXHU4QkY3XHU2MjRCXHU1MkE4XHU1OTA0XHU3NDA2YFxuICAgICAgICApO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgaWYgKGxvY2FsTmV3ZXIpIHtcbiAgICAgICAgY29uc3Qgb2sgPSBhd2FpdCB0aGlzLmRvUHVzaChcbiAgICAgICAgICBmaWxlLFxuICAgICAgICAgIGZtIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuICAgICAgICAgIGJsb2dJZCxcbiAgICAgICAgICB6b25lID8/IChibG9nUG9zdC56b25lIGFzIFpvbmUpXG4gICAgICAgICk7XG4gICAgICAgIGlmIChvaykgcHVzaGVkKys7XG4gICAgICB9IGVsc2UgaWYgKGJsb2dOZXdlcikge1xuICAgICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5tb2RpZnkoZmlsZSwgYnVpbGROb3RlQ29udGVudChibG9nUG9zdCkpO1xuICAgICAgICBwdWxsZWQrKztcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBQdWxsIHBvc3RzIGZyb20gYmxvZyB0aGF0IGRvbid0IGV4aXN0IGxvY2FsbHkgeWV0XG4gICAgZm9yIChjb25zdCBwb3N0IG9mIHBvc3RzKSB7XG4gICAgICBpZiAocHJvY2Vzc2VkSWRzLmhhcyhwb3N0LmlkKSkgY29udGludWU7XG4gICAgICBjb25zdCBwYXRoID0gYXdhaXQgdGhpcy51bmlxdWVQYXRoKFxuICAgICAgICBgJHt0aGlzLnNldHRpbmdzLnN5bmNGb2xkZXJ9LyR7c2FmZUZpbGVuYW1lKHBvc3QudGl0bGUpIHx8IHBvc3QuaWR9Lm1kYFxuICAgICAgKTtcbiAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNyZWF0ZShwYXRoLCBidWlsZE5vdGVDb250ZW50KHBvc3QpKTtcbiAgICAgIHB1bGxlZCsrO1xuICAgIH1cblxuICAgIGNvbnN0IHN1bW1hcnkgPSBbXG4gICAgICBgXHUyMTkxIFx1NjNBOFx1OTAwMSAke3B1c2hlZCArIGNyZWF0ZWR9YCxcbiAgICAgIGBcdTIxOTMgXHU2MkM5XHU1M0Q2ICR7cHVsbGVkfWAsXG4gICAgICBjb25mbGljdHMgPyBgXHUyNkEwICR7Y29uZmxpY3RzfSBcdTRFMkFcdTUxQjJcdTdBODFgIDogXCJcIixcbiAgICBdXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pXG4gICAgICAuam9pbihcIiAgIFwiKTtcblxuICAgIG5ldyBOb3RpY2UoYGxxc3NibG9nOiBcdTU0MENcdTZCNjVcdTVCOENcdTYyMTAgXHUyMDE0XHUyMDE0ICR7c3VtbWFyeX1gKTtcbiAgfVxuXG4gIC8vID09PT09IEhlbHBlcnMgPT09PT1cblxuICBmaW5kRmlsZUJ5QmxvZ0lkKGJsb2dJZDogc3RyaW5nKTogVEZpbGUgfCBudWxsIHtcbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgdGhpcy5hcHAudmF1bHQuZ2V0TWFya2Rvd25GaWxlcygpKSB7XG4gICAgICBjb25zdCBmbSA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpPy5mcm9udG1hdHRlcjtcbiAgICAgIGlmIChmbT8uW1wiYmxvZy1pZFwiXSA9PT0gYmxvZ0lkKSByZXR1cm4gZmlsZTtcbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBhc3luYyBlbnN1cmVTeW5jRm9sZGVyKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGZvbGRlciA9IHRoaXMuc2V0dGluZ3Muc3luY0ZvbGRlcjtcbiAgICBpZiAoIShhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLmV4aXN0cyhmb2xkZXIpKSkge1xuICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuY3JlYXRlRm9sZGVyKGZvbGRlcik7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgdW5pcXVlUGF0aChwYXRoOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGlmICghKGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIuZXhpc3RzKHBhdGgpKSkgcmV0dXJuIHBhdGg7XG4gICAgY29uc3QgYmFzZSA9IHBhdGgucmVwbGFjZSgvXFwubWQkLywgXCJcIik7XG4gICAgbGV0IGkgPSAxO1xuICAgIHdoaWxlIChhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLmV4aXN0cyhgJHtiYXNlfS0ke2l9Lm1kYCkpIGkrKztcbiAgICByZXR1cm4gYCR7YmFzZX0tJHtpfS5tZGA7XG4gIH1cblxuICBhc3luYyBsb2FkU2V0dGluZ3MoKSB7XG4gICAgdGhpcy5zZXR0aW5ncyA9IE9iamVjdC5hc3NpZ24oe30sIERFRkFVTFRfU0VUVElOR1MsIGF3YWl0IHRoaXMubG9hZERhdGEoKSk7XG4gIH1cblxuICBhc3luYyBzYXZlU2V0dGluZ3MoKSB7XG4gICAgYXdhaXQgdGhpcy5zYXZlRGF0YSh0aGlzLnNldHRpbmdzKTtcbiAgfVxufVxuXG4vLyA9PT09PSBTeW5jIE1vZGFsIChSaWJib24gY2xpY2spID09PT09XG5cbmNsYXNzIFN5bmNNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgcGx1Z2luOiBMcXNzYmxvZ1BsdWdpbjtcblxuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgcGx1Z2luOiBMcXNzYmxvZ1BsdWdpbikge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gIH1cblxuICBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmFkZENsYXNzKFwibHFzcy1tb2RhbFwiKTtcbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJoM1wiLCB7IHRleHQ6IFwibHFzc2Jsb2cgU3luY1wiIH0pO1xuXG4gICAgY29uc3QgZ3JpZCA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwibHFzcy1ncmlkXCIgfSk7XG5cbiAgICB0aGlzLmJ0bihncmlkLCBcIlx1MjE5MVwiLCBcIlx1NjNBOFx1OTAwMVx1NUY1M1x1NTI0RFx1N0IxNFx1OEJCMFwiLCBcInVwbG9hZC1jbG91ZFwiLCAoKSA9PiB7XG4gICAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKTtcbiAgICAgIGlmIChmaWxlKSB0aGlzLnBsdWdpbi5wdXNoTm90ZShmaWxlKTtcbiAgICAgIGVsc2UgbmV3IE5vdGljZShcImxxc3NibG9nOiBcdTZDQTFcdTY3MDlcdTYyNTNcdTVGMDBcdTc2ODRcdTdCMTRcdThCQjBcIik7XG4gICAgfSk7XG5cbiAgICB0aGlzLmJ0bihncmlkLCBcIlx1MjE5M1wiLCBcIlx1NjJDOVx1NTNENlx1NTE2OFx1OTBFOFx1NjU4N1x1N0FFMFwiLCBcImRvd25sb2FkLWNsb3VkXCIsICgpID0+IHtcbiAgICAgIHRoaXMucGx1Z2luLnB1bGxBbGxQb3N0cygpO1xuICAgIH0pO1xuXG4gICAgdGhpcy5idG4oZ3JpZCwgXCJcdTIxQzVcIiwgXCJcdTUxNjhcdTkxQ0ZcdTUzQ0NcdTU0MTFcdTU0MENcdTZCNjVcIiwgXCJyZWZyZXNoLWN3XCIsICgpID0+IHtcbiAgICAgIHRoaXMucGx1Z2luLnN5bmNBbGwoKTtcbiAgICB9KTtcbiAgfVxuXG4gIGJ0bihcbiAgICBwYXJlbnQ6IEhUTUxFbGVtZW50LFxuICAgIGljb246IHN0cmluZyxcbiAgICBsYWJlbDogc3RyaW5nLFxuICAgIF9sdWNpZGU6IHN0cmluZyxcbiAgICBvbkNsaWNrOiAoKSA9PiB2b2lkXG4gICkge1xuICAgIGNvbnN0IGJ0biA9IHBhcmVudC5jcmVhdGVFbChcImJ1dHRvblwiLCB7IGNsczogXCJscXNzLWFjdGlvbi1idG5cIiB9KTtcbiAgICBidG4uY3JlYXRlRWwoXCJzcGFuXCIsIHsgY2xzOiBcImxxc3MtYnRuLWljb25cIiwgdGV4dDogaWNvbiB9KTtcbiAgICBidG4uY3JlYXRlRWwoXCJzcGFuXCIsIHsgY2xzOiBcImxxc3MtYnRuLWxhYmVsXCIsIHRleHQ6IGxhYmVsIH0pO1xuICAgIGJ0bi5vbmNsaWNrID0gKCkgPT4ge1xuICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgb25DbGljaygpO1xuICAgIH07XG4gIH1cblxuICBvbkNsb3NlKCkge1xuICAgIHRoaXMuY29udGVudEVsLmVtcHR5KCk7XG4gIH1cbn1cblxuLy8gPT09PT0gUHVibGlzaCBNb2RhbCAoZmlyc3QtdGltZSBwdXNoLCBubyB6b25lIHNldCkgPT09PT1cblxuY2xhc3MgUHVibGlzaE1vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBwbHVnaW46IExxc3NibG9nUGx1Z2luO1xuICBmaWxlOiBURmlsZTtcblxuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgcGx1Z2luOiBMcXNzYmxvZ1BsdWdpbiwgZmlsZTogVEZpbGUpIHtcbiAgICBzdXBlcihhcHApO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICAgIHRoaXMuZmlsZSA9IGZpbGU7XG4gIH1cblxuICBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29uc3QgZm0gPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZSh0aGlzLmZpbGUpPy5mcm9udG1hdHRlciA/PyB7fTtcblxuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcImgzXCIsIHsgdGV4dDogXCJcdTUzRDFcdTVFMDNcdTUyMzAgbHFzc2Jsb2dcIiB9KTtcblxuICAgIGxldCB0aXRsZSA9IChmbVtcInRpdGxlXCJdIGFzIHN0cmluZykgfHwgdGhpcy5maWxlLmJhc2VuYW1lO1xuICAgIGxldCB6b25lOiBab25lID0gXCJBTklNRVwiO1xuICAgIGxldCB2aXNpYmlsaXR5OiBWaXNpYmlsaXR5ID0gXCJMT0dJTl9PTkxZXCI7XG4gICAgbGV0IHB1Ymxpc2hlZCA9IGZhbHNlO1xuICAgIGxldCB0YWdzID0gcGFyc2VUYWdzKGZtW1wiYmxvZy10YWdzXCJdKS5qb2luKFwiLCBcIik7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuc2V0TmFtZShcIlx1NjgwN1x1OTg5OFwiKVxuICAgICAgLmFkZFRleHQoKHQpID0+XG4gICAgICAgIHQuc2V0VmFsdWUodGl0bGUpLm9uQ2hhbmdlKCh2KSA9PiAodGl0bGUgPSB2KSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuc2V0TmFtZShcIlx1NTIwNlx1NTMzQVwiKVxuICAgICAgLmFkZERyb3Bkb3duKChkKSA9PiB7XG4gICAgICAgIGQuYWRkT3B0aW9uKFwiQU5JTUVcIiwgXCJcdTRFOENcdTZCMjFcdTUxNDNcdUZGMDhBTklNRVx1RkYwOVwiKTtcbiAgICAgICAgZC5hZGRPcHRpb24oXCJSRUFMXCIsIFwiXHU0RTA5XHU2QjIxXHU1MTQzXHVGRjA4UkVBTFx1RkYwOVwiKTtcbiAgICAgICAgZC5hZGRPcHRpb24oXCJGT1VSXCIsIFwiNFx1OTg5MVx1OTA1M1x1RkYwOEZPVVJcdUZGMDlcIik7XG4gICAgICAgIGQuc2V0VmFsdWUoem9uZSkub25DaGFuZ2UoKHYpID0+ICh6b25lID0gdiBhcyBab25lKSk7XG4gICAgICB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5zZXROYW1lKFwiXHU1M0VGXHU4OUMxXHU2MDI3XCIpXG4gICAgICAuYWRkRHJvcGRvd24oKGQpID0+IHtcbiAgICAgICAgZC5hZGRPcHRpb24oXCJMT0dJTl9PTkxZXCIsIFwiXHU0RUM1XHU3NjdCXHU1RjU1XHU3NTI4XHU2MjM3XCIpO1xuICAgICAgICBkLmFkZE9wdGlvbihcIlBVQkxJQ1wiLCBcIlx1NTE2Q1x1NUYwMFwiKTtcbiAgICAgICAgZC5hZGRPcHRpb24oXCJGUklFTkRTX09OTFlcIiwgXCJcdTRFQzVcdTU5N0RcdTUzQ0JcIik7XG4gICAgICAgIGQuc2V0VmFsdWUodmlzaWJpbGl0eSkub25DaGFuZ2UoKHYpID0+ICh2aXNpYmlsaXR5ID0gdiBhcyBWaXNpYmlsaXR5KSk7XG4gICAgICB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5zZXROYW1lKFwiXHU2ODA3XHU3QjdFXCIpXG4gICAgICAuc2V0RGVzYyhcIlx1NTkxQVx1NEUyQVx1NjgwN1x1N0I3RVx1NzUyOFx1OTAxN1x1NTNGN1x1NTIwNlx1OTY5NFwiKVxuICAgICAgLmFkZFRleHQoKHQpID0+XG4gICAgICAgIHRcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoXCJ0YWcxLCB0YWcyXCIpXG4gICAgICAgICAgLnNldFZhbHVlKHRhZ3MpXG4gICAgICAgICAgLm9uQ2hhbmdlKCh2KSA9PiAodGFncyA9IHYpKVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5zZXROYW1lKFwiXHU3QUNCXHU1MzczXHU1M0QxXHU1RTAzXCIpXG4gICAgICAuc2V0RGVzYyhcIlx1NTE3M1x1OTVFRFx1NTIxOVx1NEZERFx1NUI1OFx1NEUzQVx1ODM0OVx1N0EzRlwiKVxuICAgICAgLmFkZFRvZ2dsZSgodCkgPT5cbiAgICAgICAgdC5zZXRWYWx1ZShwdWJsaXNoZWQpLm9uQ2hhbmdlKCh2KSA9PiAocHVibGlzaGVkID0gdikpXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKS5hZGRCdXR0b24oKGJ0bikgPT5cbiAgICAgIGJ0blxuICAgICAgICAuc2V0QnV0dG9uVGV4dChcIlx1NTNEMVx1NUUwM1wiKVxuICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgICAgICBjb25zdCB0YWdMaXN0ID0gdGFnc1xuICAgICAgICAgICAgLnNwbGl0KFwiLFwiKVxuICAgICAgICAgICAgLm1hcCgodCkgPT4gdC50cmltKCkpXG4gICAgICAgICAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICAgICAgICAgIC8vIFdyaXRlIG1ldGEgdG8gZnJvbnRtYXR0ZXIgZmlyc3Qgc28gZG9QdXNoIGNhbiByZWFkIGl0XG4gICAgICAgICAgYXdhaXQgdGhpcy5hcHAuZmlsZU1hbmFnZXIucHJvY2Vzc0Zyb250TWF0dGVyKHRoaXMuZmlsZSwgKGYpID0+IHtcbiAgICAgICAgICAgIGZbXCJ0aXRsZVwiXSA9IHRpdGxlO1xuICAgICAgICAgICAgZltcImJsb2ctem9uZVwiXSA9IHpvbmU7XG4gICAgICAgICAgICBmW1wiYmxvZy12aXNpYmlsaXR5XCJdID0gdmlzaWJpbGl0eTtcbiAgICAgICAgICAgIGZbXCJibG9nLXB1Ymxpc2hlZFwiXSA9IHB1Ymxpc2hlZDtcbiAgICAgICAgICAgIGZbXCJibG9nLXRhZ3NcIl0gPSB0YWdMaXN0O1xuICAgICAgICAgIH0pO1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLmRvUHVzaChcbiAgICAgICAgICAgIHRoaXMuZmlsZSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgdGl0bGUsXG4gICAgICAgICAgICAgIFwiYmxvZy16b25lXCI6IHpvbmUsXG4gICAgICAgICAgICAgIFwiYmxvZy12aXNpYmlsaXR5XCI6IHZpc2liaWxpdHksXG4gICAgICAgICAgICAgIFwiYmxvZy1wdWJsaXNoZWRcIjogcHVibGlzaGVkLFxuICAgICAgICAgICAgICBcImJsb2ctdGFnc1wiOiB0YWdMaXN0LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHVuZGVmaW5lZCxcbiAgICAgICAgICAgIHpvbmVcbiAgICAgICAgICApO1xuICAgICAgICB9KVxuICAgICk7XG4gIH1cblxuICBvbkNsb3NlKCkge1xuICAgIHRoaXMuY29udGVudEVsLmVtcHR5KCk7XG4gIH1cbn1cblxuLy8gPT09PT0gU2V0dGluZ3MgVGFiID09PT09XG5cbmNsYXNzIExxc3NibG9nU2V0dGluZ1RhYiBleHRlbmRzIFBsdWdpblNldHRpbmdUYWIge1xuICBwbHVnaW46IExxc3NibG9nUGx1Z2luO1xuXG4gIGNvbnN0cnVjdG9yKGFwcDogQXBwLCBwbHVnaW46IExxc3NibG9nUGx1Z2luKSB7XG4gICAgc3VwZXIoYXBwLCBwbHVnaW4pO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICB9XG5cbiAgZGlzcGxheSgpIHtcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xuICAgIGNvbnRhaW5lckVsLmVtcHR5KCk7XG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IFwibHFzc2Jsb2cgU3luY1wiIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlx1NTM1QVx1NUJBMlx1NTczMFx1NTc0MFwiKVxuICAgICAgLnNldERlc2MoXCJcdTRFMERcdTU0MkJcdTY3MkJcdTVDM0VcdTY1OUNcdTdFQkZcdUZGMENcdTRGOEJcdTU5ODIgaHR0cHM6Ly9scXNzYmxvZy5zZXJ2ZWJsb2cubmV0XCIpXG4gICAgICAuYWRkVGV4dCgodCkgPT5cbiAgICAgICAgdFxuICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcihcImh0dHBzOi8vbHFzc2Jsb2cuc2VydmVibG9nLm5ldFwiKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5ibG9nVXJsKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodikgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuYmxvZ1VybCA9IHYucmVwbGFjZSgvXFwvJC8sIFwiXCIpO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiXHU3NTI4XHU2MjM3XHU1NDBEXCIpXG4gICAgICAuYWRkVGV4dCgodCkgPT5cbiAgICAgICAgdFxuICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcihcInlvdXItdXNlcm5hbWVcIilcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MudXNlcm5hbWUpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2KSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy51c2VybmFtZSA9IHYudHJpbSgpO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiXHU1QkM2XHU3ODAxXCIpXG4gICAgICAuYWRkVGV4dCgodCkgPT4ge1xuICAgICAgICB0LmlucHV0RWwudHlwZSA9IFwicGFzc3dvcmRcIjtcbiAgICAgICAgdC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5wYXNzd29yZCkub25DaGFuZ2UoYXN5bmMgKHYpID0+IHtcbiAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5wYXNzd29yZCA9IHY7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiXHU1NDBDXHU2QjY1XHU2NTg3XHU0RUY2XHU1OTM5XCIpXG4gICAgICAuc2V0RGVzYyhcIlx1NjJDOVx1NTNENlx1NzY4NFx1NjU4N1x1N0FFMFx1NEZERFx1NUI1OFx1NTIzMFx1NkI2NFx1NjU4N1x1NEVGNlx1NTkzOVx1RkYwOFx1NzZGOFx1NUJGOSB2YXVsdCBcdTY4MzlcdTc2RUVcdTVGNTVcdUZGMDlcIilcbiAgICAgIC5hZGRUZXh0KCh0KSA9PlxuICAgICAgICB0XG4gICAgICAgICAgLnNldFBsYWNlaG9sZGVyKFwiYmxvZ1wiKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5zeW5jRm9sZGVyKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodikgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Muc3luY0ZvbGRlciA9IHYudHJpbSgpLnJlcGxhY2UoL1xcLyQvLCBcIlwiKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlx1NkQ0Qlx1OEJENVx1OEZERVx1NjNBNVwiKVxuICAgICAgLnNldERlc2MoXCJcdTlBOENcdThCQzFcdTc1MjhcdTYyMzdcdTU0MERcdTU0OENcdTVCQzZcdTc4MDFcdTY2MkZcdTU0MjZcdTZCNjNcdTc4NkVcIilcbiAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT5cbiAgICAgICAgYnRuLnNldEJ1dHRvblRleHQoXCJcdTZENEJcdThCRDVcIikub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgYnRuLnNldEJ1dHRvblRleHQoXCJcdThGREVcdTYzQTVcdTRFMkRcdTIwMjZcIikuc2V0RGlzYWJsZWQodHJ1ZSk7XG4gICAgICAgICAgY29uc3Qgb2sgPSBhd2FpdCB0aGlzLnBsdWdpbi5sb2dpbigpO1xuICAgICAgICAgIGJ0bi5zZXREaXNhYmxlZChmYWxzZSk7XG4gICAgICAgICAgaWYgKG9rKSB7XG4gICAgICAgICAgICBidG4uc2V0QnV0dG9uVGV4dChcIlx1MjcxMyBcdTYyMTBcdTUyOUZcIik7XG4gICAgICAgICAgICBuZXcgTm90aWNlKFwibHFzc2Jsb2c6IFx1NzY3Qlx1NUY1NVx1NjIxMFx1NTI5RlwiKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgYnRuLnNldEJ1dHRvblRleHQoXCJcdTI3MTcgXHU1OTMxXHU4RDI1XCIpO1xuICAgICAgICAgICAgbmV3IE5vdGljZShcImxxc3NibG9nOiBcdTc2N0JcdTVGNTVcdTU5MzFcdThEMjVcdUZGMENcdThCRjdcdTY4QzBcdTY3RTVcdTc1MjhcdTYyMzdcdTU0MEQvXHU1QkM2XHU3ODAxL1x1NTM1QVx1NUJBMlx1NTczMFx1NTc0MFwiKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgc2V0VGltZW91dCgoKSA9PiBidG4uc2V0QnV0dG9uVGV4dChcIlx1NkQ0Qlx1OEJENVwiKSwgMzAwMCk7XG4gICAgICAgIH0pXG4gICAgICApO1xuICB9XG59XG5cbi8vID09PT09IFV0aWxpdHkgPT09PT1cblxuZnVuY3Rpb24gc3RyaXBGcm9udG1hdHRlcihjb250ZW50OiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoIWNvbnRlbnQuc3RhcnRzV2l0aChcIi0tLVwiKSkgcmV0dXJuIGNvbnRlbnQ7XG4gIGNvbnN0IGVuZCA9IGNvbnRlbnQuaW5kZXhPZihcIlxcbi0tLVwiLCAzKTtcbiAgaWYgKGVuZCA9PT0gLTEpIHJldHVybiBjb250ZW50O1xuICByZXR1cm4gY29udGVudC5zbGljZShlbmQgKyA0KS50cmltU3RhcnQoKTtcbn1cblxuZnVuY3Rpb24gcGFyc2VUYWdzKHJhdzogdW5rbm93bik6IHN0cmluZ1tdIHtcbiAgaWYgKCFyYXcpIHJldHVybiBbXTtcbiAgaWYgKEFycmF5LmlzQXJyYXkocmF3KSkgcmV0dXJuIChyYXcgYXMgdW5rbm93bltdKS5tYXAoU3RyaW5nKS5maWx0ZXIoQm9vbGVhbik7XG4gIGlmICh0eXBlb2YgcmF3ID09PSBcInN0cmluZ1wiKVxuICAgIHJldHVybiByYXdcbiAgICAgIC5zcGxpdChcIixcIilcbiAgICAgIC5tYXAoKHQpID0+IHQudHJpbSgpKVxuICAgICAgLmZpbHRlcihCb29sZWFuKTtcbiAgcmV0dXJuIFtdO1xufVxuXG5mdW5jdGlvbiBzYWZlRmlsZW5hbWUobmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5hbWUucmVwbGFjZSgvW1xcXFwvOio/XCI8PnxdL2csIFwiLVwiKS50cmltKCkuc2xpY2UoMCwgMTAwKTtcbn1cblxuZnVuY3Rpb24gYnVpbGROb3RlQ29udGVudChwb3N0OiBCbG9nUG9zdCk6IHN0cmluZyB7XG4gIGNvbnN0IHRhZ3MgPSBwb3N0LnRhZ3MubWFwKCh0KSA9PiB0LnRhZy5uYW1lKTtcbiAgY29uc3QgbGluZXMgPSBbXG4gICAgXCItLS1cIixcbiAgICBgdGl0bGU6IFwiJHtwb3N0LnRpdGxlLnJlcGxhY2UoL1wiL2csICdcXFxcXCInKX1cImAsXG4gICAgYGJsb2ctaWQ6IFwiJHtwb3N0LmlkfVwiYCxcbiAgICBgYmxvZy16b25lOiAke3Bvc3Quem9uZX1gLFxuICAgIGBibG9nLXZpc2liaWxpdHk6ICR7cG9zdC52aXNpYmlsaXR5fWAsXG4gICAgYGJsb2ctcHVibGlzaGVkOiAke3Bvc3QucHVibGlzaGVkfWAsXG4gIF07XG4gIGlmICh0YWdzLmxlbmd0aCkge1xuICAgIGxpbmVzLnB1c2goYGJsb2ctdGFnczogWyR7dGFncy5tYXAoKHQpID0+IGBcIiR7dH1cImApLmpvaW4oXCIsIFwiKX1dYCk7XG4gIH1cbiAgbGluZXMucHVzaChcbiAgICBgYmxvZy1zeW5jZWQtYXQ6IFwiJHtuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCl9XCJgLFxuICAgIGBibG9nLXVwZGF0ZWQtYXQ6IFwiJHtwb3N0LnVwZGF0ZWRBdH1cImAsXG4gICAgXCItLS1cIixcbiAgICBcIlwiLFxuICAgIHBvc3QuY29udGVudFxuICApO1xuICByZXR1cm4gbGluZXMuam9pbihcIlxcblwiKTtcbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLHNCQVdPO0FBMkJQLElBQU0sbUJBQXFDO0FBQUEsRUFDekMsU0FBUztBQUFBLEVB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
