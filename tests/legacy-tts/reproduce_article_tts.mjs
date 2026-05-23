
import fs from 'fs';
import { Buffer } from 'buffer';
// Try importing directly as default or named
import * as EdgeTTSMod from 'edge-tts';

async function main() {
    try {
        console.log("Importing edge-tts...");
        console.log("Module:", EdgeTTSMod);

        // Check how to instantiate. The article said: 
        // const EdgeTTS = await import('edge-tts')
        // const tts = new EdgeTTS.default()

        // In ESM:
        // EdgeTTSMod.default might be the class if it's a default export
        const TTSClass = EdgeTTSMod.default || EdgeTTSMod.EdgeTTS || EdgeTTSMod;

        try {

            // Check if it's a class
            if (typeof TTSClass !== 'function') {
                throw new Error("TTSClass is not a constructor: " + typeof TTSClass);
            }

            const tts = new TTSClass();

            const text = "Hello, this is a test of the pure JavaScript implementation from the article.";
            const voice = "en-US-AriaNeural";

            console.log("Setting metadata...");
            // Check constants
            const OUTPUT_FORMAT = EdgeTTSMod.OUTPUT_FORMAT || TTSClass.OUTPUT_FORMAT;
            if (!OUTPUT_FORMAT) {
                console.log("Warning: OUTPUT_FORMAT not found in export. Using raw string?");
                // Looking for AUDIO_24KHZ_48KBITRATE_MONO_MP3
            }

            // If we can't find enum, we might need to look at the package structure
            await tts.setMetadata(voice, OUTPUT_FORMAT ? OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3 : 'audio-24khz-48kbitrate-mono-mp3');

            console.log("Generating speech...");
            const stream = tts.generateSpeech(text);

            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }

            console.log(`Received ${chunks.length} chunks.`);

            const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const result = Buffer.concat(chunks, totalLength);

            fs.writeFileSync('output_js.mp3', result);
            console.log("Success! Saved to output_js.mp3");

        } catch (e) {
            console.error("Instantiation error:", e);
        }

    } catch (error) {
        console.error("Error reproduction failed:", error);
    }
}

main();
