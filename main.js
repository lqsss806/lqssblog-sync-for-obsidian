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
  ANIME: "anime",
  REAL: "real",
  FOUR: "four"
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
    new import_obsidian.Setting(containerEl).setName("\u540C\u6B65\u6839\u6587\u4EF6\u5939").setDesc("\u6587\u7AE0\u6309\u5206\u533A\u4FDD\u5B58\u5230\u5B50\u6587\u4EF6\u5939\uFF1Ablog/anime \xB7 blog/real \xB7 blog/four").addText(
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7XG4gIEFwcCxcbiAgTW9kYWwsXG4gIE5vdGljZSxcbiAgUGx1Z2luLFxuICBQbHVnaW5TZXR0aW5nVGFiLFxuICBTZXR0aW5nLFxuICBURmlsZSxcbiAgcmVxdWVzdFVybCxcbiAgUmVxdWVzdFVybFBhcmFtLFxuICBSZXF1ZXN0VXJsUmVzcG9uc2UsXG59IGZyb20gXCJvYnNpZGlhblwiO1xuXG4vLyA9PT09PSBUeXBlcyA9PT09PVxuXG50eXBlIFpvbmUgPSBcIkFOSU1FXCIgfCBcIlJFQUxcIiB8IFwiRk9VUlwiO1xudHlwZSBWaXNpYmlsaXR5ID0gXCJQVUJMSUNcIiB8IFwiTE9HSU5fT05MWVwiIHwgXCJGUklFTkRTX09OTFlcIjtcblxuaW50ZXJmYWNlIEJsb2dQb3N0IHtcbiAgaWQ6IHN0cmluZztcbiAgdGl0bGU6IHN0cmluZztcbiAgY29udGVudDogc3RyaW5nO1xuICB6b25lOiBab25lO1xuICB2aXNpYmlsaXR5OiBWaXNpYmlsaXR5O1xuICBwdWJsaXNoZWQ6IGJvb2xlYW47XG4gIGNyZWF0ZWRBdDogc3RyaW5nO1xuICB1cGRhdGVkQXQ6IHN0cmluZztcbiAgdGFnczogeyB0YWc6IHsgbmFtZTogc3RyaW5nIH0gfVtdO1xufVxuXG5pbnRlcmZhY2UgTHFzc2Jsb2dTZXR0aW5ncyB7XG4gIGJsb2dVcmw6IHN0cmluZztcbiAgdXNlcm5hbWU6IHN0cmluZztcbiAgcGFzc3dvcmQ6IHN0cmluZztcbiAgc3luY0ZvbGRlcjogc3RyaW5nO1xuICB0b2tlbjogc3RyaW5nO1xufVxuXG5jb25zdCBERUZBVUxUX1NFVFRJTkdTOiBMcXNzYmxvZ1NldHRpbmdzID0ge1xuICBibG9nVXJsOiBcImh0dHBzOi8vbHFzc2Jsb2cuc2VydmVibG9nLm5ldFwiLFxuICB1c2VybmFtZTogXCJcIixcbiAgcGFzc3dvcmQ6IFwiXCIsXG4gIHN5bmNGb2xkZXI6IFwiYmxvZ1wiLFxuICB0b2tlbjogXCJcIixcbn07XG5cbmNvbnN0IFpPTkVfU1VCRk9MREVSOiBSZWNvcmQ8Wm9uZSwgc3RyaW5nPiA9IHtcbiAgQU5JTUU6IFwiYW5pbWVcIixcbiAgUkVBTDogXCJyZWFsXCIsXG4gIEZPVVI6IFwiZm91clwiLFxufTtcblxuLy8gPT09PT0gUGx1Z2luID09PT09XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIExxc3NibG9nUGx1Z2luIGV4dGVuZHMgUGx1Z2luIHtcbiAgc2V0dGluZ3M6IExxc3NibG9nU2V0dGluZ3M7XG5cbiAgYXN5bmMgb25sb2FkKCkge1xuICAgIGF3YWl0IHRoaXMubG9hZFNldHRpbmdzKCk7XG5cbiAgICAvLyBSaWJib24gaWNvblxuICAgIHRoaXMuYWRkUmliYm9uSWNvbihcImNsb3VkXCIsIFwibHFzc2Jsb2cgU3luY1wiLCAoKSA9PiB7XG4gICAgICBuZXcgU3luY01vZGFsKHRoaXMuYXBwLCB0aGlzKS5vcGVuKCk7XG4gICAgfSk7XG5cbiAgICAvLyBDb21tYW5kc1xuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJwdXNoLWN1cnJlbnQtbm90ZVwiLFxuICAgICAgbmFtZTogXCJcdTYzQThcdTkwMDFcdTVGNTNcdTUyNERcdTdCMTRcdThCQjBcdTUyMzBcdTUzNUFcdTVCQTJcIixcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpO1xuICAgICAgICBpZiAoZmlsZSkgdGhpcy5wdXNoTm90ZShmaWxlKTtcbiAgICAgICAgZWxzZSBuZXcgTm90aWNlKFwibHFzc2Jsb2c6IFx1NkNBMVx1NjcwOVx1NjI1M1x1NUYwMFx1NzY4NFx1N0IxNFx1OEJCMFwiKTtcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwicHVsbC1hbGwtcG9zdHNcIixcbiAgICAgIG5hbWU6IFwiXHU0RUNFXHU1MzVBXHU1QkEyXHU2MkM5XHU1M0Q2XHU1MTY4XHU5MEU4XHU2NTg3XHU3QUUwXCIsXG4gICAgICBjYWxsYmFjazogKCkgPT4gdGhpcy5wdWxsQWxsUG9zdHMoKSxcbiAgICB9KTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJzeW5jLWFsbFwiLFxuICAgICAgbmFtZTogXCJcdTRFMEVcdTUzNUFcdTVCQTJcdTUxNjhcdTkxQ0ZcdTUzQ0NcdTU0MTFcdTU0MENcdTZCNjVcIixcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB0aGlzLnN5bmNBbGwoKSxcbiAgICB9KTtcblxuICAgIC8vIFJpZ2h0LWNsaWNrIGNvbnRleHQgbWVudVxuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbihcImZpbGUtbWVudVwiLCAobWVudSwgZmlsZSkgPT4ge1xuICAgICAgICBpZiAoZmlsZSBpbnN0YW5jZW9mIFRGaWxlICYmIGZpbGUuZXh0ZW5zaW9uID09PSBcIm1kXCIpIHtcbiAgICAgICAgICBtZW51LmFkZEl0ZW0oKGl0ZW0pID0+IHtcbiAgICAgICAgICAgIGl0ZW1cbiAgICAgICAgICAgICAgLnNldFRpdGxlKFwiXHU2M0E4XHU5MDAxXHU1MjMwIGxxc3NibG9nXCIpXG4gICAgICAgICAgICAgIC5zZXRJY29uKFwidXBsb2FkLWNsb3VkXCIpXG4gICAgICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHRoaXMucHVzaE5vdGUoZmlsZSkpO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9KVxuICAgICk7XG5cbiAgICB0aGlzLmFkZFNldHRpbmdUYWIobmV3IExxc3NibG9nU2V0dGluZ1RhYih0aGlzLmFwcCwgdGhpcykpO1xuICB9XG5cbiAgb251bmxvYWQoKSB7fVxuXG4gIC8vID09PT09IEF1dGggPT09PT1cblxuICBhc3luYyBsb2dpbigpOiBQcm9taXNlPHsgb2s6IGJvb2xlYW47IHJlYXNvbjogc3RyaW5nIH0+IHtcbiAgICBpZiAoIXRoaXMuc2V0dGluZ3MudXNlcm5hbWUgfHwgIXRoaXMuc2V0dGluZ3MucGFzc3dvcmQpIHtcbiAgICAgIHJldHVybiB7IG9rOiBmYWxzZSwgcmVhc29uOiBcIlx1NzUyOFx1NjIzN1x1NTQwRFx1NjIxNlx1NUJDNlx1NzgwMVx1NjcyQVx1NTg2Qlx1NTE5OVwiIH07XG4gICAgfVxuICAgIGxldCByZXNwOiBSZXF1ZXN0VXJsUmVzcG9uc2U7XG4gICAgdHJ5IHtcbiAgICAgIHJlc3AgPSBhd2FpdCByZXF1ZXN0VXJsKHtcbiAgICAgICAgdXJsOiBgJHt0aGlzLnNldHRpbmdzLmJsb2dVcmx9L2FwaS9hdXRoL2xvZ2luYCxcbiAgICAgICAgbWV0aG9kOiBcIlBPU1RcIixcbiAgICAgICAgaGVhZGVyczogeyBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIiB9LFxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgdXNlcm5hbWU6IHRoaXMuc2V0dGluZ3MudXNlcm5hbWUsXG4gICAgICAgICAgcGFzc3dvcmQ6IHRoaXMuc2V0dGluZ3MucGFzc3dvcmQsXG4gICAgICAgIH0pLFxuICAgICAgICB0aHJvdzogZmFsc2UsXG4gICAgICB9KTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICByZXR1cm4geyBvazogZmFsc2UsIHJlYXNvbjogYFx1N0Y1MVx1N0VEQ1x1OTUxOVx1OEJFRjogJHtTdHJpbmcoZSl9YCB9O1xuICAgIH1cblxuICAgIGlmIChyZXNwLnN0YXR1cyAhPT0gMjAwKSB7XG4gICAgICBsZXQgbXNnID0gXCJcIjtcbiAgICAgIHRyeSB7IG1zZyA9IHJlc3AuanNvbj8uZXJyb3IgPz8gcmVzcC50ZXh0OyB9IGNhdGNoIHsgbXNnID0gU3RyaW5nKHJlc3Auc3RhdHVzKTsgfVxuICAgICAgcmV0dXJuIHsgb2s6IGZhbHNlLCByZWFzb246IGBIVFRQICR7cmVzcC5zdGF0dXN9OiAke21zZ31gIH07XG4gICAgfVxuXG4gICAgbGV0IHRva2VuOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gICAgdHJ5IHsgdG9rZW4gPSByZXNwLmpzb24/LnRva2VuOyB9IGNhdGNoIHsgLyogaWdub3JlICovIH1cbiAgICBpZiAoIXRva2VuKSB7XG4gICAgICByZXR1cm4geyBvazogZmFsc2UsIHJlYXNvbjogXCJcdTU0Q0RcdTVFOTRcdTRFMkRcdTZDQTFcdTY3MDkgdG9rZW4gXHU1QjU3XHU2QkI1XCIgfTtcbiAgICB9XG5cbiAgICB0aGlzLnNldHRpbmdzLnRva2VuID0gdG9rZW47XG4gICAgYXdhaXQgdGhpcy5zYXZlU2V0dGluZ3MoKTtcbiAgICByZXR1cm4geyBvazogdHJ1ZSwgcmVhc29uOiBcIlx1NzY3Qlx1NUY1NVx1NjIxMFx1NTI5RlwiIH07XG4gIH1cblxuICBnZXRIZWFkZXJzKCk6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4ge1xuICAgIHJldHVybiB7XG4gICAgICBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIixcbiAgICAgIENvb2tpZTogYHRva2VuPSR7dGhpcy5zZXR0aW5ncy50b2tlbn1gLFxuICAgIH07XG4gIH1cblxuICAvLyBBdXRvLXJldHJ5IHdpdGggcmUtbG9naW4gb24gNDAxXG4gIGFzeW5jIGFwaVJlcShcbiAgICBvcHRpb25zOiBSZXF1ZXN0VXJsUGFyYW0sXG4gICAgcmV0cmllZCA9IGZhbHNlXG4gICk6IFByb21pc2U8UmVxdWVzdFVybFJlc3BvbnNlPiB7XG4gICAgY29uc3QgcmVzcCA9IGF3YWl0IHJlcXVlc3RVcmwoe1xuICAgICAgLi4ub3B0aW9ucyxcbiAgICAgIGhlYWRlcnM6IHsgLi4udGhpcy5nZXRIZWFkZXJzKCksIC4uLihvcHRpb25zLmhlYWRlcnMgPz8ge30pIH0sXG4gICAgICB0aHJvdzogZmFsc2UsXG4gICAgfSk7XG4gICAgaWYgKHJlc3Auc3RhdHVzID09PSA0MDEgJiYgIXJldHJpZWQpIHtcbiAgICAgIGNvbnN0IHsgb2sgfSA9IGF3YWl0IHRoaXMubG9naW4oKTtcbiAgICAgIGlmIChvaykgcmV0dXJuIHRoaXMuYXBpUmVxKG9wdGlvbnMsIHRydWUpO1xuICAgIH1cbiAgICByZXR1cm4gcmVzcDtcbiAgfVxuXG4gIC8vID09PT09IEFQSSA9PT09PVxuXG4gIGFzeW5jIGZldGNoTXlQb3N0cygpOiBQcm9taXNlPEJsb2dQb3N0W10+IHtcbiAgICBjb25zdCByZXNwID0gYXdhaXQgdGhpcy5hcGlSZXEoe1xuICAgICAgdXJsOiBgJHt0aGlzLnNldHRpbmdzLmJsb2dVcmx9L2FwaS91c2VyL3Bvc3RzYCxcbiAgICB9KTtcbiAgICBpZiAocmVzcC5zdGF0dXMgIT09IDIwMCkgcmV0dXJuIFtdO1xuICAgIHJldHVybiAocmVzcC5qc29uIGFzIHsgcG9zdHM6IEJsb2dQb3N0W10gfSkucG9zdHMgPz8gW107XG4gIH1cblxuICBhc3luYyBjcmVhdGVQb3N0KGRhdGE6IHtcbiAgICB0aXRsZTogc3RyaW5nO1xuICAgIGNvbnRlbnQ6IHN0cmluZztcbiAgICB6b25lOiBab25lO1xuICAgIHZpc2liaWxpdHk6IFZpc2liaWxpdHk7XG4gICAgcHVibGlzaGVkOiBib29sZWFuO1xuICAgIHRhZ3M6IHN0cmluZ1tdO1xuICB9KTogUHJvbWlzZTxCbG9nUG9zdCB8IG51bGw+IHtcbiAgICBjb25zdCByZXNwID0gYXdhaXQgdGhpcy5hcGlSZXEoe1xuICAgICAgdXJsOiBgJHt0aGlzLnNldHRpbmdzLmJsb2dVcmx9L2FwaS9wb3N0c2AsXG4gICAgICBtZXRob2Q6IFwiUE9TVFwiLFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoZGF0YSksXG4gICAgfSk7XG4gICAgaWYgKHJlc3Auc3RhdHVzICE9PSAyMDEpIHJldHVybiBudWxsO1xuICAgIHJldHVybiAocmVzcC5qc29uIGFzIHsgcG9zdDogQmxvZ1Bvc3QgfSkucG9zdCA/PyBudWxsO1xuICB9XG5cbiAgYXN5bmMgdXBkYXRlUG9zdChcbiAgICBpZDogc3RyaW5nLFxuICAgIGRhdGE6IHtcbiAgICAgIHRpdGxlOiBzdHJpbmc7XG4gICAgICBjb250ZW50OiBzdHJpbmc7XG4gICAgICB6b25lOiBab25lO1xuICAgICAgdmlzaWJpbGl0eTogVmlzaWJpbGl0eTtcbiAgICAgIHB1Ymxpc2hlZDogYm9vbGVhbjtcbiAgICAgIHRhZ3M6IHN0cmluZ1tdO1xuICAgIH1cbiAgKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgY29uc3QgcmVzcCA9IGF3YWl0IHRoaXMuYXBpUmVxKHtcbiAgICAgIHVybDogYCR7dGhpcy5zZXR0aW5ncy5ibG9nVXJsfS9hcGkvcG9zdHMvJHtpZH1gLFxuICAgICAgbWV0aG9kOiBcIlBVVFwiLFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoZGF0YSksXG4gICAgfSk7XG4gICAgcmV0dXJuIHJlc3Auc3RhdHVzID09PSAyMDA7XG4gIH1cblxuICAvLyA9PT09PSBDb3JlIFN5bmMgPT09PT1cblxuICAvKiogUHVzaCBhIHNpbmdsZSBub3RlIHRvIHRoZSBibG9nLiBTaG93cyBQdWJsaXNoTW9kYWwgaWYgem9uZSBub3Qgc2V0LiAqL1xuICBhc3luYyBwdXNoTm90ZShmaWxlOiBURmlsZSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghdGhpcy5zZXR0aW5ncy51c2VybmFtZSB8fCAhdGhpcy5zZXR0aW5ncy5wYXNzd29yZCkge1xuICAgICAgbmV3IE5vdGljZShcImxxc3NibG9nOiBcdThCRjdcdTUxNDhcdTU3MjhcdTYzRDJcdTRFRjZcdThCQkVcdTdGNkVcdTkxQ0NcdTU4NkJcdTUxOTlcdTc1MjhcdTYyMzdcdTU0MERcdTU0OENcdTVCQzZcdTc4MDFcIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgZm0gPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShmaWxlKT8uZnJvbnRtYXR0ZXIgPz8ge307XG4gICAgY29uc3Qgem9uZSA9IGZtW1wiYmxvZy16b25lXCJdIGFzIFpvbmUgfCB1bmRlZmluZWQ7XG5cbiAgICBpZiAoIXpvbmUpIHtcbiAgICAgIG5ldyBQdWJsaXNoTW9kYWwodGhpcy5hcHAsIHRoaXMsIGZpbGUpLm9wZW4oKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmRvUHVzaChmaWxlLCBmbSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgZm1bXCJibG9nLWlkXCJdIGFzIHN0cmluZyB8IHVuZGVmaW5lZCwgem9uZSk7XG4gIH1cblxuICAvKiogQWN0dWFsbHkgcHVzaCB0aGUgbm90ZSAoY2FsbGVkIGFmdGVyIHpvbmUgaXMgY29uZmlybWVkKS4gKi9cbiAgYXN5bmMgZG9QdXNoKFxuICAgIGZpbGU6IFRGaWxlLFxuICAgIGZtOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPixcbiAgICBibG9nSWQ6IHN0cmluZyB8IHVuZGVmaW5lZCxcbiAgICB6b25lOiBab25lXG4gICk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGNvbnN0IHJhd0NvbnRlbnQgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5yZWFkKGZpbGUpO1xuICAgIGNvbnN0IGJvZHkgPSBzdHJpcEZyb250bWF0dGVyKHJhd0NvbnRlbnQpO1xuXG4gICAgY29uc3QgdGl0bGUgPSAoZm1bXCJ0aXRsZVwiXSBhcyBzdHJpbmcpIHx8IGZpbGUuYmFzZW5hbWU7XG4gICAgY29uc3QgdmlzaWJpbGl0eSA9IChmbVtcImJsb2ctdmlzaWJpbGl0eVwiXSBhcyBWaXNpYmlsaXR5KSB8fCBcIkxPR0lOX09OTFlcIjtcbiAgICBjb25zdCBwdWJsaXNoZWQgPSAoZm1bXCJibG9nLXB1Ymxpc2hlZFwiXSBhcyBib29sZWFuKSA/PyBmYWxzZTtcbiAgICBjb25zdCB0YWdzID0gcGFyc2VUYWdzKGZtW1wiYmxvZy10YWdzXCJdKTtcblxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICBjb25zdCBkYXRhID0geyB0aXRsZSwgY29udGVudDogYm9keSwgem9uZSwgdmlzaWJpbGl0eSwgcHVibGlzaGVkLCB0YWdzIH07XG5cbiAgICBpZiAoYmxvZ0lkKSB7XG4gICAgICBjb25zdCBvayA9IGF3YWl0IHRoaXMudXBkYXRlUG9zdChibG9nSWQsIGRhdGEpO1xuICAgICAgaWYgKCFvaykge1xuICAgICAgICBuZXcgTm90aWNlKGBscXNzYmxvZzogXHUyNzE3IFx1NjZGNFx1NjVCMFx1NTkzMVx1OEQyNSBcdTIwMTRcdTMwMEMke3RpdGxlfVx1MzAwRGApO1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IHBvc3QgPSBhd2FpdCB0aGlzLmNyZWF0ZVBvc3QoZGF0YSk7XG4gICAgICBpZiAoIXBvc3QpIHtcbiAgICAgICAgbmV3IE5vdGljZShgbHFzc2Jsb2c6IFx1MjcxNyBcdTUzRDFcdTVFMDNcdTU5MzFcdThEMjUgXHUyMDE0XHUzMDBDJHt0aXRsZX1cdTMwMERgKTtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgICAgYmxvZ0lkID0gcG9zdC5pZDtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmFwcC5maWxlTWFuYWdlci5wcm9jZXNzRnJvbnRNYXR0ZXIoZmlsZSwgKGYpID0+IHtcbiAgICAgIGZbXCJibG9nLWlkXCJdID0gYmxvZ0lkO1xuICAgICAgZltcImJsb2ctc3luY2VkLWF0XCJdID0gbm93O1xuICAgICAgZltcImJsb2ctdXBkYXRlZC1hdFwiXSA9IG5vdztcbiAgICB9KTtcblxuICAgIG5ldyBOb3RpY2UoYGxxc3NibG9nOiBcdTI3MTMgXHU1REYyXHU2M0E4XHU5MDAxXHUzMDBDJHt0aXRsZX1cdTMwMERgKTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIC8qKiBQdWxsIGFsbCB1c2VyJ3MgcG9zdHMgZnJvbSB0aGUgYmxvZyBpbnRvIHRoZSBzeW5jIGZvbGRlci4gKi9cbiAgYXN5bmMgcHVsbEFsbFBvc3RzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghdGhpcy5zZXR0aW5ncy51c2VybmFtZSB8fCAhdGhpcy5zZXR0aW5ncy5wYXNzd29yZCkge1xuICAgICAgbmV3IE5vdGljZShcImxxc3NibG9nOiBcdThCRjdcdTUxNDhcdTU3MjhcdTYzRDJcdTRFRjZcdThCQkVcdTdGNkVcdTkxQ0NcdTU4NkJcdTUxOTlcdTc1MjhcdTYyMzdcdTU0MERcdTU0OENcdTVCQzZcdTc4MDFcIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgbmV3IE5vdGljZShcImxxc3NibG9nOiBcdTZCNjNcdTU3MjhcdTYyQzlcdTUzRDZcdTIwMjZcIik7XG4gICAgY29uc3QgcG9zdHMgPSBhd2FpdCB0aGlzLmZldGNoTXlQb3N0cygpO1xuXG4gICAgaWYgKCFwb3N0cy5sZW5ndGgpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJscXNzYmxvZzogXHU1MzVBXHU1QkEyXHU0RTBBXHU4RkQ4XHU2Q0ExXHU2NzA5XHU2NTg3XHU3QUUwXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuZW5zdXJlU3luY0ZvbGRlcigpO1xuXG4gICAgbGV0IHB1bGxlZCA9IDAsIHNraXBwZWQgPSAwO1xuXG4gICAgZm9yIChjb25zdCBwb3N0IG9mIHBvc3RzKSB7XG4gICAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuZmluZEZpbGVCeUJsb2dJZChwb3N0LmlkKTtcbiAgICAgIGNvbnN0IHN5bmNlZEF0ID0gZXhpc3RpbmdcbiAgICAgICAgPyAodGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUoZXhpc3RpbmcpPy5mcm9udG1hdHRlcj8uW1xuICAgICAgICAgICAgXCJibG9nLXN5bmNlZC1hdFwiXG4gICAgICAgICAgXSBhcyBzdHJpbmcgfCB1bmRlZmluZWQpXG4gICAgICAgIDogdW5kZWZpbmVkO1xuXG4gICAgICBjb25zdCBibG9nVXBkYXRlZEF0ID0gbmV3IERhdGUocG9zdC51cGRhdGVkQXQpLmdldFRpbWUoKTtcbiAgICAgIGNvbnN0IGxhc3RTeW5jVGltZSA9IHN5bmNlZEF0ID8gbmV3IERhdGUoc3luY2VkQXQpLmdldFRpbWUoKSA6IDA7XG5cbiAgICAgIGlmIChleGlzdGluZyAmJiBibG9nVXBkYXRlZEF0IDw9IGxhc3RTeW5jVGltZSkge1xuICAgICAgICBza2lwcGVkKys7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBjb250ZW50ID0gYnVpbGROb3RlQ29udGVudChwb3N0KTtcbiAgICAgIGlmIChleGlzdGluZykge1xuICAgICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5tb2RpZnkoZXhpc3RpbmcsIGNvbnRlbnQpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3QgcGF0aCA9IGF3YWl0IHRoaXMudW5pcXVlUGF0aChcbiAgICAgICAgICBgJHt0aGlzLnpvbmVGb2xkZXIocG9zdC56b25lKX0vJHtzYWZlRmlsZW5hbWUocG9zdC50aXRsZSkgfHwgcG9zdC5pZH0ubWRgXG4gICAgICAgICk7XG4gICAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNyZWF0ZShwYXRoLCBjb250ZW50KTtcbiAgICAgIH1cbiAgICAgIHB1bGxlZCsrO1xuICAgIH1cblxuICAgIG5ldyBOb3RpY2UoYGxxc3NibG9nOiBcdTYyQzlcdTUzRDZcdTVCOENcdTYyMTAgXHUyMDE0XHUyMDE0IFx1NjZGNFx1NjVCMCAke3B1bGxlZH0gXHU3QkM3XHVGRjBDXHU4REYzXHU4RkM3ICR7c2tpcHBlZH0gXHU3QkM3YCk7XG4gIH1cblxuICAvKiogRnVsbCBiaWRpcmVjdGlvbmFsIHN5bmMuICovXG4gIGFzeW5jIHN5bmNBbGwoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCF0aGlzLnNldHRpbmdzLnVzZXJuYW1lIHx8ICF0aGlzLnNldHRpbmdzLnBhc3N3b3JkKSB7XG4gICAgICBuZXcgTm90aWNlKFwibHFzc2Jsb2c6IFx1OEJGN1x1NTE0OFx1NTcyOFx1NjNEMlx1NEVGNlx1OEJCRVx1N0Y2RVx1OTFDQ1x1NTg2Qlx1NTE5OVx1NzUyOFx1NjIzN1x1NTQwRFx1NTQ4Q1x1NUJDNlx1NzgwMVwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBuZXcgTm90aWNlKFwibHFzc2Jsb2c6IFx1NUYwMFx1NTlDQlx1NTNDQ1x1NTQxMVx1NTQwQ1x1NkI2NVx1MjAyNlwiKTtcbiAgICBjb25zdCBwb3N0cyA9IGF3YWl0IHRoaXMuZmV0Y2hNeVBvc3RzKCk7XG4gICAgY29uc3QgYmxvZ01hcCA9IG5ldyBNYXA8c3RyaW5nLCBCbG9nUG9zdD4ocG9zdHMubWFwKChwKSA9PiBbcC5pZCwgcF0pKTtcblxuICAgIGF3YWl0IHRoaXMuZW5zdXJlU3luY0ZvbGRlcigpO1xuXG4gICAgbGV0IHB1c2hlZCA9IDAsIHB1bGxlZCA9IDAsIGNvbmZsaWN0cyA9IDAsIGNyZWF0ZWQgPSAwO1xuICAgIGNvbnN0IHByb2Nlc3NlZElkcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4gICAgLy8gUHJvY2VzcyBhbGwgbG9jYWwgZmlsZXNcbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgdGhpcy5hcHAudmF1bHQuZ2V0TWFya2Rvd25GaWxlcygpKSB7XG4gICAgICBjb25zdCBmbSA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpPy5mcm9udG1hdHRlciA/PyB7fTtcbiAgICAgIGNvbnN0IGJsb2dJZCA9IGZtW1wiYmxvZy1pZFwiXSBhcyBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gICAgICBjb25zdCB6b25lID0gZm1bXCJibG9nLXpvbmVcIl0gYXMgWm9uZSB8IHVuZGVmaW5lZDtcblxuICAgICAgaWYgKCFibG9nSWQpIHtcbiAgICAgICAgLy8gTmV3IGxvY2FsIGZpbGUgaW4gYSB6b25lIHN1YmZvbGRlciB3aXRoIGJsb2ctem9uZSBzZXQgXHUyMTkyIHB1c2ggdG8gY3JlYXRlXG4gICAgICAgIGNvbnN0IGluWm9uZUZvbGRlciA9XG4gICAgICAgICAgem9uZSAmJiBmaWxlLnBhdGguc3RhcnRzV2l0aCh0aGlzLnpvbmVGb2xkZXIoem9uZSkgKyBcIi9cIik7XG4gICAgICAgIGlmIChpblpvbmVGb2xkZXIpIHtcbiAgICAgICAgICBjb25zdCBvayA9IGF3YWl0IHRoaXMuZG9QdXNoKGZpbGUsIGZtIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+LCB1bmRlZmluZWQsIHpvbmUhKTtcbiAgICAgICAgICBpZiAob2spIGNyZWF0ZWQrKztcbiAgICAgICAgfVxuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgcHJvY2Vzc2VkSWRzLmFkZChibG9nSWQpO1xuICAgICAgY29uc3QgYmxvZ1Bvc3QgPSBibG9nTWFwLmdldChibG9nSWQpO1xuICAgICAgaWYgKCFibG9nUG9zdCkgY29udGludWU7IC8vIHBvc3QgZGVsZXRlZCBvbiBibG9nIHNpZGUgXHUyMDE0IHNraXBcblxuICAgICAgY29uc3Qgc3luY2VkQXQgPSBmbVtcImJsb2ctc3luY2VkLWF0XCJdIGFzIHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICAgIGNvbnN0IGxhc3RTeW5jVGltZSA9IHN5bmNlZEF0ID8gbmV3IERhdGUoc3luY2VkQXQpLmdldFRpbWUoKSA6IDA7XG4gICAgICBjb25zdCBibG9nVXBkYXRlZEF0ID0gbmV3IERhdGUoYmxvZ1Bvc3QudXBkYXRlZEF0KS5nZXRUaW1lKCk7XG4gICAgICBjb25zdCBsb2NhbFVwZGF0ZWRBdCA9IGZpbGUuc3RhdC5tdGltZTtcbiAgICAgIGNvbnN0IEJVRkZFUiA9IDVfMDAwOyAvLyA1cyB0b2xlcmFuY2UgZm9yIGNsb2NrIHNrZXdcblxuICAgICAgY29uc3QgYmxvZ05ld2VyID0gYmxvZ1VwZGF0ZWRBdCA+IGxhc3RTeW5jVGltZSArIEJVRkZFUjtcbiAgICAgIGNvbnN0IGxvY2FsTmV3ZXIgPSBsb2NhbFVwZGF0ZWRBdCA+IGxhc3RTeW5jVGltZSArIEJVRkZFUjtcblxuICAgICAgaWYgKGJsb2dOZXdlciAmJiBsb2NhbE5ld2VyKSB7XG4gICAgICAgIGNvbmZsaWN0cysrO1xuICAgICAgICBuZXcgTm90aWNlKFxuICAgICAgICAgIGBscXNzYmxvZzogXHUyNkEwIFx1NTFCMlx1N0E4MSBcdTIwMTRcdTMwMEMke2ZpbGUuYmFzZW5hbWV9XHUzMDBEXHU2NzJDXHU1NzMwXHU1NDhDXHU4RkRDXHU3QUVGXHU5MEZEXHU2NzA5XHU2NkY0XHU2NTM5XHVGRjBDXHU1REYyXHU4REYzXHU4RkM3XHVGRjBDXHU4QkY3XHU2MjRCXHU1MkE4XHU1OTA0XHU3NDA2YFxuICAgICAgICApO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgaWYgKGxvY2FsTmV3ZXIpIHtcbiAgICAgICAgY29uc3Qgb2sgPSBhd2FpdCB0aGlzLmRvUHVzaChcbiAgICAgICAgICBmaWxlLFxuICAgICAgICAgIGZtIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuICAgICAgICAgIGJsb2dJZCxcbiAgICAgICAgICB6b25lID8/IChibG9nUG9zdC56b25lIGFzIFpvbmUpXG4gICAgICAgICk7XG4gICAgICAgIGlmIChvaykgcHVzaGVkKys7XG4gICAgICB9IGVsc2UgaWYgKGJsb2dOZXdlcikge1xuICAgICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5tb2RpZnkoZmlsZSwgYnVpbGROb3RlQ29udGVudChibG9nUG9zdCkpO1xuICAgICAgICBwdWxsZWQrKztcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBQdWxsIHBvc3RzIGZyb20gYmxvZyB0aGF0IGRvbid0IGV4aXN0IGxvY2FsbHkgeWV0XG4gICAgZm9yIChjb25zdCBwb3N0IG9mIHBvc3RzKSB7XG4gICAgICBpZiAocHJvY2Vzc2VkSWRzLmhhcyhwb3N0LmlkKSkgY29udGludWU7XG4gICAgICBjb25zdCBwYXRoID0gYXdhaXQgdGhpcy51bmlxdWVQYXRoKFxuICAgICAgICBgJHt0aGlzLnpvbmVGb2xkZXIocG9zdC56b25lKX0vJHtzYWZlRmlsZW5hbWUocG9zdC50aXRsZSkgfHwgcG9zdC5pZH0ubWRgXG4gICAgICApO1xuICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuY3JlYXRlKHBhdGgsIGJ1aWxkTm90ZUNvbnRlbnQocG9zdCkpO1xuICAgICAgcHVsbGVkKys7XG4gICAgfVxuXG4gICAgY29uc3Qgc3VtbWFyeSA9IFtcbiAgICAgIGBcdTIxOTEgXHU2M0E4XHU5MDAxICR7cHVzaGVkICsgY3JlYXRlZH1gLFxuICAgICAgYFx1MjE5MyBcdTYyQzlcdTUzRDYgJHtwdWxsZWR9YCxcbiAgICAgIGNvbmZsaWN0cyA/IGBcdTI2QTAgJHtjb25mbGljdHN9IFx1NEUyQVx1NTFCMlx1N0E4MWAgOiBcIlwiLFxuICAgIF1cbiAgICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICAgIC5qb2luKFwiICAgXCIpO1xuXG4gICAgbmV3IE5vdGljZShgbHFzc2Jsb2c6IFx1NTQwQ1x1NkI2NVx1NUI4Q1x1NjIxMCBcdTIwMTRcdTIwMTQgJHtzdW1tYXJ5fWApO1xuICB9XG5cbiAgLy8gPT09PT0gSGVscGVycyA9PT09PVxuXG4gIGZpbmRGaWxlQnlCbG9nSWQoYmxvZ0lkOiBzdHJpbmcpOiBURmlsZSB8IG51bGwge1xuICAgIGZvciAoY29uc3QgZmlsZSBvZiB0aGlzLmFwcC52YXVsdC5nZXRNYXJrZG93bkZpbGVzKCkpIHtcbiAgICAgIGNvbnN0IGZtID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUoZmlsZSk/LmZyb250bWF0dGVyO1xuICAgICAgaWYgKGZtPy5bXCJibG9nLWlkXCJdID09PSBibG9nSWQpIHJldHVybiBmaWxlO1xuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHpvbmVGb2xkZXIoem9uZTogWm9uZSk6IHN0cmluZyB7XG4gICAgcmV0dXJuIGAke3RoaXMuc2V0dGluZ3Muc3luY0ZvbGRlcn0vJHtaT05FX1NVQkZPTERFUlt6b25lXX1gO1xuICB9XG5cbiAgYXN5bmMgZW5zdXJlU3luY0ZvbGRlcigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCByb290ID0gdGhpcy5zZXR0aW5ncy5zeW5jRm9sZGVyO1xuICAgIGlmICghKGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIuZXhpc3RzKHJvb3QpKSkge1xuICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuY3JlYXRlRm9sZGVyKHJvb3QpO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IHN1YiBvZiBPYmplY3QudmFsdWVzKFpPTkVfU1VCRk9MREVSKSkge1xuICAgICAgY29uc3QgcGF0aCA9IGAke3Jvb3R9LyR7c3VifWA7XG4gICAgICBpZiAoIShhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLmV4aXN0cyhwYXRoKSkpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuY3JlYXRlRm9sZGVyKHBhdGgpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHVuaXF1ZVBhdGgocGF0aDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICBpZiAoIShhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLmV4aXN0cyhwYXRoKSkpIHJldHVybiBwYXRoO1xuICAgIGNvbnN0IGJhc2UgPSBwYXRoLnJlcGxhY2UoL1xcLm1kJC8sIFwiXCIpO1xuICAgIGxldCBpID0gMTtcbiAgICB3aGlsZSAoYXdhaXQgdGhpcy5hcHAudmF1bHQuYWRhcHRlci5leGlzdHMoYCR7YmFzZX0tJHtpfS5tZGApKSBpKys7XG4gICAgcmV0dXJuIGAke2Jhc2V9LSR7aX0ubWRgO1xuICB9XG5cbiAgYXN5bmMgbG9hZFNldHRpbmdzKCkge1xuICAgIHRoaXMuc2V0dGluZ3MgPSBPYmplY3QuYXNzaWduKHt9LCBERUZBVUxUX1NFVFRJTkdTLCBhd2FpdCB0aGlzLmxvYWREYXRhKCkpO1xuICB9XG5cbiAgYXN5bmMgc2F2ZVNldHRpbmdzKCkge1xuICAgIGF3YWl0IHRoaXMuc2F2ZURhdGEodGhpcy5zZXR0aW5ncyk7XG4gIH1cbn1cblxuLy8gPT09PT0gU3luYyBNb2RhbCAoUmliYm9uIGNsaWNrKSA9PT09PVxuXG5jbGFzcyBTeW5jTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIHBsdWdpbjogTHFzc2Jsb2dQbHVnaW47XG5cbiAgY29uc3RydWN0b3IoYXBwOiBBcHAsIHBsdWdpbjogTHFzc2Jsb2dQbHVnaW4pIHtcbiAgICBzdXBlcihhcHApO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICB9XG5cbiAgb25PcGVuKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5hZGRDbGFzcyhcImxxc3MtbW9kYWxcIik7XG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwiaDNcIiwgeyB0ZXh0OiBcImxxc3NibG9nIFN5bmNcIiB9KTtcblxuICAgIGNvbnN0IGdyaWQgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcImxxc3MtZ3JpZFwiIH0pO1xuXG4gICAgdGhpcy5idG4oZ3JpZCwgXCJcdTIxOTFcIiwgXCJcdTYzQThcdTkwMDFcdTVGNTNcdTUyNERcdTdCMTRcdThCQjBcIiwgXCJ1cGxvYWQtY2xvdWRcIiwgKCkgPT4ge1xuICAgICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVGaWxlKCk7XG4gICAgICBpZiAoZmlsZSkgdGhpcy5wbHVnaW4ucHVzaE5vdGUoZmlsZSk7XG4gICAgICBlbHNlIG5ldyBOb3RpY2UoXCJscXNzYmxvZzogXHU2Q0ExXHU2NzA5XHU2MjUzXHU1RjAwXHU3Njg0XHU3QjE0XHU4QkIwXCIpO1xuICAgIH0pO1xuXG4gICAgdGhpcy5idG4oZ3JpZCwgXCJcdTIxOTNcIiwgXCJcdTYyQzlcdTUzRDZcdTUxNjhcdTkwRThcdTY1ODdcdTdBRTBcIiwgXCJkb3dubG9hZC1jbG91ZFwiLCAoKSA9PiB7XG4gICAgICB0aGlzLnBsdWdpbi5wdWxsQWxsUG9zdHMoKTtcbiAgICB9KTtcblxuICAgIHRoaXMuYnRuKGdyaWQsIFwiXHUyMUM1XCIsIFwiXHU1MTY4XHU5MUNGXHU1M0NDXHU1NDExXHU1NDBDXHU2QjY1XCIsIFwicmVmcmVzaC1jd1wiLCAoKSA9PiB7XG4gICAgICB0aGlzLnBsdWdpbi5zeW5jQWxsKCk7XG4gICAgfSk7XG4gIH1cblxuICBidG4oXG4gICAgcGFyZW50OiBIVE1MRWxlbWVudCxcbiAgICBpY29uOiBzdHJpbmcsXG4gICAgbGFiZWw6IHN0cmluZyxcbiAgICBfbHVjaWRlOiBzdHJpbmcsXG4gICAgb25DbGljazogKCkgPT4gdm9pZFxuICApIHtcbiAgICBjb25zdCBidG4gPSBwYXJlbnQuY3JlYXRlRWwoXCJidXR0b25cIiwgeyBjbHM6IFwibHFzcy1hY3Rpb24tYnRuXCIgfSk7XG4gICAgYnRuLmNyZWF0ZUVsKFwic3BhblwiLCB7IGNsczogXCJscXNzLWJ0bi1pY29uXCIsIHRleHQ6IGljb24gfSk7XG4gICAgYnRuLmNyZWF0ZUVsKFwic3BhblwiLCB7IGNsczogXCJscXNzLWJ0bi1sYWJlbFwiLCB0ZXh0OiBsYWJlbCB9KTtcbiAgICBidG4ub25jbGljayA9ICgpID0+IHtcbiAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgIG9uQ2xpY2soKTtcbiAgICB9O1xuICB9XG5cbiAgb25DbG9zZSgpIHtcbiAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xuICB9XG59XG5cbi8vID09PT09IFB1Ymxpc2ggTW9kYWwgKGZpcnN0LXRpbWUgcHVzaCwgbm8gem9uZSBzZXQpID09PT09XG5cbmNsYXNzIFB1Ymxpc2hNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgcGx1Z2luOiBMcXNzYmxvZ1BsdWdpbjtcbiAgZmlsZTogVEZpbGU7XG5cbiAgY29uc3RydWN0b3IoYXBwOiBBcHAsIHBsdWdpbjogTHFzc2Jsb2dQbHVnaW4sIGZpbGU6IFRGaWxlKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgICB0aGlzLmZpbGUgPSBmaWxlO1xuICB9XG5cbiAgb25PcGVuKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnN0IGZtID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUodGhpcy5maWxlKT8uZnJvbnRtYXR0ZXIgPz8ge307XG5cbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJoM1wiLCB7IHRleHQ6IFwiXHU1M0QxXHU1RTAzXHU1MjMwIGxxc3NibG9nXCIgfSk7XG5cbiAgICBsZXQgdGl0bGUgPSAoZm1bXCJ0aXRsZVwiXSBhcyBzdHJpbmcpIHx8IHRoaXMuZmlsZS5iYXNlbmFtZTtcbiAgICBsZXQgem9uZTogWm9uZSA9IFwiQU5JTUVcIjtcbiAgICBsZXQgdmlzaWJpbGl0eTogVmlzaWJpbGl0eSA9IFwiTE9HSU5fT05MWVwiO1xuICAgIGxldCBwdWJsaXNoZWQgPSBmYWxzZTtcbiAgICBsZXQgdGFncyA9IHBhcnNlVGFncyhmbVtcImJsb2ctdGFnc1wiXSkuam9pbihcIiwgXCIpO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgLnNldE5hbWUoXCJcdTY4MDdcdTk4OThcIilcbiAgICAgIC5hZGRUZXh0KCh0KSA9PlxuICAgICAgICB0LnNldFZhbHVlKHRpdGxlKS5vbkNoYW5nZSgodikgPT4gKHRpdGxlID0gdikpXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgLnNldE5hbWUoXCJcdTUyMDZcdTUzM0FcIilcbiAgICAgIC5hZGREcm9wZG93bigoZCkgPT4ge1xuICAgICAgICBkLmFkZE9wdGlvbihcIkFOSU1FXCIsIFwiXHU0RThDXHU2QjIxXHU1MTQzXHVGRjA4QU5JTUVcdUZGMDlcIik7XG4gICAgICAgIGQuYWRkT3B0aW9uKFwiUkVBTFwiLCBcIlx1NEUwOVx1NkIyMVx1NTE0M1x1RkYwOFJFQUxcdUZGMDlcIik7XG4gICAgICAgIGQuYWRkT3B0aW9uKFwiRk9VUlwiLCBcIjRcdTk4OTFcdTkwNTNcdUZGMDhGT1VSXHVGRjA5XCIpO1xuICAgICAgICBkLnNldFZhbHVlKHpvbmUpLm9uQ2hhbmdlKCh2KSA9PiAoem9uZSA9IHYgYXMgWm9uZSkpO1xuICAgICAgfSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuc2V0TmFtZShcIlx1NTNFRlx1ODlDMVx1NjAyN1wiKVxuICAgICAgLmFkZERyb3Bkb3duKChkKSA9PiB7XG4gICAgICAgIGQuYWRkT3B0aW9uKFwiTE9HSU5fT05MWVwiLCBcIlx1NEVDNVx1NzY3Qlx1NUY1NVx1NzUyOFx1NjIzN1wiKTtcbiAgICAgICAgZC5hZGRPcHRpb24oXCJQVUJMSUNcIiwgXCJcdTUxNkNcdTVGMDBcIik7XG4gICAgICAgIGQuYWRkT3B0aW9uKFwiRlJJRU5EU19PTkxZXCIsIFwiXHU0RUM1XHU1OTdEXHU1M0NCXCIpO1xuICAgICAgICBkLnNldFZhbHVlKHZpc2liaWxpdHkpLm9uQ2hhbmdlKCh2KSA9PiAodmlzaWJpbGl0eSA9IHYgYXMgVmlzaWJpbGl0eSkpO1xuICAgICAgfSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuc2V0TmFtZShcIlx1NjgwN1x1N0I3RVwiKVxuICAgICAgLnNldERlc2MoXCJcdTU5MUFcdTRFMkFcdTY4MDdcdTdCN0VcdTc1MjhcdTkwMTdcdTUzRjdcdTUyMDZcdTk2OTRcIilcbiAgICAgIC5hZGRUZXh0KCh0KSA9PlxuICAgICAgICB0XG4gICAgICAgICAgLnNldFBsYWNlaG9sZGVyKFwidGFnMSwgdGFnMlwiKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0YWdzKVxuICAgICAgICAgIC5vbkNoYW5nZSgodikgPT4gKHRhZ3MgPSB2KSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuc2V0TmFtZShcIlx1N0FDQlx1NTM3M1x1NTNEMVx1NUUwM1wiKVxuICAgICAgLnNldERlc2MoXCJcdTUxNzNcdTk1RURcdTUyMTlcdTRGRERcdTVCNThcdTRFM0FcdTgzNDlcdTdBM0ZcIilcbiAgICAgIC5hZGRUb2dnbGUoKHQpID0+XG4gICAgICAgIHQuc2V0VmFsdWUocHVibGlzaGVkKS5vbkNoYW5nZSgodikgPT4gKHB1Ymxpc2hlZCA9IHYpKVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbCkuYWRkQnV0dG9uKChidG4pID0+XG4gICAgICBidG5cbiAgICAgICAgLnNldEJ1dHRvblRleHQoXCJcdTUzRDFcdTVFMDNcIilcbiAgICAgICAgLnNldEN0YSgpXG4gICAgICAgIC5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICAgICAgY29uc3QgdGFnTGlzdCA9IHRhZ3NcbiAgICAgICAgICAgIC5zcGxpdChcIixcIilcbiAgICAgICAgICAgIC5tYXAoKHQpID0+IHQudHJpbSgpKVxuICAgICAgICAgICAgLmZpbHRlcihCb29sZWFuKTtcbiAgICAgICAgICAvLyBXcml0ZSBtZXRhIHRvIGZyb250bWF0dGVyIGZpcnN0IHNvIGRvUHVzaCBjYW4gcmVhZCBpdFxuICAgICAgICAgIGF3YWl0IHRoaXMuYXBwLmZpbGVNYW5hZ2VyLnByb2Nlc3NGcm9udE1hdHRlcih0aGlzLmZpbGUsIChmKSA9PiB7XG4gICAgICAgICAgICBmW1widGl0bGVcIl0gPSB0aXRsZTtcbiAgICAgICAgICAgIGZbXCJibG9nLXpvbmVcIl0gPSB6b25lO1xuICAgICAgICAgICAgZltcImJsb2ctdmlzaWJpbGl0eVwiXSA9IHZpc2liaWxpdHk7XG4gICAgICAgICAgICBmW1wiYmxvZy1wdWJsaXNoZWRcIl0gPSBwdWJsaXNoZWQ7XG4gICAgICAgICAgICBmW1wiYmxvZy10YWdzXCJdID0gdGFnTGlzdDtcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5kb1B1c2goXG4gICAgICAgICAgICB0aGlzLmZpbGUsXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHRpdGxlLFxuICAgICAgICAgICAgICBcImJsb2ctem9uZVwiOiB6b25lLFxuICAgICAgICAgICAgICBcImJsb2ctdmlzaWJpbGl0eVwiOiB2aXNpYmlsaXR5LFxuICAgICAgICAgICAgICBcImJsb2ctcHVibGlzaGVkXCI6IHB1Ymxpc2hlZCxcbiAgICAgICAgICAgICAgXCJibG9nLXRhZ3NcIjogdGFnTGlzdCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgICAgICB6b25lXG4gICAgICAgICAgKTtcbiAgICAgICAgfSlcbiAgICApO1xuICB9XG5cbiAgb25DbG9zZSgpIHtcbiAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xuICB9XG59XG5cbi8vID09PT09IFNldHRpbmdzIFRhYiA9PT09PVxuXG5jbGFzcyBMcXNzYmxvZ1NldHRpbmdUYWIgZXh0ZW5kcyBQbHVnaW5TZXR0aW5nVGFiIHtcbiAgcGx1Z2luOiBMcXNzYmxvZ1BsdWdpbjtcblxuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgcGx1Z2luOiBMcXNzYmxvZ1BsdWdpbikge1xuICAgIHN1cGVyKGFwcCwgcGx1Z2luKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgfVxuXG4gIGRpc3BsYXkoKSB7XG4gICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcbiAgICBjb250YWluZXJFbC5lbXB0eSgpO1xuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiaDJcIiwgeyB0ZXh0OiBcImxxc3NibG9nIFN5bmNcIiB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJcdTUzNUFcdTVCQTJcdTU3MzBcdTU3NDBcIilcbiAgICAgIC5zZXREZXNjKFwiXHU0RTBEXHU1NDJCXHU2NzJCXHU1QzNFXHU2NTlDXHU3RUJGXHVGRjBDXHU0RjhCXHU1OTgyIGh0dHBzOi8vbHFzc2Jsb2cuc2VydmVibG9nLm5ldFwiKVxuICAgICAgLmFkZFRleHQoKHQpID0+XG4gICAgICAgIHRcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoXCJodHRwczovL2xxc3NibG9nLnNlcnZlYmxvZy5uZXRcIilcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuYmxvZ1VybClcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHYpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmJsb2dVcmwgPSB2LnJlcGxhY2UoL1xcLyQvLCBcIlwiKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlx1NzUyOFx1NjIzN1x1NTQwRFwiKVxuICAgICAgLmFkZFRleHQoKHQpID0+XG4gICAgICAgIHRcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoXCJ5b3VyLXVzZXJuYW1lXCIpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLnVzZXJuYW1lKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodikgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudXNlcm5hbWUgPSB2LnRyaW0oKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlx1NUJDNlx1NzgwMVwiKVxuICAgICAgLmFkZFRleHQoKHQpID0+IHtcbiAgICAgICAgdC5pbnB1dEVsLnR5cGUgPSBcInBhc3N3b3JkXCI7XG4gICAgICAgIHQuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MucGFzc3dvcmQpLm9uQ2hhbmdlKGFzeW5jICh2KSA9PiB7XG4gICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MucGFzc3dvcmQgPSB2O1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlx1NTQwQ1x1NkI2NVx1NjgzOVx1NjU4N1x1NEVGNlx1NTkzOVwiKVxuICAgICAgLnNldERlc2MoXCJcdTY1ODdcdTdBRTBcdTYzMDlcdTUyMDZcdTUzM0FcdTRGRERcdTVCNThcdTUyMzBcdTVCNTBcdTY1ODdcdTRFRjZcdTU5MzlcdUZGMUFibG9nL2FuaW1lIFx1MDBCNyBibG9nL3JlYWwgXHUwMEI3IGJsb2cvZm91clwiKVxuICAgICAgLmFkZFRleHQoKHQpID0+XG4gICAgICAgIHRcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoXCJibG9nXCIpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLnN5bmNGb2xkZXIpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2KSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5zeW5jRm9sZGVyID0gdi50cmltKCkucmVwbGFjZSgvXFwvJC8sIFwiXCIpO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiXHU2RDRCXHU4QkQ1XHU4RkRFXHU2M0E1XCIpXG4gICAgICAuc2V0RGVzYyhcIlx1OUE4Q1x1OEJDMVx1NzUyOFx1NjIzN1x1NTQwRFx1NTQ4Q1x1NUJDNlx1NzgwMVx1NjYyRlx1NTQyNlx1NkI2M1x1Nzg2RVwiKVxuICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PlxuICAgICAgICBidG4uc2V0QnV0dG9uVGV4dChcIlx1NkQ0Qlx1OEJENVwiKS5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICBidG4uc2V0QnV0dG9uVGV4dChcIlx1OEZERVx1NjNBNVx1NEUyRFx1MjAyNlwiKS5zZXREaXNhYmxlZCh0cnVlKTtcbiAgICAgICAgICBjb25zdCB7IG9rLCByZWFzb24gfSA9IGF3YWl0IHRoaXMucGx1Z2luLmxvZ2luKCk7XG4gICAgICAgICAgYnRuLnNldERpc2FibGVkKGZhbHNlKTtcbiAgICAgICAgICBpZiAob2spIHtcbiAgICAgICAgICAgIGJ0bi5zZXRCdXR0b25UZXh0KFwiXHUyNzEzIFx1NjIxMFx1NTI5RlwiKTtcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoXCJscXNzYmxvZzogXHU3NjdCXHU1RjU1XHU2MjEwXHU1MjlGXCIpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBidG4uc2V0QnV0dG9uVGV4dChcIlx1MjcxNyBcdTU5MzFcdThEMjVcIik7XG4gICAgICAgICAgICBuZXcgTm90aWNlKGBscXNzYmxvZzogXHU3NjdCXHU1RjU1XHU1OTMxXHU4RDI1IFx1MjAxNCAke3JlYXNvbn1gLCA4MDAwKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgc2V0VGltZW91dCgoKSA9PiBidG4uc2V0QnV0dG9uVGV4dChcIlx1NkQ0Qlx1OEJENVwiKSwgNDAwMCk7XG4gICAgICAgIH0pXG4gICAgICApO1xuICB9XG59XG5cbi8vID09PT09IFV0aWxpdHkgPT09PT1cblxuZnVuY3Rpb24gc3RyaXBGcm9udG1hdHRlcihjb250ZW50OiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoIWNvbnRlbnQuc3RhcnRzV2l0aChcIi0tLVwiKSkgcmV0dXJuIGNvbnRlbnQ7XG4gIGNvbnN0IGVuZCA9IGNvbnRlbnQuaW5kZXhPZihcIlxcbi0tLVwiLCAzKTtcbiAgaWYgKGVuZCA9PT0gLTEpIHJldHVybiBjb250ZW50O1xuICByZXR1cm4gY29udGVudC5zbGljZShlbmQgKyA0KS50cmltU3RhcnQoKTtcbn1cblxuZnVuY3Rpb24gcGFyc2VUYWdzKHJhdzogdW5rbm93bik6IHN0cmluZ1tdIHtcbiAgaWYgKCFyYXcpIHJldHVybiBbXTtcbiAgaWYgKEFycmF5LmlzQXJyYXkocmF3KSkgcmV0dXJuIChyYXcgYXMgdW5rbm93bltdKS5tYXAoU3RyaW5nKS5maWx0ZXIoQm9vbGVhbik7XG4gIGlmICh0eXBlb2YgcmF3ID09PSBcInN0cmluZ1wiKVxuICAgIHJldHVybiByYXdcbiAgICAgIC5zcGxpdChcIixcIilcbiAgICAgIC5tYXAoKHQpID0+IHQudHJpbSgpKVxuICAgICAgLmZpbHRlcihCb29sZWFuKTtcbiAgcmV0dXJuIFtdO1xufVxuXG5mdW5jdGlvbiBzYWZlRmlsZW5hbWUobmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5hbWUucmVwbGFjZSgvW1xcXFwvOio/XCI8PnxdL2csIFwiLVwiKS50cmltKCkuc2xpY2UoMCwgMTAwKTtcbn1cblxuZnVuY3Rpb24gYnVpbGROb3RlQ29udGVudChwb3N0OiBCbG9nUG9zdCk6IHN0cmluZyB7XG4gIGNvbnN0IHRhZ3MgPSBwb3N0LnRhZ3MubWFwKCh0KSA9PiB0LnRhZy5uYW1lKTtcbiAgY29uc3QgbGluZXMgPSBbXG4gICAgXCItLS1cIixcbiAgICBgdGl0bGU6IFwiJHtwb3N0LnRpdGxlLnJlcGxhY2UoL1wiL2csICdcXFxcXCInKX1cImAsXG4gICAgYGJsb2ctaWQ6IFwiJHtwb3N0LmlkfVwiYCxcbiAgICBgYmxvZy16b25lOiAke3Bvc3Quem9uZX1gLFxuICAgIGBibG9nLXZpc2liaWxpdHk6ICR7cG9zdC52aXNpYmlsaXR5fWAsXG4gICAgYGJsb2ctcHVibGlzaGVkOiAke3Bvc3QucHVibGlzaGVkfWAsXG4gIF07XG4gIGlmICh0YWdzLmxlbmd0aCkge1xuICAgIGxpbmVzLnB1c2goYGJsb2ctdGFnczogWyR7dGFncy5tYXAoKHQpID0+IGBcIiR7dH1cImApLmpvaW4oXCIsIFwiKX1dYCk7XG4gIH1cbiAgbGluZXMucHVzaChcbiAgICBgYmxvZy1zeW5jZWQtYXQ6IFwiJHtuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCl9XCJgLFxuICAgIGBibG9nLXVwZGF0ZWQtYXQ6IFwiJHtwb3N0LnVwZGF0ZWRBdH1cImAsXG4gICAgXCItLS1cIixcbiAgICBcIlwiLFxuICAgIHBvc3QuY29udGVudFxuICApO1xuICByZXR1cm4gbGluZXMuam9pbihcIlxcblwiKTtcbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLHNCQVdPO0FBMkJQLElBQU0s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
