# SwarmUI Image Generation Integration

This project now supports image generation using SwarmUI, a local/network-hosted image generation API.

## Configuration

To enable SwarmUI image generation, follow these steps:

### 1. Set Environment Variables

Create or update your `.env` file with the following configuration:

```env
# Enable SwarmUI as the image generation server
IMAGE_GENERATION_SERVER=swarmui

# SwarmUI API endpoint (adjust host/port as needed)
SWARMUI_BASE_URL=http://192.168.50.101:7801

# Optional: Specify the model to use (if not set, SwarmUI will use its default)
SWARMUI_MODEL=

# Generation parameters (all optional)
SWARMUI_STEPS=20                    # Number of steps (higher = better quality, slower)
SWARMUI_GUIDANCE_SCALE=7.5          # Guidance scale (how strictly to follow the prompt)
SWARMUI_WIDTH=512                   # Image width in pixels
SWARMUI_HEIGHT=512                  # Image height in pixels
SWARMUI_SCHEDULER=normal            # Scheduler type
SWARMUI_SAMPLER=                    # Sampler method (e.g., euler, heun, lms, dpmpp, etc.)
SWARMUI_POSITIVE_PROMPT_PREFIX=     # Text to prepend to all positive prompts
SWARMUI_NEGATIVE_PROMPT_PREFIX=     # Text to prepend to all negative prompts
```

### 2. SwarmUI Setup

Make sure you have a SwarmUI instance running and accessible at the URL specified in `SWARMUI_BASE_URL`. For example, if running on your network at `192.168.50.101:7801`, the configuration would be:

```env
SWARMUI_BASE_URL=http://192.168.50.101:7801
```

## Usage

Once configured, the chatbot will use SwarmUI for image generation when requested. The integration works the same way as other image generation providers:

- The bot can generate images from text prompts
- Images are saved locally and displayed
- The bot can reference and modify previously generated images

## API Details

The integration uses SwarmUI's `/API/GenerateText2Image` endpoint:

- **Endpoint**: `POST /API/GenerateText2Image`
- **Session Management**: Automatically handles session creation and refresh
- **Error Handling**: Automatically retries with a new session if the current one expires
- **Output**: Downloads and saves generated images locally

## Supported Parameters

All SwarmUI parameters are configurable via environment variables:

| Parameter | Environment Variable | Default | Description |
|-----------|----------------------|---------|-------------|
| Steps | `SWARMUI_STEPS` | 20 | Number of generation steps |
| Guidance Scale | `SWARMUI_GUIDANCE_SCALE` | 7.5 | How strictly to follow prompt |
| Width | `SWARMUI_WIDTH` | 512 | Output image width |
| Height | `SWARMUI_HEIGHT` | 512 | Output image height |
| Scheduler | `SWARMUI_SCHEDULER` | normal | Scheduler algorithm |
| Sampler | `SWARMUI_SAMPLER` | (auto) | Sampler method (e.g., euler, heun, lms, dpmpp) |
| Positive Prompt Prefix | `SWARMUI_POSITIVE_PROMPT_PREFIX` | (empty) | Text prepended to all positive prompts |
| Negative Prompt Prefix | `SWARMUI_NEGATIVE_PROMPT_PREFIX` | (empty) | Text prepended to all negative prompts |
| Model | `SWARMUI_MODEL` | (auto) | Specific model to use |

## Example Environment Configuration

```env
IMAGE_GENERATION_SERVER=swarmui
SWARMUI_BASE_URL=http://192.168.50.101:7801
SWARMUI_MODEL=OfficialStableDiffusion/sd_xl_base_1.0
SWARMUI_STEPS=30
SWARMUI_GUIDANCE_SCALE=8.0
SWARMUI_WIDTH=768
SWARMUI_HEIGHT=768
SWARMUI_SAMPLER=euler
SWARMUI_POSITIVE_PROMPT_SUFFIX=high quality, detailed
SWARMUI_NEGATIVE_PROMPT_SUFFIX=blurry, low quality
```

## Troubleshooting

### Connection Issues
- Verify the SwarmUI instance is running and accessible at the configured URL
- Check firewall settings if running on a network
- Ensure the port is correct (default 7801)

### Generation Failures
- Check SwarmUI logs for detailed error information
- Verify the model name is correct (if specified)
- Try with different generation parameters
- Ensure SwarmUI has available GPU/compute resources

### Performance
- Reduce `SWARMUI_STEPS` for faster generation (lower quality)
- Adjust `SWARMUI_WIDTH` and `SWARMUI_HEIGHT` for smaller/faster images
- Monitor SwarmUI instance resource usage
