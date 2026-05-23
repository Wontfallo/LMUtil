
const { spawn } = require('child_process');

console.time('FullDuration');
console.time('FirstByte');

const child = spawn('edge-tts', [
    '--text', '"Testing latency"',
    '--voice', 'en-US-AriaNeural'
], { shell: true });

let receivedFirst = false;

child.stdout.on('data', (d) => {
    if (!receivedFirst) {
        console.timeEnd('FirstByte');
        receivedFirst = true;
    }
});

child.on('close', (code) => {
    console.timeEnd('FullDuration');
    console.log('Done');
});
