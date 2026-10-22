import { stripVTControlCharacters } from 'node:util';
import { spawn } from 'node:child_process';

// Publish bounded failure details as a check annotation as well as the full job log.
const mode = process.argv[2] || 'backend';
const command = new Map([
    ['backend', 'npm test'],
    ['desktop', 'npx playwright test --config=playwright.desktop.config.ts'],
    ['package', 'node scripts/package-desktop.mjs win32'],
]).get(mode);
if (!command) throw new Error('Unknown CI check');
const env = { ...process.env };
if (mode === 'backend') env.NODE_OPTIONS = [env.NODE_OPTIONS, '--test-reporter=tap'].filter(Boolean).join(' ');
const child = spawn(command, { shell: true, stdio: ['inherit', 'pipe', 'pipe'], env });
let tail = '';
function forward(stream, chunk) {
    stream.write(chunk);
    tail = (tail + chunk.toString()).slice(-16000);
}
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', chunk => forward(process.stdout, chunk));
child.stderr.on('data', chunk => forward(process.stderr, chunk));
child.on('error', error => { console.error(error.message); });
child.on('close', code => {
    if (code !== 0 && process.env.GITHUB_ACTIONS === 'true') {
        const message = stripVTControlCharacters(tail).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
        const title = mode === 'backend' ? 'Backend regression failure' : `${mode} check failure`;
        console.log(`::error title=${title}::${message}`);
    }
    process.exitCode = code ?? 1;
});
