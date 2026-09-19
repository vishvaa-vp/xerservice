import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const files = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter(Boolean);

const forbiddenPaths = [
    /(^|\/)\.env(?:\.|$)/,
    /(^|\/)node_modules\//,
    /(^|\/)\.next\//,
    /(^|\/)target\//,
    /(^|\/)reports\//,
    /(^|\/)\.gemini-screenshots\//,
];

const secretPatterns = [
    ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/],
    ['GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{40,}\b/],
    ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
    ['Supabase secret key', /\bsb_secret_[A-Za-z0-9_-]{20,}\b/],
    ['embedded Supabase publishable key', /\bsb_publishable_[A-Za-z0-9_-]{20,}\b/],
    ['Stripe secret key', /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/],
];

const failures = [];
for (const file of files) {
    if (file === '.env.example') continue;
    if (forbiddenPaths.some(pattern => pattern.test(file))) {
        failures.push(`forbidden generated or secret path: ${file}`);
        continue;
    }

    const absolute = path.join(root, file);
    let stat;
    try {
        stat = statSync(absolute);
    } catch {
        continue;
    }
    if (!stat.isFile()) continue;
    if (stat.size > 20 * 1024 * 1024) {
        failures.push(`file exceeds 20 MB: ${file}`);
        continue;
    }
    if (stat.size > 2 * 1024 * 1024 || /\.(?:png|jpe?g|gif|ico|woff2?|pdf|zip)$/i.test(file)) continue;

    const contents = readFileSync(absolute, 'utf8');
    for (const [label, pattern] of secretPatterns) {
        if (pattern.test(contents)) failures.push(`${label}: ${file}`);
    }
}

if (failures.length) {
    console.error('Publication audit failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
}

console.log(`Publication audit passed for ${files.length} repository files.`);
