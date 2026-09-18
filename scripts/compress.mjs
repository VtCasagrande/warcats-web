import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

async function compress(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await compress(path);
    else if (['.js', '.css', '.html', '.svg', '.json', '.glb'].includes(extname(path))) {
      const data = await readFile(path);
      await writeFile(`${path}.br`, brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }));
      await writeFile(`${path}.gz`, gzipSync(data, { level: 9 }));
    }
  }
}
await compress('dist');
console.log('Brotli and gzip assets ready.');
