/** Translations for the app shell (language switcher) and shared helpers. */
export const common: Record<string, string> = {
    'Language': '语言',
    'Switch language': '切换语言',
    'Width and height must be positive numbers.': '宽度和高度必须是正数。',
    'Width and height must be whole numbers.': '宽度和高度必须是整数。',
    'Both edges must be multiples of {multiple}.': '两边都必须是 {multiple} 的倍数。',
    'Maximum edge is {edge}px.': '最大边长为 {edge}px。',
    'Aspect ratio (long:short) must be ≤ {aspect}:1.': '长宽比（长:短）必须 ≤ {aspect}:1。',
    'Total pixels must be at least {min}.': '总像素数至少为 {min}。',
    'Total pixels must be no more than {max}.': '总像素数不得超过 {max}。',
    'Close': '关闭',
    'Shut Down Service': '关闭服务',
    'Stopping…': '正在关闭…',
    'Server stopped. You can close this page now.': '服务已关闭，现在可以关闭此页面了。',

    // Quality and background values, reached through `t(capitalise(value))` — see check-i18n.mjs's
    // DYNAMIC_KEYS. They were whitelisted as "used" but never actually translated, so a Chinese UI
    // showed "high"/"transparent" verbatim.
    'Auto': '自动',
    'Low': '低',
    'Medium': '中',
    'High': '高',
    'XHigh': '超高',
    'Max': '最高',
    'Opaque': '不透明',
    'Transparent': '透明',
    'Request failed with status {status}': '请求失败（HTTP {status}）',
    'This view failed to render.': '这个视图渲染失败了。',
    'Try again': '重试',
    'Could not stop the server.': '无法停止服务。'
};
