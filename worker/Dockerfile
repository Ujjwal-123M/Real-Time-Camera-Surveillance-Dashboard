FROM python:3.12-slim

WORKDIR /app

# Install system dependencies for OpenCV and aiortc
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libavformat-dev \
    libavcodec-dev \
    libavdevice-dev \
    libavutil-dev \
    libswscale-dev \
    libswresample-dev \
    libavfilter-dev \
    pkg-config \
    gcc \
    libffi-dev \
    libopus-dev \
    libvpx-dev \
    && rm -rf /var/lib/apt/lists/*

# ── Step 1: Install CPU-only PyTorch (~300MB instead of ~2.5GB with CUDA) ──
RUN pip install --no-cache-dir --timeout 120 --retries 3 \
    torch torchvision \
    --index-url https://download.pytorch.org/whl/cpu

# ── Step 2: Install remaining Python dependencies ──
COPY requirements.txt .
RUN pip install --no-cache-dir --timeout 120 --retries 3 -r requirements.txt

# ── Step 3: Download YOLOv8n model weights at build time ──
RUN python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"

# Copy source code
COPY . .

CMD ["python", "-m", "src.main"]
