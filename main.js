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
        const inZoneFolder = zone && file.path.startsWith(this.zoneFolder(zone) + "/");
        if (inZoneFolder) {
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
      d.addOption("ANIME", "2");
      d.addOption("REAL", "3");
      d.addOption("FOUR", "4");
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
    new import_obsidian.Setting(containerEl).setName("\u540C\u6B65\u6839\u6587\u4EF6\u5939").setDesc("\u6587\u7AE0\u6309\u5206\u533A\u4FDD\u5B58\u5230\u5B50\u6587\u4EF6\u5939\uFF1Ablog/2 \xB7 blog/3 \xB7 blog/4").addText(
      (t) => t.setPlaceholder("blog").setValue(this.plugin.settings.syncFolder).onChange(async (v) => {
        this.plugin.settings.syncFolder = v.trim().replace(/\/$/, "");
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7XG4gIEFwcCxcbiAgTW9kYWwsXG4gIE5vdGljZSxcbiAgUGx1Z2luLFxuICBQbHVnaW5TZXR0aW5nVGFiLFxuICBTZXR0aW5nLFxuICBURmlsZSxcbiAgcmVxdWVzdFVybCxcbiAgUmVxdWVzdFVybFBhcmFtLFxuICBSZXF1ZXN0VXJsUmVzcG9uc2UsXG59IGZyb20gXCJvYnNpZGlhblwiO1xuXG4vLyA9PT09PSBUeXBlcyA9PT09PVxuXG50eXBlIFpvbmUgPSBcIkFOSU1FXCIgfCBcIlJFQUxcIiB8IFwiRk9VUlwiO1xudHlwZSBWaXNpYmlsaXR5ID0gXCJQVUJMSUNcIiB8IFwiTE9HSU5fT05MWVwiIHwgXCJGUklFTkRTX09OTFlcIjtcblxuaW50ZXJmYWNlIEJsb2dQb3N0IHtcbiAgaWQ6IHN0cmluZztcbiAgdGl0bGU6IHN0cmluZztcbiAgY29udGVudDogc3RyaW5nO1xuICB6b25lOiBab25lO1xuICB2aXNpYmlsaXR5OiBWaXNpYmlsaXR5O1xuICBwdWJsaXNoZWQ6IGJvb2xlYW47XG4gIGNyZWF0ZWRBdDogc3RyaW5nO1xuICB1cGRhdGVkQXQ6IHN0cmluZztcbiAgdGFnczogeyB0YWc6IHsgbmFtZTogc3RyaW5nIH0gfVtdO1xufVxuXG5pbnRlcmZhY2UgTHFzc2Jsb2dTZXR0aW5ncyB7XG4gIGJsb2dVcmw6IHN0cmluZztcbiAgdXNlcm5hbWU6IHN0cmluZztcbiAgcGFzc3dvcmQ6IHN0cmluZztcbiAgc3luY0ZvbGRlcjogc3RyaW5nO1xuICB0b2tlbjogc3RyaW5nO1xufVxuXG5jb25zdCBERUZBVUxUX1NFVFRJTkdTOiBMcXNzYmxvZ1NldHRpbmdzID0ge1xuICBibG9nVXJsOiBcImh0dHBzOi8vbHFzc2Jsb2cuc2VydmVibG9nLm5ldFwiLFxuICB1c2VybmFtZTogXCJcIixcbiAgcGFzc3dvcmQ6IFwiXCIsXG4gIHN5bmNGb2xkZXI6IFwiYmxvZ1wiLFxuICB0b2tlbjogXCJcIixcbn07XG5cbmNvbnN0IFpPTkVfU1VCRk9MREVSOiBSZWNvcmQ8Wm9uZSwgc3RyaW5nPiA9IHtcbiAgQU5JTUU6IFwiMlwiLFxuICBSRUFMOiBcIjNcIixcbiAgRk9VUjogXCI0XCIsXG59O1xuXG4vLyA9PT09PSBQbHVnaW4gPT09PT1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgTHFzc2Jsb2dQbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xuICBzZXR0aW5nczogTHFzc2Jsb2dTZXR0aW5ncztcblxuICBhc3luYyBvbmxvYWQoKSB7XG4gICAgYXdhaXQgdGhpcy5sb2FkU2V0dGluZ3MoKTtcblxuICAgIC8vIFJpYmJvbiBpY29uXG4gICAgdGhpcy5hZGRSaWJib25JY29uKFwiY2xvdWRcIiwgXCJscXNzYmxvZyBTeW5jXCIsICgpID0+IHtcbiAgICAgIG5ldyBTeW5jTW9kYWwodGhpcy5hcHAsIHRoaXMpLm9wZW4oKTtcbiAgICB9KTtcblxuICAgIC8vIENvbW1hbmRzXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcInB1c2gtY3VycmVudC1ub3RlXCIsXG4gICAgICBuYW1lOiBcIlx1NjNBOFx1OTAwMVx1NUY1M1x1NTI0RFx1N0IxNFx1OEJCMFx1NTIzMFx1NTM1QVx1NUJBMlwiLFxuICAgICAgY2FsbGJhY2s6ICgpID0+IHtcbiAgICAgICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVGaWxlKCk7XG4gICAgICAgIGlmIChmaWxlKSB0aGlzLnB1c2hOb3RlKGZpbGUpO1xuICAgICAgICBlbHNlIG5ldyBOb3RpY2UoXCJscXNzYmxvZzogXHU2Q0ExXHU2NzA5XHU2MjUzXHU1RjAwXHU3Njg0XHU3QjE0XHU4QkIwXCIpO1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJwdWxsLWFsbC1wb3N0c1wiLFxuICAgICAgbmFtZTogXCJcdTRFQ0VcdTUzNUFcdTVCQTJcdTYyQzlcdTUzRDZcdTUxNjhcdTkwRThcdTY1ODdcdTdBRTBcIixcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB0aGlzLnB1bGxBbGxQb3N0cygpLFxuICAgIH0pO1xuXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcInN5bmMtYWxsXCIsXG4gICAgICBuYW1lOiBcIlx1NEUwRVx1NTM1QVx1NUJBMlx1NTE2OFx1OTFDRlx1NTNDQ1x1NTQxMVx1NTQwQ1x1NkI2NVwiLFxuICAgICAgY2FsbGJhY2s6ICgpID0+IHRoaXMuc3luY0FsbCgpLFxuICAgIH0pO1xuXG4gICAgLy8gUmlnaHQtY2xpY2sgY29udGV4dCBtZW51XG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLm9uKFwiZmlsZS1tZW51XCIsIChtZW51LCBmaWxlKSA9PiB7XG4gICAgICAgIGlmIChmaWxlIGluc3RhbmNlb2YgVEZpbGUgJiYgZmlsZS5leHRlbnNpb24gPT09IFwibWRcIikge1xuICAgICAgICAgIG1lbnUuYWRkSXRlbSgoaXRlbSkgPT4ge1xuICAgICAgICAgICAgaXRlbVxuICAgICAgICAgICAgICAuc2V0VGl0bGUoXCJcdTYzQThcdTkwMDFcdTUyMzAgbHFzc2Jsb2dcIilcbiAgICAgICAgICAgICAgLnNldEljb24oXCJ1cGxvYWQtY2xvdWRcIilcbiAgICAgICAgICAgICAgLm9uQ2xpY2soKCkgPT4gdGhpcy5wdXNoTm90ZShmaWxlKSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgKTtcblxuICAgIHRoaXMuYWRkU2V0dGluZ1RhYihuZXcgTHFzc2Jsb2dTZXR0aW5nVGFiKHRoaXMuYXBwLCB0aGlzKSk7XG4gIH1cblxuICBvbnVubG9hZCgpIHt9XG5cbiAgLy8gPT09PT0gQXV0aCA9PT09PVxuXG4gIGFzeW5jIGxvZ2luKCk6IFByb21pc2U8eyBvazogYm9vbGVhbjsgcmVhc29uOiBzdHJpbmcgfT4ge1xuICAgIGlmICghdGhpcy5zZXR0aW5ncy51c2VybmFtZSB8fCAhdGhpcy5zZXR0aW5ncy5wYXNzd29yZCkge1xuICAgICAgcmV0dXJuIHsgb2s6IGZhbHNlLCByZWFzb246IFwiXHU3NTI4XHU2MjM3XHU1NDBEXHU2MjE2XHU1QkM2XHU3ODAxXHU2NzJBXHU1ODZCXHU1MTk5XCIgfTtcbiAgICB9XG4gICAgbGV0IHJlc3A6IFJlcXVlc3RVcmxSZXNwb25zZTtcbiAgICB0cnkge1xuICAgICAgcmVzcCA9IGF3YWl0IHJlcXVlc3RVcmwoe1xuICAgICAgICB1cmw6IGAke3RoaXMuc2V0dGluZ3MuYmxvZ1VybH0vYXBpL2F1dGgvbG9naW5gLFxuICAgICAgICBtZXRob2Q6IFwiUE9TVFwiLFxuICAgICAgICBoZWFkZXJzOiB7IFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiIH0sXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICB1c2VybmFtZTogdGhpcy5zZXR0aW5ncy51c2VybmFtZSxcbiAgICAgICAgICBwYXNzd29yZDogdGhpcy5zZXR0aW5ncy5wYXNzd29yZCxcbiAgICAgICAgfSksXG4gICAgICAgIHRocm93OiBmYWxzZSxcbiAgICAgIH0pO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHJldHVybiB7IG9rOiBmYWxzZSwgcmVhc29uOiBgXHU3RjUxXHU3RURDXHU5NTE5XHU4QkVGOiAke1N0cmluZyhlKX1gIH07XG4gICAgfVxuXG4gICAgaWYgKHJlc3Auc3RhdHVzICE9PSAyMDApIHtcbiAgICAgIGxldCBtc2cgPSBcIlwiO1xuICAgICAgdHJ5IHsgbXNnID0gcmVzcC5qc29uPy5lcnJvciA/PyByZXNwLnRleHQ7IH0gY2F0Y2ggeyBtc2cgPSBTdHJpbmcocmVzcC5zdGF0dXMpOyB9XG4gICAgICByZXR1cm4geyBvazogZmFsc2UsIHJlYXNvbjogYEhUVFAgJHtyZXNwLnN0YXR1c306ICR7bXNnfWAgfTtcbiAgICB9XG5cbiAgICBsZXQgdG9rZW46IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICB0cnkgeyB0b2tlbiA9IHJlc3AuanNvbj8udG9rZW47IH0gY2F0Y2ggeyAvKiBpZ25vcmUgKi8gfVxuICAgIGlmICghdG9rZW4pIHtcbiAgICAgIHJldHVybiB7IG9rOiBmYWxzZSwgcmVhc29uOiBcIlx1NTRDRFx1NUU5NFx1NEUyRFx1NkNBMVx1NjcwOSB0b2tlbiBcdTVCNTdcdTZCQjVcIiB9O1xuICAgIH1cblxuICAgIHRoaXMuc2V0dGluZ3MudG9rZW4gPSB0b2tlbjtcbiAgICBhd2FpdCB0aGlzLnNhdmVTZXR0aW5ncygpO1xuICAgIHJldHVybiB7IG9rOiB0cnVlLCByZWFzb246IFwiXHU3NjdCXHU1RjU1XHU2MjEwXHU1MjlGXCIgfTtcbiAgfVxuXG4gIGdldEhlYWRlcnMoKTogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB7XG4gICAgcmV0dXJuIHtcbiAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgQ29va2llOiBgdG9rZW49JHt0aGlzLnNldHRpbmdzLnRva2VufWAsXG4gICAgfTtcbiAgfVxuXG4gIC8vIEF1dG8tcmV0cnkgd2l0aCByZS1sb2dpbiBvbiA0MDFcbiAgYXN5bmMgYXBpUmVxKFxuICAgIG9wdGlvbnM6IFJlcXVlc3RVcmxQYXJhbSxcbiAgICByZXRyaWVkID0gZmFsc2VcbiAgKTogUHJvbWlzZTxSZXF1ZXN0VXJsUmVzcG9uc2U+IHtcbiAgICBjb25zdCByZXNwID0gYXdhaXQgcmVxdWVzdFVybCh7XG4gICAgICAuLi5vcHRpb25zLFxuICAgICAgaGVhZGVyczogeyAuLi50aGlzLmdldEhlYWRlcnMoKSwgLi4uKG9wdGlvbnMuaGVhZGVycyA/PyB7fSkgfSxcbiAgICAgIHRocm93OiBmYWxzZSxcbiAgICB9KTtcbiAgICBpZiAocmVzcC5zdGF0dXMgPT09IDQwMSAmJiAhcmV0cmllZCkge1xuICAgICAgY29uc3QgeyBvayB9ID0gYXdhaXQgdGhpcy5sb2dpbigpO1xuICAgICAgaWYgKG9rKSByZXR1cm4gdGhpcy5hcGlSZXEob3B0aW9ucywgdHJ1ZSk7XG4gICAgfVxuICAgIHJldHVybiByZXNwO1xuICB9XG5cbiAgLy8gPT09PT0gQVBJID09PT09XG5cbiAgYXN5bmMgZmV0Y2hNeVBvc3RzKCk6IFByb21pc2U8QmxvZ1Bvc3RbXT4ge1xuICAgIGNvbnN0IHJlc3AgPSBhd2FpdCB0aGlzLmFwaVJlcSh7XG4gICAgICB1cmw6IGAke3RoaXMuc2V0dGluZ3MuYmxvZ1VybH0vYXBpL3VzZXIvcG9zdHNgLFxuICAgIH0pO1xuICAgIGlmIChyZXNwLnN0YXR1cyAhPT0gMjAwKSByZXR1cm4gW107XG4gICAgcmV0dXJuIChyZXNwLmpzb24gYXMgeyBwb3N0czogQmxvZ1Bvc3RbXSB9KS5wb3N0cyA/PyBbXTtcbiAgfVxuXG4gIGFzeW5jIGNyZWF0ZVBvc3QoZGF0YToge1xuICAgIHRpdGxlOiBzdHJpbmc7XG4gICAgY29udGVudDogc3RyaW5nO1xuICAgIHpvbmU6IFpvbmU7XG4gICAgdmlzaWJpbGl0eTogVmlzaWJpbGl0eTtcbiAgICBwdWJsaXNoZWQ6IGJvb2xlYW47XG4gICAgdGFnczogc3RyaW5nW107XG4gIH0pOiBQcm9taXNlPEJsb2dQb3N0IHwgbnVsbD4ge1xuICAgIGNvbnN0IHJlc3AgPSBhd2FpdCB0aGlzLmFwaVJlcSh7XG4gICAgICB1cmw6IGAke3RoaXMuc2V0dGluZ3MuYmxvZ1VybH0vYXBpL3Bvc3RzYCxcbiAgICAgIG1ldGhvZDogXCJQT1NUXCIsXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShkYXRhKSxcbiAgICB9KTtcbiAgICBpZiAocmVzcC5zdGF0dXMgIT09IDIwMSkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIChyZXNwLmpzb24gYXMgeyBwb3N0OiBCbG9nUG9zdCB9KS5wb3N0ID8/IG51bGw7XG4gIH1cblxuICBhc3luYyB1cGRhdGVQb3N0KFxuICAgIGlkOiBzdHJpbmcsXG4gICAgZGF0YToge1xuICAgICAgdGl0bGU6IHN0cmluZztcbiAgICAgIGNvbnRlbnQ6IHN0cmluZztcbiAgICAgIHpvbmU6IFpvbmU7XG4gICAgICB2aXNpYmlsaXR5OiBWaXNpYmlsaXR5O1xuICAgICAgcHVibGlzaGVkOiBib29sZWFuO1xuICAgICAgdGFnczogc3RyaW5nW107XG4gICAgfVxuICApOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBjb25zdCByZXNwID0gYXdhaXQgdGhpcy5hcGlSZXEoe1xuICAgICAgdXJsOiBgJHt0aGlzLnNldHRpbmdzLmJsb2dVcmx9L2FwaS9wb3N0cy8ke2lkfWAsXG4gICAgICBtZXRob2Q6IFwiUFVUXCIsXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShkYXRhKSxcbiAgICB9KTtcbiAgICByZXR1cm4gcmVzcC5zdGF0dXMgPT09IDIwMDtcbiAgfVxuXG4gIC8vID09PT09IENvcmUgU3luYyA9PT09PVxuXG4gIC8qKiBQdXNoIGEgc2luZ2xlIG5vdGUgdG8gdGhlIGJsb2cuIFNob3dzIFB1Ymxpc2hNb2RhbCBpZiB6b25lIG5vdCBzZXQuICovXG4gIGFzeW5jIHB1c2hOb3RlKGZpbGU6IFRGaWxlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCF0aGlzLnNldHRpbmdzLnVzZXJuYW1lIHx8ICF0aGlzLnNldHRpbmdzLnBhc3N3b3JkKSB7XG4gICAgICBuZXcgTm90aWNlKFwibHFzc2Jsb2c6IFx1OEJGN1x1NTE0OFx1NTcyOFx1NjNEMlx1NEVGNlx1OEJCRVx1N0Y2RVx1OTFDQ1x1NTg2Qlx1NTE5OVx1NzUyOFx1NjIzN1x1NTQwRFx1NTQ4Q1x1NUJDNlx1NzgwMVwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBmbSA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpPy5mcm9udG1hdHRlciA/PyB7fTtcbiAgICBjb25zdCB6b25lID0gZm1bXCJibG9nLXpvbmVcIl0gYXMgWm9uZSB8IHVuZGVmaW5lZDtcblxuICAgIGlmICghem9uZSkge1xuICAgICAgbmV3IFB1Ymxpc2hNb2RhbCh0aGlzLmFwcCwgdGhpcywgZmlsZSkub3BlbigpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuZG9QdXNoKGZpbGUsIGZtIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBmbVtcImJsb2ctaWRcIl0gYXMgc3RyaW5nIHwgdW5kZWZpbmVkLCB6b25lKTtcbiAgfVxuXG4gIC8qKiBBY3R1YWxseSBwdXNoIHRoZSBub3RlIChjYWxsZWQgYWZ0ZXIgem9uZSBpcyBjb25maXJtZWQpLiAqL1xuICBhc3luYyBkb1B1c2goXG4gICAgZmlsZTogVEZpbGUsXG4gICAgZm06IFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuICAgIGJsb2dJZDogc3RyaW5nIHwgdW5kZWZpbmVkLFxuICAgIHpvbmU6IFpvbmVcbiAgKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgY29uc3QgcmF3Q29udGVudCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LnJlYWQoZmlsZSk7XG4gICAgY29uc3QgYm9keSA9IHN0cmlwRnJvbnRtYXR0ZXIocmF3Q29udGVudCk7XG5cbiAgICBjb25zdCB0aXRsZSA9IChmbVtcInRpdGxlXCJdIGFzIHN0cmluZykgfHwgZmlsZS5iYXNlbmFtZTtcbiAgICBjb25zdCB2aXNpYmlsaXR5ID0gKGZtW1wiYmxvZy12aXNpYmlsaXR5XCJdIGFzIFZpc2liaWxpdHkpIHx8IFwiTE9HSU5fT05MWVwiO1xuICAgIGNvbnN0IHB1Ymxpc2hlZCA9IChmbVtcImJsb2ctcHVibGlzaGVkXCJdIGFzIGJvb2xlYW4pID8/IGZhbHNlO1xuICAgIGNvbnN0IHRhZ3MgPSBwYXJzZVRhZ3MoZm1bXCJibG9nLXRhZ3NcIl0pO1xuXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgIGNvbnN0IGRhdGEgPSB7IHRpdGxlLCBjb250ZW50OiBib2R5LCB6b25lLCB2aXNpYmlsaXR5LCBwdWJsaXNoZWQsIHRhZ3MgfTtcblxuICAgIGlmIChibG9nSWQpIHtcbiAgICAgIGNvbnN0IG9rID0gYXdhaXQgdGhpcy51cGRhdGVQb3N0KGJsb2dJZCwgZGF0YSk7XG4gICAgICBpZiAoIW9rKSB7XG4gICAgICAgIG5ldyBOb3RpY2UoYGxxc3NibG9nOiBcdTI3MTcgXHU2NkY0XHU2NUIwXHU1OTMxXHU4RDI1IFx1MjAxNFx1MzAwQyR7dGl0bGV9XHUzMDBEYCk7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgcG9zdCA9IGF3YWl0IHRoaXMuY3JlYXRlUG9zdChkYXRhKTtcbiAgICAgIGlmICghcG9zdCkge1xuICAgICAgICBuZXcgTm90aWNlKGBscXNzYmxvZzogXHUyNzE3IFx1NTNEMVx1NUUwM1x1NTkzMVx1OEQyNSBcdTIwMTRcdTMwMEMke3RpdGxlfVx1MzAwRGApO1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgICBibG9nSWQgPSBwb3N0LmlkO1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuYXBwLmZpbGVNYW5hZ2VyLnByb2Nlc3NGcm9udE1hdHRlcihmaWxlLCAoZikgPT4ge1xuICAgICAgZltcImJsb2ctaWRcIl0gPSBibG9nSWQ7XG4gICAgICBmW1wiYmxvZy1zeW5jZWQtYXRcIl0gPSBub3c7XG4gICAgICBmW1wiYmxvZy11cGRhdGVkLWF0XCJdID0gbm93O1xuICAgIH0pO1xuXG4gICAgbmV3IE5vdGljZShgbHFzc2Jsb2c6IFx1MjcxMyBcdTVERjJcdTYzQThcdTkwMDFcdTMwMEMke3RpdGxlfVx1MzAwRGApO1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgLyoqIFB1bGwgYWxsIHVzZXIncyBwb3N0cyBmcm9tIHRoZSBibG9nIGludG8gdGhlIHN5bmMgZm9sZGVyLiAqL1xuICBhc3luYyBwdWxsQWxsUG9zdHMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCF0aGlzLnNldHRpbmdzLnVzZXJuYW1lIHx8ICF0aGlzLnNldHRpbmdzLnBhc3N3b3JkKSB7XG4gICAgICBuZXcgTm90aWNlKFwibHFzc2Jsb2c6IFx1OEJGN1x1NTE0OFx1NTcyOFx1NjNEMlx1NEVGNlx1OEJCRVx1N0Y2RVx1OTFDQ1x1NTg2Qlx1NTE5OVx1NzUyOFx1NjIzN1x1NTQwRFx1NTQ4Q1x1NUJDNlx1NzgwMVwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBuZXcgTm90aWNlKFwibHFzc2Jsb2c6IFx1NkI2M1x1NTcyOFx1NjJDOVx1NTNENlx1MjAyNlwiKTtcbiAgICBjb25zdCBwb3N0cyA9IGF3YWl0IHRoaXMuZmV0Y2hNeVBvc3RzKCk7XG5cbiAgICBpZiAoIXBvc3RzLmxlbmd0aCkge1xuICAgICAgbmV3IE5vdGljZShcImxxc3NibG9nOiBcdTUzNUFcdTVCQTJcdTRFMEFcdThGRDhcdTZDQTFcdTY3MDlcdTY1ODdcdTdBRTBcIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5lbnN1cmVTeW5jRm9sZGVyKCk7XG5cbiAgICBsZXQgcHVsbGVkID0gMCwgc2tpcHBlZCA9IDA7XG5cbiAgICBmb3IgKGNvbnN0IHBvc3Qgb2YgcG9zdHMpIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5maW5kRmlsZUJ5QmxvZ0lkKHBvc3QuaWQpO1xuICAgICAgY29uc3Qgc3luY2VkQXQgPSBleGlzdGluZ1xuICAgICAgICA/ICh0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShleGlzdGluZyk/LmZyb250bWF0dGVyPy5bXG4gICAgICAgICAgICBcImJsb2ctc3luY2VkLWF0XCJcbiAgICAgICAgICBdIGFzIHN0cmluZyB8IHVuZGVmaW5lZClcbiAgICAgICAgOiB1bmRlZmluZWQ7XG5cbiAgICAgIGNvbnN0IGJsb2dVcGRhdGVkQXQgPSBuZXcgRGF0ZShwb3N0LnVwZGF0ZWRBdCkuZ2V0VGltZSgpO1xuICAgICAgY29uc3QgbGFzdFN5bmNUaW1lID0gc3luY2VkQXQgPyBuZXcgRGF0ZShzeW5jZWRBdCkuZ2V0VGltZSgpIDogMDtcblxuICAgICAgaWYgKGV4aXN0aW5nICYmIGJsb2dVcGRhdGVkQXQgPD0gbGFzdFN5bmNUaW1lKSB7XG4gICAgICAgIHNraXBwZWQrKztcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNvbnRlbnQgPSBidWlsZE5vdGVDb250ZW50KHBvc3QpO1xuICAgICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0Lm1vZGlmeShleGlzdGluZywgY29udGVudCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCBwYXRoID0gYXdhaXQgdGhpcy51bmlxdWVQYXRoKFxuICAgICAgICAgIGAke3RoaXMuem9uZUZvbGRlcihwb3N0LnpvbmUpfS8ke3NhZmVGaWxlbmFtZShwb3N0LnRpdGxlKSB8fCBwb3N0LmlkfS5tZGBcbiAgICAgICAgKTtcbiAgICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuY3JlYXRlKHBhdGgsIGNvbnRlbnQpO1xuICAgICAgfVxuICAgICAgcHVsbGVkKys7XG4gICAgfVxuXG4gICAgbmV3IE5vdGljZShgbHFzc2Jsb2c6IFx1NjJDOVx1NTNENlx1NUI4Q1x1NjIxMCBcdTIwMTRcdTIwMTQgXHU2NkY0XHU2NUIwICR7cHVsbGVkfSBcdTdCQzdcdUZGMENcdThERjNcdThGQzcgJHtza2lwcGVkfSBcdTdCQzdgKTtcbiAgfVxuXG4gIC8qKiBGdWxsIGJpZGlyZWN0aW9uYWwgc3luYy4gKi9cbiAgYXN5bmMgc3luY0FsbCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMuc2V0dGluZ3MudXNlcm5hbWUgfHwgIXRoaXMuc2V0dGluZ3MucGFzc3dvcmQpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJscXNzYmxvZzogXHU4QkY3XHU1MTQ4XHU1NzI4XHU2M0QyXHU0RUY2XHU4QkJFXHU3RjZFXHU5MUNDXHU1ODZCXHU1MTk5XHU3NTI4XHU2MjM3XHU1NDBEXHU1NDhDXHU1QkM2XHU3ODAxXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIG5ldyBOb3RpY2UoXCJscXNzYmxvZzogXHU1RjAwXHU1OUNCXHU1M0NDXHU1NDExXHU1NDBDXHU2QjY1XHUyMDI2XCIpO1xuICAgIGNvbnN0IHBvc3RzID0gYXdhaXQgdGhpcy5mZXRjaE15UG9zdHMoKTtcbiAgICBjb25zdCBibG9nTWFwID0gbmV3IE1hcDxzdHJpbmcsIEJsb2dQb3N0Pihwb3N0cy5tYXAoKHApID0+IFtwLmlkLCBwXSkpO1xuXG4gICAgYXdhaXQgdGhpcy5lbnN1cmVTeW5jRm9sZGVyKCk7XG5cbiAgICBsZXQgcHVzaGVkID0gMCwgcHVsbGVkID0gMCwgY29uZmxpY3RzID0gMCwgY3JlYXRlZCA9IDA7XG4gICAgY29uc3QgcHJvY2Vzc2VkSWRzID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgICAvLyBQcm9jZXNzIGFsbCBsb2NhbCBmaWxlc1xuICAgIGZvciAoY29uc3QgZmlsZSBvZiB0aGlzLmFwcC52YXVsdC5nZXRNYXJrZG93bkZpbGVzKCkpIHtcbiAgICAgIGNvbnN0IGZtID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUoZmlsZSk/LmZyb250bWF0dGVyID8/IHt9O1xuICAgICAgY29uc3QgYmxvZ0lkID0gZm1bXCJibG9nLWlkXCJdIGFzIHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICAgIGNvbnN0IHpvbmUgPSBmbVtcImJsb2ctem9uZVwiXSBhcyBab25lIHwgdW5kZWZpbmVkO1xuXG4gICAgICBpZiAoIWJsb2dJZCkge1xuICAgICAgICAvLyBOZXcgbG9jYWwgZmlsZSBpbiBhIHpvbmUgc3ViZm9sZGVyIHdpdGggYmxvZy16b25lIHNldCBcdTIxOTIgcHVzaCB0byBjcmVhdGVcbiAgICAgICAgY29uc3QgaW5ab25lRm9sZGVyID1cbiAgICAgICAgICB6b25lICYmIGZpbGUucGF0aC5zdGFydHNXaXRoKHRoaXMuem9uZUZvbGRlcih6b25lKSArIFwiL1wiKTtcbiAgICAgICAgaWYgKGluWm9uZUZvbGRlcikge1xuICAgICAgICAgIGNvbnN0IG9rID0gYXdhaXQgdGhpcy5kb1B1c2goZmlsZSwgZm0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIHVuZGVmaW5lZCwgem9uZSEpO1xuICAgICAgICAgIGlmIChvaykgY3JlYXRlZCsrO1xuICAgICAgICB9XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBwcm9jZXNzZWRJZHMuYWRkKGJsb2dJZCk7XG4gICAgICBjb25zdCBibG9nUG9zdCA9IGJsb2dNYXAuZ2V0KGJsb2dJZCk7XG4gICAgICBpZiAoIWJsb2dQb3N0KSBjb250aW51ZTsgLy8gcG9zdCBkZWxldGVkIG9uIGJsb2cgc2lkZSBcdTIwMTQgc2tpcFxuXG4gICAgICBjb25zdCBzeW5jZWRBdCA9IGZtW1wiYmxvZy1zeW5jZWQtYXRcIl0gYXMgc3RyaW5nIHwgdW5kZWZpbmVkO1xuICAgICAgY29uc3QgbGFzdFN5bmNUaW1lID0gc3luY2VkQXQgPyBuZXcgRGF0ZShzeW5jZWRBdCkuZ2V0VGltZSgpIDogMDtcbiAgICAgIGNvbnN0IGJsb2dVcGRhdGVkQXQgPSBuZXcgRGF0ZShibG9nUG9zdC51cGRhdGVkQXQpLmdldFRpbWUoKTtcbiAgICAgIGNvbnN0IGxvY2FsVXBkYXRlZEF0ID0gZmlsZS5zdGF0Lm10aW1lO1xuICAgICAgY29uc3QgQlVGRkVSID0gNV8wMDA7IC8vIDVzIHRvbGVyYW5jZSBmb3IgY2xvY2sgc2tld1xuXG4gICAgICBjb25zdCBibG9nTmV3ZXIgPSBibG9nVXBkYXRlZEF0ID4gbGFzdFN5bmNUaW1lICsgQlVGRkVSO1xuICAgICAgY29uc3QgbG9jYWxOZXdlciA9IGxvY2FsVXBkYXRlZEF0ID4gbGFzdFN5bmNUaW1lICsgQlVGRkVSO1xuXG4gICAgICBpZiAoYmxvZ05ld2VyICYmIGxvY2FsTmV3ZXIpIHtcbiAgICAgICAgY29uZmxpY3RzKys7XG4gICAgICAgIG5ldyBOb3RpY2UoXG4gICAgICAgICAgYGxxc3NibG9nOiBcdTI2QTAgXHU1MUIyXHU3QTgxIFx1MjAxNFx1MzAwQyR7ZmlsZS5iYXNlbmFtZX1cdTMwMERcdTY3MkNcdTU3MzBcdTU0OENcdThGRENcdTdBRUZcdTkwRkRcdTY3MDlcdTY2RjRcdTY1MzlcdUZGMENcdTVERjJcdThERjNcdThGQzdcdUZGMENcdThCRjdcdTYyNEJcdTUyQThcdTU5MDRcdTc0MDZgXG4gICAgICAgICk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBpZiAobG9jYWxOZXdlcikge1xuICAgICAgICBjb25zdCBvayA9IGF3YWl0IHRoaXMuZG9QdXNoKFxuICAgICAgICAgIGZpbGUsXG4gICAgICAgICAgZm0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4gICAgICAgICAgYmxvZ0lkLFxuICAgICAgICAgIHpvbmUgPz8gKGJsb2dQb3N0LnpvbmUgYXMgWm9uZSlcbiAgICAgICAgKTtcbiAgICAgICAgaWYgKG9rKSBwdXNoZWQrKztcbiAgICAgIH0gZWxzZSBpZiAoYmxvZ05ld2VyKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0Lm1vZGlmeShmaWxlLCBidWlsZE5vdGVDb250ZW50KGJsb2dQb3N0KSk7XG4gICAgICAgIHB1bGxlZCsrO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFB1bGwgcG9zdHMgZnJvbSBibG9nIHRoYXQgZG9uJ3QgZXhpc3QgbG9jYWxseSB5ZXRcbiAgICBmb3IgKGNvbnN0IHBvc3Qgb2YgcG9zdHMpIHtcbiAgICAgIGlmIChwcm9jZXNzZWRJZHMuaGFzKHBvc3QuaWQpKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IHBhdGggPSBhd2FpdCB0aGlzLnVuaXF1ZVBhdGgoXG4gICAgICAgIGAke3RoaXMuem9uZUZvbGRlcihwb3N0LnpvbmUpfS8ke3NhZmVGaWxlbmFtZShwb3N0LnRpdGxlKSB8fCBwb3N0LmlkfS5tZGBcbiAgICAgICk7XG4gICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5jcmVhdGUocGF0aCwgYnVpbGROb3RlQ29udGVudChwb3N0KSk7XG4gICAgICBwdWxsZWQrKztcbiAgICB9XG5cbiAgICBjb25zdCBzdW1tYXJ5ID0gW1xuICAgICAgYFx1MjE5MSBcdTYzQThcdTkwMDEgJHtwdXNoZWQgKyBjcmVhdGVkfWAsXG4gICAgICBgXHUyMTkzIFx1NjJDOVx1NTNENiAke3B1bGxlZH1gLFxuICAgICAgY29uZmxpY3RzID8gYFx1MjZBMCAke2NvbmZsaWN0c30gXHU0RTJBXHU1MUIyXHU3QTgxYCA6IFwiXCIsXG4gICAgXVxuICAgICAgLmZpbHRlcihCb29sZWFuKVxuICAgICAgLmpvaW4oXCIgICBcIik7XG5cbiAgICBuZXcgTm90aWNlKGBscXNzYmxvZzogXHU1NDBDXHU2QjY1XHU1QjhDXHU2MjEwIFx1MjAxNFx1MjAxNCAke3N1bW1hcnl9YCk7XG4gIH1cblxuICAvLyA9PT09PSBIZWxwZXJzID09PT09XG5cbiAgZmluZEZpbGVCeUJsb2dJZChibG9nSWQ6IHN0cmluZyk6IFRGaWxlIHwgbnVsbCB7XG4gICAgZm9yIChjb25zdCBmaWxlIG9mIHRoaXMuYXBwLnZhdWx0LmdldE1hcmtkb3duRmlsZXMoKSkge1xuICAgICAgY29uc3QgZm0gPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShmaWxlKT8uZnJvbnRtYXR0ZXI7XG4gICAgICBpZiAoZm0/LltcImJsb2ctaWRcIl0gPT09IGJsb2dJZCkgcmV0dXJuIGZpbGU7XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgem9uZUZvbGRlcih6b25lOiBab25lKTogc3RyaW5nIHtcbiAgICByZXR1cm4gYCR7dGhpcy5zZXR0aW5ncy5zeW5jRm9sZGVyfS8ke1pPTkVfU1VCRk9MREVSW3pvbmVdfWA7XG4gIH1cblxuICBhc3luYyBlbnN1cmVTeW5jRm9sZGVyKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHJvb3QgPSB0aGlzLnNldHRpbmdzLnN5bmNGb2xkZXI7XG4gICAgaWYgKCEoYXdhaXQgdGhpcy5hcHAudmF1bHQuYWRhcHRlci5leGlzdHMocm9vdCkpKSB7XG4gICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5jcmVhdGVGb2xkZXIocm9vdCk7XG4gICAgfVxuICAgIGZvciAoY29uc3Qgc3ViIG9mIE9iamVjdC52YWx1ZXMoWk9ORV9TVUJGT0xERVIpKSB7XG4gICAgICBjb25zdCBwYXRoID0gYCR7cm9vdH0vJHtzdWJ9YDtcbiAgICAgIGlmICghKGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIuZXhpc3RzKHBhdGgpKSkge1xuICAgICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5jcmVhdGVGb2xkZXIocGF0aCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgdW5pcXVlUGF0aChwYXRoOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGlmICghKGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIuZXhpc3RzKHBhdGgpKSkgcmV0dXJuIHBhdGg7XG4gICAgY29uc3QgYmFzZSA9IHBhdGgucmVwbGFjZSgvXFwubWQkLywgXCJcIik7XG4gICAgbGV0IGkgPSAxO1xuICAgIHdoaWxlIChhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLmV4aXN0cyhgJHtiYXNlfS0ke2l9Lm1kYCkpIGkrKztcbiAgICByZXR1cm4gYCR7YmFzZX0tJHtpfS5tZGA7XG4gIH1cblxuICBhc3luYyBsb2FkU2V0dGluZ3MoKSB7XG4gICAgdGhpcy5zZXR0aW5ncyA9IE9iamVjdC5hc3NpZ24oe30sIERFRkFVTFRfU0VUVElOR1MsIGF3YWl0IHRoaXMubG9hZERhdGEoKSk7XG4gIH1cblxuICBhc3luYyBzYXZlU2V0dGluZ3MoKSB7XG4gICAgYXdhaXQgdGhpcy5zYXZlRGF0YSh0aGlzLnNldHRpbmdzKTtcbiAgfVxufVxuXG4vLyA9PT09PSBTeW5jIE1vZGFsIChSaWJib24gY2xpY2spID09PT09XG5cbmNsYXNzIFN5bmNNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgcGx1Z2luOiBMcXNzYmxvZ1BsdWdpbjtcblxuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgcGx1Z2luOiBMcXNzYmxvZ1BsdWdpbikge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gIH1cblxuICBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmFkZENsYXNzKFwibHFzcy1tb2RhbFwiKTtcbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJoM1wiLCB7IHRleHQ6IFwibHFzc2Jsb2cgU3luY1wiIH0pO1xuXG4gICAgY29uc3QgZ3JpZCA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwibHFzcy1ncmlkXCIgfSk7XG5cbiAgICB0aGlzLmJ0bihncmlkLCBcIlx1MjE5MVwiLCBcIlx1NjNBOFx1OTAwMVx1NUY1M1x1NTI0RFx1N0IxNFx1OEJCMFwiLCBcInVwbG9hZC1jbG91ZFwiLCAoKSA9PiB7XG4gICAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKTtcbiAgICAgIGlmIChmaWxlKSB0aGlzLnBsdWdpbi5wdXNoTm90ZShmaWxlKTtcbiAgICAgIGVsc2UgbmV3IE5vdGljZShcImxxc3NibG9nOiBcdTZDQTFcdTY3MDlcdTYyNTNcdTVGMDBcdTc2ODRcdTdCMTRcdThCQjBcIik7XG4gICAgfSk7XG5cbiAgICB0aGlzLmJ0bihncmlkLCBcIlx1MjE5M1wiLCBcIlx1NjJDOVx1NTNENlx1NTE2OFx1OTBFOFx1NjU4N1x1N0FFMFwiLCBcImRvd25sb2FkLWNsb3VkXCIsICgpID0+IHtcbiAgICAgIHRoaXMucGx1Z2luLnB1bGxBbGxQb3N0cygpO1xuICAgIH0pO1xuXG4gICAgdGhpcy5idG4oZ3JpZCwgXCJcdTIxQzVcIiwgXCJcdTUxNjhcdTkxQ0ZcdTUzQ0NcdTU0MTFcdTU0MENcdTZCNjVcIiwgXCJyZWZyZXNoLWN3XCIsICgpID0+IHtcbiAgICAgIHRoaXMucGx1Z2luLnN5bmNBbGwoKTtcbiAgICB9KTtcbiAgfVxuXG4gIGJ0bihcbiAgICBwYXJlbnQ6IEhUTUxFbGVtZW50LFxuICAgIGljb246IHN0cmluZyxcbiAgICBsYWJlbDogc3RyaW5nLFxuICAgIF9sdWNpZGU6IHN0cmluZyxcbiAgICBvbkNsaWNrOiAoKSA9PiB2b2lkXG4gICkge1xuICAgIGNvbnN0IGJ0biA9IHBhcmVudC5jcmVhdGVFbChcImJ1dHRvblwiLCB7IGNsczogXCJscXNzLWFjdGlvbi1idG5cIiB9KTtcbiAgICBidG4uY3JlYXRlRWwoXCJzcGFuXCIsIHsgY2xzOiBcImxxc3MtYnRuLWljb25cIiwgdGV4dDogaWNvbiB9KTtcbiAgICBidG4uY3JlYXRlRWwoXCJzcGFuXCIsIHsgY2xzOiBcImxxc3MtYnRuLWxhYmVsXCIsIHRleHQ6IGxhYmVsIH0pO1xuICAgIGJ0bi5vbmNsaWNrID0gKCkgPT4ge1xuICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgb25DbGljaygpO1xuICAgIH07XG4gIH1cblxuICBvbkNsb3NlKCkge1xuICAgIHRoaXMuY29udGVudEVsLmVtcHR5KCk7XG4gIH1cbn1cblxuLy8gPT09PT0gUHVibGlzaCBNb2RhbCAoZmlyc3QtdGltZSBwdXNoLCBubyB6b25lIHNldCkgPT09PT1cblxuY2xhc3MgUHVibGlzaE1vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBwbHVnaW46IExxc3NibG9nUGx1Z2luO1xuICBmaWxlOiBURmlsZTtcblxuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgcGx1Z2luOiBMcXNzYmxvZ1BsdWdpbiwgZmlsZTogVEZpbGUpIHtcbiAgICBzdXBlcihhcHApO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICAgIHRoaXMuZmlsZSA9IGZpbGU7XG4gIH1cblxuICBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29uc3QgZm0gPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZSh0aGlzLmZpbGUpPy5mcm9udG1hdHRlciA/PyB7fTtcblxuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcImgzXCIsIHsgdGV4dDogXCJcdTUzRDFcdTVFMDNcdTUyMzAgbHFzc2Jsb2dcIiB9KTtcblxuICAgIGxldCB0aXRsZSA9IChmbVtcInRpdGxlXCJdIGFzIHN0cmluZykgfHwgdGhpcy5maWxlLmJhc2VuYW1lO1xuICAgIGxldCB6b25lOiBab25lID0gXCJBTklNRVwiO1xuICAgIGxldCB2aXNpYmlsaXR5OiBWaXNpYmlsaXR5ID0gXCJMT0dJTl9PTkxZXCI7XG4gICAgbGV0IHB1Ymxpc2hlZCA9IGZhbHNlO1xuICAgIGxldCB0YWdzID0gcGFyc2VUYWdzKGZtW1wiYmxvZy10YWdzXCJdKS5qb2luKFwiLCBcIik7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuc2V0TmFtZShcIlx1NjgwN1x1OTg5OFwiKVxuICAgICAgLmFkZFRleHQoKHQpID0+XG4gICAgICAgIHQuc2V0VmFsdWUodGl0bGUpLm9uQ2hhbmdlKCh2KSA9PiAodGl0bGUgPSB2KSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuc2V0TmFtZShcIlx1NTIwNlx1NTMzQVwiKVxuICAgICAgLmFkZERyb3Bkb3duKChkKSA9PiB7XG4gICAgICAgIGQuYWRkT3B0aW9uKFwiQU5JTUVcIiwgXCIyXCIpO1xuICAgICAgICBkLmFkZE9wdGlvbihcIlJFQUxcIiwgXCIzXCIpO1xuICAgICAgICBkLmFkZE9wdGlvbihcIkZPVVJcIiwgXCI0XCIpO1xuICAgICAgICBkLnNldFZhbHVlKHpvbmUpLm9uQ2hhbmdlKCh2KSA9PiAoem9uZSA9IHYgYXMgWm9uZSkpO1xuICAgICAgfSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuc2V0TmFtZShcIlx1NTNFRlx1ODlDMVx1NjAyN1wiKVxuICAgICAgLmFkZERyb3Bkb3duKChkKSA9PiB7XG4gICAgICAgIGQuYWRkT3B0aW9uKFwiTE9HSU5fT05MWVwiLCBcIlx1NEVDNVx1NzY3Qlx1NUY1NVx1NzUyOFx1NjIzN1wiKTtcbiAgICAgICAgZC5hZGRPcHRpb24oXCJQVUJMSUNcIiwgXCJcdTUxNkNcdTVGMDBcIik7XG4gICAgICAgIGQuYWRkT3B0aW9uKFwiRlJJRU5EU19PTkxZXCIsIFwiXHU0RUM1XHU1OTdEXHU1M0NCXCIpO1xuICAgICAgICBkLnNldFZhbHVlKHZpc2liaWxpdHkpLm9uQ2hhbmdlKCh2KSA9PiAodmlzaWJpbGl0eSA9IHYgYXMgVmlzaWJpbGl0eSkpO1xuICAgICAgfSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuc2V0TmFtZShcIlx1NjgwN1x1N0I3RVwiKVxuICAgICAgLnNldERlc2MoXCJcdTU5MUFcdTRFMkFcdTY4MDdcdTdCN0VcdTc1MjhcdTkwMTdcdTUzRjdcdTUyMDZcdTk2OTRcIilcbiAgICAgIC5hZGRUZXh0KCh0KSA9PlxuICAgICAgICB0XG4gICAgICAgICAgLnNldFBsYWNlaG9sZGVyKFwidGFnMSwgdGFnMlwiKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0YWdzKVxuICAgICAgICAgIC5vbkNoYW5nZSgodikgPT4gKHRhZ3MgPSB2KSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuc2V0TmFtZShcIlx1N0FDQlx1NTM3M1x1NTNEMVx1NUUwM1wiKVxuICAgICAgLnNldERlc2MoXCJcdTUxNzNcdTk1RURcdTUyMTlcdTRGRERcdTVCNThcdTRFM0FcdTgzNDlcdTdBM0ZcIilcbiAgICAgIC5hZGRUb2dnbGUoKHQpID0+XG4gICAgICAgIHQuc2V0VmFsdWUocHVibGlzaGVkKS5vbkNoYW5nZSgodikgPT4gKHB1Ymxpc2hlZCA9IHYpKVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbCkuYWRkQnV0dG9uKChidG4pID0+XG4gICAgICBidG5cbiAgICAgICAgLnNldEJ1dHRvblRleHQoXCJcdTUzRDFcdTVFMDNcIilcbiAgICAgICAgLnNldEN0YSgpXG4gICAgICAgIC5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICAgICAgY29uc3QgdGFnTGlzdCA9IHRhZ3NcbiAgICAgICAgICAgIC5zcGxpdChcIixcIilcbiAgICAgICAgICAgIC5tYXAoKHQpID0+IHQudHJpbSgpKVxuICAgICAgICAgICAgLmZpbHRlcihCb29sZWFuKTtcbiAgICAgICAgICAvLyBXcml0ZSBtZXRhIHRvIGZyb250bWF0dGVyIGZpcnN0IHNvIGRvUHVzaCBjYW4gcmVhZCBpdFxuICAgICAgICAgIGF3YWl0IHRoaXMuYXBwLmZpbGVNYW5hZ2VyLnByb2Nlc3NGcm9udE1hdHRlcih0aGlzLmZpbGUsIChmKSA9PiB7XG4gICAgICAgICAgICBmW1widGl0bGVcIl0gPSB0aXRsZTtcbiAgICAgICAgICAgIGZbXCJibG9nLXpvbmVcIl0gPSB6b25lO1xuICAgICAgICAgICAgZltcImJsb2ctdmlzaWJpbGl0eVwiXSA9IHZpc2liaWxpdHk7XG4gICAgICAgICAgICBmW1wiYmxvZy1wdWJsaXNoZWRcIl0gPSBwdWJsaXNoZWQ7XG4gICAgICAgICAgICBmW1wiYmxvZy10YWdzXCJdID0gdGFnTGlzdDtcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5kb1B1c2goXG4gICAgICAgICAgICB0aGlzLmZpbGUsXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHRpdGxlLFxuICAgICAgICAgICAgICBcImJsb2ctem9uZVwiOiB6b25lLFxuICAgICAgICAgICAgICBcImJsb2ctdmlzaWJpbGl0eVwiOiB2aXNpYmlsaXR5LFxuICAgICAgICAgICAgICBcImJsb2ctcHVibGlzaGVkXCI6IHB1Ymxpc2hlZCxcbiAgICAgICAgICAgICAgXCJibG9nLXRhZ3NcIjogdGFnTGlzdCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgICAgICB6b25lXG4gICAgICAgICAgKTtcbiAgICAgICAgfSlcbiAgICApO1xuICB9XG5cbiAgb25DbG9zZSgpIHtcbiAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xuICB9XG59XG5cbi8vID09PT09IFNldHRpbmdzIFRhYiA9PT09PVxuXG5jbGFzcyBMcXNzYmxvZ1NldHRpbmdUYWIgZXh0ZW5kcyBQbHVnaW5TZXR0aW5nVGFiIHtcbiAgcGx1Z2luOiBMcXNzYmxvZ1BsdWdpbjtcblxuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgcGx1Z2luOiBMcXNzYmxvZ1BsdWdpbikge1xuICAgIHN1cGVyKGFwcCwgcGx1Z2luKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgfVxuXG4gIGRpc3BsYXkoKSB7XG4gICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcbiAgICBjb250YWluZXJFbC5lbXB0eSgpO1xuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiaDJcIiwgeyB0ZXh0OiBcImxxc3NibG9nIFN5bmNcIiB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJcdTUzNUFcdTVCQTJcdTU3MzBcdTU3NDBcIilcbiAgICAgIC5zZXREZXNjKFwiXHU0RTBEXHU1NDJCXHU2NzJCXHU1QzNFXHU2NTlDXHU3RUJGXHVGRjBDXHU0RjhCXHU1OTgyIGh0dHBzOi8vbHFzc2Jsb2cuc2VydmVibG9nLm5ldFwiKVxuICAgICAgLmFkZFRleHQoKHQpID0+XG4gICAgICAgIHRcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoXCJodHRwczovL2xxc3NibG9nLnNlcnZlYmxvZy5uZXRcIilcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuYmxvZ1VybClcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHYpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmJsb2dVcmwgPSB2LnJlcGxhY2UoL1xcLyQvLCBcIlwiKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlx1NzUyOFx1NjIzN1x1NTQwRFwiKVxuICAgICAgLmFkZFRleHQoKHQpID0+XG4gICAgICAgIHRcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoXCJ5b3VyLXVzZXJuYW1lXCIpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLnVzZXJuYW1lKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodikgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudXNlcm5hbWUgPSB2LnRyaW0oKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlx1NUJDNlx1NzgwMVwiKVxuICAgICAgLmFkZFRleHQoKHQpID0+IHtcbiAgICAgICAgdC5pbnB1dEVsLnR5cGUgPSBcInBhc3N3b3JkXCI7XG4gICAgICAgIHQuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MucGFzc3dvcmQpLm9uQ2hhbmdlKGFzeW5jICh2KSA9PiB7XG4gICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MucGFzc3dvcmQgPSB2O1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlx1NTQwQ1x1NkI2NVx1NjgzOVx1NjU4N1x1NEVGNlx1NTkzOVwiKVxuICAgICAgLnNldERlc2MoXCJcdTY1ODdcdTdBRTBcdTYzMDlcdTUyMDZcdTUzM0FcdTRGRERcdTVCNThcdTUyMzBcdTVCNTBcdTY1ODdcdTRFRjZcdTU5MzlcdUZGMUFibG9nLzIgXHUwMEI3IGJsb2cvMyBcdTAwQjcgYmxvZy80XCIpXG4gICAgICAuYWRkVGV4dCgodCkgPT5cbiAgICAgICAgdFxuICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcihcImJsb2dcIilcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3Muc3luY0ZvbGRlcilcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHYpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnN5bmNGb2xkZXIgPSB2LnRyaW0oKS5yZXBsYWNlKC9cXC8kLywgXCJcIik7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJcdTZENEJcdThCRDVcdThGREVcdTYzQTVcIilcbiAgICAgIC5zZXREZXNjKFwiXHU5QThDXHU4QkMxXHU3NTI4XHU2MjM3XHU1NDBEXHU1NDhDXHU1QkM2XHU3ODAxXHU2NjJGXHU1NDI2XHU2QjYzXHU3ODZFXCIpXG4gICAgICAuYWRkQnV0dG9uKChidG4pID0+XG4gICAgICAgIGJ0bi5zZXRCdXR0b25UZXh0KFwiXHU2RDRCXHU4QkQ1XCIpLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGJ0bi5zZXRCdXR0b25UZXh0KFwiXHU4RkRFXHU2M0E1XHU0RTJEXHUyMDI2XCIpLnNldERpc2FibGVkKHRydWUpO1xuICAgICAgICAgIGNvbnN0IHsgb2ssIHJlYXNvbiB9ID0gYXdhaXQgdGhpcy5wbHVnaW4ubG9naW4oKTtcbiAgICAgICAgICBidG4uc2V0RGlzYWJsZWQoZmFsc2UpO1xuICAgICAgICAgIGlmIChvaykge1xuICAgICAgICAgICAgYnRuLnNldEJ1dHRvblRleHQoXCJcdTI3MTMgXHU2MjEwXHU1MjlGXCIpO1xuICAgICAgICAgICAgbmV3IE5vdGljZShcImxxc3NibG9nOiBcdTc2N0JcdTVGNTVcdTYyMTBcdTUyOUZcIik7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGJ0bi5zZXRCdXR0b25UZXh0KFwiXHUyNzE3IFx1NTkzMVx1OEQyNVwiKTtcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoYGxxc3NibG9nOiBcdTc2N0JcdTVGNTVcdTU5MzFcdThEMjUgXHUyMDE0ICR7cmVhc29ufWAsIDgwMDApO1xuICAgICAgICAgIH1cbiAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IGJ0bi5zZXRCdXR0b25UZXh0KFwiXHU2RDRCXHU4QkQ1XCIpLCA0MDAwKTtcbiAgICAgICAgfSlcbiAgICAgICk7XG4gIH1cbn1cblxuLy8gPT09PT0gVXRpbGl0eSA9PT09PVxuXG5mdW5jdGlvbiBzdHJpcEZyb250bWF0dGVyKGNvbnRlbnQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmICghY29udGVudC5zdGFydHNXaXRoKFwiLS0tXCIpKSByZXR1cm4gY29udGVudDtcbiAgY29uc3QgZW5kID0gY29udGVudC5pbmRleE9mKFwiXFxuLS0tXCIsIDMpO1xuICBpZiAoZW5kID09PSAtMSkgcmV0dXJuIGNvbnRlbnQ7XG4gIHJldHVybiBjb250ZW50LnNsaWNlKGVuZCArIDQpLnRyaW1TdGFydCgpO1xufVxuXG5mdW5jdGlvbiBwYXJzZVRhZ3MocmF3OiB1bmtub3duKTogc3RyaW5nW10ge1xuICBpZiAoIXJhdykgcmV0dXJuIFtdO1xuICBpZiAoQXJyYXkuaXNBcnJheShyYXcpKSByZXR1cm4gKHJhdyBhcyB1bmtub3duW10pLm1hcChTdHJpbmcpLmZpbHRlcihCb29sZWFuKTtcbiAgaWYgKHR5cGVvZiByYXcgPT09IFwic3RyaW5nXCIpXG4gICAgcmV0dXJuIHJhd1xuICAgICAgLnNwbGl0KFwiLFwiKVxuICAgICAgLm1hcCgodCkgPT4gdC50cmltKCkpXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICByZXR1cm4gW107XG59XG5cbmZ1bmN0aW9uIHNhZmVGaWxlbmFtZShuYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbmFtZS5yZXBsYWNlKC9bXFxcXC86Kj9cIjw+fF0vZywgXCItXCIpLnRyaW0oKS5zbGljZSgwLCAxMDApO1xufVxuXG5mdW5jdGlvbiBidWlsZE5vdGVDb250ZW50KHBvc3Q6IEJsb2dQb3N0KTogc3RyaW5nIHtcbiAgY29uc3QgdGFncyA9IHBvc3QudGFncy5tYXAoKHQpID0+IHQudGFnLm5hbWUpO1xuICBjb25zdCBsaW5lcyA9IFtcbiAgICBcIi0tLVwiLFxuICAgIGB0aXRsZTogXCIke3Bvc3QudGl0bGUucmVwbGFjZSgvXCIvZywgJ1xcXFxcIicpfVwiYCxcbiAgICBgYmxvZy1pZDogXCIke3Bvc3QuaWR9XCJgLFxuICAgIGBibG9nLXpvbmU6ICR7cG9zdC56b25lfWAsXG4gICAgYGJsb2ctdmlzaWJpbGl0eTogJHtwb3N0LnZpc2liaWxpdHl9YCxcbiAgICBgYmxvZy1wdWJsaXNoZWQ6ICR7cG9zdC5wdWJsaXNoZWR9YCxcbiAgXTtcbiAgaWYgKHRhZ3MubGVuZ3RoKSB7XG4gICAgbGluZXMucHVzaChgYmxvZy10YWdzOiBbJHt0YWdzLm1hcCgodCkgPT4gYFwiJHt0fVwiYCkuam9pbihcIiwgXCIpfV1gKTtcbiAgfVxuICBsaW5lcy5wdXNoKFxuICAgIGBibG9nLXN5bmNlZC1hdDogXCIke25ldyBEYXRlKCkudG9JU09TdHJpbmcoKX1cImAsXG4gICAgYGJsb2ctdXBkYXRlZC1hdDogXCIke3Bvc3QudXBkYXRlZEF0fVwiYCxcbiAgICBcIi0tLVwiLFxuICAgIFwiXCIsXG4gICAgcG9zdC5jb250ZW50XG4gICk7XG4gIHJldHVybiBsaW5lcy5qb2luKFwiXFxuXCIpO1xufVxuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsc0JBV087QUEyQlAsSUFBTSxtQkFBcUM7QUFBQSxFQUN6QyxTQUFTO0FBQUEsRUFDVCxVQUFVO0FBQUEsRUFDVixVQUFVO0FBQUEsRUFDVixZQUFZO0FBQUEsRUFDWixPQUFPO0FBQ1Q7QUFFQSxJQUFNLGlCQUF1QztBQUFBLEVBQzND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
