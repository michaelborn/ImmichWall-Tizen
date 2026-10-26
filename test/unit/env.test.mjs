import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadConfig, parseEnv } from '../../scripts/server.mjs';

test('parseEnv reads plain and quoted values and ignores blank/comment lines', () => {
    const result = parseEnv([
        '# local Immich settings',
        'IMMICH_SERVER_URL=https://photos.example.test/',
        'IMMICH_API_KEY="quoted-test-key"',
        '',
        ' invalid line ',
    ].join('\n'));

    assert.deepEqual(result, {
        IMMICH_SERVER_URL: 'https://photos.example.test/',
        IMMICH_API_KEY: 'quoted-test-key',
    });
});

test('loadConfig trims trailing slashes and environment overrides .env', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'immich-wall-env-'));
    const envFilePath = join(directory, '.env');
    try {
        await writeFile(envFilePath, [
            'IMMICH_SERVER_URL=https://from-file.example.test///',
            'IMMICH_API_KEY=file-key',
        ].join('\n'));

        const config = await loadConfig({
            envFilePath,
            environment: { IMMICH_API_KEY: 'environment-key' },
        });
        assert.deepEqual(config, {
            immichBaseUrl: 'https://from-file.example.test',
            immichApiKey: 'environment-key',
        });
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('loadConfig returns empty values when no file or variables are present', async () => {
    const config = await loadConfig({
        envFilePath: join(tmpdir(), 'immich-wall-does-not-exist.env'),
        environment: {},
    });
    assert.deepEqual(config, { immichBaseUrl: '', immichApiKey: '' });
});
