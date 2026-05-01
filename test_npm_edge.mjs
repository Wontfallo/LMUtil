
import { tts, getVoices } from './node_modules/edge-tts/out/index.js';
import fs from 'fs';

async function test() {
    console.log('Testing edge-tts (NPM)...');
    try {
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
        fs.writeFileSync('test_js_tts.mp3', buffer);
        console.log('Written to test_js_tts.mp3');
    } catch (err) {
        console.error('TTS Failed:', err);
    }
}

test();
