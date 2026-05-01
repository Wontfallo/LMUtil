// Test the Universal API 
import { UniversalEdgeTTS } from 'edge-tts-universal';

async function testUniversal() {
    console.log('Testing UniversalEdgeTTS API...');

    // Add a timeout
    const timeout = setTimeout(() => {
        console.log('❌ Timeout after 15 seconds - Microsoft TTS service not responding');
        process.exit(1);
    }, 15000);

    try {
        const tts = new UniversalEdgeTTS('Hello, this is a test.', 'en-US-AndrewNeural', {
            rate: '+0%',
            pitch: '+0Hz'
        });

        console.log('Calling synthesize()...');
        const result = await tts.synthesize();
        clearTimeout(timeout);

        console.log('Got result!');
        const arrayBuffer = await result.audio.arrayBuffer();
        console.log(`Audio size: ${arrayBuffer.byteLength} bytes`);

        if (arrayBuffer.byteLength > 0) {
            console.log('✅ UniversalEdgeTTS test PASSED!');
        } else {
            console.log('❌ No audio received');
        }
    } catch (error) {
        clearTimeout(timeout);
        console.error('❌ Test FAILED:', error.message || error);
    }
}

testUniversal();
