import axios from "axios";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { TTSResult } from "../../type";
import { ttsDir } from "../../utils/dir";

dotenv.config();

const fastKokoroServerUrl =
  process.env.FASTKOKORO_SERVER_URL || "http://localhost:8880";
const fastKokoroModel =
  process.env.FASTKOKORO_MODEL || "kokoro";
const fastKokoroVoice =
  process.env.FASTKOKORO_VOICE || "af_heart";
const fastKokoroSpeed = parseFloat(process.env.FASTKOKORO_SPEED || "1.0");

// Always use WAV format for file-based playback to avoid ALSA device contention
const KOKORO_RESPONSE_FORMAT = "wav";

const fastKokoroTTS = async (
  text: string
): Promise<TTSResult> => {
  if (!fastKokoroServerUrl) {
    console.error("FastKokoro Server URL is not set.");
    return { duration: 0 };
  }

  try {
    const response = await axios.post(
      `${fastKokoroServerUrl}/v1/audio/speech`,
      {
        model: fastKokoroModel,
        input: text,
        voice: fastKokoroVoice,
        response_format: KOKORO_RESPONSE_FORMAT,
        speed: fastKokoroSpeed,
        stream: false, // Get complete WAV in single response to avoid pauses
      },
      {
        responseType: "arraybuffer",
        timeout: 30000,
      }
    );

    const buffer = Buffer.from(response.data);

    // Save WAV buffer to file
    const now = Date.now();
    const filePath = path.join(ttsDir, `kokoro_${now}.wav`);
    fs.writeFileSync(filePath, buffer);

    // Calculate duration from WAV header
    let duration = 0;
    try {
      if (buffer.length >= 44) {
        // WAV header: sample rate is at bytes 24-27 (little-endian)
        // Channels at bytes 22-23, bits per sample at bytes 34-35
        const sampleRate = buffer.readUInt32LE(24);
        const channels = buffer.readUInt16LE(22);
        const bitsPerSample = buffer.readUInt16LE(34);
        const bytesPerSample = (bitsPerSample / 8) * channels;
        const numSamples = (buffer.length - 44) / bytesPerSample;
        duration = (numSamples / sampleRate) * 1000; // Convert to milliseconds
      }
    } catch (durationError) {
      console.warn("Failed to calculate audio duration:", durationError);
      duration = 0;
    }

    return { filePath, duration };
  } catch (error) {
    console.error("FastKokoro TTS failed:", error);
    return { duration: 0 };
  }
};

export default fastKokoroTTS;
