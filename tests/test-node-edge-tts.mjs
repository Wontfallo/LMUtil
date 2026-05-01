// Test node-edge-tts package
import { EdgeTTS } from 'node-edge-tts';

async function testNodeEdgeTTS() {
    console.log('Testing node-edge-tts package...');

    const timeout = setTimeout(() => {
        console.log('❌ Timeout after 15 seconds');
        process.exit(1);
    }, 15000);

    try {
        const tts = new EdgeTTS();

        console.log('Calling synthesize...');
        const result = await tts.synthesize('Hello, this is a test.', 'en-US-AndrewNeural');

        clearTimeout(timeout);
        console.log('Got result!');
        console.log('Audio size:', result.audio?.length || 'unknown');

        if (result.audio && result.audio.length > 0) {
            console.log('✅ node-edge-tts test PASSED!');
        } else {
            console.log('❌ No audio data');
        }
    } catch (error) {
        clearTimeout(timeout);
        console.error('❌ Test FAILED:', error);
    }
}

testNodeEdgeTTS();
