// Quick test to verify edge-tts-universal is working
import { EdgeTTS, listVoices } from 'edge-tts-universal';

async function testTTS() {
    console.log('Testing edge-tts-universal...');

    try {
        // Test listing voices first
        console.log('1. Listing voices...');
        const voices = await listVoices();
        console.log(`   Got ${voices.length} voices`);

        // Test synthesis
        console.log('2. Testing synthesis...');
        const tts = new EdgeTTS('Hello, this is a test.', 'en-US-AndrewNeural', {
            rate: '+0%',
            pitch: '+0Hz'
        });

        console.log('   Calling synthesize()...');
        const result = await tts.synthesize();
        console.log('   Synthesize returned!');

        console.log('   Getting arrayBuffer...');
        const arrayBuffer = await result.audio.arrayBuffer();
        console.log(`   Got audio: ${arrayBuffer.byteLength} bytes`);

        console.log('✅ TTS test PASSED!');
    } catch (error) {
        console.error('❌ TTS test FAILED:', error);
    }
}

testTTS();
