#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { importImageAsset } from './lib/generated-assets.mjs';

async function main(args) {
    if (args.includes('--help')) {
        console.log('node tools/import-image-asset.mjs --source <image.png> --name <slug> [--kind sprite|background] [--prompt-file <prompt.txt>]');
        return;
    }
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
        if (!['--source', '--name', '--kind', '--prompt-file'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) {
            throw new Error('Invalid option; use --help');
        }
        options[args[i].slice(2)] = args[i + 1];
    }
    if (!options.source || !options.name) throw new Error('--source and --name are required');
    const prompt = options['prompt-file'] ? fs.readFileSync(options['prompt-file'], 'utf8') : '';
    console.log(JSON.stringify(await importImageAsset({ ...options, prompt }), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
