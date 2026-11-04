#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import dotenv from 'dotenv';

const root = resolve(new URL('..', import.meta.url).pathname);
const outputPath = resolve(root, process.env.OUTPUT_PATH ?? 'tmp/random-image.jpg');

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${url} returned HTTP ${response.status}`);
  }

  return response;
}

const loadedEnv = dotenv.config({ path: resolve(root, '.env'), quiet: true });
const env = loadedEnv.parsed ?? {};
const serverUrl = (process.env.IMMICH_SERVER_URL ?? env.IMMICH_SERVER_URL ?? '').replace(/\/+$/, '');
const apiKey = process.env.IMMICH_API_KEY ?? env.IMMICH_API_KEY;

if (!serverUrl || !apiKey) {
  throw new Error('IMMICH_SERVER_URL and IMMICH_API_KEY must be set in .env');
}

const headers = { 'x-api-key': apiKey };
const searchResponse = await request(`${serverUrl}/api/search/metadata`, {
  method: 'POST',
  headers: { ...headers, 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'IMAGE', page: 1, size: 100 }),
});
const search = await searchResponse.json();
const assets = search.assets?.items ?? [];

if (assets.length === 0) {
  throw new Error('Immich returned no image assets');
}

const asset = assets[Math.floor(Math.random() * assets.length)];
const thumbnailUrl = `${serverUrl}/api/assets/${asset.id}/thumbnail?size=preview&format=jpg`;
const thumbnailResponse = await request(thumbnailUrl, { headers });
const image = Buffer.from(await thumbnailResponse.arrayBuffer());

await mkdir(resolve(outputPath, '..'), { recursive: true });
await writeFile(outputPath, image);

console.log(`Selected: ${asset.originalFileName ?? asset.id}`);
console.log(`Asset ID: ${asset.id}`);
console.log(`Dimensions: ${asset.width ?? '?'}x${asset.height ?? '?'}`);
console.log(`Downloaded: ${image.length} bytes`);
console.log(`Output: ${outputPath}`);
