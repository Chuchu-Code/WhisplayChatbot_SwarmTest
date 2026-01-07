import axios from "axios";
import mp3Duration from "mp3-duration";
import dotenv from "dotenv";
import { TTSResult } from "../../type";

dotenv.config();

const fastKokoroServerUrl =
  process.env.FASTKOKORO_SERVER_URL || "http://localhost:8880";
const fastKokoroModel =
  process.env.FASTKOKORO_MODEL || "kokoro";
const fastKokoroVoice =
  process.env.FASTKOKORO_VOICE || "af_heart";
const fastKokoroResponseFormat =
  process.env.FASTKOKORO_RESPONSE_FORMAT || "mp3";
const fastKokoroSpeed = parseFloat(process.env.FASTKOKORO_SPEED || "1.0");

const fastKokoroTTS = async (
  text: string
): Promise<TTSResult> => {
  if (!fastKokoroServerUrl) {
    console.error("FastKokoro Server URL is not set.");
    return { duration: 0 };
  }

  try {
    // Request non-streaming full file and ask for download link
    const response = await axios.post(
      `${fastKokoroServerUrl}/v1/audio/speech`,
      {
        model: fastKokoroModel,
        input: text,
        voice: fastKokoroVoice,
        response_format: fastKokoroResponseFormat,
        speed: fastKokoroSpeed,
        stream: false,  // Disable streaming - get full file
        return_download_link: true,  // Request a download link
      },
      {
        responseType: "arraybuffer",
        timeout: 60000,  // Increase timeout for full file generation
      }
    );

    // Check if server provided a download link in headers
    const downloadPath = response.headers["x-download-path"];
    let buffer: Buffer;
    
    if (downloadPath && typeof downloadPath === "string") {
      // Follow the download link to get the full file
      const downloadUrl = downloadPath.startsWith("http")
        ? downloadPath
        : `${fastKokoroServerUrl}${downloadPath}`;
      console.log(`Downloading full audio from: ${downloadUrl}`);
      const downloadResponse = await axios.get(downloadUrl, {
        responseType: "arraybuffer",
        timeout: 60000,
      });
      buffer = Buffer.from(downloadResponse.data);
    } else {
      // Fallback: assume response body is the full audio
      buffer = Buffer.from(response.data);
    }

    // Calculate duration based on audio format
    let duration = 0;
    try {
      if (
        fastKokoroResponseFormat === "mp3" ||
        fastKokoroResponseFormat === "opus" ||
        fastKokoroResponseFormat === "aac" ||
        fastKokoroResponseFormat === "flac"
      ) {
        // mp3-duration library works with common audio formats
        duration = await mp3Duration(buffer);
        duration = duration * 1000; // Convert to milliseconds
      } else if (
        fastKokoroResponseFormat === "wav" ||
        fastKokoroResponseFormat === "pcm"
      ) {
        // For WAV/PCM, calculate from header information
        // WAV header: sample rate is at bytes 24-27 (little-endian)
        // Number of samples = file size / 2 (for 16-bit mono)
        // Duration = samples / sample rate
        if (buffer.length >= 44) {
          const sampleRate = buffer.readUInt32LE(24);
          const numSamples = (buffer.length - 44) / 2; // Assuming 16-bit mono
          duration = (numSamples / sampleRate) * 1000;
        }
      }
    } catch (durationError) {
      console.warn("Failed to calculate audio duration:", durationError);
      // Default to 0 if we can't calculate
      duration = 0;
    }

    return { buffer, duration };
  } catch (error) {
    console.error("FastKokoro TTS failed:", error);
    return { duration: 0 };
  }
};

export default fastKokoroTTS;
