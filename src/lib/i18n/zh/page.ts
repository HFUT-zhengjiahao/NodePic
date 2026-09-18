/** Translations for src/app/page.tsx. Keys are the English source strings used in that file. */
export const page: Record<string, string> = {
    'This entry still feeds {count} canvas node(s). Deleting it leaves those nodes without their source image.':
        '这条记录仍被画布上的 {count} 个节点引用，删除后这些节点会失去源图。',
    'Are you sure you want to clear the entire image history? Image files that no canvas node uses will be deleted from disk too. This cannot be undone.':
        '确定清空全部历史记录吗？画布没有引用的图片文件会一并从磁盘删除，且无法撤销。',
    'Are you sure you want to clear the entire image history? In IndexedDB mode, this will also permanently delete all stored images. This cannot be undone.':
        '确定清空全部历史记录吗？IndexedDB 模式下会同时永久删除所有已存图片，且无法撤销。',
    'Cannot paste: Maximum of {count} images reached.': '无法粘贴：最多只能添加 {count} 张图片。',
    'Password Required': '需要密码',
    'Configure Password': '设置密码',
    'The server requires a password, or the previous one was incorrect. Please enter it to continue.': '服务器需要密码，或之前输入的密码不正确。请输入密码后继续。',
    'Set a password to use for API requests.': '设置用于 API 请求的密码。',
    'Error': '错误',
};
