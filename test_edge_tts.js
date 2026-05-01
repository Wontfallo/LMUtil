
const { tts } = require('edge-tts');
const fs = require('fs');
const path = require('path');

async function testEdgeTTS() {
    console.log('Testing edge-tts package...');
    try {
        const text = "Hello, this is a test using the edge-tts package.";

        console.log('Synthesizing...');
        const buffer = await tts(text, {
            voice: 'en-US-AriaNeural',
            rate: '+0%',
            pitch: '+0Hz'
        });

        console.log('Synthesis complete.');

        if (buffer) {
            console.log('Buffer received, length:', buffer.length);
            const outFile = path.join(__dirname, 'test_edge_tts.mp3');
            fs.writeFileSync(outFile, buffer);
            console.log('Saved to:', outFile);
        } else {
            console.error('No buffer returned');
        }

    } catch (e) {
        console.error('TTS Failed:', e);
    }
}

testEdgeTTS();
