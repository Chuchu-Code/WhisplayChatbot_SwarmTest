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
  private playEndResolvers: Array<() => void> = [];
  private ttsPromise: Promise<TTSResult> | null = null;
  private ttsAbortController: AbortController | null = null;
  private parsedSentences: string[] = [];
  private isPlaying: boolean = false;
  private isStopped: boolean = false;

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
        this.resolveAllPlayEnds();
        return;
      }

      console.log("Waiting for TTS promise to resolve...");
      // Wait for TTS to complete
      let ttsResult: TTSResult;
      try {
        ttsResult = await this.ttsPromise;
        console.log("TTS promise resolved successfully");
      } catch (ttsError) {
        console.error("TTS request failed:", ttsError);
        this.isPlaying = false;
        this.resolveAllPlayEnds();
        throw ttsError;
      }
      
      // Check if we were stopped while waiting
      if (this.isStopped) {
        console.log("Playback was cancelled, skipping audio playback");
        this.isPlaying = false;
        this.resolveAllPlayEnds();
        return;
      }
      
      if (!ttsResult.filePath) {
        console.log("No audio file generated from TTS");
        this.isPlaying = false;
        this.resolveAllPlayEnds();
        return;
      }

      console.log("Audio file path:", ttsResult.filePath);
      // Get actual duration from the WAV file
      const actualDuration = this.getWavDuration(ttsResult.filePath);
      // Generous buffer for low-powered devices and playback variance
      const durationWithBuffer = actualDuration + 15000; // Add 15 second safety buffer

      // Play audio - timer starts now, after TTS is complete
      console.log(`Playing audio (actual: ${actualDuration}ms + 15s buffer = ${durationWithBuffer}ms)`);
      try {
        await playAudioData({ filePath: ttsResult.filePath, duration: durationWithBuffer });
        console.log("Audio playback completed successfully");
      } catch (playError) {
        console.error("Audio playback failed:", playError);
        throw playError;
      }

      this.isPlaying = false;
      this.resolveAllPlayEnds();
      this.ttsPromise = null;
    } catch (error) {
      console.error("Audio playback pipeline error:", error);
      this.isPlaying = false;
      this.resolveAllPlayEnds();
    }
  };

  private resolveAllPlayEnds = (): void => {
    this.playEndResolvers.forEach((resolve) => resolve());
    this.playEndResolvers.length = 0;
  };

  partial = (text: string): void => {
    console.log(`Received partial text (${text.length} chars)`);
    this.partialContent += text;
    // replace newlines with spaces
    this.partialContent = this.partialContent.replace(/\n/g, " ");
    
    // Split into sentences for display purposes only
    const { sentences, remaining } = splitSentences(this.partialContent);
    if (sentences.length > 0) {
      this.parsedSentences.push(...sentences);
      console.log(`Parsed ${sentences.length} sentences, total sentences: ${this.parsedSentences.length}`);
      this.sentencesCallback?.(this.parsedSentences);
    }
    this.partialContent = remaining;
  };

  endPartial = (): void => {
    console.log("endPartial called");
    // Reset stopped flag for new conversation
    this.isStopped = false;
    
    if (this.partialContent) {
      console.log(`Adding final partial content (${this.partialContent.length} chars)`);
      this.parsedSentences.push(this.partialContent);
      this.sentencesCallback?.(this.parsedSentences);
    }
    
    // Combine all text and make single TTS request
    const fullText = this.parsedSentences.join(" ");
    console.log(`Full text for TTS (${fullText.length} chars): ${fullText.substring(0, 100)}...`);
    this.textCallback?.(fullText);
    
    if (fullText.trim() !== "") {
      const purifiedText = purifyTextForTTS(fullText);
      console.log(`Sending complete text to TTS (${purifiedText.length} characters)`);
      this.ttsPromise = this.ttsFunc(purifiedText);
      
      // Start playback after TTS request is made
      if (!this.isPlaying) {
        console.log("Starting playAudioInOrder");
        this.playAudioInOrder();
      }
    } else {
      console.log("No text to send to TTS, resolving immediately");
      // Resolve immediately if no text
      this.resolveAllPlayEnds();
    }
    
    this.partialContent = "";
    this.parsedSentences.length = 0;
  };

  getPlayEndPromise = (): Promise<void> => {
    return new Promise((resolve) => {
      // If already playing or will play soon, add to resolvers
      this.playEndResolvers.push(resolve);
      // If nothing is queued, resolve immediately
      if (!this.ttsPromise && !this.isPlaying) {
        resolve();
      }
    });
  };

  stop = (): void => {
    console.log("Stopping StreamResponsor");
    this.isStopped = true;
    this.ttsPromise = null;
    
    // Attempt to abort TTS request if one is in flight
    if (this.ttsAbortController) {
      try {
        this.ttsAbortController.abort();
      } catch (e) {}
      this.ttsAbortController = null;
    }
    
    this.partialContent = "";
    this.parsedSentences.length = 0;
    this.isPlaying = false;
    this.resolveAllPlayEnds();
    stopPlaying();
  };
}
