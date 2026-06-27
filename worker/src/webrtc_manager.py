"""WebRTC streaming using aiortc.

Handles server-side WebRTC peer connections that send video frames
from the RTSP ingester to browser clients.
"""

import asyncio
import fractions
from typing import Any

import numpy as np
from aiortc import (
    RTCPeerConnection,
    RTCSessionDescription,
    MediaStreamTrack,
    RTCConfiguration,
    RTCIceServer,
)
from aiortc.contrib.media import MediaRelay
from av import VideoFrame

from .logging_config import get_logger

logger = get_logger(__name__)


class FrameVideoTrack(MediaStreamTrack):
    """A video track that serves frames pushed from the camera pipeline."""

    kind = "video"

    def __init__(self, camera_id: str) -> None:
        super().__init__()
        self.camera_id = camera_id
        self._queue: asyncio.Queue[np.ndarray] = asyncio.Queue(maxsize=5)
        self._timestamp = 0
        self._time_base = fractions.Fraction(1, 30)

    async def recv(self) -> VideoFrame:
        """Return the next video frame for WebRTC transmission."""
        try:
            frame_data = await asyncio.wait_for(self._queue.get(), timeout=5.0)
        except asyncio.TimeoutError:
            # Return a black frame if no data available
            frame_data = np.zeros((480, 640, 3), dtype=np.uint8)

        # Convert BGR (OpenCV) to RGB for av.VideoFrame
        frame_rgb = frame_data[:, :, ::-1].copy()
        frame = VideoFrame.from_ndarray(frame_rgb, format="rgb24")
        frame.pts = self._timestamp
        frame.time_base = self._time_base
        self._timestamp += 1
        return frame

    def push_frame(self, frame: np.ndarray) -> None:
        """Push a frame to be sent over WebRTC. Drops old frames if queue is full."""
        try:
            self._queue.put_nowait(frame)
        except asyncio.QueueFull:
            # Drop oldest frame and add new one
            try:
                self._queue.get_nowait()
                self._queue.put_nowait(frame)
            except (asyncio.QueueEmpty, asyncio.QueueFull):
                pass


class WebRTCManager:
    """Manages WebRTC peer connections for camera streams."""

    def __init__(self) -> None:
        self._peer_connections: dict[str, RTCPeerConnection] = {}
        self._video_tracks: dict[str, FrameVideoTrack] = {}
        self._relay = MediaRelay()

    def get_or_create_track(self, camera_id: str) -> FrameVideoTrack:
        """Get or create a video track for a camera."""
        if camera_id not in self._video_tracks:
            self._video_tracks[camera_id] = FrameVideoTrack(camera_id)
            logger.info("Created video track", camera_id=camera_id)
        return self._video_tracks[camera_id]

    async def handle_offer(
        self, camera_id: str, offer_sdp: dict[str, Any]
    ) -> dict[str, Any]:
        """Handle a WebRTC offer from the browser and return an answer.

        Args:
            camera_id: The camera this peer connection is for.
            offer_sdp: The SDP offer from the browser.

        Returns:
            The SDP answer to send back.
        """
        # Close any existing connection for this camera
        await self.close_connection(camera_id)

        # Use STUN to generate server reflexive candidates (fixes Docker NAT issues)
        config = RTCConfiguration(
            iceServers=[RTCIceServer(urls=["stun:stun.l.google.com:19302"])]
        )
        pc = RTCPeerConnection(configuration=config)
        self._peer_connections[camera_id] = pc

        # Get the video track for this camera
        track = self.get_or_create_track(camera_id)
        pc.addTrack(self._relay.subscribe(track))

        @pc.on("connectionstatechange")
        async def on_connection_state_change() -> None:
            logger.info(
                "WebRTC connection state changed",
                camera_id=camera_id,
                state=pc.connectionState,
            )
            if pc.connectionState in ("failed", "closed"):
                await self.close_connection(camera_id)

        @pc.on("iceconnectionstatechange")
        async def on_ice_state_change() -> None:
            logger.debug(
                "ICE connection state",
                camera_id=camera_id,
                state=pc.iceConnectionState,
            )

        # Set remote description (the browser's offer)
        offer = RTCSessionDescription(sdp=offer_sdp["sdp"], type=offer_sdp["type"])
        await pc.setRemoteDescription(offer)

        # Create and set local description (our answer)
        answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)

        logger.info("WebRTC answer created", camera_id=camera_id)
        return {
            "sdp": pc.localDescription.sdp,
            "type": pc.localDescription.type,
        }

    async def add_ice_candidate(self, camera_id: str, candidate: dict[str, Any]) -> None:
        """Add an ICE candidate from the browser."""
        pc = self._peer_connections.get(camera_id)
        if pc is None:
            logger.warning("No peer connection for ICE candidate", camera_id=camera_id)
            return

        # aiortc handles ICE candidates through setRemoteDescription
        # For trickle ICE, we just log it — aiortc gathers candidates internally
        logger.debug("ICE candidate received", camera_id=camera_id)

    def push_frame(self, camera_id: str, frame: np.ndarray) -> None:
        """Push a frame to the WebRTC track for a camera."""
        track = self._video_tracks.get(camera_id)
        if track is not None:
            track.push_frame(frame)

    async def close_connection(self, camera_id: str) -> None:
        """Close a WebRTC peer connection."""
        pc = self._peer_connections.pop(camera_id, None)
        if pc is not None:
            await pc.close()
            logger.info("WebRTC connection closed", camera_id=camera_id)

    def remove_track(self, camera_id: str) -> None:
        """Remove a camera's video track."""
        track = self._video_tracks.pop(camera_id, None)
        if track is not None:
            track.stop()
            logger.info("Video track removed", camera_id=camera_id)

    async def close_all(self) -> None:
        """Close all peer connections and clean up."""
        camera_ids = list(self._peer_connections.keys())
        for camera_id in camera_ids:
            await self.close_connection(camera_id)

        track_ids = list(self._video_tracks.keys())
        for camera_id in track_ids:
            self.remove_track(camera_id)

        logger.info("All WebRTC connections closed")
