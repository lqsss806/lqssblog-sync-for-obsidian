import {
  App,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  requestUrl,
  RequestUrlParam,
  RequestUrlResponse,
} from "obsidian";

// ===== Types =====

type Zone = "ANIME" | "REAL" | "FOUR";
type Visibility = "PUBLIC" | "LOGIN_ONLY" | "FRIENDS_ONLY";

interface BlogPost {
  id: string;
  title: string;
  content: string;
  zone: Zone;
  visibility: Visibility;
  published: boolean;
  createdAt: string;
  updatedAt: string;
  tags: { tag: { name: string } }[];
}

interface LqssblogSettings {
  blogUrl: string;
  username: string;
  password: string;
  syncFolder: string;
  token: string;
}

const DEFAULT_SETTINGS: LqssblogSettings = {
  blogUrl: "https://lqssblog.serveblog.net",
  username: "",
  password: "",
  syncFolder: "blog",
  token: "",
};

const ZONE_SUBFOLDER: Record<Zone, string> = {
  ANIME: "anime",
  REAL: "real",
  FOUR: "four",
};

// ===== Plugin =====

export default class LqssblogPlugin extends Plugin {
  settings: LqssblogSettings;

  async onload() {
    await this.loadSettings();

    // Ribbon icon
    this.addRibbonIcon("cloud", "lqssblog Sync", () => {
      new SyncModal(this.app, this).open();
    });

    // Commands
    this.addCommand({
      id: "push-current-note",
      name: "推送当前笔记到博客",
      callback: () => {
        const file = this.app.workspace.getActiveFile();
        if (file) this.pushNote(file);
        else new Notice("lqssblog: 没有打开的笔记");
      },
    });

    this.addCommand({
      id: "pull-all-posts",
      name: "从博客拉取全部文章",
      callback: () => this.pullAllPosts(),
    });

    this.addCommand({
      id: "sync-all",
      name: "与博客全量双向同步",
      callback: () => this.syncAll(),
    });

    // Right-click context menu
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFile && file.extension === "md") {
          menu.addItem((item) => {
            item
              .setTitle("推送到 lqssblog")
              .setIcon("upload-cloud")
              .onClick(() => this.pushNote(file));
          });
        }
      })
    );

    this.addSettingTab(new LqssblogSettingTab(this.app, this));
  }

  onunload() {}

  // ===== Auth =====

  async login(): Promise<{ ok: boolean; reason: string }> {
    if (!this.settings.username || !this.settings.password) {
      return { ok: false, reason: "用户名或密码未填写" };
    }
    let resp: RequestUrlResponse;
    try {
      resp = await requestUrl({
        url: `${this.settings.blogUrl}/api/auth/login`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: this.settings.username,
          password: this.settings.password,
        }),
        throw: false,
      });
    } catch (e) {
      return { ok: false, reason: `网络错误: ${String(e)}` };
    }

    if (resp.status !== 200) {
      let msg = "";
      try { msg = resp.json?.error ?? resp.text; } catch { msg = String(resp.status); }
      return { ok: false, reason: `HTTP ${resp.status}: ${msg}` };
    }

    let token: string | undefined;
    try { token = resp.json?.token; } catch { /* ignore */ }
    if (!token) {
      return { ok: false, reason: "响应中没有 token 字段" };
    }

    this.settings.token = token;
    await this.saveSettings();
    return { ok: true, reason: "登录成功" };
  }

  getHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Cookie: `token=${this.settings.token}`,
    };
  }

  // Auto-retry with re-login on 401
  async apiReq(
    options: RequestUrlParam,
    retried = false
  ): Promise<RequestUrlResponse> {
    const resp = await requestUrl({
      ...options,
      headers: { ...this.getHeaders(), ...(options.headers ?? {}) },
      throw: false,
    });
    if (resp.status === 401 && !retried) {
      const { ok } = await this.login();
      if (ok) return this.apiReq(options, true);
    }
    return resp;
  }

  // ===== API =====

  async fetchMyPosts(): Promise<BlogPost[]> {
    const resp = await this.apiReq({
      url: `${this.settings.blogUrl}/api/user/posts`,
    });
    if (resp.status !== 200) return [];
    return (resp.json as { posts: BlogPost[] }).posts ?? [];
  }

  async createPost(data: {
    title: string;
    content: string;
    zone: Zone;
    visibility: Visibility;
    published: boolean;
    tags: string[];
  }): Promise<BlogPost | null> {
    const resp = await this.apiReq({
      url: `${this.settings.blogUrl}/api/posts`,
      method: "POST",
      body: JSON.stringify(data),
    });
    if (resp.status !== 201) return null;
    return (resp.json as { post: BlogPost }).post ?? null;
  }

  async updatePost(
    id: string,
    data: {
      title: string;
      content: string;
      zone: Zone;
      visibility: Visibility;
      published: boolean;
      tags: string[];
    }
  ): Promise<boolean> {
    const resp = await this.apiReq({
      url: `${this.settings.blogUrl}/api/posts/${id}`,
      method: "PUT",
      body: JSON.stringify(data),
    });
    return resp.status === 200;
  }

  // ===== Core Sync =====

  /** Push a single note to the blog. Shows PublishModal if zone not set. */
  async pushNote(file: TFile): Promise<void> {
    if (!this.settings.username || !this.settings.password) {
      new Notice("lqssblog: 请先在插件设置里填写用户名和密码");
      return;
    }

    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const zone = fm["blog-zone"] as Zone | undefined;

    if (!zone) {
      new PublishModal(this.app, this, file).open();
      return;
    }

    await this.doPush(file, fm as Record<string, unknown>, fm["blog-id"] as string | undefined, zone);
  }

  /** Actually push the note (called after zone is confirmed). */
  async doPush(
    file: TFile,
    fm: Record<string, unknown>,
    blogId: string | undefined,
    zone: Zone
  ): Promise<boolean> {
    const rawContent = await this.app.vault.read(file);
    const body = stripFrontmatter(rawContent);

    const title = (fm["title"] as string) || file.basename;
    const visibility = (fm["blog-visibility"] as Visibility) || "LOGIN_ONLY";
    const published = (fm["blog-published"] as boolean) ?? false;
    const tags = parseTags(fm["blog-tags"]);

    const now = new Date().toISOString();
    const data = { title, content: body, zone, visibility, published, tags };

    if (blogId) {
      const ok = await this.updatePost(blogId, data);
      if (!ok) {
        new Notice(`lqssblog: ✗ 更新失败 —「${title}」`);
        return false;
      }
    } else {
      const post = await this.createPost(data);
      if (!post) {
        new Notice(`lqssblog: ✗ 发布失败 —「${title}」`);
        return false;
      }
      blogId = post.id;
    }

    await this.app.fileManager.processFrontMatter(file, (f) => {
      f["blog-id"] = blogId;
      f["blog-synced-at"] = now;
      f["blog-updated-at"] = now;
    });

    new Notice(`lqssblog: ✓ 已推送「${title}」`);
    return true;
  }

  /** Pull all user's posts from the blog into the sync folder. */
  async pullAllPosts(): Promise<void> {
    if (!this.settings.username || !this.settings.password) {
      new Notice("lqssblog: 请先在插件设置里填写用户名和密码");
      return;
    }

    new Notice("lqssblog: 正在拉取…");
    const posts = await this.fetchMyPosts();

    if (!posts.length) {
      new Notice("lqssblog: 博客上还没有文章");
      return;
    }

    await this.ensureSyncFolder();

    let pulled = 0, skipped = 0;

    for (const post of posts) {
      const existing = this.findFileByBlogId(post.id);
      const syncedAt = existing
        ? (this.app.metadataCache.getFileCache(existing)?.frontmatter?.[
            "blog-synced-at"
          ] as string | undefined)
        : undefined;

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

    new Notice(`lqssblog: 拉取完成 —— 更新 ${pulled} 篇，跳过 ${skipped} 篇`);
  }

  /** Full bidirectional sync. */
  async syncAll(): Promise<void> {
    if (!this.settings.username || !this.settings.password) {
      new Notice("lqssblog: 请先在插件设置里填写用户名和密码");
      return;
    }

    new Notice("lqssblog: 开始双向同步…");
    const posts = await this.fetchMyPosts();
    const blogMap = new Map<string, BlogPost>(posts.map((p) => [p.id, p]));

    await this.ensureSyncFolder();

    let pushed = 0, pulled = 0, conflicts = 0, created = 0;
    const processedIds = new Set<string>();

    // Process all local files
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
      const blogId = fm["blog-id"] as string | undefined;
      const zone = fm["blog-zone"] as Zone | undefined;

      if (!blogId) {
        // New local file in a zone subfolder with blog-zone set → push to create
        const inZoneFolder =
          zone && file.path.startsWith(this.zoneFolder(zone) + "/");
        if (inZoneFolder) {
          const ok = await this.doPush(file, fm as Record<string, unknown>, undefined, zone!);
          if (ok) created++;
        }
        continue;
      }

      processedIds.add(blogId);
      const blogPost = blogMap.get(blogId);
      if (!blogPost) continue; // post deleted on blog side — skip

      const syncedAt = fm["blog-synced-at"] as string | undefined;
      const lastSyncTime = syncedAt ? new Date(syncedAt).getTime() : 0;
      const blogUpdatedAt = new Date(blogPost.updatedAt).getTime();
      const localUpdatedAt = file.stat.mtime;
      const BUFFER = 5_000; // 5s tolerance for clock skew

      const blogNewer = blogUpdatedAt > lastSyncTime + BUFFER;
      const localNewer = localUpdatedAt > lastSyncTime + BUFFER;

      if (blogNewer && localNewer) {
        conflicts++;
        new Notice(
          `lqssblog: ⚠ 冲突 —「${file.basename}」本地和远端都有更改，已跳过，请手动处理`
        );
        continue;
      }

      if (localNewer) {
        const ok = await this.doPush(
          file,
          fm as Record<string, unknown>,
          blogId,
          zone ?? (blogPost.zone as Zone)
        );
        if (ok) pushed++;
      } else if (blogNewer) {
        await this.app.vault.modify(file, buildNoteContent(blogPost));
        pulled++;
      }
    }

    // Pull posts from blog that don't exist locally yet
    for (const post of posts) {
      if (processedIds.has(post.id)) continue;
      const path = await this.uniquePath(
        `${this.zoneFolder(post.zone)}/${safeFilename(post.title) || post.id}.md`
      );
      await this.app.vault.create(path, buildNoteContent(post));
      pulled++;
    }

    const summary = [
      `↑ 推送 ${pushed + created}`,
      `↓ 拉取 ${pulled}`,
      conflicts ? `⚠ ${conflicts} 个冲突` : "",
    ]
      .filter(Boolean)
      .join("   ");

    new Notice(`lqssblog: 同步完成 —— ${summary}`);
  }

  // ===== Helpers =====

  findFileByBlogId(blogId: string): TFile | null {
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (fm?.["blog-id"] === blogId) return file;
    }
    return null;
  }

  zoneFolder(zone: Zone): string {
    return `${this.settings.syncFolder}/${ZONE_SUBFOLDER[zone]}`;
  }

  async ensureSyncFolder(): Promise<void> {
    const root = this.settings.syncFolder;
    if (!(await this.app.vault.adapter.exists(root))) {
      await this.app.vault.createFolder(root);
    }
    for (const sub of Object.values(ZONE_SUBFOLDER)) {
      const path = `${root}/${sub}`;
      if (!(await this.app.vault.adapter.exists(path))) {
        await this.app.vault.createFolder(path);
      }
    }
  }

  async uniquePath(path: string): Promise<string> {
    if (!(await this.app.vault.adapter.exists(path))) return path;
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
}

// ===== Sync Modal (Ribbon click) =====

class SyncModal extends Modal {
  plugin: LqssblogPlugin;

  constructor(app: App, plugin: LqssblogPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("lqss-modal");
    contentEl.createEl("h3", { text: "lqssblog Sync" });

    const grid = contentEl.createDiv({ cls: "lqss-grid" });

    this.btn(grid, "↑", "推送当前笔记", "upload-cloud", () => {
      const file = this.app.workspace.getActiveFile();
      if (file) this.plugin.pushNote(file);
      else new Notice("lqssblog: 没有打开的笔记");
    });

    this.btn(grid, "↓", "拉取全部文章", "download-cloud", () => {
      this.plugin.pullAllPosts();
    });

    this.btn(grid, "⇅", "全量双向同步", "refresh-cw", () => {
      this.plugin.syncAll();
    });
  }

  btn(
    parent: HTMLElement,
    icon: string,
    label: string,
    _lucide: string,
    onClick: () => void
  ) {
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
}

// ===== Publish Modal (first-time push, no zone set) =====

class PublishModal extends Modal {
  plugin: LqssblogPlugin;
  file: TFile;

  constructor(app: App, plugin: LqssblogPlugin, file: TFile) {
    super(app);
    this.plugin = plugin;
    this.file = file;
  }

  onOpen() {
    const { contentEl } = this;
    const fm = this.app.metadataCache.getFileCache(this.file)?.frontmatter ?? {};

    contentEl.createEl("h3", { text: "发布到 lqssblog" });

    let title = (fm["title"] as string) || this.file.basename;
    let zone: Zone = "ANIME";
    let visibility: Visibility = "LOGIN_ONLY";
    let published = false;
    let tags = parseTags(fm["blog-tags"]).join(", ");

    new Setting(contentEl)
      .setName("标题")
      .addText((t) =>
        t.setValue(title).onChange((v) => (title = v))
      );

    new Setting(contentEl)
      .setName("分区")
      .addDropdown((d) => {
        d.addOption("ANIME", "二次元（ANIME）");
        d.addOption("REAL", "三次元（REAL）");
        d.addOption("FOUR", "4频道（FOUR）");
        d.setValue(zone).onChange((v) => (zone = v as Zone));
      });

    new Setting(contentEl)
      .setName("可见性")
      .addDropdown((d) => {
        d.addOption("LOGIN_ONLY", "仅登录用户");
        d.addOption("PUBLIC", "公开");
        d.addOption("FRIENDS_ONLY", "仅好友");
        d.setValue(visibility).onChange((v) => (visibility = v as Visibility));
      });

    new Setting(contentEl)
      .setName("标签")
      .setDesc("多个标签用逗号分隔")
      .addText((t) =>
        t
          .setPlaceholder("tag1, tag2")
          .setValue(tags)
          .onChange((v) => (tags = v))
      );

    new Setting(contentEl)
      .setName("立即发布")
      .setDesc("关闭则保存为草稿")
      .addToggle((t) =>
        t.setValue(published).onChange((v) => (published = v))
      );

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText("发布")
        .setCta()
        .onClick(async () => {
          this.close();
          const tagList = tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
          // Write meta to frontmatter first so doPush can read it
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
              "blog-tags": tagList,
            },
            undefined,
            zone
          );
        })
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ===== Settings Tab =====

class LqssblogSettingTab extends PluginSettingTab {
  plugin: LqssblogPlugin;

  constructor(app: App, plugin: LqssblogPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "lqssblog Sync" });

    new Setting(containerEl)
      .setName("博客地址")
      .setDesc("不含末尾斜线，例如 https://lqssblog.serveblog.net")
      .addText((t) =>
        t
          .setPlaceholder("https://lqssblog.serveblog.net")
          .setValue(this.plugin.settings.blogUrl)
          .onChange(async (v) => {
            this.plugin.settings.blogUrl = v.replace(/\/$/, "");
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("用户名")
      .addText((t) =>
        t
          .setPlaceholder("your-username")
          .setValue(this.plugin.settings.username)
          .onChange(async (v) => {
            this.plugin.settings.username = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("密码")
      .addText((t) => {
        t.inputEl.type = "password";
        t.setValue(this.plugin.settings.password).onChange(async (v) => {
          this.plugin.settings.password = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("同步根文件夹")
      .setDesc("文章按分区保存到子文件夹：blog/anime · blog/real · blog/four")
      .addText((t) =>
        t
          .setPlaceholder("blog")
          .setValue(this.plugin.settings.syncFolder)
          .onChange(async (v) => {
            this.plugin.settings.syncFolder = v.trim().replace(/\/$/, "");
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("测试连接")
      .setDesc("验证用户名和密码是否正确")
      .addButton((btn) =>
        btn.setButtonText("测试").onClick(async () => {
          btn.setButtonText("连接中…").setDisabled(true);
          const { ok, reason } = await this.plugin.login();
          btn.setDisabled(false);
          if (ok) {
            btn.setButtonText("✓ 成功");
            new Notice("lqssblog: 登录成功");
          } else {
            btn.setButtonText("✗ 失败");
            new Notice(`lqssblog: 登录失败 — ${reason}`, 8000);
          }
          setTimeout(() => btn.setButtonText("测试"), 4000);
        })
      );
  }
}

// ===== Utility =====

function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return content;
  return content.slice(end + 4).trimStart();
}

function parseTags(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return (raw as unknown[]).map(String).filter(Boolean);
  if (typeof raw === "string")
    return raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  return [];
}

function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "-").trim().slice(0, 100);
}

function buildNoteContent(post: BlogPost): string {
  const tags = post.tags.map((t) => t.tag.name);
  const lines = [
    "---",
    `title: "${post.title.replace(/"/g, '\\"')}"`,
    `blog-id: "${post.id}"`,
    `blog-zone: ${post.zone}`,
    `blog-visibility: ${post.visibility}`,
    `blog-published: ${post.published}`,
  ];
  if (tags.length) {
    lines.push(`blog-tags: [${tags.map((t) => `"${t}"`).join(", ")}]`);
  }
  lines.push(
    `blog-synced-at: "${new Date().toISOString()}"`,
    `blog-updated-at: "${post.updatedAt}"`,
    "---",
    "",
    post.content
  );
  return lines.join("\n");
}
