const zhCN: Record<string, string> = {
  // ===== Unlock Screen =====
  'Keepass Cat': 'Keepass Cat',
  'change...': '更换...',
  '🔒 master password': '🔒 主密码',
  'No keyfile selected.  (click to change)': '未选择密钥文件（点击更换）',
  'Manage Keyfiles': '管理密钥文件',
  'Do not remember': '不记住',
  'Remember for 30 min.': '记住 30 分钟',
  'Remember for 2 hours.': '记住 2 小时',
  'Remember for 4 hours.': '记住 4 小时',
  'Remember for 8 hours.': '记住 8 小时',
  'Remember for 24 hours.': '记住 24 小时',
  'Until browser exits.': '浏览器关闭前',
  'Remember forever.': '永久记住',
  ' (slide to choose)': '（滑动选择）',
  'Unlock Database': '解锁数据库',
  'Settings': '设置',
  'Database': '数据库',
  'Lock': '锁定',
  'Close Window': '关闭窗口',
  'No matches found for this site.': '未找到匹配此网站的条目',
  'invalid keyfile or KDBX file': '密钥文件或数据库文件无效',

  // ===== kdbxweb errors =====
  'Invalid credential': '密码或密钥文件不正确',
  'Error opening database: Invalid credential': '数据库密码或密钥文件不正确',
  'Bad password or corrupted database': '密码错误或数据库已损坏',
  'InvalidKey': '密钥无效',
  'InvalidSignature': '数据库签名无效',
  'Integrity': '数据库完整性校验失败',
  'Unlocking ': '正在解锁 ',

  // ===== Entry List =====
  'search entire database...': '搜索整个数据库...',
  'New entry': '新建条目',

  // ===== Entry Details =====
  'back to entry list': '返回条目列表',
  'One Time Password': '一次性密码',
  'Copy to clipboard': '复制到剪贴板',
  'Autofill': '自动填充',

  // ===== Entry Edit =====
  'Delete': '删除',
  'Click again to confirm': '再次点击确认删除',
  'Group': '分组',
  'Title': '标题',
  'Username': '用户名',
  'Password': '密码',
  'URL': '网址',
  'Notes': '备注',
  'Save': '保存',
  'Saving...': '保存中...',
  'Cancel': '取消',
  'Uploading...': '上传中...',
  'Saved!': '已保存',
  'Deleting...': '删除中...',
  'Error: ': '错误：',
  'Delete error: ': '删除错误：',
  '(empty)': '（空）',

  // ===== Browse Entries =====
  'Rename group': '重命名分组',
  'Delete group': '删除分组',
  'New Group': '新建分组',
  'Group name...': '分组名称...',
  'Renaming...': '重命名中...',
  'Renamed.': '已重命名',
  'Deleted.': '已删除',
  'Creating...': '创建中...',
  'Created.': '已创建',
  'Delete group "{0}" and all {1} entries?': '删除分组 "{0}" 及其所有 {1} 个条目？',
  'Delete empty group "{0}"?': '删除空分组 "{0}"？',

  // ===== Footer / Shared =====
  'Confirm': '确认',

  // ===== Entry button tooltips =====
  'Open URL': '打开网址',
  'Copy username': '复制用户名',
  'Copy password': '复制密码',
  'Edit entry': '编辑条目',

  // ===== Password generator =====
  'Generate strong password': '生成强密码',

  // ===== URL placeholder =====
  'e.g. https://site.com or regex:.*\\.domain\\.com/.*': '例如 https://site.com 或 regex:.*\\.domain\\.com/.*',

  // ===== Startup / Onboarding =====
  'Keepass Cat is an extension that uses your existing KeePass database files to autofill passwords on websites. In order to continue, you must add your KeePass database file(s).': 'Keepass Cat 是一个使用已有 KeePass 数据库文件自动填充网站密码的扩展。要开始使用，您需要添加至少一个 KeePass 数据库文件。',
  'Add a KeePass database file': '添加 KeePass 数据库文件',
  'You can return here when you\'ve enabled one of the database file providers.': '启用任一数据库文件提供程序后，你可以返回此页面。',
  'Manage Database Files': '管理数据库文件',

  // ===== Options Navbar =====
  'Getting Started': '快速入门',
  'Manage Databases': '管理数据库',
  'Advanced': '高级设置',

  // ===== Options: Getting Started =====
  'Getting Started with Keepass Cat': 'Keepass Cat 快速入门',
  'Keepass Cat helps you keep track of all your accounts by storing your passwords in an encrypted file called a Keepass Database. You choose where this file is stored - most people keep them on a WebDAV server for easy access and syncing between laptops, desktops, and phones. To use Keepass Cat, you should first enable the WebDAV provider below.': 'Keepass Cat 帮助你将所有密码存储在一个加密的文件中（即 KeePass 数据库）。你可以选择文件的存储位置——大多数人会将文件放在 WebDAV 服务器上，以便在笔记本、台式机和手机之间同步。要使用 Keepass Cat，你需要先启用下方的 WebDAV 提供程序。',
  'Optionally, you may also import any required keyfiles. A keyfile can be used together with a password to provide even better security, or even used instead of one.': '你还可以导入所需的密钥文件。密钥文件可与密码一起使用以增强安全性，也可以替代密码。',
  'That\'s it! Keepass Cat will automatically discover any Keepass databases that your have in your cloud storage, and allow you to switch between databases from the browser popup.': '就这样！Keepass Cat 会自动在云存储中发现你的 KeePass 数据库，并允许从浏览器弹窗中切换数据库。',
  'If you are a new Keepass user, you will be prompted to create a new database from the popup window after you enable a cloud storage provider. Most people keep all their passwords in a single database, so you will only need to do this once.': '如果你是新用户，启用云存储后，将提示你从弹窗创建新数据库。大多数人将所有密码保存在一个数据库中，因此只需要执行一次。',
  '1. Cloud Storage Setup': '1. 云存储设置',
  '2. Keyfile Setup (optional)': '2. 密钥文件设置（可选）',
  'Support Keepass Cat': '支持 Keepass Cat',
  'If you like Keepass Cat, please consider leaving a review on the google web store or firefox addon store. If you find a problem or are dissatisfied, please instead open an issue on the issue tracker so we can make Keepass Cat better.': '如果你喜欢 Keepass Cat，请考虑在 Chrome 网上应用店或 Firefox 附加组件商店留下评价。如果你遇到问题或不满意，请在 issue 跟踪器中提交问题，以便我们改进 Keepass Cat。',

  // ===== Options: Manage Keyfiles =====
  'Key files are an optional authentication method. More info on key files is available on the KeePass site': '密钥文件是可选的认证方式。更多信息请参考 KeePass 官方文档',
  'Keepass Cat can store your key files locally in your browser\'s storage, and apply them when opening your password database. Websites and other browser extensions do not have access to these files. However, they are stored unencrypted in your local browser profile and someone with access to your device could read them.': 'Keepass Cat 可以将你的密钥文件存储在浏览器本地，在打开数据库时使用。网站和其他浏览器扩展无法访问这些文件，但它们以未加密形式存储在你的浏览器本地配置文件中，有设备访问权限的人可以读取。',
  'Add Key File': '添加密钥文件',

  // ===== Options: Advanced Settings =====
  'Clipboard Expiration Time': '剪贴板过期时间',
  'When you copy a value to the clipboard, Keepass Cat will set a timeout to automatically clear it again. You can choose how long this timeout will last.': '复制内容到剪贴板后，Keepass Cat 会设置一个定时器，到期自动清除。你可以选择保留时长。',
  '1 minute': '1 分钟',
  '2 minutes': '2 分钟',
  '3 minutes': '3 分钟',
  '5 minutes': '5 分钟',
  '8 minutes': '8 分钟',
  'Enable Hotkey Navigation': '启用快捷键导航',
  'If enabled, you will be able to use [TAB] and [ENTER] to navigate and autofill your passwords when the Keepass Cat UI is open. By default, [CTRL]+[SHIFT]+[SPACE] will open the Keepass Cat popup': '启用后，在 Keepass Cat 弹窗中可使用 [Tab] 和 [Enter] 键导航并自动填充密码。默认快捷键 [Ctrl]+[Shift]+[Space] 可打开 Keepass Cat 弹窗。',
  'Hotkey Navigation': '快捷键导航',
  'Grant Permission on All Websites': '授予所有网站权限',
  'Only proceed if you know what you\'re doing.': '仅在了解后果的前提下继续。',
  'If enabled, the extension prompts once for permission to access and change data on all websites which disables the permissions popup on each new website. This has serious security implications. Only applies to Chrome. Because of a Chrome bug, it is currently impossible to revoke this permission again after it is enabled. If you turn this ON, Keepass Cat must be reinstalled to reset.': '启用后，扩展将一次性请求所有网站的访问和修改权限，不会在每个新网站上弹出权限提示。但这有严重安全隐患。仅适用于 Chrome。由于 Chrome 的一个 bug，启用后无法撤销，需要重新安装 Keepass Cat 才能重置。',
  'Grant All Permissions': '授予所有权限',
  'Notification': '通知',
  'Choose which type of notification do you want to receive from Keepass Cat.': '选择你希望从 Keepass Cat 收到的通知类型。',
  'Password expiration': '密码过期通知',
  'Clipboard events': '剪贴板事件通知',
  'Enable Strict Matching': '启用严格匹配',
  'If enabled, only entries whose origins match exactly will be suggested for input. Titles and other tab information will not be considered in matching.': '启用后，仅匹配完全相同的域名才会被建议填充。标题和其他标签页信息不会被用于匹配。',
  'Strict Matching': '严格匹配',
  'Stored Data': '已存储数据',
  'The following objects represent the current data cached in local storage. This data is only available to Keepass Cat, and is never sent over any network connection.': '以下对象代表当前在本地存储中缓存的数据。这些数据仅供 Keepass Cat 使用，绝不会通过网络发送。',

  // ===== Providers: WebDAV =====
  'The URL below should have the path of a FOLDER, not an individual FILE. The webDAV provider works by recursively scanning all files within the folder you specify. Your keepass databases will be discovered by their file extension (.kdbx).': '下方的 URL 应为文件夹路径，而非单个文件。WebDAV 提供程序会递归扫描指定文件夹中的所有文件，通过文件扩展名（.kdbx）发现 KeePass 数据库。',
  'User': '用户',
  'Actions': '操作',
  'scan': '扫描',
  'scanning': '扫描中',
  'remove': '移除',
  'Add new server': '添加新服务器',
  'http://server:port/remote.php/webdav/': 'http://服务器:端口/remote.php/webdav/',
  'Add server': '添加服务器',

  // ===== Provider Metadata =====
  'WebDAV': 'WebDAV',

  // ===== Error Messages (services) =====
  'Failed to read file header': '文件头读取失败',
  'Unsupported Database Version': '不支持的数据库版本',
  'Session expired. Please re-unlock the database.': '会话已过期，请重新解锁数据库。',
  'Entry not found in database': '数据库中未找到该条目',
  'Group not found': '未找到该分组',
  'Network Connection Error': '网络连接错误',
  'No network connection': '无网络连接',
  'Database no longer exists': '数据库已不存在',
  'Current database is not WebDAV': '当前数据库不是 WebDAV 类型',
  'Server not found': '未找到服务器',
  'Unable to determine tab details': '无法获取标签页详情',

  // ===== Notifications =====
  'Clipboard cleared': '剪贴板已清除',
  'Remember password expired': '记住密码已过期',
  ' copied to clipboard. Clipboard will clear in {0} minute(s).': ' 已复制到剪贴板，将在 {0} 分钟后清除。',

  // ===== Providers: WebDAV extras =====
  'URL points to a file, not a folder. Please enter the parent folder path instead.': 'URL 指向的是文件而非文件夹，请输入父文件夹路径',

  // ===== Misc link & segment texts =====
  'leaving a review on the google web store': '在 Chrome 网上应用店留下评价',
  'firefox addon store': 'Firefox 附加组件商店',
  'issue tracker': 'issue 跟踪器',
  'optional authentication method': '可选认证方式',
  'KeePass site': 'KeePass 网站',
  'stored unencrypted': '以未加密形式存储',
  'serious security implications': '严重的安全隐患',
  'Keepass2Android': 'Keepass2Android',
  'KeePassXC': 'KeePassXC',
  'KeeWeb': 'KeeWeb',
  'the troubleshooting guide': '故障排除指南',
  'open an issue': '提交 issue',

  // ===== Autofill Shortcut =====
  'Autofill Shortcut': '自动填充快捷键',
  'Open Chrome shortcut settings': '打开 Chrome 快捷键设置',
  'Customize shortcuts in Firefox: toolbar menu (top-right) → Add-ons and themes → gear icon (top-right) → Manage Extension Shortcuts.': '在 Firefox 中自定义快捷键：右上角工具栏菜单 → 扩展和主题 → 右上角齿轮图标 → 管理扩展快捷键。',

  ' or ': ' 或 ',

  // ===== Manage Keyfiles paragraph fragments =====
  'Key files are an ': '密钥文件是一种 ',
  '. More info on key files is available on the ': '。更多信息请参考 ',
  'Keepass Cat can store your key files locally in your browser\'s storage, and apply them when opening your password database. Websites and other browser extensions do not have access to these files. However, they are ': 'Keepass Cat 可以将密钥文件存储在浏览器本地，在打开数据库时使用。网站和其他扩展无法访问这些文件，但它们会 ',
  ' in your local browser profile and someone with access to your device could read them.': ' 在你的浏览器本地配置文件中，有设备访问权限的人可以读取。',

  // ===== Advanced Settings paragraph fragments =====
  ' If enabled, the extension prompts once for permission to access and change data on all websites which disables the permissions popup on each new website. This has ': ' 启用后，扩展将一次性请求所有网站的访问和修改权限，不会在每个新网站上弹出权限提示。这有',
  '. Only applies to Chrome. Because of a Chrome bug, it is currently impossible to revoke this permission again after it is enabled. If you turn this ON, Keepass Cat must be reinstalled to reset.': '。仅适用于 Chrome。由于 Chrome 的一个 bug，启用后无法撤销，需要重新安装 Keepass Cat 才能重置。',
  'If enabled, only entries whose origins match exactly will be suggested for input. Titles and other tab information will not be considered in matching. For example': '启用后，仅匹配完全相同的域名才会被建议填充。标题和其他标签页信息不会被用于匹配。例如',
  ' will not match ': ' 不会匹配 ',

  // ===== Support fragments =====
  'If you like Keepass Cat, please consider ': '如果你喜欢 Keepass Cat，请考虑在 ',
  ' so we can make Keepass Cat better.': '，以便我们改进 Keepass Cat。',
  '. If you find a problem or are dissatisfied, please instead open an issue on the ': '。如果你遇到问题或不满意，请在 ',

  // ===== TOTP =====
  'Enable TOTP': '启用 TOTP',
  'Invalid otpauth URL': '无效的 otpauth URL',
  'Copy TOTP code': '复制TOTP验证码',
};

export default zhCN;
