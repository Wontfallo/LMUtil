
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function test() {
    console.log('Testing edge-tts (NPM)...');
    try {
        const edgeTtsPath = path.resolve(__dirname, '../../node_modules/edge-tts/out/index.js');
        if (!fs.existsSync(edgeTtsPath)) {
            console.log('Skipping: edge-tts is not installed in node_modules.');
            return;
        }

        const { tts, getVoices } = await import(edgeTtsPath);
        console.log('Fetching voices...');
        const voices = await getVoices();
        console.log(`Voices found: ${voices.length}`);
        if (voices.length > 0) console.log('First voice:', voices[0]);

        console.log('Generating TTS...');
        const buffer = await tts('Hello world, this is a test of the JS library.', {
            voice: 'en-US-AriaNeural',
            rate: '+0%',
            pitch: '+0Hz'
        });

        console.log(`Generated buffer size: ${buffer.length}`);
        fs.writeFileSync(path.join(__dirname, 'test_js_tts.mp3'), buffer);
        console.log('Written to test_js_tts.mp3');
    } catch (err) {
        console.error('TTS Failed:', err);
    }
}

test();
