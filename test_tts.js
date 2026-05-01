
const { EdgeTTS } = require('edge-tts-universal');
const fs = require('fs');
const path = require('path');

async function testTTS() {
    console.log('Testing TTS...');
    try {
        const text = "Hello, this is a test of the text to speech settings.";
        const tts = new EdgeTTS(text, "en-US-AriaNeural", {
            rate: '+0%',
            pitch: '+0Hz'
        });

        console.log('Synthesizing...');
        const result = await tts.synthesize();
        console.log('Synthesis complete.');

        if (result && result.audio) {
            console.log('Audio buffer received, length:', result.audio.byteLength);
            // Save to file to verify
            const buffer = Buffer.from(await result.audio.arrayBuffer());
            const outFile = path.join(__dirname, 'test_tts_output.mp3');
            fs.writeFileSync(outFile, buffer);
            console.log('Saved to:', outFile);
        } else {
            console.error('No audio in result');
        }

    } catch (e) {
        console.error('TTS Failed:', e);
    }
}

testTTS();
