
const { EdgeTTS } = require('node-edge-tts');
const fs = require('fs');
const path = require('path');

async function testNodeEdgeTTS() {
    console.log('Testing node-edge-tts package...');
    try {
        const text = "Hello from node edge tts.";
        const audioPath = path.join(__dirname, 'test_node_edge_tts.mp3');

        const tts = new EdgeTTS({
            voice: 'en-US-AriaNeural',
            rate: '+0%',
            pitch: '+0Hz'
        });

        console.log('Synthesizing...');
        await tts.ttsPromise(text, audioPath);
        console.log('Synthesis complete.');

        if (fs.existsSync(audioPath)) {
            console.log('File created:', audioPath);
            const stats = fs.statSync(audioPath);
            console.log('Size:', stats.size);
        } else {
            console.error('File not created');
        }

    } catch (e) {
        console.error('TTS Failed:', e);
    }
}

testNodeEdgeTTS();
