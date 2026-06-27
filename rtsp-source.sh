#!/bin/bash
sleep 5
echo "Generating test video patterns for multiple cameras..."

# Stream 1: Color bars pattern
ffmpeg -re -f lavfi -i "testsrc2=size=640x480:rate=15" \
  -f lavfi -i "sine=frequency=440:sample_rate=8000" \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -pix_fmt yuv420p -g 30 -b:v 500k \
  -c:a aac -b:a 32k \
  -f rtsp -rtsp_transport tcp rtsp://mediamtx:8554/live/test1 \
  -nostdin -y &

# Stream 2: SMPTE bars pattern
ffmpeg -re -f lavfi -i "smptebars=size=640x480:rate=15" \
  -f lavfi -i "sine=frequency=880:sample_rate=8000" \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -pix_fmt yuv420p -g 30 -b:v 500k \
  -c:a aac -b:a 32k \
  -f rtsp -rtsp_transport tcp rtsp://mediamtx:8554/live/test2 \
  -nostdin -y &

# Stream 3: Test pattern with timestamp
ffmpeg -re -f lavfi -i "testsrc=size=640x480:rate=15" \
  -f lavfi -i "sine=frequency=660:sample_rate=8000" \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -pix_fmt yuv420p -g 30 -b:v 500k \
  -c:a aac -b:a 32k \
  -f rtsp -rtsp_transport tcp rtsp://mediamtx:8554/live/test3 \
  -nostdin -y &

# Stream 4: Color pattern
ffmpeg -re -f lavfi -i "color=c=blue:size=640x480:rate=15,drawtext=text='CAM4 %{localtime}':fontsize=24:fontcolor=white:x=10:y=10" \
  -f lavfi -i "sine=frequency=550:sample_rate=8000" \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -pix_fmt yuv420p -g 30 -b:v 500k \
  -c:a aac -b:a 32k \
  -f rtsp -rtsp_transport tcp rtsp://mediamtx:8554/live/test4 \
  -nostdin -y &

echo "All 4 test streams started."
wait
