import path from 'node:path';
import { execFileSync } from 'node:child_process';

// cwd is passed directly to the process API. Neither tar argument contains a
// Windows drive prefix, even when Git Bash puts GNU tar ahead of BSD tar.
export function extractTar(archive, destination) {
    const cwd = path.dirname(path.resolve(archive));
    const target = path.relative(cwd, path.resolve(destination)) || '.';
    if (path.isAbsolute(target)) throw new Error('Archive and destination must be on the same drive');
    execFileSync('tar', ['-xzf', path.basename(archive), '-C', target],
        { cwd, stdio: ['ignore', 'ignore', 'inherit'] });
}
