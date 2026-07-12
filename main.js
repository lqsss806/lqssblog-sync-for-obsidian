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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7XG4gIEFwcCxcbiAgTW9kYWwsXG4gIE5vdGljZSxcbiAgUGx1Z2luLFxuICBQbHVnaW5TZXR0aW5nVGFiLFxuICBTZXR0aW5nLFxuICBURmlsZSxcbiAgcmVxdWVzdFVybCxcbiAgUmVxdWVzdFVybFBhcmFtLFxuICBSZXF1ZXN0VXJsUmVzcG9uc2UsXG59IGZyb20gXCJvYnNpZGlhblwiO1xuXG4vLyA9PT09PSBUeXBlcyA9PT09PVxuXG50eXBlIFpvbmUgPSBcIkFOSU1FXCIgfCBcIlJFQUxcIiB8IFwiRk9VUlwiO1xudHlwZSBWaXNpYmlsaXR5ID0gXCJQVUJMSUNcIiB8IFwiTE9HSU5fT05MWVwiIHwgXCJGUklFTkRTX09OTFlcIjtcblxuaW50ZXJmYWNlIEJsb2dQb3N0IHtcbiAgaWQ6IHN0cmluZztcbiAgdGl0bGU6IHN0cmluZztcbiAgY29udGVudDogc3RyaW5nO1xuICB6b25lOiBab25lO1xuICB2aXNpYmlsaXR5OiBWaXNpYmlsaXR5O1xuICBwdWJsaXNoZWQ6IGJvb2xlYW47XG4gIGNyZWF0ZWRBdDogc3RyaW5nO1xuICB1cGRhdGVkQXQ6IHN0cmluZztcbiAgdGFnczogeyB0YWc6IHsgbmFtZTogc3RyaW5nIH0gfVtdO1xufVxuXG5pbnRlcmZhY2UgTHFzc2Jsb2dTZXR0aW5ncyB7XG4gIGJsb2dVcmw6IHN0cmluZztcbiAgdXNlcm5hbWU6IHN0cmluZztcbiAgcGFzc3dvcmQ6IHN0cmluZztcbiAgc3luY0ZvbGRlcjogc3RyaW5nO1xuICB0b2tlbjogc3RyaW5nO1xufVxuXG5jb25zdCBERUZBVUxUX1NFVFRJTkdTOiBMcXNzYmxvZ1NldHRpbmdzID0ge1xuICBibG9nVXJsOiBcImh0dHBzOi8vbHFzc2Jsb2cuc2VydmVibG9nLm5ldFwiLFxuICB1c2VybmFtZTogXCJcIixcbiAgcGFzc3dvcmQ6IFwiXCIsXG4gIHN5bmNGb2xkZXI6IFwiYmxvZ1wiLFxuICB0b2tlbjogXCJcIixcbn07XG5cbmNvbnN0IFpPTkVfU1VCRk9MREVSOiBSZWNvcmQ8Wm9uZSwgc3RyaW5nPiA9IHtcbiAgQU5JTUU6IFwiMlwiLFxuICBSRUFMOiBcIjNcIixcbiAgRk9VUjogXCI0XCIsXG59O1xuXG4vLyA9PT09PSBQbHVnaW4gPT09PT1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgTHFzc2Jsb2dQbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xuICBzZXR0aW5nczogTHFzc2Jsb2dTZXR0aW5ncztcblxuICBhc3luYyBvbmxvYWQoKSB7XG4gICAgYXdhaXQgdGhpcy5sb2FkU2V0dGluZ3MoKTtcblxuICAgIC8vIFJpYmJvbiBpY29uXG4gICAgdGhpcy5hZGRSaWJib25JY29uKFwiY2xvdWRcIiwgXCJscXNzYmxvZyBTeW5jXCIsICgpID0+IHtcbiAgICAgIG5ldyBTeW5jTW9kYWwodGhpcy5hcHAsIHRoaXMpLm9wZW4oKTtcbiAgICB9KTtcblxuICAgIC8vIENvbW1hbmRzXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcInB1c2gtY3VycmVudC1ub3RlXCIsXG4gICAgICBuYW1lOiBcIlx1NjNBOFx1OTAwMVx1NUY1M1x1NTI0RFx1N0IxNFx1OEJCMFx1NTIzMFx1NTM1QVx1NUJBMlwiLFxuICAgICAgY2FsbGJhY2s6ICgpID0+IHtcbiAgICAgICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVGaWxlKCk7XG4gICAgICAgIGlmIChmaWxlKSB0aGlzLnB1c2hOb3RlKGZpbGUpO1xuICAgICAgICBlbHNlIG5ldyBOb3RpY2UoXCJscXNzYmxvZzogXHU2Q0ExXHU2NzA5XHU2MjUzXHU1RjAwXHU3Njg0XHU3QjE0XHU4QkIwXCIpO1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJwdWxsLWFsbC1wb3N0c1wiLFxuICAgICAgbmFtZTogXCJcdTRFQ0VcdTUzNUFcdTVCQTJcdTYyQzlcdTUzRDZcdTUxNjhcdTkwRThcdTY1ODdcdTdBRTBcIixcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB0aGlzLnB1bGxBbGxQb3N0cygpLFxuICAgIH0pO1xuXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcInN5bmMtYWxsXCIsXG4gICAgICBuYW1lOiBcIlx1NEUwRVx1NTM1QVx1NUJBMlx1NTE2OFx1OTFDRlx1NTNDQ1x1NTQxMVx1NTQwQ1x1NkI2NVwiLFxuICAgICAgY2FsbGJhY2s6ICgpID0+IHRoaXMuc3luY0FsbCgpLFxuICAgIH0pO1xuXG4gICAgLy8gUmlnaHQtY2xpY2sgY29udGV4dCBtZW51XG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLm9uKFwiZmlsZS1tZW51XCIsIChtZW51LCBmaWxlKSA9PiB7XG4gICAgICAgIGlmIChmaWxlIGluc3RhbmNlb2YgVEZpbGUgJiYgZmlsZS5leHRlbnNpb24gPT09IFwibWRcIikge1xuICAgICAgICAgIG1lbnUuYWRkSXRlbSgoaXRlbSkgPT4ge1xuICAgICAgICAgICAgaXRlbVxuICAgICAgICAgICAgICAuc2V0VGl0bGUoXCJcdTYzQThcdTkwMDFcdTUyMzAgbHFzc2Jsb2dcIilcbiAgICAgICAgICAgICAgLnNldEljb24oXCJ1cGxvYWQtY2xvdWRcIilcbiAgICAgICAgICAgICAgLm9uQ2xpY2soKCkgPT4gdGhpcy5wdXNoTm90ZShmaWxlKSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgKTtcblxuICAgIHRoaXMuYWRkU2V0dGluZ1RhYihuZXcgTHFzc2Jsb2dTZXR0aW5nVGFiKHRoaXMuYXBwLCB0aGlzKSk7XG4gIH1cblxuICBvbnVubG9hZCgpIHt9XG5cbiAgLy8gPT09PT0gQXV0aCA9PT09PVxuXG4gIGFzeW5jIGxvZ2luKCk6IFByb21pc2U8eyBvazogYm9vbGVhbjsgcmVhc29uOiBzdHJpbmcgfT4ge1xuICAgIGlmICghdGhpcy5zZXR0aW5ncy51c2VybmFtZSB8fCAhdGhpcy5zZXR0aW5ncy5wYXNzd29yZCkge1xuICAgICAgcmV0dXJuIHsgb2s6IGZhbHNlLCByZWFzb246IFwiXHU3NTI4XHU2MjM3XHU1NDBEXHU2MjE2XHU1QkM2XHU3ODAxXHU2NzJBXHU1ODZCXHU1MTk5XCIgfTtcbiAgICB9XG4gICAgbGV0IHJlc3A6IFJlcXVlc3RVcmxSZXNwb25zZTtcbiAgICB0cnkge1xuICAgICAgcmVzcCA9IGF3YWl0IHJlcXVlc3RVcmwoe1xuICAgICAgICB1cmw6IGAke3RoaXMuc2V0dGluZ3MuYmxvZ1VybH0vYXBpL2F1dGgvbG9naW5gLFxuICAgICAgICBtZXRob2Q6IFwiUE9TVFwiLFxuICAgICAgICBoZWFkZXJzOiB7IFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiIH0sXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICB1c2VybmFtZTogdGhpcy5zZXR0aW5ncy51c2VybmFtZSxcbiAgICAgICAgICBwYXNzd29yZDogdGhpcy5zZXR0aW5ncy5wYXNzd29yZCxcbiAgICAgICAgfSksXG4gICAgICAgIHRocm93OiBmYWxzZSxcbiAgICAgIH0pO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHJldHVybiB7IG9rOiBmYWxzZSwgcmVhc29uOiBgXHU3RjUxXHU3RURDXHU5NTE5XHU4QkVGOiAke1N0cmluZyhlKX1gIH07XG4gICAgfVxuXG4gICAgaWYgKHJlc3Auc3RhdHVzICE9PSAyMDApIHtcbiAgICAgIGxldCBtc2cgPSBcIlwiO1xuICAgICAgdHJ5IHsgbXNnID0gcmVzcC5qc29uPy5lcnJvciA/PyByZXNwLnRleHQ7IH0gY2F0Y2ggeyBtc2cgPSBTdHJpbmcocmVzcC5zdGF0dXMpOyB9XG4gICAgICByZXR1cm4geyBvazogZmFsc2UsIHJlYXNvbjogYEhUVFAgJHtyZXNwLnN0YXR1c306ICR7bXNnfWAgfTtcbiAgICB9XG5cbiAgICBsZXQgdG9rZW46IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICB0cnkgeyB0b2tlbiA9IHJlc3AuanNvbj8udG9rZW47IH0gY2F0Y2ggeyAvKiBpZ25vcmUgKi8gfVxuICAgIGlmICghdG9rZW4pIHtcbiAgICAgIHJldHVybiB7IG9rOiBmYWxzZSwgcmVhc29uOiBcIlx1NTRDRFx1NUU5NFx1NEUyRFx1NkNBMVx1NjcwOSB0b2tlbiBcdTVCNTdcdTZCQjVcIiB9O1xuICAgIH1cblxuICAgIHRoaXMuc2V0dGluZ3MudG9rZW4gPSB0b2tlbjtcbiAgICBhd2FpdCB0aGlzLnNhdmVTZXR0aW5ncygpO1xuICAgIHJldHVybiB7IG9rOiB0cnVlLCByZWFzb246IFwiXHU3NjdCXHU1RjU1XHU2MjEwXHU1MjlGXCIgfTtcbiAgfVxuXG4gIGdldEhlYWRlcnMoKTogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB7XG4gICAgcmV0dXJuIHtcbiAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgQ29va2llOiBgdG9rZW49JHt0aGlzLnNldHRpbmdzLnRva2VufWAsXG4gICAgfTtcbiAgfVxuXG4gIC8vIEF1dG8tcmV0cnkgd2l0aCByZS1sb2dpbiBvbiA0MDFcbiAgYXN5bmMgYXBpUmVxKFxuICAgIG9wdGlvbnM6IFJlcXVlc3RVcmxQYXJhbSxcbiAgICByZXRyaWVkID0gZmFsc2VcbiAgKTogUHJvbWlzZTxSZXF1ZXN0VXJsUmVzcG9uc2U+IHtcbiAgICBjb25zdCByZXNwID0gYXdhaXQgcmVxdWVzdFVybCh7XG4gICAgICAuLi5vcHRpb25zLFxuICAgICAgaGVhZGVyczogeyAuLi50aGlzLmdldEhlYWRlcnMoKSwgLi4uKG9wdGlvbnMuaGVhZGVycyA/PyB7fSkgfSxcbiAgICAgIHRocm93OiBmYWxzZSxcbiAgICB9KTtcbiAgICBpZiAocmVzcC5zdGF0dXMgPT09IDQwMSAmJiAhcmV0cmllZCkge1xuICAgICAgY29uc3QgeyBvayB9ID0gYXdhaXQgdGhpcy5sb2dpbigpO1xuICAgICAgaWYgKG9rKSByZXR1cm4gdGhpcy5hcGlSZXEob3B0aW9ucywgdHJ1ZSk7XG4gICAgfVxuICAgIHJldHVybiByZXNwO1xuICB9XG5cbiAgLy8gPT09PT0gQVBJID09PT09XG5cbiAgYXN5bmMgZmV0Y2hNeVBvc3RzKCk6IFByb21pc2U8QmxvZ1Bvc3RbXT4ge1xuICAgIGNvbnN0IHJlc3AgPSBhd2FpdCB0aGlzLmFwaVJlcSh7XG4gICAgICB1cmw6IGAke3RoaXMuc2V0dGluZ3MuYmxvZ1VybH0vYXBpL3VzZXIvcG9zdHNgLFxuICAgIH0pO1xuICAgIGlmIChyZXNwLnN0YXR1cyAhPT0gMjAwKSByZXR1cm4gW107XG4gICAgcmV0dXJuIChyZXNwLmpzb24gYXMgeyBwb3N0czogQmxvZ1Bvc3RbXSB9KS5wb3N0cyA/PyBbXTtcbiAgfVxuXG4gIGFzeW5jIGNyZWF0ZVBvc3QoZGF0YToge1xuICAgIHRpdGxlOiBzdHJpbmc7XG4gICAgY29udGVudDogc3RyaW5nO1xuICAgIHpvbmU6IFpvbmU7XG4gICAgdmlzaWJpbGl0eTogVmlzaWJpbGl0eTtcbiAgICBwdWJsaXNoZWQ6IGJvb2xlYW47XG4gICAgdGFnczogc3RyaW5nW107XG4gIH0pOiBQcm9taXNlPEJsb2dQb3N0IHwgbnVsbD4ge1xuICAgIGNvbnN0IHJlc3AgPSBhd2FpdCB0aGlzLmFwaVJlcSh7XG4gICAgICB1cmw6IGAke3RoaXMuc2V0dGluZ3MuYmxvZ1VybH0vYXBpL3Bvc3RzYCxcbiAgICAgIG1ldGhvZDogXCJQT1NUXCIsXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShkYXRhKSxcbiAgICB9KTtcbiAgICBpZiAocmVzcC5zdGF0dXMgIT09IDIwMSkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIChyZXNwLmpzb24gYXMgeyBwb3N0OiBCbG9nUG9zdCB9KS5wb3N0ID8/IG51bGw7XG4gIH1cblxuICBhc3luYyB1cGRhdGVQb3N0KFxuICAgIGlkOiBzdHJpbmcsXG4gICAgZGF0YToge1xuICAgICAgdGl0bGU6IHN0cmluZztcbiAgICAgIGNvbnRlbnQ6IHN0cmluZztcbiAgICAgIHpvbmU6IFpvbmU7XG4gICAgICB2aXNpYmlsaXR5OiBWaXNpYmlsaXR5O1xuICAgICAgcHVibGlzaGVkOiBib29sZWFuO1xuICAgICAgdGFnczogc3RyaW5nW107XG4gICAgfVxuICApOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBjb25zdCByZXNwID0gYXdhaXQgdGhpcy5hcGlSZXEoe1xuICAgICAgdXJsOiBgJHt0aGlzLnNldHRpbmdzLmJsb2dVcmx9L2FwaS9wb3N0cy8ke2lkfWAsXG4gICAgICBtZXRob2Q6IFwiUFVUXCIsXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShkYXRhKSxcbiAgICB9KTtcbiAgICByZXR1cm4gcmVzcC5zdGF0dXMgPT09IDIwMDtcbiAgfVxuXG4gIC8vID09PT09IENvcmUgU3luYyA9PT09PVxuXG4gIC8qKiBQdXNoIGEgc2luZ2xlIG5vdGUgdG8gdGhlIGJsb2cuIFNob3dzIFB1Ymxpc2hNb2RhbCBpZiB6b25lIG5vdCBzZXQuICovXG4gIGFzeW5jIHB1c2hOb3RlKGZpbGU6IFRGaWxlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCF0aGlzLnNldHRpbmdzLnVzZXJuYW1lIHx8ICF0aGlzLnNldHRpbmdzLnBhc3N3b3JkKSB7XG4gICAgICBuZXcgTm90aWNlKFwibHFzc2Jsb2c6IFx1OEJGN1x1NTE0OFx1NTcyOFx1NjNEMlx1NEVGNlx1OEJCRVx1N0Y2RVx1OTFDQ1x1NTg2Qlx1NTE5OVx1NzUyOFx1NjIzN1x1NTQwRFx1NTQ4Q1x1NUJDNlx1NzgwMVwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBmbSA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpPy5mcm9udG1hdHRlciA/PyB7fTtcbiAgICBjb25zdCB6b25lID0gZm1bXCJibG9nLXpvbmVcIl0gYXMgWm9uZSB8IHVuZGVmaW5lZDtcblxuICAgIGlmICghem9uZSkge1xuICAgICAgbmV3IFB1Ymxpc2hNb2RhbCh0aGlzLmFwcCwgdGhpcywgZmlsZSkub3BlbigpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuZG9QdXNoKGZpbGUsIGZtIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBmbVtcImJsb2ctaWRcIl0gYXMgc3RyaW5nIHwgdW5kZWZpbmVkLCB6b25lKTtcbiAgfVxuXG4gIC8qKiBBY3R1YWxseSBwdXNoIHRoZSBub3RlIChjYWxsZWQgYWZ0ZXIgem9uZSBpcyBjb25maXJtZWQpLiAqL1xuICBhc3luYyBkb1B1c2goXG4gICAgZmlsZTogVEZpbGUsXG4gICAgZm06IFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuICAgIGJsb2dJZDogc3RyaW5nIHwgdW5kZWZpbmVkLFxuICAgIHpvbmU6IFpvbmVcbiAgKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgY29uc3QgcmF3Q29udGVudCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LnJlYWQoZmlsZSk7XG4gICAgY29uc3QgYm9keSA9IHN0cmlwRnJvbnRtYXR0ZXIocmF3Q29udGVudCk7XG5cbiAgICBjb25zdCB0aXRsZSA9IChmbVtcInRpdGxlXCJdIGFzIHN0cmluZykgfHwgZmlsZS5iYXNlbmFtZTtcbiAgICBjb25zdCB2aXNpYmlsaXR5ID0gKGZtW1wiYmxvZy12aXNpYmlsaXR5XCJdIGFzIFZpc2liaWxpdHkpIHx8IFwiTE9HSU5fT05MWVwiO1xuICAgIGNvbnN0IHB1Ymxpc2hlZCA9IChmbVtcImJsb2ctcHVibGlzaGVkXCJdIGFzIGJvb2xlYW4pID8/IGZhbHNlO1xuICAgIGNvbnN0IHRhZ3MgPSBwYXJzZVRhZ3MoZm1bXCJibG9nLXRhZ3NcIl0pO1xuXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgIGNvbnN0IGRhdGEgPSB7IHRpdGxlLCBjb250ZW50OiBib2R5LCB6b25lLCB2aXNpYmlsaXR5LCBwdWJsaXNoZWQsIHRhZ3MgfTtcblxuICAgIGlmIChibG9nSWQpIHtcbiAgICAgIGNvbnN0IG9rID0gYXdhaXQgdGhpcy51cGRhdGVQb3N0KGJsb2dJZCwgZGF0YSk7XG4gICAgICBpZiAoIW9rKSB7XG4gICAgICAgIG5ldyBOb3RpY2UoYGxxc3NibG9nOiBcdTI3MTcgXHU2NkY0XHU2NUIwXHU1OTMxXHU4RDI1IFx1MjAxNFx1MzAwQyR7dGl0bGV9XHUzMDBEYCk7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgcG9zdCA9IGF3YWl0IHRoaXMuY3JlYXRlUG9zdChkYXRhKTtcbiAgICAgIGlmICghcG9zdCkge1xuICAgICAgICBuZXcgTm90aWNlKGBscXNzYmxvZzogXHUyNzE3IFx1NTNEMVx1NUUwM1x1NTkzMVx1OEQyNSBcdTIwMTRcdTMwMEMke3RpdGxlfVx1MzAwRGApO1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgICBibG9nSWQgPSBwb3N0LmlkO1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuYXBwLmZpbGVNYW5hZ2VyLnByb2Nlc3NGcm9udE1hdHRlcihmaWxlLCAoZikgPT4ge1xuICAgICAgZltcImJsb2ctaWRcIl0gPSBibG9nSWQ7XG4gICAgICBmW1wiYmxvZy1zeW5jZWQtYXRcIl0gPSBub3c7XG4gICAgICBmW1wiYmxvZy11cGRhdGVkLWF0XCJdID0gbm93O1xuICAgIH0pO1xuXG4gICAgbmV3IE5vdGljZShgbHFzc2Jsb2c6IFx1MjcxMyBcdTVERjJcdTYzQThcdTkwMDFcdTMwMEMke3RpdGxlfVx1MzAwRGApO1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgLyoqIFB1bGwgYWxsIHVzZXIncyBwb3N0cyBmcm9tIHRoZSBibG9nIGludG8gdGhlIHN5bmMgZm9sZGVyLiAqL1xuICBhc3luYyBwdWxsQWxsUG9zdHMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCF0aGlzLnNldHRpbmdzLnVzZXJuYW1lIHx8ICF0aGlzLnNldHRpbmdzLnBhc3N3b3JkKSB7XG4gICAgICBuZXcgTm90aWNlKFwibHFzc2Jsb2c6IFx1OEJGN1x1NTE0OFx1NTcyOFx1NjNEMlx1NEVGNlx1OEJCRVx1N0Y2RVx1OTFDQ1x1NTg2Qlx1NTE5OVx1NzUyOFx1NjIzN1x1NTQwRFx1NTQ4Q1x1NUJDNlx1NzgwMVwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBuZXcgTm90aWNlKFwibHFzc2Jsb2c6IFx1NkI2M1x1NTcyOFx1NjJDOVx1NTNENlx1MjAyNlwiKTtcbiAgICBjb25zdCBwb3N0cyA9IGF3YWl0IHRoaXMuZmV0Y2hNeVBvc3RzKCk7XG5cbiAgICBpZiAoIXBvc3RzLmxlbmd0aCkge1xuICAgICAgbmV3IE5vdGljZShcImxxc3NibG9nOiBcdTUzNUFcdTVCQTJcdTRFMEFcdThGRDhcdTZDQTFcdTY3MDlcdTY1ODdcdTdBRTBcIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5lbnN1cmVTeW5jRm9sZGVyKCk7XG5cbiAgICBsZXQgcHVsbGVkID0gMCwgc2tpcHBlZCA9IDA7XG5cbiAgICBmb3IgKGNvbnN0IHBvc3Qgb2YgcG9zdHMpIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5maW5kRmlsZUJ5QmxvZ0lkKHBvc3QuaWQpO1xuICAgICAgY29uc3Qgc3luY2VkQXQgPSBleGlzdGluZ1xuICAgICAgICA/ICh0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShleGlzdGluZyk/LmZyb250bWF0dGVyPy5bXG4gICAgICAgICAgICBcImJsb2ctc3luY2VkLWF0XCJcbiAgICAgICAgICBdIGFzIHN0cmluZyB8IHVuZGVmaW5lZClcbiAgICAgICAgOiB1bmRlZmluZWQ7XG5cbiAgICAgIGNvbnN0IGJsb2dVcGRhdGVkQXQgPSBuZXcgRGF0ZShwb3N0LnVwZGF0ZWRBdCkuZ2V0VGltZSgpO1xuICAgICAgY29uc3QgbGFzdFN5bmNUaW1lID0gc3luY2VkQXQgPyBuZXcgRGF0ZShzeW5jZWRBdCkuZ2V0VGltZSgpIDogMDtcblxuICAgICAgaWYgKGV4aXN0aW5nICYmIGJsb2dVcGRhdGVkQXQgPD0gbGFzdFN5bmNUaW1lKSB7XG4gICAgICAgIHNraXBwZWQrKztcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNvbnRlbnQgPSBidWlsZE5vdGVDb250ZW50KHBvc3QpO1xuICAgICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0Lm1vZGlmeShleGlzdGluZywgY29udGVudCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCBwYXRoID0gYXdhaXQgdGhpcy51bmlxdWVQYXRoKFxuICAgICAgICAgIGAke3RoaXMuem9uZUZvbGRlcihwb3N0LnpvbmUpfS8ke3NhZmVGaWxlbmFtZShwb3N0LnRpdGxlKSB8fCBwb3N0LmlkfS5tZGBcbiAgICAgICAgKTtcbiAgICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuY3JlYXRlKHBhdGgsIGNvbnRlbnQpO1xuICAgICAgfVxuICAgICAgcHVsbGVkKys7XG4gICAgfVxuXG4gICAgbmV3IE5vdGljZShgbHFzc2Jsb2c6IFx1NjJDOVx1NTNENlx1NUI4Q1x1NjIxMCBcdTIwMTRcdTIwMTQgXHU2NkY0XHU2NUIwICR7cHVsbGVkfSBcdTdCQzdcdUZGMENcdThERjNcdThGQzcgJHtza2lwcGVkfSBcdTdCQzdgKTtcbiAgfVxuXG4gIC8qKiBGdWxsIGJpZGlyZWN0aW9uYWwgc3luYy4gKi9cbiAgYXN5bmMgc3luY0FsbCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMuc2V0dGluZ3MudXNlcm5hbWUgfHwgIXRoaXMuc2V0dGluZ3MucGFzc3dvcmQpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJscXNzYmxvZzogXHU4QkY3XHU1MTQ4XHU1NzI4XHU2M0QyXHU0RUY2XHU4QkJFXHU3RjZFXHU5MUNDXHU1ODZCXHU1MTk5XHU3NTI4XHU2MjM3XHU1NDBEXHU1NDhDXHU1QkM2XHU3ODAxXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIG5ldyBOb3RpY2UoXCJscXNzYmxvZzogXHU1RjAwXHU1OUNCXHU1M0NDXHU1NDExXHU1NDBDXHU2QjY1XHUyMDI2XCIpO1xuICAgIGNvbnN0IHBvc3RzID0gYXdhaXQgdGhpcy5mZXRjaE15UG9zdHMoKTtcbiAgICBjb25zdCBibG9nTWFwID0gbmV3IE1hcDxzdHJpbmcsIEJsb2dQb3N0Pihwb3N0cy5tYXAoKHApID0+IFtwLmlkLCBwXSkpO1xuXG4gICAgYXdhaXQgdGhpcy5lbnN1cmVTeW5jRm9sZGVyKCk7XG5cbiAgICBsZXQgcHVzaGVkID0gMCwgcHVsbGVkID0gMCwgY29uZmxpY3RzID0gMCwgY3JlYXRlZCA9IDA7XG4gICAgY29uc3QgcHJvY2Vzc2VkSWRzID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgICAvLyBQcm9jZXNzIGFsbCBsb2NhbCBmaWxlc1xuICAgIGZvciAoY29uc3QgZmlsZSBvZiB0aGlzLmFwcC52YXVsdC5nZXRNYXJrZG93bkZpbGVzKCkpIHtcbiAgICAgIGNvbnN0IGZtID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUoZmlsZSk/LmZyb250bWF0dGVyID8/IHt9O1xuICAgICAgY29uc3QgYmxvZ0lkID0gZm1bXCJibG9nLWlkXCJdIGFzIHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICAgIGNvbnN0IHpvbmUgPSBmbVtcImJsb2ctem9uZVwiXSBhcyBab25lIHwgdW5kZWZpbmVkO1xuXG4gICAgICBpZiAoIWJsb2dJZCkge1xuICAgICAgICAvLyBOZXcgbG9jYWwgZmlsZSBpbiBhIHpvbmUgc3ViZm9sZGVyIHdpdGggYmxvZy16b25lIHNldCBcdTIxOTIgcHVzaCB0byBjcmVhdGVcbiAgICAgICAgY29uc3QgaW5ab25lRm9sZGVyID1cbiAgICAgICAgICB6b25lICYmIGZpbGUucGF0aC5zdGFydHNXaXRoKHRoaXMuem9uZUZvbGRlcih6b25lKSArIFwiL1wiKTtcbiAgICAgICAgaWYgKGluWm9uZUZvbGRlcikge1xuICAgICAgICAgIGNvbnN0IG9rID0gYXdhaXQgdGhpcy5kb1B1c2goZmlsZSwgZm0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIHVuZGVmaW5lZCwgem9uZSEpO1xuICAgICAgICAgIGlmIChvaykgY3JlYXRlZCsrO1xuICAgICAgICB9XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBwcm9jZXNzZWRJZHMuYWRkKGJsb2dJZCk7XG4gICAgICBjb25zdCBibG9nUG9zdCA9IGJsb2dNYXAuZ2V0KGJsb2dJZCk7XG4gICAgICBpZiAoIWJsb2dQb3N0KSBjb250aW51ZTsgLy8gcG9zdCBkZWxldGVkIG9uIGJsb2cgc2lkZSBcdTIwMTQgc2tpcFxuXG4gICAgICBjb25zdCBzeW5jZWRBdCA9IGZtW1wiYmxvZy1zeW5jZWQtYXRcIl0gYXMgc3RyaW5nIHwgdW5kZWZpbmVkO1xuICAgICAgY29uc3QgbGFzdFN5bmNUaW1lID0gc3luY2VkQXQgPyBuZXcgRGF0ZShzeW5jZWRBdCkuZ2V0VGltZSgpIDogMDtcbiAgICAgIGNvbnN0IGJsb2dVcGRhdGVkQXQgPSBuZXcgRGF0ZShibG9nUG9zdC51cGRhdGVkQXQpLmdldFRpbWUoKTtcbiAgICAgIGNvbnN0IGxvY2FsVXBkYXRlZEF0ID0gZmlsZS5zdGF0Lm10aW1lO1xuICAgICAgY29uc3QgQlVGRkVSID0gNV8wMDA7IC8vIDVzIHRvbGVyYW5jZSBmb3IgY2xvY2sgc2tld1xuXG4gICAgICBjb25zdCBibG9nTmV3ZXIgPSBibG9nVXBkYXRlZEF0ID4gbGFzdFN5bmNUaW1lICsgQlVGRkVSO1xuICAgICAgY29uc3QgbG9jYWxOZXdlciA9IGxvY2FsVXBkYXRlZEF0ID4gbGFzdFN5bmNUaW1lICsgQlVGRkVSO1xuXG4gICAgICBpZiAoYmxvZ05ld2VyICYmIGxvY2FsTmV3ZXIpIHtcbiAgICAgICAgY29uZmxpY3RzKys7XG4gICAgICAgIG5ldyBOb3RpY2UoXG4gICAgICAgICAgYGxxc3NibG9nOiBcdTI2QTAgXHU1MUIyXHU3QTgxIFx1MjAxNFx1MzAwQyR7ZmlsZS5iYXNlbmFtZX1cdTMwMERcdTY3MkNcdTU3MzBcdTU0OENcdThGRENcdTdBRUZcdTkwRkRcdTY3MDlcdTY2RjRcdTY1MzlcdUZGMENcdTVERjJcdThERjNcdThGQzdcdUZGMENcdThCRjdcdTYyNEJcdTUyQThcdTU5MDRcdTc0MDZgXG4gICAgICAgICk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBpZiAobG9jYWxOZXdlcikge1xuICAgICAgICBjb25zdCBvayA9IGF3YWl0IHRoaXMuZG9QdXNoKFxuICAgICAgICAgIGZpbGUsXG4gICAgICAgICAgZm0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4gICAgICAgICAgYmxvZ0lkLFxuICAgICAgICAgIHpvbmUgPz8gKGJsb2dQb3N0LnpvbmUgYXMgWm9uZSlcbiAgICAgICAgKTtcbiAgICAgICAgaWYgKG9rKSBwdXNoZWQrKztcbiAgICAgIH0gZWxzZSBpZiAoYmxvZ05ld2VyKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0Lm1vZGlmeShmaWxlLCBidWlsZE5vdGVDb250ZW50KGJsb2dQb3N0KSk7XG4gICAgICAgIHB1bGxlZCsrO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFB1bGwgcG9zdHMgZnJvbSBibG9nIHRoYXQgZG9uJ3QgZXhpc3QgbG9jYWxseSB5ZXRcbiAgICBmb3IgKGNvbnN0IHBvc3Qgb2YgcG9zdHMpIHtcbiAgICAgIGlmIChwcm9jZXNzZWRJZHMuaGFzKHBvc3QuaWQpKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IHBhdGggPSBhd2FpdCB0aGlzLnVuaXF1ZVBhdGgoXG4gICAgICAgIGAke3RoaXMuem9uZUZvbGRlcihwb3N0LnpvbmUpfS8ke3NhZmVGaWxlbmFtZShwb3N0LnRpdGxlKSB8fCBwb3N0LmlkfS5tZGBcbiAgICAgICk7XG4gICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5jcmVhdGUocGF0aCwgYnVpbGROb3RlQ29udGVudChwb3N0KSk7XG4gICAgICBwdWxsZWQrKztcbiAgICB9XG5cbiAgICBjb25zdCBzdW1tYXJ5ID0gW1xuICAgICAgYFx1MjE5MSBcdTYzQThcdTkwMDEgJHtwdXNoZWQgKyBjcmVhdGVkfWAsXG4gICAgICBgXHUyMTkzIFx1NjJDOVx1NTNENiAke3B1bGxlZH1gLFxuICAgICAgY29uZmxpY3RzID8gYFx1MjZBMCAke2NvbmZsaWN0c30gXHU0RTJBXHU1MUIyXHU3QTgxYCA6IFwiXCIsXG4gICAgXVxuICAgICAgLmZpbHRlcihCb29sZWFuKVxuICAgICAgLmpvaW4oXCIgICBcIik7XG5cbiAgICBuZXcgTm90aWNlKGBscXNzYmxvZzogXHU1NDBDXHU2QjY1XHU1QjhDXHU2MjEwIFx1MjAxNFx1MjAxNCAke3N1bW1hcnl9YCk7XG4gIH1cblxuICAvLyA9PT09PSBIZWxwZXJzID09PT09XG5cbiAgZmluZEZpbGVCeUJsb2dJZChibG9nSWQ6IHN0cmluZyk6IFRGaWxlIHwgbnVsbCB7XG4gICAgZm9yIChjb25zdCBmaWxlIG9mIHRoaXMuYXBwLnZhdWx0LmdldE1hcmtkb3duRmlsZXMoKSkge1xuICAgICAgY29uc3QgZm0gPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShmaWxlKT8uZnJvbnRtYXR0ZXI7XG4gICAgICBpZiAoZm0/LltcImJsb2ctaWRcIl0gPT09IGJsb2dJZCkgcmV0dXJuIGZpbGU7XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgem9uZUZvbGRlcih6b25lOiBab25lKTogc3RyaW5nIHtcbiAgICByZXR1cm4gYCR7dGhpcy5zZXR0aW5ncy5zeW5jRm9sZGVyfS8ke1pPTkVfU1VCRk9MREVSW3pvbmVdfWA7XG4gIH1cblxuICBhc3luYyBlbnN1cmVTeW5jRm9sZGVyKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHJvb3QgPSB0aGlzLnNldHRpbmdzLnN5bmNGb2xkZXI7XG4gICAgaWYgKCEoYXdhaXQgdGhpcy5hcHAudmF1bHQuYWRhcHRlci5leGlzdHMocm9vdCkpKSB7XG4gICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5jcmVhdGVGb2xkZXIocm9vdCk7XG4gICAgfVxuICAgIGZvciAoY29uc3Qgc3ViIG9mIE9iamVjdC52YWx1ZXMoWk9ORV9TVUJGT0xERVIpKSB7XG4gICAgICBjb25zdCBwYXRoID0gYCR7cm9vdH0vJHtzdWJ9YDtcbiAgICAgIGlmICghKGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIuZXhpc3RzKHBhdGgpKSkge1xuICAgICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5jcmVhdGVGb2xkZXIocGF0aCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgdW5pcXVlUGF0aChwYXRoOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGlmICghKGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIuZXhpc3RzKHBhdGgpKSkgcmV0dXJuIHBhdGg7XG4gICAgY29uc3QgYmFzZSA9IHBhdGgucmVwbGFjZSgvXFwubWQkLywgXCJcIik7XG4gICAgbGV0IGkgPSAxO1xuICAgIHdoaWxlIChhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLmV4aXN0cyhgJHtiYXNlfS0ke2l9Lm1kYCkpIGkrKztcbiAgICByZXR1cm4gYCR7YmFzZX0tJHtpfS5tZGA7XG4gIH1cblxuICBhc3luYyBsb2FkU2V0dGluZ3MoKSB7XG4gICAgdGhpcy5zZXR0aW5ncyA9IE9iamVjdC5hc3NpZ24oe30sIERFRkFVTFRfU0VUVElOR1MsIGF3YWl0IHRoaXMubG9hZERhdGEoKSk7XG4gIH1cblxuICBhc3luYyBzYXZlU2V0dGluZ3MoKSB7XG4gICAgYXdhaXQgdGhpcy5zYXZlRGF0YSh0aGlzLnNldHRpbmdzKTtcbiAgfVxufVxuXG4vLyA9PT09PSBTeW5jIE1vZGFsIChSaWJib24gY2xpY2spID09PT09XG5cbmNsYXNzIFN5bmNNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgcGx1Z2luOiBMcXNzYmxvZ1BsdWdpbjtcblxuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgcGx1Z2luOiBMcXNzYmxvZ1BsdWdpbikge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gIH1cblxuICBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmFkZENsYXNzKFwibHFzcy1tb2RhbFwiKTtcbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJoM1wiLCB7IHRleHQ6IFwibHFzc2Jsb2cgU3luY1wiIH0pO1xuXG4gICAgY29uc3QgZ3JpZCA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwibHFzcy1ncmlkXCIgfSk7XG5cbiAgICB0aGlzLmJ0bihncmlkLCBcIlx1MjE5MVwiLCBcIlx1NjNBOFx1OTAwMVx1NUY1M1x1NTI0RFx1N0IxNFx1OEJCMFwiLCBcInVwbG9hZC1jbG91ZFwiLCAoKSA9PiB7XG4gICAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKTtcbiAgICAgIGlmIChmaWxlKSB0aGlzLnBsdWdpbi5wdXNoTm90ZShmaWxlKTtcbiAgICAgIGVsc2UgbmV3IE5vdGljZShcImxxc3NibG9nOiBcdTZDQTFcdTY3MDlcdTYyNTNcdTVGMDBcdTc2ODRcdTdCMTRcdThCQjBcIik7XG4gICAgfSk7XG5cbiAgICB0aGlzLmJ0bihncmlkLCBcIlx1MjE5M1wiLCBcIlx1NjJDOVx1NTNENlx1NTE2OFx1OTBFOFx1NjU4N1x1N0FFMFwiLCBcImRvd25sb2FkLWNsb3VkXCIsICgpID0+IHtcbiAgICAgIHRoaXMucGx1Z2luLnB1bGxBbGxQb3N0cygpO1xuICAgIH0pO1xuXG4gICAgdGhpcy5idG4oZ3JpZCwgXCJcdTIxQzVcIiwgXCJcdTUxNjhcdTkxQ0ZcdTUzQ0NcdTU0MTFcdTU0MENcdTZCNjVcIiwgXCJyZWZyZXNoLWN3XCIsICgpID0+IHtcbiAgICAgIHRoaXMucGx1Z2luLnN5bmNBbGwoKTtcbiAgICB9KTtcbiAgfVxuXG4gIGJ0bihcbiAgICBwYXJlbnQ6IEhUTUxFbGVtZW50LFxuICAgIGljb246IHN0cmluZyxcbiAgICBsYWJlbDogc3RyaW5nLFxuICAgIF9sdWNpZGU6IHN0cmluZyxcbiAgICBvbkNsaWNrOiAoKSA9PiB2b2lkXG4gICkge1xuICAgIGNvbnN0IGJ0biA9IHBhcmVudC5jcmVhdGVFbChcImJ1dHRvblwiLCB7IGNsczogXCJscXNzLWFjdGlvbi1idG5cIiB9KTtcbiAgICBidG4uY3JlYXRlRWwoXCJzcGFuXCIsIHsgY2xzOiBcImxxc3MtYnRuLWljb25cIiwgdGV4dDogaWNvbiB9KTtcbiAgICBidG4uY3JlYXRlRWwoXCJzcGFuXCIsIHsgY2xzOiBcImxxc3MtYnRuLWxhYmVsXCIsIHRleHQ6IGxhYmVsIH0pO1xuICAgIGJ0bi5vbmNsaWNrID0gKCkgPT4ge1xuICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgb25DbGljaygpO1xuICAgIH07XG4gIH1cblxuICBvbkNsb3NlKCkge1xuICAgIHRoaXMuY29udGVudEVsLmVtcHR5KCk7XG4gIH1cbn1cblxuLy8gPT09PT0gUHVibGlzaCBNb2RhbCAoZmlyc3QtdGltZSBwdXNoLCBubyB6b25lIHNldCkgPT09PT1cblxuY2xhc3MgUHVibGlzaE1vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBwbHVnaW46IExxc3NibG9nUGx1Z2luO1xuICBmaWxlOiBURmlsZTtcblxuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgcGx1Z2luOiBMcXNzYmxvZ1BsdWdpbiwgZmlsZTogVEZpbGUpIHtcbiAgICBzdXBlcihhcHApO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICAgIHRoaXMuZmlsZSA9IGZpbGU7XG4gIH1cblxuICBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29uc3QgZm0gPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZSh0aGlzLmZpbGUpPy5mcm9udG1hdHRlciA/PyB7fTtcblxuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcImgzXCIsIHsgdGV4dDogXCJcdTUzRDFcdTVFMDNcdTUyMzAgbHFzc2Jsb2dcIiB9KTtcblxuICAgIGxldCB0aXRsZSA9IChmbVtcInRpdGxlXCJdIGFzIHN0cmluZykgfHwgdGhpcy5maWxlLmJhc2VuYW1lO1xuICAgIGxldCB6b25lOiBab25lID0gXCJBTklNRVwiO1xuICAgIGxldCB2aXNpYmlsaXR5OiBWaXNpYmlsaXR5ID0gXCJMT0dJTl9PTkxZXCI7XG4gICAgbGV0IHB1Ymxpc2hlZCA9IGZhbHNlO1xuICAgIGxldCB0YWdzID0gcGFyc2VUYWdzKGZtW1wiYmxvZy10YWdzXCJdKS5qb2luKFwiLCBcIik7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuc2V0TmFtZShcIlx1NjgwN1x1OTg5OFwiKVxuICAgICAgLmFkZFRleHQoKHQpID0+XG4gICAgICAgIHQuc2V0VmFsdWUodGl0bGUpLm9uQ2hhbmdlKCh2KSA9PiAodGl0bGUgPSB2KSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuc2V0TmFtZShcIlx1NTIwNlx1NTMzQVwiKVxuICAgICAgLmFkZERyb3Bkb3duKChkKSA9PiB7XG4gICAgICAgIGQuYWRkT3B0aW9uKFwiQU5JTUVcIiwgXCJcdTRFOENcdTZCMjFcdTUxNDNcdUZGMDhBTklNRVx1RkYwOVwiKTtcbiAgICAgICAgZC5hZGRPcHRpb24oXCJSRUFMXCIsIFwiXHU0RTA5XHU2QjIxXHU1MTQzXHVGRjA4UkVBTFx1RkYwOVwiKTtcbiAgICAgICAgZC5hZGRPcHRpb24oXCJGT1VSXCIsIFwiNFx1OTg5MVx1OTA1M1x1RkYwOEZPVVJcdUZGMDlcIik7XG4gICAgICAgIGQuc2V0VmFsdWUoem9uZSkub25DaGFuZ2UoKHYpID0+ICh6b25lID0gdiBhcyBab25lKSk7XG4gICAgICB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5zZXROYW1lKFwiXHU1M0VGXHU4OUMxXHU2MDI3XCIpXG4gICAgICAuYWRkRHJvcGRvd24oKGQpID0+IHtcbiAgICAgICAgZC5hZGRPcHRpb24oXCJMT0dJTl9PTkxZXCIsIFwiXHU0RUM1XHU3NjdCXHU1RjU1XHU3NTI4XHU2MjM3XCIpO1xuICAgICAgICBkLmFkZE9wdGlvbihcIlBVQkxJQ1wiLCBcIlx1NTE2Q1x1NUYwMFwiKTtcbiAgICAgICAgZC5hZGRPcHRpb24oXCJGUklFTkRTX09OTFlcIiwgXCJcdTRFQzVcdTU5N0RcdTUzQ0JcIik7XG4gICAgICAgIGQuc2V0VmFsdWUodmlzaWJpbGl0eSkub25DaGFuZ2UoKHYpID0+ICh2aXNpYmlsaXR5ID0gdiBhcyBWaXNpYmlsaXR5KSk7XG4gICAgICB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5zZXROYW1lKFwiXHU2ODA3XHU3QjdFXCIpXG4gICAgICAuc2V0RGVzYyhcIlx1NTkxQVx1NEUyQVx1NjgwN1x1N0I3RVx1NzUyOFx1OTAxN1x1NTNGN1x1NTIwNlx1OTY5NFwiKVxuICAgICAgLmFkZFRleHQoKHQpID0+XG4gICAgICAgIHRcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoXCJ0YWcxLCB0YWcyXCIpXG4gICAgICAgICAgLnNldFZhbHVlKHRhZ3MpXG4gICAgICAgICAgLm9uQ2hhbmdlKCh2KSA9PiAodGFncyA9IHYpKVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5zZXROYW1lKFwiXHU3QUNCXHU1MzczXHU1M0QxXHU1RTAzXCIpXG4gICAgICAuc2V0RGVzYyhcIlx1NTE3M1x1OTVFRFx1NTIxOVx1NEZERFx1NUI1OFx1NEUzQVx1ODM0OVx1N0EzRlwiKVxuICAgICAgLmFkZFRvZ2dsZSgodCkgPT5cbiAgICAgICAgdC5zZXRWYWx1ZShwdWJsaXNoZWQpLm9uQ2hhbmdlKCh2KSA9PiAocHVibGlzaGVkID0gdikpXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKS5hZGRCdXR0b24oKGJ0bikgPT5cbiAgICAgIGJ0blxuICAgICAgICAuc2V0QnV0dG9uVGV4dChcIlx1NTNEMVx1NUUwM1wiKVxuICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgICAgICBjb25zdCB0YWdMaXN0ID0gdGFnc1xuICAgICAgICAgICAgLnNwbGl0KFwiLFwiKVxuICAgICAgICAgICAgLm1hcCgodCkgPT4gdC50cmltKCkpXG4gICAgICAgICAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICAgICAgICAgIC8vIFdyaXRlIG1ldGEgdG8gZnJvbnRtYXR0ZXIgZmlyc3Qgc28gZG9QdXNoIGNhbiByZWFkIGl0XG4gICAgICAgICAgYXdhaXQgdGhpcy5hcHAuZmlsZU1hbmFnZXIucHJvY2Vzc0Zyb250TWF0dGVyKHRoaXMuZmlsZSwgKGYpID0+IHtcbiAgICAgICAgICAgIGZbXCJ0aXRsZVwiXSA9IHRpdGxlO1xuICAgICAgICAgICAgZltcImJsb2ctem9uZVwiXSA9IHpvbmU7XG4gICAgICAgICAgICBmW1wiYmxvZy12aXNpYmlsaXR5XCJdID0gdmlzaWJpbGl0eTtcbiAgICAgICAgICAgIGZbXCJibG9nLXB1Ymxpc2hlZFwiXSA9IHB1Ymxpc2hlZDtcbiAgICAgICAgICAgIGZbXCJibG9nLXRhZ3NcIl0gPSB0YWdMaXN0O1xuICAgICAgICAgIH0pO1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLmRvUHVzaChcbiAgICAgICAgICAgIHRoaXMuZmlsZSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgdGl0bGUsXG4gICAgICAgICAgICAgIFwiYmxvZy16b25lXCI6IHpvbmUsXG4gICAgICAgICAgICAgIFwiYmxvZy12aXNpYmlsaXR5XCI6IHZpc2liaWxpdHksXG4gICAgICAgICAgICAgIFwiYmxvZy1wdWJsaXNoZWRcIjogcHVibGlzaGVkLFxuICAgICAgICAgICAgICBcImJsb2ctdGFnc1wiOiB0YWdMaXN0LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHVuZGVmaW5lZCxcbiAgICAgICAgICAgIHpvbmVcbiAgICAgICAgICApO1xuICAgICAgICB9KVxuICAgICk7XG4gIH1cblxuICBvbkNsb3NlKCkge1xuICAgIHRoaXMuY29udGVudEVsLmVtcHR5KCk7XG4gIH1cbn1cblxuLy8gPT09PT0gU2V0dGluZ3MgVGFiID09PT09XG5cbmNsYXNzIExxc3NibG9nU2V0dGluZ1RhYiBleHRlbmRzIFBsdWdpblNldHRpbmdUYWIge1xuICBwbHVnaW46IExxc3NibG9nUGx1Z2luO1xuXG4gIGNvbnN0cnVjdG9yKGFwcDogQXBwLCBwbHVnaW46IExxc3NibG9nUGx1Z2luKSB7XG4gICAgc3VwZXIoYXBwLCBwbHVnaW4pO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICB9XG5cbiAgZGlzcGxheSgpIHtcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xuICAgIGNvbnRhaW5lckVsLmVtcHR5KCk7XG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IFwibHFzc2Jsb2cgU3luY1wiIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlx1NTM1QVx1NUJBMlx1NTczMFx1NTc0MFwiKVxuICAgICAgLnNldERlc2MoXCJcdTRFMERcdTU0MkJcdTY3MkJcdTVDM0VcdTY1OUNcdTdFQkZcdUZGMENcdTRGOEJcdTU5ODIgaHR0cHM6Ly9scXNzYmxvZy5zZXJ2ZWJsb2cubmV0XCIpXG4gICAgICAuYWRkVGV4dCgodCkgPT5cbiAgICAgICAgdFxuICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcihcImh0dHBzOi8vbHFzc2Jsb2cuc2VydmVibG9nLm5ldFwiKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5ibG9nVXJsKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodikgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuYmxvZ1VybCA9IHYucmVwbGFjZSgvXFwvJC8sIFwiXCIpO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiXHU3NTI4XHU2MjM3XHU1NDBEXCIpXG4gICAgICAuYWRkVGV4dCgodCkgPT5cbiAgICAgICAgdFxuICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcihcInlvdXItdXNlcm5hbWVcIilcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MudXNlcm5hbWUpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2KSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy51c2VybmFtZSA9IHYudHJpbSgpO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiXHU1QkM2XHU3ODAxXCIpXG4gICAgICAuYWRkVGV4dCgodCkgPT4ge1xuICAgICAgICB0LmlucHV0RWwudHlwZSA9IFwicGFzc3dvcmRcIjtcbiAgICAgICAgdC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5wYXNzd29yZCkub25DaGFuZ2UoYXN5bmMgKHYpID0+IHtcbiAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5wYXNzd29yZCA9IHY7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiXHU1NDBDXHU2QjY1XHU2ODM5XHU2NTg3XHU0RUY2XHU1OTM5XCIpXG4gICAgICAuc2V0RGVzYyhcIlx1NjU4N1x1N0FFMFx1NjMwOVx1NTIwNlx1NTMzQVx1NEZERFx1NUI1OFx1NTIzMFx1NUI1MFx1NjU4N1x1NEVGNlx1NTkzOVx1RkYxQWJsb2cvMiBcdTAwQjcgYmxvZy8zIFx1MDBCNyBibG9nLzRcIilcbiAgICAgIC5hZGRUZXh0KCh0KSA9PlxuICAgICAgICB0XG4gICAgICAgICAgLnNldFBsYWNlaG9sZGVyKFwiYmxvZ1wiKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5zeW5jRm9sZGVyKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodikgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Muc3luY0ZvbGRlciA9IHYudHJpbSgpLnJlcGxhY2UoL1xcLyQvLCBcIlwiKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlx1NkQ0Qlx1OEJENVx1OEZERVx1NjNBNVwiKVxuICAgICAgLnNldERlc2MoXCJcdTlBOENcdThCQzFcdTc1MjhcdTYyMzdcdTU0MERcdTU0OENcdTVCQzZcdTc4MDFcdTY2MkZcdTU0MjZcdTZCNjNcdTc4NkVcIilcbiAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT5cbiAgICAgICAgYnRuLnNldEJ1dHRvblRleHQoXCJcdTZENEJcdThCRDVcIikub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgYnRuLnNldEJ1dHRvblRleHQoXCJcdThGREVcdTYzQTVcdTRFMkRcdTIwMjZcIikuc2V0RGlzYWJsZWQodHJ1ZSk7XG4gICAgICAgICAgY29uc3QgeyBvaywgcmVhc29uIH0gPSBhd2FpdCB0aGlzLnBsdWdpbi5sb2dpbigpO1xuICAgICAgICAgIGJ0bi5zZXREaXNhYmxlZChmYWxzZSk7XG4gICAgICAgICAgaWYgKG9rKSB7XG4gICAgICAgICAgICBidG4uc2V0QnV0dG9uVGV4dChcIlx1MjcxMyBcdTYyMTBcdTUyOUZcIik7XG4gICAgICAgICAgICBuZXcgTm90aWNlKFwibHFzc2Jsb2c6IFx1NzY3Qlx1NUY1NVx1NjIxMFx1NTI5RlwiKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgYnRuLnNldEJ1dHRvblRleHQoXCJcdTI3MTcgXHU1OTMxXHU4RDI1XCIpO1xuICAgICAgICAgICAgbmV3IE5vdGljZShgbHFzc2Jsb2c6IFx1NzY3Qlx1NUY1NVx1NTkzMVx1OEQyNSBcdTIwMTQgJHtyZWFzb259YCwgODAwMCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4gYnRuLnNldEJ1dHRvblRleHQoXCJcdTZENEJcdThCRDVcIiksIDQwMDApO1xuICAgICAgICB9KVxuICAgICAgKTtcbiAgfVxufVxuXG4vLyA9PT09PSBVdGlsaXR5ID09PT09XG5cbmZ1bmN0aW9uIHN0cmlwRnJvbnRtYXR0ZXIoY29udGVudDogc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKCFjb250ZW50LnN0YXJ0c1dpdGgoXCItLS1cIikpIHJldHVybiBjb250ZW50O1xuICBjb25zdCBlbmQgPSBjb250ZW50LmluZGV4T2YoXCJcXG4tLS1cIiwgMyk7XG4gIGlmIChlbmQgPT09IC0xKSByZXR1cm4gY29udGVudDtcbiAgcmV0dXJuIGNvbnRlbnQuc2xpY2UoZW5kICsgNCkudHJpbVN0YXJ0KCk7XG59XG5cbmZ1bmN0aW9uIHBhcnNlVGFncyhyYXc6IHVua25vd24pOiBzdHJpbmdbXSB7XG4gIGlmICghcmF3KSByZXR1cm4gW107XG4gIGlmIChBcnJheS5pc0FycmF5KHJhdykpIHJldHVybiAocmF3IGFzIHVua25vd25bXSkubWFwKFN0cmluZykuZmlsdGVyKEJvb2xlYW4pO1xuICBpZiAodHlwZW9mIHJhdyA9PT0gXCJzdHJpbmdcIilcbiAgICByZXR1cm4gcmF3XG4gICAgICAuc3BsaXQoXCIsXCIpXG4gICAgICAubWFwKCh0KSA9PiB0LnRyaW0oKSlcbiAgICAgIC5maWx0ZXIoQm9vbGVhbik7XG4gIHJldHVybiBbXTtcbn1cblxuZnVuY3Rpb24gc2FmZUZpbGVuYW1lKG5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBuYW1lLnJlcGxhY2UoL1tcXFxcLzoqP1wiPD58XS9nLCBcIi1cIikudHJpbSgpLnNsaWNlKDAsIDEwMCk7XG59XG5cbmZ1bmN0aW9uIGJ1aWxkTm90ZUNvbnRlbnQocG9zdDogQmxvZ1Bvc3QpOiBzdHJpbmcge1xuICBjb25zdCB0YWdzID0gcG9zdC50YWdzLm1hcCgodCkgPT4gdC50YWcubmFtZSk7XG4gIGNvbnN0IGxpbmVzID0gW1xuICAgIFwiLS0tXCIsXG4gICAgYHRpdGxlOiBcIiR7cG9zdC50aXRsZS5yZXBsYWNlKC9cIi9nLCAnXFxcXFwiJyl9XCJgLFxuICAgIGBibG9nLWlkOiBcIiR7cG9zdC5pZH1cImAsXG4gICAgYGJsb2ctem9uZTogJHtwb3N0LnpvbmV9YCxcbiAgICBgYmxvZy12aXNpYmlsaXR5OiAke3Bvc3QudmlzaWJpbGl0eX1gLFxuICAgIGBibG9nLXB1Ymxpc2hlZDogJHtwb3N0LnB1Ymxpc2hlZH1gLFxuICBdO1xuICBpZiAodGFncy5sZW5ndGgpIHtcbiAgICBsaW5lcy5wdXNoKGBibG9nLXRhZ3M6IFske3RhZ3MubWFwKCh0KSA9PiBgXCIke3R9XCJgKS5qb2luKFwiLCBcIil9XWApO1xuICB9XG4gIGxpbmVzLnB1c2goXG4gICAgYGJsb2ctc3luY2VkLWF0OiBcIiR7bmV3IERhdGUoKS50b0lTT1N0cmluZygpfVwiYCxcbiAgICBgYmxvZy11cGRhdGVkLWF0OiBcIiR7cG9zdC51cGRhdGVkQXR9XCJgLFxuICAgIFwiLS0tXCIsXG4gICAgXCJcIixcbiAgICBwb3N0LmNvbnRlbnRcbiAgKTtcbiAgcmV0dXJuIGxpbmVzLmpvaW4oXCJcXG5cIik7XG59XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxzQkFXTztBQTJCUCxJQUFNLG1CQUFxQztBQUFBLEVBQ3pDLFNBQVM7QUFBQSxFQUNULFVBQVU7QUFBQSxFQUNWLFVBQVU7QUFBQSxFQUNWLFlBQVk7QUFBQSxFQUNaLE9BQU87QUFDVDtBQUVBLElBQU0saUJBQXVDO0FBQUEsRUFDM0MsT0FBTztBQUFBLEVBQ1AsTUFBTTtBQUFBLEVBQ04sTUFBTTtBQUNSO0FBSUEsSUFBcUIsaUJBQXJCLGNBQTRDLHVCQUFPO0FBQUEsRUFHakQsTUFBTSxTQUFTO0FBQ2IsVUFBTSxLQUFLLGFBQWE7QUFHeEIsU0FBSyxjQUFjLFNBQVMsaUJBQWlCLE1BQU07QUFDakQsVUFBSSxVQUFVLEtBQUssS0FBSyxJQUFJLEVBQUUsS0FBSztBQUFBLElBQ3JDLENBQUM7QUFHRCxTQUFLLFdBQVc7QUFBQSxNQUNkLElBQUk7QUFBQSxNQUNKLE1BQU07QUFBQSxNQUNOLFVBQVUsTUFBTTtBQUNkLGNBQU0sT0FBTyxLQUFLLElBQUksVUFBVSxjQUFjO0FBQzlDLFlBQUksS0FBTSxNQUFLLFNBQVMsSUFBSTtBQUFBLFlBQ3ZCLEtBQUksdUJBQU8sc0RBQW1CO0FBQUEsTUFDckM7QUFBQSxJQUNGLENBQUM7QUFFRCxTQUFLLFdBQVc7QUFBQSxNQUNkLElBQUk7QUFBQSxNQUNKLE1BQU07QUFBQSxNQUNOLFVBQVUsTUFBTSxLQUFLLGFBQWE7QUFBQSxJQUNwQyxDQUFDO0FBRUQsU0FBSyxXQUFXO0FBQUEsTUFDZCxJQUFJO0FBQUEsTUFDSixNQUFNO0FBQUEsTUFDTixVQUFVLE1BQU0sS0FBSyxRQUFRO0FBQUEsSUFDL0IsQ0FBQztBQUdELFNBQUs7QUFBQSxNQUNILEtBQUssSUFBSSxVQUFVLEdBQUcsYUFBYSxDQUFDLE1BQU0sU0FBUztBQUNqRCxZQUFJLGdCQUFnQix5QkFBUyxLQUFLLGNBQWMsTUFBTTtBQUNwRCxlQUFLLFFBQVEsQ0FBQyxTQUFTO0FBQ3JCLGlCQUNHLFNBQVMsNkJBQWMsRUFDdkIsUUFBUSxjQUFjLEVBQ3RCLFFBQVEsTUFBTSxLQUFLLFNBQVMsSUFBSSxDQUFDO0FBQUEsVUFDdEMsQ0FBQztBQUFBLFFBQ0g7QUFBQSxNQUNGLENBQUM7QUFBQSxJQUNIO0FBRUEsU0FBSyxjQUFjLElBQUksbUJBQW1CLEtBQUssS0FBSyxJQUFJLENBQUM7QUFBQSxFQUMzRDtBQUFBLEVBRUEsV0FBVztBQUFBLEVBQUM7QUFBQTtBQUFBLEVBSVosTUFBTSxRQUFrRDtBQTdHMUQ7QUE4R0ksUUFBSSxDQUFDLEtBQUssU0FBUyxZQUFZLENBQUMsS0FBSyxTQUFTLFVBQVU7QUFDdEQsYUFBTyxFQUFFLElBQUksT0FBTyxRQUFRLHlEQUFZO0FBQUEsSUFDMUM7QUFDQSxRQUFJO0FBQ0osUUFBSTtBQUNGLGFBQU8sVUFBTSw0QkFBVztBQUFBLFFBQ3RCLEtBQUssR0FBRyxLQUFLLFNBQVMsT0FBTztBQUFBLFFBQzdCLFFBQVE7QUFBQSxRQUNSLFNBQVMsRUFBRSxnQkFBZ0IsbUJBQW1CO0FBQUEsUUFDOUMsTUFBTSxLQUFLLFVBQVU7QUFBQSxVQUNuQixVQUFVLEtBQUssU0FBUztBQUFBLFVBQ3hCLFVBQVUsS0FBSyxTQUFTO0FBQUEsUUFDMUIsQ0FBQztBQUFBLFFBQ0QsT0FBTztBQUFBLE1BQ1QsQ0FBQztBQUFBLElBQ0gsU0FBUyxHQUFHO0FBQ1YsYUFBTyxFQUFFLElBQUksT0FBTyxRQUFRLDZCQUFTLE9BQU8sQ0FBQyxDQUFDLEdBQUc7QUFBQSxJQUNuRDtBQUVBLFFBQUksS0FBSyxXQUFXLEtBQUs7QUFDdkIsVUFBSSxNQUFNO0FBQ1YsVUFBSTtBQUFFLGVBQU0sZ0JBQUssU0FBTCxtQkFBVyxVQUFYLFlBQW9CLEtBQUs7QUFBQSxNQUFNLFNBQVE7QUFBRSxjQUFNLE9BQU8sS0FBSyxNQUFNO0FBQUEsTUFBRztBQUNoRixhQUFPLEVBQUUsSUFBSSxPQUFPLFFBQVEsUUFBUSxLQUFLLE1BQU0sS0FBSyxHQUFHLEdBQUc7QUFBQSxJQUM1RDtBQUVBLFFBQUk7QUFDSixRQUFJO0FBQUUsZUFBUSxVQUFLLFNBQUwsbUJBQVc7QUFBQSxJQUFPLFNBQVE7QUFBQSxJQUFlO0FBQ3ZELFFBQUksQ0FBQyxPQUFPO0FBQ1YsYUFBTyxFQUFFLElBQUksT0FBTyxRQUFRLG9EQUFpQjtBQUFBLElBQy9DO0FBRUEsU0FBSyxTQUFTLFFBQVE7QUFDdEIsVUFBTSxLQUFLLGFBQWE7QUFDeEIsV0FBTyxFQUFFLElBQUksTUFBTSxRQUFRLDJCQUFPO0FBQUEsRUFDcEM7QUFBQSxFQUVBLGFBQXFDO0FBQ25DLFdBQU87QUFBQSxNQUNMLGdCQUFnQjtBQUFBLE1BQ2hCLFFBQVEsU0FBUyxLQUFLLFNBQVMsS0FBSztBQUFBLElBQ3RDO0FBQUEsRUFDRjtBQUFBO0FBQUEsRUFHQSxNQUFNLE9BQ0osU0FDQSxVQUFVLE9BQ21CO0FBN0pqQztBQThKSSxVQUFNLE9BQU8sVUFBTSw0QkFBVztBQUFBLE1BQzVCLEdBQUc7QUFBQSxNQUNILFNBQVMsRUFBRSxHQUFHLEtBQUssV0FBVyxHQUFHLElBQUksYUFBUSxZQUFSLFlBQW1CLENBQUMsRUFBRztBQUFBLE1BQzVELE9BQU87QUFBQSxJQUNULENBQUM7QUFDRCxRQUFJLEtBQUssV0FBVyxPQUFPLENBQUMsU0FBUztBQUNuQyxZQUFNLEVBQUUsR0FBRyxJQUFJLE1BQU0sS0FBSyxNQUFNO0FBQ2hDLFVBQUksR0FBSSxRQUFPLEtBQUssT0FBTyxTQUFTLElBQUk7QUFBQSxJQUMxQztBQUNBLFdBQU87QUFBQSxFQUNUO0FBQUE7QUFBQSxFQUlBLE1BQU0sZUFBb0M7QUE1SzVDO0FBNktJLFVBQU0sT0FBTyxNQUFNLEtBQUssT0FBTztBQUFBLE1BQzdCLEtBQUssR0FBRyxLQUFLLFNBQVMsT0FBTztBQUFBLElBQy9CLENBQUM7QUFDRCxRQUFJLEtBQUssV0FBVyxJQUFLLFFBQU8sQ0FBQztBQUNqQyxZQUFRLFVBQUssS0FBK0IsVUFBcEMsWUFBNkMsQ0FBQztBQUFBLEVBQ3hEO0FBQUEsRUFFQSxNQUFNLFdBQVcsTUFPWTtBQTNML0I7QUE0TEksVUFBTSxPQUFPLE1BQU0sS0FBSyxPQUFPO0FBQUEsTUFDN0IsS0FBSyxHQUFHLEtBQUssU0FBUyxPQUFPO0FBQUEsTUFDN0IsUUFBUTtBQUFBLE1BQ1IsTUFBTSxLQUFLLFVBQVUsSUFBSTtBQUFBLElBQzNCLENBQUM7QUFDRCxRQUFJLEtBQUssV0FBVyxJQUFLLFFBQU87QUFDaEMsWUFBUSxVQUFLLEtBQTRCLFNBQWpDLFlBQXlDO0FBQUEsRUFDbkQ7QUFBQSxFQUVBLE1BQU0sV0FDSixJQUNBLE1BUWtCO0FBQ2xCLFVBQU0sT0FBTyxNQUFNLEtBQUssT0FBTztBQUFBLE1BQzdCLEtBQUssR0FBRyxLQUFLLFNBQVMsT0FBTyxjQUFjLEVBQUU7QUFBQSxNQUM3QyxRQUFRO0FBQUEsTUFDUixNQUFNLEtBQUssVUFBVSxJQUFJO0FBQUEsSUFDM0IsQ0FBQztBQUNELFdBQU8sS0FBSyxXQUFXO0FBQUEsRUFDekI7QUFBQTtBQUFBO0FBQUEsRUFLQSxNQUFNLFNBQVMsTUFBNEI7QUEzTjdDO0FBNE5JLFFBQUksQ0FBQyxLQUFLLFNBQVMsWUFBWSxDQUFDLEtBQUssU0FBUyxVQUFVO0FBQ3RELFVBQUksdUJBQU8sNEdBQTRCO0FBQ3ZDO0FBQUEsSUFDRjtBQUVBLFVBQU0sTUFBSyxnQkFBSyxJQUFJLGNBQWMsYUFBYSxJQUFJLE1BQXhDLG1CQUEyQyxnQkFBM0MsWUFBMEQsQ0FBQztBQUN0RSxVQUFNLE9BQU8sR0FBRyxXQUFXO0FBRTNCLFFBQUksQ0FBQyxNQUFNO0FBQ1QsVUFBSSxhQUFhLEtBQUssS0FBSyxNQUFNLElBQUksRUFBRSxLQUFLO0FBQzVDO0FBQUEsSUFDRjtBQUVBLFVBQU0sS0FBSyxPQUFPLE1BQU0sSUFBK0IsR0FBRyxTQUFTLEdBQXlCLElBQUk7QUFBQSxFQUNsRztBQUFBO0FBQUEsRUFHQSxNQUFNLE9BQ0osTUFDQSxJQUNBLFFBQ0EsTUFDa0I7QUFsUHRCO0FBbVBJLFVBQU0sYUFBYSxNQUFNLEtBQUssSUFBSSxNQUFNLEtBQUssSUFBSTtBQUNqRCxVQUFNLE9BQU8saUJBQWlCLFVBQVU7QUFFeEMsVUFBTSxRQUFTLEdBQUcsT0FBTyxLQUFnQixLQUFLO0FBQzlDLFVBQU0sYUFBYyxHQUFHLGlCQUFpQixLQUFvQjtBQUM1RCxVQUFNLGFBQWEsUUFBRyxnQkFBZ0IsTUFBbkIsWUFBb0M7QUFDdkQsVUFBTSxPQUFPLFVBQVUsR0FBRyxXQUFXLENBQUM7QUFFdEMsVUFBTSxPQUFNLG9CQUFJLEtBQUssR0FBRSxZQUFZO0FBQ25DLFVBQU0sT0FBTyxFQUFFLE9BQU8sU0FBUyxNQUFNLE1BQU0sWUFBWSxXQUFXLEtBQUs7QUFFdkUsUUFBSSxRQUFRO0FBQ1YsWUFBTSxLQUFLLE1BQU0sS0FBSyxXQUFXLFFBQVEsSUFBSTtBQUM3QyxVQUFJLENBQUMsSUFBSTtBQUNQLFlBQUksdUJBQU8seURBQXNCLEtBQUssUUFBRztBQUN6QyxlQUFPO0FBQUEsTUFDVDtBQUFBLElBQ0YsT0FBTztBQUNMLFlBQU0sT0FBTyxNQUFNLEtBQUssV0FBVyxJQUFJO0FBQ3ZDLFVBQUksQ0FBQyxNQUFNO0FBQ1QsWUFBSSx1QkFBTyx5REFBc0IsS0FBSyxRQUFHO0FBQ3pDLGVBQU87QUFBQSxNQUNUO0FBQ0EsZUFBUyxLQUFLO0FBQUEsSUFDaEI7QUFFQSxVQUFNLEtBQUssSUFBSSxZQUFZLG1CQUFtQixNQUFNLENBQUMsTUFBTTtBQUN6RCxRQUFFLFNBQVMsSUFBSTtBQUNmLFFBQUUsZ0JBQWdCLElBQUk7QUFDdEIsUUFBRSxpQkFBaUIsSUFBSTtBQUFBLElBQ3pCLENBQUM7QUFFRCxRQUFJLHVCQUFPLDRDQUFtQixLQUFLLFFBQUc7QUFDdEMsV0FBTztBQUFBLEVBQ1Q7QUFBQTtBQUFBLEVBR0EsTUFBTSxlQUE4QjtBQXhSdEM7QUF5UkksUUFBSSxDQUFDLEtBQUssU0FBUyxZQUFZLENBQUMsS0FBSyxTQUFTLFVBQVU7QUFDdEQsVUFBSSx1QkFBTyw0R0FBNEI7QUFDdkM7QUFBQSxJQUNGO0FBRUEsUUFBSSx1QkFBTywwQ0FBaUI7QUFDNUIsVUFBTSxRQUFRLE1BQU0sS0FBSyxhQUFhO0FBRXRDLFFBQUksQ0FBQyxNQUFNLFFBQVE7QUFDakIsVUFBSSx1QkFBTyw0REFBb0I7QUFDL0I7QUFBQSxJQUNGO0FBRUEsVUFBTSxLQUFLLGlCQUFpQjtBQUU1QixRQUFJLFNBQVMsR0FBRyxVQUFVO0FBRTFCLGVBQVcsUUFBUSxPQUFPO0FBQ3hCLFlBQU0sV0FBVyxLQUFLLGlCQUFpQixLQUFLLEVBQUU7QUFDOUMsWUFBTSxXQUFXLFlBQ1osZ0JBQUssSUFBSSxjQUFjLGFBQWEsUUFBUSxNQUE1QyxtQkFBK0MsZ0JBQS9DLG1CQUNDLG9CQUVGO0FBRUosWUFBTSxnQkFBZ0IsSUFBSSxLQUFLLEtBQUssU0FBUyxFQUFFLFFBQVE7QUFDdkQsWUFBTSxlQUFlLFdBQVcsSUFBSSxLQUFLLFFBQVEsRUFBRSxRQUFRLElBQUk7QUFFL0QsVUFBSSxZQUFZLGlCQUFpQixjQUFjO0FBQzdDO0FBQ0E7QUFBQSxNQUNGO0FBRUEsWUFBTSxVQUFVLGlCQUFpQixJQUFJO0FBQ3JDLFVBQUksVUFBVTtBQUNaLGNBQU0sS0FBSyxJQUFJLE1BQU0sT0FBTyxVQUFVLE9BQU87QUFBQSxNQUMvQyxPQUFPO0FBQ0wsY0FBTSxPQUFPLE1BQU0sS0FBSztBQUFBLFVBQ3RCLEdBQUcsS0FBSyxXQUFXLEtBQUssSUFBSSxDQUFDLElBQUksYUFBYSxLQUFLLEtBQUssS0FBSyxLQUFLLEVBQUU7QUFBQSxRQUN0RTtBQUNBLGNBQU0sS0FBSyxJQUFJLE1BQU0sT0FBTyxNQUFNLE9BQU87QUFBQSxNQUMzQztBQUNBO0FBQUEsSUFDRjtBQUVBLFFBQUksdUJBQU8sZ0VBQXdCLE1BQU0sNkJBQVMsT0FBTyxTQUFJO0FBQUEsRUFDL0Q7QUFBQTtBQUFBLEVBR0EsTUFBTSxVQUF5QjtBQTFVakM7QUEyVUksUUFBSSxDQUFDLEtBQUssU0FBUyxZQUFZLENBQUMsS0FBSyxTQUFTLFVBQVU7QUFDdEQsVUFBSSx1QkFBTyw0R0FBNEI7QUFDdkM7QUFBQSxJQUNGO0FBRUEsUUFBSSx1QkFBTyxzREFBbUI7QUFDOUIsVUFBTSxRQUFRLE1BQU0sS0FBSyxhQUFhO0FBQ3RDLFVBQU0sVUFBVSxJQUFJLElBQXNCLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxFQUFFLElBQUksQ0FBQyxDQUFDLENBQUM7QUFFckUsVUFBTSxLQUFLLGlCQUFpQjtBQUU1QixRQUFJLFNBQVMsR0FBRyxTQUFTLEdBQUcsWUFBWSxHQUFHLFVBQVU7QUFDckQsVUFBTSxlQUFlLG9CQUFJLElBQVk7QUFHckMsZUFBVyxRQUFRLEtBQUssSUFBSSxNQUFNLGlCQUFpQixHQUFHO0FBQ3BELFlBQU0sTUFBSyxnQkFBSyxJQUFJLGNBQWMsYUFBYSxJQUFJLE1BQXhDLG1CQUEyQyxnQkFBM0MsWUFBMEQsQ0FBQztBQUN0RSxZQUFNLFNBQVMsR0FBRyxTQUFTO0FBQzNCLFlBQU0sT0FBTyxHQUFHLFdBQVc7QUFFM0IsVUFBSSxDQUFDLFFBQVE7QUFFWCxjQUFNLGVBQ0osUUFBUSxLQUFLLEtBQUssV0FBVyxLQUFLLFdBQVcsSUFBSSxJQUFJLEdBQUc7QUFDMUQsWUFBSSxjQUFjO0FBQ2hCLGdCQUFNLEtBQUssTUFBTSxLQUFLLE9BQU8sTUFBTSxJQUErQixRQUFXLElBQUs7QUFDbEYsY0FBSSxHQUFJO0FBQUEsUUFDVjtBQUNBO0FBQUEsTUFDRjtBQUVBLG1CQUFhLElBQUksTUFBTTtBQUN2QixZQUFNLFdBQVcsUUFBUSxJQUFJLE1BQU07QUFDbkMsVUFBSSxDQUFDLFNBQVU7QUFFZixZQUFNLFdBQVcsR0FBRyxnQkFBZ0I7QUFDcEMsWUFBTSxlQUFlLFdBQVcsSUFBSSxLQUFLLFFBQVEsRUFBRSxRQUFRLElBQUk7QUFDL0QsWUFBTSxnQkFBZ0IsSUFBSSxLQUFLLFNBQVMsU0FBUyxFQUFFLFFBQVE7QUFDM0QsWUFBTSxpQkFBaUIsS0FBSyxLQUFLO0FBQ2pDLFlBQU0sU0FBUztBQUVmLFlBQU0sWUFBWSxnQkFBZ0IsZUFBZTtBQUNqRCxZQUFNLGFBQWEsaUJBQWlCLGVBQWU7QUFFbkQsVUFBSSxhQUFhLFlBQVk7QUFDM0I7QUFDQSxZQUFJO0FBQUEsVUFDRiw2Q0FBb0IsS0FBSyxRQUFRO0FBQUEsUUFDbkM7QUFDQTtBQUFBLE1BQ0Y7QUFFQSxVQUFJLFlBQVk7QUFDZCxjQUFNLEtBQUssTUFBTSxLQUFLO0FBQUEsVUFDcEI7QUFBQSxVQUNBO0FBQUEsVUFDQTtBQUFBLFVBQ0Esc0JBQVMsU0FBUztBQUFBLFFBQ3BCO0FBQ0EsWUFBSSxHQUFJO0FBQUEsTUFDVixXQUFXLFdBQVc7QUFDcEIsY0FBTSxLQUFLLElBQUksTUFBTSxPQUFPLE1BQU0saUJBQWlCLFFBQVEsQ0FBQztBQUM1RDtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBR0EsZUFBVyxRQUFRLE9BQU87QUFDeEIsVUFBSSxhQUFhLElBQUksS0FBSyxFQUFFLEVBQUc7QUFDL0IsWUFBTSxPQUFPLE1BQU0sS0FBSztBQUFBLFFBQ3RCLEdBQUcsS0FBSyxXQUFXLEtBQUssSUFBSSxDQUFDLElBQUksYUFBYSxLQUFLLEtBQUssS0FBSyxLQUFLLEVBQUU7QUFBQSxNQUN0RTtBQUNBLFlBQU0sS0FBSyxJQUFJLE1BQU0sT0FBTyxNQUFNLGlCQUFpQixJQUFJLENBQUM7QUFDeEQ7QUFBQSxJQUNGO0FBRUEsVUFBTSxVQUFVO0FBQUEsTUFDZCx1QkFBUSxTQUFTLE9BQU87QUFBQSxNQUN4Qix1QkFBUSxNQUFNO0FBQUEsTUFDZCxZQUFZLFVBQUssU0FBUyx3QkFBUztBQUFBLElBQ3JDLEVBQ0csT0FBTyxPQUFPLEVBQ2QsS0FBSyxLQUFLO0FBRWIsUUFBSSx1QkFBTyxtREFBcUIsT0FBTyxFQUFFO0FBQUEsRUFDM0M7QUFBQTtBQUFBLEVBSUEsaUJBQWlCLFFBQThCO0FBcGFqRDtBQXFhSSxlQUFXLFFBQVEsS0FBSyxJQUFJLE1BQU0saUJBQWlCLEdBQUc7QUFDcEQsWUFBTSxNQUFLLFVBQUssSUFBSSxjQUFjLGFBQWEsSUFBSSxNQUF4QyxtQkFBMkM7QUFDdEQsV0FBSSx5QkFBSyxnQkFBZSxPQUFRLFFBQU87QUFBQSxJQUN6QztBQUNBLFdBQU87QUFBQSxFQUNUO0FBQUEsRUFFQSxXQUFXLE1BQW9CO0FBQzdCLFdBQU8sR0FBRyxLQUFLLFNBQVMsVUFBVSxJQUFJLGVBQWUsSUFBSSxDQUFDO0FBQUEsRUFDNUQ7QUFBQSxFQUVBLE1BQU0sbUJBQWtDO0FBQ3RDLFVBQU0sT0FBTyxLQUFLLFNBQVM7QUFDM0IsUUFBSSxDQUFFLE1BQU0sS0FBSyxJQUFJLE1BQU0sUUFBUSxPQUFPLElBQUksR0FBSTtBQUNoRCxZQUFNLEtBQUssSUFBSSxNQUFNLGFBQWEsSUFBSTtBQUFBLElBQ3hDO0FBQ0EsZUFBVyxPQUFPLE9BQU8sT0FBTyxjQUFjLEdBQUc7QUFDL0MsWUFBTSxPQUFPLEdBQUcsSUFBSSxJQUFJLEdBQUc7QUFDM0IsVUFBSSxDQUFFLE1BQU0sS0FBSyxJQUFJLE1BQU0sUUFBUSxPQUFPLElBQUksR0FBSTtBQUNoRCxjQUFNLEtBQUssSUFBSSxNQUFNLGFBQWEsSUFBSTtBQUFBLE1BQ3hDO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFBQSxFQUVBLE1BQU0sV0FBVyxNQUErQjtBQUM5QyxRQUFJLENBQUUsTUFBTSxLQUFLLElBQUksTUFBTSxRQUFRLE9BQU8sSUFBSSxFQUFJLFFBQU87QUFDekQsVUFBTSxPQUFPLEtBQUssUUFBUSxTQUFTLEVBQUU7QUFDckMsUUFBSSxJQUFJO0FBQ1IsV0FBTyxNQUFNLEtBQUssSUFBSSxNQUFNLFFBQVEsT0FBTyxHQUFHLElBQUksSUFBSSxDQUFDLEtBQUssRUFBRztBQUMvRCxXQUFPLEdBQUcsSUFBSSxJQUFJLENBQUM7QUFBQSxFQUNyQjtBQUFBLEVBRUEsTUFBTSxlQUFlO0FBQ25CLFNBQUssV0FBVyxPQUFPLE9BQU8sQ0FBQyxHQUFHLGtCQUFrQixNQUFNLEtBQUssU0FBUyxDQUFDO0FBQUEsRUFDM0U7QUFBQSxFQUVBLE1BQU0sZUFBZTtBQUNuQixVQUFNLEtBQUssU0FBUyxLQUFLLFFBQVE7QUFBQSxFQUNuQztBQUNGO0FBSUEsSUFBTSxZQUFOLGNBQXdCLHNCQUFNO0FBQUEsRUFHNUIsWUFBWSxLQUFVLFFBQXdCO0FBQzVDLFVBQU0sR0FBRztBQUNULFNBQUssU0FBUztBQUFBLEVBQ2hCO0FBQUEsRUFFQSxTQUFTO0FBQ1AsVUFBTSxFQUFFLFVBQVUsSUFBSTtBQUN0QixjQUFVLFNBQVMsWUFBWTtBQUMvQixjQUFVLFNBQVMsTUFBTSxFQUFFLE1BQU0sZ0JBQWdCLENBQUM7QUFFbEQsVUFBTSxPQUFPLFVBQVUsVUFBVSxFQUFFLEtBQUssWUFBWSxDQUFDO0FBRXJELFNBQUssSUFBSSxNQUFNLFVBQUssd0NBQVUsZ0JBQWdCLE1BQU07QUFDbEQsWUFBTSxPQUFPLEtBQUssSUFBSSxVQUFVLGNBQWM7QUFDOUMsVUFBSSxLQUFNLE1BQUssT0FBTyxTQUFTLElBQUk7QUFBQSxVQUM5QixLQUFJLHVCQUFPLHNEQUFtQjtBQUFBLElBQ3JDLENBQUM7QUFFRCxTQUFLLElBQUksTUFBTSxVQUFLLHdDQUFVLGtCQUFrQixNQUFNO0FBQ3BELFdBQUssT0FBTyxhQUFhO0FBQUEsSUFDM0IsQ0FBQztBQUVELFNBQUssSUFBSSxNQUFNLFVBQUssd0NBQVUsY0FBYyxNQUFNO0FBQ2hELFdBQUssT0FBTyxRQUFRO0FBQUEsSUFDdEIsQ0FBQztBQUFBLEVBQ0g7QUFBQSxFQUVBLElBQ0UsUUFDQSxNQUNBLE9BQ0EsU0FDQSxTQUNBO0FBQ0EsVUFBTSxNQUFNLE9BQU8sU0FBUyxVQUFVLEVBQUUsS0FBSyxrQkFBa0IsQ0FBQztBQUNoRSxRQUFJLFNBQVMsUUFBUSxFQUFFLEtBQUssaUJBQWlCLE1BQU0sS0FBSyxDQUFDO0FBQ3pELFFBQUksU0FBUyxRQUFRLEVBQUUsS0FBSyxrQkFBa0IsTUFBTSxNQUFNLENBQUM7QUFDM0QsUUFBSSxVQUFVLE1BQU07QUFDbEIsV0FBSyxNQUFNO0FBQ1gsY0FBUTtBQUFBLElBQ1Y7QUFBQSxFQUNGO0FBQUEsRUFFQSxVQUFVO0FBQ1IsU0FBSyxVQUFVLE1BQU07QUFBQSxFQUN2QjtBQUNGO0FBSUEsSUFBTSxlQUFOLGNBQTJCLHNCQUFNO0FBQUEsRUFJL0IsWUFBWSxLQUFVLFFBQXdCLE1BQWE7QUFDekQsVUFBTSxHQUFHO0FBQ1QsU0FBSyxTQUFTO0FBQ2QsU0FBSyxPQUFPO0FBQUEsRUFDZDtBQUFBLEVBRUEsU0FBUztBQS9nQlg7QUFnaEJJLFVBQU0sRUFBRSxVQUFVLElBQUk7QUFDdEIsVUFBTSxNQUFLLGdCQUFLLElBQUksY0FBYyxhQUFhLEtBQUssSUFBSSxNQUE3QyxtQkFBZ0QsZ0JBQWhELFlBQStELENBQUM7QUFFM0UsY0FBVSxTQUFTLE1BQU0sRUFBRSxNQUFNLDhCQUFlLENBQUM7QUFFakQsUUFBSSxRQUFTLEdBQUcsT0FBTyxLQUFnQixLQUFLLEtBQUs7QUFDakQsUUFBSSxPQUFhO0FBQ2pCLFFBQUksYUFBeUI7QUFDN0IsUUFBSSxZQUFZO0FBQ2hCLFFBQUksT0FBTyxVQUFVLEdBQUcsV0FBVyxDQUFDLEVBQUUsS0FBSyxJQUFJO0FBRS9DLFFBQUksd0JBQVEsU0FBUyxFQUNsQixRQUFRLGNBQUksRUFDWjtBQUFBLE1BQVEsQ0FBQyxNQUNSLEVBQUUsU0FBUyxLQUFLLEVBQUUsU0FBUyxDQUFDLE1BQU8sUUFBUSxDQUFFO0FBQUEsSUFDL0M7QUFFRixRQUFJLHdCQUFRLFNBQVMsRUFDbEIsUUFBUSxjQUFJLEVBQ1osWUFBWSxDQUFDLE1BQU07QUFDbEIsUUFBRSxVQUFVLFNBQVMscUNBQVk7QUFDakMsUUFBRSxVQUFVLFFBQVEsb0NBQVc7QUFDL0IsUUFBRSxVQUFVLFFBQVEsK0JBQVc7QUFDL0IsUUFBRSxTQUFTLElBQUksRUFBRSxTQUFTLENBQUMsTUFBTyxPQUFPLENBQVU7QUFBQSxJQUNyRCxDQUFDO0FBRUgsUUFBSSx3QkFBUSxTQUFTLEVBQ2xCLFFBQVEsb0JBQUssRUFDYixZQUFZLENBQUMsTUFBTTtBQUNsQixRQUFFLFVBQVUsY0FBYyxnQ0FBTztBQUNqQyxRQUFFLFVBQVUsVUFBVSxjQUFJO0FBQzFCLFFBQUUsVUFBVSxnQkFBZ0Isb0JBQUs7QUFDakMsUUFBRSxTQUFTLFVBQVUsRUFBRSxTQUFTLENBQUMsTUFBTyxhQUFhLENBQWdCO0FBQUEsSUFDdkUsQ0FBQztBQUVILFFBQUksd0JBQVEsU0FBUyxFQUNsQixRQUFRLGNBQUksRUFDWixRQUFRLHdEQUFXLEVBQ25CO0FBQUEsTUFBUSxDQUFDLE1BQ1IsRUFDRyxlQUFlLFlBQVksRUFDM0IsU0FBUyxJQUFJLEVBQ2IsU0FBUyxDQUFDLE1BQU8sT0FBTyxDQUFFO0FBQUEsSUFDL0I7QUFFRixRQUFJLHdCQUFRLFNBQVMsRUFDbEIsUUFBUSwwQkFBTSxFQUNkLFFBQVEsa0RBQVUsRUFDbEI7QUFBQSxNQUFVLENBQUMsTUFDVixFQUFFLFNBQVMsU0FBUyxFQUFFLFNBQVMsQ0FBQyxNQUFPLFlBQVksQ0FBRTtBQUFBLElBQ3ZEO0FBRUYsUUFBSSx3QkFBUSxTQUFTLEVBQUU7QUFBQSxNQUFVLENBQUMsUUFDaEMsSUFDRyxjQUFjLGNBQUksRUFDbEIsT0FBTyxFQUNQLFFBQVEsWUFBWTtBQUNuQixhQUFLLE1BQU07QUFDWCxjQUFNLFVBQVUsS0FDYixNQUFNLEdBQUcsRUFDVCxJQUFJLENBQUMsTUFBTSxFQUFFLEtBQUssQ0FBQyxFQUNuQixPQUFPLE9BQU87QUFFakIsY0FBTSxLQUFLLElBQUksWUFBWSxtQkFBbUIsS0FBSyxNQUFNLENBQUMsTUFBTTtBQUM5RCxZQUFFLE9BQU8sSUFBSTtBQUNiLFlBQUUsV0FBVyxJQUFJO0FBQ2pCLFlBQUUsaUJBQWlCLElBQUk7QUFDdkIsWUFBRSxnQkFBZ0IsSUFBSTtBQUN0QixZQUFFLFdBQVcsSUFBSTtBQUFBLFFBQ25CLENBQUM7QUFDRCxjQUFNLEtBQUssT0FBTztBQUFBLFVBQ2hCLEtBQUs7QUFBQSxVQUNMO0FBQUEsWUFDRTtBQUFBLFlBQ0EsYUFBYTtBQUFBLFlBQ2IsbUJBQW1CO0FBQUEsWUFDbkIsa0JBQWtCO0FBQUEsWUFDbEIsYUFBYTtBQUFBLFVBQ2Y7QUFBQSxVQUNBO0FBQUEsVUFDQTtBQUFBLFFBQ0Y7QUFBQSxNQUNGLENBQUM7QUFBQSxJQUNMO0FBQUEsRUFDRjtBQUFBLEVBRUEsVUFBVTtBQUNSLFNBQUssVUFBVSxNQUFNO0FBQUEsRUFDdkI7QUFDRjtBQUlBLElBQU0scUJBQU4sY0FBaUMsaUNBQWlCO0FBQUEsRUFHaEQsWUFBWSxLQUFVLFFBQXdCO0FBQzVDLFVBQU0sS0FBSyxNQUFNO0FBQ2pCLFNBQUssU0FBUztBQUFBLEVBQ2hCO0FBQUEsRUFFQSxVQUFVO0FBQ1IsVUFBTSxFQUFFLFlBQVksSUFBSTtBQUN4QixnQkFBWSxNQUFNO0FBQ2xCLGdCQUFZLFNBQVMsTUFBTSxFQUFFLE1BQU0sZ0JBQWdCLENBQUM7QUFFcEQsUUFBSSx3QkFBUSxXQUFXLEVBQ3BCLFFBQVEsMEJBQU0sRUFDZCxRQUFRLHVGQUEwQyxFQUNsRDtBQUFBLE1BQVEsQ0FBQyxNQUNSLEVBQ0csZUFBZSxnQ0FBZ0MsRUFDL0MsU0FBUyxLQUFLLE9BQU8sU0FBUyxPQUFPLEVBQ3JDLFNBQVMsT0FBTyxNQUFNO0FBQ3JCLGFBQUssT0FBTyxTQUFTLFVBQVUsRUFBRSxRQUFRLE9BQU8sRUFBRTtBQUNsRCxjQUFNLEtBQUssT0FBTyxhQUFhO0FBQUEsTUFDakMsQ0FBQztBQUFBLElBQ0w7QUFFRixRQUFJLHdCQUFRLFdBQVcsRUFDcEIsUUFBUSxvQkFBSyxFQUNiO0FBQUEsTUFBUSxDQUFDLE1BQ1IsRUFDRyxlQUFlLGVBQWUsRUFDOUIsU0FBUyxLQUFLLE9BQU8sU0FBUyxRQUFRLEVBQ3RDLFNBQVMsT0FBTyxNQUFNO0FBQ3JCLGFBQUssT0FBTyxTQUFTLFdBQVcsRUFBRSxLQUFLO0FBQ3ZDLGNBQU0sS0FBSyxPQUFPLGFBQWE7QUFBQSxNQUNqQyxDQUFDO0FBQUEsSUFDTDtBQUVGLFFBQUksd0JBQVEsV0FBVyxFQUNwQixRQUFRLGNBQUksRUFDWixRQUFRLENBQUMsTUFBTTtBQUNkLFFBQUUsUUFBUSxPQUFPO0FBQ2pCLFFBQUUsU0FBUyxLQUFLLE9BQU8sU0FBUyxRQUFRLEVBQUUsU0FBUyxPQUFPLE1BQU07QUFDOUQsYUFBSyxPQUFPLFNBQVMsV0FBVztBQUNoQyxjQUFNLEtBQUssT0FBTyxhQUFhO0FBQUEsTUFDakMsQ0FBQztBQUFBLElBQ0gsQ0FBQztBQUVILFFBQUksd0JBQVEsV0FBVyxFQUNwQixRQUFRLHNDQUFRLEVBQ2hCLFFBQVEsOEdBQXVDLEVBQy9DO0FBQUEsTUFBUSxDQUFDLE1BQ1IsRUFDRyxlQUFlLE1BQU0sRUFDckIsU0FBUyxLQUFLLE9BQU8sU0FBUyxVQUFVLEVBQ3hDLFNBQVMsT0FBTyxNQUFNO0FBQ3JCLGFBQUssT0FBTyxTQUFTLGFBQWEsRUFBRSxLQUFLLEVBQUUsUUFBUSxPQUFPLEVBQUU7QUFDNUQsY0FBTSxLQUFLLE9BQU8sYUFBYTtBQUFBLE1BQ2pDLENBQUM7QUFBQSxJQUNMO0FBRUYsUUFBSSx3QkFBUSxXQUFXLEVBQ3BCLFFBQVEsMEJBQU0sRUFDZCxRQUFRLDBFQUFjLEVBQ3RCO0FBQUEsTUFBVSxDQUFDLFFBQ1YsSUFBSSxjQUFjLGNBQUksRUFBRSxRQUFRLFlBQVk7QUFDMUMsWUFBSSxjQUFjLDBCQUFNLEVBQUUsWUFBWSxJQUFJO0FBQzFDLGNBQU0sRUFBRSxJQUFJLE9BQU8sSUFBSSxNQUFNLEtBQUssT0FBTyxNQUFNO0FBQy9DLFlBQUksWUFBWSxLQUFLO0FBQ3JCLFlBQUksSUFBSTtBQUNOLGNBQUksY0FBYyxxQkFBTTtBQUN4QixjQUFJLHVCQUFPLG9DQUFnQjtBQUFBLFFBQzdCLE9BQU87QUFDTCxjQUFJLGNBQWMscUJBQU07QUFDeEIsY0FBSSx1QkFBTyw2Q0FBb0IsTUFBTSxJQUFJLEdBQUk7QUFBQSxRQUMvQztBQUNBLG1CQUFXLE1BQU0sSUFBSSxjQUFjLGNBQUksR0FBRyxHQUFJO0FBQUEsTUFDaEQsQ0FBQztBQUFBLElBQ0g7QUFBQSxFQUNKO0FBQ0Y7QUFJQSxTQUFTLGlCQUFpQixTQUF5QjtBQUNqRCxNQUFJLENBQUMsUUFBUSxXQUFXLEtBQUssRUFBRyxRQUFPO0FBQ3ZDLFFBQU0sTUFBTSxRQUFRLFFBQVEsU0FBUyxDQUFDO0FBQ3RDLE1BQUksUUFBUSxHQUFJLFFBQU87QUFDdkIsU0FBTyxRQUFRLE1BQU0sTUFBTSxDQUFDLEVBQUUsVUFBVTtBQUMxQztBQUVBLFNBQVMsVUFBVSxLQUF3QjtBQUN6QyxNQUFJLENBQUMsSUFBSyxRQUFPLENBQUM7QUFDbEIsTUFBSSxNQUFNLFFBQVEsR0FBRyxFQUFHLFFBQVEsSUFBa0IsSUFBSSxNQUFNLEVBQUUsT0FBTyxPQUFPO0FBQzVFLE1BQUksT0FBTyxRQUFRO0FBQ2pCLFdBQU8sSUFDSixNQUFNLEdBQUcsRUFDVCxJQUFJLENBQUMsTUFBTSxFQUFFLEtBQUssQ0FBQyxFQUNuQixPQUFPLE9BQU87QUFDbkIsU0FBTyxDQUFDO0FBQ1Y7QUFFQSxTQUFTLGFBQWEsTUFBc0I7QUFDMUMsU0FBTyxLQUFLLFFBQVEsaUJBQWlCLEdBQUcsRUFBRSxLQUFLLEVBQUUsTUFBTSxHQUFHLEdBQUc7QUFDL0Q7QUFFQSxTQUFTLGlCQUFpQixNQUF3QjtBQUNoRCxRQUFNLE9BQU8sS0FBSyxLQUFLLElBQUksQ0FBQyxNQUFNLEVBQUUsSUFBSSxJQUFJO0FBQzVDLFFBQU0sUUFBUTtBQUFBLElBQ1o7QUFBQSxJQUNBLFdBQVcsS0FBSyxNQUFNLFFBQVEsTUFBTSxLQUFLLENBQUM7QUFBQSxJQUMxQyxhQUFhLEtBQUssRUFBRTtBQUFBLElBQ3BCLGNBQWMsS0FBSyxJQUFJO0FBQUEsSUFDdkIsb0JBQW9CLEtBQUssVUFBVTtBQUFBLElBQ25DLG1CQUFtQixLQUFLLFNBQVM7QUFBQSxFQUNuQztBQUNBLE1BQUksS0FBSyxRQUFRO0FBQ2YsVUFBTSxLQUFLLGVBQWUsS0FBSyxJQUFJLENBQUMsTUFBTSxJQUFJLENBQUMsR0FBRyxFQUFFLEtBQUssSUFBSSxDQUFDLEdBQUc7QUFBQSxFQUNuRTtBQUNBLFFBQU07QUFBQSxJQUNKLHFCQUFvQixvQkFBSSxLQUFLLEdBQUUsWUFBWSxDQUFDO0FBQUEsSUFDNUMscUJBQXFCLEtBQUssU0FBUztBQUFBLElBQ25DO0FBQUEsSUFDQTtBQUFBLElBQ0EsS0FBSztBQUFBLEVBQ1A7QUFDQSxTQUFPLE1BQU0sS0FBSyxJQUFJO0FBQ3hCOyIsCiAgIm5hbWVzIjogW10KfQo=
