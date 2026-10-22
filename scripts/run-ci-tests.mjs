import { stripVTControlCharacters } from 'node:util';
import { spawn } from 'node:child_process';

// Publish bounded failure details as a check annotation as well as the full job log.
const child = spawn('npm test', { shell: true, stdio: ['inherit', 'pipe', 'pipe'],
    env: { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, '--test-reporter=tap'].filter(Boolean).join(' ') },
});
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
        console.log(`::error title=Backend regression failure::${message}`);
    }
    process.exitCode = code ?? 1;
});
