#!/usr/bin/env node

import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { DOMParser } from '@xmldom/xmldom';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const javascriptFiles = [
    'scripts/server.mjs',
    'scripts/desktop-server.mjs',
    'scripts/immich-poc.mjs',
    'scripts/check.mjs',
    'desktop/state.js',
    'desktop/app.js',
    'tizen/app.js',
];

for (const file of javascriptFiles) {
    execFileSync(process.execPath, ['--check', resolve(root, file)], { stdio: 'inherit' });
}

const tizenConfig = await readFile(resolve(root, 'tizen/config.xml'), 'utf8');
const xmlErrors = [];
const xml = new DOMParser({
    onError: (level, message) => {
        if (level === 'error' || level === 'fatalError') xmlErrors.push(message);
    },
}).parseFromString(tizenConfig, 'application/xml');
if (xmlErrors.length || xml.documentElement?.localName !== 'widget') {
    throw new Error('tizen/config.xml is not well-formed XML with a widget root: ' + xmlErrors.join('; '));
}

const tizenEntry = tizenConfig.match(/<content\s+src="([^"]+)"/);
if (!tizenEntry) throw new Error('Tizen config.xml is missing its content entry.');
await access(resolve(root, 'tizen', tizenEntry[1]));

for (const directory of ['desktop', 'tizen']) {
    const html = await readFile(resolve(root, directory, 'index.html'), 'utf8');
    const references = [
        ...Array.from(html.matchAll(/<script[^>]+src="([^"]+)"/g), (match) => match[1]),
        ...Array.from(html.matchAll(/<link[^>]+href="([^"]+)"/g), (match) => match[1]),
    ];
    for (const reference of references) await access(resolve(root, directory, reference));
}

console.log('Static checks passed.');
