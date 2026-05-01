// Test the streaming API approach instead of synthesize()
import { Communicate } from 'edge-tts-universal';

async function testStreaming() {
    console.log('Testing edge-tts-universal streaming API...');

    try {
        const communicate = new Communicate('Hello, this is a test.', {
            voice: 'en-US-AndrewNeural',
            rate: '+0%',
            pitch: '+0Hz'
        });

        console.log('Starting stream...');
        const buffers = [];

        for await (const chunk of communicate.stream()) {
            if (chunk.type === 'audio' && chunk.data) {
                buffers.push(chunk.data);
                console.log(`Got audio chunk: ${chunk.data.length} bytes`);
            }
        }

        console.log(`Total chunks: ${buffers.length}`);
        const totalSize = buffers.reduce((acc, b) => acc + b.length, 0);
        console.log(`Total audio size: ${totalSize} bytes`);

        if (totalSize > 0) {
            console.log('✅ Streaming API test PASSED!');
        } else {
            console.log('❌ No audio received');
        }
    } catch (error) {
        console.error('❌ Streaming test FAILED:', error);
    }
}

testStreaming();
