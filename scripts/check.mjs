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
    'frontend/state.js',
    'frontend/input.js',
    'frontend/secure-store.js',
    'frontend/pairing.js',
    'frontend/build-version.js',
    'frontend/connection.js',
    'frontend/app.js',
    'pair/app.js',
];

for (const file of javascriptFiles) {
    execFileSync(process.execPath, ['--check', resolve(root, file)], { stdio: 'inherit' });
}

// The TV (Tizen 5.5 JavaScriptCore, Safari ~12-era) cannot parse nullish coalescing,
// optional chaining, or optional catch binding; keep the shared frontend ES2019-safe.
for (const file of javascriptFiles.filter((name) => name.startsWith('frontend/'))) {
    const source = await readFile(resolve(root, file), 'utf8');
    if (/\?\?|\?\.[\w(]|\bcatch\s*\{/.test(source)) {
        throw new Error(`${file} uses syntax the TV WebKit cannot parse (?? / ?. / optional catch binding).`);
    }
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
await access(resolve(root, 'frontend', tizenEntry[1]));
const icon = xml.getElementsByTagName('icon')[0];
if (!icon?.getAttribute('src')) throw new Error('Tizen config.xml is missing its app icon.');
const iconPath = resolve(root, 'tizen', icon.getAttribute('src'));
const png = await readFile(iconPath);
if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || png.readUInt32BE(16) !== 516 || png.readUInt32BE(20) !== 516) {
    throw new Error('Tizen app icon must be a valid 516x516 PNG.');
}

for (const directory of ['frontend', 'pair']) {
    const html = await readFile(resolve(root, directory, 'index.html'), 'utf8');
    const references = [
        ...Array.from(html.matchAll(/<script[^>]+src="([^"]+)"/g), (match) => match[1]),
        ...Array.from(html.matchAll(/<link[^>]+href="([^"]+)"/g), (match) => match[1]),
    ];
    for (const reference of references) await access(resolve(root, directory, reference));
}

// The Tizen package builds frontend/ sources; config.xml's content entry must exist there
// and every file in the Tizen project yaml must resolve inside frontend/.
const yaml = await readFile(resolve(root, 'tizen/tizen_web_project.yaml'), 'utf8');
const filesBlock = yaml.slice(yaml.indexOf('files:'), yaml.indexOf('excludes:'));
const yamlFiles = Array.from(filesBlock.matchAll(/^  - (.+)$/gm), (match) => match[1].trim());
for (const name of yamlFiles) {
    if (name === 'icon.png') continue;
    await access(resolve(root, 'frontend', name));
}

console.log('Static checks passed.');
