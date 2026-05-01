from __future__ import annotations

import asyncio
import io
import os
import tempfile
import threading
from pathlib import Path

import numpy as np
import torch
from fastapi import File, HTTPException, UploadFile

from omnivoice_server.cli import main
from omnivoice_server import app as omnivoice_app
from omnivoice_server.services.inference import OmniVoiceAdapter
from omnivoice_server.services.model import ModelService
from omnivoice_server.utils import audio as audio_utils

_ROOT = Path(__file__).resolve().parents[2]
_LOCAL_FFMPEG_BIN = _ROOT / ".omnivoice" / "tools" / "ffmpeg-bin"
_EXTRA_FFMPEG_BIN = os.environ.get("OMNIVOICE_FFMPEG_BIN", "").strip()

for _ffmpeg_bin in (_EXTRA_FFMPEG_BIN, str(_LOCAL_FFMPEG_BIN)):
    if _ffmpeg_bin and Path(_ffmpeg_bin).exists():
        os.environ["PATH"] = f"{_ffmpeg_bin}{os.pathsep}{os.environ.get('PATH', '')}"

_original_tensor_to_wav_bytes = audio_utils.tensor_to_wav_bytes
_original_tensors_to_wav_bytes = audio_utils.tensors_to_wav_bytes
_original_tensor_to_pcm16_bytes = audio_utils.tensor_to_pcm16_bytes


def _has_nan_compatible(tensors) -> bool:
    for value in tensors:
        if isinstance(value, torch.Tensor):
            if torch.isnan(value).any():
                return True
            continue

        try:
            array = np.asarray(value)
        except Exception:
            continue

        if np.isnan(array).any():
            return True

    return False


ModelService._has_nan = staticmethod(_has_nan_compatible)


def _as_audio_tensor(value) -> torch.Tensor:
    if isinstance(value, torch.Tensor):
        tensor = value.detach().cpu()
    else:
        tensor = torch.as_tensor(np.asarray(value), dtype=torch.float32)

    if tensor.dim() == 1:
        tensor = tensor.unsqueeze(0)

    return tensor


def _tensor_to_wav_bytes_compatible(tensor) -> bytes:
    return _original_tensor_to_wav_bytes(_as_audio_tensor(tensor))


def _tensors_to_wav_bytes_compatible(tensors) -> bytes:
    return _original_tensors_to_wav_bytes([_as_audio_tensor(tensor) for tensor in tensors])


def _tensor_to_pcm16_bytes_compatible(tensor) -> bytes:
    return _original_tensor_to_pcm16_bytes(_as_audio_tensor(tensor))


audio_utils.tensor_to_wav_bytes = _tensor_to_wav_bytes_compatible
audio_utils.tensors_to_wav_bytes = _tensors_to_wav_bytes_compatible
audio_utils.tensor_to_pcm16_bytes = _tensor_to_pcm16_bytes_compatible

_original_build_kwargs = OmniVoiceAdapter.build_kwargs
_original_create_app = omnivoice_app.create_app
_asr_lock = threading.Lock()
_faster_whisper_model = None


def _load_reference_audio_without_torchcodec(path: str) -> tuple[torch.Tensor, int]:
    """Decode clone reference WAVs without TorchCodec/FFmpeg DLLs.

    The desktop app trims clone references to WAV in the renderer before upload.
    Passing a file path to upstream OmniVoice makes it import TorchCodec, which
    requires a Windows FFmpeg shared-DLL install. A decoded (tensor, sample_rate)
    tuple is accepted by OmniVoice directly and avoids that brittle dependency.
    """
    try:
        import soundfile as sf

        audio, sample_rate = sf.read(path, dtype="float32", always_2d=True)
        if audio.shape[1] > 1:
            audio = audio.mean(axis=1, keepdims=True)
        tensor = torch.from_numpy(audio[:, 0]).float()
        return tensor, int(sample_rate)
    except Exception:
        # Fallback keeps non-WAV formats possible when torchaudio can decode them.
        import torchaudio

        tensor, sample_rate = torchaudio.load(path)
        if tensor.dim() == 2 and tensor.shape[0] > 1:
            tensor = tensor.mean(dim=0)
        elif tensor.dim() == 2:
            tensor = tensor.squeeze(0)
        return tensor.float(), int(sample_rate)


def _build_kwargs_without_torchcodec(self, req, model) -> dict:
    kwargs = _original_build_kwargs(self, req, model)
    ref_audio = kwargs.get("ref_audio")
    if isinstance(ref_audio, str):
        kwargs["ref_audio"] = _load_reference_audio_without_torchcodec(ref_audio)
    return kwargs


OmniVoiceAdapter.build_kwargs = _build_kwargs_without_torchcodec


def _load_reference_audio_bytes_without_torchcodec(raw: bytes) -> tuple[torch.Tensor, int]:
    try:
        import soundfile as sf

        audio, sample_rate = sf.read(io.BytesIO(raw), dtype="float32", always_2d=True)
        if audio.shape[1] > 1:
            audio = audio.mean(axis=1, keepdims=True)
        tensor = torch.from_numpy(audio[:, 0]).float()
        return tensor, int(sample_rate)
    except Exception:
        import librosa

        audio, sample_rate = librosa.load(io.BytesIO(raw), sr=None, mono=True)
        tensor = torch.from_numpy(np.asarray(audio, dtype=np.float32)).float()
        return tensor, int(sample_rate)


def _transcribe_with_faster_whisper(raw: bytes) -> str:
    global _faster_whisper_model

    from faster_whisper import WhisperModel

    model_size = os.environ.get("OMNIVOICE_WHISPER_MODEL", "base").strip() or "base"

    with _asr_lock:
        if _faster_whisper_model is None:
            try:
                _faster_whisper_model = WhisperModel(
                    model_size,
                    device="cuda" if torch.cuda.is_available() else "cpu",
                    compute_type="float16" if torch.cuda.is_available() else "int8",
                )
            except Exception:
                _faster_whisper_model = WhisperModel(model_size, device="cpu", compute_type="int8")

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(raw)
            tmp_path = tmp.name

        try:
            segments, _info = _faster_whisper_model.transcribe(
                tmp_path,
                beam_size=5,
                vad_filter=True,
            )
            return " ".join(segment.text.strip() for segment in segments).strip()
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def _transcribe_with_omnivoice_asr(model, waveform: torch.Tensor, sample_rate: int) -> str:
    with _asr_lock:
        if getattr(model, "_asr_pipe", None) is None:
            model.load_asr_model(os.environ.get("OMNIVOICE_ASR_MODEL", "openai/whisper-large-v3-turbo"))
        return model.transcribe((waveform, sample_rate)).strip()


def _create_app_with_transcription(cfg):
    app = _original_create_app(cfg)

    @app.post("/v1/audio/transcriptions")
    async def transcribe_audio(file: UploadFile = File(...)):
        raw = await file.read()
        if not raw:
            raise HTTPException(status_code=400, detail="No audio file provided.")

        try:
            try:
                text = await asyncio.to_thread(_transcribe_with_faster_whisper, raw)
            except Exception:
                waveform, sample_rate = _load_reference_audio_bytes_without_torchcodec(raw)
                text = await asyncio.to_thread(
                    _transcribe_with_omnivoice_asr,
                    app.state.model_svc.model,
                    waveform,
                    sample_rate,
                )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Transcription failed: {exc}") from exc

        return {"text": text}

    return app


omnivoice_app.create_app = _create_app_with_transcription


if __name__ == "__main__":
    main()
