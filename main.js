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
    let tags = parseTags(fm["tags"]).join(", ");
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
          f["tags"] = tagList;
        });
        await this.plugin.doPush(
          this.file,
          {
            title,
            "blog-zone": zone,
            "blog-visibility": visibility,
            "blog-published": published,
            "tags": tagList
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7XG4gIEFwcCxcbiAgTW9kYWwsXG4gIE5vdGljZSxcbiAgUGx1Z2luLFxuICBQbHVnaW5TZXR0aW5nVGFiLFxuICBTZXR0aW5nLFxuICBURmlsZSxcbiAgcmVxdWVzdFVybCxcbiAgUmVxdWVzdFVybFBhcmFtLFxuICBSZXF1ZXN0VXJsUmVzcG9uc2UsXG59IGZyb20gXCJvYnNpZGlhblwiO1xuXG4vLyA9PT09PSBUeXBlcyA9PT09PVxuXG50eXBlIFpvbmUgPSBcIkFOSU1FXCIgfCBcIlJFQUxcIiB8IFwiRk9VUlwiO1xudHlwZSBWaXNpYmlsaXR5ID0gXCJQVUJMSUNcIiB8IFwiTE9HSU5fT05MWVwiIHwgXCJGUklFTkRTX09OTFlcIjtcblxuaW50ZXJmYWNlIEJsb2dQb3N0IHtcbiAgaWQ6IHN0cmluZztcbiAgdGl0bGU6IHN0cmluZztcbiAgY29udGVudDogc3RyaW5nO1xuICB6b25lOiBab25lO1xuICB2aXNpYmlsaXR5OiBWaXNpYmlsaXR5O1xuICBwdWJsaXNoZWQ6IGJvb2xlYW47XG4gIGNyZWF0ZWRBdDogc3RyaW5nO1xuICB1cGRhdGVkQXQ6IHN0cmluZztcbiAgdGFnczogeyB0YWc6IHsgbmFtZTogc3RyaW5nIH0gfVtdO1xufVxuXG5pbnRlcmZhY2UgTHFzc2Jsb2dTZXR0aW5ncyB7XG4gIGJsb2dVcmw6IHN0cmluZztcbiAgdXNlcm5hbWU6IHN0cmluZztcbiAgcGFzc3dvcmQ6IHN0cmluZztcbiAgc3luY0ZvbGRlcjogc3RyaW5nO1xuICB0b2tlbjogc3RyaW5nO1xufVxuXG5jb25zdCBERUZBVUxUX1NFVFRJTkdTOiBMcXNzYmxvZ1NldHRpbmdzID0ge1xuICBibG9nVXJsOiBcImh0dHBzOi8vbHFzc2Jsb2cuc2VydmVibG9nLm5ldFwiLFxuICB1c2VybmFtZTogXCJcIixcbiAgcGFzc3dvcmQ6IFwiXCIsXG4gIHN5bmNGb2xkZXI6IFwiYmxvZ1wiLFxuICB0b2tlbjogXCJcIixcbn07XG5cbmNvbnN0IFpPTkVfU1VCRk9MREVSOiBSZWNvcmQ8Wm9uZSwgc3RyaW5nPiA9IHtcbiAgQU5JTUU6IFwiMlwiLFxuICBSRUFMOiBcIjNcIixcbiAgRk9VUjogXCI0XCIsXG59O1xuXG4vLyA9PT09PSBQbHVnaW4gPT09PT1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgTHFzc2Jsb2dQbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xuICBzZXR0aW5nczogTHFzc2Jsb2dTZXR0aW5ncztcblxuICBhc3luYyBvbmxvYWQoKSB7XG4gICAgYXdhaXQgdGhpcy5sb2FkU2V0dGluZ3MoKTtcblxuICAgIC8vIFJpYmJvbiBpY29uXG4gICAgdGhpcy5hZGRSaWJib25JY29uKFwiY2xvdWRcIiwgXCJscXNzYmxvZyBTeW5jXCIsICgpID0+IHtcbiAgICAgIG5ldyBTeW5jTW9kYWwodGhpcy5hcHAsIHRoaXMpLm9wZW4oKTtcbiAgICB9KTtcblxuICAgIC8vIENvbW1hbmRzXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcInB1c2gtY3VycmVudC1ub3RlXCIsXG4gICAgICBuYW1lOiBcIlx1NjNBOFx1OTAwMVx1NUY1M1x1NTI0RFx1N0IxNFx1OEJCMFx1NTIzMFx1NTM1QVx1NUJBMlwiLFxuICAgICAgY2FsbGJhY2s6ICgpID0+IHtcbiAgICAgICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVGaWxlKCk7XG4gICAgICAgIGlmIChmaWxlKSB0aGlzLnB1c2hOb3RlKGZpbGUpO1xuICAgICAgICBlbHNlIG5ldyBOb3RpY2UoXCJscXNzYmxvZzogXHU2Q0ExXHU2NzA5XHU2MjUzXHU1RjAwXHU3Njg0XHU3QjE0XHU4QkIwXCIpO1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJwdWxsLWFsbC1wb3N0c1wiLFxuICAgICAgbmFtZTogXCJcdTRFQ0VcdTUzNUFcdTVCQTJcdTYyQzlcdTUzRDZcdTUxNjhcdTkwRThcdTY1ODdcdTdBRTBcIixcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB0aGlzLnB1bGxBbGxQb3N0cygpLFxuICAgIH0pO1xuXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcInN5bmMtYWxsXCIsXG4gICAgICBuYW1lOiBcIlx1NEUwRVx1NTM1QVx1NUJBMlx1NTE2OFx1OTFDRlx1NTNDQ1x1NTQxMVx1NTQwQ1x1NkI2NVwiLFxuICAgICAgY2FsbGJhY2s6ICgpID0+IHRoaXMuc3luY0FsbCgpLFxuICAgIH0pO1xuXG4gICAgLy8gUmlnaHQtY2xpY2sgY29udGV4dCBtZW51XG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLm9uKFwiZmlsZS1tZW51XCIsIChtZW51LCBmaWxlKSA9PiB7XG4gICAgICAgIGlmIChmaWxlIGluc3RhbmNlb2YgVEZpbGUgJiYgZmlsZS5leHRlbnNpb24gPT09IFwibWRcIikge1xuICAgICAgICAgIG1lbnUuYWRkSXRlbSgoaXRlbSkgPT4ge1xuICAgICAgICAgICAgaXRlbVxuICAgICAgICAgICAgICAuc2V0VGl0bGUoXCJcdTYzQThcdTkwMDFcdTUyMzAgbHFzc2Jsb2dcIilcbiAgICAgICAgICAgICAgLnNldEljb24oXCJ1cGxvYWQtY2xvdWRcIilcbiAgICAgICAgICAgICAgLm9uQ2xpY2soKCkgPT4gdGhpcy5wdXNoTm90ZShmaWxlKSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgKTtcblxuICAgIHRoaXMuYWRkU2V0dGluZ1RhYihuZXcgTHFzc2Jsb2dTZXR0aW5nVGFiKHRoaXMuYXBwLCB0aGlzKSk7XG4gIH1cblxuICBvbnVubG9hZCgpIHt9XG5cbiAgLy8gPT09PT0gQXV0aCA9PT09PVxuXG4gIGFzeW5jIGxvZ2luKCk6IFByb21pc2U8eyBvazogYm9vbGVhbjsgcmVhc29uOiBzdHJpbmcgfT4ge1xuICAgIGlmICghdGhpcy5zZXR0aW5ncy51c2VybmFtZSB8fCAhdGhpcy5zZXR0aW5ncy5wYXNzd29yZCkge1xuICAgICAgcmV0dXJuIHsgb2s6IGZhbHNlLCByZWFzb246IFwiXHU3NTI4XHU2MjM3XHU1NDBEXHU2MjE2XHU1QkM2XHU3ODAxXHU2NzJBXHU1ODZCXHU1MTk5XCIgfTtcbiAgICB9XG4gICAgbGV0IHJlc3A6IFJlcXVlc3RVcmxSZXNwb25zZTtcbiAgICB0cnkge1xuICAgICAgcmVzcCA9IGF3YWl0IHJlcXVlc3RVcmwoe1xuICAgICAgICB1cmw6IGAke3RoaXMuc2V0dGluZ3MuYmxvZ1VybH0vYXBpL2F1dGgvbG9naW5gLFxuICAgICAgICBtZXRob2Q6IFwiUE9TVFwiLFxuICAgICAgICBoZWFkZXJzOiB7IFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiIH0sXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICB1c2VybmFtZTogdGhpcy5zZXR0aW5ncy51c2VybmFtZSxcbiAgICAgICAgICBwYXNzd29yZDogdGhpcy5zZXR0aW5ncy5wYXNzd29yZCxcbiAgICAgICAgfSksXG4gICAgICAgIHRocm93OiBmYWxzZSxcbiAgICAgIH0pO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHJldHVybiB7IG9rOiBmYWxzZSwgcmVhc29uOiBgXHU3RjUxXHU3RURDXHU5NTE5XHU4QkVGOiAke1N0cmluZyhlKX1gIH07XG4gICAgfVxuXG4gICAgaWYgKHJlc3Auc3RhdHVzICE9PSAyMDApIHtcbiAgICAgIGxldCBtc2cgPSBcIlwiO1xuICAgICAgdHJ5IHsgbXNnID0gcmVzcC5qc29uPy5lcnJvciA/PyByZXNwLnRleHQ7IH0gY2F0Y2ggeyBtc2cgPSBTdHJpbmcocmVzcC5zdGF0dXMpOyB9XG4gICAgICByZXR1cm4geyBvazogZmFsc2UsIHJlYXNvbjogYEhUVFAgJHtyZXNwLnN0YXR1c306ICR7bXNnfWAgfTtcbiAgICB9XG5cbiAgICBsZXQgdG9rZW46IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICB0cnkgeyB0b2tlbiA9IHJlc3AuanNvbj8udG9rZW47IH0gY2F0Y2ggeyAvKiBpZ25vcmUgKi8gfVxuICAgIGlmICghdG9rZW4pIHtcbiAgICAgIHJldHVybiB7IG9rOiBmYWxzZSwgcmVhc29uOiBcIlx1NTRDRFx1NUU5NFx1NEUyRFx1NkNBMVx1NjcwOSB0b2tlbiBcdTVCNTdcdTZCQjVcIiB9O1xuICAgIH1cblxuICAgIHRoaXMuc2V0dGluZ3MudG9rZW4gPSB0b2tlbjtcbiAgICBhd2FpdCB0aGlzLnNhdmVTZXR0aW5ncygpO1xuICAgIHJldHVybiB7IG9rOiB0cnVlLCByZWFzb246IFwiXHU3NjdCXHU1RjU1XHU2MjEwXHU1MjlGXCIgfTtcbiAgfVxuXG4gIGdldEhlYWRlcnMoKTogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB7XG4gICAgcmV0dXJuIHtcbiAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgQ29va2llOiBgdG9rZW49JHt0aGlzLnNldHRpbmdzLnRva2VufWAsXG4gICAgfTtcbiAgfVxuXG4gIC8vIEF1dG8tcmV0cnkgd2l0aCByZS1sb2dpbiBvbiA0MDFcbiAgYXN5bmMgYXBpUmVxKFxuICAgIG9wdGlvbnM6IFJlcXVlc3RVcmxQYXJhbSxcbiAgICByZXRyaWVkID0gZmFsc2VcbiAgKTogUHJvbWlzZTxSZXF1ZXN0VXJsUmVzcG9uc2U+IHtcbiAgICBjb25zdCByZXNwID0gYXdhaXQgcmVxdWVzdFVybCh7XG4gICAgICAuLi5vcHRpb25zLFxuICAgICAgaGVhZGVyczogeyAuLi50aGlzLmdldEhlYWRlcnMoKSwgLi4uKG9wdGlvbnMuaGVhZGVycyA/PyB7fSkgfSxcbiAgICAgIHRocm93OiBmYWxzZSxcbiAgICB9KTtcbiAgICBpZiAocmVzcC5zdGF0dXMgPT09IDQwMSAmJiAhcmV0cmllZCkge1xuICAgICAgY29uc3QgeyBvayB9ID0gYXdhaXQgdGhpcy5sb2dpbigpO1xuICAgICAgaWYgKG9rKSByZXR1cm4gdGhpcy5hcGlSZXEob3B0aW9ucywgdHJ1ZSk7XG4gICAgfVxuICAgIHJldHVybiByZXNwO1xuICB9XG5cbiAgLy8gPT09PT0gQVBJID09PT09XG5cbiAgYXN5bmMgZmV0Y2hNeVBvc3RzKCk6IFByb21pc2U8QmxvZ1Bvc3RbXT4ge1xuICAgIGNvbnN0IHJlc3AgPSBhd2FpdCB0aGlzLmFwaVJlcSh7XG4gICAgICB1cmw6IGAke3RoaXMuc2V0dGluZ3MuYmxvZ1VybH0vYXBpL3VzZXIvcG9zdHNgLFxuICAgIH0pO1xuICAgIGlmIChyZXNwLnN0YXR1cyAhPT0gMjAwKSByZXR1cm4gW107XG4gICAgcmV0dXJuIChyZXNwLmpzb24gYXMgeyBwb3N0czogQmxvZ1Bvc3RbXSB9KS5wb3N0cyA/PyBbXTtcbiAgfVxuXG4gIGFzeW5jIGNyZWF0ZVBvc3QoZGF0YToge1xuICAgIHRpdGxlOiBzdHJpbmc7XG4gICAgY29udGVudDogc3RyaW5nO1xuICAgIHpvbmU6IFpvbmU7XG4gICAgdmlzaWJpbGl0eTogVmlzaWJpbGl0eTtcbiAgICBwdWJsaXNoZWQ6IGJvb2xlYW47XG4gICAgdGFnczogc3RyaW5nW107XG4gIH0pOiBQcm9taXNlPEJsb2dQb3N0IHwgbnVsbD4ge1xuICAgIGNvbnN0IHJlc3AgPSBhd2FpdCB0aGlzLmFwaVJlcSh7XG4gICAgICB1cmw6IGAke3RoaXMuc2V0dGluZ3MuYmxvZ1VybH0vYXBpL3Bvc3RzYCxcbiAgICAgIG1ldGhvZDogXCJQT1NUXCIsXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShkYXRhKSxcbiAgICB9KTtcbiAgICBpZiAocmVzcC5zdGF0dXMgIT09IDIwMSkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIChyZXNwLmpzb24gYXMgeyBwb3N0OiBCbG9nUG9zdCB9KS5wb3N0ID8/IG51bGw7XG4gIH1cblxuICBhc3luYyB1cGRhdGVQb3N0KFxuICAgIGlkOiBzdHJpbmcsXG4gICAgZGF0YToge1xuICAgICAgdGl0bGU6IHN0cmluZztcbiAgICAgIGNvbnRlbnQ6IHN0cmluZztcbiAgICAgIHpvbmU6IFpvbmU7XG4gICAgICB2aXNpYmlsaXR5OiBWaXNpYmlsaXR5O1xuICAgICAgcHVibGlzaGVkOiBib29sZWFuO1xuICAgICAgdGFnczogc3RyaW5nW107XG4gICAgfVxuICApOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBjb25zdCByZXNwID0gYXdhaXQgdGhpcy5hcGlSZXEoe1xuICAgICAgdXJsOiBgJHt0aGlzLnNldHRpbmdzLmJsb2dVcmx9L2FwaS9wb3N0cy8ke2lkfWAsXG4gICAgICBtZXRob2Q6IFwiUFVUXCIsXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShkYXRhKSxcbiAgICB9KTtcbiAgICByZXR1cm4gcmVzcC5zdGF0dXMgPT09IDIwMDtcbiAgfVxuXG4gIC8vID09PT09IENvcmUgU3luYyA9PT09PVxuXG4gIC8qKiBQdXNoIGEgc2luZ2xlIG5vdGUgdG8gdGhlIGJsb2cuIFNob3dzIFB1Ymxpc2hNb2RhbCBpZiB6b25lIG5vdCBzZXQuICovXG4gIGFzeW5jIHB1c2hOb3RlKGZpbGU6IFRGaWxlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCF0aGlzLnNldHRpbmdzLnVzZXJuYW1lIHx8ICF0aGlzLnNldHRpbmdzLnBhc3N3b3JkKSB7XG4gICAgICBuZXcgTm90aWNlKFwibHFzc2Jsb2c6IFx1OEJGN1x1NTE0OFx1NTcyOFx1NjNEMlx1NEVGNlx1OEJCRVx1N0Y2RVx1OTFDQ1x1NTg2Qlx1NTE5OVx1NzUyOFx1NjIzN1x1NTQwRFx1NTQ4Q1x1NUJDNlx1NzgwMVwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBmbSA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpPy5mcm9udG1hdHRlciA/PyB7fTtcbiAgICBjb25zdCB6b25lID0gZm1bXCJibG9nLXpvbmVcIl0gYXMgWm9uZSB8IHVuZGVmaW5lZDtcblxuICAgIGlmICghem9uZSkge1xuICAgICAgbmV3IFB1Ymxpc2hNb2RhbCh0aGlzLmFwcCwgdGhpcywgZmlsZSkub3BlbigpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuZG9QdXNoKGZpbGUsIGZtIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBmbVtcImJsb2ctaWRcIl0gYXMgc3RyaW5nIHwgdW5kZWZpbmVkLCB6b25lKTtcbiAgfVxuXG4gIC8qKiBBY3R1YWxseSBwdXNoIHRoZSBub3RlIChjYWxsZWQgYWZ0ZXIgem9uZSBpcyBjb25maXJtZWQpLiAqL1xuICBhc3luYyBkb1B1c2goXG4gICAgZmlsZTogVEZpbGUsXG4gICAgZm06IFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuICAgIGJsb2dJZDogc3RyaW5nIHwgdW5kZWZpbmVkLFxuICAgIHpvbmU6IFpvbmVcbiAgKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgY29uc3QgcmF3Q29udGVudCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LnJlYWQoZmlsZSk7XG4gICAgY29uc3QgYm9keSA9IHN0cmlwRnJvbnRtYXR0ZXIocmF3Q29udGVudCk7XG5cbiAgICBjb25zdCB0aXRsZSA9IChmbVtcInRpdGxlXCJdIGFzIHN0cmluZykgfHwgZmlsZS5iYXNlbmFtZTtcbiAgICBjb25zdCB2aXNpYmlsaXR5ID0gKGZtW1wiYmxvZy12aXNpYmlsaXR5XCJdIGFzIFZpc2liaWxpdHkpIHx8IFwiTE9HSU5fT05MWVwiO1xuICAgIGNvbnN0IHB1Ymxpc2hlZCA9IChmbVtcImJsb2ctcHVibGlzaGVkXCJdIGFzIGJvb2xlYW4pID8/IGZhbHNlO1xuICAgIGNvbnN0IHRhZ3MgPSBwYXJzZVRhZ3MoZm1bXCJ0YWdzXCJdKTtcblxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICBjb25zdCBkYXRhID0geyB0aXRsZSwgY29udGVudDogYm9keSwgem9uZSwgdmlzaWJpbGl0eSwgcHVibGlzaGVkLCB0YWdzIH07XG5cbiAgICBpZiAoYmxvZ0lkKSB7XG4gICAgICBjb25zdCBvayA9IGF3YWl0IHRoaXMudXBkYXRlUG9zdChibG9nSWQsIGRhdGEpO1xuICAgICAgaWYgKCFvaykge1xuICAgICAgICBuZXcgTm90aWNlKGBscXNzYmxvZzogXHUyNzE3IFx1NjZGNFx1NjVCMFx1NTkzMVx1OEQyNSBcdTIwMTRcdTMwMEMke3RpdGxlfVx1MzAwRGApO1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IHBvc3QgPSBhd2FpdCB0aGlzLmNyZWF0ZVBvc3QoZGF0YSk7XG4gICAgICBpZiAoIXBvc3QpIHtcbiAgICAgICAgbmV3IE5vdGljZShgbHFzc2Jsb2c6IFx1MjcxNyBcdTUzRDFcdTVFMDNcdTU5MzFcdThEMjUgXHUyMDE0XHUzMDBDJHt0aXRsZX1cdTMwMERgKTtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgICAgYmxvZ0lkID0gcG9zdC5pZDtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmFwcC5maWxlTWFuYWdlci5wcm9jZXNzRnJvbnRNYXR0ZXIoZmlsZSwgKGYpID0+IHtcbiAgICAgIGZbXCJibG9nLWlkXCJdID0gYmxvZ0lkO1xuICAgICAgZltcImJsb2ctc3luY2VkLWF0XCJdID0gbm93O1xuICAgICAgZltcImJsb2ctdXBkYXRlZC1hdFwiXSA9IG5vdztcbiAgICB9KTtcblxuICAgIG5ldyBOb3RpY2UoYGxxc3NibG9nOiBcdTI3MTMgXHU1REYyXHU2M0E4XHU5MDAxXHUzMDBDJHt0aXRsZX1cdTMwMERgKTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIC8qKiBQdWxsIGFsbCB1c2VyJ3MgcG9zdHMgZnJvbSB0aGUgYmxvZyBpbnRvIHRoZSBzeW5jIGZvbGRlci4gKi9cbiAgYXN5bmMgcHVsbEFsbFBvc3RzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghdGhpcy5zZXR0aW5ncy51c2VybmFtZSB8fCAhdGhpcy5zZXR0aW5ncy5wYXNzd29yZCkge1xuICAgICAgbmV3IE5vdGljZShcImxxc3NibG9nOiBcdThCRjdcdTUxNDhcdTU3MjhcdTYzRDJcdTRFRjZcdThCQkVcdTdGNkVcdTkxQ0NcdTU4NkJcdTUxOTlcdTc1MjhcdTYyMzdcdTU0MERcdTU0OENcdTVCQzZcdTc4MDFcIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgbmV3IE5vdGljZShcImxxc3NibG9nOiBcdTZCNjNcdTU3MjhcdTYyQzlcdTUzRDZcdTIwMjZcIik7XG4gICAgY29uc3QgcG9zdHMgPSBhd2FpdCB0aGlzLmZldGNoTXlQb3N0cygpO1xuXG4gICAgaWYgKCFwb3N0cy5sZW5ndGgpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJscXNzYmxvZzogXHU1MzVBXHU1QkEyXHU0RTBBXHU4RkQ4XHU2Q0ExXHU2NzA5XHU2NTg3XHU3QUUwXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuZW5zdXJlU3luY0ZvbGRlcigpO1xuXG4gICAgbGV0IHB1bGxlZCA9IDAsIHNraXBwZWQgPSAwO1xuXG4gICAgZm9yIChjb25zdCBwb3N0IG9mIHBvc3RzKSB7XG4gICAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuZmluZEZpbGVCeUJsb2dJZChwb3N0LmlkKTtcbiAgICAgIGNvbnN0IHN5bmNlZEF0ID0gZXhpc3RpbmdcbiAgICAgICAgPyAodGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUoZXhpc3RpbmcpPy5mcm9udG1hdHRlcj8uW1xuICAgICAgICAgICAgXCJibG9nLXN5bmNlZC1hdFwiXG4gICAgICAgICAgXSBhcyBzdHJpbmcgfCB1bmRlZmluZWQpXG4gICAgICAgIDogdW5kZWZpbmVkO1xuXG4gICAgICBjb25zdCBibG9nVXBkYXRlZEF0ID0gbmV3IERhdGUocG9zdC51cGRhdGVkQXQpLmdldFRpbWUoKTtcbiAgICAgIGNvbnN0IGxhc3RTeW5jVGltZSA9IHN5bmNlZEF0ID8gbmV3IERhdGUoc3luY2VkQXQpLmdldFRpbWUoKSA6IDA7XG5cbiAgICAgIGlmIChleGlzdGluZyAmJiBibG9nVXBkYXRlZEF0IDw9IGxhc3RTeW5jVGltZSkge1xuICAgICAgICBza2lwcGVkKys7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBjb250ZW50ID0gYnVpbGROb3RlQ29udGVudChwb3N0KTtcbiAgICAgIGlmIChleGlzdGluZykge1xuICAgICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5tb2RpZnkoZXhpc3RpbmcsIGNvbnRlbnQpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3QgcGF0aCA9IGF3YWl0IHRoaXMudW5pcXVlUGF0aChcbiAgICAgICAgICBgJHt0aGlzLnpvbmVGb2xkZXIocG9zdC56b25lKX0vJHtzYWZlRmlsZW5hbWUocG9zdC50aXRsZSkgfHwgcG9zdC5pZH0ubWRgXG4gICAgICAgICk7XG4gICAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNyZWF0ZShwYXRoLCBjb250ZW50KTtcbiAgICAgIH1cbiAgICAgIHB1bGxlZCsrO1xuICAgIH1cblxuICAgIG5ldyBOb3RpY2UoYGxxc3NibG9nOiBcdTYyQzlcdTUzRDZcdTVCOENcdTYyMTAgXHUyMDE0XHUyMDE0IFx1NjZGNFx1NjVCMCAke3B1bGxlZH0gXHU3QkM3XHVGRjBDXHU4REYzXHU4RkM3ICR7c2tpcHBlZH0gXHU3QkM3YCk7XG4gIH1cblxuICAvKiogRnVsbCBiaWRpcmVjdGlvbmFsIHN5bmMuICovXG4gIGFzeW5jIHN5bmNBbGwoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCF0aGlzLnNldHRpbmdzLnVzZXJuYW1lIHx8ICF0aGlzLnNldHRpbmdzLnBhc3N3b3JkKSB7XG4gICAgICBuZXcgTm90aWNlKFwibHFzc2Jsb2c6IFx1OEJGN1x1NTE0OFx1NTcyOFx1NjNEMlx1NEVGNlx1OEJCRVx1N0Y2RVx1OTFDQ1x1NTg2Qlx1NTE5OVx1NzUyOFx1NjIzN1x1NTQwRFx1NTQ4Q1x1NUJDNlx1NzgwMVwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBuZXcgTm90aWNlKFwibHFzc2Jsb2c6IFx1NUYwMFx1NTlDQlx1NTNDQ1x1NTQxMVx1NTQwQ1x1NkI2NVx1MjAyNlwiKTtcbiAgICBjb25zdCBwb3N0cyA9IGF3YWl0IHRoaXMuZmV0Y2hNeVBvc3RzKCk7XG4gICAgY29uc3QgYmxvZ01hcCA9IG5ldyBNYXA8c3RyaW5nLCBCbG9nUG9zdD4ocG9zdHMubWFwKChwKSA9PiBbcC5pZCwgcF0pKTtcblxuICAgIGF3YWl0IHRoaXMuZW5zdXJlU3luY0ZvbGRlcigpO1xuXG4gICAgbGV0IHB1c2hlZCA9IDAsIHB1bGxlZCA9IDAsIGNvbmZsaWN0cyA9IDAsIGNyZWF0ZWQgPSAwO1xuICAgIGNvbnN0IHByb2Nlc3NlZElkcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4gICAgLy8gUHJvY2VzcyBhbGwgbG9jYWwgZmlsZXNcbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgdGhpcy5hcHAudmF1bHQuZ2V0TWFya2Rvd25GaWxlcygpKSB7XG4gICAgICBjb25zdCBmbSA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpPy5mcm9udG1hdHRlciA/PyB7fTtcbiAgICAgIGNvbnN0IGJsb2dJZCA9IGZtW1wiYmxvZy1pZFwiXSBhcyBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gICAgICBjb25zdCB6b25lID0gZm1bXCJibG9nLXpvbmVcIl0gYXMgWm9uZSB8IHVuZGVmaW5lZDtcblxuICAgICAgaWYgKCFibG9nSWQpIHtcbiAgICAgICAgLy8gTmV3IGxvY2FsIGZpbGUgaW4gYSB6b25lIHN1YmZvbGRlciB3aXRoIGJsb2ctem9uZSBzZXQgXHUyMTkyIHB1c2ggdG8gY3JlYXRlXG4gICAgICAgIGNvbnN0IGluWm9uZUZvbGRlciA9XG4gICAgICAgICAgem9uZSAmJiBmaWxlLnBhdGguc3RhcnRzV2l0aCh0aGlzLnpvbmVGb2xkZXIoem9uZSkgKyBcIi9cIik7XG4gICAgICAgIGlmIChpblpvbmVGb2xkZXIpIHtcbiAgICAgICAgICBjb25zdCBvayA9IGF3YWl0IHRoaXMuZG9QdXNoKGZpbGUsIGZtIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+LCB1bmRlZmluZWQsIHpvbmUhKTtcbiAgICAgICAgICBpZiAob2spIGNyZWF0ZWQrKztcbiAgICAgICAgfVxuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgcHJvY2Vzc2VkSWRzLmFkZChibG9nSWQpO1xuICAgICAgY29uc3QgYmxvZ1Bvc3QgPSBibG9nTWFwLmdldChibG9nSWQpO1xuICAgICAgaWYgKCFibG9nUG9zdCkgY29udGludWU7IC8vIHBvc3QgZGVsZXRlZCBvbiBibG9nIHNpZGUgXHUyMDE0IHNraXBcblxuICAgICAgY29uc3Qgc3luY2VkQXQgPSBmbVtcImJsb2ctc3luY2VkLWF0XCJdIGFzIHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICAgIGNvbnN0IGxhc3RTeW5jVGltZSA9IHN5bmNlZEF0ID8gbmV3IERhdGUoc3luY2VkQXQpLmdldFRpbWUoKSA6IDA7XG4gICAgICBjb25zdCBibG9nVXBkYXRlZEF0ID0gbmV3IERhdGUoYmxvZ1Bvc3QudXBkYXRlZEF0KS5nZXRUaW1lKCk7XG4gICAgICBjb25zdCBsb2NhbFVwZGF0ZWRBdCA9IGZpbGUuc3RhdC5tdGltZTtcbiAgICAgIGNvbnN0IEJVRkZFUiA9IDVfMDAwOyAvLyA1cyB0b2xlcmFuY2UgZm9yIGNsb2NrIHNrZXdcblxuICAgICAgY29uc3QgYmxvZ05ld2VyID0gYmxvZ1VwZGF0ZWRBdCA+IGxhc3RTeW5jVGltZSArIEJVRkZFUjtcbiAgICAgIGNvbnN0IGxvY2FsTmV3ZXIgPSBsb2NhbFVwZGF0ZWRBdCA+IGxhc3RTeW5jVGltZSArIEJVRkZFUjtcblxuICAgICAgaWYgKGJsb2dOZXdlciAmJiBsb2NhbE5ld2VyKSB7XG4gICAgICAgIGNvbmZsaWN0cysrO1xuICAgICAgICBuZXcgTm90aWNlKFxuICAgICAgICAgIGBscXNzYmxvZzogXHUyNkEwIFx1NTFCMlx1N0E4MSBcdTIwMTRcdTMwMEMke2ZpbGUuYmFzZW5hbWV9XHUzMDBEXHU2NzJDXHU1NzMwXHU1NDhDXHU4RkRDXHU3QUVGXHU5MEZEXHU2NzA5XHU2NkY0XHU2NTM5XHVGRjBDXHU1REYyXHU4REYzXHU4RkM3XHVGRjBDXHU4QkY3XHU2MjRCXHU1MkE4XHU1OTA0XHU3NDA2YFxuICAgICAgICApO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgaWYgKGxvY2FsTmV3ZXIpIHtcbiAgICAgICAgY29uc3Qgb2sgPSBhd2FpdCB0aGlzLmRvUHVzaChcbiAgICAgICAgICBmaWxlLFxuICAgICAgICAgIGZtIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuICAgICAgICAgIGJsb2dJZCxcbiAgICAgICAgICB6b25lID8/IChibG9nUG9zdC56b25lIGFzIFpvbmUpXG4gICAgICAgICk7XG4gICAgICAgIGlmIChvaykgcHVzaGVkKys7XG4gICAgICB9IGVsc2UgaWYgKGJsb2dOZXdlcikge1xuICAgICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5tb2RpZnkoZmlsZSwgYnVpbGROb3RlQ29udGVudChibG9nUG9zdCkpO1xuICAgICAgICBwdWxsZWQrKztcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBQdWxsIHBvc3RzIGZyb20gYmxvZyB0aGF0IGRvbid0IGV4aXN0IGxvY2FsbHkgeWV0XG4gICAgZm9yIChjb25zdCBwb3N0IG9mIHBvc3RzKSB7XG4gICAgICBpZiAocHJvY2Vzc2VkSWRzLmhhcyhwb3N0LmlkKSkgY29udGludWU7XG4gICAgICBjb25zdCBwYXRoID0gYXdhaXQgdGhpcy51bmlxdWVQYXRoKFxuICAgICAgICBgJHt0aGlzLnpvbmVGb2xkZXIocG9zdC56b25lKX0vJHtzYWZlRmlsZW5hbWUocG9zdC50aXRsZSkgfHwgcG9zdC5pZH0ubWRgXG4gICAgICApO1xuICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuY3JlYXRlKHBhdGgsIGJ1aWxkTm90ZUNvbnRlbnQocG9zdCkpO1xuICAgICAgcHVsbGVkKys7XG4gICAgfVxuXG4gICAgY29uc3Qgc3VtbWFyeSA9IFtcbiAgICAgIGBcdTIxOTEgXHU2M0E4XHU5MDAxICR7cHVzaGVkICsgY3JlYXRlZH1gLFxuICAgICAgYFx1MjE5MyBcdTYyQzlcdTUzRDYgJHtwdWxsZWR9YCxcbiAgICAgIGNvbmZsaWN0cyA/IGBcdTI2QTAgJHtjb25mbGljdHN9IFx1NEUyQVx1NTFCMlx1N0E4MWAgOiBcIlwiLFxuICAgIF1cbiAgICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICAgIC5qb2luKFwiICAgXCIpO1xuXG4gICAgbmV3IE5vdGljZShgbHFzc2Jsb2c6IFx1NTQwQ1x1NkI2NVx1NUI4Q1x1NjIxMCBcdTIwMTRcdTIwMTQgJHtzdW1tYXJ5fWApO1xuICB9XG5cbiAgLy8gPT09PT0gSGVscGVycyA9PT09PVxuXG4gIGZpbmRGaWxlQnlCbG9nSWQoYmxvZ0lkOiBzdHJpbmcpOiBURmlsZSB8IG51bGwge1xuICAgIGZvciAoY29uc3QgZmlsZSBvZiB0aGlzLmFwcC52YXVsdC5nZXRNYXJrZG93bkZpbGVzKCkpIHtcbiAgICAgIGNvbnN0IGZtID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUoZmlsZSk/LmZyb250bWF0dGVyO1xuICAgICAgaWYgKGZtPy5bXCJibG9nLWlkXCJdID09PSBibG9nSWQpIHJldHVybiBmaWxlO1xuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHpvbmVGb2xkZXIoem9uZTogWm9uZSk6IHN0cmluZyB7XG4gICAgcmV0dXJuIGAke3RoaXMuc2V0dGluZ3Muc3luY0ZvbGRlcn0vJHtaT05FX1NVQkZPTERFUlt6b25lXX1gO1xuICB9XG5cbiAgYXN5bmMgZW5zdXJlU3luY0ZvbGRlcigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCByb290ID0gdGhpcy5zZXR0aW5ncy5zeW5jRm9sZGVyO1xuICAgIGlmICghKGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIuZXhpc3RzKHJvb3QpKSkge1xuICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuY3JlYXRlRm9sZGVyKHJvb3QpO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IHN1YiBvZiBPYmplY3QudmFsdWVzKFpPTkVfU1VCRk9MREVSKSkge1xuICAgICAgY29uc3QgcGF0aCA9IGAke3Jvb3R9LyR7c3VifWA7XG4gICAgICBpZiAoIShhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLmV4aXN0cyhwYXRoKSkpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuY3JlYXRlRm9sZGVyKHBhdGgpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHVuaXF1ZVBhdGgocGF0aDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICBpZiAoIShhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLmV4aXN0cyhwYXRoKSkpIHJldHVybiBwYXRoO1xuICAgIGNvbnN0IGJhc2UgPSBwYXRoLnJlcGxhY2UoL1xcLm1kJC8sIFwiXCIpO1xuICAgIGxldCBpID0gMTtcbiAgICB3aGlsZSAoYXdhaXQgdGhpcy5hcHAudmF1bHQuYWRhcHRlci5leGlzdHMoYCR7YmFzZX0tJHtpfS5tZGApKSBpKys7XG4gICAgcmV0dXJuIGAke2Jhc2V9LSR7aX0ubWRgO1xuICB9XG5cbiAgYXN5bmMgbG9hZFNldHRpbmdzKCkge1xuICAgIHRoaXMuc2V0dGluZ3MgPSBPYmplY3QuYXNzaWduKHt9LCBERUZBVUxUX1NFVFRJTkdTLCBhd2FpdCB0aGlzLmxvYWREYXRhKCkpO1xuICB9XG5cbiAgYXN5bmMgc2F2ZVNldHRpbmdzKCkge1xuICAgIGF3YWl0IHRoaXMuc2F2ZURhdGEodGhpcy5zZXR0aW5ncyk7XG4gIH1cbn1cblxuLy8gPT09PT0gU3luYyBNb2RhbCAoUmliYm9uIGNsaWNrKSA9PT09PVxuXG5jbGFzcyBTeW5jTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIHBsdWdpbjogTHFzc2Jsb2dQbHVnaW47XG5cbiAgY29uc3RydWN0b3IoYXBwOiBBcHAsIHBsdWdpbjogTHFzc2Jsb2dQbHVnaW4pIHtcbiAgICBzdXBlcihhcHApO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICB9XG5cbiAgb25PcGVuKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5hZGRDbGFzcyhcImxxc3MtbW9kYWxcIik7XG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwiaDNcIiwgeyB0ZXh0OiBcImxxc3NibG9nIFN5bmNcIiB9KTtcblxuICAgIGNvbnN0IGdyaWQgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcImxxc3MtZ3JpZFwiIH0pO1xuXG4gICAgdGhpcy5idG4oZ3JpZCwgXCJcdTIxOTFcIiwgXCJcdTYzQThcdTkwMDFcdTVGNTNcdTUyNERcdTdCMTRcdThCQjBcIiwgXCJ1cGxvYWQtY2xvdWRcIiwgKCkgPT4ge1xuICAgICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVGaWxlKCk7XG4gICAgICBpZiAoZmlsZSkgdGhpcy5wbHVnaW4ucHVzaE5vdGUoZmlsZSk7XG4gICAgICBlbHNlIG5ldyBOb3RpY2UoXCJscXNzYmxvZzogXHU2Q0ExXHU2NzA5XHU2MjUzXHU1RjAwXHU3Njg0XHU3QjE0XHU4QkIwXCIpO1xuICAgIH0pO1xuXG4gICAgdGhpcy5idG4oZ3JpZCwgXCJcdTIxOTNcIiwgXCJcdTYyQzlcdTUzRDZcdTUxNjhcdTkwRThcdTY1ODdcdTdBRTBcIiwgXCJkb3dubG9hZC1jbG91ZFwiLCAoKSA9PiB7XG4gICAgICB0aGlzLnBsdWdpbi5wdWxsQWxsUG9zdHMoKTtcbiAgICB9KTtcblxuICAgIHRoaXMuYnRuKGdyaWQsIFwiXHUyMUM1XCIsIFwiXHU1MTY4XHU5MUNGXHU1M0NDXHU1NDExXHU1NDBDXHU2QjY1XCIsIFwicmVmcmVzaC1jd1wiLCAoKSA9PiB7XG4gICAgICB0aGlzLnBsdWdpbi5zeW5jQWxsKCk7XG4gICAgfSk7XG4gIH1cblxuICBidG4oXG4gICAgcGFyZW50OiBIVE1MRWxlbWVudCxcbiAgICBpY29uOiBzdHJpbmcsXG4gICAgbGFiZWw6IHN0cmluZyxcbiAgICBfbHVjaWRlOiBzdHJpbmcsXG4gICAgb25DbGljazogKCkgPT4gdm9pZFxuICApIHtcbiAgICBjb25zdCBidG4gPSBwYXJlbnQuY3JlYXRlRWwoXCJidXR0b25cIiwgeyBjbHM6IFwibHFzcy1hY3Rpb24tYnRuXCIgfSk7XG4gICAgYnRuLmNyZWF0ZUVsKFwic3BhblwiLCB7IGNsczogXCJscXNzLWJ0bi1pY29uXCIsIHRleHQ6IGljb24gfSk7XG4gICAgYnRuLmNyZWF0ZUVsKFwic3BhblwiLCB7IGNsczogXCJscXNzLWJ0bi1sYWJlbFwiLCB0ZXh0OiBsYWJlbCB9KTtcbiAgICBidG4ub25jbGljayA9ICgpID0+IHtcbiAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgIG9uQ2xpY2soKTtcbiAgICB9O1xuICB9XG5cbiAgb25DbG9zZSgpIHtcbiAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xuICB9XG59XG5cbi8vID09PT09IFB1Ymxpc2ggTW9kYWwgKGZpcnN0LXRpbWUgcHVzaCwgbm8gem9uZSBzZXQpID09PT09XG5cbmNsYXNzIFB1Ymxpc2hNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgcGx1Z2luOiBMcXNzYmxvZ1BsdWdpbjtcbiAgZmlsZTogVEZpbGU7XG5cbiAgY29uc3RydWN0b3IoYXBwOiBBcHAsIHBsdWdpbjogTHFzc2Jsb2dQbHVnaW4sIGZpbGU6IFRGaWxlKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgICB0aGlzLmZpbGUgPSBmaWxlO1xuICB9XG5cbiAgb25PcGVuKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnN0IGZtID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUodGhpcy5maWxlKT8uZnJvbnRtYXR0ZXIgPz8ge307XG5cbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJoM1wiLCB7IHRleHQ6IFwiXHU1M0QxXHU1RTAzXHU1MjMwIGxxc3NibG9nXCIgfSk7XG5cbiAgICBsZXQgdGl0bGUgPSAoZm1bXCJ0aXRsZVwiXSBhcyBzdHJpbmcpIHx8IHRoaXMuZmlsZS5iYXNlbmFtZTtcbiAgICBsZXQgem9uZTogWm9uZSA9IFwiQU5JTUVcIjtcbiAgICBsZXQgdmlzaWJpbGl0eTogVmlzaWJpbGl0eSA9IFwiTE9HSU5fT05MWVwiO1xuICAgIGxldCBwdWJsaXNoZWQgPSBmYWxzZTtcbiAgICBsZXQgdGFncyA9IHBhcnNlVGFncyhmbVtcInRhZ3NcIl0pLmpvaW4oXCIsIFwiKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5zZXROYW1lKFwiXHU2ODA3XHU5ODk4XCIpXG4gICAgICAuYWRkVGV4dCgodCkgPT5cbiAgICAgICAgdC5zZXRWYWx1ZSh0aXRsZSkub25DaGFuZ2UoKHYpID0+ICh0aXRsZSA9IHYpKVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5zZXROYW1lKFwiXHU1MjA2XHU1MzNBXCIpXG4gICAgICAuYWRkRHJvcGRvd24oKGQpID0+IHtcbiAgICAgICAgZC5hZGRPcHRpb24oXCJBTklNRVwiLCBcIjJcIik7XG4gICAgICAgIGQuYWRkT3B0aW9uKFwiUkVBTFwiLCBcIjNcIik7XG4gICAgICAgIGQuYWRkT3B0aW9uKFwiRk9VUlwiLCBcIjRcIik7XG4gICAgICAgIGQuc2V0VmFsdWUoem9uZSkub25DaGFuZ2UoKHYpID0+ICh6b25lID0gdiBhcyBab25lKSk7XG4gICAgICB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5zZXROYW1lKFwiXHU1M0VGXHU4OUMxXHU2MDI3XCIpXG4gICAgICAuYWRkRHJvcGRvd24oKGQpID0+IHtcbiAgICAgICAgZC5hZGRPcHRpb24oXCJMT0dJTl9PTkxZXCIsIFwiXHU0RUM1XHU3NjdCXHU1RjU1XHU3NTI4XHU2MjM3XCIpO1xuICAgICAgICBkLmFkZE9wdGlvbihcIlBVQkxJQ1wiLCBcIlx1NTE2Q1x1NUYwMFwiKTtcbiAgICAgICAgZC5hZGRPcHRpb24oXCJGUklFTkRTX09OTFlcIiwgXCJcdTRFQzVcdTU5N0RcdTUzQ0JcIik7XG4gICAgICAgIGQuc2V0VmFsdWUodmlzaWJpbGl0eSkub25DaGFuZ2UoKHYpID0+ICh2aXNpYmlsaXR5ID0gdiBhcyBWaXNpYmlsaXR5KSk7XG4gICAgICB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5zZXROYW1lKFwiXHU2ODA3XHU3QjdFXCIpXG4gICAgICAuc2V0RGVzYyhcIlx1NTkxQVx1NEUyQVx1NjgwN1x1N0I3RVx1NzUyOFx1OTAxN1x1NTNGN1x1NTIwNlx1OTY5NFwiKVxuICAgICAgLmFkZFRleHQoKHQpID0+XG4gICAgICAgIHRcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoXCJ0YWcxLCB0YWcyXCIpXG4gICAgICAgICAgLnNldFZhbHVlKHRhZ3MpXG4gICAgICAgICAgLm9uQ2hhbmdlKCh2KSA9PiAodGFncyA9IHYpKVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5zZXROYW1lKFwiXHU3QUNCXHU1MzczXHU1M0QxXHU1RTAzXCIpXG4gICAgICAuc2V0RGVzYyhcIlx1NTE3M1x1OTVFRFx1NTIxOVx1NEZERFx1NUI1OFx1NEUzQVx1ODM0OVx1N0EzRlwiKVxuICAgICAgLmFkZFRvZ2dsZSgodCkgPT5cbiAgICAgICAgdC5zZXRWYWx1ZShwdWJsaXNoZWQpLm9uQ2hhbmdlKCh2KSA9PiAocHVibGlzaGVkID0gdikpXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKS5hZGRCdXR0b24oKGJ0bikgPT5cbiAgICAgIGJ0blxuICAgICAgICAuc2V0QnV0dG9uVGV4dChcIlx1NTNEMVx1NUUwM1wiKVxuICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgICAgICBjb25zdCB0YWdMaXN0ID0gdGFnc1xuICAgICAgICAgICAgLnNwbGl0KFwiLFwiKVxuICAgICAgICAgICAgLm1hcCgodCkgPT4gdC50cmltKCkpXG4gICAgICAgICAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICAgICAgICAgIC8vIFdyaXRlIG1ldGEgdG8gZnJvbnRtYXR0ZXIgZmlyc3Qgc28gZG9QdXNoIGNhbiByZWFkIGl0XG4gICAgICAgICAgYXdhaXQgdGhpcy5hcHAuZmlsZU1hbmFnZXIucHJvY2Vzc0Zyb250TWF0dGVyKHRoaXMuZmlsZSwgKGYpID0+IHtcbiAgICAgICAgICAgIGZbXCJ0aXRsZVwiXSA9IHRpdGxlO1xuICAgICAgICAgICAgZltcImJsb2ctem9uZVwiXSA9IHpvbmU7XG4gICAgICAgICAgICBmW1wiYmxvZy12aXNpYmlsaXR5XCJdID0gdmlzaWJpbGl0eTtcbiAgICAgICAgICAgIGZbXCJibG9nLXB1Ymxpc2hlZFwiXSA9IHB1Ymxpc2hlZDtcbiAgICAgICAgICAgIGZbXCJ0YWdzXCJdID0gdGFnTGlzdDtcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5kb1B1c2goXG4gICAgICAgICAgICB0aGlzLmZpbGUsXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHRpdGxlLFxuICAgICAgICAgICAgICBcImJsb2ctem9uZVwiOiB6b25lLFxuICAgICAgICAgICAgICBcImJsb2ctdmlzaWJpbGl0eVwiOiB2aXNpYmlsaXR5LFxuICAgICAgICAgICAgICBcImJsb2ctcHVibGlzaGVkXCI6IHB1Ymxpc2hlZCxcbiAgICAgICAgICAgICAgXCJ0YWdzXCI6IHRhZ0xpc3QsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICAgICAgem9uZVxuICAgICAgICAgICk7XG4gICAgICAgIH0pXG4gICAgKTtcbiAgfVxuXG4gIG9uQ2xvc2UoKSB7XG4gICAgdGhpcy5jb250ZW50RWwuZW1wdHkoKTtcbiAgfVxufVxuXG4vLyA9PT09PSBTZXR0aW5ncyBUYWIgPT09PT1cblxuY2xhc3MgTHFzc2Jsb2dTZXR0aW5nVGFiIGV4dGVuZHMgUGx1Z2luU2V0dGluZ1RhYiB7XG4gIHBsdWdpbjogTHFzc2Jsb2dQbHVnaW47XG5cbiAgY29uc3RydWN0b3IoYXBwOiBBcHAsIHBsdWdpbjogTHFzc2Jsb2dQbHVnaW4pIHtcbiAgICBzdXBlcihhcHAsIHBsdWdpbik7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gIH1cblxuICBkaXNwbGF5KCkge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgY29udGFpbmVyRWwuZW1wdHkoKTtcbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcImgyXCIsIHsgdGV4dDogXCJscXNzYmxvZyBTeW5jXCIgfSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiXHU1MzVBXHU1QkEyXHU1NzMwXHU1NzQwXCIpXG4gICAgICAuc2V0RGVzYyhcIlx1NEUwRFx1NTQyQlx1NjcyQlx1NUMzRVx1NjU5Q1x1N0VCRlx1RkYwQ1x1NEY4Qlx1NTk4MiBodHRwczovL2xxc3NibG9nLnNlcnZlYmxvZy5uZXRcIilcbiAgICAgIC5hZGRUZXh0KCh0KSA9PlxuICAgICAgICB0XG4gICAgICAgICAgLnNldFBsYWNlaG9sZGVyKFwiaHR0cHM6Ly9scXNzYmxvZy5zZXJ2ZWJsb2cubmV0XCIpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmJsb2dVcmwpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2KSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ibG9nVXJsID0gdi5yZXBsYWNlKC9cXC8kLywgXCJcIik7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJcdTc1MjhcdTYyMzdcdTU0MERcIilcbiAgICAgIC5hZGRUZXh0KCh0KSA9PlxuICAgICAgICB0XG4gICAgICAgICAgLnNldFBsYWNlaG9sZGVyKFwieW91ci11c2VybmFtZVwiKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy51c2VybmFtZSlcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHYpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnVzZXJuYW1lID0gdi50cmltKCk7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJcdTVCQzZcdTc4MDFcIilcbiAgICAgIC5hZGRUZXh0KCh0KSA9PiB7XG4gICAgICAgIHQuaW5wdXRFbC50eXBlID0gXCJwYXNzd29yZFwiO1xuICAgICAgICB0LnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLnBhc3N3b3JkKS5vbkNoYW5nZShhc3luYyAodikgPT4ge1xuICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnBhc3N3b3JkID0gdjtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJcdTU0MENcdTZCNjVcdTY4MzlcdTY1ODdcdTRFRjZcdTU5MzlcIilcbiAgICAgIC5zZXREZXNjKFwiXHU2NTg3XHU3QUUwXHU2MzA5XHU1MjA2XHU1MzNBXHU0RkREXHU1QjU4XHU1MjMwXHU1QjUwXHU2NTg3XHU0RUY2XHU1OTM5XHVGRjFBYmxvZy8yIFx1MDBCNyBibG9nLzMgXHUwMEI3IGJsb2cvNFwiKVxuICAgICAgLmFkZFRleHQoKHQpID0+XG4gICAgICAgIHRcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoXCJibG9nXCIpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLnN5bmNGb2xkZXIpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2KSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5zeW5jRm9sZGVyID0gdi50cmltKCkucmVwbGFjZSgvXFwvJC8sIFwiXCIpO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiXHU2RDRCXHU4QkQ1XHU4RkRFXHU2M0E1XCIpXG4gICAgICAuc2V0RGVzYyhcIlx1OUE4Q1x1OEJDMVx1NzUyOFx1NjIzN1x1NTQwRFx1NTQ4Q1x1NUJDNlx1NzgwMVx1NjYyRlx1NTQyNlx1NkI2M1x1Nzg2RVwiKVxuICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PlxuICAgICAgICBidG4uc2V0QnV0dG9uVGV4dChcIlx1NkQ0Qlx1OEJENVwiKS5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICBidG4uc2V0QnV0dG9uVGV4dChcIlx1OEZERVx1NjNBNVx1NEUyRFx1MjAyNlwiKS5zZXREaXNhYmxlZCh0cnVlKTtcbiAgICAgICAgICBjb25zdCB7IG9rLCByZWFzb24gfSA9IGF3YWl0IHRoaXMucGx1Z2luLmxvZ2luKCk7XG4gICAgICAgICAgYnRuLnNldERpc2FibGVkKGZhbHNlKTtcbiAgICAgICAgICBpZiAob2spIHtcbiAgICAgICAgICAgIGJ0bi5zZXRCdXR0b25UZXh0KFwiXHUyNzEzIFx1NjIxMFx1NTI5RlwiKTtcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoXCJscXNzYmxvZzogXHU3NjdCXHU1RjU1XHU2MjEwXHU1MjlGXCIpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBidG4uc2V0QnV0dG9uVGV4dChcIlx1MjcxNyBcdTU5MzFcdThEMjVcIik7XG4gICAgICAgICAgICBuZXcgTm90aWNlKGBscXNzYmxvZzogXHU3NjdCXHU1RjU1XHU1OTMxXHU4RDI1IFx1MjAxNCAke3JlYXNvbn1gLCA4MDAwKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgc2V0VGltZW91dCgoKSA9PiBidG4uc2V0QnV0dG9uVGV4dChcIlx1NkQ0Qlx1OEJENVwiKSwgNDAwMCk7XG4gICAgICAgIH0pXG4gICAgICApO1xuICB9XG59XG5cbi8vID09PT09IFV0aWxpdHkgPT09PT1cblxuZnVuY3Rpb24gc3RyaXBGcm9udG1hdHRlcihjb250ZW50OiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoIWNvbnRlbnQuc3RhcnRzV2l0aChcIi0tLVwiKSkgcmV0dXJuIGNvbnRlbnQ7XG4gIGNvbnN0IGVuZCA9IGNvbnRlbnQuaW5kZXhPZihcIlxcbi0tLVwiLCAzKTtcbiAgaWYgKGVuZCA9PT0gLTEpIHJldHVybiBjb250ZW50O1xuICByZXR1cm4gY29udGVudC5zbGljZShlbmQgKyA0KS50cmltU3RhcnQoKTtcbn1cblxuZnVuY3Rpb24gcGFyc2VUYWdzKHJhdzogdW5rbm93bik6IHN0cmluZ1tdIHtcbiAgaWYgKCFyYXcpIHJldHVybiBbXTtcbiAgaWYgKEFycmF5LmlzQXJyYXkocmF3KSkgcmV0dXJuIChyYXcgYXMgdW5rbm93bltdKS5tYXAoU3RyaW5nKS5maWx0ZXIoQm9vbGVhbik7XG4gIGlmICh0eXBlb2YgcmF3ID09PSBcInN0cmluZ1wiKVxuICAgIHJldHVybiByYXdcbiAgICAgIC5zcGxpdChcIixcIilcbiAgICAgIC5tYXAoKHQpID0+IHQudHJpbSgpKVxuICAgICAgLmZpbHRlcihCb29sZWFuKTtcbiAgcmV0dXJuIFtdO1xufVxuXG5mdW5jdGlvbiBzYWZlRmlsZW5hbWUobmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5hbWUucmVwbGFjZSgvW1xcXFwvOio/XCI8PnxdL2csIFwiLVwiKS50cmltKCkuc2xpY2UoMCwgMTAwKTtcbn1cblxuZnVuY3Rpb24gYnVpbGROb3RlQ29udGVudChwb3N0OiBCbG9nUG9zdCk6IHN0cmluZyB7XG4gIGNvbnN0IHRhZ3MgPSBwb3N0LnRhZ3MubWFwKCh0KSA9PiB0LnRhZy5uYW1lKTtcbiAgY29uc3QgbGluZXMgPSBbXG4gICAgXCItLS1cIixcbiAgICBgdGl0bGU6IFwiJHtwb3N0LnRpdGxlLnJlcGxhY2UoL1wiL2csICdcXFxcXCInKX1cImAsXG4gICAgYGJsb2ctaWQ6IFwiJHtwb3N0LmlkfVwiYCxcbiAgICBgYmxvZy16b25lOiAke3Bvc3Quem9uZX1gLFxuICAgIGBibG9nLXZpc2liaWxpdHk6ICR7cG9zdC52aXNpYmlsaXR5fWAsXG4gICAgYGJsb2ctcHVibGlzaGVkOiAke3Bvc3QucHVibGlzaGVkfWAsXG4gIF07XG4gIGlmICh0YWdzLmxlbmd0aCkge1xuICAgIGxpbmVzLnB1c2goYHRhZ3M6IFske3RhZ3MubWFwKCh0KSA9PiBgXCIke3R9XCJgKS5qb2luKFwiLCBcIil9XWApO1xuICB9XG4gIGxpbmVzLnB1c2goXG4gICAgYGJsb2ctc3luY2VkLWF0OiBcIiR7bmV3IERhdGUoKS50b0lTT1N0cmluZygpfVwiYCxcbiAgICBgYmxvZy11cGRhdGVkLWF0OiBcIiR7cG9zdC51cGRhdGVkQXR9XCJgLFxuICAgIFwiLS0tXCIsXG4gICAgXCJcIixcbiAgICBwb3N0LmNvbnRlbnRcbiAgKTtcbiAgcmV0dXJuIGxpbmVzLmpvaW4oXCJcXG5cIik7XG59XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxzQkFXTztBQTJCUCxJQUFNLG1CQUFxQztBQUFBLEVBQ3pDLFNBQVM7QUFBQSxFQUNULFVBQVU7QUFBQSxFQUNWLFVBQVU7QUFBQSxFQUNWLFlBQVk7QUFBQSxFQUNaLE9BQU87QUFDVDtBQUVBLElBQU0saUJBQXVDO0FBQUEsRUFDM0MsT0FBTztBQUFBLEVBQ1AsTUFBTTtBQUFB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
