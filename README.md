# 🐱 Keepass Cat — KeePass Browser Extension

[![Version](https://img.shields.io/badge/version-3.4.7-blue)](https://github.com/helloworldbugs/keepass-cat/releases)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![CI](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com/helloworldbugs/keepass-cat/actions)

Keepass Cat 是一款开源、轻量的 KeePass 浏览器扩展，把你现有的 WebDAV 云端上的 KeePass 数据库（.kdbx）直接接入浏览器，实现密码自动填充、以及密码条目的增删改查。可彻底抛弃本地运行的Keepass、KeepassXC客户端，一个浏览器扩展就够用了

核心功能

- 一键自动填充：智能识别页面上的用户名/密码输入框，精准填充，并且支持自定义键盘快捷键自动填充
- 4 级 URL 匹配：精确 → 同源 → 同域名 → 正则，自动排序最匹配的条目，扩展图标实时显示匹配数量
- 不只是只读：在弹窗中直接新增、编辑、删除条目与分组，改动自动写回数据库
- TOTP 双因素认证：显示动态验证码并一键复制（带倒计时），支持编辑保存
- 强密码生成器：一键生成高强度随机密码
- 剪贴板保护：复制后定时自动清除，防止密码残留

---

## 📋 目录

- [🐱 Keepass Cat — KeePass Browser Extension](#-keepass-cat--keepass-browser-extension)
  - [📋 目录](#-目录)
  - [✨ 功能特性](#-功能特性)
  - [🗄️ 数据库管理](#️-数据库管理)
    - [条目操作](#条目操作)
    - [📁 分组管理](#-分组管理)
    - [🔐 TOTP 双因素认证](#-totp-双因素认证)
  - [⌨️ 键盘快捷键填充](#️-键盘快捷键填充)
  - [🧠 分级 URL 匹配策略](#-分级-url-匹配策略)
    - [匹配等级](#匹配等级)
    - [匹配流程](#匹配流程)
    - [徽章计数逻辑](#徽章计数逻辑)
    - [正则表达式匹配](#正则表达式匹配)
  - [⚡ 自动填充引擎](#-自动填充引擎)
    - [两种触发方式](#两种触发方式)
    - [字段检测算法](#字段检测算法)
    - [Iframe 跨域填充](#iframe-跨域填充)
  - [☁️ 云端存储支持](#️-云端存储支持)
    - [存储后端架构](#存储后端架构)
  - [🔐 安全设计](#-安全设计)
    - [加密存储](#加密存储)
    - [双层记忆系统](#双层记忆系统)
    - [遗忘定时器](#遗忘定时器)
    - [安全原则](#安全原则)
    - [密钥文件 (Keyfile)](#密钥文件-keyfile)
  - [🚀 快速开始](#-快速开始)
    - [安装](#安装)
    - [开发](#开发)
    - [构建产物](#构建产物)
  - [🏗️ 技术栈](#️-技术栈)
  - [📐 架构概览](#-架构概览)
    - [数据流](#数据流)
  - [🧪 测试](#-测试)
  - [🙏 致谢](#-致谢)

---

## ✨ 功能特性

| 功能 | 说明 |
|------|------|
| 🕐 **遗忘定时器** | 可配置数据库解锁记忆时长：30 分钟 → 永久，到期自动清除 |
| 🔢 **徽章计数** | 扩展图标右下角实时显示当前页面匹配的密码条目数量 |
| ⚡ **一键填充** | 点击条目即可自动填充用户名和密码 |
| 🧠 **分级匹配** | 独创的 4 级 URL(支持正则表达式) 匹配算法，精准排序最佳匹配条目 |
| ✏️ **增删改查** | 直接在弹窗中编辑标题、用户名、密码(支持随机生成强密码)、URL、备注、TOTP，保存回 WebDAV 上的 KDBX 文件 |
| 📂 **分组管理** | 创建、重命名、删除分组，条目在分组间自由移动 |
| 🔐 **TOTP 双因素** | 一键复制 TOTP 动态验证码（带倒计时），支持编辑保存（`otpauth://`） |
| 🔄 **WebDAV 同步** | 支持 WebDAV 云端同步（坚果云 / Nextcloud 等私有部署），编辑后自动写回 |
| 🌍 **中英文国际化** | 完整的中英文界面翻译，自动检测浏览器语言 |
| 🛡️ **Manifest V3** | 完整兼容 Chrome MV3，同时支持 Firefox MV2 |

---

## 🗄️ 数据库管理

### 条目操作

| 操作 | 说明 |
|------|------|
| ➕ **新建** | 填写标题、用户名、密码、URL(支持正则表达式)、备注，选择分组 |
| ✏️ **编辑** | 点击铅笔图标，修改任意字段，点击保存 |
| 🗑️ **删除** | 二次确认防误删，删除后自动上传更新 |
| 📋 **复制** | 一键复制用户名或密码到剪贴板 |
| 🔗 **打开网址** | 点击图标，新标签页打开条目 URL |
| 🔑 **生成密码** | 编辑时点击钥匙图标，生成 16-20 位混合密码 |
| 🔐 **TOTP** | 列表项时钟图标一键复制动态验证码（带倒计时），编辑页勾选「启用 TOTP」配置 `otpauth://` URL |

### 📁 分组管理

```
📁 社交
  ├── 🔑 Twitter
  ├── 🔑 Facebook
  └── 🔑 Instagram
📁 工作
  ├── 🔑 公司邮箱
  ├── 🔑 内部系统
  └── 🔑 VPN
📁 银行
  ├── 🔑 工商银行
  └── 🔑 招商银行
```

- 创建 / 重命名 / 删除分组
- 条目在分组间自由移动
- 树形结构浏览，支持展开/折叠

### 🔐 TOTP 双因素认证

- 支持 `otpauth://` 标准格式（SHA1 / SHA256 / SHA512，6-8 位验证码，含 Steam 格式）
- 密码列表项显示一个时钟图标 + 纯文字倒计时（如 `24s`），点击图标一键复制当前验证码
- 编辑页通过「启用 TOTP」开关新增 / 修改 `otpauth://` URL

---

## ⌨️ 键盘快捷键填充

| 快捷键 | 命令 | 说明 |
|--------|------|------|
| `Ctrl+Shift+Space` | 打开弹窗 | 打开 Keepass Cat 弹窗 |
| `Ctrl+Shift+X` | 最佳匹配填充 | 自动填充当前页面最佳匹配条目 |

> 快捷键可在 Chrome 扩展管理页面 `chrome://extensions/shortcuts` 自定义。

---

## 🧠 分级 URL 匹配策略

独创的**4 级 URL 匹配算法**，它同时驱动**徽章计数**和**自动填充优先排序**，确保最相关的密码条目始终排在第一位。

### 匹配等级

| 级别 | 条件 | 示例 | 得分 |
|:---:|---|---|:---:|
| **4** | 条目的 URL 完整包含在页面 URL 中 | 条目 `a.com/admin` → 页面 `a.com/admin/login` | **100** |
| **3** | 协议 + 主机名 + 端口完全一致 | 条目 `https://a.com` → 页面 `https://a.com/any` | **75** |
| **2** | 相同域名（最后两段） | 条目 `a.example.com` → 页面 `b.example.com` | **50** |
| **1** | 正则表达式匹配 | 条目 `regex:login\..*\.com` → 页面 `login.test.com` | **25** |
| **0** | 无匹配 | 任意不相关 URL | **0** |

### 匹配流程

```
页面 URL  ──→  Level 4: 包含匹配?  ──→  ✅ 优先展示
    │              │
    │              └──→  Level 3: 同源匹配?  ──→  ✅ 第二优先
    │                       │
    │                       └──→  Level 2: 同域名?  ──→  ✅ 第三优先
    │                                │
    │                                └──→  Level 1: 正则匹配?  ──→  ✅ 兜底
    │                                         │
    │                                         └──→  Level 0: 无匹配
```

### 徽章计数逻辑

```
1. 遍历所有缓存条目，对每个条目计算最高匹配等级
2. 统计达到最高等级的所有条目数量
3. 在扩展图标上显示该数字
4. 切换标签页时自动更新
```

### 正则表达式匹配

在条目 URL 字段以 `regex:` 前缀开头即可使用正则：

```
regex:login\..*\.com    →  匹配所有 login.*.com 子域名
regex:10\.0\.\d+\.\d+   →  匹配所有 10.0.x.x 内网 IP
regex:192\.168\.\d+\.\d+:8080  →  匹配特定网段和端口
```

---

## ⚡ 自动填充引擎

### 两种触发方式

| 方式 | 操作 | 适用场景 |
|------|------|----------|
| 🖱️ **弹窗点击** | 打开 Keepass Cat 弹窗，点击条目 | 最常用，可浏览选择 |
| ⌨️ **快捷键** | `Ctrl+Shift+X` | 快速填充，无需鼠标 |

### 字段检测算法

Keepass Cat 使用**双方法检测**来定位页面上的用户名和密码输入框：

**方法一：焦点法（优先）**
```
用户光标所在位置 → 检测相邻输入框 → 跳过隐藏/不可见元素 → 精准定位
```
- 如果聚焦在用户名框 → 向后搜索找到第一个可见的 `type="password"` 输入框
- 如果聚焦在密码框 → 向前搜索找到第一个可见的非密码输入框
- 自动跳过 `type="hidden"` 等不可见元素

**方法二：全局扫描法（兜底）**
```
遍历所有可见 input → 按类型配对 → 生成 用户名-密码 对列表
```
- 识别注册表单（连续两个密码框）并自动排除
- 处理独立密码框（无用户名配对的情况）

### Iframe 跨域填充

```
┌─────────────────────────────────┐
│  主页面 (gitee.com)              │
│  ┌───────────────────────────┐  │
│  │  iframe (udesk.cn)         │  │
│  │  [用户名] [密码] [登录]     │  │  ← 也能填充！
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

- 内容脚本注入到**所有 frame**
- 每个 frame 独立进行**来源安全检查**
- 白名单机制解决已知的跨域场景（如银行网站）

---

## ☁️ 云端存储支持

Keepass Cat 通过 **WebDAV** 协议同步 KeePass 数据库：

| 存储后端 | 类型 | 说明 |
|----------|------|------|
| 🔗 **WebDAV** | 私有部署 | 支持坚果云等 WebDAV 服务，扫描目录自动发现 `.kdbx` 文件，支持上传保存 |

### 存储后端架构

```
PasswordFileStoreRegistry (注册中心)
    └── WebdavFileManager (WebDAV)
```

所有后端统一实现 `FileManager` 接口，通过 `PasswordFileStoreRegistry` 注册和调度。

---

## 🔐 安全设计

### 加密存储

```
┌──────────────┐     AES-CBC      ┌──────────────────┐
│  明文数据     │  ──────────────→  │  chrome.storage   │
│  (密码/条目)  │   256-bit key    │  (加密态)          │
└──────────────┘                  └──────────────────┘
```

- 使用 **AES-CBC 256 位**加密存储在 `chrome.storage.session` 或 `chrome.storage.local`
- 密钥在运行时通过 Web Crypto API 生成，不落盘
- 自定义序列化协议处理二进制数据（ArrayBuffer → Base64）

### 双层记忆系统

| 存储层 | 存储介质 | 生命周期 | 用途 |
|--------|----------|----------|------|
| **Session 层** | `storage.session` | 浏览器会话 | 临时缓存，会话结束自动清除 |
| **Local 层** | `storage.local` | 持久化 | "永久记住"模式，跨浏览器重启 |

### 遗忘定时器

```
记住时长:  [不记住]  [30分钟]  [2小时]  [4小时]  [8小时]  [24小时]  [本次会话]  [永久]
           ──────────────────────────────────────────────────────────────────────────→
```

- 到期后自动清除主密码和缓存的条目数据
- 每 2 分钟检查一次过期定时器
- 支持密码过期、剪贴板过期两种通知类型

### 安全原则

- 🔒 主密码只在内存中解密，**不持久化明文**
- 🚫 不在控制台输出敏感信息
- ✅ 默认只读展示，仅在用户主动编辑保存时才写回 KDBX 文件
- 🛡️ 来源检查：填充前验证 frame 与目标页面的 hostname 一致性

### 密钥文件 (Keyfile)

- 支持 KeePass 全部四种 Keyfile 格式：XML（推荐）、32 字节、十六进制、哈希
- 密钥文件可与主密码组合使用，也可单独作为认证方式
- 密钥文件存储在浏览器本地存储中，网站与其他扩展无法访问

---



## 🚀 快速开始

### 安装

1. 从 [Releases](https://github.com/helloworldbugs/keepass-cat/releases) 下载最新版本
2. 解压到本地目录
3. 打开 `chrome://extensions`，开启「开发者模式」
4. 点击「加载已解压的扩展程序」，选择解压目录

### 开发

```bash
# 克隆仓库
git clone https://github.com/helloworldbugs/keepass-cat.git
cd keepass-cat

# 安装依赖
npm install --legacy-peer-deps

# 开发模式（热重载）
npm run dev

# 生产构建
npm run build

# 仅构建内容脚本
npm run build:js

# 仅构建后台脚本
npm run build:background
```

### 构建产物

| 命令 | 输入 | 输出 |
|------|------|------|
| `build:web` | `src/` (Vue 弹窗/选项页) | `extension/dist/` |
| `build:background` | `background/background.js` | `extension/dist/background/index.mjs` |
| `build:js` | `background/inject.js` (内容脚本) | `extension/dist/contentScripts/index.global.js` |

---

## 🏗️ 技术栈

| 技术 | 用途 |
|------|------|
| [Vue 3](https://vuejs.org/) (`@vue/compat`) | 弹窗 UI 框架 |
| [Vite](https://vitejs.dev/) | 构建工具 |
| [kdbxweb](https://github.com/keeweb/kdbxweb) | KeePass 数据库解析 |
| [Argon2](https://github.com/antelle/argon2-browser) | KDF 密钥派生 |
| [webdav](https://github.com/perry-mitchell/webdav-client) | WebDAV 客户端 |
| [Chrome Extensions API](https://developer.chrome.com/docs/extensions/reference/) | 浏览器扩展 API |
| GitHub Actions | CI/CD 自动构建 |

---

## 📐 架构概览

```
┌─────────────────────────────────────────────────────┐
│                    Popup (Vue 3)                      │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│  │ Startup │ │FilePicker│ │  Unlock  │ │ Edit    │ │
│  │         │ │          │ │          │ │         │ │
│  └─────────┘ └──────────┘ └──────────┘ └─────────┘ │
│                        │                             │
│                  UnlockedState                       │
│              (状态管理 + 剪贴板 + 自动填充)              │
├────────────────────────┼─────────────────────────────┤
│               SecureCacheMemory                       │
│          (端口通信桥接 popup ↔ background)              │
├────────────────────────┼─────────────────────────────┤
│              Background Service Worker                │
│  ┌──────────────────────────────────────────────┐   │
│  │  ProtectedMemory  │  Settings  │ Badge 更新   │   │
│  │  (AES-CBC 加密)    │  (配置)    │ (图标计数)    │   │
│  │  LocalMemory       │            │ 快捷键处理    │   │
│  │  (持久化加密)       │            │ 会话管理      │   │
│  └──────────────────────────────────────────────┘   │
├────────────────────────┼─────────────────────────────┤
│             Content Script (inject.js)                │
│  ┌──────────────────────────────────────────────┐   │
│  │  字段检测  │  fillPassword  │  来源安全检查    │   │
│  │  (焦点法+  │  (值填充+      │  (hostname      │   │
│  │   全局扫描) │   DOM事件触发)  │   验证)         │   │
│  └──────────────────────────────────────────────┘   │
├────────────────────────┼─────────────────────────────┤
│                    Services                           │
│  ┌──────────┐ ┌────────────┐ ┌──────────────────┐  │
│  │ Keepass  │ │ Keepass    │ │ PasswordFileStore│  │
│  │ Service  │ │ Reference  │ │ Registry (1后端) │  │
│  └──────────┘ └────────────┘ └──────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 数据流

```
用户点击条目
    │
    ▼
UnlockedState.autofill(entry)
    │
    ▼
Background: autofill 消息
    │
    ├──→ 注入 content script 到所有 frame
    │
    └──→ 向每个 frame 发送 fillPassword
            │
            ├── 来源安全检查 (hostname 匹配)
            │
            └── filler.fillPassword(user, pass)
                    │
                    ├── 方法1: 焦点法 (优先)
                    │   └── 跳过隐藏元素，搜索真正的密码框
                    │
                    └── 方法2: 全局扫描 (兜底)
                        └── 遍历所有可见 input，配对填充
```

---

## 🧪 测试

> ⚠️ 当前 `tests/` 目录下的测试为原 AngularJS 代码库遗留，尚未迁移到现有 Vue 3 + Vite 技术栈，且 `package.json` 未配置 `test` 脚本，暂无法通过 `npm test` 运行。测试基础设施有待完善（计划接入 Vitest）。

---

## 🙏 致谢

- 原始项目：[subdavis/Tusk](https://github.com/subdavis/Tusk)
- Fork 维护：[helloworldbugs](https://github.com/helloworldbugs)
- KeePass 数据库解析：[keeweb/kdbxweb](https://github.com/keeweb/kdbxweb)
- 构建于 [Vue 3](https://vuejs.org/) · [Vite](https://vitejs.dev/) · [Chrome Extensions](https://developer.chrome.com/docs/extensions/)

---

<p align="center">
  <sub>Made with ❤️ by the Keepass Cat community</sub>
</p>