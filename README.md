# Local Qwen scene routing

Image Generation includes an optional **Smart Qwen Mode**. It expects a local OpenAI-compatible chat-completions endpoint using a quantized `Qwen2-0.5B-Instruct` model.

Example with llama.cpp:

```powershell
llama-server.exe -m .\Qwen2-0.5B-Instruct-Q4_K_M.gguf --host 127.0.0.1 --port 8080 --ctx-size 2048 --threads 4 --n-gpu-layers 0
```

Use `http://127.0.0.1:8080/v1/chat/completions` in Smart Qwen settings. `--n-gpu-layers 0` keeps inference on CPU; use `--n-gpu-layers all` for GPU inference. The model only classifies RP text and selects batch-library metadata; it does not inspect generated images.

## NanoGPT inside ComfyUI

The repository includes a lightweight custom node at:

```text
comfyui_custom_nodes/ComfyUI-Megumin-NanoGPT
```

Copy that directory into `ComfyUI/custom_nodes/` and restart ComfyUI. Add **Megumin NanoGPT Text**, put `%ai_text%` in its `ai_text` widget, and connect its `text` output to the positive CLIP text encoder.

- `%prompt%` is the deterministic ready-to-render prompt.
- `%ai_text%` is an optional richer source package containing the RP scene and mandatory visual tags.
- Workflows without `%ai_text%` continue to work unchanged.

For safer key storage, set `NANOGPT_API_KEY` before starting ComfyUI instead of saving the key in workflow JSON.

## RunPod Serverless (Anima Turbo)

The included Docker build creates a `runpod/worker-comfyui` image with the repository-local `ComfyUI-Megumin-NanoGPT` node and Anima Turbo. The Qwen text encoder and VAE remain in the image because Anima Turbo needs them; no RI-MIX checkpoint or LoRAs are included.

Build the image through the `docker-image.yml` workflow, deploy the resulting GHCR image as a RunPod Serverless endpoint, then enable **Render with RunPod** in Megumin Suite and enter the endpoint ID and API key. Select `anima_nanogpt.json` as the workflow.

Set `NANOGPT_API_KEY` in the RunPod endpoint's environment variables. The bundled workflow intentionally leaves the node's `api_key` blank so it uses that environment variable instead of storing the key in the workflow sent by SillyTavern.

Megumin submits the worker's required request body:

```json
{ "input": { "workflow": { "...": "ComfyUI API workflow" } } }
```

It reads completed images from `output.images[]`, accepting the worker's `base64` and `s3_url` output types.

## RunPod Serverless (Krea 2 with runtime LoRAs)

`Dockerfile.krea2-runpod` and `.github/workflows/krea2-runpod-image.yml` build a separate Krea 2 image. It includes the Krea Turbo FP8 diffusion model, Qwen3-VL FP8 text encoder, Qwen VAE, Megumin's NanoGPT node, and the requested default Civitai LoRA (`megumin-default-civitai-3027612.safetensors`). The Krea core weights are large (the diffusion model is 13.1 GB and the FP8 text encoder is 5.24 GB), so use a GPU and disk configuration with enough headroom for the image and runtime cache.

To bake additional LoRAs into every worker, add entries to [data/krea2_baked_loras.json](data/krea2_baked_loras.json), then run the Krea image workflow again. This JSON array is the single source of truth for Docker and the Finder's **Baked** entries:

```json
[
  {
    "filename": "my-character.safetensors",
    "label": "My character",
    "url": "https://civitai.red/api/download/models/123?fileId=456"
  }
]
```

`filename` must be a unique `.safetensors` basename. A baked entry is downloaded at image-build time, shown in the Finder after the extension is refreshed, and selected by its local filename. It is different from a Malcolmrey **Runtime** entry, which is fetched from Hugging Face only when a worker needs it.

Before building, add the GitHub Actions repository secret **`CIVITAI_API_TOKEN`**. Keep baked NSFW LoRA URLs on **`civitai.red`**. The Dockerfile upgrades `comfy-cli` to `>=1.7.3` so `.red` is treated as Civitai and the token is attached normally. Hugging Face core weights and runtime LoRAs from `malcolmrey/krea2` need no token. On the RunPod endpoint, set **`NANOGPT_API_KEY`**.

1. Run **Build and Push Krea 2 RunPod Image**, then deploy `ghcr.io/<owner>/krea2-runpod:latest` as a new RunPod Serverless endpoint.
2. Import [krea2_runpod_runtime_lora.json](krea2_runpod_runtime_lora.json) into SillyTavern's Comfy workflows and select it. Set Image Style to **Krea 2 (Natural Prose)** and select `krea2_turbo_fp8_scaled.safetensors` in the RunPod model field.
3. In **LoRA Lab**, choose **Krea LoRA Finder**. It reads and revalidates Malcolmrey's public browser index each time it opens, and saves the selected `hf://malcolmrey/krea2/<filename>` reference in the exact slot you choose. The selection is profile-owned, persistent, and never overwritten by chat keyword matching or a panel refresh. The Finder also shows the entries from the baked-LoRA array above.

On a cold RunPod worker, the workflow's `Megumin Runtime LoRA Stack` downloads a selected LoRA from the allowlisted `malcolmrey/krea2` Hugging Face repository before loading it. The file is cached for the life of that worker; a new cold worker will download it again. The node rejects arbitrary repositories, path traversal, non-`.safetensors` files, and files above 1 GB. To intentionally use a different trusted repository, set `MEGUMIN_RUNTIME_LORA_REPOS` on the endpoint and update the extension constant in the same change.

The **Natural Language + Krea Runtime LoRA** analysis mode replaces the previous mixed Booru + Natural choice. It keeps Booru and natural modes available independently, migrates old mixed assignments into the natural store, and tells the Krea prompt step to use the repository's required `a woman` trigger once for every explicitly selected runtime identity.

# beta 17/05/26
* added full mamory manager change from Cohee/jina-embeddings-v2-base-en to Xenova/all-MiniLM-L6-v2 if you going to use Semantic Embeddings. i recommend only using the keywords its faster and do 90% like Semantic Embeddings.
* added NPC bank.
* added v7 core more balaned less edgy.
* some bug fixes.
# beta 11/05/26
* added CYOA cleanup.
# beta 30/04/26
* Fixes for GLM and DS4.
note: enable prefill only for Gemini.
# beta 26/04/26
* fixed multi thinking box with models like GLM and Deepseek.
* fixed thinking for GLM and DS 4.
* DeepSeek 4 support test.
* Dialogue & Narration Format toggle for better narration style adherence in some models recommended.
* fixed color charcater in DS4 *maybe*.
* added thinking effort control.
* you can now edit every thing inside dev mode i mean every thing all.
* added export/import to banlist. and fixed banlist ui.
* added thinking v2 in cot this give more freedom to the ai thinking while following the cot. only for gemini 3.1 pro and 3 flash. put <think> and </think> inside the Reasoning Formatting.
Note: use only english COT for deepseek 4.
# beta 23/04/26
* added Dream team v6 and v6 lite.
* fixed some under the hood stuff.
# beta 18/04/26
* change COT off now will remove <think>\n{Thinking}\n</think> so the ai will not be forced to use thinking.
* added Dialogue / Narration Ratio slider so now you can choose how mush narration you want (i know you dont like to read you dummy)
* added new "Precooked" styles for fast style pick.
* Added a filter bar (All, Precooked, AI Generators, My Library) to organize the style tab.
* added Megumin image for manual image gen.
* added token counter.
* added Cinematic Sounds (onomatopoeia) and animation toggle.
* added cleaning Function to clean character profile if the character was deleted.
* added Story Planner.
* fixed GLM error with banlist and image_gen.
* added Disable prefill to fix opus error when generating banlist or image_gen.
* new ui more clean, more modern for mobile and disktop.
* nanogpt not working for Rules and insight generating fixed.
* added apply Specific tab to all profile.
* some under the hood fixes for better rule Generating.
* added the ability to edit Custom User Engines right from the Core Engine menu.
* added the ability to use direct api call or Specific preset for image gen and bed list.
* Dev mode fixed and added:
  - The engine renaming and "Save Engine" bar now sticks to the top of the screen when you scroll through long prompt blocks.
  - Implemented a "Dirty State" tracker. If you edit an engine and try to click "Back," "Exit Dev," or "Close" without saving, a confirmation popup will warn you.
# beta 08/04/26
* added the ability to choose between no change or Default in dev mode COT.
# beta 06/04/26
* the button is fixed now (removed the draggable function).
* Optimized the ext.
# beta 06/04/26
* added new image gen stage.
* new and improved Dev mode.
# beta 02/04/26
* fixed a Stupid error from my side i forget to enable Forbid Overrides so some cards was changing the main prompts and making the output bad. use the new json files.
* added MVU Compatibility read here https://github.com/KritBlade/MVU_Game_Maker
# beta 01/04/26
* fixed some misspelling.
* redesigned the model tab to have more language options for the new v2 COT.
* **Completely Overhauled Stage 3 (Writing Style):** Redesigned the UI from a grid into a clean, full-width list layout.
* **Added Pre-Configured Templates:** Included 11 ready-to-use style templates (inspired by authors like George R.R. Martin, Stephen King, Jane Austen, etc.). You can now generate a complex rule directly from the library with one click!
* **Added "No Style" Toggle:** Placed a convenient "Off" option at the top of the style library to easily disable extra writing directives without deleting your saved profiles.

# beta 31/03/26
* added new test cot that aim for me NPCs agency and self goals.
* added v5 Slice of Reality mode New and improved balance mode that aim to use less token, more writing Creativity, better NPCs.
* added nora because why not.
# beta 30/03/26
* now the button is Draggable WOW
# Beta 29/03/26

**✨ New Features & Enhancements**
*   **Style Profile Library:** Transitioned from a single writing style configuration to a comprehensive Library. Users can now create, save, and manage multiple style profiles for different needs.
*   **Style Management:** Added quick-action buttons (**Regenerate, Edit, Delete**) to all style cards for faster workflow.
*   **Iterative AI Refinement:** Introduced a new 7th stage (Beta) designed for AI self-correction, allowing the model to identify and rectify its own systemic writing habits.
*   **Target Word Count Macro:** Added a new `[[count]]` macro in Stage 4 (Add-ons > Extra), allowing users to set specific maximum word counts for generated responses.
*   **Advanced CoT Framework:** Completely overhauled the Chain of Thought (`<think>`) logic in Stage 6 for improved reasoning and output quality.
*   **Multilingual Support:** Added full support for Japanese (日本語) within the Chain of Thought process.
*   **Output Language Optimization:** The engine now defaults to English if the "Language Output" field is left blank, effectively preventing CoT leakage into the final response.

**🛠️ Developer Tools & Safety**
*   **Global Dev Mode Toggle:** Introduced a global override switch. When enabled, saving or restoring a prompt override applies the change across all profiles (Characters, Groups, and Defaults) simultaneously.
*   **Prompt Safety Guard:** Implemented a fail-safe for the Global Dev Mode; `[[aiprompt]]` overrides are now restricted to local application to prevent the accidental erasure of unique style profiles.

**🐛 Bug Fixes & Optimizations**
*   **Group Chat Compatibility:** Resolved issues preventing the extension from detecting group chat environments.
*   **Stability Improvements:** Fixed a crash occurring when the "Generate Insights" button was triggered within the Style Editor during group chats.
**Under-the-Hood Preset Improvements**
Updated core prompting rules within `[[prompt3]]` to include:
*   Better introduction of new NPCs
*   Anti-passive voice enforcement
*   Enhanced living world dynamics
*   NPC agency prioritization
*   Scene continuation logic

# how to install:
[You know how to do it.](https://drive.google.com/file/d/16Ps0byP9zDDLJSX5fqNbFmq-DBTjPlMT/view)
