const zhCN: Record<string, string> = {
  // ===== Unlock Screen =====
  'Keepass Cat': 'Keepass Cat',
  'Master password': '主密码',
  'No keyfile selected. (click to change)': '未选择密钥文件（点击更换）',
  'No keyfile': '不使用密钥文件',
  'Manage Keyfiles': '管理密钥文件',
  'Do not remember': '不记住',
  'Remember password:': '记住密码时间：',
  '10 minutes': '10 分钟',
  '1 hour': '1 小时',
  '8 hours': '8 小时',
  '24 hours': '24 小时',
  'until the browser exits': '浏览器关闭前',
  'forever': '永久',
  // ===== Local password databases (settings) =====
  'Status': '状态',
  'Authorised': '已授权',
  'Needs permission': '需要授权',
  'Type': '类型',
  'XML': 'XML',
  'Binary': '二进制',
  'Other': '其他',
  'File name': '文件名',
  'New password database': '新建密码库',
  'New key file': '新建密钥文件',
  'Import key file': '导入密钥文件',
  'Change password': '修改密码',
  'Database name': '密码库名称',
  'Current unlock password': '当前解锁密码',
  'Current key file': '当前密钥文件',
  'No key file': '不使用密钥文件',
  'Unlock password': '解锁密码',
  'New unlock password': '新的解锁密码',
  'Confirm password': '确认密码',
  'Key file': '密钥文件',
  'Keep the current one': '保持不变',
  'Create': '创建',
  'Give the database a name.': '请填写密码库名称。',
  'The password cannot be empty.': '密码不能为空。',
  'The two passwords do not match.': '两次输入的密码不一致。',
  'There is no way to recover a forgotten password: keep it somewhere safe.': '密码一旦忘记就无法找回，请妥善保存。',
  'Unlock password changed. Enter it once in the popup.': '解锁密码已修改。请在扩展里用新密码解锁一次。',
  'The current password or key file does not unlock this database.': '当前密码或密钥文件无法解锁该数据库。',
  // Short scale labels under the remember-period slider. The unit symbols read
  // the same in every language, so only the words are actually translated.
  'off': '关闭',
  '10m': '10m',
  '1h': '1h',
  '8h': '8h',
  '24h': '24h',
  'exit': '退出时',
  '∞': '永久',
  // ===== In-page autofill icon =====
  'Autofill from Keepass Cat': '用 Keepass Cat 自动填充',
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

  // ===== Entry Edit =====
  'Delete': '删除',
  'Click again to confirm': '再次点击确认删除',
  'Group': '分组',
  'Title': '标题',
  'Username': '用户名',
  'Password': '密码',
  'Show password': '显示密码',
  'Hide password': '隐藏密码',
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

  // ===== Custom Fields =====
  'Custom fields': '自定义字段',
  'Protect stores the value as KeePass does with "Protect value in process memory".': '「保护」与 KeePass 的「在进程内存中保护该值」是同一种存储方式。',
  'Loading custom fields...': '正在加载自定义字段...',
  'Failed to load custom fields.': '自定义字段加载失败',
  'No custom fields yet.': '暂无自定义字段',
  'Field name': '字段名称',
  'Field value': '字段值',
  'Protect': '保护',
  'Remove field': '移除字段',
  'Add field': '添加字段',
  'Field name cannot be empty.': '字段名称不能为空',
  '"{0}" is a built-in field.': '"{0}" 是内置字段',
  '"{0}" is used by Keepass Cat internally.': '"{0}" 由 Keepass Cat 内部使用',
  '"{0}" is listed more than once.': '"{0}" 重复出现',
  'Saved. {0} custom field(s) were skipped due to errors.': '已保存，但有 {0} 个自定义字段因错误被跳过。',

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
  'KeePass is the oldest and most trusted open-source password manager: over twenty years of development, with your passwords kept in an encrypted file (.kdbx) that you own rather than on a company\'s server.': 'KeePass 是世界上历史最悠久、也最受信任的开源密码管理器：二十多年来持续开发，你的密码保存在一个由你自己保管的加密文件（.kdbx）里，而不是放在某家公司的服务器上。',
  'Keepass Cat brings that file into the browser: it reads the .kdbx you already have and fills in your logins as you browse. The file stays with you - we upload nothing, and there is no account to create.': 'Keepass Cat 把这个文件带进浏览器：它读取你已有的 .kdbx，在浏览网页时自动填入账号和密码。文件始终留在你手里——我们不上传任何内容，也不需要注册账号。',
  'Never used KeePass? Create a local password database and you can try it out in a minute.': '如果你还没用过 KeePass，可以新建一个本地密码库，一分钟就能上手体验。',
  'Sorry - Firefox cannot read or write local files yet, so a local password database can only be created in Chrome. The good news: Firefox supports WebDAV storage in full - keep the database on your cloud drive and syncing plus autofill work just the same. A different road, same view - please give it a try.': '非常遗憾，受浏览器技术限制，Firefox 暂时无法读写本地文件，本地密码库只能在 Chrome 里新建。但好消息是——Firefox 对 WebDAV 网络存储的支持完整无缺！把密码库放进云盘，多设备同步、自动填充一样顺滑。换个路口走，风景一样好，欢迎体验。',
  'New local database': '新建本地数据库',
  'Already using KeePass with a .kdbx of your own? Add it with the button below. Keep it on this machine, or on a WebDAV server so several devices share one database - once it is added, autofill works here in the browser.': '如果你已经在用 KeePass，手里也有自己的 .kdbx 文件，用下面的按钮把它添加进来：可以放在本机，也可以放在 WebDAV 云盘上，让几台设备共用同一份密码库。添加之后，浏览器里的自动填充就可以用了。',
  'Already using KeePass with a .kdbx of your own? Add it with the button below, on a WebDAV server so several devices share one database - once it is added, autofill works here in the browser.': '如果你已经在用 KeePass，手里也有自己的 .kdbx 文件，用下面的按钮把它添加进来：连接 WebDAV 云盘，让几台设备共用同一份密码库。添加之后，浏览器里的自动填充就可以用了。',
  'Keepass Cat runs entirely on your machine: there is no server and no account. The database is only read into memory while it is unlocked, the master password is not remembered by default, and a copied password is cleared from the clipboard when its timer runs out.': 'Keepass Cat 完全在你的设备上运行：没有服务器，也没有账号。密码库只会在解锁期间读进内存，主密码默认不会被记住；复制出来的密码也会在设定的时间后从剪贴板自动清除。',
  'Support Keepass Cat': '支持 Keepass Cat',

  // ===== Options: Manage Keyfiles =====

  // ===== Options: Advanced Settings =====
  'Clipboard Expiration Time': '剪贴板过期时间',
  'When you copy a password, Keepass Cat clears the clipboard again after the timeout you choose.': '复制密码后，Keepass Cat 会在你设定的时间后自动清空剪贴板。',
  '1 minute': '1 分钟',
  '15 seconds': '15 秒',
  '3 minutes': '3 分钟',
  '5 minutes': '5 分钟',
  '30 seconds': '30 秒',
  '{0} seconds': '{0} 秒',
  'Notification': '通知',
  'Choose which type of notification do you want to receive from Keepass Cat.': '选择你希望从 Keepass Cat 收到的通知类型。',
  'Password expiration': '密码过期通知',
  'Clipboard events': '剪贴板事件通知',

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
  'Local file': '本地文件',
  'Open .kdbx files on this computer. Keepass Cat reads and writes each file in place, so changes made by other KeePass apps are detected before saving. Requires Chrome (File System Access API) and permission to access the files.': '打开此电脑上的 .kdbx 文件。Keepass Cat 会直接读写每个文件，并在保存前检测其他 KeePass 应用所做的修改。需要 Chrome（File System Access API）以及访问这些文件的权限。',
  'KeePass database': 'KeePass 数据库',

  // ===== Provider: Local file =====
  'Import database files': '导入数据库文件',
  'No local files added yet.': '尚未添加本地文件。',
  'File permission was denied. Choose the file again to grant access.': '文件权限已被拒绝。请重新选择文件以授予访问权限。',
  'Local file access is not supported in this browser. Use Chrome or another browser with the File System Access API.': '当前浏览器不支持本地文件访问。请使用 Chrome 或其他支持 File System Access API 的浏览器。',
  'This browser cannot request file permissions. Use Chrome or another browser with the File System Access API.': '当前浏览器无法请求文件权限。请使用 Chrome 或其他支持 File System Access API 的浏览器。',
  'No local file selected. Choose a .kdbx file first.': '尚未选择本地文件。请先选择一个 .kdbx 文件。',
  'Permission to read the local file was not granted. Re-authorise the file to continue.': '未获得本地文件的读取权限。请重新授权该文件后继续。',
  'Permission to write the local file was not granted. Re-authorise the file to continue.': '未获得本地文件的写入权限。请重新授权该文件后继续。',
  'Sync now': '立即同步',
  'No changes': '没有更新',
  'Synced {0} entries': '已同步 {0} 条更新',
  'Sync failed. Try again.': '同步失败，请重试。',
  'Local file writes are handled by the browser page, not the background service worker.': '本地文件写入由浏览器页面处理，而不是后台服务进程。',
  'The file was modified outside Keepass Cat since it was opened. Save cancelled; reopen the database and try again.': '该文件在打开后已被 Keepass Cat 之外的程序修改，保存已取消；请重新打开数据库后再试。',
  'Local file provider is unavailable.': '本地文件提供程序不可用。',
  'IndexedDB is not available in this browser.': '当前浏览器不支持 IndexedDB。',
  'Failed to open the file handle database.': '无法打开文件句柄数据库。',
  'The file handle database is blocked by another tab.': '文件句柄数据库被其他标签页阻止。',
  'Failed to read the stored file handle.': '无法读取已保存的文件句柄。',
  'The file handle transaction failed.': '文件句柄事务失败。',
  'The file handle transaction was aborted.': '文件句柄事务已中止。',

  // ===== Error Messages (services) =====
  'Failed to read file header': '文件头读取失败',
  'Unsupported Database Version': '不支持的数据库版本',
  'Session expired. Please re-unlock the database.': '会话已过期，请重新解锁数据库。',
  'Entry not found in database': '数据库中未找到该条目',
  'Group not found': '未找到该分组',
  'Database no longer exists': '数据库已不存在',
  'Current database is not WebDAV': '当前数据库不是 WebDAV 类型',
  'Server not found': '未找到服务器',
  'Unable to determine tab details': '无法获取标签页详情',

  // ===== Notifications =====
  'Clipboard cleared': '剪贴板已清除',
  'Remember password expired': '记住密码已过期',
  ' copied to clipboard. Clipboard will clear in {0}.': '已复制到剪贴板，将在 {0} 后清除。',
  ' copied to clipboard.': '已复制到剪贴板。',
  'Enable clipboard expiration clearing': '启用过期清空剪贴板',
  'Expiration time': '过期时间',

  // ===== Providers: WebDAV extras =====
  'URL points to a file, not a folder. Please enter the parent folder path instead.': 'URL 指向的是文件而非文件夹，请输入父文件夹路径',

  // ===== Misc link & segment texts =====
  'optional authentication method': '可选认证方式',
  'KeePass site': 'KeePass 网站',
  'stored unencrypted': '以未加密形式存储',

  // ===== Autofill Shortcut =====
  'In-page fill icon': '网页内填充图标',
  'Show the fill icon on login fields': '在登录输入框显示填充图标',
  'Adds a small key button to the username field of login forms, so an entry can be filled without opening the extension.': '在登录表单的用户名输入框右侧显示一个小钥匙按钮，不用打开扩展就能直接填充条目。',
  'Auto-fill on page load': '页面加载自动填充',
  'Fill when exactly one entry matches': '只有一个匹配条目时自动填充',
  'A login page is filled as soon as it finishes loading, but only when one entry matches and the fields are still empty. Pages that match several entries are left alone.': '登录页加载完成后会自动填好，但只在仅有一个匹配条目、且输入框还是空的时候执行；匹配到多个条目的页面不会自动填充。',
  'Entry matching': '条目匹配',
  'Ignore expired entries': '忽略已过期条目',
  'Expired entries are never matched to a page and are never autofilled. They stay in the database, struck through and marked as expired, and remain editable.': '已过期的条目不会参与网页匹配，也不会被自动填充。它们仍保留在数据库中（带删除线和「已过期」标记），可以正常编辑。',
  'Expired': '已过期',
  'Expiry time': '过期时间',
  'Never expires': '永不过期',
  'Expire now': '即刻过期',
  '1 week': '1 周',
  '2 weeks': '2 周',
  '1 month': '1 个月',
  '3 months': '3 个月',
  '6 months': '6 个月',
  '1 year': '1 年',
  'Custom': '自定义',
  'Choose an expiry date, or switch expiry off.': '请选择过期时间，或关闭过期开关。',
  'Autofill Shortcut': '自动填充快捷键',
  'Default shortcut:': '默认快捷键：',
  'Fill OTP at cursor': '在光标处填充 OTP',
  'Copy OTP on autofill': '填充时自动复制 OTP',
  'Open Chrome shortcut settings': '打开 Chrome 快捷键设置',
  'Customize shortcuts in Firefox: toolbar menu (top-right) → Add-ons and themes → gear icon (top-right) → Manage Extension Shortcuts.': '在 Firefox 中自定义快捷键：右上角工具栏菜单 → 扩展和主题 → 右上角齿轮图标 → 管理扩展快捷键。',

  // ===== OTP Automation =====
  'OTP Automation': 'OTP 自动化',
  'Choose how Keepass Cat automates one-time passwords (OTP).': '设置 Keepass Cat 自动处理一次性密码（OTP）的方式。',
  'Copies the code and also fills it into the focused input field on the current page when you click the OTP button.': '点击 OTP 按钮时，会复制验证码并自动填充到当前页面光标所在的输入框。',
  'Copies the code to the clipboard whenever you autofill an entry that has an OTP.': '触发自动填充含 OTP 的密码条目时，会自动将 OTP 验证码复制到剪贴板。',


  // ===== Manage Keyfiles paragraph fragments =====
  'Key files are an ': '密钥文件是一种 ',
  '. More info on key files is available on the ': '。更多信息请参考 ',
  'Keepass Cat can store your key files locally in your browser\'s storage, and apply them when opening your password database. Websites and other browser extensions do not have access to these files. However, they are ': 'Keepass Cat 可以将密钥文件存储在浏览器本地，在打开数据库时使用。网站和其他扩展无法访问这些文件，但它们会 ',
  ' in your local browser profile and someone with access to your device could read them.': ' 在你的浏览器本地配置文件中，有设备访问权限的人可以读取。',

  // ===== Support =====
  'If the Keepass Cat project helps you, please consider leaving a review on the ': '如果 Keepass Cat 项目帮助到你，请考虑在 ',
  'Chrome Web Store': 'Chrome 应用商店',
  ' or the ': ' 或 ',
  'Firefox add-on store': 'Firefox 附加组件商店',
  ', or clicking a Star on my ': ' 留下一个评价，或者在我的 ',
  'GitHub repo': 'GitHub 仓库',
  '. If you run into any problem, please open an ': ' 点击一个 Star。如果你遇到任何问题，请提 ',
  'issue': 'issue',
  ' so we can improve Keepass Cat.': '，以便我们改进 Keepass Cat。',

  // ===== OTP =====
  'OTP': 'OTP',
  'Add OTP': '添加 OTP',
  'Remove OTP': '移除 OTP',
  'Scan the page for a QR code': '扫描当前页面的二维码',
  'No QR code found on the page. Scroll the QR code into view and try again.': '未在当前页面找到二维码。请把二维码滚动到可见区域后重试。',
  'The QR code on the page is not an otpauth:// link.': '页面上的二维码不是 otpauth:// 链接。',
  'The QR code contains an invalid otpauth:// link.': '二维码中的 otpauth:// 链接无效。',
  'Could not capture this page for scanning.': '无法截取当前页面进行扫描。',
  'OTP will be removed when you save.': '保存后将移除 OTP。',
  'Invalid otpauth URL': '无效的 otpauth URL',
  'Copy OTP code': '复制OTP验证码',
};

export default zhCN;
