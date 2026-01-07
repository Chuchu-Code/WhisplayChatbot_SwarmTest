import { exec, spawn, ChildProcess } from "child_process";
import { isEmpty, noop, set } from "lodash";
import dotenv from "dotenv";
import { ttsServer, asrServer } from "../cloud-api/server";
import { ASRServer, TTSResult, TTSServer } from "../type";

dotenv.config();

const soundCardIndex = process.env.SOUND_CARD_INDEX || "1";

const useWavPlayer = [TTSServer.gemini, TTSServer.piper, TTSServer.fastkokoro].includes(ttsServer);

export const recordFileFormat = [
  ASRServer.vosk,
  ASRServer.whisper,
  ASRServer.llm8850whisper,
  ASRServer.whisperserver,
].includes(asrServer)
  ? "wav"
  : "mp3";

function startPlayerProcess() {
  if (useWavPlayer) {
    return null;
    // use sox play for wav files
    // return spawn("play", [
    //   "-f",
    //   "S16_LE",
    //   "-c",
    //   "1",
    //   "-r",
    //   "24000",
    //   "-D",
    //   `hw:${soundCardIndex},0`,
    //   "-", // read from stdin
    // ]);
  } else {
    // use mpg123 for mp3 files
    return spawn("mpg123", [
      "-",
      "--scale",
      "2",
      "-o",
      "alsa",
      "-a",
      `hw:${soundCardIndex},0`,
    ]);
  }
}

let recordingProcessList: ChildProcess[] = [];
let currentRecordingReject: (reason?: any) => void = noop;

const killAllRecordingProcesses = (): void => {
  recordingProcessList.forEach((child) => {
    console.log("Killing recording process", child.pid);
    try {
      child.kill("SIGINT");
    } catch (e) {}
  });
  recordingProcessList.length = 0;
};

const recordAudio = (
  outputPath: string,
  duration: number = 10
): Promise<string> => {
  return new Promise((resolve, reject) => {
    console.log(`Starting recording, maximum ${duration} seconds...`);
    // Use spawn instead of exec to avoid buffering and allow better device control
    const recordingProcess = spawn("sox", [
      "-t",
      "alsa",
      `plughw:${soundCardIndex},0`,
      "-t",
      recordFileFormat,
      "-c",
      "1",
      "-r",
      "16000",
      "-b",
      "16",
      "-e",
      "signed-integer",
      outputPath,
      "silence",
      "1",
      "0.1",
      "60%",
      "1",
      "1.0",
      "60%",
    ]);

    recordingProcess.on("error", (err) => {
      killAllRecordingProcesses();
      reject(err);
    });

    recordingProcess.stderr?.on("data", (data) => {
      console.error(data.toString());
    });

    // Set reject handler immediately
    currentRecordingReject = reject;
    recordingProcessList.push(recordingProcess);

    // Set a timeout to kill the recording process after the specified duration
    const timeout = setTimeout(() => {
      if (recordingProcessList.includes(recordingProcess)) {
        try {
          recordingProcess.stdin?.end();
        } catch (e) {}
        setTimeout(() => {
          killAllRecordingProcesses();
        }, 200);
        resolve(outputPath);
      }
    }, duration * 1000);

    recordingProcess.on("exit", () => {
      clearTimeout(timeout);
      // Wait longer to ensure file is fully written to disk and ALSA device is properly released
      setTimeout(() => {
        resolve(outputPath);
      }, 500);
    });
  });
};

const recordAudioManually = (
  outputPath: string
): { result: Promise<string>; stop: () => void } => {
  let stopFunc: () => void = noop;
  const result = new Promise<string>((resolve, reject) => {
    currentRecordingReject = reject;
    const recordingProcess = spawn("sox", [
      "-t",
      "alsa",
      `plughw:${soundCardIndex},0`,
      "-t",
      recordFileFormat,
      "-c",
      "1",
      "-r",
      "16000",
      "-b",
      "16",
      "-e",
      "signed-integer",
      outputPath,
    ]);

    recordingProcess.on("error", (err) => {
      killAllRecordingProcesses();
      reject(err);
    });

    recordingProcess.stderr?.on("data", (data) => {
      console.error(data.toString());
    });
    recordingProcessList.push(recordingProcess);
    stopFunc = () => {
      // Close stdin first to signal EOF to sox
      try {
        recordingProcess.stdin?.end();
      } catch (e) {}
      // Give sox a moment to finish writing before killing
      setTimeout(() => {
        killAllRecordingProcesses();
      }, 200);
    };
    recordingProcess.on("exit", () => {
      // Wait longer to ensure file is fully written to disk
      // and ALSA device is properly released
      setTimeout(() => {
        resolve(outputPath);
      }, 500);
    });
  });
  return {
    result,
    stop: stopFunc,
  };
};

const stopRecording = (): void => {
  if (!isEmpty(recordingProcessList)) {
    killAllRecordingProcesses();
    try {
      currentRecordingReject();
    } catch (e) {}
    console.log("Recording stopped");
  } else {
    console.log("No recording process running");
  }
};

interface Player {
  isPlaying: boolean;
  process: ChildProcess | null;
}

const player: Player = {
  isPlaying: false,
  process: null,
};

// Track ALL active player processes for guaranteed cleanup
let allPlayerProcesses: ChildProcess[] = [];

// Player will be created on-demand when needed for playback

const playAudioData = (params: TTSResult): Promise<void> => {
  const { duration: audioDuration, filePath, base64, buffer } = params;
  if (audioDuration <= 0 || (!filePath && !base64 && !buffer)) {
    console.log("No audio data to play, skipping playback.");
    return Promise.resolve();
  }
  // play wav file using aplay
  if (filePath) {
    return new Promise<void>((resolve, reject) => {
      console.log("Playback duration:", audioDuration);
      player.isPlaying = true;
      const wavProcess = spawn("play", [filePath]);
      allPlayerProcesses.push(wavProcess);
      
      const cleanup = () => {
        player.isPlaying = false;
        const idx = allPlayerProcesses.indexOf(wavProcess);
        if (idx > -1) allPlayerProcesses.splice(idx, 1);
        try {
          wavProcess.kill("SIGTERM");
        } catch (e) {}
      };
      
      // Fallback timeout
      const timeout = setTimeout(() => {
        cleanup();
        resolve();
      }, audioDuration + 2000);
      
      wavProcess.on("close", (code: number) => {
        clearTimeout(timeout);
        cleanup();
        if (code !== 0) {
          console.error(`Audio playback error: ${code}`);
          reject(code);
        } else {
          console.log("Audio playback completed");
          resolve();
        }
      });
    }).catch((error) => {
      console.error("Audio playback error:", error);
    });
  }

  // play mp3 buffer using mpg123
  return new Promise((resolve, reject) => {
    const audioBuffer = base64 ? Buffer.from(base64, "base64") : buffer;
    console.log("Playback duration:", audioDuration);
    
    // Force cleanup of any existing player before starting new playback
    if (player.process) {
      console.log("Cleaning up existing player before new playback");
      try {
        player.process.stdin?.end();
        player.process.kill();
      } catch (e) {}
      player.process = null;
    }
    
    // Create fresh player for this playback
    player.process = startPlayerProcess();
    const process = player.process;

    if (!process) {
      return reject(new Error("Audio player could not be initialized."));
    }
    
    // Track this process for global cleanup
    allPlayerProcesses.push(process);
    
    player.isPlaying = true;
    
    // Kill player after playback completes to release ALSA device
    const cleanupPlayer = () => {
      player.isPlaying = false;
      try {
        if (player.process) {
          const idx = allPlayerProcesses.indexOf(player.process);
          if (idx > -1) allPlayerProcesses.splice(idx, 1);
          player.process.stdin?.end();
          player.process.kill("SIGTERM");
        }
      } catch (e) {}
      player.process = null;
      console.log("Audio playback completed, player cleaned up");
    };
    
    // Fallback timeout: kill player after 1 minute max
    const fallbackTimeout = setTimeout(() => {
      if (player.isPlaying) {
        console.warn("Playback timeout (60s) reached, forcing cleanup");
        cleanupPlayer();
        resolve();
      }
    }, 60000); // 60 second maximum

    try {
      process.stdin?.write(audioBuffer);
      // Signal end of input so mpg123 exits after playing
      process.stdin?.end();
    } catch (e) {}
    process.stdout?.on("data", (data) => console.log(data.toString()));
    process.stderr?.on("data", (data) => console.error(data.toString()));
    process.on("exit", (code) => {
      clearTimeout(fallbackTimeout);
      cleanupPlayer();
      if (code !== 0) {
        console.error(`Audio playback error: ${code}`);
        reject(code);
      } else {
        resolve();
      }
    });
  });
};

const stopPlaying = (): void => {
  console.log("Stopping ALL audio playback and releasing ALSA device");
  
  // Kill the main tracked player
  try {
    if (player.process) {
      player.process.stdin?.end();
      player.process.kill("SIGTERM");
    }
  } catch {}
  player.isPlaying = false;
  player.process = null;
  
  // Kill ALL tracked player processes (including wav players)
  allPlayerProcesses.forEach((proc) => {
    try {
      proc.stdin?.end();
      proc.kill("SIGTERM");
    } catch {}
  });
  allPlayerProcesses.length = 0;
  
  console.log("All player processes killed");
};

// Close audio player when exiting program
process.on("SIGINT", () => {
  try {
    if (player.process) {
      player.process.stdin?.end();
      player.process.kill();
    }
  } catch {}
  process.exit();
});

export {
  recordAudio,
  recordAudioManually,
  stopRecording,
  playAudioData,
  stopPlaying,
};
