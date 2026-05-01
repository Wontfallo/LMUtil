// Test node-edge-tts with correct API
const { EdgeTTS } = require('node-edge-tts');
const path = require('path');

async function test() {
    console.log('Testing node-edge-tts...');

    const timeout = setTimeout(() => {
        console.log('❌ Timeout after 20 seconds');
        process.exit(1);
    }, 20000);

    try {
        const tts = new EdgeTTS({
            voice: 'en-US-AriaNeural',
            lang: 'en-US',
            outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
            timeout: 15000
        });

        const outputFile = path.join(__dirname, 'test-node-edge.mp3');
        console.log('Calling ttsPromise...');
        await tts.ttsPromise('Hello, this is a test of node edge TTS.', outputFile);

        clearTimeout(timeout);
        console.log('✅ node-edge-tts test PASSED! Audio saved to:', outputFile);
    } catch (error) {
        clearTimeout(timeout);
        console.error('❌ Test FAILED:', error);
    }
}

test();
