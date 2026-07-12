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
      const setCookie = resp.headers["set-cookie"];
      if (!setCookie) return false;
      const match = setCookie.match(/token=([^;]+)/);
      if (!match) return false;
      this.settings.token = match[1];
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7XG4gIEFwcCxcbiAgTW9kYWwsXG4gIE5vdGljZSxcbiAgUGx1Z2luLFxuICBQbHVnaW5TZXR0aW5nVGFiLFxuICBTZXR0aW5nLFxuICBURmlsZSxcbiAgcmVxdWVzdFVybCxcbiAgUmVxdWVzdFVybFBhcmFtLFxuICBSZXF1ZXN0VXJsUmVzcG9uc2UsXG59IGZyb20gXCJvYnNpZGlhblwiO1xuXG4vLyA9PT09PSBUeXBlcyA9PT09PVxuXG50eXBlIFpvbmUgPSBcIkFOSU1FXCIgfCBcIlJFQUxcIiB8IFwiRk9VUlwiO1xudHlwZSBWaXNpYmlsaXR5ID0gXCJQVUJMSUNcIiB8IFwiTE9HSU5fT05MWVwiIHwgXCJGUklFTkRTX09OTFlcIjtcblxuaW50ZXJmYWNlIEJsb2dQb3N0IHtcbiAgaWQ6IHN0cmluZztcbiAgdGl0bGU6IHN0cmluZztcbiAgY29udGVudDogc3RyaW5nO1xuICB6b25lOiBab25lO1xuICB2aXNpYmlsaXR5OiBWaXNpYmlsaXR5O1xuICBwdWJsaXNoZWQ6IGJvb2xlYW47XG4gIGNyZWF0ZWRBdDogc3RyaW5nO1xuICB1cGRhdGVkQXQ6IHN0cmluZztcbiAgdGFnczogeyB0YWc6IHsgbmFtZTogc3RyaW5nIH0gfVtdO1xufVxuXG5pbnRlcmZhY2UgTHFzc2Jsb2dTZXR0aW5ncyB7XG4gIGJsb2dVcmw6IHN0cmluZztcbiAgdXNlcm5hbWU6IHN0cmluZztcbiAgcGFzc3dvcmQ6IHN0cmluZztcbiAgc3luY0ZvbGRlcjogc3RyaW5nO1xuICB0b2tlbjogc3RyaW5nO1xufVxuXG5jb25zdCBERUZBVUxUX1NFVFRJTkdTOiBMcXNzYmxvZ1NldHRpbmdzID0ge1xuICBibG9nVXJsOiBcImh0dHBzOi8vbHFzc2Jsb2cuc2VydmVibG9nLm5ldFwiLFxuICB1c2VybmFtZTogXCJcIixcbiAgcGFzc3dvcmQ6IFwiXCIsXG4gIHN5bmNGb2xkZXI6IFwiYmxvZ1wiLFxuICB0b2tlbjogXCJcIixcbn07XG5cbi8vID09PT09IFBsdWdpbiA9PT09PVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBMcXNzYmxvZ1BsdWdpbiBleHRlbmRzIFBsdWdpbiB7XG4gIHNldHRpbmdzOiBMcXNzYmxvZ1NldHRpbmdzO1xuXG4gIGFzeW5jIG9ubG9hZCgpIHtcbiAgICBhd2FpdCB0aGlzLmxvYWRTZXR0aW5ncygpO1xuXG4gICAgLy8gUmliYm9uIGljb25cbiAgICB0aGlzLmFkZFJpYmJvbkljb24oXCJjbG91ZFwiLCBcImxxc3NibG9nIFN5bmNcIiwgKCkgPT4ge1xuICAgICAgbmV3IFN5bmNNb2RhbCh0aGlzLmFwcCwgdGhpcykub3BlbigpO1xuICAgIH0pO1xuXG4gICAgLy8gQ29tbWFuZHNcbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwicHVzaC1jdXJyZW50LW5vdGVcIixcbiAgICAgIG5hbWU6IFwiXHU2M0E4XHU5MDAxXHU1RjUzXHU1MjREXHU3QjE0XHU4QkIwXHU1MjMwXHU1MzVBXHU1QkEyXCIsXG4gICAgICBjYWxsYmFjazogKCkgPT4ge1xuICAgICAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKTtcbiAgICAgICAgaWYgKGZpbGUpIHRoaXMucHVzaE5vdGUoZmlsZSk7XG4gICAgICAgIGVsc2UgbmV3IE5vdGljZShcImxxc3NibG9nOiBcdTZDQTFcdTY3MDlcdTYyNTNcdTVGMDBcdTc2ODRcdTdCMTRcdThCQjBcIik7XG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcInB1bGwtYWxsLXBvc3RzXCIsXG4gICAgICBuYW1lOiBcIlx1NEVDRVx1NTM1QVx1NUJBMlx1NjJDOVx1NTNENlx1NTE2OFx1OTBFOFx1NjU4N1x1N0FFMFwiLFxuICAgICAgY2FsbGJhY2s6ICgpID0+IHRoaXMucHVsbEFsbFBvc3RzKCksXG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwic3luYy1hbGxcIixcbiAgICAgIG5hbWU6IFwiXHU0RTBFXHU1MzVBXHU1QkEyXHU1MTY4XHU5MUNGXHU1M0NDXHU1NDExXHU1NDBDXHU2QjY1XCIsXG4gICAgICBjYWxsYmFjazogKCkgPT4gdGhpcy5zeW5jQWxsKCksXG4gICAgfSk7XG5cbiAgICAvLyBSaWdodC1jbGljayBjb250ZXh0IG1lbnVcbiAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXG4gICAgICB0aGlzLmFwcC53b3Jrc3BhY2Uub24oXCJmaWxlLW1lbnVcIiwgKG1lbnUsIGZpbGUpID0+IHtcbiAgICAgICAgaWYgKGZpbGUgaW5zdGFuY2VvZiBURmlsZSAmJiBmaWxlLmV4dGVuc2lvbiA9PT0gXCJtZFwiKSB7XG4gICAgICAgICAgbWVudS5hZGRJdGVtKChpdGVtKSA9PiB7XG4gICAgICAgICAgICBpdGVtXG4gICAgICAgICAgICAgIC5zZXRUaXRsZShcIlx1NjNBOFx1OTAwMVx1NTIzMCBscXNzYmxvZ1wiKVxuICAgICAgICAgICAgICAuc2V0SWNvbihcInVwbG9hZC1jbG91ZFwiKVxuICAgICAgICAgICAgICAub25DbGljaygoKSA9PiB0aGlzLnB1c2hOb3RlKGZpbGUpKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICApO1xuXG4gICAgdGhpcy5hZGRTZXR0aW5nVGFiKG5ldyBMcXNzYmxvZ1NldHRpbmdUYWIodGhpcy5hcHAsIHRoaXMpKTtcbiAgfVxuXG4gIG9udW5sb2FkKCkge31cblxuICAvLyA9PT09PSBBdXRoID09PT09XG5cbiAgYXN5bmMgbG9naW4oKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgaWYgKCF0aGlzLnNldHRpbmdzLnVzZXJuYW1lIHx8ICF0aGlzLnNldHRpbmdzLnBhc3N3b3JkKSByZXR1cm4gZmFsc2U7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3AgPSBhd2FpdCByZXF1ZXN0VXJsKHtcbiAgICAgICAgdXJsOiBgJHt0aGlzLnNldHRpbmdzLmJsb2dVcmx9L2FwaS9hdXRoL2xvZ2luYCxcbiAgICAgICAgbWV0aG9kOiBcIlBPU1RcIixcbiAgICAgICAgaGVhZGVyczogeyBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIiB9LFxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgdXNlcm5hbWU6IHRoaXMuc2V0dGluZ3MudXNlcm5hbWUsXG4gICAgICAgICAgcGFzc3dvcmQ6IHRoaXMuc2V0dGluZ3MucGFzc3dvcmQsXG4gICAgICAgIH0pLFxuICAgICAgICB0aHJvdzogZmFsc2UsXG4gICAgICB9KTtcbiAgICAgIGlmIChyZXNwLnN0YXR1cyAhPT0gMjAwKSByZXR1cm4gZmFsc2U7XG5cbiAgICAgIC8vIEV4dHJhY3QgdG9rZW4gdmFsdWUgZnJvbSBzZXQtY29va2llOiBcInRva2VuPWV5Si4uLjsgUGF0aD0vOyAuLi5cIlxuICAgICAgY29uc3Qgc2V0Q29va2llID0gcmVzcC5oZWFkZXJzW1wic2V0LWNvb2tpZVwiXSBhcyBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gICAgICBpZiAoIXNldENvb2tpZSkgcmV0dXJuIGZhbHNlO1xuICAgICAgY29uc3QgbWF0Y2ggPSBzZXRDb29raWUubWF0Y2goL3Rva2VuPShbXjtdKykvKTtcbiAgICAgIGlmICghbWF0Y2gpIHJldHVybiBmYWxzZTtcblxuICAgICAgdGhpcy5zZXR0aW5ncy50b2tlbiA9IG1hdGNoWzFdO1xuICAgICAgYXdhaXQgdGhpcy5zYXZlU2V0dGluZ3MoKTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIGdldEhlYWRlcnMoKTogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB7XG4gICAgcmV0dXJuIHtcbiAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgQ29va2llOiBgdG9rZW49JHt0aGlzLnNldHRpbmdzLnRva2VufWAsXG4gICAgfTtcbiAgfVxuXG4gIC8vIEF1dG8tcmV0cnkgd2l0aCByZS1sb2dpbiBvbiA0MDFcbiAgYXN5bmMgYXBpUmVxKFxuICAgIG9wdGlvbnM6IFJlcXVlc3RVcmxQYXJhbSxcbiAgICByZXRyaWVkID0gZmFsc2VcbiAgKTogUHJvbWlzZTxSZXF1ZXN0VXJsUmVzcG9uc2U+IHtcbiAgICBjb25zdCByZXNwID0gYXdhaXQgcmVxdWVzdFVybCh7XG4gICAgICAuLi5vcHRpb25zLFxuICAgICAgaGVhZGVyczogeyAuLi50aGlzLmdldEhlYWRlcnMoKSwgLi4uKG9wdGlvbnMuaGVhZGVycyA/PyB7fSkgfSxcbiAgICAgIHRocm93OiBmYWxzZSxcbiAgICB9KTtcbiAgICBpZiAocmVzcC5zdGF0dXMgPT09IDQwMSAmJiAhcmV0cmllZCkge1xuICAgICAgY29uc3Qgb2sgPSBhd2FpdCB0aGlzLmxvZ2luKCk7XG4gICAgICBpZiAob2spIHJldHVybiB0aGlzLmFwaVJlcShvcHRpb25zLCB0cnVlKTtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3A7XG4gIH1cblxuICAvLyA9PT09PSBBUEkgPT09PT1cblxuICBhc3luYyBmZXRjaE15UG9zdHMoKTogUHJvbWlzZTxCbG9nUG9zdFtdPiB7XG4gICAgY29uc3QgcmVzcCA9IGF3YWl0IHRoaXMuYXBpUmVxKHtcbiAgICAgIHVybDogYCR7dGhpcy5zZXR0aW5ncy5ibG9nVXJsfS9hcGkvdXNlci9wb3N0c2AsXG4gICAgfSk7XG4gICAgaWYgKHJlc3Auc3RhdHVzICE9PSAyMDApIHJldHVybiBbXTtcbiAgICByZXR1cm4gKHJlc3AuanNvbiBhcyB7IHBvc3RzOiBCbG9nUG9zdFtdIH0pLnBvc3RzID8/IFtdO1xuICB9XG5cbiAgYXN5bmMgY3JlYXRlUG9zdChkYXRhOiB7XG4gICAgdGl0bGU6IHN0cmluZztcbiAgICBjb250ZW50OiBzdHJpbmc7XG4gICAgem9uZTogWm9uZTtcbiAgICB2aXNpYmlsaXR5OiBWaXNpYmlsaXR5O1xuICAgIHB1Ymxpc2hlZDogYm9vbGVhbjtcbiAgICB0YWdzOiBzdHJpbmdbXTtcbiAgfSk6IFByb21pc2U8QmxvZ1Bvc3QgfCBudWxsPiB7XG4gICAgY29uc3QgcmVzcCA9IGF3YWl0IHRoaXMuYXBpUmVxKHtcbiAgICAgIHVybDogYCR7dGhpcy5zZXR0aW5ncy5ibG9nVXJsfS9hcGkvcG9zdHNgLFxuICAgICAgbWV0aG9kOiBcIlBPU1RcIixcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KGRhdGEpLFxuICAgIH0pO1xuICAgIGlmIChyZXNwLnN0YXR1cyAhPT0gMjAxKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4gKHJlc3AuanNvbiBhcyB7IHBvc3Q6IEJsb2dQb3N0IH0pLnBvc3QgPz8gbnVsbDtcbiAgfVxuXG4gIGFzeW5jIHVwZGF0ZVBvc3QoXG4gICAgaWQ6IHN0cmluZyxcbiAgICBkYXRhOiB7XG4gICAgICB0aXRsZTogc3RyaW5nO1xuICAgICAgY29udGVudDogc3RyaW5nO1xuICAgICAgem9uZTogWm9uZTtcbiAgICAgIHZpc2liaWxpdHk6IFZpc2liaWxpdHk7XG4gICAgICBwdWJsaXNoZWQ6IGJvb2xlYW47XG4gICAgICB0YWdzOiBzdHJpbmdbXTtcbiAgICB9XG4gICk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGNvbnN0IHJlc3AgPSBhd2FpdCB0aGlzLmFwaVJlcSh7XG4gICAgICB1cmw6IGAke3RoaXMuc2V0dGluZ3MuYmxvZ1VybH0vYXBpL3Bvc3RzLyR7aWR9YCxcbiAgICAgIG1ldGhvZDogXCJQVVRcIixcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KGRhdGEpLFxuICAgIH0pO1xuICAgIHJldHVybiByZXNwLnN0YXR1cyA9PT0gMjAwO1xuICB9XG5cbiAgLy8gPT09PT0gQ29yZSBTeW5jID09PT09XG5cbiAgLyoqIFB1c2ggYSBzaW5nbGUgbm90ZSB0byB0aGUgYmxvZy4gU2hvd3MgUHVibGlzaE1vZGFsIGlmIHpvbmUgbm90IHNldC4gKi9cbiAgYXN5bmMgcHVzaE5vdGUoZmlsZTogVEZpbGUpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMuc2V0dGluZ3MudXNlcm5hbWUgfHwgIXRoaXMuc2V0dGluZ3MucGFzc3dvcmQpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJscXNzYmxvZzogXHU4QkY3XHU1MTQ4XHU1NzI4XHU2M0QyXHU0RUY2XHU4QkJFXHU3RjZFXHU5MUNDXHU1ODZCXHU1MTk5XHU3NTI4XHU2MjM3XHU1NDBEXHU1NDhDXHU1QkM2XHU3ODAxXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGZtID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUoZmlsZSk/LmZyb250bWF0dGVyID8/IHt9O1xuICAgIGNvbnN0IHpvbmUgPSBmbVtcImJsb2ctem9uZVwiXSBhcyBab25lIHwgdW5kZWZpbmVkO1xuXG4gICAgaWYgKCF6b25lKSB7XG4gICAgICBuZXcgUHVibGlzaE1vZGFsKHRoaXMuYXBwLCB0aGlzLCBmaWxlKS5vcGVuKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5kb1B1c2goZmlsZSwgZm0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIGZtW1wiYmxvZy1pZFwiXSBhcyBzdHJpbmcgfCB1bmRlZmluZWQsIHpvbmUpO1xuICB9XG5cbiAgLyoqIEFjdHVhbGx5IHB1c2ggdGhlIG5vdGUgKGNhbGxlZCBhZnRlciB6b25lIGlzIGNvbmZpcm1lZCkuICovXG4gIGFzeW5jIGRvUHVzaChcbiAgICBmaWxlOiBURmlsZSxcbiAgICBmbTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4gICAgYmxvZ0lkOiBzdHJpbmcgfCB1bmRlZmluZWQsXG4gICAgem9uZTogWm9uZVxuICApOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBjb25zdCByYXdDb250ZW50ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQucmVhZChmaWxlKTtcbiAgICBjb25zdCBib2R5ID0gc3RyaXBGcm9udG1hdHRlcihyYXdDb250ZW50KTtcblxuICAgIGNvbnN0IHRpdGxlID0gKGZtW1widGl0bGVcIl0gYXMgc3RyaW5nKSB8fCBmaWxlLmJhc2VuYW1lO1xuICAgIGNvbnN0IHZpc2liaWxpdHkgPSAoZm1bXCJibG9nLXZpc2liaWxpdHlcIl0gYXMgVmlzaWJpbGl0eSkgfHwgXCJMT0dJTl9PTkxZXCI7XG4gICAgY29uc3QgcHVibGlzaGVkID0gKGZtW1wiYmxvZy1wdWJsaXNoZWRcIl0gYXMgYm9vbGVhbikgPz8gZmFsc2U7XG4gICAgY29uc3QgdGFncyA9IHBhcnNlVGFncyhmbVtcImJsb2ctdGFnc1wiXSk7XG5cbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgY29uc3QgZGF0YSA9IHsgdGl0bGUsIGNvbnRlbnQ6IGJvZHksIHpvbmUsIHZpc2liaWxpdHksIHB1Ymxpc2hlZCwgdGFncyB9O1xuXG4gICAgaWYgKGJsb2dJZCkge1xuICAgICAgY29uc3Qgb2sgPSBhd2FpdCB0aGlzLnVwZGF0ZVBvc3QoYmxvZ0lkLCBkYXRhKTtcbiAgICAgIGlmICghb2spIHtcbiAgICAgICAgbmV3IE5vdGljZShgbHFzc2Jsb2c6IFx1MjcxNyBcdTY2RjRcdTY1QjBcdTU5MzFcdThEMjUgXHUyMDE0XHUzMDBDJHt0aXRsZX1cdTMwMERgKTtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBwb3N0ID0gYXdhaXQgdGhpcy5jcmVhdGVQb3N0KGRhdGEpO1xuICAgICAgaWYgKCFwb3N0KSB7XG4gICAgICAgIG5ldyBOb3RpY2UoYGxxc3NibG9nOiBcdTI3MTcgXHU1M0QxXHU1RTAzXHU1OTMxXHU4RDI1IFx1MjAxNFx1MzAwQyR7dGl0bGV9XHUzMDBEYCk7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICAgIGJsb2dJZCA9IHBvc3QuaWQ7XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5hcHAuZmlsZU1hbmFnZXIucHJvY2Vzc0Zyb250TWF0dGVyKGZpbGUsIChmKSA9PiB7XG4gICAgICBmW1wiYmxvZy1pZFwiXSA9IGJsb2dJZDtcbiAgICAgIGZbXCJibG9nLXN5bmNlZC1hdFwiXSA9IG5vdztcbiAgICAgIGZbXCJibG9nLXVwZGF0ZWQtYXRcIl0gPSBub3c7XG4gICAgfSk7XG5cbiAgICBuZXcgTm90aWNlKGBscXNzYmxvZzogXHUyNzEzIFx1NURGMlx1NjNBOFx1OTAwMVx1MzAwQyR7dGl0bGV9XHUzMDBEYCk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICAvKiogUHVsbCBhbGwgdXNlcidzIHBvc3RzIGZyb20gdGhlIGJsb2cgaW50byB0aGUgc3luYyBmb2xkZXIuICovXG4gIGFzeW5jIHB1bGxBbGxQb3N0cygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMuc2V0dGluZ3MudXNlcm5hbWUgfHwgIXRoaXMuc2V0dGluZ3MucGFzc3dvcmQpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJscXNzYmxvZzogXHU4QkY3XHU1MTQ4XHU1NzI4XHU2M0QyXHU0RUY2XHU4QkJFXHU3RjZFXHU5MUNDXHU1ODZCXHU1MTk5XHU3NTI4XHU2MjM3XHU1NDBEXHU1NDhDXHU1QkM2XHU3ODAxXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIG5ldyBOb3RpY2UoXCJscXNzYmxvZzogXHU2QjYzXHU1NzI4XHU2MkM5XHU1M0Q2XHUyMDI2XCIpO1xuICAgIGNvbnN0IHBvc3RzID0gYXdhaXQgdGhpcy5mZXRjaE15UG9zdHMoKTtcblxuICAgIGlmICghcG9zdHMubGVuZ3RoKSB7XG4gICAgICBuZXcgTm90aWNlKFwibHFzc2Jsb2c6IFx1NTM1QVx1NUJBMlx1NEUwQVx1OEZEOFx1NkNBMVx1NjcwOVx1NjU4N1x1N0FFMFwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmVuc3VyZVN5bmNGb2xkZXIoKTtcblxuICAgIGxldCBwdWxsZWQgPSAwLCBza2lwcGVkID0gMDtcblxuICAgIGZvciAoY29uc3QgcG9zdCBvZiBwb3N0cykge1xuICAgICAgY29uc3QgZXhpc3RpbmcgPSB0aGlzLmZpbmRGaWxlQnlCbG9nSWQocG9zdC5pZCk7XG4gICAgICBjb25zdCBzeW5jZWRBdCA9IGV4aXN0aW5nXG4gICAgICAgID8gKHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGV4aXN0aW5nKT8uZnJvbnRtYXR0ZXI/LltcbiAgICAgICAgICAgIFwiYmxvZy1zeW5jZWQtYXRcIlxuICAgICAgICAgIF0gYXMgc3RyaW5nIHwgdW5kZWZpbmVkKVxuICAgICAgICA6IHVuZGVmaW5lZDtcblxuICAgICAgY29uc3QgYmxvZ1VwZGF0ZWRBdCA9IG5ldyBEYXRlKHBvc3QudXBkYXRlZEF0KS5nZXRUaW1lKCk7XG4gICAgICBjb25zdCBsYXN0U3luY1RpbWUgPSBzeW5jZWRBdCA/IG5ldyBEYXRlKHN5bmNlZEF0KS5nZXRUaW1lKCkgOiAwO1xuXG4gICAgICBpZiAoZXhpc3RpbmcgJiYgYmxvZ1VwZGF0ZWRBdCA8PSBsYXN0U3luY1RpbWUpIHtcbiAgICAgICAgc2tpcHBlZCsrO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgY29udGVudCA9IGJ1aWxkTm90ZUNvbnRlbnQocG9zdCk7XG4gICAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQubW9kaWZ5KGV4aXN0aW5nLCBjb250ZW50KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IHBhdGggPSBhd2FpdCB0aGlzLnVuaXF1ZVBhdGgoXG4gICAgICAgICAgYCR7dGhpcy5zZXR0aW5ncy5zeW5jRm9sZGVyfS8ke3NhZmVGaWxlbmFtZShwb3N0LnRpdGxlKSB8fCBwb3N0LmlkfS5tZGBcbiAgICAgICAgKTtcbiAgICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuY3JlYXRlKHBhdGgsIGNvbnRlbnQpO1xuICAgICAgfVxuICAgICAgcHVsbGVkKys7XG4gICAgfVxuXG4gICAgbmV3IE5vdGljZShgbHFzc2Jsb2c6IFx1NjJDOVx1NTNENlx1NUI4Q1x1NjIxMCBcdTIwMTRcdTIwMTQgXHU2NkY0XHU2NUIwICR7cHVsbGVkfSBcdTdCQzdcdUZGMENcdThERjNcdThGQzcgJHtza2lwcGVkfSBcdTdCQzdgKTtcbiAgfVxuXG4gIC8qKiBGdWxsIGJpZGlyZWN0aW9uYWwgc3luYy4gKi9cbiAgYXN5bmMgc3luY0FsbCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMuc2V0dGluZ3MudXNlcm5hbWUgfHwgIXRoaXMuc2V0dGluZ3MucGFzc3dvcmQpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJscXNzYmxvZzogXHU4QkY3XHU1MTQ4XHU1NzI4XHU2M0QyXHU0RUY2XHU4QkJFXHU3RjZFXHU5MUNDXHU1ODZCXHU1MTk5XHU3NTI4XHU2MjM3XHU1NDBEXHU1NDhDXHU1QkM2XHU3ODAxXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIG5ldyBOb3RpY2UoXCJscXNzYmxvZzogXHU1RjAwXHU1OUNCXHU1M0NDXHU1NDExXHU1NDBDXHU2QjY1XHUyMDI2XCIpO1xuICAgIGNvbnN0IHBvc3RzID0gYXdhaXQgdGhpcy5mZXRjaE15UG9zdHMoKTtcbiAgICBjb25zdCBibG9nTWFwID0gbmV3IE1hcDxzdHJpbmcsIEJsb2dQb3N0Pihwb3N0cy5tYXAoKHApID0+IFtwLmlkLCBwXSkpO1xuXG4gICAgYXdhaXQgdGhpcy5lbnN1cmVTeW5jRm9sZGVyKCk7XG5cbiAgICBsZXQgcHVzaGVkID0gMCwgcHVsbGVkID0gMCwgY29uZmxpY3RzID0gMCwgY3JlYXRlZCA9IDA7XG4gICAgY29uc3QgcHJvY2Vzc2VkSWRzID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgICAvLyBQcm9jZXNzIGFsbCBsb2NhbCBmaWxlc1xuICAgIGZvciAoY29uc3QgZmlsZSBvZiB0aGlzLmFwcC52YXVsdC5nZXRNYXJrZG93bkZpbGVzKCkpIHtcbiAgICAgIGNvbnN0IGZtID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUoZmlsZSk/LmZyb250bWF0dGVyID8/IHt9O1xuICAgICAgY29uc3QgYmxvZ0lkID0gZm1bXCJibG9nLWlkXCJdIGFzIHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICAgIGNvbnN0IHpvbmUgPSBmbVtcImJsb2ctem9uZVwiXSBhcyBab25lIHwgdW5kZWZpbmVkO1xuXG4gICAgICBpZiAoIWJsb2dJZCkge1xuICAgICAgICAvLyBOZXcgbG9jYWwgZmlsZSBpbiBzeW5jIGZvbGRlciB3aXRoIHpvbmUgc2V0IFx1MjE5MiBwdXNoIHRvIGNyZWF0ZVxuICAgICAgICBpZiAoem9uZSAmJiBmaWxlLnBhdGguc3RhcnRzV2l0aCh0aGlzLnNldHRpbmdzLnN5bmNGb2xkZXIgKyBcIi9cIikpIHtcbiAgICAgICAgICBjb25zdCBvayA9IGF3YWl0IHRoaXMuZG9QdXNoKGZpbGUsIGZtIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+LCB1bmRlZmluZWQsIHpvbmUpO1xuICAgICAgICAgIGlmIChvaykgY3JlYXRlZCsrO1xuICAgICAgICB9XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBwcm9jZXNzZWRJZHMuYWRkKGJsb2dJZCk7XG4gICAgICBjb25zdCBibG9nUG9zdCA9IGJsb2dNYXAuZ2V0KGJsb2dJZCk7XG4gICAgICBpZiAoIWJsb2dQb3N0KSBjb250aW51ZTsgLy8gcG9zdCBkZWxldGVkIG9uIGJsb2cgc2lkZSBcdTIwMTQgc2tpcFxuXG4gICAgICBjb25zdCBzeW5jZWRBdCA9IGZtW1wiYmxvZy1zeW5jZWQtYXRcIl0gYXMgc3RyaW5nIHwgdW5kZWZpbmVkO1xuICAgICAgY29uc3QgbGFzdFN5bmNUaW1lID0gc3luY2VkQXQgPyBuZXcgRGF0ZShzeW5jZWRBdCkuZ2V0VGltZSgpIDogMDtcbiAgICAgIGNvbnN0IGJsb2dVcGRhdGVkQXQgPSBuZXcgRGF0ZShibG9nUG9zdC51cGRhdGVkQXQpLmdldFRpbWUoKTtcbiAgICAgIGNvbnN0IGxvY2FsVXBkYXRlZEF0ID0gZmlsZS5zdGF0Lm10aW1lO1xuICAgICAgY29uc3QgQlVGRkVSID0gNV8wMDA7IC8vIDVzIHRvbGVyYW5jZSBmb3IgY2xvY2sgc2tld1xuXG4gICAgICBjb25zdCBibG9nTmV3ZXIgPSBibG9nVXBkYXRlZEF0ID4gbGFzdFN5bmNUaW1lICsgQlVGRkVSO1xuICAgICAgY29uc3QgbG9jYWxOZXdlciA9IGxvY2FsVXBkYXRlZEF0ID4gbGFzdFN5bmNUaW1lICsgQlVGRkVSO1xuXG4gICAgICBpZiAoYmxvZ05ld2VyICYmIGxvY2FsTmV3ZXIpIHtcbiAgICAgICAgY29uZmxpY3RzKys7XG4gICAgICAgIG5ldyBOb3RpY2UoXG4gICAgICAgICAgYGxxc3NibG9nOiBcdTI2QTAgXHU1MUIyXHU3QTgxIFx1MjAxNFx1MzAwQyR7ZmlsZS5iYXNlbmFtZX1cdTMwMERcdTY3MkNcdTU3MzBcdTU0OENcdThGRENcdTdBRUZcdTkwRkRcdTY3MDlcdTY2RjRcdTY1MzlcdUZGMENcdTVERjJcdThERjNcdThGQzdcdUZGMENcdThCRjdcdTYyNEJcdTUyQThcdTU5MDRcdTc0MDZgXG4gICAgICAgICk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBpZiAobG9jYWxOZXdlcikge1xuICAgICAgICBjb25zdCBvayA9IGF3YWl0IHRoaXMuZG9QdXNoKFxuICAgICAgICAgIGZpbGUsXG4gICAgICAgICAgZm0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4gICAgICAgICAgYmxvZ0lkLFxuICAgICAgICAgIHpvbmUgPz8gKGJsb2dQb3N0LnpvbmUgYXMgWm9uZSlcbiAgICAgICAgKTtcbiAgICAgICAgaWYgKG9rKSBwdXNoZWQrKztcbiAgICAgIH0gZWxzZSBpZiAoYmxvZ05ld2VyKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0Lm1vZGlmeShmaWxlLCBidWlsZE5vdGVDb250ZW50KGJsb2dQb3N0KSk7XG4gICAgICAgIHB1bGxlZCsrO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFB1bGwgcG9zdHMgZnJvbSBibG9nIHRoYXQgZG9uJ3QgZXhpc3QgbG9jYWxseSB5ZXRcbiAgICBmb3IgKGNvbnN0IHBvc3Qgb2YgcG9zdHMpIHtcbiAgICAgIGlmIChwcm9jZXNzZWRJZHMuaGFzKHBvc3QuaWQpKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IHBhdGggPSBhd2FpdCB0aGlzLnVuaXF1ZVBhdGgoXG4gICAgICAgIGAke3RoaXMuc2V0dGluZ3Muc3luY0ZvbGRlcn0vJHtzYWZlRmlsZW5hbWUocG9zdC50aXRsZSkgfHwgcG9zdC5pZH0ubWRgXG4gICAgICApO1xuICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuY3JlYXRlKHBhdGgsIGJ1aWxkTm90ZUNvbnRlbnQocG9zdCkpO1xuICAgICAgcHVsbGVkKys7XG4gICAgfVxuXG4gICAgY29uc3Qgc3VtbWFyeSA9IFtcbiAgICAgIGBcdTIxOTEgXHU2M0E4XHU5MDAxICR7cHVzaGVkICsgY3JlYXRlZH1gLFxuICAgICAgYFx1MjE5MyBcdTYyQzlcdTUzRDYgJHtwdWxsZWR9YCxcbiAgICAgIGNvbmZsaWN0cyA/IGBcdTI2QTAgJHtjb25mbGljdHN9IFx1NEUyQVx1NTFCMlx1N0E4MWAgOiBcIlwiLFxuICAgIF1cbiAgICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICAgIC5qb2luKFwiICAgXCIpO1xuXG4gICAgbmV3IE5vdGljZShgbHFzc2Jsb2c6IFx1NTQwQ1x1NkI2NVx1NUI4Q1x1NjIxMCBcdTIwMTRcdTIwMTQgJHtzdW1tYXJ5fWApO1xuICB9XG5cbiAgLy8gPT09PT0gSGVscGVycyA9PT09PVxuXG4gIGZpbmRGaWxlQnlCbG9nSWQoYmxvZ0lkOiBzdHJpbmcpOiBURmlsZSB8IG51bGwge1xuICAgIGZvciAoY29uc3QgZmlsZSBvZiB0aGlzLmFwcC52YXVsdC5nZXRNYXJrZG93bkZpbGVzKCkpIHtcbiAgICAgIGNvbnN0IGZtID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUoZmlsZSk/LmZyb250bWF0dGVyO1xuICAgICAgaWYgKGZtPy5bXCJibG9nLWlkXCJdID09PSBibG9nSWQpIHJldHVybiBmaWxlO1xuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGFzeW5jIGVuc3VyZVN5bmNGb2xkZXIoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgZm9sZGVyID0gdGhpcy5zZXR0aW5ncy5zeW5jRm9sZGVyO1xuICAgIGlmICghKGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIuZXhpc3RzKGZvbGRlcikpKSB7XG4gICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5jcmVhdGVGb2xkZXIoZm9sZGVyKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyB1bmlxdWVQYXRoKHBhdGg6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgaWYgKCEoYXdhaXQgdGhpcy5hcHAudmF1bHQuYWRhcHRlci5leGlzdHMocGF0aCkpKSByZXR1cm4gcGF0aDtcbiAgICBjb25zdCBiYXNlID0gcGF0aC5yZXBsYWNlKC9cXC5tZCQvLCBcIlwiKTtcbiAgICBsZXQgaSA9IDE7XG4gICAgd2hpbGUgKGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIuZXhpc3RzKGAke2Jhc2V9LSR7aX0ubWRgKSkgaSsrO1xuICAgIHJldHVybiBgJHtiYXNlfS0ke2l9Lm1kYDtcbiAgfVxuXG4gIGFzeW5jIGxvYWRTZXR0aW5ncygpIHtcbiAgICB0aGlzLnNldHRpbmdzID0gT2JqZWN0LmFzc2lnbih7fSwgREVGQVVMVF9TRVRUSU5HUywgYXdhaXQgdGhpcy5sb2FkRGF0YSgpKTtcbiAgfVxuXG4gIGFzeW5jIHNhdmVTZXR0aW5ncygpIHtcbiAgICBhd2FpdCB0aGlzLnNhdmVEYXRhKHRoaXMuc2V0dGluZ3MpO1xuICB9XG59XG5cbi8vID09PT09IFN5bmMgTW9kYWwgKFJpYmJvbiBjbGljaykgPT09PT1cblxuY2xhc3MgU3luY01vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBwbHVnaW46IExxc3NibG9nUGx1Z2luO1xuXG4gIGNvbnN0cnVjdG9yKGFwcDogQXBwLCBwbHVnaW46IExxc3NibG9nUGx1Z2luKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgfVxuXG4gIG9uT3BlbigpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuYWRkQ2xhc3MoXCJscXNzLW1vZGFsXCIpO1xuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcImgzXCIsIHsgdGV4dDogXCJscXNzYmxvZyBTeW5jXCIgfSk7XG5cbiAgICBjb25zdCBncmlkID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJscXNzLWdyaWRcIiB9KTtcblxuICAgIHRoaXMuYnRuKGdyaWQsIFwiXHUyMTkxXCIsIFwiXHU2M0E4XHU5MDAxXHU1RjUzXHU1MjREXHU3QjE0XHU4QkIwXCIsIFwidXBsb2FkLWNsb3VkXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpO1xuICAgICAgaWYgKGZpbGUpIHRoaXMucGx1Z2luLnB1c2hOb3RlKGZpbGUpO1xuICAgICAgZWxzZSBuZXcgTm90aWNlKFwibHFzc2Jsb2c6IFx1NkNBMVx1NjcwOVx1NjI1M1x1NUYwMFx1NzY4NFx1N0IxNFx1OEJCMFwiKTtcbiAgICB9KTtcblxuICAgIHRoaXMuYnRuKGdyaWQsIFwiXHUyMTkzXCIsIFwiXHU2MkM5XHU1M0Q2XHU1MTY4XHU5MEU4XHU2NTg3XHU3QUUwXCIsIFwiZG93bmxvYWQtY2xvdWRcIiwgKCkgPT4ge1xuICAgICAgdGhpcy5wbHVnaW4ucHVsbEFsbFBvc3RzKCk7XG4gICAgfSk7XG5cbiAgICB0aGlzLmJ0bihncmlkLCBcIlx1MjFDNVwiLCBcIlx1NTE2OFx1OTFDRlx1NTNDQ1x1NTQxMVx1NTQwQ1x1NkI2NVwiLCBcInJlZnJlc2gtY3dcIiwgKCkgPT4ge1xuICAgICAgdGhpcy5wbHVnaW4uc3luY0FsbCgpO1xuICAgIH0pO1xuICB9XG5cbiAgYnRuKFxuICAgIHBhcmVudDogSFRNTEVsZW1lbnQsXG4gICAgaWNvbjogc3RyaW5nLFxuICAgIGxhYmVsOiBzdHJpbmcsXG4gICAgX2x1Y2lkZTogc3RyaW5nLFxuICAgIG9uQ2xpY2s6ICgpID0+IHZvaWRcbiAgKSB7XG4gICAgY29uc3QgYnRuID0gcGFyZW50LmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgY2xzOiBcImxxc3MtYWN0aW9uLWJ0blwiIH0pO1xuICAgIGJ0bi5jcmVhdGVFbChcInNwYW5cIiwgeyBjbHM6IFwibHFzcy1idG4taWNvblwiLCB0ZXh0OiBpY29uIH0pO1xuICAgIGJ0bi5jcmVhdGVFbChcInNwYW5cIiwgeyBjbHM6IFwibHFzcy1idG4tbGFiZWxcIiwgdGV4dDogbGFiZWwgfSk7XG4gICAgYnRuLm9uY2xpY2sgPSAoKSA9PiB7XG4gICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICBvbkNsaWNrKCk7XG4gICAgfTtcbiAgfVxuXG4gIG9uQ2xvc2UoKSB7XG4gICAgdGhpcy5jb250ZW50RWwuZW1wdHkoKTtcbiAgfVxufVxuXG4vLyA9PT09PSBQdWJsaXNoIE1vZGFsIChmaXJzdC10aW1lIHB1c2gsIG5vIHpvbmUgc2V0KSA9PT09PVxuXG5jbGFzcyBQdWJsaXNoTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIHBsdWdpbjogTHFzc2Jsb2dQbHVnaW47XG4gIGZpbGU6IFRGaWxlO1xuXG4gIGNvbnN0cnVjdG9yKGFwcDogQXBwLCBwbHVnaW46IExxc3NibG9nUGx1Z2luLCBmaWxlOiBURmlsZSkge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gICAgdGhpcy5maWxlID0gZmlsZTtcbiAgfVxuXG4gIG9uT3BlbigpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb25zdCBmbSA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKHRoaXMuZmlsZSk/LmZyb250bWF0dGVyID8/IHt9O1xuXG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwiaDNcIiwgeyB0ZXh0OiBcIlx1NTNEMVx1NUUwM1x1NTIzMCBscXNzYmxvZ1wiIH0pO1xuXG4gICAgbGV0IHRpdGxlID0gKGZtW1widGl0bGVcIl0gYXMgc3RyaW5nKSB8fCB0aGlzLmZpbGUuYmFzZW5hbWU7XG4gICAgbGV0IHpvbmU6IFpvbmUgPSBcIkFOSU1FXCI7XG4gICAgbGV0IHZpc2liaWxpdHk6IFZpc2liaWxpdHkgPSBcIkxPR0lOX09OTFlcIjtcbiAgICBsZXQgcHVibGlzaGVkID0gZmFsc2U7XG4gICAgbGV0IHRhZ3MgPSBwYXJzZVRhZ3MoZm1bXCJibG9nLXRhZ3NcIl0pLmpvaW4oXCIsIFwiKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5zZXROYW1lKFwiXHU2ODA3XHU5ODk4XCIpXG4gICAgICAuYWRkVGV4dCgodCkgPT5cbiAgICAgICAgdC5zZXRWYWx1ZSh0aXRsZSkub25DaGFuZ2UoKHYpID0+ICh0aXRsZSA9IHYpKVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5zZXROYW1lKFwiXHU1MjA2XHU1MzNBXCIpXG4gICAgICAuYWRkRHJvcGRvd24oKGQpID0+IHtcbiAgICAgICAgZC5hZGRPcHRpb24oXCJBTklNRVwiLCBcIlx1NEU4Q1x1NkIyMVx1NTE0M1x1RkYwOEFOSU1FXHVGRjA5XCIpO1xuICAgICAgICBkLmFkZE9wdGlvbihcIlJFQUxcIiwgXCJcdTRFMDlcdTZCMjFcdTUxNDNcdUZGMDhSRUFMXHVGRjA5XCIpO1xuICAgICAgICBkLmFkZE9wdGlvbihcIkZPVVJcIiwgXCI0XHU5ODkxXHU5MDUzXHVGRjA4Rk9VUlx1RkYwOVwiKTtcbiAgICAgICAgZC5zZXRWYWx1ZSh6b25lKS5vbkNoYW5nZSgodikgPT4gKHpvbmUgPSB2IGFzIFpvbmUpKTtcbiAgICAgIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgLnNldE5hbWUoXCJcdTUzRUZcdTg5QzFcdTYwMjdcIilcbiAgICAgIC5hZGREcm9wZG93bigoZCkgPT4ge1xuICAgICAgICBkLmFkZE9wdGlvbihcIkxPR0lOX09OTFlcIiwgXCJcdTRFQzVcdTc2N0JcdTVGNTVcdTc1MjhcdTYyMzdcIik7XG4gICAgICAgIGQuYWRkT3B0aW9uKFwiUFVCTElDXCIsIFwiXHU1MTZDXHU1RjAwXCIpO1xuICAgICAgICBkLmFkZE9wdGlvbihcIkZSSUVORFNfT05MWVwiLCBcIlx1NEVDNVx1NTk3RFx1NTNDQlwiKTtcbiAgICAgICAgZC5zZXRWYWx1ZSh2aXNpYmlsaXR5KS5vbkNoYW5nZSgodikgPT4gKHZpc2liaWxpdHkgPSB2IGFzIFZpc2liaWxpdHkpKTtcbiAgICAgIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgLnNldE5hbWUoXCJcdTY4MDdcdTdCN0VcIilcbiAgICAgIC5zZXREZXNjKFwiXHU1OTFBXHU0RTJBXHU2ODA3XHU3QjdFXHU3NTI4XHU5MDE3XHU1M0Y3XHU1MjA2XHU5Njk0XCIpXG4gICAgICAuYWRkVGV4dCgodCkgPT5cbiAgICAgICAgdFxuICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcihcInRhZzEsIHRhZzJcIilcbiAgICAgICAgICAuc2V0VmFsdWUodGFncylcbiAgICAgICAgICAub25DaGFuZ2UoKHYpID0+ICh0YWdzID0gdikpXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgLnNldE5hbWUoXCJcdTdBQ0JcdTUzNzNcdTUzRDFcdTVFMDNcIilcbiAgICAgIC5zZXREZXNjKFwiXHU1MTczXHU5NUVEXHU1MjE5XHU0RkREXHU1QjU4XHU0RTNBXHU4MzQ5XHU3QTNGXCIpXG4gICAgICAuYWRkVG9nZ2xlKCh0KSA9PlxuICAgICAgICB0LnNldFZhbHVlKHB1Ymxpc2hlZCkub25DaGFuZ2UoKHYpID0+IChwdWJsaXNoZWQgPSB2KSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpLmFkZEJ1dHRvbigoYnRuKSA9PlxuICAgICAgYnRuXG4gICAgICAgIC5zZXRCdXR0b25UZXh0KFwiXHU1M0QxXHU1RTAzXCIpXG4gICAgICAgIC5zZXRDdGEoKVxuICAgICAgICAub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgICAgIGNvbnN0IHRhZ0xpc3QgPSB0YWdzXG4gICAgICAgICAgICAuc3BsaXQoXCIsXCIpXG4gICAgICAgICAgICAubWFwKCh0KSA9PiB0LnRyaW0oKSlcbiAgICAgICAgICAgIC5maWx0ZXIoQm9vbGVhbik7XG4gICAgICAgICAgLy8gV3JpdGUgbWV0YSB0byBmcm9udG1hdHRlciBmaXJzdCBzbyBkb1B1c2ggY2FuIHJlYWQgaXRcbiAgICAgICAgICBhd2FpdCB0aGlzLmFwcC5maWxlTWFuYWdlci5wcm9jZXNzRnJvbnRNYXR0ZXIodGhpcy5maWxlLCAoZikgPT4ge1xuICAgICAgICAgICAgZltcInRpdGxlXCJdID0gdGl0bGU7XG4gICAgICAgICAgICBmW1wiYmxvZy16b25lXCJdID0gem9uZTtcbiAgICAgICAgICAgIGZbXCJibG9nLXZpc2liaWxpdHlcIl0gPSB2aXNpYmlsaXR5O1xuICAgICAgICAgICAgZltcImJsb2ctcHVibGlzaGVkXCJdID0gcHVibGlzaGVkO1xuICAgICAgICAgICAgZltcImJsb2ctdGFnc1wiXSA9IHRhZ0xpc3Q7XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uZG9QdXNoKFxuICAgICAgICAgICAgdGhpcy5maWxlLFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICB0aXRsZSxcbiAgICAgICAgICAgICAgXCJibG9nLXpvbmVcIjogem9uZSxcbiAgICAgICAgICAgICAgXCJibG9nLXZpc2liaWxpdHlcIjogdmlzaWJpbGl0eSxcbiAgICAgICAgICAgICAgXCJibG9nLXB1Ymxpc2hlZFwiOiBwdWJsaXNoZWQsXG4gICAgICAgICAgICAgIFwiYmxvZy10YWdzXCI6IHRhZ0xpc3QsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICAgICAgem9uZVxuICAgICAgICAgICk7XG4gICAgICAgIH0pXG4gICAgKTtcbiAgfVxuXG4gIG9uQ2xvc2UoKSB7XG4gICAgdGhpcy5jb250ZW50RWwuZW1wdHkoKTtcbiAgfVxufVxuXG4vLyA9PT09PSBTZXR0aW5ncyBUYWIgPT09PT1cblxuY2xhc3MgTHFzc2Jsb2dTZXR0aW5nVGFiIGV4dGVuZHMgUGx1Z2luU2V0dGluZ1RhYiB7XG4gIHBsdWdpbjogTHFzc2Jsb2dQbHVnaW47XG5cbiAgY29uc3RydWN0b3IoYXBwOiBBcHAsIHBsdWdpbjogTHFzc2Jsb2dQbHVnaW4pIHtcbiAgICBzdXBlcihhcHAsIHBsdWdpbik7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gIH1cblxuICBkaXNwbGF5KCkge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgY29udGFpbmVyRWwuZW1wdHkoKTtcbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcImgyXCIsIHsgdGV4dDogXCJscXNzYmxvZyBTeW5jXCIgfSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiXHU1MzVBXHU1QkEyXHU1NzMwXHU1NzQwXCIpXG4gICAgICAuc2V0RGVzYyhcIlx1NEUwRFx1NTQyQlx1NjcyQlx1NUMzRVx1NjU5Q1x1N0VCRlx1RkYwQ1x1NEY4Qlx1NTk4MiBodHRwczovL2xxc3NibG9nLnNlcnZlYmxvZy5uZXRcIilcbiAgICAgIC5hZGRUZXh0KCh0KSA9PlxuICAgICAgICB0XG4gICAgICAgICAgLnNldFBsYWNlaG9sZGVyKFwiaHR0cHM6Ly9scXNzYmxvZy5zZXJ2ZWJsb2cubmV0XCIpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmJsb2dVcmwpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2KSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ibG9nVXJsID0gdi5yZXBsYWNlKC9cXC8kLywgXCJcIik7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJcdTc1MjhcdTYyMzdcdTU0MERcIilcbiAgICAgIC5hZGRUZXh0KCh0KSA9PlxuICAgICAgICB0XG4gICAgICAgICAgLnNldFBsYWNlaG9sZGVyKFwieW91ci11c2VybmFtZVwiKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy51c2VybmFtZSlcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHYpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnVzZXJuYW1lID0gdi50cmltKCk7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJcdTVCQzZcdTc4MDFcIilcbiAgICAgIC5hZGRUZXh0KCh0KSA9PiB7XG4gICAgICAgIHQuaW5wdXRFbC50eXBlID0gXCJwYXNzd29yZFwiO1xuICAgICAgICB0LnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLnBhc3N3b3JkKS5vbkNoYW5nZShhc3luYyAodikgPT4ge1xuICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnBhc3N3b3JkID0gdjtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJcdTU0MENcdTZCNjVcdTY1ODdcdTRFRjZcdTU5MzlcIilcbiAgICAgIC5zZXREZXNjKFwiXHU2MkM5XHU1M0Q2XHU3Njg0XHU2NTg3XHU3QUUwXHU0RkREXHU1QjU4XHU1MjMwXHU2QjY0XHU2NTg3XHU0RUY2XHU1OTM5XHVGRjA4XHU3NkY4XHU1QkY5IHZhdWx0IFx1NjgzOVx1NzZFRVx1NUY1NVx1RkYwOVwiKVxuICAgICAgLmFkZFRleHQoKHQpID0+XG4gICAgICAgIHRcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoXCJibG9nXCIpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLnN5bmNGb2xkZXIpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2KSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5zeW5jRm9sZGVyID0gdi50cmltKCkucmVwbGFjZSgvXFwvJC8sIFwiXCIpO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiXHU2RDRCXHU4QkQ1XHU4RkRFXHU2M0E1XCIpXG4gICAgICAuc2V0RGVzYyhcIlx1OUE4Q1x1OEJDMVx1NzUyOFx1NjIzN1x1NTQwRFx1NTQ4Q1x1NUJDNlx1NzgwMVx1NjYyRlx1NTQyNlx1NkI2M1x1Nzg2RVwiKVxuICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PlxuICAgICAgICBidG4uc2V0QnV0dG9uVGV4dChcIlx1NkQ0Qlx1OEJENVwiKS5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICBidG4uc2V0QnV0dG9uVGV4dChcIlx1OEZERVx1NjNBNVx1NEUyRFx1MjAyNlwiKS5zZXREaXNhYmxlZCh0cnVlKTtcbiAgICAgICAgICBjb25zdCBvayA9IGF3YWl0IHRoaXMucGx1Z2luLmxvZ2luKCk7XG4gICAgICAgICAgYnRuLnNldERpc2FibGVkKGZhbHNlKTtcbiAgICAgICAgICBpZiAob2spIHtcbiAgICAgICAgICAgIGJ0bi5zZXRCdXR0b25UZXh0KFwiXHUyNzEzIFx1NjIxMFx1NTI5RlwiKTtcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoXCJscXNzYmxvZzogXHU3NjdCXHU1RjU1XHU2MjEwXHU1MjlGXCIpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBidG4uc2V0QnV0dG9uVGV4dChcIlx1MjcxNyBcdTU5MzFcdThEMjVcIik7XG4gICAgICAgICAgICBuZXcgTm90aWNlKFwibHFzc2Jsb2c6IFx1NzY3Qlx1NUY1NVx1NTkzMVx1OEQyNVx1RkYwQ1x1OEJGN1x1NjhDMFx1NjdFNVx1NzUyOFx1NjIzN1x1NTQwRC9cdTVCQzZcdTc4MDEvXHU1MzVBXHU1QkEyXHU1NzMwXHU1NzQwXCIpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IGJ0bi5zZXRCdXR0b25UZXh0KFwiXHU2RDRCXHU4QkQ1XCIpLCAzMDAwKTtcbiAgICAgICAgfSlcbiAgICAgICk7XG4gIH1cbn1cblxuLy8gPT09PT0gVXRpbGl0eSA9PT09PVxuXG5mdW5jdGlvbiBzdHJpcEZyb250bWF0dGVyKGNvbnRlbnQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmICghY29udGVudC5zdGFydHNXaXRoKFwiLS0tXCIpKSByZXR1cm4gY29udGVudDtcbiAgY29uc3QgZW5kID0gY29udGVudC5pbmRleE9mKFwiXFxuLS0tXCIsIDMpO1xuICBpZiAoZW5kID09PSAtMSkgcmV0dXJuIGNvbnRlbnQ7XG4gIHJldHVybiBjb250ZW50LnNsaWNlKGVuZCArIDQpLnRyaW1TdGFydCgpO1xufVxuXG5mdW5jdGlvbiBwYXJzZVRhZ3MocmF3OiB1bmtub3duKTogc3RyaW5nW10ge1xuICBpZiAoIXJhdykgcmV0dXJuIFtdO1xuICBpZiAoQXJyYXkuaXNBcnJheShyYXcpKSByZXR1cm4gKHJhdyBhcyB1bmtub3duW10pLm1hcChTdHJpbmcpLmZpbHRlcihCb29sZWFuKTtcbiAgaWYgKHR5cGVvZiByYXcgPT09IFwic3RyaW5nXCIpXG4gICAgcmV0dXJuIHJhd1xuICAgICAgLnNwbGl0KFwiLFwiKVxuICAgICAgLm1hcCgodCkgPT4gdC50cmltKCkpXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICByZXR1cm4gW107XG59XG5cbmZ1bmN0aW9uIHNhZmVGaWxlbmFtZShuYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbmFtZS5yZXBsYWNlKC9bXFxcXC86Kj9cIjw+fF0vZywgXCItXCIpLnRyaW0oKS5zbGljZSgwLCAxMDApO1xufVxuXG5mdW5jdGlvbiBidWlsZE5vdGVDb250ZW50KHBvc3Q6IEJsb2dQb3N0KTogc3RyaW5nIHtcbiAgY29uc3QgdGFncyA9IHBvc3QudGFncy5tYXAoKHQpID0+IHQudGFnLm5hbWUpO1xuICBjb25zdCBsaW5lcyA9IFtcbiAgICBcIi0tLVwiLFxuICAgIGB0aXRsZTogXCIke3Bvc3QudGl0bGUucmVwbGFjZSgvXCIvZywgJ1xcXFxcIicpfVwiYCxcbiAgICBgYmxvZy1pZDogXCIke3Bvc3QuaWR9XCJgLFxuICAgIGBibG9nLXpvbmU6ICR7cG9zdC56b25lfWAsXG4gICAgYGJsb2ctdmlzaWJpbGl0eTogJHtwb3N0LnZpc2liaWxpdHl9YCxcbiAgICBgYmxvZy1wdWJsaXNoZWQ6ICR7cG9zdC5wdWJsaXNoZWR9YCxcbiAgXTtcbiAgaWYgKHRhZ3MubGVuZ3RoKSB7XG4gICAgbGluZXMucHVzaChgYmxvZy10YWdzOiBbJHt0YWdzLm1hcCgodCkgPT4gYFwiJHt0fVwiYCkuam9pbihcIiwgXCIpfV1gKTtcbiAgfVxuICBsaW5lcy5wdXNoKFxuICAgIGBibG9nLXN5bmNlZC1hdDogXCIke25ldyBEYXRlKCkudG9JU09TdHJpbmcoKX1cImAsXG4gICAgYGJsb2ctdXBkYXRlZC1hdDogXCIke3Bvc3QudXBkYXRlZEF0fVwiYCxcbiAgICBcIi0tLVwiLFxuICAgIFwiXCIsXG4gICAgcG9zdC5jb250ZW50XG4gICk7XG4gIHJldHVybiBsaW5lcy5qb2luKFwiXFxuXCIpO1xufVxuIl0sCiAgIm1h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
