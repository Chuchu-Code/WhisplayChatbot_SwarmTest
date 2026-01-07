import { purifyTextForTTS, splitSentences } from "../utils";
import dotenv from "dotenv";
import { playAudioData, stopPlaying } from "../device/audio";
import { TTSResult } from "../type";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { ttsDir } from "../utils/dir";

dotenv.config();

type TTSFunc = (text: string) => Promise<TTSResult>;
type SentencesCallback = (sentences: string[]) => void;
type TextCallback = (text: string) => void;

export class StreamResponser {
  private ttsFunc: TTSFunc;
  private sentencesCallback?: SentencesCallback;
  private textCallback?: TextCallback;
  private partialContent: string = "";
  private playEndResolve: () => void = () => {};
  private speakArray: Promise<TTSResult>[] = [];
  private parsedSentences: string[] = [];
  private isPlaying: boolean = false;

  constructor(
    ttsFunc: TTSFunc,
    sentencesCallback?: SentencesCallback,
    textCallback?: TextCallback
  ) {
    this.ttsFunc = (text) => ttsFunc(text);
    this.sentencesCallback = sentencesCallback;
    this.textCallback = textCallback;
  }

  private getWavDuration = (filePath: string): number => {
    try {
      const buffer = fs.readFileSync(filePath);
      if (buffer.length >= 44) {
        const sampleRate = buffer.readUInt32LE(24);
        const channels = buffer.readUInt16LE(22);
        const bitsPerSample = buffer.readUInt16LE(34);
        const bytesPerSample = (bitsPerSample / 8) * channels;
        const numSamples = (buffer.length - 44) / bytesPerSample;
        const duration = (numSamples / sampleRate) * 1000; // milliseconds
        console.log(`WAV file duration: ${duration}ms (${(duration / 1000).toFixed(2)}s)`);
        return duration;
      }
    } catch (error) {
      console.warn("Failed to read WAV duration:", error);
    }
    return 0;
  };

  private combineWavFiles = (filePaths: string[]): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (filePaths.length === 0) {
        reject(new Error("No WAV files to combine"));
        return;
      }
      if (filePaths.length === 1) {
        resolve(filePaths[0]);
        return;
      }

      const outputPath = path.join(ttsDir, `combined_${Date.now()}.wav`);
      const soxProcess = spawn("sox", [...filePaths, outputPath]);

      let stderr = "";
      soxProcess.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      soxProcess.on("close", (code: number) => {
        if (code === 0) {
          console.log(`Combined ${filePaths.length} WAV files into ${outputPath}`);
          resolve(outputPath);
        } else {
          console.error("sox error:", stderr);
          reject(new Error(`sox failed with code ${code}`));
        }
      });

      soxProcess.on("error", (err) => {
        reject(err);
      });
    });
  };

  private playAudioInOrder = async (): Promise<void> => {
    if (this.isPlaying) {
      console.log("Audio playback already in progress, skipping duplicate call");
      return;
    }

    this.isPlaying = true;
    try {
      // Wait for all TTS promises to resolve
      const ttsResults = await Promise.all(this.speakArray);
      
      // Extract file paths from results
      const filePaths = ttsResults
        .filter((result) => result.filePath)
        .map((result) => result.filePath!);

      if (filePaths.length === 0) {
        console.log("No audio files generated");
        this.isPlaying = false;
        this.playEndResolve();
        return;
      }

      // Combine WAV files if multiple, or use single file
      const audioPath = filePaths.length > 1 
        ? await this.combineWavFiles(filePaths)
        : filePaths[0];

      // Get actual duration from the combined/single WAV file
      const actualDuration = this.getWavDuration(audioPath);
      const durationWithBuffer = actualDuration + 5000; // Add 5 second safety buffer

      // Play combined audio
      console.log(`Playing audio (actual: ${actualDuration}ms + 5s buffer = ${durationWithBuffer}ms)`);
      await playAudioData({ filePath: audioPath, duration: durationWithBuffer });

      console.log("Play completed");
      this.isPlaying = false;
      this.playEndResolve();
      this.speakArray.length = 0;
      this.speakArray = [];
    } catch (error) {
      console.error("Audio playback error:", error);
      this.isPlaying = false;
      this.playEndResolve();
    }
  };

  partial = (text: string): void => {
    this.partialContent += text;
    // replace newlines with spaces
    this.partialContent = this.partialContent.replace(/\n/g, " ");
    const { sentences, remaining } = splitSentences(this.partialContent);
    if (sentences.length > 0) {
      this.parsedSentences.push(...sentences);
      this.sentencesCallback?.(this.parsedSentences);
      // remove emoji
      const filteredSentences = sentences
        .map(purifyTextForTTS)
        .filter((item) => item !== "");
      this.speakArray.push(
        ...filteredSentences.map((item) => this.ttsFunc(item))
      );
    }
    this.partialContent = remaining;
  };

  endPartial = (): void => {
    if (this.partialContent) {
      this.parsedSentences.push(this.partialContent);
      this.sentencesCallback?.(this.parsedSentences);
      // remove emoji
      this.partialContent = this.partialContent.replace(
        /[\u{1F600}-\u{1F64F}]/gu,
        ""
      );
      if (this.partialContent.trim() !== "") {
        const text = purifyTextForTTS(this.partialContent);
        this.speakArray.push(this.ttsFunc(text));
      }
      this.partialContent = "";
    }
    this.textCallback?.(this.parsedSentences.join(" "));
    this.parsedSentences.length = 0;
    
    // Start playback after all sentences are collected
    if (!this.isPlaying && this.speakArray.length > 0) {
      this.playAudioInOrder();
    }
  };

  getPlayEndPromise = (): Promise<void> => {
    return new Promise((resolve) => {
      this.playEndResolve = resolve;
    });
  };

  stop = (): void => {
    this.speakArray = [];
    this.speakArray.length = 0;
    this.partialContent = "";
    this.parsedSentences.length = 0;
    this.isPlaying = false;
    this.playEndResolve();
    stopPlaying();
  };
}
