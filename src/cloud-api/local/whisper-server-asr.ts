import axios from "axios";
import fs from "fs";

const whisperServerUrl = process.env.WHISPER_SERVER_URL || "http://localhost:9000";

export const recognizeAudio = async (
  audioFilePath: string
): Promise<string> => {
  if (!fs.existsSync(audioFilePath)) {
    console.error("Audio file does not exist:", audioFilePath);
    return "";
  }

  try {
    // Check file size and wait if needed
    const stats = fs.statSync(audioFilePath);
    if (stats.size === 0) {
      console.error("Audio file is empty:", audioFilePath);
      return "";
    }
    
    // Read the audio file as binary data
    const audioBuffer = fs.readFileSync(audioFilePath);
    const audioBase64 = audioBuffer.toString("base64");

    const response = await axios.post(`${whisperServerUrl}/recognize`, {
      audio: audioBase64,
    }, {
      timeout: 60000, // 60 second timeout for audio processing
    });

    if (response.data && response.data.recognition) {
      return response.data.recognition;
    } else {
      console.error("Unexpected response format from Whisper server:", response.data);
      return "";
    }
  } catch (error) {
    console.error(
      `Error calling Whisper server at ${whisperServerUrl}:`,
      error instanceof Error ? error.message : String(error)
    );
    return "";
  }
};
