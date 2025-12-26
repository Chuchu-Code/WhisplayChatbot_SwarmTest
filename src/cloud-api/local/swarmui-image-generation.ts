import { LLMTool, ToolReturnTag } from "../../type";
import {
  setLatestGenImg,
} from "../../utils/image";
import * as path from "path";
import { imageDir } from "../../utils/dir";
import { writeFileSync } from "fs";
import fetch from "node-fetch";

export interface SwarmUIGenerateRequest {
  session_id: string;
  prompt: string;
  negativeprompt?: string;
  steps?: number;
  cfgscale?: number;
  width?: number;
  height?: number;
  scheduler?: string;
  sampler?: string;
  model?: string;
  images?: number;
  donotsave?: boolean;
  seed?: number;
}

export interface SwarmUIGenerateResponse {
  images?: string[];
  error?: string;
  error_id?: string;
}

export interface SwarmUISessionResponse {
  session_id: string;
  error?: string;
  error_id?: string;
}

let swarmSessionId: string | null = null;

async function getSwarmSession(baseUrl: string): Promise<string> {
  // Return cached session if available
  if (swarmSessionId) {
    return swarmSessionId;
  }

  try {
    const response = await fetch(`${baseUrl}/API/GetNewSession`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      throw new Error(`Failed to get SwarmUI session: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as SwarmUISessionResponse;

    if (data.error) {
      throw new Error(`SwarmUI API error: ${data.error}`);
    }

    if (!data.session_id) {
      throw new Error('No session ID returned from SwarmUI');
    }

    swarmSessionId = data.session_id;
    return swarmSessionId;
  } catch (error) {
    throw new Error(`Failed to get SwarmUI session: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export const addSwarmUIGenerationTool = (imageGenerationTools: LLMTool[]) => {
  const baseUrl = process.env.SWARMUI_BASE_URL;

  if (!baseUrl) {
    console.warn('SWARMUI_BASE_URL is not configured, skipping SwarmUI image generation tool');
    return;
  }

  imageGenerationTools.push({
    type: "function",
    function: {
      name: "generateImage",
      description: "Generate an image from a text prompt using SwarmUI",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "The text prompt to generate the image from",
          },
          negativePrompt: {
            type: "string",
            description: "A text prompt describing what should NOT be in the image",
          },
        },
        required: ["prompt"],
      },
    },
    func: async (params: { prompt: string; negativePrompt?: string }) => {
      console.log(`Generating image with SwarmUI from ${baseUrl}`);
      const { prompt, negativePrompt = "" } = params;

      try {
        // Get session ID
        const sessionId = await getSwarmSession(baseUrl);

        // Prepare request
        const requestBody: SwarmUIGenerateRequest = {
          session_id: sessionId,
          prompt,
          negativeprompt: negativePrompt,
          steps: parseInt(process.env.SWARMUI_STEPS || "20", 10),
          cfgscale: parseFloat(process.env.SWARMUI_GUIDANCE_SCALE || "7.5"),
          width: parseInt(process.env.SWARMUI_WIDTH || "512", 10),
          height: parseInt(process.env.SWARMUI_HEIGHT || "512", 10),
          scheduler: process.env.SWARMUI_SCHEDULER || "normal",
          images: 1,
          donotsave: false,
          seed: -1,
        };

        if (process.env.SWARMUI_MODEL) {
          requestBody.model = process.env.SWARMUI_MODEL;
        }

        if (process.env.SWARMUI_SAMPLER) {
          requestBody.sampler = process.env.SWARMUI_SAMPLER;
        }

        // Call SwarmUI API
        const response = await fetch(`${baseUrl}/API/GenerateText2Image`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          throw new Error(`SwarmUI API error: ${response.status} ${response.statusText}`);
        }

        const result = (await response.json()) as SwarmUIGenerateResponse;

        // Handle errors
        if (result.error_id === 'invalid_session_id') {
          console.log('SwarmUI session expired, requesting new one');
          swarmSessionId = null;
          // Retry with new session
          const newSessionId = await getSwarmSession(baseUrl);
          const retryBody = { ...requestBody, session_id: newSessionId };

          const retryResponse = await fetch(`${baseUrl}/API/GenerateText2Image`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(retryBody),
          });

          if (!retryResponse.ok) {
            throw new Error(`SwarmUI API error: ${retryResponse.status} ${retryResponse.statusText}`);
          }

          const retryResult = (await retryResponse.json()) as SwarmUIGenerateResponse;

          if (retryResult.error) {
            throw new Error(`SwarmUI API error: ${retryResult.error}`);
          }

          if (!retryResult.images || retryResult.images.length === 0) {
            throw new Error('No images returned from SwarmUI API');
          }

          // Download and save image
          const imageUrl = `${baseUrl}/${retryResult.images[0]}`;
          const imageResponse = await fetch(imageUrl);

          if (!imageResponse.ok) {
            throw new Error(`Failed to download image: ${imageResponse.status}`);
          }

          const imageBuffer = await imageResponse.buffer();
          const fileName = `swarmui-image-${Date.now()}.png`;
          const imagePath = path.join(imageDir, fileName);
          writeFileSync(imagePath, imageBuffer);
          setLatestGenImg(imagePath);
          console.log(`Image saved as ${imagePath}`);
          return `${ToolReturnTag.Success}Image file saved.`;
        }

        if (result.error) {
          throw new Error(`SwarmUI API error: ${result.error}`);
        }

        if (!result.images || result.images.length === 0) {
          throw new Error('No images returned from SwarmUI API');
        }

        // Download and save image
        const imageUrl = `${baseUrl}/${result.images[0]}`;
        const imageResponse = await fetch(imageUrl);

        if (!imageResponse.ok) {
          throw new Error(`Failed to download image: ${imageResponse.status}`);
        }

        const imageBuffer = await imageResponse.buffer();
        const fileName = `swarmui-image-${Date.now()}.png`;
        const imagePath = path.join(imageDir, fileName);
        writeFileSync(imagePath, imageBuffer);
        setLatestGenImg(imagePath);
        console.log(`Image saved as ${imagePath}`);
        return `${ToolReturnTag.Success}Image file saved.`;
      } catch (error) {
        console.error("Error generating image with SwarmUI:", error);
        return `${ToolReturnTag.Error}Image generation failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  });
};
