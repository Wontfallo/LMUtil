
const { LMStudioClient } = require("@lmstudio/sdk");

async function testImageHandling() {
    console.log("--- Starting Image Handling Verification (Round 3) ---");

    const client = new LMStudioClient({ baseUrl: 'ws://127.0.0.1:1234' });
    const validBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    console.log("\n[Test 5] Testing with (Identifier, Object) pattern...");
    try {
        // Hypothethical signature: prepareImageBase64(identifier, { contentBase64, name })
        const prepared = await client.files.prepareImageBase64("my-image-id", {
            contentBase64: validBase64,
            name: "test.png"
        });
        console.log("✅ Success: Image prepared. Identifier:", prepared.identifier);
    } catch (e) {
        console.log("❌ Failed:", e.message);
        if (e.issues) console.log(JSON.stringify(e.issues, null, 2));
    }

    console.log("\n[Test 6] Testing with (Name, Object) pattern...");
    try {
        const prepared = await client.files.prepareImageBase64("test.png", {
            contentBase64: validBase64
        });
        console.log("✅ Success Test 6");
    } catch (e) {
        console.log("❌ Failed Test 6:", e.message);
    }

    console.log("\n--- Verification Complete ---");
}

testImageHandling().catch(console.error);
