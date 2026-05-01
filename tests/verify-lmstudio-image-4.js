
const { LMStudioClient } = require("@lmstudio/sdk");

async function testImageHandling() {
    console.log("--- Starting Image Handling Verification (Round 4) ---");

    const client = new LMStudioClient({ baseUrl: 'ws://127.0.0.1:1234' });
    const validBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    console.log("\n[Test 7] Testing with (name, base64) signature...");
    try {
        const prepared = await client.files.prepareImageBase64("test.png", validBase64);
        console.log("✅ Success: Image prepared. Identifier:", prepared.identifier);
    } catch (e) {
        console.log("❌ Failed:", e.message);
        if (e.issues) console.log(JSON.stringify(e.issues, null, 2));
    }

    console.log("\n--- Verification Complete ---");
}

testImageHandling().catch(console.error);
