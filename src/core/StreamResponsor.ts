import { purifyTextForTTS, splitSentences } from "../utils";
import dotenv from "dotenv";
import { playAudioData, stopPlaying } from "../device/audio";
import { TTSResult } from "../type";
import fs from "fs";

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
  private ttsPromise: Promise<TTSResult> | null = null;
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

  private playAudioInOrder = async (): Promise<void> => {
    if (this.isPlaying) {
      console.log("Audio playback already in progress, skipping duplicate call");
      return;
    }

    this.isPlaying = true;
    try {
      if (!this.ttsPromise) {
        console.log("No audio to play");
        this.isPlaying = false;
        this.playEndResolve();
        return;
      }

      // Wait for TTS to complete
      const ttsResult = await this.ttsPromise;
      
      if (!ttsResult.filePath) {
        console.log("No audio file generated");
        this.isPlaying = false;
        this.playEndResolve();
        return;
      }

      // Get actual duration from the WAV file
      const actualDuration = this.getWavDuration(ttsResult.filePath);
      // Generous buffer for low-powered devices and playback variance
      const durationWithBuffer = actualDuration + 15000; // Add 15 second safety buffer

      // Play audio - timer starts now, after TTS is complete
      console.log(`Playing audio (actual: ${actualDuration}ms + 15s buffer = ${durationWithBuffer}ms)`);
      await playAudioData({ filePath: ttsResult.filePath, duration: durationWithBuffer });

      console.log("Play completed");
      this.isPlaying = false;
      this.playEndResolve();
      this.ttsPromise = null;
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
    
    // Split into sentences for display purposes only
    const { sentences, remaining } = splitSentences(this.partialContent);
    if (sentences.length > 0) {
      this.parsedSentences.push(...sentences);
      this.sentencesCallback?.(this.parsedSentences);
    }
    this.partialContent = remaining;
  };

  endPartial = (): void => {
    if (this.partialContent) {
      this.parsedSentences.push(this.partialContent);
      this.sentencesCallback?.(this.parsedSentences);
    }
    
    // Combine all text and make single TTS request
    const fullText = this.parsedSentences.join(" ");
    this.textCallback?.(fullText);
    
    if (fullText.trim() !== "") {
      const purifiedText = purifyTextForTTS(fullText);
      console.log(`Sending complete text to TTS (${purifiedText.length} characters)`);
      this.ttsPromise = this.ttsFunc(purifiedText);
      
      // Start playback after TTS request is made
      if (!this.isPlaying) {
        this.playAudioInOrder();
      }
    } else {
      this.playEndResolve();
    }
    
    this.partialContent = "";
    this.parsedSentences.length = 0;
  };

  getPlayEndPromise = (): Promise<void> => {
    return new Promise((resolve) => {
      this.playEndResolve = resolve;
    });
  };

  stop = (): void => {
    this.ttsPromise = null;
    this.partialContent = "";
    this.parsedSentences.length = 0;
    this.isPlaying = false;
    this.playEndResolve();
    stopPlaying();
  };
}
