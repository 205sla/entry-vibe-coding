import fs from 'node:fs';
import path from 'node:path';

export function checkBootFiles(root) {
    const html = fs.readFileSync(path.join(root, 'public/editor.html'), 'utf8');
    const resources = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi)]
        .map(match => 'public/' + match[1].split(/[?#]/)[0]);
    const required = [...new Set([...resources, 'public/images/mascot/bot205-idle.svg'])];
    const missing = required.filter(file => {
        try { const stat = fs.statSync(path.join(root, file)); return !stat.isFile() || stat.size === 0; }
        catch { return true; }
    });
    if (missing.length) throw new Error('boot files missing or empty:\n      - ' + missing.join('\n      - '));
    return required;
}
