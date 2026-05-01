import sys
import json
import asyncio
import edge_tts
import base64

# Ensure proper event loop policy for Windows
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

async def process_request(req):
    try:
        text = req.get('text')
        voice = req.get('voice', 'en-US-AriaNeural')
        rate = req.get('rate', '+0%')
        pitch = req.get('pitch', '+0Hz')
        
        communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
        
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                # Send audio chunk as JSON
                b64 = base64.b64encode(chunk["data"]).decode('utf-8')
                resp = {
                    "type": "audio",
                    "requestId": req.get('requestId'),
                    "data": b64
                }
                print(json.dumps(resp), flush=True)
        
        # Done
        print(json.dumps({"type": "done", "requestId": req.get('requestId')}), flush=True)
        
    except Exception as e:
        error_resp = {
            "success": False,
            "requestId": req.get('requestId'),
            "error": str(e)
        }
        print(json.dumps(error_resp), flush=True)

async def main():
    loop = asyncio.get_running_loop()
    # Log startup
    sys.stderr.write("[TTS Engine] Started\n")
    sys.stderr.flush()
    
    while True:
        try:
            line = await loop.run_in_executor(None, sys.stdin.readline)
            if not line:
                break
            
            line = line.strip()
            if not line:
                continue
                
            req = json.loads(line)
            await process_request(req)
            
        except json.JSONDecodeError:
            sys.stderr.write("[TTS Engine] Invalid JSON received\n")
            sys.stderr.flush()
        except Exception as e:
            sys.stderr.write(f"[TTS Engine] Loop error: {e}\n")
            sys.stderr.flush()

if __name__ == "__main__":
    asyncio.run(main())
