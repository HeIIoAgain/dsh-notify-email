# dsh-notify-email 上架收尾清单

> ⚠️ **这份清单和 `RELEASE-v1.0.0.md` 都是给你自己看的工作材料，不要提交到仓库。**
> 该进仓库的只有 `.gitignore`、`.github/workflows/ci.yml`（和可选的 `publish.yml`）三个文件。
> Release 正文粘到 GitHub 的 Release 页面里，不需要进代码库。
> （上一个仓库 airprint 把这两个文件传上去了，记得去删掉。）

目标仓库：https://github.com/HeIIoAgain/dsh-notify-email

---

## 现状（2026-11-03 核实）

| 项 | 状态 |
|---|---|
| topics | ❌ 空数组 |
| `.gitignore` | ❌ 不存在 |
| `.github/workflows/` | ❌ 不存在 |
| tag / Release | ❌ `tags: []`、`releases: []` |
| 测试 | ✅ `test/run.mjs` 10 项检查，带假 SMTP（最强的一项，已就绪） |
| package.json | ✅ 完善（files/engines/repository/bugs 都对） |

> README、PUBLISHING.md、CHANGELOG 三处都写了「CI 跑 check + test」。加 `ci.yml` 之后三处同时成真，
> 文档一个字都不用改。PUBLISHING.md 还写了 `publish.yml`，所以那份也一并给了。

---

## 步骤 1 · 补文件到仓库根目录

| 本地产物 | 仓库位置 | 必选？ |
|---|---|---|
| `notify-email-publish/.gitignore` | `.gitignore` | 必须 |
| `notify-email-publish/.github/workflows/ci.yml` | `.github/workflows/ci.yml` | 必须 |
| `notify-email-publish/.github/workflows/publish.yml` | `.github/workflows/publish.yml` | 可选（要发 npm 才需要） |

**网页操作注意**：Upload files 拖拽会拒绝接收 `.github/workflows/` 下的文件。要用
**Add file ▾ → Create new file**，文件名直接输入 `.github/workflows/ci.yml`（输入 `/` 会自动建目录）。

建议 commit 信息：

```sh
git add .gitignore
git commit -m "chore: 忽略 node_modules、npm 打包产物与本地授权码文件"

git add .github/workflows/ci.yml
git commit -m "ci: 在 Node 22/24 上跑 check、test 与 npm pack 校验"

git push
```

**验收**：Actions 页出现一次 `CI`，4 个 job 全绿（约 1 分钟）。点进去能看到「Tests (fake SMTP on 127.0.0.1)」那一步输出 10 个 ✓。

---

## 步骤 2 · 加 topics

仓库现在是 **0 个 topic**。建议这 9 个（都核实过是有内容的标签页）：

| topic | 说明 |
|---|---|
| `deepseek-harness` | 21,505 个仓库，DSH 生态主标签 |
| `dsh-plugin` | 26,258 个仓库，插件类主标签 |
| `dsh` | 简称，搜的人多 |
| `cordis` | DSH 底层的插件框架名 |
| `smtp` | 技术词，nodemailer 一类项目都在用 |
| `email` | 大词，曝光主力 |
| `notifications` | 场景词 |
| `nodejs` | 语言/运行时词 |
| `esm` | 纯 ESM 实现，找无依赖插件的人会搜 |

命令行：

```bash
gh repo edit HeIIoAgain/dsh-notify-email \
  --add-topic deepseek-harness,dsh-plugin,dsh,cordis,smtp,email,notifications,nodejs,esm
```

网页：仓库首页右侧 **About** 旁 **⚙** → **Topics** → **每输入一个按回车** → Save changes。

验证：

```bash
gh api repos/HeIIoAgain/dsh-notify-email --jq .topics
```

---

## 步骤 3 · 打 tag + 建 Release

```sh
git tag -a v1.0.0 -m "v1.0.0 — 首个公开版本"
git push origin v1.0.0
```

然后 https://github.com/HeIIoAgain/dsh-notify-email/releases/new → 选 `v1.0.0` → 标题
`v1.0.0 — 首个公开版本` → 正文粘贴 `notify-email-publish/RELEASE-v1.0.0.md` 全文 →
勾 **Set as the latest release** → Publish。

**验收**：Releases 页有 v1.0.0；`git tag` 能列出。

---

## 步骤 4（可选）· badge

两个 README 的 H1 下方空一行插入：

```markdown
[![CI](https://github.com/HeIIoAgain/dsh-notify-email/actions/workflows/ci.yml/badge.svg)](https://github.com/HeIIoAgain/dsh-notify-email/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen.svg)](package.json)
```

⚠️ **别急着加 npm badge**：`https://img.shields.io/npm/v/dsh-notify-email.svg` 在包真正发布前会显示
`not found`，比没有还难看。等 npm 发布成功再加。

---

## 步骤 5（可选）· 发到 npm

已核实：npm registry 上 `dsh-notify-email` **目前没人占用**（`GET registry.npmjs.org/dsh-notify-email` 返回 404），
`package.json` 也是 unscoped 且零依赖，发布条件齐了。

```sh
npm login
npm publish --access public
```

发布后 README 里那句「从 npm（发布后）」的安装命令才成立：

```sh
dsh plugin --profile web add dsh-notify-email
```

要自动化发布，就传 `publish.yml`，然后：
1. https://www.npmjs.com/settings/~/tokens 生成 **Automation** 类型 token
2. 仓库 Settings → Secrets and variables → Actions → New repository secret，名称 `NPM_TOKEN`

没配 secret 时 `publish.yml` 只做打包检查，**不会失败**，可以放心先传着。

---

## 最终验收清单

- [ ] Actions 页有绿的 `CI`，4 个 job 通过，测试步骤输出 10 个 ✓
- [ ] About 显示 9 个 topics
- [ ] Releases 有 `v1.0.0`（Latest）
- [ ] `git log --oneline` 不止一条 commit
- [ ] 仓库里**没有** `CHECKLIST.md` / `RELEASE-v1.0.0.md`
- [ ] `git status` 干净，没有 `node_modules/` 或 `*.tgz` 被跟踪

---

## 我发现的三个小问题

### 1. CHANGELOG 的日期是 10-26，但仓库是 11-03 建的

`CHANGELOG.md` 写着 `## 1.0.0 — 2026-10-26`，仓库 `created_at` 是 `2026-11-03`。
如果 10-26 是你本地开发完成的时间，那没问题；但如果 tag / Release 显示 11-03，读的人会觉得对不上。
建议改成 `2026-11-03`，或干脆只写版本号不写日期（Keep a Changelog 允许）。

### 2. `PUBLISHING.md` 被打进了 npm 包

`package.json` 的 `files` 里有 `PUBLISHING.md`——这是你的**内部发布手册**，没必要占 npm 包体积、
也没必要让使用者看到「怎么 push 到 GitHub」。建议从 `files` 里删掉这一行。

### 3. commit 历史

和 airprint 一样是单条发布 commit。后面按我这套流程走，历史自然就长起来了，不用刻意补救。
