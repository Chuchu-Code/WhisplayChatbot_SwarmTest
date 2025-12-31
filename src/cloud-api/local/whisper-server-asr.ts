import axios from "axios";
import fs from "fs";
import FormData from "form-data";

const whisperServerUrl = process.env.WHISPER_SERVER_URL || "http://localhost:9000";

export const recognizeAudio = async (
  audioFilePath: string
): Promise<string> => {
  if (!fs.existsSync(audioFilePath)) {
    console.error("Audio file does not exist:", audioFilePath);
    return "";
  }

  try {
    const fileStream = fs.createReadStream(audioFilePath);
    const formData = new FormData();
    formData.append("file", fileStream);

    const response = await axios.post(`${whisperServerUrl}/recognize`, formData, {
      headers: formData.getHeaders(),
      timeout: 60000, // 60 second timeout for audio processing
    });

    if (response.data && response.data.text) {
      return response.data.text;
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
