#!/usr/bin/env node
// Verify cross-references in markdown files don't point at missing targets.
//
// Scans every `*.md` under the repo (excluding node_modules) and checks each
// `[text](url#anchor)` link:
//   1. external URLs (http/https/mailto) → skipped
//   2. relative paths → target file must exist
//   3. anchor → target file must contain a matching heading
//
// Anchor matching is forgiving (alnum-only normalization) so subtle hyphen-
// position differences from GitHub's slug algorithm don't false-flag.
//
// Exit code: 0 clean, 1 if any broken links.
//
// Usage:
//   node tools/check-knowledge-links.mjs           # full repo scan
//   node tools/check-knowledge-links.mjs --quiet   # only print failures + summary

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const QUIET     = process.argv.includes('--quiet');

// ── Discover markdown files ──────────────────────────────────────

function walk(dir, out = []) {
    for (const name of fs.readdirSync(dir)) {
        if (name === 'node_modules' || name === '.git' || name.startsWith('.setup-cache')
            || name === 'public' || name === 'vendor-install' || name === 'test-results'
            || name === 'temp') continue;
        const full = path.join(dir, name);
        const st = fs.statSync(full);
        if (st.isDirectory()) walk(full, out);
        else if (name.endsWith('.md')) out.push(full);
    }
    return out;
}

// ── Heading + link extraction ────────────────────────────────────

function readLines(filePath) {
    return fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
}

function extractHeadings(filePath) {
    const headings = [];
    let inFence = false;
    for (const line of readLines(filePath)) {
        // Skip code fences — `# something` inside ```...``` is not a heading.
        if (/^```/.test(line)) { inFence = !inFence; continue; }
        if (inFence) continue;
        const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
        if (m) headings.push(m[2]);
    }
    return headings;
}

// `[text](url)` matcher — excludes `![text](url)` (images, less interesting),
// and `[text]: url` (reference defs).
const LINK_RE = /(?<!!)\[([^\]\n]*?)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

// Strip inline code spans (`...`) from a line before link extraction so
// example link syntax inside a code span isn't checked as a real link.
function stripInlineCode(line) {
    return line.replace(/`[^`]*`/g, '');
}

// Authors can mark a region as link-check-exempt (typically: historical CHANGELOG
// entries with intentionally-stale references explained by an in-document note):
//   <!-- link-check: skip-rest-of-file -->
// Effective from the marker line until end of file. No re-enable marker — the
// rest of the file is skipped wholesale.
const SKIP_REST_MARKER = /<!--\s*link-check:\s*skip-rest-of-file\s*-->/;

function extractLinks(filePath) {
    const lines = readLines(filePath);
    const links = [];
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (SKIP_REST_MARKER.test(line)) break;
        if (/^```/.test(line)) { inFence = !inFence; continue; }
        if (inFence) continue;
        const stripped = stripInlineCode(line);
        let m;
        LINK_RE.lastIndex = 0;
        while ((m = LINK_RE.exec(stripped)) !== null) {
            links.push({ file: filePath, line: i + 1, text: m[1], url: m[2] });
        }
    }
    return links;
}

// ── Anchor matching ──────────────────────────────────────────────

// Strip everything except Unicode letters/digits → resilient to hyphen-position
// differences from GitHub's slug rules. Two strings that produce the same
// normalized form are considered equal-anchor for our purposes.
function normalize(s) {
    return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function anchorMatches(headings, anchor) {
    const target = normalize(anchor);
    if (!target) return true;  // empty anchor — file-only link
    return headings.some(h => normalize(h) === target);
}

// ── Resolve link target ──────────────────────────────────────────

function checkLink(link, headingsByFile) {
    const u = link.url;
    // External — skip
    if (/^(https?:|mailto:|ftp:|tel:)/i.test(u)) return null;
    // Reference styles we don't handle
    if (u.startsWith('javascript:')) return null;

    // Anchor-only link (#xxx) — same file
    if (u.startsWith('#')) {
        const headings = headingsByFile[link.file] || [];
        return anchorMatches(headings, u.slice(1))
            ? null
            : { ...link, reason: `anchor "#${u.slice(1)}" not found in same file` };
    }

    // path[#anchor]
    const [filePart, anchorPart] = u.split('#');
    if (!filePart) return null;  // shouldn't happen after the # check above

    const targetAbs = path.resolve(path.dirname(link.file), filePart);
    if (!fs.existsSync(targetAbs)) {
        return { ...link, reason: `target file not found: ${path.relative(ROOT, targetAbs)}` };
    }
    if (!anchorPart) return null;
    // Markdown anchor — only check for .md targets
    if (!targetAbs.endsWith('.md')) return null;

    if (!headingsByFile[targetAbs]) headingsByFile[targetAbs] = extractHeadings(targetAbs);
    return anchorMatches(headingsByFile[targetAbs], anchorPart)
        ? null
        : { ...link, reason: `anchor "#${anchorPart}" not found in ${path.relative(ROOT, targetAbs)}` };
}

// ── Main ─────────────────────────────────────────────────────────

const files = walk(ROOT).sort();
if (!QUIET) console.log(`[links] scanning ${files.length} markdown files...`);

const headingsByFile = {};
const allLinks = [];
for (const f of files) {
    headingsByFile[f] = extractHeadings(f);
    allLinks.push(...extractLinks(f));
}

const broken = [];
for (const link of allLinks) {
    const issue = checkLink(link, headingsByFile);
    if (issue) broken.push(issue);
}

if (!QUIET) {
    console.log(`[links] ${allLinks.length} link${allLinks.length === 1 ? '' : 's'} checked, ${broken.length} broken\n`);
}

if (broken.length > 0) {
    // Group by source file for readability
    const byFile = new Map();
    for (const b of broken) {
        const k = path.relative(ROOT, b.file);
        if (!byFile.has(k)) byFile.set(k, []);
        byFile.get(k).push(b);
    }
    for (const [file, issues] of byFile) {
        console.log(`✗ ${file}`);
        for (const b of issues) {
            console.log(`    line ${b.line}: [${b.text}](${b.url})`);
            console.log(`        ${b.reason}`);
        }
    }
    console.log(`\n[links] ${broken.length} broken link${broken.length === 1 ? '' : 's'} — fix or update referrers`);
} else {
    console.log('[links] all good ✓');
}

process.exit(broken.length > 0 ? 1 : 0);
