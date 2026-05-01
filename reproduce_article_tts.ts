
import { tts } from 'edge-tts';
import fs from 'fs';
import { Buffer } from 'buffer';

async function main() {
    try {
        console.log("Importing edge-tts...");
        const text = "Hello! This is a test of the pure Node.js Edge TTS implementation. If you can hear this, the Python dependency is no longer needed.";
        const voice = "en-US-AriaNeural";

        console.log(`Generating speech for: "${text}" with voice: ${voice}`);

        // The package returns a Buffer directly
        const audioBuffer = await tts(text, {
            voice: voice,
            rate: '+0%',
            volume: '+0%',
            pitch: '+0Hz'
        });

        console.log(`Received buffer of length: ${audioBuffer.length}`);

        fs.writeFileSync('output_pure_js.mp3', audioBuffer);
        console.log("Success! Saved to output_pure_js.mp3");

    } catch (error) {
        console.error("Error reproduction failed:", error);
    }
}

main();
