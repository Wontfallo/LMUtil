
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const testStream = () => {
    console.log('Spawning edge-tts...');
    const child = spawn('edge-tts', [
        '--text', '"This is a test of streaming audio."',
        '--voice', 'en-US-AriaNeural'
        // No --write-media means stdout
    ], { shell: true });

    const writeStream = fs.createWriteStream(path.join(__dirname, 'stream_test.mp3'));

    let chunks = 0;
    let bytes = 0;

    child.stdout.on('data', (chunk) => {
        chunks++;
        bytes += chunk.length;
        writeStream.write(chunk);
        console.log(`Received chunk: ${chunk.length} bytes`);
    });

    child.stderr.on('data', (data) => {
        console.log('STDERR:', data.toString());
    });

    child.on('close', (code) => {
        console.log(`Child exited with code ${code}. Total bytes: ${bytes}, Chunks: ${chunks}`);
        writeStream.end();
    });
};

testStream();
