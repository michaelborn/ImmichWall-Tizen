#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
    throw new Error('Pass the release version as MAJOR.MINOR.PATCH.');
}

const packagePath = resolve(root, 'package.json');
const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
packageJson.version = version;
await writeFile(packagePath, JSON.stringify(packageJson, null, 2) + '\n');

const lockPath = resolve(root, 'package-lock.json');
const lock = JSON.parse(await readFile(lockPath, 'utf8'));
lock.version = version;
if (lock.packages && lock.packages['']) lock.packages[''].version = version;
await writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n');

const widgetPath = resolve(root, 'tizen/config.xml');
const widget = await readFile(widgetPath, 'utf8');
const widgetVersionPattern = /(<widget\b[\s\S]*?\bversion=")[^"]+("[\s\S]*?>)/;
if (!widgetVersionPattern.test(widget)) throw new Error('Could not find the widget version in tizen/config.xml.');
const updatedWidget = widget.replace(/(<widget\b[\s\S]*?\bversion=")[^"]+("[\s\S]*?>)/, `$1${version}$2`);
await writeFile(widgetPath, updatedWidget);

const buildVersionPath = resolve(root, 'frontend/build-version.js');
const buildVersion = await readFile(buildVersionPath, 'utf8');
const buildVersionPattern = /(root\.ImmichWallBuildVersion\s*=\s*)"[^"]*";/;
if (!buildVersionPattern.test(buildVersion)) throw new Error('Could not find the frontend build-version marker.');
const updatedBuildVersion = buildVersion.replace(buildVersionPattern, `$1"v${version}";`);
await writeFile(buildVersionPath, updatedBuildVersion);

const appPath = resolve(root, 'frontend/app.js');
const app = await readFile(appPath, 'utf8');
const appVersionPattern = /(var APP_VERSION = )'[^']*';/;
if (!appVersionPattern.test(app)) throw new Error('Could not find the frontend app-version fallback.');
const updatedApp = app.replace(appVersionPattern, `$1'v${version}';`);
await writeFile(appPath, updatedApp);

console.log(`Updated package, widget, and frontend fallback to v${version}.`);
