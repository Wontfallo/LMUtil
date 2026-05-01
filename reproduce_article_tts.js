
const { Readable } = require('stream');
const fs = require('fs');

async function main() {
    try {
        console.log("Importing edge-tts...");
        // Validating if the package 'edge-tts' installed is the one we expect
        const EdgeTTS = require('edge-tts');

        console.log("EdgeTags:", EdgeTTS);

        const tts = new EdgeTTS.default();
        const text = "Hello, this is a test of the pure JavaScript implementation from the article.";
        const voice = "en-US-AriaNeural";

        console.log("Setting metadata...");
        await tts.setMetadata(voice, EdgeTTS.OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

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

    } catch (error) {
        console.error("Error reproduction failed:", error);
    }
}

main();
