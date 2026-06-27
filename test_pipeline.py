"""
End-to-end pipeline test script.

Sends simulated person detection events through Kafka to verify the full pipeline:
  Kafka → Backend Consumer → Neon DB → WebSocket → Frontend

Usage:
  python test_pipeline.py                         # Send 3 test alerts for the first camera
  python test_pipeline.py <camera_id>             # Send 3 test alerts for a specific camera
  python test_pipeline.py <camera_id> <count>     # Send N test alerts for a specific camera

Prerequisites:
  pip install aiokafka
  Kafka must be running (docker compose up -d kafka)
"""

import asyncio
import json
import sys
import uuid
from datetime import datetime, timezone

try:
    from aiokafka import AIOKafkaProducer
except ImportError:
    print("ERROR: aiokafka not installed. Run: pip install aiokafka")
    sys.exit(1)


KAFKA_BROKER = "localhost:29092"
TOPIC = "camera.detections"


async def send_test_alerts(camera_id: str, count: int = 3):
    """Send fake person_detected events to Kafka."""
    producer = AIOKafkaProducer(
        bootstrap_servers=KAFKA_BROKER,
        value_serializer=lambda v: json.dumps(v).encode("utf-8"),
    )

    await producer.start()
    print(f"\n{'='*60}")
    print(f"  Skylark VMS Pipeline Test")
    print(f"  Sending {count} test alerts for camera: {camera_id}")
    print(f"{'='*60}\n")

    try:
        for i in range(count):
            event = {
                "id": str(uuid.uuid4()),
                "cameraId": camera_id,
                "type": "person_detected",
                "confidence": round(0.75 + (i * 0.05), 4),
                "boundingBox": {
                    "x": 100 + (i * 30),
                    "y": 50 + (i * 10),
                    "width": 80,
                    "height": 200,
                },
                "detectedAt": datetime.now(timezone.utc).isoformat(),
            }

            await producer.send_and_wait(TOPIC, value=event, key=camera_id.encode())
            print(f"  [OK] Alert {i+1}/{count} sent")
            print(f"    ID:         {event['id']}")
            print(f"    Confidence: {event['confidence']}")
            print(f"    BBox:       ({event['boundingBox']['x']}, {event['boundingBox']['y']}) "
                  f"{event['boundingBox']['width']}x{event['boundingBox']['height']}")
            print(f"    Time:       {event['detectedAt']}")
            print()

            await asyncio.sleep(1)  # Space out alerts

        print(f"{'='*60}")
        print(f"  [SUCCESS] All {count} alerts sent successfully!")
        print(f"  Check:")
        print(f"    1. http://localhost (Alerts page should show new alerts)")
        print(f"    2. Backend logs: docker compose logs -f backend")
        print(f"    3. Neon DB: alerts table should have {count} new rows")
        print(f"{'='*60}\n")

    finally:
        await producer.stop()


if __name__ == "__main__":
    camera_id = sys.argv[1] if len(sys.argv) > 1 else "PUT_YOUR_CAMERA_ID_HERE"
    count = int(sys.argv[2]) if len(sys.argv) > 2 else 3

    if camera_id == "PUT_YOUR_CAMERA_ID_HERE":
        print("\n[WARNING] No camera ID provided!")
        print("   Get your camera ID from the dashboard, then run:")
        print("   python test_pipeline.py <camera_id>\n")
        print("   Or use the backend API:")
        print("   curl http://localhost:3000/cameras -H 'Authorization: Bearer <your_token>'\n")
        sys.exit(1)

    asyncio.run(send_test_alerts(camera_id, count))
