
const { LMStudioClient } = require("@lmstudio/sdk");

async function testImageHandling() {
    console.log("--- Starting Image Handling Verification (Round 2) ---");

    const client = new LMStudioClient({ baseUrl: 'ws://127.0.0.1:1234' });
    const validBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    console.log("\n[Test 4] Testing with FULL OBJECT { contentBase64, name, identifier }...");
    try {
        const prepared = await client.files.prepareImageBase64({
            contentBase64: validBase64,
            name: "test.png",
            identifier: "test.png"
        });
        console.log("✅ Success: Image prepared. Identifier:", prepared.identifier);
    } catch (e) {
        console.error("❌ Failed:", e.message);
        console.error(JSON.stringify(e, null, 2));
    }

    console.log("\n--- Verification Complete ---");
}

testImageHandling().catch(console.error);
