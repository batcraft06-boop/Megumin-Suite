/* eslint-disable no-undef */

export function createVisualGeneration(api) {
    const {
        extensionName,
        extensionFolderPath,
        TARGET_PRESET_NAME,
        getContext,
        getCharacterKey,
        saveProfileToMemory,
        useMeguminEngine,
        substituteParams,
        generateQuietPrompt,
        getRequestHeaders,
        saveChat,
        reloadCurrentChat,
        addOneMessage,
        appendMediaToMessage,
        saveBase64AsFile,
        humanizedDateTime,
        Popup,
        POPUP_TYPE,
        KAZUMA_PLACEHOLDERS,
        RESOLUTIONS,
        extension_settings,
        eventSource,
        event_types,
    } = api;

    const getLocalProfile = api.getLocalProfile;
    const SHOW_RUNPOD_IMAGE_BACKEND = true;
    const PS_BAD_STUFF_REGEX = globalThis.PS_BAD_STUFF_REGEX instanceof RegExp
        ? globalThis.PS_BAD_STUFF_REGEX
        : /$a/;

    let activeImageGenRequest = null;
    let activeLoraAssignRequest = null;
    let activeManualImageScene = null;
    const backgroundImageQueue = [];
    const backgroundOriginKeys = new Set();
    let backgroundImageWorkerActive = false;
    let backgroundActiveJob = null;
    let danbooruTagsMap = null;
    let danbooruCharacterSuggestions = null;
    let danbooruCharacterSuggestionsPromise = null;
    let civitaiKeywordCache = {};

    const NSFW_POSITION_PRESETS = [
        { label: "None", prompt: "" },
        { label: "Missionary", prompt: "missionary position, face-to-face intimacy, bodies close together, natural hip movement" },
        { label: "Cowgirl", prompt: "cowgirl position, partner on top, straddling hips, rhythmic motion, intimate eye contact" },
        { label: "Reverse Cowgirl", prompt: "reverse cowgirl position, partner on top facing away, arched back, rhythmic hip movement" },
        { label: "Doggy Style", prompt: "doggy style position, from-behind angle, hands on hips, dynamic thrusting motion" },
        { label: "Spooning", prompt: "spooning position, side-by-side bodies, intimate close contact, slow sensual movement" },
        { label: "Lotus", prompt: "lotus position, seated face-to-face embrace, legs wrapped, close kissing and grinding motion" },
        { label: "Standing", prompt: "standing position, bodies pressed together, lifted leg, passionate movement" },
        { label: "Against Wall", prompt: "against the wall position, pinned close together, one leg raised, urgent passionate motion" },
        { label: "Legs Over Shoulders", prompt: "legs over shoulders position, deep intimate angle, close body contact, rhythmic motion" },
        { label: "Mating Press", prompt: "mating press position, knees pushed up, intense close body contact, passionate thrusting" },
        { label: "Oral 69", prompt: "69 position, mutual pleasure, intertwined bodies, intimate sensual movement" },
        { label: "Blowjob", prompt: "blowjob, kneeling pose, intimate close-up, sensual mouth movement" },
        { label: "Deepthroat", prompt: "deepthroat, kneeling pose, intense intimate close-up, rhythmic mouth movement" },
        { label: "Face Sitting", prompt: "face sitting position, partner seated over face, intimate sensual movement" },
        { label: "Cunnilingus", prompt: "cunnilingus, thighs parted, intimate close-up, sensual licking motion" },
        { label: "Titfuck", prompt: "titfuck, breasts pressed around penis, intimate close-up, rhythmic sliding motion" },
        { label: "Footjob", prompt: "footjob, feet wrapped around penis, intimate close-up, rhythmic stroking motion" },
        { label: "Handjob", prompt: "handjob, hand wrapped around penis, intimate close-up, rhythmic stroking motion" },
        { label: "Fingering", prompt: "fingering, intimate close-up, hand between thighs, sensual finger motion" },
        { label: "Grinding", prompt: "clothed or nude grinding, hips pressed together, rhythmic friction, close body contact" },
        { label: "Lap Dance", prompt: "lap dance, straddling lap, teasing hip movement, intimate close body contact" },
        { label: "Riding Face", prompt: "riding face, thighs around head, partner on top, intimate sensual movement" },
        { label: "Standing Oral", prompt: "standing oral position, kneeling partner, intimate close-up, sensual mouth movement" },
        { label: "Anal", prompt: "intimate from-behind angle, close body contact, rhythmic thrusting motion" },
        { label: "Double Penetration", prompt: "double penetration, three adult participants, intense close body contact, synchronized rhythmic motion" },
        { label: "Threesome", prompt: "threesome, three adult participants, intertwined bodies, shared intimate motion" },
        { label: "Paizuri POV", prompt: "paizuri, first-person perspective, breasts pressed around penis, rhythmic sliding motion" }
    ];

    const DEFAULT_BACKGROUND_AUTOMATION = {
        autoEnabled: false,
        autoTriggerMode: "explicit",
        autoRandomChance: 20,
        cooldownReplies: 3,
        smartEnabled: false,
        qwenUrl: "http://127.0.0.1:8080/v1/chat/completions",
        qwenModel: "Qwen2-0.5B-Instruct",
        qwenTimeoutMs: 30000,
        qwenMinConfidence: 0.7,
        smartSearchLibrary: true,
        smartGenerateFallback: true,
        qwenStatus: "Idle",
        qwenStatusAt: 0,
        lastProcessedRevisionKey: "",
        lastProcessedMessageIndex: -1,
        batchEnabled: false,
        panelOpen: false,
        queuePaused: false,
        batchPositions: ["Missionary", "Cowgirl", "Doggy Style", "Spooning", "Blowjob", "Cunnilingus"],
        batchMaleAnatomy: "huge",
        batchImagesPerGroup: 1,
        batchLibraryOpen: false,
        library: [],
        lastAutoAiCount: 0
    };

    function ensureBackgroundAutomationSettings(s) {
        if (!s.backgroundAutomation || typeof s.backgroundAutomation !== "object") {
            s.backgroundAutomation = JSON.parse(JSON.stringify(DEFAULT_BACKGROUND_AUTOMATION));
        }
        for (const [key, value] of Object.entries(DEFAULT_BACKGROUND_AUTOMATION)) {
            if (s.backgroundAutomation[key] === undefined) {
                s.backgroundAutomation[key] = Array.isArray(value) ? [...value] : value;
            }
        }
        if (!Array.isArray(s.backgroundAutomation.batchPositions)) s.backgroundAutomation.batchPositions = [...DEFAULT_BACKGROUND_AUTOMATION.batchPositions];
        if (!Array.isArray(s.backgroundAutomation.library)) s.backgroundAutomation.library = [];
        return s.backgroundAutomation;
    }

    function getBatchLibraryFilename(item) {
        if (item?.filename) return String(item.filename);
        const url = String(item?.url || "").split(/[?#]/)[0];
        const name = url.split(/[\\/]/).filter(Boolean).pop();
        return name || item?.id || "unnamed image";
    }

    function getBatchLibraryPrimaryCharacter(item) {
        return String(item?.primaryCharacter || item?.characters?.[0] || "Unknown character");
    }

    function buildBatchLibraryInventoryHtml(automation) {
        const batchItems = automation.library.filter(item => item?.source === "batch" || item?.batchKey);
        if (!batchItems.length) {
            return '<div style="font-size:.7rem; color:var(--text-muted); padding:10px; text-align:center;">No batch images generated yet.</div>';
        }
        const groups = new Map();
        for (const item of batchItems) {
            const character = getBatchLibraryPrimaryCharacter(item);
            const position = String(item.position || "Uncategorized");
            if (!groups.has(character)) groups.set(character, new Map());
            const positionGroups = groups.get(character);
            if (!positionGroups.has(position)) positionGroups.set(position, []);
            positionGroups.get(position).push(item);
        }
        return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([character, positions]) => `
            <details style="border:1px solid var(--border-color); border-radius:7px; background:rgba(0,0,0,.14);">
                <summary style="cursor:pointer; padding:9px 10px; font-size:.73rem; font-weight:800;">${psEscapeText(character)} <span style="color:var(--text-muted); font-weight:500;">(${[...positions.values()].reduce((n, items) => n + items.length, 0)})</span></summary>
                <div style="padding:0 9px 9px; display:flex; flex-direction:column; gap:7px;">
                    ${[...positions.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([position, items]) => `
                        <div style="border:1px solid rgba(255,255,255,.07); border-radius:7px; padding:8px;">
                            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:6px;">
                                <span style="font-size:.7rem; font-weight:800; color:#c084fc;">${psEscapeText(position)} <span style="color:var(--text-muted); font-weight:500;">(${items.length})</span></span>
                                <div style="display:flex; gap:5px;">
                                    <button type="button" class="ps-modern-btn secondary ig-batch-group-add" data-character="${psEscapeAttr(character)}" data-position="${psEscapeAttr(position)}" style="padding:4px 9px; font-size:.65rem;"><i class="fa-solid fa-plus"></i> Add ${Math.max(1, parseInt(automation.batchImagesPerGroup, 10) || 1)}</button>
                                    <button type="button" class="ps-modern-btn secondary ig-batch-group-delete" data-character="${psEscapeAttr(character)}" data-position="${psEscapeAttr(position)}" title="Remove this group from the Batch Library index. Saved files remain on disk." style="padding:4px 8px; font-size:.65rem; color:#ef4444;"><i class="fa-solid fa-trash"></i></button>
                                </div>
                            </div>
                            <div style="display:flex; flex-direction:column; gap:3px;">
                                ${items.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).map(item => `
                                    <div style="display:flex; align-items:center; gap:6px; min-width:0;">
                                        <span title="${psEscapeAttr(item.url || "")}" style="flex:1; min-width:0; font-family:Consolas,monospace; font-size:.65rem; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${psEscapeText(getBatchLibraryFilename(item))}</span>
                                        <button type="button" class="ig-batch-item-delete" data-library-id="${psEscapeAttr(item.id || "")}" title="Remove from Batch Library index. Saved file remains on disk." style="border:0; background:transparent; color:#ef4444; cursor:pointer; padding:2px 4px;"><i class="fa-solid fa-xmark"></i></button>
                                    </div>
                                `).join("")}
                            </div>
                        </div>
                    `).join("")}
                </div>
            </details>
        `).join("");
    }

    function refreshBatchLibraryInventory() {
        const s = getLocalProfile()?.imageGen;
        if (!s) return;
        const automation = ensureBackgroundAutomationSettings(s);
        $("#ig_bg_batch_library_body").html(buildBatchLibraryInventoryHtml(automation));
        $("#ig_bg_batch_library_count").text(`${automation.library.filter(item => item?.source === "batch" || item?.batchKey).length} images`);
    }

    const IMAGE_SCENE_FIDELITY_INSTRUCTION = "Scene fidelity: derive the image from the latest visible moment in the chat, not a generic mood. Preserve who is present, subject count, body placement, role/orientation, pose, contact points, clothing/nudity state, expression, camera angle, and setting. For adult/NSFW scenes, name the specific position or act when it is present in the chat or Extra field, and use concrete visual staging instead of vague terms like intimate, sensual, passionate, or suggestive. Do not swap to an unrelated pose, solo portrait, pinup, or aftermath unless the chat actually says so.";

    const IMAGE_ADULT_TAG_PRECISION_INSTRUCTION = "Adult tag precision: if the scene is explicit and all visible participants are adults, use direct visual tags and concrete staging instead of euphemisms. Use exact terms when they match the scene: naked, nude, topless, exposed nipples, erection, hetero, sex, vaginal, anal, oral, fellatio, cunnilingus, paizuri, straddling, riding, missionary, doggystyle, cowgirl position, moaning, open mouth, tongue out, flushed face, heavy breathing, trembling, saliva, sweat, cum, ejaculation, facial, cum inside. Do not add an explicit act that is not present in the chat or Extra field.";
    const IMAGE_ADULT_PROSE_PRECISION_INSTRUCTION = "Adult prose precision: if the scene is explicit and all visible participants are adults, use direct natural-language visual description and concrete staging instead of euphemisms or tag dumps. Describe only the anatomy, contact, expression, fluids, body placement, camera angle, and visible action that are actually present in the chat or Extra field. Do not add an explicit act that is not present.";
    const IMAGE_BODY_SHAPE_POSITIVE_INSTRUCTION = "Body-shape guidance for natural-language image prompts: use positive silhouette words instead of body-size negation. Unless a character card, chat, or user feedback explicitly defines a fuller build, adult female characters should be described with an attractive slender-curvy or slim hourglass figure: narrow waist, graceful neck and shoulders, slender arms, toned or softly fit stomach, proportionate soft hips and thighs, and elegant facial features. Treat mature as adult age or confidence, not body size; prefer adult woman or woman in her late 20s/30s over mature female. Do not output body-size negations or insult words.";

    const KREA2_PROMPT_INSTRUCTION = "Krea 2 natural-language format: output one detailed, render-ready English image prompt in fluent prose, usually one dense paragraph. Krea responds well to natural language and long prompts, so describe the visible scene concretely instead of emitting Danbooru tag soup. Treat the image as a photograph: open with phrasing such as 'A photo of' plus camera feel when useful. Never call it a digital illustration, anime, drawing, 2d, cartoon, render, or similar non-photo medium. Then describe the visible adult subject count, each subject's identity, body, face, hair, clothing or nudity state, placement, pose, expression, and current action. For multiple visible characters, give each person a separate sentence with spatial labels such as left, right, foreground, background, above, below, behind, kneeling, seated, or standing so features do not bleed. Use stored character natural descriptions and booru cues as appearance references, but translate all shorthand into prose. Finish with setting, background, lighting, lens/focus, color palette, and texture. If the current scene is explicit and all visible participants are adults, use direct NSFW visual language for the actual act, anatomy, contact, penetration/oral/manual action, fluids, expression, and body placement when present; do not euphemize explicit content and do not add an unrelated sex act. Do not use underscore tokens, 1girl-style shorthand, raw tag lists, quality-score tags, or generic filler. " + IMAGE_BODY_SHAPE_POSITIVE_INSTRUCTION + " Output contract: your entire response must be the single finished renderable image prompt. Begin immediately with the prompt itself. Never output analysis, scene notes, extracted details, requirements, plans, drafts, refinements, self-talk, explanations, labels such as Draft or Final Prompt, or a second version of the prompt. Do not describe what you are about to write and do not comment after writing it.";

    const KREA2_FORBIDDEN_MINOR_RE = /\b(?:child(?:ren)?|kids?|toddlers?|infants?|bab(?:y|ies)|minors?|underage|pre[ -]?teens?|teens?|teenagers?|teenaged?|adolescents?|juveniles?|child[ -]?like|young[ -]?looking|loli(?:con)?|shota(?:con)?|school[ -]?(?:girl|boy))\b/i;
    const KREA2_UNDER_18_AGE_RE = /\b(?:age[ :]*|aged[ ]+)?(?:[0-9]|1[0-7])[ -]?(?:years?[ -]?old|y\/?o)\b/i;
    const KREA2_SPELLED_UNDER_18_AGE_RE = /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen)[ -]years?[ -]old\b/i;

    function findKrea2ForbiddenMinorTerm(prompt) {
        const normalized = String(prompt || "").replace(/[_-]+/g, " ");
        const forbiddenMatch = normalized.match(KREA2_FORBIDDEN_MINOR_RE);
        if (forbiddenMatch) return forbiddenMatch[0];
        const ageMatch = normalized.match(KREA2_UNDER_18_AGE_RE);
        if (ageMatch) return ageMatch[0];
        const spelledAgeMatch = normalized.match(KREA2_SPELLED_UNDER_18_AGE_RE);
        return spelledAgeMatch ? spelledAgeMatch[0] : "";
    }

    function blockForbiddenKrea2Prompt(prompt) {
        const forbidden = findKrea2ForbiddenMinorTerm(prompt);
        if (!forbidden) return false;
        $("#kazuma_progress_overlay").hide();
        toastr.error(`Krea 2 prompt blocked: forbidden minor-related wording detected (${forbidden}).`);
        console.warn("[Megumin Suite] Krea 2 minor guard blocked generated input:", forbidden);
        return true;
    }

    const KREA2_PROMPT_EXAMPLES = `Formatting references only. Never copy their people, appearance, clothing, setting, or acts into another scene; derive the actual content from the current chat and character analysis.

A photo of two adults in a modern bedroom, shot in warm natural window light. The adult woman on the bed is described with her analyzed face, hair, body type, clothing or nudity state, pose, expression, and visible arousal. The adult man is placed separately with his body position and visible anatomy described clearly. Their exact contact, penetration or oral/manual action, fluids if present, and body placement are named directly. The rumpled sheets, background furniture, warm window light, shallow depth of field, and photographic skin texture complete the prompt.

A photo of one adult woman, framed as a close erotic portrait. Describe her stable analyzed appearance in prose: age bracket as adult, face, eyes, hair, body shape, skin, clothing or nudity state, expression, gaze, pose, hands, and the immediate setting. If the scene is explicit, state the exposed anatomy, arousal cues, fluids, or contact visible in the current moment. Finish with camera distance, lighting, lens, and color mood.

A photo from first-person POV across rumpled sheets. The foreground includes only the player's visible hands or body parts when the scene requires interaction, never the player's full face. The adult character facing the camera is described from the selected character analysis, with clear posture, expression, nudity/clothing state, exact adult action, visible contact points, and the bedroom lighting and lens focus.

For a spatially complex explicit scene, keep the prompt in prose but include a final clarifying sentence for the exact act, position, camera angle, and contact direction. Do not switch into a raw comma-separated tag list.`;

    function isNaturalLanguageImageStyle(style) {
        return style === "sdxl" || style === "krea2";
    }

    function buildImagePromptStructureRules(s, booruStd = false) {
        const style = s?.promptStyle || "standard";
        const perspective = s?.promptPerspective || "scene";
        const proseMode = isNaturalLanguageImageStyle(style) || booruStd;
        const modeLabel = perspective === "pov" ? "POV" : (perspective === "character" ? "portrait" : "cinematic scene");
        const outputType = proseMode ? "natural-language image prompt" : "comma-separated image prompt";
        const characterRule = proseMode
            ? "For multiple visible characters, dedicate a separate sentence to each character with clear spatial labels such as left, center, right, foreground, or behind. Keep each character's hair, eyes, body, clothing, expression, and action attached to that character only."
            : "For multiple visible characters, separate each character clearly with spatial labels such as left, center, right, foreground, or behind. Keep each character's appearance tags, expression, and action grouped together to prevent feature bleeding.";
        const perspectiveRule = perspective === "pov"
            ? "Establish first-person camera placement first. If the player is only observing, use an environmental foreground anchor; if the player is physically interacting, include visible hands/body cues only for the interaction. Do not invent the player's face."
            : (perspective === "character"
                ? "Keep the prompt focused on a single character portrait unless the chat clearly demands more people. Prioritize face, hair, body, clothing, expression, gaze, and simple background."
                : "Establish shot type, camera angle, subject count, pose/contact, environment, and lighting in that order.");
        const openerRule = style === "krea2"
            ? "photographic opener such as 'A photo of' (never digital illustration, anime, drawing, 2d, or cartoon), camera/perspective"
            : "quality/style anchor, camera/perspective";
        return `Structured prompt rules (${modeLabel}): write a ${outputType}. Build it in this order: ${openerRule}, visible character count, per-character appearance and current action, then setting and lighting. ${perspectiveRule} ${characterRule}`;
    }

    function buildImagePromptExamples(s, booruStd = false) {
        const style = s?.promptStyle || "standard";
        const perspective = s?.promptPerspective || "scene";
        const proseMode = isNaturalLanguageImageStyle(style) || booruStd;
        if (style === "krea2" && perspective === "pov") {
            return KREA2_PROMPT_EXAMPLES;
        }
        if (style === "krea2" && perspective === "character") {
            return KREA2_PROMPT_EXAMPLES;
        }
        if (style === "krea2") {
            return KREA2_PROMPT_EXAMPLES;
        }
        if (proseMode && perspective === "pov") {
            return "Example shape: A masterpiece in first-person point of view. The camera looks across rumpled sheets in the foreground toward two adult characters. On the left, [character A appearance, clothing/nudity state, expression, and action]. On the right, [character B appearance, clothing/nudity state, expression, and action]. The bedroom background, warm low lighting, and visible contact points match the current scene.";
        }
        if (proseMode && perspective === "character") {
            return "Example shape: A masterpiece portrait of one adult character. Describe age bracket, gender, species if relevant, skin, eyes, hair, body type, clothing or nudity state, expression, gaze, and a simple background with portrait lighting.";
        }
        if (proseMode) {
            return "Example shape: A cinematic masterpiece. A [shot type] shows [visible adult character count] in [setting]. The left character is described in one complete sentence. The right character is described in a separate complete sentence. Finish with pose/contact, environment, lighting, and mood from the exact scene.";
        }
        if (perspective === "pov") {
            return "Example shape: masterpiece, best quality, highly detailed, 1st person pov, foreground sheets visible, 1boy 1girl, left character: adult woman, [appearance tags], [expression], [action], foreground hands visible only if interacting, bedroom background, warm lighting, depth of field";
        }
        if (perspective === "character") {
            return "Example shape: masterpiece, best quality, highly detailed, portrait, upper body, 1girl, adult woman, [hair tags], [eye tags], [body tags], [clothing or nudity state], [expression], looking at viewer, simple background, soft lighting";
        }
        return "Example shape: masterpiece, best quality, highly detailed, cinematic composition, medium shot, 1boy 1girl, left character: adult man, [appearance tags], [expression], [action], right character: adult woman, [appearance tags], [expression], [action], exact pose/contact from scene, bedroom background, dramatic lighting";
    }

    function appendImagePromptInstruction(base, addition) {
        const text = String(addition || "").trim();
        if (!text) return base || "None";
        const current = base && base !== "None" ? String(base).trim() : "";
        return current ? `${current}\n${text}` : text;
    }

    function getAdultPrecisionInstruction(s) {
        return isNaturalLanguageImageStyle(s?.promptStyle) || isBooruStandardImageMode(s, s?.loraIntel)
            ? IMAGE_ADULT_PROSE_PRECISION_INSTRUCTION
            : IMAGE_ADULT_TAG_PRECISION_INSTRUCTION;
    }

    function escapeRegex(string) { return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    function ensureImageLeadPrefix(rawPrompt) {
        const s = getLocalProfile()?.imageGen;
        const raw = String(rawPrompt ?? "").trim();
        if (/^tags\s*:/i.test(raw)) return raw;
        let p = sanitizePromptTags(raw).trim();
        if (!s || !s.enabled) return p;
        const lead = buildBooruStandardTagLead(s, s.loraIntel);
        if (!lead) return p;
        const esc = escapeRegex(lead);
        if (new RegExp(`^${esc}\\s*,\\s*`).test(p) || p === lead) return p;
        return `${lead}, ${p}`;
    }

    async function loadDanbooruTags() {
        if (danbooruTagsMap) return danbooruTagsMap;
        try {
            const res = await fetch(`${extensionFolderPath}/tags.csv`);
            const text = await res.text();
            danbooruTagsMap = new Map();
            const lines = text.split('\n');
            for (const line of lines) {
                const firstComma = line.indexOf(',');
                if (firstComma === -1) continue;
                const tag = line.substring(0, firstComma).trim();
                if (tag) {
                    const rest = line.substring(firstComma + 1);
                    const parts = rest.split(',');
                    danbooruTagsMap.set(tag, {
                        category: parts[0] || '0',
                        count: parseInt(parts[1]) || 0,
                        aliases: parts.slice(2).join(',').replace(/"/g, '').trim()
                    });
                }
            }
            console.log(`[Megumin Suite] Loaded ${danbooruTagsMap.size} Danbooru tags.`);
            return danbooruTagsMap;
        } catch (e) {
            console.error('[Megumin Suite] Failed to load tags.csv:', e);
            return new Map();
        }
    }

    function parseDanbooruCsvLine(line) {
        const fields = [];
        let current = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i += 1;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (ch === "," && !inQuotes) {
                fields.push(current);
                current = "";
            } else {
                current += ch;
            }
        }
        fields.push(current);
        return fields;
    }

    async function loadDanbooruCharacterSuggestions() {
        if (danbooruCharacterSuggestions) return danbooruCharacterSuggestions;
        if (danbooruCharacterSuggestionsPromise) return danbooruCharacterSuggestionsPromise;

        danbooruCharacterSuggestionsPromise = (async () => {
            try {
                const res = await fetch(`${extensionFolderPath}/danbooru_character.csv`);
                const text = await res.text();
                const rows = [];
                const lines = text.split(/\r?\n/);
                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i];
                    if (!line) continue;
                    const cols = parseDanbooruCsvLine(line);
                    const character = String(cols[0] || "").trim();
                    if (!character) continue;
                    const copyright = String(cols[1] || "").trim();
                    const trigger = String(cols[2] || "").trim();
                    const coreTags = String(cols[3] || "").trim();
                    const count = parseInt(cols[4], 10) || 0;
                    const searchText = [character, copyright, trigger]
                        .filter(Boolean)
                        .join(" ")
                        .toLowerCase()
                        .replace(/[_()]+/g, " ")
                        .replace(/\s+/g, " ")
                        .trim();
                    rows.push({ character, copyright, trigger, coreTags, count, searchText });
                }
                danbooruCharacterSuggestions = rows;
                console.log(`[Megumin Suite] Loaded ${rows.length} Danbooru character suggestions.`);
                return rows;
            } catch (e) {
                console.error('[Megumin Suite] Failed to load danbooru_character.csv:', e);
                danbooruCharacterSuggestions = [];
                return danbooruCharacterSuggestions;
            }
        })();

        return danbooruCharacterSuggestionsPromise;
    }

    function findDanbooruCharacterSuggestions(query, limit = 8) {
        const rows = danbooruCharacterSuggestions || [];
        const q = String(query || "").trim().toLowerCase();
        if (q.length < 2 || rows.length === 0) return [];
        const tagQuery = q.replace(/\s+/g, "_");
        const textQuery = q.replace(/[_()]+/g, " ").replace(/\s+/g, " ").trim();
        const results = [];

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            let score = -1;
            if (row.character === tagQuery) score = 0;
            else if (row.character.startsWith(tagQuery)) score = 1;
            else if (row.searchText.startsWith(textQuery)) score = 2;
            else if (row.character.includes(tagQuery)) score = 3;
            else if (row.searchText.includes(textQuery)) score = 4;
            if (score < 0) continue;
            results.push({ row, score, index: i });
            if (results.length >= 60) break;
        }

        return results
            .sort((a, b) => a.score - b.score || b.row.count - a.row.count || a.index - b.index)
            .slice(0, limit)
            .map(r => r.row);
    }

    const BANNED_PROMPT_WORDS = ['loli', 'teenage', 'teenager', 'child', 'underage', 'minor'];

    function sanitizePromptTags(promptText) {
        if (!promptText) return "";
        const tags = promptText.split(',').map(t => t.trim()).filter(t => t);
        const cleaned = tags.filter(tag => {
            const lower = tag.toLowerCase().replace(/\s+/g, '_');
            if (BANNED_PROMPT_WORDS.some(bw => lower.includes(bw))) return false;
            return true;
        });
        return cleaned.join(', ');
    }

    function escapeLiteralComfyParentheses(text) {
        return String(text ?? "").replace(/[()]/g, (match, offset, source) => {
            return offset > 0 && source[offset - 1] === '\\' ? match : `\\${match}`;
        });
    }

    function normalizeAnimaGeneratedTag(rawTag) {
        let tag = String(rawTag ?? "").trim().toLowerCase();
        if (!tag) return "";

        const weightedMatch = tag.match(/^\((.*):([0-9]+(?:\.[0-9]+)?)\)$/);
        if (weightedMatch) {
            const inner = weightedMatch[1].trim().replace(/_/g, ' ');
            return `(${escapeLiteralComfyParentheses(inner)}:${weightedMatch[2]})`;
        }

        if (/^score_[1-9]$/.test(tag)) return tag;

        tag = tag.replace(/_/g, ' ');
        return escapeLiteralComfyParentheses(tag);
    }

    function normalizeAnimaGeneratedTags(tagString) {
        if (!tagString || typeof tagString !== 'string') return tagString || "";
        const tags = tagString.split(',').map(normalizeAnimaGeneratedTag).filter(t => t);
        return tags.join(', ');
    }

    function getAnimaMaxTags(s) {
        const raw = parseInt(s?.animaMaxTags);
        if (!Number.isFinite(raw) || raw <= 0) return 0;
        return Math.min(Math.max(raw, 5), 300);
    }

    function limitAnimaPromptTags(tagString, s, li) {
        const maxTags = getAnimaMaxTags(s);
        if (!maxTags || !tagString || typeof tagString !== 'string') return tagString || "";
        if (isNaturalLanguageImageStyle(s?.promptStyle) || isBooruStandardImageMode(s, li)) return tagString;

        const seen = new Set();
        const tags = tagString
            .split(',')
            .map(t => t.trim())
            .filter(t => t)
            .filter(tag => {
                const key = tag.toLowerCase();
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });

        if (tags.length <= maxTags) return tags.join(', ');
        return tags.slice(0, maxTags).join(', ');
    }

    function normalizeGeneratedTagField(tagString) {
        return normalizeAnimaGeneratedTags(sanitizePromptTags(tagString || ""));
    }

    function parseMatchKeywords(matchKeywords) {
        if (!matchKeywords || typeof matchKeywords !== 'string') return [];
        const seen = new Set();
        return matchKeywords
            .split(',')
            .map(k => k.trim().toLowerCase())
            .filter(k => k)
            .map(k => k.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim())
            .filter(k => {
                if (!k || seen.has(k)) return false;
                seen.add(k);
                return true;
            });
    }

    function normalizeTextForKeywordMatching(text) {
        return String(text || "")
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    }

    function keywordAppearsInText(keyword, normalizedText) {
        const kw = parseMatchKeywords(keyword).join(' ');
        if (!kw || !normalizedText) return false;
        const tokens = kw.split(' ').map(escapeRegex).filter(Boolean);
        if (tokens.length === 0) return false;
        const phrase = tokens.join('[\\s_\\-]+');
        return new RegExp(`(^|[^\\p{L}\\p{N}])${phrase}(?=$|[^\\p{L}\\p{N}])`, 'u').test(normalizedText);
    }

    function assignmentMatchesRecentChat(a, recentChat, allowEmptyMatch = true) {
        if (a?.neverInclude) return false;
        if (a?.alwaysInclude) return true;
        const kws = parseMatchKeywords(a?.match_keywords);
        if (kws.length === 0) return allowEmptyMatch;
        const normalizedText = normalizeTextForKeywordMatching(recentChat);
        return kws.some(kw => keywordAppearsInText(kw, normalizedText));
    }

    function ensureStructuredCharacterAssignment(a) {
        if (!a || typeof a !== 'object') return a;
        if (a.character === undefined && a.name !== undefined) a.character = a.name;
        if (a.match_keywords === undefined && a.aliases !== undefined) {
            a.match_keywords = Array.isArray(a.aliases) ? a.aliases.join(", ") : a.aliases;
        }
        if (a.booru_tags === undefined) a.booru_tags = a.danbooru_tags || a.tags || "";
        if (a.character_tag === undefined) a.character_tag = a.danbooru_character_tag || a.identity_tag || "";
        if (a.series_tag === undefined) a.series_tag = a.danbooru_series_tag || a.franchise_tag || "";
        if (a.physical_tags === undefined) a.physical_tags = a.body_tags || a.appearance_tags || a.booru_tags || "";
        if (a.clothing_tags === undefined) a.clothing_tags = a.outfit_tags || a.clothes_tags || "";
        if (a.plain_description === undefined) a.plain_description = "";
        if (a.alwaysInclude === undefined) a.alwaysInclude = false;
        if (a.neverInclude === undefined) a.neverInclude = false;
        if (a.neverInclude) a.alwaysInclude = false;
        if (!a.tagFieldToggles) a.tagFieldToggles = {};
        getTagFieldToggleDefaults().forEach(({ key }) => {
            if (a.tagFieldToggles[key] === undefined) a.tagFieldToggles[key] = true;
        });
        return a;
    }

    function getTagFieldToggleDefaults() {
        return [
            { key: "characterTag", label: "Char" },
            { key: "seriesTag", label: "Series" },
            { key: "physicalTags", label: "Phys" },
            { key: "clothingTags", label: "Clothes" }
        ];
    }

    function ensureLoraIntelDefaults(li) {
        if (!li) return;
        if (!Array.isArray(li.globalActiveLoras)) li.globalActiveLoras = [];
        if (!li.characterActiveLoras || typeof li.characterActiveLoras !== "object") li.characterActiveLoras = {};
        if (!li.characterAssignments || typeof li.characterAssignments !== "object") li.characterAssignments = {};
        if (!li.characterAssignmentsByMode || typeof li.characterAssignmentsByMode !== "object") li.characterAssignmentsByMode = {};
        ["booru", "description", "both", "shared"].forEach(mode => {
            if (!li.characterAssignmentsByMode[mode] || typeof li.characterAssignmentsByMode[mode] !== "object") {
                li.characterAssignmentsByMode[mode] = {};
            }
        });
        li.ensureLoras = false;
        if (li.useDanbooruTags === undefined) li.useDanbooruTags = true;
        if (li.useCharDescriptions === undefined) li.useCharDescriptions = false;
        // The old "both" mode mixed raw Booru tags into a Krea-oriented
        // description workflow. Migrate it once to the dedicated prose +
        // runtime-LoRA mode, while retaining the old assignment store for export.
        if (li.naturalLoraMode === undefined) {
            li.naturalLoraMode = !!(li.useDanbooruTags && li.useCharDescriptions);
        }
        if (li.naturalLoraMode) {
            li.useDanbooruTags = false;
            li.useCharDescriptions = true;
        }
        if (li.ensureCharacterTag === undefined) li.ensureCharacterTag = false;
        li.descriptionStyle = 'natural';
        if (li.promptAssemblyMode === undefined) li.promptAssemblyMode = 'structured';
        if (li.assignmentViewMode === undefined) li.assignmentViewMode = 'structured';
        if (li.sendAllCharactersToPromptAi === undefined) li.sendAllCharactersToPromptAi = false;
        if (li.lastCharacterAnalysisResponse === undefined) li.lastCharacterAnalysisResponse = "";
        if (li.characterAnalysisFeedback === undefined) li.characterAnalysisFeedback = "";
        if (li.compiledPromptOverride === undefined) li.compiledPromptOverride = "";
        if (!li.tagFieldToggles) li.tagFieldToggles = {};
        const defaults = {};
        getTagFieldToggleDefaults().forEach(({ key }) => { defaults[key] = true; });
        Object.keys(defaults).forEach(key => {
            if (li.tagFieldToggles[key] === undefined) li.tagFieldToggles[key] = defaults[key];
        });
    }

    function normalizeStructuredCharacterAssignment(a) {
        ensureStructuredCharacterAssignment(a);
        if (!a || typeof a !== 'object') return a;

        ['booru_tags', 'character_tag', 'series_tag', 'physical_tags', 'clothing_tags'].forEach(key => {
            if (a[key]) a[key] = normalizeGeneratedTagField(a[key]);
        });

        const mergedTags = [
            a.character_tag,
            a.series_tag,
            a.physical_tags,
            a.clothing_tags
        ].filter(Boolean).join(', ');

        a.booru_tags = mergedTags || normalizeGeneratedTagField(a.booru_tags || "");
        if (!a.plain_description) {
            a.plain_description = mergedTags || a.description || "";
        }
        return a;
    }

    function ensureStructuredCharacterAssignments(li, charKey = null) {
        if (!li) return;
        ensureLoraIntelDefaults(li);
        const normalizeStore = (store) => {
            const keys = charKey ? [charKey] : Object.keys(store || {});
            keys.forEach(key => {
                if (!Array.isArray(store[key])) return;
                store[key].forEach(ensureStructuredCharacterAssignment);
            });
        };
        normalizeStore(li.characterAssignments);
        Object.values(li.characterAssignmentsByMode || {}).forEach(normalizeStore);
    }

    function getCharacterAssignmentModeKey(li) {
        if (!li) return "shared";
        if (li.useDanbooruTags && li.useCharDescriptions) return "both";
        if (li.useDanbooruTags) return "booru";
        if (li.useCharDescriptions) return "description";
        return "shared";
    }

    function getModeCharacterAssignmentStore(li, modeKey = null) {
        ensureLoraIntelDefaults(li);
        const key = modeKey || getCharacterAssignmentModeKey(li);
        if (!li.characterAssignmentsByMode[key]) li.characterAssignmentsByMode[key] = {};
        return li.characterAssignmentsByMode[key];
    }

    function getModeCharacterAssignments(li, charKey, modeKey = null) {
        if (!li) return [];
        ensureLoraIntelDefaults(li);
        const store = getModeCharacterAssignmentStore(li, modeKey);
        if (!Array.isArray(store[charKey])) {
            const effectiveModeKey = modeKey || getCharacterAssignmentModeKey(li);
            const anyModeAlreadyHasCharacter = Object.values(li.characterAssignmentsByMode || {})
                .some(modeStore => Array.isArray(modeStore?.[charKey]));
            const legacyMixedAssignments = effectiveModeKey === "description" && li.naturalLoraMode
                && Array.isArray(li.characterAssignmentsByMode?.both?.[charKey])
                ? JSON.parse(JSON.stringify(li.characterAssignmentsByMode.both[charKey]))
                : null;
            const legacy = !anyModeAlreadyHasCharacter && Array.isArray(li.characterAssignments?.[charKey])
                ? JSON.parse(JSON.stringify(li.characterAssignments[charKey]))
                : [];
            store[charKey] = legacyMixedAssignments || legacy;
        }
        store[charKey].forEach(ensureStructuredCharacterAssignment);
        if (!li.characterAssignments || typeof li.characterAssignments !== "object") li.characterAssignments = {};
        li.characterAssignments[charKey] = store[charKey];
        return store[charKey];
    }

    function setModeCharacterAssignments(li, charKey, assignments, modeKey = null) {
        ensureLoraIntelDefaults(li);
        const store = getModeCharacterAssignmentStore(li, modeKey);
        store[charKey] = Array.isArray(assignments) ? assignments.map(ensureStructuredCharacterAssignment) : [];
        if (!li.characterAssignments || typeof li.characterAssignments !== "object") li.characterAssignments = {};
        li.characterAssignments[charKey] = store[charKey];
        return store[charKey];
    }

    function countModeCharacterAssignments(li, charKey, modeKey = null) {
        return getModeCharacterAssignments(li, charKey, modeKey).length;
    }

    function getAssignmentModeLabel(li) {
        const key = getCharacterAssignmentModeKey(li);
        if (key === "booru") return "Booru Tags";
        if (key === "description") return li.naturalLoraMode ? "Natural + Krea Runtime LoRA" : "Natural";
        if (key === "both") return "Booru + Natural";
        return "Shared";
    }

    function syncCurrentModeCharacterAssignments(li, charKey) {
        getModeCharacterAssignments(li, charKey);
        ensureStructuredCharacterAssignments(li, charKey);
    }

    function buildCharacterAnalysisSnapshot(li, charKey, scope = "global") {
        ensureLoraIntelDefaults(li);
        ensureStructuredCharacterAssignments(li, charKey);
        const mode = getCharacterAssignmentModeKey(li);
        return {
            schema: "megumin-character-analysis",
            version: 1,
            exportedAt: new Date().toISOString(),
            sourceCharacterKey: charKey,
            mode,
            settings: {
                ensureLoras: false,
                useDanbooruTags: !!li.useDanbooruTags,
                ensureCharacterTag: !!li.ensureCharacterTag,
                useCharDescriptions: !!li.useCharDescriptions,
                naturalLoraMode: !!li.naturalLoraMode,
                descriptionStyle: li.descriptionStyle,
                promptAssemblyMode: li.promptAssemblyMode,
                assignmentViewMode: li.assignmentViewMode,
                sendAllCharactersToPromptAi: !!li.sendAllCharactersToPromptAi,
                tagFieldToggles: JSON.parse(JSON.stringify(li.tagFieldToggles || {}))
            },
            assignmentMode: getCharacterAssignmentModeKey(li),
            assignments: JSON.parse(JSON.stringify(getModeCharacterAssignments(li, charKey))),
            lastCharacterAnalysisResponse: li.lastCharacterAnalysisResponse || "",
            characterAnalysisFeedback: li.characterAnalysisFeedback || ""
        };
    }

    function applyCharacterAnalysisSnapshot(li, charKey, payload) {
        if (!payload || payload.schema !== "megumin-character-analysis" || payload.version !== 1) {
            throw new Error("This is not a supported Megumin character-analysis snapshot.");
        }
        if (!Array.isArray(payload.assignments)) throw new Error("Snapshot assignments are missing or invalid.");
        ensureLoraIntelDefaults(li);

        const settings = payload.settings && typeof payload.settings === "object" ? payload.settings : {};
        ["ensureLoras", "useDanbooruTags", "ensureCharacterTag", "useCharDescriptions", "naturalLoraMode", "sendAllCharactersToPromptAi"].forEach(key => {
            if (typeof settings[key] === "boolean") li[key] = settings[key];
        });
        ["descriptionStyle", "promptAssemblyMode", "assignmentViewMode"].forEach(key => {
            if (typeof settings[key] === "string" && settings[key]) li[key] = settings[key];
        });
        if (settings.tagFieldToggles && typeof settings.tagFieldToggles === "object") {
            li.tagFieldToggles = { ...li.tagFieldToggles, ...settings.tagFieldToggles };
        }

        const assignments = JSON.parse(JSON.stringify(payload.assignments));
        assignments.forEach(ensureStructuredCharacterAssignment);
        setModeCharacterAssignments(li, charKey, assignments);

        li.lastCharacterAnalysisResponse = typeof payload.lastCharacterAnalysisResponse === "string"
            ? payload.lastCharacterAnalysisResponse
            : "";
        li.characterAnalysisFeedback = typeof payload.characterAnalysisFeedback === "string"
            ? payload.characterAnalysisFeedback
            : "";
        return { count: assignments.length, mode: payload.mode || "snapshot" };
    }

    function downloadCharacterAnalysisSnapshot(li, charKey, scope) {
        const snapshot = buildCharacterAnalysisSnapshot(li, charKey, scope);
        const safeKey = String(charKey || "character").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "character";
        const link = document.createElement("a");
        const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" }));
        link.href = url;
        link.download = `megumin-character-analysis-${safeKey}-${snapshot.mode}.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    function psEscapeAttr(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    function psEscapeText(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    const RUNPOD_IMAGE_DEFAULTS = {
        enabled: false,
        endpointId: "",
        apiKey: "",
        pollIntervalMs: 1000,
        timeoutMs: 600000,
        defaultKreaLoraApplied: false
    };
    const RUNPOD_ANIMA_MODEL = "anima-turbo-v1.0.safetensors";
    const RUNPOD_ANIMA_BASE_MODEL = "anima-base-v1.0.safetensors";
    const RUNPOD_KREA_MODEL = "krea2_turbo_fp8_scaled.safetensors";
    const RUNPOD_ANIMA_MODELS = [RUNPOD_ANIMA_MODEL, RUNPOD_ANIMA_BASE_MODEL];
    const RUNPOD_IMAGE_MODELS = [...RUNPOD_ANIMA_MODELS, RUNPOD_KREA_MODEL];
    const RUNPOD_SLOT_DEFINITIONS = {
        krea2: { label: "Krea 2", model: RUNPOD_KREA_MODEL, promptStyle: "krea2" },
        anima: { label: "Anima", model: RUNPOD_ANIMA_MODEL, promptStyle: "standard" }
    };
    // Stock ComfyUI KSampler sampler/scheduler names (base install). RunPod
    // Image Gen cannot query the worker at dropdown time, so keep these explicit.
    const RUNPOD_IMAGE_SAMPLERS = [
        "euler", "euler_cfg_pp", "euler_ancestral", "euler_ancestral_cfg_pp",
        "heun", "heunpp2", "dpm_2", "dpm_2_ancestral", "lms", "dpm_fast", "dpm_adaptive",
        "dpmpp_2s_ancestral", "dpmpp_2s_ancestral_cfg_pp", "dpmpp_sde", "dpmpp_sde_gpu",
        "dpmpp_2m", "dpmpp_2m_cfg_pp", "dpmpp_2m_sde", "dpmpp_2m_sde_gpu",
        "dpmpp_3m_sde", "dpmpp_3m_sde_gpu", "ddpm", "lcm", "ipndm", "ipndm_v", "deis",
        "ddim", "uni_pc", "uni_pc_bh2", "er_sde",
        "res_multistep", "res_multistep_cfg_pp", "res_multistep_ancestral", "res_multistep_ancestral_cfg_pp",
        "gradient_estimation", "gradient_estimation_cfg_pp", "sa_solver", "sa_solver_pece"
    ];
    const RUNPOD_IMAGE_SCHEDULERS = [
        "simple", "normal", "karras", "exponential", "sgm_uniform", "ddim_uniform",
        "beta", "linear_quadratic", "kl_optimal"
    ];
    // This is baked into Dockerfile.krea2-runpod. Remote browser selections are
    // represented as hf:// references and are intentionally kept in the profile.
    const MEGUMIN_DEFAULT_KREA_LORA = "megumin-default-civitai-3027612.safetensors";
    const RUNPOD_IMAGE_LORAS = [MEGUMIN_DEFAULT_KREA_LORA];
    const KREA_BAKED_LORA_MANIFEST_URL = `${extensionFolderPath}/data/krea2_baked_loras.json`;
    const ANIMA_BAKED_LORA_MANIFEST_URL = `${extensionFolderPath}/data/anima_baked_loras.json`;
    const MALCOLMREY_BROWSER_INDEX_URL = "https://huggingface.co/spaces/malcolmrey/browser/resolve/main/data-filenames.json";
    const MALCOLMREY_KREA_REPOSITORY = "malcolmrey/krea2";
    let malcolmreyKreaLoraCache = null;
    let malcolmreyKreaLoraLoad = null;
    let bakedKreaLoraCache = null;
    let bakedKreaLoraLoad = null;
    let bakedAnimaLoraCache = null;
    let bakedAnimaLoraLoad = null;
    let meguminComfyLoraCache = null;
    let meguminComfyLoraCacheUrl = "";
    let runpodAnimaLoraNames = null;
    let runpodKreaLoraNames = null;
    const RUNPOD_IMAGE_MODEL_ALIASES = {
        "rimixillustriousanima_rimixanima.safetensors": "anima-turbo-v1.0.safetensors",
        "ri-mix-illustrious-anima.safetensors": "anima-turbo-v1.0.safetensors",
        "krea2_turbo_fp8.safetensors": "krea2_turbo_fp8_scaled.safetensors"
    };

    function normalizeRunpodModelFilename(modelName) {
        const current = String(modelName || "").trim();
        if (!current) return "";
        const basename = current.replace(/\\/g, "/").split("/").pop().toLowerCase();
        return RUNPOD_IMAGE_MODEL_ALIASES[basename] || current;
    }

    function isRunpodAnimaModel(modelName) {
        return RUNPOD_ANIMA_MODELS.includes(normalizeRunpodModelFilename(modelName));
    }

    function getRunpodGlobalSettings() {
        if (!extension_settings[extensionName]) extension_settings[extensionName] = {};
        if (!extension_settings[extensionName].runpod || typeof extension_settings[extensionName].runpod !== "object") {
            extension_settings[extensionName].runpod = { endpointId: "", apiKey: "" };
        }
        const runpod = extension_settings[extensionName].runpod;
        const legacyEndpointId = String(runpod.endpointId || "").trim();
        const legacyApiKey = String(runpod.apiKey || "").trim();
        if (!runpod.slots || typeof runpod.slots !== "object" || Array.isArray(runpod.slots)) {
            // Preserve the existing single-endpoint setup as the Krea 2 slot.
            runpod.slots = {
                krea2: { endpointId: legacyEndpointId, apiKey: legacyApiKey },
                anima: { endpointId: "", apiKey: "" }
            };
        }
        Object.keys(RUNPOD_SLOT_DEFINITIONS).forEach(slotId => {
            const slot = runpod.slots[slotId];
            if (!slot || typeof slot !== "object" || Array.isArray(slot)) runpod.slots[slotId] = {};
            runpod.slots[slotId].endpointId = String(runpod.slots[slotId].endpointId || "").trim();
            runpod.slots[slotId].apiKey = String(runpod.slots[slotId].apiKey || "").trim();
        });
        if (!RUNPOD_SLOT_DEFINITIONS[runpod.activeSlot]) runpod.activeSlot = "krea2";
        const activeSlot = runpod.slots[runpod.activeSlot];
        // Keep these legacy mirrors so existing profile code and saved settings
        // continue to use whichever slot is active.
        runpod.endpointId = activeSlot.endpointId;
        runpod.apiKey = activeSlot.apiKey;
        return runpod;
    }

    function getRunpodActiveSlotSettings() {
        const runpod = getRunpodGlobalSettings();
        return runpod.slots[runpod.activeSlot];
    }

    function selectRunpodSlot(s, slotId) {
        if (!RUNPOD_SLOT_DEFINITIONS[slotId]) return null;
        const runpod = getRunpodGlobalSettings();
        runpod.activeSlot = slotId;
        const slot = getRunpodActiveSlotSettings();
        runpod.endpointId = slot.endpointId;
        runpod.apiKey = slot.apiKey;
        if (s?.runpod) {
            s.runpod.endpointId = slot.endpointId;
            s.runpod.apiKey = slot.apiKey;
        }
        if (s && s.selectedModel !== RUNPOD_SLOT_DEFINITIONS[slotId].model) {
            s.selectedModel = RUNPOD_SLOT_DEFINITIONS[slotId].model;
        }
        if (s && s.promptStyle !== RUNPOD_SLOT_DEFINITIONS[slotId].promptStyle) {
            s.promptStyle = RUNPOD_SLOT_DEFINITIONS[slotId].promptStyle;
        }
        return slot;
    }

    function ensureRunpodSettings(s) {
        if (!s) return RUNPOD_IMAGE_DEFAULTS;
        if (!s.runpod || typeof s.runpod !== "object") s.runpod = {};
        let globalRunpod = getRunpodGlobalSettings();
        const activeSlot = getRunpodActiveSlotSettings();
        if (!activeSlot.endpointId && s.runpod.endpointId) activeSlot.endpointId = String(s.runpod.endpointId || "").trim();
        if (!activeSlot.apiKey && s.runpod.apiKey) activeSlot.apiKey = String(s.runpod.apiKey || "").trim();
        globalRunpod = getRunpodGlobalSettings();
        Object.keys(RUNPOD_IMAGE_DEFAULTS).forEach(key => {
            if (s.runpod[key] === undefined) s.runpod[key] = RUNPOD_IMAGE_DEFAULTS[key];
        });
        s.runpod.enabled = !!s.runpod.enabled;
        s.runpod.endpointId = globalRunpod.endpointId;
        s.runpod.apiKey = globalRunpod.apiKey;
        s.runpod.pollIntervalMs = Math.max(500, parseInt(s.runpod.pollIntervalMs, 10) || RUNPOD_IMAGE_DEFAULTS.pollIntervalMs);
        s.runpod.timeoutMs = Math.max(30000, parseInt(s.runpod.timeoutMs, 10) || RUNPOD_IMAGE_DEFAULTS.timeoutMs);
        return s.runpod;
    }

    function isRunpodReady(s) {
        if (!SHOW_RUNPOD_IMAGE_BACKEND) return false;
        const runpod = ensureRunpodSettings(s);
        return !!(runpod.enabled && runpod.endpointId && runpod.apiKey);
    }

    // -------------------------------------------------------------
    // PROMPT WRITER (client-side)
    // -------------------------------------------------------------
    // The image prompt is generated HERE, in the browser, before any render
    // job is submitted. This is deliberate:
    //  1. worker-comfyui only returns images from RunPod jobs -- text node
    //     outputs are dropped, so a prompt generated inside the workflow can
    //     never be shown to the user. Generating it client-side means the
    //     user always sees (and can edit) the exact prompt that renders.
    //  2. An LLM call inside the workflow burns billed GPU seconds while the
    //     worker idles. Client-side costs zero GPU time.
    //  3. Failures become visible immediately instead of silently rendering
    //     a junk fallback after a full GPU cold start.
    // The in-workflow MeguminNanoGPTText node remains as a fallback path when
    // the direct call is unavailable (no key, CORS, network error).
    const NANOGPT_PROMPT_ENDPOINT = "https://nano-gpt.com/api/v1/chat/completions";
    const NANOGPT_DEFAULT_PROMPT_MODEL = "zai-org/glm-5";
    const OPENROUTER_PROMPT_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
    const OPENROUTER_DEFAULT_PROMPT_MODEL = "openai/gpt-4.1-mini";
    const NANOGPT_DEFAULT_PROMPT_TEMPERATURE = 0.2;

    function getNanoGptGlobalSettings() {
        if (!extension_settings[extensionName]) extension_settings[extensionName] = {};
        if (!extension_settings[extensionName].nanogpt || typeof extension_settings[extensionName].nanogpt !== "object") {
            extension_settings[extensionName].nanogpt = { apiKey: "", model: NANOGPT_DEFAULT_PROMPT_MODEL, temperature: NANOGPT_DEFAULT_PROMPT_TEMPERATURE };
        }
        const nano = extension_settings[extensionName].nanogpt;
        nano.apiKey = String(nano.apiKey || "").trim();
        nano.model = String(nano.model || "").trim() || NANOGPT_DEFAULT_PROMPT_MODEL;
        const temp = parseFloat(nano.temperature);
        nano.temperature = Number.isFinite(temp) ? Math.max(0, Math.min(2, temp)) : NANOGPT_DEFAULT_PROMPT_TEMPERATURE;
        return nano;
    }

    function getOpenRouterGlobalSettings() {
        if (!extension_settings[extensionName]) extension_settings[extensionName] = {};
        if (!extension_settings[extensionName].openrouter || typeof extension_settings[extensionName].openrouter !== "object") {
            extension_settings[extensionName].openrouter = { apiKey: "", model: OPENROUTER_DEFAULT_PROMPT_MODEL, temperature: NANOGPT_DEFAULT_PROMPT_TEMPERATURE };
        }
        const openrouter = extension_settings[extensionName].openrouter;
        openrouter.apiKey = String(openrouter.apiKey || "").trim();
        openrouter.model = String(openrouter.model || "").trim() || OPENROUTER_DEFAULT_PROMPT_MODEL;
        const temp = parseFloat(openrouter.temperature);
        openrouter.temperature = Number.isFinite(temp) ? Math.max(0, Math.min(2, temp)) : NANOGPT_DEFAULT_PROMPT_TEMPERATURE;
        return openrouter;
    }

    function getPromptWriterSettings() {
        if (!extension_settings[extensionName]) extension_settings[extensionName] = {};
        const provider = extension_settings[extensionName].promptWriterProvider === "openrouter" ? "openrouter" : "nanogpt";
        const config = provider === "openrouter" ? getOpenRouterGlobalSettings() : getNanoGptGlobalSettings();
        return {
            provider,
            label: provider === "openrouter" ? "OpenRouter" : "NanoGPT",
            endpoint: provider === "openrouter" ? OPENROUTER_PROMPT_ENDPOINT : NANOGPT_PROMPT_ENDPOINT,
            ...config
        };
    }

    function getActivePromptWriterConfig() {
        return getPromptWriterSettings().provider === "openrouter"
            ? getOpenRouterGlobalSettings()
            : getNanoGptGlobalSettings();
    }

    /**
     * Direct browser call to the selected provider. Returns the generated prompt string, or
     * null when unavailable/failed (caller decides the fallback). Never throws.
     */
    async function callPromptWriter(systemPrompt, userText) {
        const writer = getPromptWriterSettings();
        if (!writer.apiKey) return null;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 45000);
        try {
            const response = await fetch(writer.endpoint, {
                method: "POST",
                signal: controller.signal,
                headers: {
                    "Authorization": `Bearer ${writer.apiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: writer.model,
                    temperature: writer.temperature,
                    max_tokens: 500,
                    stream: false,
                    messages: [
                        { role: "system", content: String(systemPrompt || "").trim() },
                        { role: "user", content: String(userText || "").trim() }
                    ]
                })
            });
            if (!response.ok) {
                const body = await response.text().catch(() => "");
                console.warn(`[Megumin Suite] ${writer.label} prompt writer HTTP ${response.status}:`, body.slice(0, 300));
                return null;
            }
            const data = await response.json();
            const raw = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? "";
            const text = stripUtilityThinkingWrapper(raw);
            return text && text.trim() ? text.trim() : null;
        } catch (e) {
            console.warn(`[Megumin Suite] ${writer.label} prompt writer call failed:`, e?.message || e);
            return null;
        } finally {
            clearTimeout(timer);
        }
    }

    function ensureSelectHasOptions($select, options, currentValue, emptyLabel = null) {
        $select.empty();
        if (emptyLabel !== null) $select.append($("<option></option>").attr("value", "").text(emptyLabel));
        const seen = new Set();
        options.forEach(option => {
            const value = String(option || "").trim();
            if (!value || seen.has(value)) return;
            seen.add(value);
            $select.append($("<option></option>").attr("value", value).text(value));
        });
        const current = String(currentValue || "").trim();
        if (current && !seen.has(current)) {
            $select.append($("<option></option>").attr("value", current).text(`${current} (saved)`));
        }
        $select.val(current || "");
    }

    function ensureRunpodDropdownValues(s) {
        if (!s) return false;
        let changed = false;
        const normalizedModel = normalizeRunpodModelFilename(s.selectedModel);
        if (normalizedModel !== s.selectedModel) {
            s.selectedModel = normalizedModel;
            changed = true;
        }
        if (!RUNPOD_IMAGE_MODELS.includes(s.selectedModel) && RUNPOD_IMAGE_MODELS[0]) {
            s.selectedModel = RUNPOD_IMAGE_MODELS[0];
            changed = true;
        }
        if (!s.selectedSampler && RUNPOD_IMAGE_SAMPLERS[0]) {
            s.selectedSampler = RUNPOD_IMAGE_SAMPLERS[0];
            changed = true;
        }
        if (!s.selectedScheduler && RUNPOD_IMAGE_SCHEDULERS[0]) {
            s.selectedScheduler = RUNPOD_IMAGE_SCHEDULERS[0];
            changed = true;
        }
        // Do not clear these slots. They are explicit user choices and may be
        // hf:// runtime references which a normal ComfyUI filename scan cannot see.
        if (s.selectedModel === RUNPOD_KREA_MODEL && !s.runpod.defaultKreaLoraApplied) {
            if (!s.selectedLora) {
                s.selectedLora = MEGUMIN_DEFAULT_KREA_LORA;
                changed = true;
            }
            s.runpod.defaultKreaLoraApplied = true;
            changed = true;
        }
        return changed;
    }

    function getRunpodLoraOptionsForModel(s, animaBaked = [], kreaBaked = []) {
        if (isRunpodAnimaModel(s?.selectedModel)) return [...animaBaked];
        if (normalizeRunpodModelFilename(s?.selectedModel) === RUNPOD_KREA_MODEL) {
            return [...RUNPOD_IMAGE_LORAS, ...kreaBaked];
        }
        return [...RUNPOD_IMAGE_LORAS, ...animaBaked, ...kreaBaked];
    }

    function rememberRunpodBakedLoraNames(animaBaked, kreaBaked) {
        if (Array.isArray(animaBaked)) runpodAnimaLoraNames = animaBaked;
        if (Array.isArray(kreaBaked)) runpodKreaLoraNames = kreaBaked;
    }

    function populateRunpodImageLists(s, animaBaked, kreaBaked) {
        const animaNames = Array.isArray(animaBaked) ? animaBaked : (runpodAnimaLoraNames || []);
        const kreaNames = Array.isArray(kreaBaked) ? kreaBaked : (runpodKreaLoraNames || []);
        if (Array.isArray(animaBaked) || Array.isArray(kreaBaked)) rememberRunpodBakedLoraNames(animaNames, kreaNames);
        ensureRunpodDropdownValues(s);
        ensureSelectHasOptions($("#ig_model"), RUNPOD_IMAGE_MODELS, s.selectedModel, "-- Select Model --");
        ensureSelectHasOptions($("#ig_sampler"), RUNPOD_IMAGE_SAMPLERS, s.selectedSampler);
        ensureSelectHasOptions($("#ig_scheduler"), RUNPOD_IMAGE_SCHEDULERS, s.selectedScheduler);
        const loraOptions = getRunpodLoraOptionsForModel(s, animaNames, kreaNames);
        for (let i = 1; i <= 4; i++) {
            ensureSelectHasOptions($(`#ig_lora_${i}`), loraOptions, s[i === 1 ? "selectedLora" : `selectedLora${i}`], "-- No LoRA --");
        }
        if (SHOW_RUNPOD_IMAGE_BACKEND && ensureRunpodSettings(s).enabled) {
            meguminComfyLoraCache = loraOptions;
            meguminComfyLoraCacheUrl = "runpod";
        }
    }

    let danbooruAliasMap = null;

    function ensureDanbooruAliasMap() {
        if (danbooruAliasMap) return danbooruAliasMap;
        if (!danbooruTagsMap || danbooruTagsMap.size === 0) return null;
        danbooruAliasMap = new Map();
        for (const [canonical, data] of danbooruTagsMap) {
            if (data.aliases) {
                const aliasList = data.aliases.split(',').map(a => a.trim().toLowerCase().replace(/\s+/g, '_')).filter(a => a);
                for (const alias of aliasList) {
                    danbooruAliasMap.set(alias, canonical);
                }
            }
        }
        return danbooruAliasMap;
    }

    function repairBooruTags(tagString) {
        if (!tagString || typeof tagString !== 'string') return tagString || "";
        if (!danbooruTagsMap || danbooruTagsMap.size === 0) return tagString;

        const aliasMap = ensureDanbooruAliasMap();

        const tags = tagString.split(',').map(t => t.trim()).filter(t => t);
        const repaired = tags.map(rawTag => {
            const normalized = rawTag.toLowerCase().replace(/\s+/g, '_');
            if (danbooruTagsMap.has(normalized)) return normalized;
            if (aliasMap && aliasMap.has(normalized)) return aliasMap.get(normalized);
            return normalized;
        });

        return repaired.join(', ');
    }

    function getCanonicalDanbooruTag(rawTag) {
        const normalized = String(rawTag || "")
            .trim()
            .toLowerCase()
            .replace(/\\/g, "")
            .replace(/\s+/g, "_");
        if (!normalized || !danbooruTagsMap || danbooruTagsMap.size === 0) return normalized;
        if (danbooruTagsMap.has(normalized)) return normalized;
        const aliasMap = ensureDanbooruAliasMap();
        return aliasMap?.get(normalized) || normalized;
    }

    function findDanbooruTagByCategory(tagString, category) {
        if (!tagString || !danbooruTagsMap || danbooruTagsMap.size === 0) return "";
        const desired = String(category);
        const tags = String(tagString).split(',').map(t => t.trim()).filter(Boolean);
        for (const tag of tags) {
            const canonical = getCanonicalDanbooruTag(tag);
            if (danbooruTagsMap.get(canonical)?.category === desired) return canonical;
        }
        return "";
    }

    function getVerifiedBooruCharacterTag(tagString) {
        if (!tagString) return "";
        if (!danbooruTagsMap || danbooruTagsMap.size === 0) {
            return normalizeGeneratedTagField(tagString).split(',').map(t => t.trim()).filter(Boolean)[0] || "";
        }
        const verified = findDanbooruTagByCategory(tagString, "4");
        return verified ? normalizeGeneratedTagField(verified) : "";
    }

    function ensureBooruCharacterTag(a) {
        ensureStructuredCharacterAssignment(a);
        const rawCharacterTag = getVerifiedBooruCharacterTag(a.character_tag);
        if ((!danbooruTagsMap || danbooruTagsMap.size === 0) && rawCharacterTag) {
            a.character_tag = rawCharacterTag;
            return true;
        }
        const existing = getVerifiedBooruCharacterTag(a.character_tag);
        const candidate = existing
            || findDanbooruTagByCategory(a.booru_tags, "4");
        if (candidate) {
            a.character_tag = normalizeGeneratedTagField(candidate);
            return true;
        }
        a.character_tag = "";
        return false;
    }

    // -------------------------------------------------------------
    // CIVITAI KEYWORD FETCHER
    // -------------------------------------------------------------
    const LORA_TRIGGER_ONLY_IDENTITIES = new Set([
        "sandy cheeks",
        "kate middleton"
    ]);

    const LORA_AMBIGUOUS_IDENTITY_GENDERS = new Map([
        ["alex jones", "man"]
    ]);

    function getVrtlLoraIdentityKeywords(loraFilename) {
        const basename = String(loraFilename || "")
            .replace(/\\/g, "/")
            .split("/")
            .pop()
            .replace(/\.(safetensors|ckpt|pt|bin)$/i, "")
            .replace(/\(\d+\)\s*$/i, "")
            .trim();
        const triggers = [...basename.matchAll(/\bvrtl[\w-]+\b/gi)].map(m => m[0]);
        if (triggers.length === 0) return null;

        const uniqueTriggers = [...new Map(triggers.map(t => [t.toLowerCase(), t])).values()];
        const mainTrigger = uniqueTriggers.find(t => /^vrtlmain$/i.test(t));
        if (mainTrigger) return [mainTrigger];
        if (uniqueTriggers.length > 1) return uniqueTriggers;

        const triggerGroupIndex = basename.search(/\([^)]*\bvrtl/i);
        const identityName = (triggerGroupIndex >= 0 ? basename.slice(0, triggerGroupIndex) : "")
            .replace(/^ZI\s+/i, "")
            .trim();
        const trigger = uniqueTriggers[0];
        if (!identityName || LORA_TRIGGER_ONLY_IDENTITIES.has(identityName.toLowerCase())) return [trigger];

        const gender = LORA_AMBIGUOUS_IDENTITY_GENDERS.get(identityName.toLowerCase());
        return [`${identityName} (${trigger})${gender ? `, ${gender}` : ""}`];
    }

    function ensureImageGenLoraArrays(s) {
        if (!s) return;
        if (!Array.isArray(s.loraSlotLocked) || s.loraSlotLocked.length !== 4) {
            s.loraSlotLocked = [false, false, false, false];
        }
        if (!Array.isArray(s.loraSlotKeywordManaged) || s.loraSlotKeywordManaged.length !== 4) {
            s.loraSlotKeywordManaged = [false, false, false, false];
        }
    }

    function igCloneLoraSlotArray(value) {
        return Array.isArray(value) ? value.slice(0, 4) : [false, false, false, false];
    }

    function igBuildWorkflowStateSnapshot(s) {
        ensureImageGenLoraArrays(s);
        return {
            selectedModel: s.selectedModel, selectedSampler: s.selectedSampler, selectedScheduler: s.selectedScheduler, steps: s.steps, cfg: s.cfg, denoise: s.denoise, clipSkip: s.clipSkip,
            imgWidth: s.imgWidth, imgHeight: s.imgHeight, customSeed: s.customSeed, customNegative: s.customNegative,
            promptStyle: s.promptStyle, promptPerspective: s.promptPerspective, promptExtra: s.promptExtra, animaMaxTags: s.animaMaxTags, standardBooruLeadTags: s.standardBooruLeadTags, loraTriggers: s.loraTriggers, previewPrompt: s.previewPrompt, manualPromptSource: s.manualPromptSource,
            structuredPromptRules: s.structuredPromptRules, adultTagPrecision: s.adultTagPrecision, includePromptExamples: s.includePromptExamples,
            manualSceneSelector: s.manualSceneSelector,
            selectedLora: s.selectedLora, selectedLoraWt: s.selectedLoraWt,
            selectedLora2: s.selectedLora2, selectedLoraWt2: s.selectedLoraWt2,
            selectedLora3: s.selectedLora3, selectedLoraWt3: s.selectedLoraWt3,
            selectedLora4: s.selectedLora4, selectedLoraWt4: s.selectedLoraWt4,
            loraSlotLocked: igCloneLoraSlotArray(s.loraSlotLocked),
            loraSlotKeywordManaged: igCloneLoraSlotArray(s.loraSlotKeywordManaged)
        };
    }

    function igNormalizeWorkflowStateSnapshot(workflowState) {
        const out = { ...(workflowState || {}) };
        if (Array.isArray(out.loraSlotLocked)) out.loraSlotLocked = igCloneLoraSlotArray(out.loraSlotLocked);
        if (Array.isArray(out.loraSlotKeywordManaged)) out.loraSlotKeywordManaged = igCloneLoraSlotArray(out.loraSlotKeywordManaged);
        return out;
    }

    function setupImageGenCollapsibleSections(s) {
        const states = s.sectionOpenStates;
        $("[data-ig-collapse]").each(function() {
            const $panel = $(this);
            const key = String($panel.attr("data-ig-collapse") || "").trim();
            if (!key || $panel.data("ig-collapse-ready")) return;

            let $header = $panel.children("[data-ig-collapse-header]").first();
            if (!$header.length) $header = $panel.children(".ps-rule-title").first();
            if (!$header.length) return;

            const $bodyChildren = $panel.children().not($header);
            if (!$bodyChildren.length) return;
            $bodyChildren.wrapAll(`<div class="ig-collapsible-section-body" data-ig-collapse-body="${psEscapeAttr(key)}"></div>`);
            const $body = $panel.children(`[data-ig-collapse-body="${key}"]`);
            const isOpen = states[key] === true;

            $panel.data("ig-collapse-ready", true);
            $header.css({
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "10px",
                cursor: "pointer",
                userSelect: "none",
                marginBottom: "0"
            });
            $header.append(`<i class="fa-solid fa-chevron-down ig-section-chevron" aria-hidden="true" style="margin-left:auto; color:var(--text-muted); font-size:.72rem; transition:transform .2s; transform:${isOpen ? "rotate(180deg)" : "none"};"></i>`);
            $body.css({ marginTop: "12px", display: isOpen ? "block" : "none" });

            $header.on("click.igCollapse", function(event) {
                if ($(event.target).closest("button,input,select,textarea,a,.ps-toggle-card").length) return;
                const nextOpen = !$body.is(":visible");
                states[key] = nextOpen;
                saveProfileToMemory();
                $header.find(".ig-section-chevron").css("transform", nextOpen ? "rotate(180deg)" : "none");
                $body.stop(true, true)[nextOpen ? "slideDown" : "slideUp"](180);
            });
        });
    }

    function renderImageGen(c) {
        c.empty();
        const s = getLocalProfile().imageGen;
        ensureImageGenLoraArrays(s);
        const runpod = ensureRunpodSettings(s);
        const runpodGlobal = getRunpodGlobalSettings();
        const promptWriter = getPromptWriterSettings();
        if (s.standardBooruLeadTags === undefined) s.standardBooruLeadTags = "";
        if (s.loraTriggers === undefined) s.loraTriggers = "";
        if (s.promptExtra === undefined) s.promptExtra = "";
        if (s.structuredPromptRules === undefined) s.structuredPromptRules = true;
        if (s.adultTagPrecision === undefined) s.adultTagPrecision = true;
        if (s.includePromptExamples === undefined) s.includePromptExamples = false;
        if (s.selectedScheduler === undefined) s.selectedScheduler = "simple";
        if (s.manualSceneSelector === undefined) s.manualSceneSelector = false;
        if (s.manualPromptSource === undefined) s.manualPromptSource = "comfy_llm";
        if (s.promptStyle === "zimage") s.promptStyle = "krea2";
        if (!s.sectionOpenStates || typeof s.sectionOpenStates !== "object" || Array.isArray(s.sectionOpenStates)) s.sectionOpenStates = {};

        // LoRA Intelligence state
        if (!s.loraIntel) s.loraIntel = { enabled: false, ensureLoras: false, useDanbooruTags: true, ensureCharacterTag: false, useCharDescriptions: false, descriptionStyle: 'natural', promptAssemblyMode: 'structured', assignmentViewMode: 'structured', sendAllCharactersToPromptAi: false, globalActiveLoras: [], characterActiveLoras: {}, characterAssignments: {}, characterAssignmentsByMode: {}, lastCharacterAnalysisResponse: "", characterAnalysisFeedback: "", compiledPromptOverride: "" };
        if (s.animaMaxTags === undefined) s.animaMaxTags = 60;
        if (s.manualPrompt === undefined) s.manualPrompt = "";
        if (s.lastGeneratedImagePrompt === undefined) s.lastGeneratedImagePrompt = "";
        if (s.manualPromptFeedback === undefined) s.manualPromptFeedback = "";
        if (!Array.isArray(s.manualPromptUndoStack)) s.manualPromptUndoStack = [];
        ensureLoraIntelDefaults(s.loraIntel);
        const li = s.loraIntel;
        const adultPrecisionTitle = isNaturalLanguageImageStyle(s.promptStyle) ? "Adult Prose Precision" : "Adult Tag Precision";
        const adultPrecisionDesc = isNaturalLanguageImageStyle(s.promptStyle)
            ? "Uses direct natural-language visual terms for explicit adult scenes."
            : "Uses direct visual terms for explicit adult scenes.";
        const structuredRulesTitle = isNaturalLanguageImageStyle(s.promptStyle) ? "Structured Prose Rules" : "Structured Prompt Rules";
        const structuredRulesDesc = isNaturalLanguageImageStyle(s.promptStyle)
            ? "Adds natural-language ordering and anti-feature-bleed rules."
            : "Adds beta-style ordering and anti-feature-bleed rules.";
        const promptExamplesEffective = s.includePromptExamples;
        const promptExamplesTitle = s.promptStyle === "krea2" ? "Krea 2 Prose Examples" : "Template Examples";
        const promptExamplesDesc = s.promptStyle === "krea2"
            ? "Adds Krea 2 prose shape references for steadier composition."
            : "Adds examples for steadier composition at higher token cost.";
        const charKey = getCharacterKey() || "default";
        ensureStructuredCharacterAssignments(li, charKey);
        syncCurrentModeCharacterAssignments(li, charKey);
        const liAssignments = getModeCharacterAssignments(li, charKey);

        c.append(`
            <!-- MASTER TOGGLE -->
            <div class="ps-toggle-card ${s.enabled ? 'active' : ''}" id="ig_enable_card" style="border-color: ${s.enabled ? 'var(--gold)' : 'var(--border-color)'};">
                <div style="display:flex; flex-direction:column;">
                    <span style="font-weight:700; font-size: 1.1rem; color: ${s.enabled ? 'var(--gold)' : 'var(--text-main)'};"><i class="fa-solid fa-image"></i> Enable Image Generation</span>
                    <div style="margin-top:4px; font-size: 0.8rem; color: var(--text-muted);">Activate ComfyUI integration for this specific character/group.</div>
                </div>
                <div class="ps-switch"></div>
            </div>
            <!-- Utility / legacy prompt backend -->
                <div data-ig-collapse="utility-backend" style="background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                    <div class="ps-rule-title" style="margin-bottom: 12px;"><i class="fa-solid fa-gears"></i> SillyTavern Utility LLM Backend</div>
                    <div style="display: flex; align-items: center; gap: 15px;">
                        <div style="flex: 1;">
                            <div style="font-size: 0.85rem; font-weight: 600; color: var(--text-main);">Character analysis and legacy prompt calls</div>
                            <div style="font-size: 0.75rem; color: var(--text-muted);">Used by character analysis and when the yellow quick-image source below is set to SillyTavern. It does not control ComfyUI NanoGPT mode.</div>
                        </div>
                        <select id="img_gen_backend" class="ps-modern-input" style="width: 220px; cursor: pointer;">
                            <option value="direct" ${s.generatorBackend === 'direct' ? 'selected' : ''}>Current ST Connection</option>
                            <option value="preset" ${s.generatorBackend === 'preset' ? 'selected' : ''}>Megumin Image Preset</option>
                        </select>
                    </div>
                </div>

                <!-- Prompt writer (client-side) -->
                <div data-ig-collapse="prompt-writer" style="background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                    <div class="ps-rule-title" style="margin-bottom: 12px;"><i class="fa-solid fa-feather-pointed"></i> Prompt Writer</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 12px;">Writes the final image prompt in your browser before the render job is sent, so you can always see and edit the exact prompt that renders.</div>
                    <div style="display: grid; grid-template-columns: minmax(130px, 0.7fr) minmax(0, 1.35fr) minmax(0, 1fr) minmax(90px, 0.55fr); gap: 12px;">
                        <div>
                            <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px;">Provider</div>
                            <select id="ig_prompt_writer_provider" class="ps-modern-input" style="padding: 8px; font-size: 0.8rem; cursor: pointer;">
                                <option value="nanogpt" ${promptWriter.provider === "nanogpt" ? "selected" : ""}>NanoGPT</option>
                                <option value="openrouter" ${promptWriter.provider === "openrouter" ? "selected" : ""}>OpenRouter</option>
                            </select>
                        </div>
                        <div>
                            <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px;">${promptWriter.label} API Key</div>
                            <input type="password" id="ig_prompt_writer_key" class="ps-modern-input" value="${psEscapeAttr(promptWriter.apiKey)}" placeholder="${promptWriter.provider === "openrouter" ? "OpenRouter API key" : "nano-gpt.com API key"}" autocomplete="off" style="padding: 8px; font-size: 0.8rem;" />
                        </div>
                        <div>
                            <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px;">Model</div>
                            <input type="text" id="ig_prompt_writer_model" class="ps-modern-input" value="${psEscapeAttr(promptWriter.model)}" placeholder="${psEscapeAttr(promptWriter.provider === "openrouter" ? OPENROUTER_DEFAULT_PROMPT_MODEL : NANOGPT_DEFAULT_PROMPT_MODEL)}" autocomplete="off" style="padding: 8px; font-size: 0.8rem;" />
                        </div>
                        <div>
                            <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px;" title="0 = deterministic, 2 = wild. Low values keep the prompt faithful to the scene.">Temp</div>
                            <input type="number" id="ig_prompt_writer_temp" class="ps-modern-input" value="${psEscapeAttr(promptWriter.temperature)}" min="0" max="2" step="0.05" style="padding: 8px; font-size: 0.8rem; text-align: center;" />
                        </div>
                    </div>
                </div>

            <div id="ig_main_content" style="display: ${s.enabled ? 'block' : 'none'};">

                <!-- Connection & Workflow -->
                <div data-ig-collapse="comfy-workflow" style="background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                    <div class="ps-rule-title" style="margin-bottom: 12px;"><i class="fa-solid fa-link"></i> ComfyUI Server & Workflow</div>

                    <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                        <input type="text" id="ig_url" class="ps-modern-input" value="${s.comfyUrl}" placeholder="http://127.0.0.1:8188" style="flex: 1;" />
                        <button id="ig_test_btn" class="ps-modern-btn secondary" style="padding: 0 15px;"><i class="fa-solid fa-wifi"></i> Test</button>
                    </div>

                    <div style="display: flex; gap: 10px; align-items: center;">
                        <select id="ig_workflow_list" class="ps-modern-input" style="flex: 1; cursor: pointer;"></select>
                        <button id="ig_new_wf" class="ps-modern-btn secondary" title="New Workflow"><i class="fa-solid fa-plus"></i></button>
                        <button id="ig_edit_wf" class="ps-modern-btn secondary" title="Edit JSON"><i class="fa-solid fa-pen"></i></button>
                        <button id="ig_del_wf" class="ps-modern-btn secondary" style="color: #ef4444; border-color: rgba(239, 68, 68, 0.3);" title="Delete"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>

                <div data-ig-collapse="runpod" style="display:${SHOW_RUNPOD_IMAGE_BACKEND ? 'block' : 'none'}; background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                    <div class="ps-rule-title" style="margin-bottom: 12px;"><i class="fa-solid fa-cloud"></i> RunPod Serverless</div>
                    <div class="ps-toggle-card ${runpod.enabled ? 'active' : ''}" id="ig_runpod_card" style="padding: 12px 18px; margin-bottom: 15px;">
                        <div style="display:flex; flex-direction:column;">
                            <span style="font-weight:600; font-size:0.85rem;">Render with RunPod</span>
                            <div style="margin-top:2px; font-size: 0.7rem; color: var(--text-muted);">Sends the prepared ComfyUI API workflow to your RunPod endpoint. Endpoint and API key are saved in local extension settings.</div>
                        </div>
                        <div class="ps-switch"></div>
                    </div>
                    <div id="ig_runpod_settings" style="display: ${runpod.enabled ? 'block' : 'none'};">
                        <div style="display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap;">
                            ${Object.entries(RUNPOD_SLOT_DEFINITIONS).map(([slotId, slot]) => `<button type="button" class="ps-modern-btn secondary ig-runpod-slot" data-slot="${slotId}" title="Use the ${slot.label} RunPod worker" style="padding:7px 11px; font-size:.75rem; ${runpodGlobal.activeSlot === slotId ? 'border-color:var(--gold); color:var(--gold);' : ''}"><i class="fa-solid ${slotId === 'krea2' ? 'fa-camera' : 'fa-wand-magic-sparkles'}"></i> ${slot.label}</button>`).join("")}
                        </div>
                        <div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.35fr); gap: 12px; margin-bottom: 12px;">
                            <div>
                                <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px;">${RUNPOD_SLOT_DEFINITIONS[runpodGlobal.activeSlot].label} Endpoint ID</div>
                                <input type="text" id="ig_runpod_endpoint" class="ps-modern-input" value="${psEscapeAttr(runpod.endpointId)}" placeholder="your-endpoint-id" style="padding: 8px; font-size: 0.8rem;" />
                            </div>
                            <div>
                                <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px;">API Key</div>
                                <input type="password" id="ig_runpod_key" class="ps-modern-input" value="${psEscapeAttr(runpod.apiKey)}" placeholder="RunPod API key" autocomplete="off" style="padding: 8px; font-size: 0.8rem;" />
                            </div>
                        </div>
                        <div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px;">
                            <div>
                                <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px;">Poll Interval (ms)</div>
                                <input type="number" id="ig_runpod_poll" class="ps-modern-input" value="${psEscapeAttr(runpod.pollIntervalMs)}" min="500" step="250" style="padding: 8px; font-size: 0.8rem;" />
                            </div>
                            <div>
                                <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px;">Timeout (ms)</div>
                                <input type="number" id="ig_runpod_timeout" class="ps-modern-input" value="${psEscapeAttr(runpod.timeoutMs)}" min="30000" step="10000" style="padding: 8px; font-size: 0.8rem;" />
                            </div>
                        </div>
                    </div>
                </div>

                <div data-ig-collapse="generation-formatting" style="background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                    <div class="ps-rule-title" style="margin-bottom: 12px;"><i class="fa-solid fa-pen-nib"></i> Generation Triggers & Formatting</div>

                    <div style="display: flex; gap: 15px; margin-bottom: 15px;">
                        <div style="flex: 2;">
                            <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px;">Trigger Mode</div>
                            <select id="ig_trigger_mode" class="ps-modern-input" style="padding: 8px; font-size: 0.8rem; cursor: pointer;">
                                <option value="always" ${s.triggerMode === 'always' ? 'selected' : ''}>Always (Every Reply)</option>
                                <option value="frequency" ${s.triggerMode === 'frequency' ? 'selected' : ''}>After X Replies</option>
                                <option value="conditional" ${s.triggerMode === 'conditional' ? 'selected' : ''}>Only when character sends a pic</option>
                                <option value="manual" ${s.triggerMode === 'manual' ? 'selected' : ''}>Manual Button Only</option>
                            </select>
                        </div>
                        <div style="flex: 1; display: ${s.triggerMode === 'frequency' ? 'block' : 'none'};" id="ig_freq_container">
                            <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px;">Every X Replies</div>
                            <input type="number" id="ig_auto_freq" class="ps-modern-input" value="${s.autoGenFreq}" min="1" style="padding: 8px; font-size: 0.8rem; text-align: center;" />
                        </div>
                    </div>

                    <div class="ps-toggle-card ${s.previewPrompt ? 'active' : ''}" id="ig_preview_card" style="padding: 12px 18px; margin-bottom: 15px;">
                        <div style="display:flex; flex-direction:column;">
                            <span style="font-weight:600; font-size:0.85rem;">Preview Prompt Before Sending</span>
                            <div style="margin-top:2px; font-size: 0.7rem; color: var(--text-muted);">Show a popup to view or edit the AI's prompt before rendering.</div>
                        </div>
                        <div class="ps-switch"></div>
                    </div>

                    <div class="ps-toggle-card ${s.manualSceneSelector ? 'active' : ''}" id="ig_manual_scene_selector_card" style="padding: 12px 18px; margin-bottom: 15px;">
                        <div style="display:flex; flex-direction:column;">
                            <span style="font-weight:600; font-size:0.85rem;">Manual Scene Character Selector</span>
                            <div style="margin-top:2px; font-size: 0.7rem; color: var(--text-muted);">When clicking the quick Generate Prompt button, choose which analyzed characters are in this scene. Bypasses match keywords for this generation.</div>
                        </div>
                        <div class="ps-switch"></div>
                    </div>
                    <div style="display:flex; align-items:center; gap:12px; margin-bottom:15px; padding:12px 14px; border:1px solid var(--border-color); border-radius:9px; background:rgba(0,0,0,.16);">
                        <div style="flex:1; min-width:180px;">
                            <div style="font-size:.8rem; font-weight:700;">Yellow Quick-Image Button</div>
                            <div style="font-size:.66rem; color:var(--text-muted); margin-top:2px;">This directly controls what happens when you click the yellow image button beside Send. ComfyUI NanoGPT uses %ai_text% without calling SillyTavern's LLM.</div>
                        </div>
                        <select id="ig_manual_prompt_source" class="ps-modern-input" style="width:245px; padding:8px; font-size:.75rem;">
                            <option value="comfy_llm" ${s.manualPromptSource === 'comfy_llm' ? 'selected' : ''}>ComfyUI NanoGPT (Fast)</option>
                            <option value="deterministic" ${s.manualPromptSource === 'deterministic' ? 'selected' : ''}>Deterministic Tags</option>
                            <option value="sillytavern" ${s.manualPromptSource === 'sillytavern' ? 'selected' : ''}>SillyTavern / Megumin Image</option>
                        </select>
                    </div>

                    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; margin-bottom: 15px;">
                        <div class="ps-toggle-card ${s.structuredPromptRules ? 'active' : ''}" id="ig_structured_rules_card" style="padding: 12px 14px;">
                            <div style="display:flex; flex-direction:column;">
                                <span style="font-weight:600; font-size:0.8rem;">${structuredRulesTitle}</span>
                                <div style="margin-top:2px; font-size: 0.65rem; color: var(--text-muted);">${structuredRulesDesc}</div>
                            </div>
                            <div class="ps-switch"></div>
                        </div>
                        <div class="ps-toggle-card ${s.adultTagPrecision ? 'active' : ''}" id="ig_adult_precision_card" style="padding: 12px 14px;">
                            <div style="display:flex; flex-direction:column;">
                                <span style="font-weight:600; font-size:0.8rem;">${adultPrecisionTitle}</span>
                                <div style="margin-top:2px; font-size: 0.65rem; color: var(--text-muted);">${adultPrecisionDesc}</div>
                            </div>
                            <div class="ps-switch"></div>
                        </div>
                        <div class="ps-toggle-card ${promptExamplesEffective ? 'active' : ''}" id="ig_prompt_examples_card" style="padding: 12px 14px;">
                            <div style="display:flex; flex-direction:column;">
                                <span style="font-weight:600; font-size:0.8rem;">${promptExamplesTitle}</span>
                                <div style="margin-top:2px; font-size: 0.65rem; color: var(--text-muted);">${promptExamplesDesc}</div>
                            </div>
                            <div class="ps-switch"></div>
                        </div>
                    </div>

                    <div id="ig_prompt_builder" style="background: rgba(0,0,0,0.2); padding: 15px; border-radius: 8px; border-left: 3px solid var(--gold);">
                        <div style="display: flex; gap: 15px;">
                            <div style="flex: 1;">
                                <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px;">Model Style Format</div>
                                <select id="ig_style" class="ps-modern-input" style="padding: 8px; font-size: 0.8rem;">
                                    <option value="standard" ${s.promptStyle === 'standard' ? 'selected' : ''}>Standard (Descriptive)</option>
                                    <option value="illustrious" ${s.promptStyle === 'illustrious' ? 'selected' : ''}>Illustrious/Pony (Tags)</option>
                                    <option value="sdxl" ${s.promptStyle === 'sdxl' ? 'selected' : ''}>SDXL (Natural Prose)</option>
                                    <option value="krea2" ${s.promptStyle === 'krea2' ? 'selected' : ''}>Krea 2 (Natural Prose)</option>
                                </select>
                            </div>
                            <div style="flex: 1;">
                                <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px;">Camera Perspective</div>
                                <select id="ig_persp" class="ps-modern-input" style="padding: 8px; font-size: 0.8rem;">
                                    <option value="scene" ${s.promptPerspective === 'scene' ? 'selected' : ''}>Cinematic Scene</option>
                                    <option value="pov" ${s.promptPerspective === 'pov' ? 'selected' : ''}>First Person (POV)</option>
                                    <option value="character" ${s.promptPerspective === 'character' ? 'selected' : ''}>Character Portrait</option>
                                </select>
                            </div>
                            <div style="width: 145px;">
                                <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px;">Anima Tag Cap</div>
                                <input type="number" id="ig_anima_max_tags" class="ps-modern-input" value="${getAnimaMaxTags(s) || 0}" min="0" max="300" step="5" title="Maximum comma-separated tags for Anima-style prompts. Set 0 to disable." style="padding: 8px; font-size: 0.8rem; text-align: center;" />
                            </div>
                        </div>
                    </div>
                </div>

                <div data-ig-collapse="prompt-affixes" style="background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                    <div class="ps-rule-title" style="margin-bottom: 12px;"><i class="fa-solid fa-tags"></i> Prompt Affixes</div>
                    <div style="font-size: 0.72rem; color: var(--text-muted); margin-bottom: 14px;">Fixed prompt pieces kept separate from style, perspective, and other generation settings. Changes here save to this profile immediately.</div>

                    <div style="margin-bottom: 12px;">
                        <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase;">Leading Tags</div>
                        <div style="font-size: 0.65rem; color: var(--text-muted); margin-bottom: 4px;">Prepended to the Comfy positive prompt when LoRA Intelligence is on and Booru Tags mode is enabled. Leave empty to skip.</div>
                        <input type="text" id="ig_std_booru_lead" class="ps-modern-input" placeholder="e.g. nsfw, uncensored, @artist, digital anime illustration, 2d anime" value="${psEscapeAttr(s.standardBooruLeadTags || '')}" style="padding: 8px; font-size: 0.8rem;" />
                    </div>

                    <div style="margin-bottom: 12px;">
                        <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase;">LoRA Triggers</div>
                        <div style="font-size: 0.65rem; color: var(--text-muted); margin-bottom: 4px;">Appended after Leading Tags wherever those leading tags are applied. Comma-separated is fine.</div>
                        <input type="text" id="ig_lora_triggers" class="ps-modern-input" placeholder="e.g. trigger1, trigger2, character name" value="${psEscapeAttr(s.loraTriggers || '')}" style="padding: 8px; font-size: 0.8rem;" />
                    </div>

                    <div>
                        <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase;">Extra Instructions</div>
                        <div style="font-size: 0.65rem; color: var(--text-muted); margin-bottom: 4px;">Extra cues for the image-prompt step (mood, lighting, composition). Separate from leading tags.</div>
                        <input type="text" id="ig_extra" class="ps-modern-input" placeholder="Extra cues for the image-prompt step (mood, lighting, …)" value="${psEscapeAttr(s.promptExtra || '')}" style="padding: 8px; font-size: 0.8rem;" />
                    </div>
                </div>

                <!-- Parameters Grid -->
                <div data-ig-collapse="image-parameters" style="background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                    <div class="ps-rule-title" style="margin-bottom: 12px;"><i class="fa-solid fa-sliders"></i> Image Parameters</div>

                    <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                        <select id="ig_model" class="ps-modern-input" style="flex: 2;"><option value="">Loading Models...</option></select>
                        <select id="ig_sampler" class="ps-modern-input" style="flex: 1;"><option value="">Loading Samplers...</option></select>
                        <select id="ig_scheduler" class="ps-modern-input" style="flex: 1;"><option value="">Loading Schedulers...</option></select>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 15px; background: rgba(0,0,0,0.1); padding: 15px; border-radius: 8px; border: 1px solid var(--border-color);">
                        <!-- Steps -->
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="width: 50px; font-size: 0.8rem; font-weight: bold; color: var(--text-muted);">Steps</span>
                            <input type="range" id="ig_steps" min="1" max="100" value="${s.steps}" style="flex: 1; cursor: pointer;">
                            <input type="number" id="ig_steps_val" class="ps-modern-input" style="width: 50px; padding: 4px; text-align: center; font-size: 0.75rem;" value="${s.steps}">
                        </div>
                        <!-- CFG -->
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="width: 50px; font-size: 0.8rem; font-weight: bold; color: var(--text-muted);">CFG</span>
                            <input type="range" id="ig_cfg" min="1" max="30" step="0.5" value="${s.cfg}" style="flex: 1; cursor: pointer;">
                            <input type="number" id="ig_cfg_val" class="ps-modern-input" style="width: 50px; padding: 4px; text-align: center; font-size: 0.75rem;" value="${s.cfg}">
                        </div>
                        <!-- Denoise -->
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="width: 50px; font-size: 0.8rem; font-weight: bold; color: var(--text-muted);">Denoise</span>
                            <input type="range" id="ig_denoise" min="0" max="1" step="0.05" value="${s.denoise}" style="flex: 1; cursor: pointer;">
                            <input type="number" id="ig_denoise_val" class="ps-modern-input" style="width: 50px; padding: 4px; text-align: center; font-size: 0.75rem;" value="${s.denoise}">
                        </div>
                        <!-- Clip Skip -->
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="width: 50px; font-size: 0.8rem; font-weight: bold; color: var(--text-muted);">CLIP</span>
                            <input type="range" id="ig_clip" min="1" max="12" step="1" value="${s.clipSkip}" style="flex: 1; cursor: pointer;">
                            <input type="number" id="ig_clip_val" class="ps-modern-input" style="width: 50px; padding: 4px; text-align: center; font-size: 0.75rem;" value="${s.clipSkip}">
                        </div>
                    </div>

                    <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                        <div style="flex: 2;">
                            <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase;">Resolution Preset</div>
                            <select id="ig_res_preset" class="ps-modern-input" style="padding: 8px; font-size: 0.8rem;"></select>
                        </div>
                        <div style="flex: 1; display: flex; align-items: flex-end; gap: 5px;">
                            <input type="number" id="ig_w" class="ps-modern-input" value="${s.imgWidth}" placeholder="W" style="padding: 8px; text-align: center; font-size: 0.8rem;" />
                            <span style="color: var(--text-muted); padding-bottom: 8px;">x</span>
                            <input type="number" id="ig_h" class="ps-modern-input" value="${s.imgHeight}" placeholder="H" style="padding: 8px; text-align: center; font-size: 0.8rem;" />
                        </div>
                    </div>

                    <div style="display: flex; gap: 10px;">
                        <div style="flex: 1;">
                            <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase;">Seed (-1 for random)</div>
                            <input type="number" id="ig_seed" class="ps-modern-input" value="${s.customSeed}" style="padding: 8px; font-size: 0.8rem;" />
                        </div>
                        <div style="flex: 2;">
                            <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase;">Negative Prompt Override</div>
                            <input type="text" id="ig_neg" class="ps-modern-input" value="${s.customNegative}" style="padding: 8px; font-size: 0.8rem;" />
                        </div>
                    </div>
                </div>

                <!-- LoRA Lab -->
                <div data-ig-collapse="lora-lab" style="background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                    <div data-ig-collapse-header style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:12px;">
                        <div class="ps-rule-title" style="margin-bottom:0; flex:1; min-width:0;"><i class="fa-solid fa-flask"></i> LoRA Lab</div>
                    </div>
                    <div style="display:block; margin:-4px 0 12px; font-size:.68rem; color:var(--text-muted);">Pick LoRAs from the <b>LoRA Gallery</b> tab and assign them to a slot below, or to a character in Character Analysis.</div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                        ${[1,2,3,4].map(i => `
                            <div style="background: rgba(0,0,0,0.15); border: 1px solid var(--border-color); padding: 10px; border-radius: 8px; border-left: 3px solid #a855f7;">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; gap: 8px;">
                                    <div style="font-size: 0.75rem; font-weight: bold; color: var(--text-muted);">Slot ${i}</div>
                                    <button type="button" id="ig_lora_lock_${i}" class="ps-modern-btn secondary ig-lora-lock-btn" title="Lock: match-keywords never changes this slot. Unlock to allow keyword swaps on empty or keyword-filled slots." style="padding: 4px 10px; font-size: 0.65rem; min-width: auto; border-radius: 6px;">
                                        <i class="fa-solid ${s.loraSlotLocked[i - 1] ? "fa-lock" : "fa-lock-open"}"></i>
                                    </button>
                                </div>
                                <select id="ig_lora_${i}" class="ps-modern-input" style="padding: 6px; font-size: 0.75rem; margin-bottom: 8px;"><option value="">Loading...</option></select>
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: bold;">Wt: <span id="ig_lorawt_lbl_${i}" style="color: var(--text-main);">${i===1?s.selectedLoraWt:i===2?s.selectedLoraWt2:i===3?s.selectedLoraWt3:s.selectedLoraWt4}</span></span>
                                    <input type="range" id="ig_lorawt_${i}" min="-2" max="2" step="0.1" value="${i===1?s.selectedLoraWt:i===2?s.selectedLoraWt2:i===3?s.selectedLoraWt3:s.selectedLoraWt4}" style="flex: 1; cursor: pointer;">
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <!-- Character Analysis -->
                <div class="li-character-analysis-panel" data-ig-collapse="lora-intelligence" style="background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                    <div data-ig-collapse-header style="display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 15px;">
                        <div class="ps-rule-title" style="margin-bottom: 0; color: #a855f7; flex: 1; min-width: 0;"><i class="fa-solid fa-brain"></i> Character Analysis</div>
                        <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
                            <div class="ps-toggle-card ${li.enabled ? 'active' : ''}" id="li_enable_toggle" style="padding: 8px 14px; min-width: 54px; justify-content: center; cursor: pointer; border-radius: 8px;">
                                <div class="ps-switch" style="transform: scale(0.8);"></div>
                            </div>
                            <button type="button" id="li_collapse_btn" class="ps-modern-btn secondary" style="padding:8px 10px; min-height:40px; min-width:40px;" title="Expand or collapse Character Analysis"><i class="fa-solid fa-chevron-down" style="transition:transform .2s;"></i></button>
                        </div>
                    </div>

                    <div id="li_main_content" style="display: ${li.enabled ? 'block' : 'none'};">
                        <!-- Analysis Mode -->
                        <div style="background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); border-radius: 8px; padding: 15px; margin-bottom: 20px;">
                            <div style="display:flex; align-items:flex-end; gap:12px; flex-wrap:wrap;">
                                <div style="flex:1; min-width:220px;">
                                    <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-main); margin-bottom: 4px;">Character Analysis Mode</div>
                                    <div style="font-size:0.65rem; color:var(--text-muted);">Booru is for tag models. Natural writes per-character prose. Natural + Krea Runtime LoRA keeps selected Krea identities explicit and does not infer or swap LoRAs from chat keywords.</div>
                                </div>
                                <select id="li_analysis_mode" class="ps-modern-input" style="width: 230px; padding: 8px; font-size: 0.75rem;">
                                    <option value="booru" ${li.useDanbooruTags && !li.useCharDescriptions ? 'selected' : ''}>Booru Tags</option>
                                    <option value="natural" ${!li.useDanbooruTags && li.useCharDescriptions && !li.naturalLoraMode ? 'selected' : ''}>Natural Language</option>
                                    <option value="natural_lora" ${li.naturalLoraMode ? 'selected' : ''}>Natural Language + Krea Runtime LoRA</option>
                                </select>
                                <div id="li_ensure_char_tag_wrap" style="display: ${li.useDanbooruTags ? 'flex' : 'none'}; align-items: center; gap: 8px; padding: 8px 10px; background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.2); border-radius: 6px; cursor: pointer;" class="${li.ensureCharacterTag ? 'active' : ''}">
                                    <div style="width: 16px; height: 16px; border-radius: 4px; border: 2px solid ${li.ensureCharacterTag ? '#f59e0b' : '#52525b'}; background: ${li.ensureCharacterTag ? '#f59e0b' : 'transparent'}; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                                        ${li.ensureCharacterTag ? '<i class="fa-solid fa-check" style="font-size: 0.5rem; color: #000;"></i>' : ''}
                                    </div>
                                    <span style="font-size: 0.7rem; font-weight: 700; color: ${li.ensureCharacterTag ? '#f59e0b' : 'var(--text-muted)'};">Ensure Character Tag</span>
                                </div>
                            </div>
                        </div>
                        <!-- Prompt Assembly -->
                        <div data-ig-collapse="prompt-assembly" style="background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); border-radius: 8px; padding: 15px; margin-bottom: 20px;">
                            <div data-ig-collapse-header style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                                <div style="flex: 1; min-width: 220px;">
                                    <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-main);">Prompt Assembly</div>
                                    <div style="font-size: 0.65rem; color: var(--text-muted); margin-top: 2px;">Character Guided gives the prompt model matched stable character references; LLM Full is looser.</div>
                                </div>
                                <select id="li_prompt_assembly_mode" class="ps-modern-input" style="width: 240px; padding: 8px; font-size: 0.75rem;">
                                    <option value="structured" ${li.promptAssemblyMode === 'structured' ? 'selected' : ''}>Character Guided LLM</option>
                                    <option value="llm" ${li.promptAssemblyMode === 'llm' ? 'selected' : ''}>LLM Full Prompt</option>
                                </select>
                                <select id="li_assignment_view_mode" class="ps-modern-input" style="width: 210px; padding: 8px; font-size: 0.75rem;">
                                    <option value="structured" ${li.assignmentViewMode === 'structured' ? 'selected' : ''}>Structured Fields</option>
                                    <option value="plain" ${li.assignmentViewMode === 'plain' ? 'selected' : ''}>Plain Text View</option>
                                </select>
                            </div>
                            <div class="ps-toggle-card ${li.sendAllCharactersToPromptAi ? 'active' : ''}" id="li_send_all_chars_toggle" style="padding: 10px 12px; margin-top: 12px; min-height: auto; cursor: pointer; ${li.sendAllCharactersToPromptAi ? 'border-color: rgba(245,158,11,0.55); background: rgba(245,158,11,0.08);' : ''}">
                                <div style="display:flex; flex-direction:column; min-width:0; padding-right:10px;">
                                    <span style="font-weight:700; font-size:0.78rem; color:${li.sendAllCharactersToPromptAi ? '#fbbf24' : 'var(--text-main)'};">Send All Character References To Prompt AI</span>
                                    <div style="margin-top:2px; font-size:0.65rem; color:var(--text-muted);">Always sends every analyzed character as an appearance library. The AI picks who is present from the latest scene. Keyword-inferred casts do not shrink this library.</div>
                                </div>
                                <div class="ps-switch" style="transform:scale(0.75); flex-shrink:0; ${li.sendAllCharactersToPromptAi ? 'background:#f59e0b;' : ''}"></div>
                            </div>
                            <div style="display: ${li.useDanbooruTags ? 'grid' : 'none'}; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin-top: 14px;">
                                ${liTagFieldToggle("li_field_character", "Character Tag", li.tagFieldToggles.characterTag)}
                                ${liTagFieldToggle("li_field_series", "Series Tag", li.tagFieldToggles.seriesTag)}
                                ${liTagFieldToggle("li_field_physical", "Physical", li.tagFieldToggles.physicalTags)}
                                ${liTagFieldToggle("li_field_clothing", "Clothing", li.tagFieldToggles.clothingTags)}
                            </div>
                        </div>


                        <!-- AI Character Assignment -->
                        <div data-ig-collapse="character-assignment" style="background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); border-radius: 8px; padding: 15px; margin-bottom: 20px;">
                            <div data-ig-collapse-header style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                                <span style="font-weight: 700; font-size: 0.85rem; color: var(--text-main);"><i class="fa-solid fa-users-gear" style="color: var(--gold); margin-right: 6px;"></i>Character Visual Analysis</span>
                                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                                    <button id="li_analysis_export_btn" class="ps-modern-btn secondary" title="Export character-analysis assignments and mode settings" style="padding: 6px 10px; font-size: 0.7rem;">
                                        <i class="fa-solid fa-file-export"></i> Export
                                    </button>
                                    <button id="li_analysis_import_btn" class="ps-modern-btn secondary" title="Restore a previously exported character-analysis snapshot" style="padding: 6px 10px; font-size: 0.7rem;">
                                        <i class="fa-solid fa-file-import"></i> Import
                                    </button>
                                    <input id="li_analysis_import_file" type="file" accept=".json,application/json" style="display:none;" />
                                    <button id="li_analyze_btn" class="ps-modern-btn primary" style="background: var(--gold); color: #000; padding: 6px 14px; font-size: 0.75rem; font-weight: 800;">
                                        <i class="fa-solid fa-bolt"></i> Analyze Characters
                                    </button>
                                </div>
                            </div>
                            <div class="li-analysis-feedback-row" style="display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: end; margin-bottom: 12px;">
                                <label style="display: flex; flex-direction: column; gap: 5px; min-width: 0;">
                                    <span style="font-size: 0.68rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase;">Regeneration Feedback</span>
                                    <textarea id="li_analysis_feedback" class="ps-modern-input" placeholder="Tell the AI what is wrong, e.g. Fix Megumin's eye color; keep everyone else. Or: redo all women as slim hourglass / slender-curvy with narrow waist and elegant face." style="min-height: 74px; resize: vertical; font-size: 0.8rem; line-height: 1.45; padding: 10px;">${psEscapeText(li.characterAnalysisFeedback || "")}</textarea>
                                </label>
                                <button id="li_regen_feedback_btn" class="ps-modern-btn secondary" title="Re-run character analysis using the feedback above" style="padding: 8px 12px; font-size: 0.72rem; min-height: 42px;">
                                    <i class="fa-solid fa-rotate"></i> Regenerate With Feedback
                                </button>
                            </div>
                            <div id="li_assignment_table" class="li-assignment-table" style="min-height: 40px;">
                                ${liAssignments.length > 0 ? '' : '<div style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 15px; border: 1px dashed var(--border-color); border-radius: 8px;">No assignments yet. Click "Analyze Characters" to extract visual references.</div>'}
                            </div>
                        </div>

                        <!-- Manual Render -->
                        <div data-ig-collapse="manual-render" style="background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); border-radius: 8px; padding: 15px; margin-bottom: 20px;">
                            <div class="ps-rule-title" style="margin-bottom: 12px;"><i class="fa-solid fa-keyboard"></i> Manual Render</div>
                            <div style="display:flex; gap: 10px; align-items: flex-end; margin-bottom: 12px; flex-wrap: wrap;">
                                <div style="flex: 1; min-width: 220px;">
                                    <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase;">NSFW Preset</div>
                                    <select id="ig_nsfw_position_preset" class="ps-modern-input" style="padding: 8px; font-size: 0.8rem;">
                                        ${NSFW_POSITION_PRESETS.map(p => `<option value="${psEscapeAttr(p.prompt)}">${psEscapeText(p.label)}</option>`).join("")}
                                    </select>
                                </div>
                                <button id="ig_apply_position_preset" class="ps-modern-btn secondary" style="padding: 8px 12px;"><i class="fa-solid fa-plus"></i> Add Preset</button>
                                <button id="ig_add_character_tags" class="ps-modern-btn secondary" style="padding: 8px 12px;"><i class="fa-solid fa-user-plus"></i> Add Character Tags</button>
                            </div>
                            <div style="margin-bottom: 14px;">
                                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom: 6px; flex-wrap: wrap;">
                                    <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); text-transform: uppercase;">Last Generated Image Prompt</div>
                                    <div style="display:flex; gap:8px; flex-wrap:wrap;">
                                        <button type="button" id="ig_copy_last_prompt_btn" class="ps-modern-btn secondary" style="padding: 6px 10px; font-size: 0.7rem;"><i class="fa-solid fa-copy"></i> Copy</button>
                                        <button type="button" id="ig_use_last_prompt_btn" class="ps-modern-btn secondary" style="padding: 6px 10px; font-size: 0.7rem;" title="Copy the last generated prompt into the manual prompt box"><i class="fa-solid fa-arrow-down"></i> Use in Manual</button>
                                    </div>
                                </div>
                                <textarea id="ig_last_image_prompt" readonly class="ps-modern-input" style="height: 90px; resize: vertical; font-family: Consolas, Monaco, monospace; font-size: 0.75rem; background: #0c0c0e; color: var(--text-main); cursor: default; margin-bottom: 0;" spellcheck="false" placeholder="No generated image prompt yet this session/profile.">${psEscapeText(s.lastGeneratedImagePrompt || "")}</textarea>
                            </div>
                            <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase;">Manual Prompt</div>
                            <textarea id="ig_manual_prompt" class="ps-modern-input" style="height: 130px; resize: vertical; font-size: 0.85rem; line-height: 1.45; margin-bottom: 12px;" placeholder="Type the exact image prompt to render. This bypasses prompt generation but still uses current ComfyUI settings and LoRA slots.">${psEscapeText(s.manualPrompt || "")}</textarea>
                            <div style="display:flex; justify-content:flex-end; gap: 10px; flex-wrap: wrap; margin-bottom: 14px;">
                                <button type="button" id="ig_manual_undo_btn" class="ps-modern-btn secondary" style="padding: 8px 12px;" ${s.manualPromptUndoStack.length ? "" : "disabled"} title="Undo the last replace / Use in Manual / feedback rewrite"><i class="fa-solid fa-rotate-left"></i> Undo (${s.manualPromptUndoStack.length})</button>
                                <button id="ig_manual_render_btn" class="ps-modern-btn primary" style="background: var(--gold); color: #000; font-weight: 800;"><i class="fa-solid fa-image"></i> Render Manual Prompt</button>
                            </div>
                            <div style="border-top: 1px solid var(--border-color); padding-top: 12px;">
                                <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 6px; text-transform: uppercase;">Regenerate Manual Prompt With Feedback</div>
                                <div style="font-size: 0.72rem; color: var(--text-muted); margin-bottom: 8px;">Rewrites the current manual prompt box via NanoGPT using your notes. The previous value is saved for Undo.</div>
                                <div class="li-analysis-feedback-row" style="display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: end;">
                                    <label style="display: flex; flex-direction: column; gap: 5px; min-width: 0;">
                                        <span style="font-size: 0.68rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase;">Feedback</span>
                                        <textarea id="ig_manual_prompt_feedback" class="ps-modern-input" placeholder="e.g. Make her hair shorter and red; keep pose and camera. Or: less crowded, focus on the woman on the left." style="min-height: 74px; resize: vertical; font-size: 0.8rem; line-height: 1.45; padding: 10px;">${psEscapeText(s.manualPromptFeedback || "")}</textarea>
                                    </label>
                                    <button type="button" id="ig_manual_regen_feedback_btn" class="ps-modern-btn secondary" title="Rewrite the manual prompt with NanoGPT using this feedback" style="padding: 8px 12px; font-size: 0.72rem; min-height: 42px;">
                                        <i class="fa-solid fa-rotate"></i> Regenerate With Feedback
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- Debug Viewers -->
                        <div style="background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden;">
                            <div id="li_prompt_preview_header" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; cursor: pointer; user-select: none;">
                                <span style="font-weight: 700; font-size: 0.85rem; color: var(--text-main);"><i class="fa-solid fa-bug" style="color: #3b82f6; margin-right: 6px;"></i>Debug Viewers</span>
                                <i id="li_prompt_chevron" class="fa-solid fa-chevron-down" style="color: var(--text-muted); transition: transform 0.2s; transform:${s.sectionOpenStates["debug-viewers"] === true ? "rotate(180deg)" : "none"};"></i>
                            </div>
                            <div id="li_prompt_preview_body" style="display:${s.sectionOpenStates["debug-viewers"] === true ? "block" : "none"}; padding: 0 15px 15px 15px;">
                                <div id="li_last_comfy_api_wrap" style="margin-bottom: 14px;">
                                    <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 10px;">
                                        <span style="font-weight: 700; font-size: 0.8rem; color: var(--text-main);"><i class="fa-solid fa-paper-plane" style="color: #a855f7; margin-right: 6px;"></i>Last ComfyUI <span style="font-family: Consolas, Monaco, monospace; font-size: 0.78rem;">/prompt</span> request</span>
                                        <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px;">
                                            <label for="li_last_comfy_req_view" style="font-size: 0.7rem; color: var(--text-muted); margin: 0;">View</label>
                                            <select id="li_last_comfy_req_view" class="ps-modern-input" style="width: auto; max-width: 280px; padding: 6px 10px; font-size: 0.75rem; cursor: pointer;">
                                                <option value="summary">Summary (prompts, LoRAs, samplers)</option>
                                                <option value="json">Full JSON (entire graph)</option>
                                            </select>
                                            <button type="button" id="li_last_comfy_req_copy" class="ps-modern-btn secondary" style="padding: 6px 12px; font-size: 0.7rem;"><i class="fa-solid fa-copy"></i> Copy</button>
                                        </div>
                                    </div>
                                    <textarea id="li_last_comfy_req_body" readonly class="ps-modern-input" style="height: 220px; resize: vertical; font-family: Consolas, Monaco, monospace; font-size: 0.72rem; background: #0c0c0e; color: var(--text-main); cursor: default;" spellcheck="false"></textarea>
                                </div>
                                <div>
                                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 10px;">
                                        <span style="font-weight: 700; font-size: 0.8rem; color: var(--text-main);"><i class="fa-solid fa-users-gear" style="color: var(--gold); margin-right: 6px;"></i>Last character analysis response</span>
                                        <button type="button" id="li_last_analysis_copy" class="ps-modern-btn secondary" style="padding: 6px 12px; font-size: 0.7rem;"><i class="fa-solid fa-copy"></i> Copy</button>
                                    </div>
                                    <textarea id="li_last_analysis_body" readonly class="ps-modern-input" style="height: 180px; resize: vertical; font-family: Consolas, Monaco, monospace; font-size: 0.72rem; background: #0c0c0e; color: var(--text-main); cursor: default;" spellcheck="false">${psEscapeText(li.lastCharacterAnalysisResponse || "")}</textarea>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `);

        setupImageGenCollapsibleSections(s);

        // --- EVENTS & BINDINGS ---
        $("#ig_enable_card").on("click", function() {
            s.enabled = !s.enabled;
            saveProfileToMemory();
            toggleQuickGenButton(); // <-- ADDED
            if (s.enabled) { $(this).addClass("active"); $(this).css("border-color", "var(--gold)"); $(this).find("span").css("color", "var(--gold)"); $("#ig_main_content").slideDown(200); igFetchComfyLists(); }
            else { $(this).removeClass("active"); $(this).css("border-color", "var(--border-color)"); $(this).find("span").css("color", "var(--text-main)"); $("#ig_main_content").slideUp(200); }
        });
        $("#img_gen_backend").on("change", function() {
            s.generatorBackend = $(this).val();
            saveProfileToMemory();
        });

        $("#ig_trigger_mode").on("change", (e) => {
            s.triggerMode = $(e.target).val();
            saveProfileToMemory();
            toggleQuickGenButton(); // <-- ADDED
            if (s.triggerMode === 'frequency') $("#ig_freq_container").show(); else $("#ig_freq_container").hide();
        });
        $("#ig_auto_freq").on("input", (e) => { let v = parseInt($(e.target).val()); if(v<1)v=1; s.autoGenFreq = v; saveProfileToMemory(); });

        $("#ig_preview_card").on("click", function() {
            s.previewPrompt = !s.previewPrompt;
            saveProfileToMemory();
            if (s.previewPrompt) $(this).addClass("active");
            else $(this).removeClass("active");
        });
        $("#ig_manual_scene_selector_card").on("click", function() {
            s.manualSceneSelector = !s.manualSceneSelector;
            saveProfileToMemory();
            $(this).toggleClass("active", s.manualSceneSelector);
        });
        $("#ig_manual_prompt_source").on("change", (e) => {
            s.manualPromptSource = $(e.target).val() || "comfy_llm";
            saveProfileToMemory();
        });
        $("#ig_structured_rules_card").on("click", function() {
            s.structuredPromptRules = !s.structuredPromptRules;
            saveProfileToMemory();
            $(this).toggleClass("active", s.structuredPromptRules);
        });
        $("#ig_adult_precision_card").on("click", function() {
            s.adultTagPrecision = !s.adultTagPrecision;
            saveProfileToMemory();
            $(this).toggleClass("active", s.adultTagPrecision);
        });
        $("#ig_prompt_examples_card").on("click", function() {
            s.includePromptExamples = !s.includePromptExamples;
            saveProfileToMemory();
            $(this).toggleClass("active", s.includePromptExamples);
        });

        // Inputs
        $("#ig_url").on("input", (e) => {
            meguminComfyLoraCache = null;
            meguminComfyLoraCacheUrl = "";
            s.comfyUrl = $(e.target).val();
            saveProfileToMemory();
        });
        $("#ig_runpod_card").on("click", function() {
            const rp = ensureRunpodSettings(s);
            rp.enabled = !rp.enabled;
            if (rp.enabled) {
                // Krea prose style should land on the Krea worker model so Finder/LoRAs work.
                if (s.promptStyle === "krea2" && s.selectedModel !== RUNPOD_KREA_MODEL) {
                    s.selectedModel = RUNPOD_KREA_MODEL;
                }
                if (ensureRunpodDropdownValues(s)) {
                    toastr.info("RunPod model defaults applied.");
                }
            }
            saveProfileToMemory();
            $(this).toggleClass("active", rp.enabled);
            if (rp.enabled) $("#ig_runpod_settings").slideDown(200);
            else $("#ig_runpod_settings").slideUp(200);
            syncKreaLoraFinderUi(s);
            if (rp.enabled) {
                populateRunpodImageLists(s);
                igFetchComfyLists();
            } else igFetchComfyLists();
        });
        $(".ig-runpod-slot").on("click", function() {
            const slotId = String($(this).attr("data-slot") || "");
            const slot = selectRunpodSlot(s, slotId);
            if (!slot) return;
            saveProfileToMemory();
            renderImageGen(c);
            if (runpod.enabled) igFetchComfyLists();
        });
        $("#ig_runpod_endpoint").on("input", (e) => {
            const value = $(e.target).val().trim();
            const globalRunpod = getRunpodGlobalSettings();
            globalRunpod.slots[globalRunpod.activeSlot].endpointId = value;
            globalRunpod.endpointId = value;
            ensureRunpodSettings(s).endpointId = value;
            saveProfileToMemory();
        });
        $("#ig_runpod_key").on("input", (e) => {
            const value = $(e.target).val().trim();
            const globalRunpod = getRunpodGlobalSettings();
            globalRunpod.slots[globalRunpod.activeSlot].apiKey = value;
            globalRunpod.apiKey = value;
            ensureRunpodSettings(s).apiKey = value;
            saveProfileToMemory();
        });
        $("#ig_runpod_poll").on("input", (e) => {
            const rp = ensureRunpodSettings(s);
            rp.pollIntervalMs = Math.max(500, parseInt($(e.target).val(), 10) || RUNPOD_IMAGE_DEFAULTS.pollIntervalMs);
            saveProfileToMemory();
        });
        $("#ig_runpod_timeout").on("input", (e) => {
            const rp = ensureRunpodSettings(s);
            rp.timeoutMs = Math.max(30000, parseInt($(e.target).val(), 10) || RUNPOD_IMAGE_DEFAULTS.timeoutMs);
            saveProfileToMemory();
        });
        $("#ig_prompt_writer_provider").on("change", (e) => {
            extension_settings[extensionName].promptWriterProvider = $(e.target).val() === "openrouter" ? "openrouter" : "nanogpt";
            saveProfileToMemory();
            renderImageGen(c);
        });
        $("#ig_prompt_writer_key").on("input", (e) => {
            getActivePromptWriterConfig().apiKey = String($(e.target).val() || "").trim();
            saveProfileToMemory();
        });
        $("#ig_prompt_writer_model").on("input", (e) => {
            const defaultModel = getPromptWriterSettings().provider === "openrouter" ? OPENROUTER_DEFAULT_PROMPT_MODEL : NANOGPT_DEFAULT_PROMPT_MODEL;
            getActivePromptWriterConfig().model = String($(e.target).val() || "").trim() || defaultModel;
            saveProfileToMemory();
        });
        $("#ig_prompt_writer_temp").on("input", (e) => {
            const value = parseFloat($(e.target).val());
            getActivePromptWriterConfig().temperature = Number.isFinite(value) ? Math.max(0, Math.min(2, value)) : NANOGPT_DEFAULT_PROMPT_TEMPERATURE;
            saveProfileToMemory();
        });
        $("#ig_style").on("change", (e) => { s.promptStyle = $(e.target).val(); saveProfileToMemory(); renderImageGen(c); });
        $("#ig_persp").on("change", (e) => { s.promptPerspective = $(e.target).val(); saveProfileToMemory(); });
        $("#ig_anima_max_tags").on("input", (e) => {
            let v = parseInt($(e.target).val());
            if (!Number.isFinite(v) || v < 0) v = 0;
            if (v > 300) v = 300;
            s.animaMaxTags = v;
            saveProfileToMemory();
        });
        $("#ig_std_booru_lead").on("input", (e) => { s.standardBooruLeadTags = $(e.target).val(); saveProfileToMemory(); });
        $("#ig_lora_triggers").on("input", (e) => { s.loraTriggers = $(e.target).val(); saveProfileToMemory(); });
        $("#ig_extra").on("input", (e) => { s.promptExtra = $(e.target).val(); saveProfileToMemory(); });
        $("#ig_w, #ig_h").on("input", (e) => { s[e.target.id === "ig_w" ? "imgWidth" : "imgHeight"] = parseInt($(e.target).val()); saveProfileToMemory(); });
        $("#ig_neg").on("input", (e) => { s.customNegative = $(e.target).val(); saveProfileToMemory(); });
        $("#ig_seed").on("input", (e) => { s.customSeed = parseInt($(e.target).val()); saveProfileToMemory(); });

        // Sliders
        const bindSlider = (id, key, isFloat) => {
            $(`#ig_${id}`).on("input", function() { let v = isFloat ? parseFloat(this.value) : parseInt(this.value); s[key] = v; $(`#ig_${id}_val`).val(v); saveProfileToMemory(); });
            $(`#ig_${id}_val`).on("input", function() { let v = isFloat ? parseFloat(this.value) : parseInt(this.value); s[key] = v; $(`#ig_${id}`).val(v); saveProfileToMemory(); });
        };
        bindSlider("steps", "steps", false); bindSlider("cfg", "cfg", true); bindSlider("denoise", "denoise", true); bindSlider("clip", "clipSkip", false);

        // Resolutions
        const resSel = $("#ig_res_preset");
        resSel.empty().append('<option value="">-- Select Preset --</option>');
        RESOLUTIONS.forEach((r, idx) => resSel.append(`<option value="${idx}">${r.label}</option>`));
        resSel.on("change", (e) => {
            const idx = parseInt($(e.target).val());
            if (!isNaN(idx) && RESOLUTIONS[idx]) { $("#ig_w").val(RESOLUTIONS[idx].w).trigger("input"); $("#ig_h").val(RESOLUTIONS[idx].h).trigger("input"); }
        });

        // LoRAs
        for(let i=1; i<=4; i++) {
            const key = i===1 ? "selectedLora" : `selectedLora${i}`;
            const wtKey = i===1 ? "selectedLoraWt" : `selectedLoraWt${i}`;
            $(`#ig_lora_${i}`).on("change", (e) => {
                s[key] = $(e.target).val();
                ensureImageGenLoraArrays(s);
                s.loraSlotKeywordManaged[i - 1] = false;
                if (s.selectedModel === RUNPOD_KREA_MODEL) ensureRunpodSettings(s).defaultKreaLoraApplied = true;
                saveProfileToMemory();
            });
            $(`#ig_lorawt_${i}`).on("input", function() { let v = parseFloat(this.value); s[wtKey] = v; $(`#ig_lorawt_lbl_${i}`).text(v); saveProfileToMemory(); });
            $(`#ig_lorawt_${i}`).on("change", function() { saveProfileToMemory(); });
            $(`#ig_lora_lock_${i}`).on("click", function() {
                ensureImageGenLoraArrays(s);
                s.loraSlotLocked[i - 1] = !s.loraSlotLocked[i - 1];
                $(this).find("i").attr("class", s.loraSlotLocked[i - 1] ? "fa-solid fa-lock" : "fa-solid fa-lock-open");
                saveProfileToMemory();
            });
        }

        // Models & Samplers
        $("#ig_model").on("change", (e) => {
            s.selectedModel = $(e.target).val();
            if (ensureRunpodSettings(s).enabled) ensureRunpodDropdownValues(s);
            saveProfileToMemory();
            syncKreaLoraFinderUi(s);
            renderImageGen(c);
        });
        $("#ig_sampler").on("change", (e) => { s.selectedSampler = $(e.target).val(); saveProfileToMemory(); });
        $("#ig_scheduler").on("change", (e) => { s.selectedScheduler = $(e.target).val(); saveProfileToMemory(); });

        // Buttons
        $("#ig_test_btn").on("click", igTestConnection);

        // Workflow Managers
        $("#ig_new_wf").on("click", igNewWorkflowClick);
        $("#ig_edit_wf").on("click", igOpenWorkflowEditorClick);
        $("#ig_del_wf").on("click", igDeleteWorkflowClick);
        $("#ig_workflow_list").on("change", (e) => {
            const newWorkflow = $(e.target).val();
            const oldWorkflow = s.currentWorkflowName;
            if (oldWorkflow) {
                if (!s.savedWorkflowStates) s.savedWorkflowStates = {};
                s.savedWorkflowStates[oldWorkflow] = igBuildWorkflowStateSnapshot(s);
            }
            let shouldRenderWorkflowState = false;
            if (s.savedWorkflowStates && s.savedWorkflowStates[newWorkflow]) {
                const workflowState = igNormalizeWorkflowStateSnapshot(s.savedWorkflowStates[newWorkflow]);
                Object.assign(s, workflowState);
                ensureImageGenLoraArrays(s);
                toastr.success(`Restored settings for ${newWorkflow}`);
                shouldRenderWorkflowState = true;
            } else { toastr.info(`New workflow context active`); }

            s.currentWorkflowName = newWorkflow;
            saveProfileToMemory();
            if (shouldRenderWorkflowState) renderImageGen(c); // Re-render to update UI with restored values
        });

        if (s.enabled) {
            igPopulateWorkflows();
            igFetchComfyLists();
        }

        // --- LoRA Intelligence Event Bindings ---
        $("#li_enable_toggle").on("click", function() {
            li.enabled = !li.enabled; saveProfileToMemory(); renderImageGen(c);
        });
        $("#li_collapse_btn").on("click", function(e) {
            e.stopPropagation();
            const $panel = $(this).closest("[data-ig-collapse]");
            const key = $panel.attr("data-ig-collapse");
            if (!key) return;
            const $body = $panel.children(`[data-ig-collapse-body="${key}"]`);
            if (!$body.length) return;
            const nextOpen = !$body.is(":visible");
            s.sectionOpenStates[key] = nextOpen;
            saveProfileToMemory();
            const rotate = nextOpen ? "rotate(180deg)" : "none";
            $panel.find(".ig-section-chevron").css("transform", rotate);
            $(this).find("i").css("transform", rotate);
            $body.stop(true, true)[nextOpen ? "slideDown" : "slideUp"](180);
        });
        $("#li_analysis_mode").on("change", function() {
            const mode = $(this).val() || "booru";
            li.ensureLoras = false;
            li.naturalLoraMode = mode === "natural_lora";
            li.useDanbooruTags = mode === "booru";
            li.useCharDescriptions = mode === "natural" || mode === "natural_lora";
            li.descriptionStyle = "natural";
            saveProfileToMemory();
            renderImageGen(c);
        });
        $("#li_ensure_char_tag_wrap").on("click", function(e) {
            e.stopPropagation();
            li.ensureCharacterTag = !li.ensureCharacterTag; saveProfileToMemory(); renderImageGen(c);
        });
        const bindLiTagToggle = (id, key) => {
            $(`#${id}`).on("click", function() {
                li.tagFieldToggles[key] = !li.tagFieldToggles[key];
                saveProfileToMemory();
                renderImageGen(c);
            });
        };
        bindLiTagToggle("li_field_character", "characterTag");
        bindLiTagToggle("li_field_series", "seriesTag");
        bindLiTagToggle("li_field_physical", "physicalTags");
        bindLiTagToggle("li_field_clothing", "clothingTags");
        $("#ig_manual_render_btn").on("click", igRenderManualPrompt);
        $("#ig_manual_prompt").on("input", (e) => { s.manualPrompt = $(e.target).val(); saveProfileToMemory(); });
        $("#ig_manual_prompt_feedback").on("input", (e) => { s.manualPromptFeedback = $(e.target).val(); saveProfileToMemory(); });
        $("#ig_apply_position_preset").on("click", () => applyPromptPresetToTextarea("#ig_nsfw_position_preset", "#ig_manual_prompt", s, "manualPrompt"));
        $("#ig_add_character_tags").on("click", () => igAddCharacterInfoToManualPrompt(s, li, charKey));
        $("#ig_use_last_prompt_btn").on("click", () => {
            const last = String(s.lastGeneratedImagePrompt || $("#ig_last_image_prompt").val() || "").trim();
            if (!last) return toastr.warning("No last generated image prompt available yet.");
            igSetManualPromptValue(s, last, { recordUndo: true, toast: "Last generated prompt loaded into Manual Prompt." });
        });
        $("#ig_copy_last_prompt_btn").on("click", async () => {
            const last = String(s.lastGeneratedImagePrompt || $("#ig_last_image_prompt").val() || "").trim();
            if (!last) return toastr.warning("No last generated image prompt available yet.");
            try {
                await navigator.clipboard.writeText(last);
                toastr.success("Last generated prompt copied.");
            } catch (e) {
                toastr.error("Could not copy to clipboard.");
            }
        });
        $("#ig_manual_undo_btn").on("click", () => igUndoManualPrompt(s));
        $("#ig_manual_regen_feedback_btn").on("click", function() {
            igRegenerateManualPromptWithFeedback(s, $(this));
        });
        $("#li_prompt_assembly_mode").on("change", function() {
            li.promptAssemblyMode = $(this).val();
            saveProfileToMemory();
        });
        $("#li_assignment_view_mode").on("change", function() {
            li.assignmentViewMode = $(this).val();
            saveProfileToMemory();
            renderImageGen(c);
        });
        $("#li_send_all_chars_toggle").on("click", function(e) {
            e.stopPropagation();
            li.sendAllCharactersToPromptAi = !li.sendAllCharactersToPromptAi;
            saveProfileToMemory();
            const on = !!li.sendAllCharactersToPromptAi;
            $(this).toggleClass("active", on);
            $(this).css({
                borderColor: on ? "rgba(245,158,11,0.55)" : "",
                background: on ? "rgba(245,158,11,0.08)" : ""
            });
            $(this).find("span").first().css("color", on ? "#fbbf24" : "");
            $(this).find(".ps-switch").css("background", on ? "#f59e0b" : "");
        });

        // Prompt preview toggle
        $("#li_prompt_preview_header").on("click", function() {
            const body = $("#li_prompt_preview_body");
            const chevron = $("#li_prompt_chevron");
            const nextOpen = !body.is(":visible");
            s.sectionOpenStates["debug-viewers"] = nextOpen;
            saveProfileToMemory();
            if (nextOpen) { body.slideDown(200); chevron.css("transform", "rotate(180deg)"); }
            else { body.slideUp(200); chevron.css("transform", "rotate(0deg)"); }
        });
        $("#li_last_comfy_req_view").on("change", function() { igRefreshLastComfyApiPanel(); });
        $("#li_last_comfy_req_copy").on("click", async function() {
            const t = $("#li_last_comfy_req_body").val();
            try {
                await navigator.clipboard.writeText(t);
                toastr.success("Copied to clipboard");
            } catch (e) {
                toastr.error("Copy failed");
            }
        });
        $("#li_last_analysis_copy").on("click", async function() {
            const t = $("#li_last_analysis_body").val();
            try {
                await navigator.clipboard.writeText(t);
                toastr.success("Copied to clipboard");
            } catch (e) {
                toastr.error("Copy failed");
            }
        });
        $("#li_analysis_export_btn").on("click", function() {
            const scope = "global";
            downloadCharacterAnalysisSnapshot(li, charKey, scope);
            toastr.success(`Exported ${countModeCharacterAssignments(li, charKey)} ${getAssignmentModeLabel(li)} character assignments.`);
        });
        $("#li_analysis_import_btn").on("click", function() {
            $("#li_analysis_import_file").trigger("click");
        });
        $("#li_analysis_import_file").on("change", function(e) {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const payload = JSON.parse(String(event.target.result || ""));
                    const sourceNote = payload.sourceCharacterKey && payload.sourceCharacterKey !== charKey
                        ? ` It was exported from "${payload.sourceCharacterKey}" and will restore into the current character.`
                        : "";
                    if (!window.confirm(`Replace the current character-analysis assignments and mode settings with this snapshot?${sourceNote}`)) return;
                    const restored = applyCharacterAnalysisSnapshot(li, charKey, payload);
                    saveProfileToMemory();
                    renderImageGen(c);
                    toastr.success(`Restored ${restored.count} assignments (${restored.mode} mode).`);
                } catch (error) {
                    console.error("[Megumin Suite] Character-analysis import failed:", error);
                    toastr.error(error.message || "Character-analysis import failed.");
                }
            };
            reader.onerror = () => toastr.error("Could not read the snapshot file.");
            reader.readAsText(file);
            $(this).val("");
        });
        igRefreshLastComfyApiPanel();

        // AI Character Assignment
        async function runCharacterAnalysis(btn, feedback = "") {
            const chatText = getCleanedChatHistory();
            const characterTextContext = getCurrentCharacterTextContext();
            const analysisTextLength = [
                chatText,
                characterTextContext.description,
                characterTextContext.firstMessage
            ].join("\n").trim().length;
            if (analysisTextLength < 50) return toastr.warning("Not enough chat or character card context to analyze characters.");

            const busyHtml = feedback
                ? '<i class="fa-solid fa-spinner fa-spin"></i> Regenerating...'
                : '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing...';

            $("#li_analyze_btn, #li_regen_feedback_btn").prop("disabled", true);
            btn.html(busyHtml);

            try {
                if (li.useDanbooruTags) await loadDanbooruTags();

                const previousAssignments = JSON.stringify(getModeCharacterAssignments(li, charKey), null, 2);

                activeLoraAssignRequest = {
                    chatText: chatText,
                    cardDescription: characterTextContext.description,
                    firstMessage: characterTextContext.firstMessage,
                    useTags: li.useDanbooruTags,
                    ensureCharacterTag: li.ensureCharacterTag,
                    useDescriptions: li.useCharDescriptions,
                    descStyle: li.descriptionStyle,
                    feedback: feedback,
                    previousAssignments: feedback ? previousAssignments : ""
                };

                let rawOutput;
                if (s.generatorBackend === "direct") {
                    rawOutput = await generateQuietPrompt({ prompt: "___PS_LORA_ASSIGN___" });
                } else {
                    let presetResult;
                    await useMeguminEngine(async () => {
                        presetResult = await generateQuietPrompt({ prompt: "___PS_LORA_ASSIGN___" });
                    });
                    rawOutput = presetResult;
                }
                activeLoraAssignRequest = null;

                if (!rawOutput) {
                    toastr.warning("AI returned empty response. Try again.");
                    return;
                }
                rawOutput = stripUtilityThinkingWrapper(rawOutput);
                li.lastCharacterAnalysisResponse = rawOutput;
                $("#li_last_analysis_body").val(rawOutput);
                saveProfileToMemory();

                // Parse the AI response
                try {
                    const assignments = parseCharacterAssignmentsResponse(rawOutput);
                    if (assignments.length > 0) {
                        let ensuredCharacterTagFallbacks = 0;

                        if (li.useDanbooruTags) {
                            for (const a of assignments) {
                                ensureStructuredCharacterAssignment(a);
                                ['booru_tags', 'character_tag', 'series_tag', 'physical_tags', 'clothing_tags'].forEach(key => {
                                    if (!a[key]) return;
                                    const repairedTags = danbooruTagsMap && danbooruTagsMap.size > 0 ? repairBooruTags(a[key]) : a[key];
                                    a[key] = normalizeGeneratedTagField(repairedTags);
                                });
                                const hasVerifiedCharacterTag = ensureBooruCharacterTag(a);
                                if (li.ensureCharacterTag && !hasVerifiedCharacterTag) {
                                    ensuredCharacterTagFallbacks += 1;
                                }
                                if (!li.useCharDescriptions) {
                                    a.description = "";
                                    a.plain_description = "";
                                }
                                normalizeStructuredCharacterAssignment(a);
                            }
                        }

                        setModeCharacterAssignments(li, charKey, assignments);
                        saveProfileToMemory();
                        liRenderAssignmentTable(li, charKey, s);
                        toastr.success(feedback ? `Regenerated ${assignments.length} characters with feedback.` : `Mapped ${assignments.length} characters!`);
                        if (ensuredCharacterTagFallbacks > 0) {
                            toastr.warning(`Ensure Character Tag found no verified Danbooru character tag for ${ensuredCharacterTagFallbacks} character(s); left those character tags empty.`);
                        }
                    } else {
                        toastr.warning("AI response couldn't be parsed. Try again.");
                        console.log("[Megumin Suite] Raw LoRA assignment output:", rawOutput);
                    }
                } catch (parseErr) {
                    toastr.warning("Failed to parse AI assignment response.");
                    console.error("[Megumin Suite] Parse error:", parseErr, rawOutput);
                }
            } catch (e) {
                toastr.error("Character analysis failed.");
                console.error(e);
            } finally {
                activeLoraAssignRequest = null;
                $("#li_analyze_btn").prop("disabled", false).html('<i class="fa-solid fa-bolt"></i> Analyze Characters');
                $("#li_regen_feedback_btn").prop("disabled", false).html('<i class="fa-solid fa-rotate"></i> Regenerate With Feedback');
            }
        }

        $("#li_analysis_feedback").on("input", function() {
            li.characterAnalysisFeedback = $(this).val();
            saveProfileToMemory();
        });
        $("#li_analyze_btn").on("click", async function() {
            await runCharacterAnalysis($(this));
        });
        $("#li_regen_feedback_btn").on("click", async function() {
            const feedback = String($("#li_analysis_feedback").val() || "").trim();
            if (!feedback) return toastr.warning("Add feedback first, then regenerate.");
            li.characterAnalysisFeedback = feedback;
            saveProfileToMemory();
            await runCharacterAnalysis($(this), feedback);
        });

        // Populate assignment table if enabled
        if (s.enabled && li.enabled) {
            liRenderAssignmentTable(li, charKey, s);
        }
    }

    function liTagFieldToggle(id, label, enabled) {
        return `
            <div id="${id}" class="ps-toggle-card ${enabled ? 'active' : ''}" style="padding: 8px 10px; min-height: auto; cursor: pointer; border-color: ${enabled ? 'rgba(16,185,129,0.45)' : 'var(--border-color)'};">
                <span style="font-size: 0.7rem; font-weight: 800; color: ${enabled ? '#10b981' : 'var(--text-muted)'};">${label}</span>
                <div class="ps-switch" style="transform: scale(0.65);"></div>
            </div>
        `;
    }

    function appendPromptTextToTextarea(textareaSelector, snippet) {
        const prompt = String(snippet || "").trim();
        if (!prompt) return "";
        const textarea = $(textareaSelector);
        const current = String(textarea.val() || "").trim();
        const next = current ? `${current}, ${prompt}` : prompt;
        textarea.val(next);
        return next;
    }

    function applyPromptPresetToTextarea(selectSelector, textareaSelector, settingsObj, fieldName) {
        const next = appendPromptTextToTextarea(textareaSelector, $(selectSelector).val());
        if (!next) return;
        settingsObj[fieldName] = next;
        saveProfileToMemory();
        toastr.success("Preset added to manual prompt.");
    }

    // -------------------------------------------------------------
    // STAGE 8 HELPER FUNCTIONS
    // -------------------------------------------------------------
    const MALCOLMREY_KREA_FILENAME_RE = /^krea2_[a-z0-9_().-]+\.safetensors$/i;

    function prettyKreaLoraName(filename) {
        return String(filename || "")
            .replace(/^krea2_/i, "")
            .replace(/_v\d+(?:_onetrainer)?\.safetensors$/i, "")
            .replace(/_onetrainer\.safetensors$/i, "")
            .replace(/\.safetensors$/i, "")
            .replace(/[_-]+/g, " ")
            .replace(/\b\w/g, letter => letter.toUpperCase());
    }

    // Malcolmrey's index has a confirmed shape: { filenames: { "<characterkey>": { krea2: [...], lora: [...], ... } } }.
    // Read that exact shape first so name lookup is deterministic, and only fall
    // back to a generic recursive scan (matching just the krea2_*.safetensors
    // pattern) if Hugging Face ever changes the wrapper so the Finder still
    // degrades gracefully instead of silently returning zero results.
    function collectMalcolmreyKreaEntries(json) {
        const entries = [];
        const seenFilenames = new Set();
        const addEntry = (charKey, filename) => {
            const name = String(filename || "").trim();
            if (!MALCOLMREY_KREA_FILENAME_RE.test(name) || seenFilenames.has(name)) return;
            seenFilenames.add(name);
            entries.push({ charKey: String(charKey || "").trim(), filename: name });
        };

        const root = json && typeof json === "object" ? json : {};
        const table = root.filenames && typeof root.filenames === "object" && !Array.isArray(root.filenames)
            ? root.filenames
            : null;
        if (table) {
            Object.entries(table).forEach(([charKey, record]) => {
                const krea2List = record && typeof record === "object" && Array.isArray(record.krea2) ? record.krea2 : null;
                if (krea2List) krea2List.forEach(filename => addEntry(charKey, filename));
            });
        }

        if (entries.length === 0) {
            const seen = new WeakSet();
            const walk = (value) => {
                if (typeof value === "string") return addEntry("", value);
                if (!value || typeof value !== "object" || seen.has(value)) return;
                seen.add(value);
                (Array.isArray(value) ? value : Object.values(value)).forEach(walk);
            };
            walk(root);
        }
        return entries;
    }

    function prettyKreaCharacterLabel(charKey, filename) {
        const base = String(charKey || "").trim();
        let label = base ? base.replace(/\b\w/g, letter => letter.toUpperCase()) : prettyKreaLoraName(filename);
        const variant = String(filename || "").match(/_v(\d+)(_onetrainer)?\.safetensors$/i);
        if (variant) label = `${label} (v${variant[1]}${variant[2] ? " OneTrainer" : ""})`;
        return label;
    }

    async function loadBakedKreaLoras() {
        if (bakedKreaLoraCache) return bakedKreaLoraCache;
        if (bakedKreaLoraLoad) return bakedKreaLoraLoad;
        bakedKreaLoraLoad = fetch(KREA_BAKED_LORA_MANIFEST_URL, { cache: "no-cache" })
            .then(async response => {
                if (!response.ok) throw new Error(`Baked Krea LoRA manifest request failed (${response.status}).`);
                const manifest = await response.json();
                if (!Array.isArray(manifest)) throw new Error("Baked Krea LoRA manifest must be an array.");
                bakedKreaLoraCache = manifest.map(item => {
                    const filename = String(item?.filename || "").trim();
                    if (!/^[^\\/]+\.safetensors$/i.test(filename)) return null;
                    return {
                        filename,
                        label: String(item?.label || prettyKreaLoraName(filename)).trim(),
                        reference: filename,
                        source: "Baked"
                    };
                }).filter(Boolean);
                return bakedKreaLoraCache;
            })
            .finally(() => { bakedKreaLoraLoad = null; });
        return bakedKreaLoraLoad;
    }

    async function loadBakedAnimaLoras() {
        if (bakedAnimaLoraCache) return bakedAnimaLoraCache;
        if (bakedAnimaLoraLoad) return bakedAnimaLoraLoad;
        bakedAnimaLoraLoad = fetch(ANIMA_BAKED_LORA_MANIFEST_URL, { cache: "no-cache" })
            .then(async response => {
                if (!response.ok) throw new Error(`Baked Anima LoRA manifest request failed (${response.status}).`);
                const manifest = await response.json();
                if (!Array.isArray(manifest)) throw new Error("Baked Anima LoRA manifest must be an array.");
                bakedAnimaLoraCache = manifest.map(item => {
                    const filename = String(item?.filename || "").trim();
                    if (!/^[^\\/]+\.safetensors$/i.test(filename)) return null;
                    return {
                        filename,
                        label: String(item?.label || prettyKreaLoraName(filename)).trim(),
                        reference: filename,
                        source: "Baked"
                    };
                }).filter(Boolean);
                return bakedAnimaLoraCache;
            })
            .finally(() => { bakedAnimaLoraLoad = null; });
        return bakedAnimaLoraLoad;
    }

    async function loadRunpodBakedLoraBundles() {
        const [anima, krea] = await Promise.all([
            loadBakedAnimaLoras().catch(error => {
                console.warn("[Megumin Suite] Could not load baked Anima LoRA manifest:", error);
                return [];
            }),
            loadBakedKreaLoras().catch(error => {
                console.warn("[Megumin Suite] Could not load baked Krea LoRA manifest:", error);
                return [];
            })
        ]);
        return { anima, krea };
    }

    async function loadMalcolmreyKreaLoras() {
        if (malcolmreyKreaLoraLoad) return malcolmreyKreaLoraLoad;
        // Revalidate every time Finder opens: Malcolmrey's index changes often.
        malcolmreyKreaLoraLoad = fetch(MALCOLMREY_BROWSER_INDEX_URL, { cache: "no-cache" })
            .then(async response => {
                if (!response.ok) throw new Error(`Malcolmrey index request failed (${response.status}).`);
                const json = await response.json();
                const entries = collectMalcolmreyKreaEntries(json)
                    .sort((a, b) => a.filename.localeCompare(b.filename));
                if (!entries.length) throw new Error("The Malcolmrey index did not contain any Krea 2 LoRA filenames.");
                malcolmreyKreaLoraCache = entries.map(({ charKey, filename }) => ({
                    filename,
                    label: prettyKreaCharacterLabel(charKey, filename),
                    reference: `hf://${MALCOLMREY_KREA_REPOSITORY}/${filename}`,
                    source: "Runtime"
                }));
                return malcolmreyKreaLoraCache;
            })
            .finally(() => { malcolmreyKreaLoraLoad = null; });
        return malcolmreyKreaLoraLoad;
    }

    // -------------------------------------------------------------
    // KREA LORA GALLERY — data loading + local caching
    // -------------------------------------------------------------
    const MALCOLMREY_THUMBNAIL_INDEX_URL = "https://huggingface.co/spaces/malcolmrey/browser/resolve/main/data-thumbnails.json";
    const MALCOLMREY_THUMBNAIL_BASE_URL = "https://huggingface.co/datasets/malcolmrey/samples/resolve/main/thumbnails/";
    const KREA_GALLERY_CACHE_KEY = "megumin_krea_gallery_cache_v1";
    const KREA_GALLERY_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
    const KREA_THUMB_DB_NAME = "megumin_krea_thumbs_v1";
    const KREA_THUMB_STORE = "thumbs";
    const KREA_THUMB_FETCH_CONCURRENCY = 4;

    let kreaGalleryEntriesCache = null; // in-memory, cleared on full page reload
    let kreaGalleryEntriesLoad = null;  // in-flight promise, avoids duplicate fetches
    let kreaThumbDbPromise = null;
    const kreaThumbBlobUrlByKey = new Map(); // cacheKey -> objectURL (session reuse)
    const kreaThumbInflight = new Map(); // cacheKey -> Promise<string|null>

    function kreaGalleryThumbnailUrl(charKey) {
        return `${MALCOLMREY_THUMBNAIL_BASE_URL}${encodeURIComponent(charKey)}.jpg`;
    }

    function readKreaGalleryLocalCache() {
        try {
            const raw = localStorage.getItem(KREA_GALLERY_CACHE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || !Array.isArray(parsed.entries) || typeof parsed.ts !== "number") return null;
            if (Date.now() - parsed.ts > KREA_GALLERY_CACHE_TTL_MS) return null;
            return parsed.entries;
        } catch (e) { return null; }
    }

    function writeKreaGalleryLocalCache(entries) {
        try {
            localStorage.setItem(KREA_GALLERY_CACHE_KEY, JSON.stringify({ ts: Date.now(), entries }));
        } catch (e) { /* localStorage full or unavailable — non-fatal, just skip caching */ }
    }

    function clearKreaGalleryIndexCache() {
        kreaGalleryEntriesCache = null;
        try { localStorage.removeItem(KREA_GALLERY_CACHE_KEY); } catch (e) { /* ignore */ }
    }

    function openKreaThumbDb() {
        if (kreaThumbDbPromise) return kreaThumbDbPromise;
        if (typeof indexedDB === "undefined") {
            kreaThumbDbPromise = Promise.reject(new Error("IndexedDB unavailable"));
            return kreaThumbDbPromise;
        }
        kreaThumbDbPromise = new Promise((resolve, reject) => {
            let req;
            try { req = indexedDB.open(KREA_THUMB_DB_NAME, 1); }
            catch (e) { reject(e); return; }
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(KREA_THUMB_STORE)) {
                    db.createObjectStore(KREA_THUMB_STORE, { keyPath: "key" });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
        }).catch(err => {
            kreaThumbDbPromise = null;
            throw err;
        });
        return kreaThumbDbPromise;
    }

    async function readKreaThumbBlob(cacheKey) {
        try {
            const db = await openKreaThumbDb();
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(KREA_THUMB_STORE, "readonly");
                const req = tx.objectStore(KREA_THUMB_STORE).get(cacheKey);
                req.onsuccess = () => {
                    const row = req.result;
                    resolve(row && row.blob instanceof Blob ? row.blob : null);
                };
                req.onerror = () => reject(req.error);
            });
        } catch (e) { return null; }
    }

    async function writeKreaThumbBlob(cacheKey, blob) {
        if (!(blob instanceof Blob) || !cacheKey) return;
        try {
            const db = await openKreaThumbDb();
            await new Promise((resolve, reject) => {
                const tx = db.transaction(KREA_THUMB_STORE, "readwrite");
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
                tx.objectStore(KREA_THUMB_STORE).put({
                    key: cacheKey,
                    blob,
                    mime: blob.type || "image/jpeg",
                    ts: Date.now(),
                });
            });
        } catch (e) { /* quota / private mode — non-fatal */ }
    }

    function kreaThumbObjectUrlFromBlob(cacheKey, blob) {
        const existing = kreaThumbBlobUrlByKey.get(cacheKey);
        if (existing) return existing;
        const url = URL.createObjectURL(blob);
        kreaThumbBlobUrlByKey.set(cacheKey, url);
        return url;
    }

    async function resolveKreaThumbDisplayUrl(remoteUrl, opts = {}) {
        const cacheKey = String(remoteUrl || "").trim();
        const forceReload = !!opts.forceReload;
        if (!cacheKey) return null;
        if (!forceReload && kreaThumbBlobUrlByKey.has(cacheKey)) return kreaThumbBlobUrlByKey.get(cacheKey);
        if (!forceReload && kreaThumbInflight.has(cacheKey)) return kreaThumbInflight.get(cacheKey);

        const work = (async () => {
            if (!forceReload) {
                const cached = await readKreaThumbBlob(cacheKey);
                if (cached) return kreaThumbObjectUrlFromBlob(cacheKey, cached);
            }
            try {
                const res = await fetch(cacheKey, {
                    mode: "cors",
                    credentials: "omit",
                    cache: forceReload ? "reload" : "force-cache",
                });
                if (!res.ok) return null;
                const blob = await res.blob();
                // HF sometimes serves thumbs as octet-stream / empty MIME — still accept image-looking blobs.
                const mime = String(blob.type || "").toLowerCase();
                const looksImage = !mime || mime.startsWith("image/") || mime === "application/octet-stream";
                if (!(blob instanceof Blob) || !blob.size || !looksImage) return null;
                await writeKreaThumbBlob(cacheKey, blob);
                // Replace any prior object URL for this key after a forced reload.
                if (forceReload && kreaThumbBlobUrlByKey.has(cacheKey)) {
                    try { URL.revokeObjectURL(kreaThumbBlobUrlByKey.get(cacheKey)); } catch (e) { /* ignore */ }
                    kreaThumbBlobUrlByKey.delete(cacheKey);
                }
                return kreaThumbObjectUrlFromBlob(cacheKey, blob);
            } catch (e) {
                return null; // CORS / network — remote <img src> remains the display path
            }
        })().finally(() => { kreaThumbInflight.delete(cacheKey); });

        kreaThumbInflight.set(cacheKey, work);
        return work;
    }

    // Prefer IndexedDB/blob when available; never block first paint on network fetch.
    // Misses keep the remote src visible and warm the cache in the background.
    // Keep data-thumb-url so blank/failed thumbs can be retried later.
    async function hydrateKreaGalleryThumbs($root, { concurrency = KREA_THUMB_FETCH_CONCURRENCY } = {}) {
        const imgs = ($root.find ? $root.find("img.kg-thumb[data-thumb-url]") : $()).toArray();
        if (!imgs.length) return;
        let cursor = 0;
        const workerCount = Math.max(1, Math.min(concurrency, imgs.length));
        async function worker() {
            while (cursor < imgs.length) {
                const img = imgs[cursor++];
                if (!img || !img.isConnected) continue;
                const remote = img.getAttribute("data-thumb-url");
                if (!remote) continue;

                // Instant session/memory hit
                const memoryHit = kreaThumbBlobUrlByKey.get(remote);
                if (memoryHit) {
                    img.src = memoryHit;
                    continue;
                }

                // Fast IndexedDB lookup — only swap if we already have bytes locally
                const cached = await readKreaThumbBlob(remote);
                if (!img.isConnected) continue;
                if (cached) {
                    img.src = kreaThumbObjectUrlFromBlob(remote, cached);
                    continue;
                }

                // Keep remote src painting now; cache opportunistically for next time
                resolveKreaThumbDisplayUrl(remote).catch(() => {});
            }
        }
        await Promise.all(Array.from({ length: workerCount }, () => worker()));
    }

    function kreaThumbFallbackHtml(remoteUrl) {
        const attr = remoteUrl ? ` data-thumb-url="${psEscapeAttr(remoteUrl)}"` : "";
        return `<div class="kg-thumb-fallback kg-thumb-missing"${attr}><i class="fa-solid fa-image"></i></div>`;
    }

    function kreaThumbImgHtml(remoteUrl, srcUrl) {
        return `<img class="kg-thumb" data-thumb-url="${psEscapeAttr(remoteUrl)}" src="${psEscapeAttr(srcUrl || remoteUrl)}" loading="eager" decoding="async" alt="" style="width:100%; height:100%; object-fit:cover; border-radius:8px; background:rgba(255,255,255,0.04);">`;
    }

    function waitForImageLoad(img) {
        return new Promise(resolve => {
            if (!img) { resolve(false); return; }
            const finish = (ok) => {
                img.onload = null;
                img.onerror = null;
                resolve(!!ok);
            };
            if (img.complete) {
                finish(img.naturalWidth > 0);
                return;
            }
            img.onload = () => finish(true);
            img.onerror = () => finish(false);
        });
    }

    // Reload only blank/broken thumbs currently visible in the gallery page.
    async function retryBlankKreaGalleryThumbs($root, { concurrency = KREA_THUMB_FETCH_CONCURRENCY } = {}) {
        if (!$root || !$root.length) return { attempted: 0, recovered: 0 };
        const targets = [];

        $root.find(".kg-thumb-fallback[data-thumb-url]").each(function() {
            const remote = String($(this).attr("data-thumb-url") || "").trim();
            if (remote) targets.push({ el: this, remote });
        });

        $root.find("img.kg-thumb[data-thumb-url]").each(function() {
            const remote = String(this.getAttribute("data-thumb-url") || "").trim();
            if (!remote) return;
            if (this.complete && this.naturalWidth > 0) return;
            targets.push({ el: this, remote });
        });

        if (!targets.length) return { attempted: 0, recovered: 0 };

        let cursor = 0;
        let recovered = 0;
        const workerCount = Math.max(1, Math.min(concurrency, targets.length));

        async function worker() {
            while (cursor < targets.length) {
                const item = targets[cursor++];
                if (!item || !item.el || !item.el.isConnected) continue;

                const localUrl = await resolveKreaThumbDisplayUrl(item.remote, { forceReload: true });
                if (!item.el.isConnected) continue;

                const nextSrc = localUrl || `${item.remote}${item.remote.includes("?") ? "&" : "?"}kgretry=${Date.now()}`;
                let img = item.el.tagName === "IMG" ? item.el : null;

                if (!img) {
                    const $img = $(kreaThumbImgHtml(item.remote, nextSrc));
                    $(item.el).replaceWith($img);
                    img = $img[0];
                } else {
                    img.src = nextSrc;
                }

                const ok = await waitForImageLoad(img);
                if (!img.isConnected) continue;
                if (ok) recovered += 1;
                else $(img).replaceWith(kreaThumbFallbackHtml(item.remote));
            }
        }

        await Promise.all(Array.from({ length: workerCount }, () => worker()));
        return { attempted: targets.length, recovered };
    }

    // Returns [{ filename, label, reference, source: "Runtime"|"Baked", thumbUrl: string|null }]
    async function loadKreaGalleryEntries(opts = {}) {
        const forceRefresh = !!opts.forceRefresh;
        if (!forceRefresh && kreaGalleryEntriesCache) return kreaGalleryEntriesCache;
        if (!forceRefresh) {
            const cached = readKreaGalleryLocalCache();
            if (cached) { kreaGalleryEntriesCache = cached; return cached; }
        }
        if (kreaGalleryEntriesLoad) return kreaGalleryEntriesLoad;

        kreaGalleryEntriesLoad = (async () => {
            const [filenamesRes, thumbsRes, bakedList] = await Promise.all([
                fetch(MALCOLMREY_BROWSER_INDEX_URL, { cache: forceRefresh ? "no-cache" : "default" }),
                fetch(MALCOLMREY_THUMBNAIL_INDEX_URL, { cache: forceRefresh ? "no-cache" : "default" }).catch(() => null),
                loadBakedKreaLoras().catch(() => []),
            ]);
            if (!filenamesRes.ok) throw new Error(`Malcolmrey index request failed (${filenamesRes.status}).`);
            const filenamesJson = await filenamesRes.json();
            let thumbnailSet = {};
            if (thumbsRes && thumbsRes.ok) {
                try { thumbnailSet = await thumbsRes.json(); } catch (e) { thumbnailSet = {}; }
            }

            const rawEntries = collectMalcolmreyKreaEntries(filenamesJson)
                .sort((a, b) => a.filename.localeCompare(b.filename));
            if (!rawEntries.length) throw new Error("The Malcolmrey index did not contain any Krea 2 LoRA filenames.");

            const runtimeEntries = rawEntries.map(({ charKey, filename }) => ({
                filename,
                label: prettyKreaCharacterLabel(charKey, filename),
                reference: `hf://${MALCOLMREY_KREA_REPOSITORY}/${filename}`,
                source: "Runtime",
                thumbUrl: thumbnailSet[charKey] ? kreaGalleryThumbnailUrl(charKey) : null,
            }));

            const bakedEntries = (Array.isArray(bakedList) ? bakedList : []).map(item => ({
                filename: item.filename,
                label: item.label || prettyKreaLoraName(item.filename),
                reference: item.reference,
                source: "Baked",
                thumbUrl: null,
            }));

            const combined = [...bakedEntries, ...runtimeEntries];
            kreaGalleryEntriesCache = combined;
            writeKreaGalleryLocalCache(combined);
            return combined;
        })().finally(() => { kreaGalleryEntriesLoad = null; });

        return kreaGalleryEntriesLoad;
    }

    async function openKreaGalleryAssignPopup(s, li, charKey, reference, label) {
        const rows = getModeCharacterAssignments(li, charKey);
        const slotLabels = [1, 2, 3, 4].map(i => {
            const key = i === 1 ? "selectedLora" : `selectedLora${i}`;
            const current = s[key] ? String(s[key]).split("/").pop() : "(empty)";
            return `<button type="button" class="ps-modern-btn secondary kg-assign-slot" data-slot="${i}" style="width:100%; text-align:left; padding:10px; margin-bottom:6px; font-size:0.78rem;">Slot ${i} — <span style="color:var(--text-muted);">${psEscapeText(current)}</span></button>`;
        }).join("");
        const charRows = rows.length
            ? rows.map((a, idx) => `<button type="button" class="ps-modern-btn secondary kg-assign-char" data-idx="${idx}" style="width:100%; text-align:left; padding:10px; margin-bottom:6px; font-size:0.78rem;">${psEscapeText(a.character || `Character ${idx + 1}`)} — <span style="color:var(--text-muted);">${psEscapeText(a.lora || "(no LoRA set)")}</span></button>`).join("")
            : `<div style="font-size:0.75rem; color:var(--text-muted); padding:6px 0;">No analyzed characters yet for this chat. Use Character Analysis first, or assign to a slot above.</div>`;

        const $content = $(`
            <div style="max-height:70vh; overflow-y:auto;">
                <div style="font-size:0.85rem; font-weight:700; margin-bottom:10px; word-break:break-word;">${psEscapeText(label)}</div>
                <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--text-muted); margin-bottom:6px;">Assign to Slot</div>
                ${slotLabels}
                <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--text-muted); margin:14px 0 6px;">Assign to Character</div>
                ${charRows}
            </div>
        `);

        const popup = new Popup($content, POPUP_TYPE.TEXT, "", { okButton: "Close", wide: true });

        $content.find(".kg-assign-slot").on("click", function() {
            const slot = parseInt($(this).data("slot"), 10);
            setExplicitRuntimeLoraSlot(s, slot, reference);
            toastr.success(`Assigned to Slot ${slot}.`, "Megumin Suite");
            try {
                if (typeof popup.completeAffirmative === "function") popup.completeAffirmative();
                else if (typeof popup.hide === "function") popup.hide();
            } catch (e) { /* popup still has Close button */ }
        });
        $content.find(".kg-assign-char").on("click", function() {
            const idx = parseInt($(this).data("idx"), 10);
            if (rows[idx]) {
                rows[idx].lora = reference;
                saveProfileToMemory();
                toastr.success(`Assigned to ${rows[idx].character || "character"}.`, "Megumin Suite");
            }
            try {
                if (typeof popup.completeAffirmative === "function") popup.completeAffirmative();
                else if (typeof popup.hide === "function") popup.hide();
            } catch (e) { /* popup still has Close button */ }
        });

        await popup.show();
    }

    function renderKreaLoraGallery(c) {
        c.empty();
        const s = getLocalProfile().imageGen;
        ensureImageGenLoraArrays(s);
        if (!s.loraIntel) s.loraIntel = { enabled: false, ensureLoras: false, useDanbooruTags: true, ensureCharacterTag: false, useCharDescriptions: false, descriptionStyle: 'natural', promptAssemblyMode: 'structured', assignmentViewMode: 'structured', sendAllCharactersToPromptAi: false, globalActiveLoras: [], characterActiveLoras: {}, characterAssignments: {}, characterAssignmentsByMode: {}, lastCharacterAnalysisResponse: "", characterAnalysisFeedback: "", compiledPromptOverride: "" };
        ensureLoraIntelDefaults(s.loraIntel);
        const li = s.loraIntel;
        const charKey = getCharacterKey() || "default";
        ensureStructuredCharacterAssignments(li, charKey);
        syncCurrentModeCharacterAssignments(li, charKey);

        const KG_PAGE_SIZE = 24;
        let thumbHydrateToken = 0;

        c.append(`
            <style>
                /* Keep gallery scroll inside the modal; do not grow the page behind SillyTavern. */
                #ps_stage_content:has(.kg-gallery-root) {
                    overflow: hidden !important;
                    min-height: 0;
                }
                .kg-gallery-root {
                    flex: 1 1 auto;
                    min-height: 0;
                    height: 100%;
                    max-height: 100%;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    background: #18181b;
                    border: 1px solid var(--border-color);
                    border-radius: 12px;
                }
                .kg-toolbar {
                    flex: 0 0 auto;
                    position: relative;
                    z-index: 2;
                    background: #18181b;
                    border-bottom: 1px solid var(--border-color);
                    padding: 14px 16px;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.45);
                }
                #kg_grid {
                    flex: 1 1 auto;
                    min-height: 0;
                    overflow-x: hidden;
                    overflow-y: auto;
                    -webkit-overflow-scrolling: touch;
                    overscroll-behavior: contain;
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
                    gap: 10px;
                    padding: 14px;
                    align-content: start;
                }
                .kg-thumb-fallback { width:100%; height:100%; display:flex; align-items:center; justify-content:center; color:var(--text-muted); font-size:1.6rem; }
                .kg-page-btn:disabled { opacity: 0.35; cursor: not-allowed; }
                .kg-refresh-btn {
                    flex: 0 0 auto;
                    width: 30px;
                    height: 30px;
                    min-height: 30px !important;
                    padding: 0 !important;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 8px;
                    font-size: 0.72rem;
                    line-height: 1;
                    min-width: 30px;
                }
                .kg-refresh-btn.is-busy i { animation: kg-spin 0.8s linear infinite; }
                @keyframes kg-spin { to { transform: rotate(360deg); } }
            </style>
            <div class="kg-gallery-root">
                <div id="kg_toolbar" class="kg-toolbar">
                    <div style="display:flex; align-items:center; justify-content:space-between; gap: 8px;">
                        <div class="ps-rule-title" style="margin-bottom:0;"><i class="fa-solid fa-images"></i> LoRA Gallery</div>
                        <button type="button" id="kg_refresh_btn" class="ps-modern-btn secondary kg-refresh-btn" title="Retry blank thumbnails" aria-label="Retry blank thumbnails"><i class="fa-solid fa-rotate"></i></button>
                    </div>
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        <input id="kg_search" type="search" enterkeyhint="search" autocomplete="off" placeholder="Search LoRA name..." class="ps-modern-input" style="flex: 1; min-width: 140px; font-size: 16px; padding: 10px;">
                        <select id="kg_source_filter" class="ps-modern-input" style="width: auto; padding: 10px; font-size: 0.8rem;">
                            <option value="all">All Sources</option>
                            <option value="Runtime">Runtime (Malcolmrey)</option>
                            <option value="Baked">Baked</option>
                        </select>
                    </div>
                    <div id="kg_status" style="font-size: 0.72rem; color: var(--text-muted);">Loading LoRA index…</div>
                    <div id="kg_pager" style="display: none; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
                        <button type="button" id="kg_prev_btn" class="ps-modern-btn secondary kg-page-btn" style="padding: 8px 12px; font-size: 0.75rem;"><i class="fa-solid fa-chevron-left"></i> Prev</button>
                        <span id="kg_page_label" style="font-size: 0.72rem; color: var(--text-muted); font-weight: 600;"></span>
                        <button type="button" id="kg_next_btn" class="ps-modern-btn secondary kg-page-btn" style="padding: 8px 12px; font-size: 0.75rem;">Next <i class="fa-solid fa-chevron-right"></i></button>
                    </div>
                </div>
                <div id="kg_grid"></div>
            </div>
        `);

        const $status = $("#kg_status");
        const $grid = $("#kg_grid");
        const $pager = $("#kg_pager");
        const $pageLabel = $("#kg_page_label");
        const $prevBtn = $("#kg_prev_btn");
        const $nextBtn = $("#kg_next_btn");
        const $refreshBtn = $("#kg_refresh_btn");
        let allEntries = [];
        let currentPage = 1;

        function cardHtml(entry) {
            const safeLabel = psEscapeText(entry.label);
            const safeRef = psEscapeAttr(entry.reference);
            const badgeColor = entry.source === "Runtime" ? "#a855f7" : "#10b981";
            let imgOrPlaceholder;
            if (entry.thumbUrl) {
                const cachedLocal = kreaThumbBlobUrlByKey.get(entry.thumbUrl);
                imgOrPlaceholder = cachedLocal
                    ? kreaThumbImgHtml(entry.thumbUrl, cachedLocal)
                    : kreaThumbImgHtml(entry.thumbUrl, entry.thumbUrl);
            } else {
                imgOrPlaceholder = `<div class="kg-thumb-fallback"><i class="fa-solid fa-image"></i></div>`;
            }
            return `
                <div class="kg-card" data-ref="${safeRef}" data-label="${safeLabel}" style="background: rgba(0,0,0,0.15); border: 1px solid var(--border-color); border-radius: 10px; padding: 6px; cursor: pointer; display:flex; flex-direction:column; gap:6px; -webkit-tap-highlight-color: rgba(168,85,247,0.25);">
                    <div style="width:100%; aspect-ratio:1/1; border-radius:8px; overflow:hidden; background:rgba(255,255,255,0.04); display:flex; align-items:center; justify-content:center; color:var(--text-muted); font-size:1.6rem;">${imgOrPlaceholder}</div>
                    <div style="font-size:0.68rem; font-weight:700; color:var(--text-main); line-height:1.2; max-height:2.4em; overflow:hidden;">${safeLabel}</div>
                    <span style="align-self:flex-start; font-size:0.58rem; font-weight:800; text-transform:uppercase; padding:2px 6px; border-radius:5px; background:${badgeColor}22; color:${badgeColor};">${entry.source}</span>
                </div>
            `;
        }

        function getFilteredEntries() {
            const term = String($("#kg_search").val() || "").trim().toLowerCase();
            const sourceFilter = $("#kg_source_filter").val();
            let filtered = allEntries;
            if (sourceFilter !== "all") filtered = filtered.filter(e => e.source === sourceFilter);
            if (term) filtered = filtered.filter(e => e.label.toLowerCase().includes(term) || e.filename.toLowerCase().includes(term));
            return filtered;
        }

        function renderGrid() {
            const filtered = getFilteredEntries();
            const totalPages = Math.max(1, Math.ceil(filtered.length / KG_PAGE_SIZE));
            if (currentPage > totalPages) currentPage = totalPages;
            if (currentPage < 1) currentPage = 1;

            const start = (currentPage - 1) * KG_PAGE_SIZE;
            const pageEntries = filtered.slice(start, start + KG_PAGE_SIZE);
            const showingFrom = filtered.length ? start + 1 : 0;
            const showingTo = start + pageEntries.length;

            $status.text(filtered.length
                ? `Showing ${showingFrom}–${showingTo} of ${filtered.length} LoRAs${filtered.length !== allEntries.length ? ` (${allEntries.length} total)` : ""}`
                : `0 of ${allEntries.length} LoRAs`);

            if (filtered.length > KG_PAGE_SIZE) {
                $pager.css("display", "flex");
                $pageLabel.text(`Page ${currentPage} / ${totalPages}`);
                $prevBtn.prop("disabled", currentPage <= 1);
                $nextBtn.prop("disabled", currentPage >= totalPages);
            } else {
                $pager.hide();
            }

            if (!filtered.length) {
                thumbHydrateToken += 1;
                $grid.html(`<div style="grid-column:1/-1; text-align:center; color:var(--text-muted); font-size:0.8rem; padding:30px 0;">No LoRAs match your search.</div>`);
                return;
            }
            $grid.html(pageEntries.map(cardHtml).join(""));
            $grid.scrollTop(0);
            $grid.find(".kg-thumb").on("error", function() {
                const remote = String($(this).attr("data-thumb-url") || "").trim();
                $(this).replaceWith(kreaThumbFallbackHtml(remote));
            });
            $grid.find(".kg-card").on("click", function() {
                const ref = $(this).attr("data-ref");
                const label = $(this).attr("data-label");
                openKreaGalleryAssignPopup(s, li, charKey, ref, label);
            });

            const token = ++thumbHydrateToken;
            hydrateKreaGalleryThumbs($grid).catch(() => {}).finally(() => {
                if (token !== thumbHydrateToken) return;
            });
        }

        function resetToFirstPageAndRender() {
            currentPage = 1;
            renderGrid();
        }

        async function loadAndRender() {
            $status.text("Loading LoRA index…");
            $pager.hide();
            try {
                allEntries = await loadKreaGalleryEntries({ forceRefresh: false });
                // Keep the current page when possible (only clamp inside renderGrid).
                renderGrid();
            } catch (e) {
                console.error("[Megumin Suite] LoRA Gallery load failed:", e);
                $status.text("Failed to load LoRA index.");
                $pager.hide();
                $grid.html(`<div style="grid-column:1/-1; text-align:center; color:#ef4444; font-size:0.8rem; padding:30px 0;">${psEscapeText(e && e.message ? e.message : String(e))}</div>`);
            }
        }

        async function retryBlankThumbs() {
            $refreshBtn.addClass("is-busy").prop("disabled", true);
            const prevStatus = $status.text();
            $status.text("Retrying blank thumbnails…");
            try {
                const result = await retryBlankKreaGalleryThumbs($grid);
                if (!result.attempted) {
                    $status.text(prevStatus || "No blank thumbnails on this page.");
                } else {
                    $status.text(`Retried ${result.attempted} blank thumbnail${result.attempted === 1 ? "" : "s"} — recovered ${result.recovered}.`);
                }
            } catch (e) {
                console.error("[Megumin Suite] Thumbnail retry failed:", e);
                $status.text("Thumbnail retry failed.");
            } finally {
                $refreshBtn.removeClass("is-busy").prop("disabled", false);
            }
        }

        $("#kg_search").on("input", resetToFirstPageAndRender);
        $("#kg_source_filter").on("change", resetToFirstPageAndRender);
        $refreshBtn.on("click", () => retryBlankThumbs());
        $prevBtn.on("click", () => {
            if (currentPage > 1) {
                currentPage -= 1;
                renderGrid();
            }
        });
        $nextBtn.on("click", () => {
            const totalPages = Math.max(1, Math.ceil(getFilteredEntries().length / KG_PAGE_SIZE));
            if (currentPage < totalPages) {
                currentPage += 1;
                renderGrid();
            }
        });

        loadAndRender();
    }

    function setExplicitRuntimeLoraSlot(s, slot, reference) {
        const index = Math.max(1, Math.min(4, parseInt(slot, 10) || 1));
        const key = index === 1 ? "selectedLora" : `selectedLora${index}`;
        s[key] = reference;
        ensureImageGenLoraArrays(s);
        s.loraSlotKeywordManaged[index - 1] = false;
        const $select = $(`#ig_lora_${index}`);
        if ($select.length && !$select.find(`option[value="${String(reference).replace(/"/g, "\\\"")}"]`).length) {
            $select.append($("<option></option>").attr("value", reference).text(`Runtime: ${reference.replace(/^hf:\/\/[^/]+\//, "")}`));
        }
        $select.val(reference);
        saveProfileToMemory();
    }

    function buildKreaLoraTriggerSuffix(loras) {
        // Krea character LoRAs are keyed to the plain, generic phrase "a woman"
        // rather than a unique per-identity token. This returns ONLY that
        // literal phrase, repeated once per selected LoRA slot -- no identity
        // names, no Civitai/HF labels, no meta-instruction sentences.
        //
        // We deliberately do NOT build a verbose "instruction" paragraph
        // (e.g. "Use the exact trigger phrase X for identity Y") and hand it
        // to the NanoGPT rewrite LLM anymore. Faster/cheaper chat models are
        // prone to treating instruction-shaped text as content to preserve
        // "exactly" and echo it back verbatim (including nonsense like raw
        // Civitai IDs) instead of transforming it -- which is exactly what
        // was polluting the final render prompt. A plain repeated trigger
        // word is safe to literally exist inside an SD/Krea prompt either
        // way, so we inject it deterministically in code instead of asking
        // an LLM to understand and comply with a rule about it.
        const selected = (Array.isArray(loras) ? loras : [])
            .map(value => String(value || "").trim())
            .filter(value => value && value.toLowerCase() !== "none");
        if (!selected.length) return "";
        return selected.map(() => "a woman").join(", ");
    }

    function appendKreaRuntimeLoraTriggerInstruction(prompt, loras) {
        const suffix = buildKreaLoraTriggerSuffix(loras);
        if (!suffix) return String(prompt || "");
        const current = String(prompt || "").trim();
        return current ? `${current}, ${suffix}` : suffix;
    }

    function syncKreaLoraFinderUi(s) {
        const runpodOn = !!(s && ensureRunpodSettings(s).enabled);
        const isKrea = !!(s && s.selectedModel === RUNPOD_KREA_MODEL);
        const $btn = $("#ig_krea_lora_browser_btn");
        const $hint = $("#ig_krea_lora_hint");
        if (!$btn.length) return;
        $btn.css("display", "inline-flex");
        if (!runpodOn) {
            $hint.html('Turn on <b>Render with RunPod</b>, set model to <code>krea2_turbo_fp8_scaled.safetensors</code>, then click <b>Krea LoRA Finder</b> to pick Malcolmrey / baked LoRAs into slots 1–4.');
        } else if (!isKrea) {
            $hint.html('RunPod is on, but the model is not Krea 2. Select <code>krea2_turbo_fp8_scaled.safetensors</code> in the Model dropdown (or click Finder — it will switch for you).');
        } else {
            $hint.html('Finder picks Malcolmrey <span style="color:#c084fc;font-weight:700;">Runtime</span> and baked <span style="color:#10b981;font-weight:700;">Baked</span> LoRAs into slots 1–4. Saved per profile; not overwritten by character keyword analysis.');
        }
        $hint.show();
    }

    async function showMalcolmreyKreaLoraFinder(s) {
      try {
        const rp = ensureRunpodSettings(s);
        if (!rp.enabled) {
            rp.enabled = true;
            if (s.promptStyle === "krea2" || !s.selectedModel || isRunpodAnimaModel(s.selectedModel)) {
                s.selectedModel = RUNPOD_KREA_MODEL;
            }
            ensureRunpodDropdownValues(s);
            saveProfileToMemory();
            $("#ig_runpod_card").addClass("active");
            $("#ig_runpod_settings").show();
            populateRunpodImageLists(s);
            igFetchComfyLists();
            syncKreaLoraFinderUi(s);
            toastr.info("Enabled RunPod for Krea LoRA Finder.");
        }
        if (s.selectedModel !== RUNPOD_KREA_MODEL) {
            s.selectedModel = RUNPOD_KREA_MODEL;
            ensureRunpodDropdownValues(s);
            saveProfileToMemory();
            populateRunpodImageLists(s);
            $("#ig_model").val(RUNPOD_KREA_MODEL);
            syncKreaLoraFinderUi(s);
            toastr.info("Switched model to Krea 2 for runtime LoRAs.");
        }
        const $overlay = $(`
            <div class="ig-krea-lora-overlay" style="position:fixed; inset:0; z-index:100000; display:flex; align-items:center; justify-content:center; padding:18px; box-sizing:border-box; background:rgba(0,0,0,.72); font-family:'Inter',sans-serif;">
                <style>
                    @media (max-width: 600px) {
                        .ig-krea-lora-overlay { padding:0 !important; align-items:stretch !important; }
                        .ig-krea-lora-dialog { width:100% !important; max-height:100% !important; border-radius:0 !important; }
                        .ig-krea-lora-toolbar { flex-wrap:wrap !important; padding:10px 12px !important; }
                        .ig-krea-lora-search { flex-basis:100% !important; min-height:42px !important; font-size:16px !important; }
                        .ig-krea-lora-slot { width:100% !important; min-height:40px !important; }
                        .ig-krea-lora-result { padding:12px 2px !important; align-items:flex-start !important; }
                        .ig-krea-lora-file { display:none !important; }
                    }
                </style>
                <div class="ig-krea-lora-dialog" style="width:min(760px,100%); max-height:min(760px,calc(100vh - 36px)); display:flex; flex-direction:column; overflow:hidden; background:#18181b; border:1px solid var(--border-color); border-radius:14px; box-shadow:0 18px 60px rgba(0,0,0,.65);">
                    <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:16px 18px; border-bottom:1px solid var(--border-color);">
                        <div><div style="font-weight:900; color:var(--gold);"><i class="fa-solid fa-wand-magic-sparkles"></i> Krea 2 LoRA Finder</div><div style="margin-top:4px; font-size:.68rem; color:var(--text-muted);">Names come from Malcolmrey's browser index. The worker fetches the exact Hugging Face file on first use and caches it while warm.</div></div>
                        <button type="button" class="ps-modern-btn secondary ig-krea-lora-close" style="padding:5px 9px;"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                    <div class="ig-krea-lora-toolbar" style="display:flex; gap:10px; padding:12px 18px; border-bottom:1px solid var(--border-color);"><input class="ps-modern-input ig-krea-lora-search" type="search" inputmode="search" autocomplete="off" placeholder="Search a name…" style="flex:1; padding:8px;" /><select class="ps-modern-input ig-krea-lora-slot" style="width:110px; padding:8px;"><option value="1">Slot 1</option><option value="2">Slot 2</option><option value="3">Slot 3</option><option value="4">Slot 4</option></select></div>
                    <div class="ig-krea-lora-status" style="padding:24px; color:var(--text-muted); text-align:center;">Loading Malcolmrey's index…</div>
                    <div class="ig-krea-lora-results" style="display:none; overflow:auto; padding:10px 18px 18px;"></div>
                </div>
            </div>
        `);
        $("body").append($overlay);
        const close = () => $overlay.remove();
        $overlay.on("click", ".ig-krea-lora-close", close);
        $overlay.on("click", function(event) { if (event.target === this) close(); });
        try {
            const [baked, runtime] = await Promise.all([
                loadBakedKreaLoras().catch(error => { console.warn("[Megumin Suite] Could not load baked Krea LoRA manifest:", error); return []; }),
                loadMalcolmreyKreaLoras().catch(error => { console.warn("[Megumin Suite] Could not load Malcolmrey Krea LoRA index:", error); return []; })
            ]);
            const items = [...baked, ...runtime];
            if (!items.length) throw new Error("Could not load the baked LoRA manifest or Malcolmrey's Krea index.");
            const $status = $overlay.find(".ig-krea-lora-status");
            const $results = $overlay.find(".ig-krea-lora-results");
            const render = () => {
                const query = String($overlay.find(".ig-krea-lora-search").val() || "").trim().toLowerCase();
                const matches = items.filter(item => !query || item.filename.toLowerCase().includes(query) || item.label.toLowerCase().includes(query)).slice(0, 120);
                $status.text(`${matches.length}${matches.length === 120 ? "+" : ""} matching LoRAs${query ? "" : " — type to narrow the list"}.`);
                $results.html(matches.map(item => `<button type="button" class="ig-krea-lora-pick ig-krea-lora-result" data-reference="${psEscapeAttr(item.reference)}" style="display:flex; width:100%; align-items:center; justify-content:space-between; gap:12px; text-align:left; padding:9px 4px; border:0; border-bottom:1px solid rgba(255,255,255,.07); background:transparent; color:var(--text-main); cursor:pointer;"><span style="font-weight:750;">${psEscapeText(item.label)} <small style="color:${item.source === 'Baked' ? '#10b981' : '#c084fc'}; font-weight:700;">${psEscapeText(item.source || 'Runtime')}</small></span><code class="ig-krea-lora-file" style="font-size:.64rem; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${psEscapeText(item.filename)}</code></button>`).join("") || '<div style="padding:20px; text-align:center; color:var(--text-muted);">No matching Krea 2 LoRA.</div>');
            };
            $status.css("padding", "10px 18px");
            $results.show();
            render();
            $overlay.find(".ig-krea-lora-search").on("input", render);
            $overlay.on("click", ".ig-krea-lora-pick", function() {
                const slot = $overlay.find(".ig-krea-lora-slot").val();
                setExplicitRuntimeLoraSlot(s, slot, String($(this).attr("data-reference") || ""));
                toastr.success(`Krea LoRA saved in slot ${slot}.`);
                close();
            });
        } catch (error) {
            $overlay.find(".ig-krea-lora-status").html(`<span style="color:#ef4444;">${psEscapeText(error.message || "Could not load the Malcolmrey index.")}</span>`);
        }
      } catch (outerError) {
        console.error("[Megumin Suite] Krea LoRA Finder failed to open:", outerError);
        toastr.error(`Krea LoRA Finder could not open: ${outerError && outerError.message ? outerError.message : outerError}`);
      }
    }

    /** Map saved LoRA path to the exact string Comfy lists (folder slash vs backslash, etc.). */
    function resolveLoraPathForDropdown(stored, filesList) {
        if (!stored || stored === "None" || stored === "") return stored || "";
        if (!filesList || !filesList.length) return stored;
        if (filesList.includes(stored)) return stored;
        const norm = (p) => String(p).replace(/\\/g, "/").trim().toLowerCase();
        const n = norm(stored);
        for (const f of filesList) {
            if (norm(f) === n) return f;
        }
        const base = stored.replace(/^.*[/\\]/, "");
        if (base) {
            const nb = base.trim().toLowerCase();
            for (const f of filesList) {
                const tail = f.replace(/^.*[/\\]/, "");
                if (tail.trim().toLowerCase() === nb) return f;
            }
        }
        return stored;
    }

    async function ensureMeguminComfyLoraList(s) {
        if (SHOW_RUNPOD_IMAGE_BACKEND && ensureRunpodSettings(s).enabled) {
            // Reuse the cache igFetchComfyLists already populated (it includes the
            // baked-manifest names); only fetch here if that hasn't run yet, so a
            // baked/manifest LoRA still canonicalizes correctly during generation.
            if (meguminComfyLoraCacheUrl === "runpod" && runpodAnimaLoraNames && runpodKreaLoraNames) {
                meguminComfyLoraCache = getRunpodLoraOptionsForModel(s, runpodAnimaLoraNames, runpodKreaLoraNames);
                return meguminComfyLoraCache;
            }
            const { anima, krea } = await loadRunpodBakedLoraBundles();
            rememberRunpodBakedLoraNames(anima.map(item => item.reference), krea.map(item => item.reference));
            meguminComfyLoraCache = getRunpodLoraOptionsForModel(s, runpodAnimaLoraNames, runpodKreaLoraNames);
            meguminComfyLoraCacheUrl = "runpod";
            return meguminComfyLoraCache;
        }
        const url = (s && s.comfyUrl) ? String(s.comfyUrl).trim() : "";
        if (!url) return [];
        if (meguminComfyLoraCache && meguminComfyLoraCacheUrl === url) return meguminComfyLoraCache;
        try {
            const lRes = await fetch(`${url}/object_info/LoraLoader`);
            if (lRes.ok) {
                const json = await lRes.json();
                meguminComfyLoraCache = json["LoraLoader"].input.required.lora_name[0] || [];
                meguminComfyLoraCacheUrl = url;
                return meguminComfyLoraCache;
            }
        } catch (e) {}
        return [];
    }

    async function igFetchComfyLists() {
        const s = getLocalProfile().imageGen;
        if (SHOW_RUNPOD_IMAGE_BACKEND && ensureRunpodSettings(s).enabled) {
            if (ensureRunpodDropdownValues(s)) saveProfileToMemory();
            const { anima, krea } = await loadRunpodBakedLoraBundles();
            const animaNames = anima.map(item => item.reference);
            const kreaNames = krea.map(item => item.reference);
            rememberRunpodBakedLoraNames(animaNames, kreaNames);
            populateRunpodImageLists(s, animaNames, kreaNames);
            return;
        }
        const url = s.comfyUrl;
        try {
            const mRes = await fetch('/api/sd/comfy/models', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ url: url }) });
            if (mRes.ok) {
                const models = await mRes.json();
                const sel = $("#ig_model"); sel.empty().append('<option value="">-- Select Model --</option>');
                models.forEach(m => { let v = m.value || m; let t = m.text || v; sel.append(`<option value="${v}">${t}</option>`); });
                if (s.selectedModel) sel.val(s.selectedModel);
            }
            const sRes = await fetch('/api/sd/comfy/samplers', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ url: url }) });
            if (sRes.ok) {
                const samplers = await sRes.json();
                const sel = $("#ig_sampler"); sel.empty();
                samplers.forEach(sa => sel.append(`<option value="${sa}">${sa}</option>`));
                if (s.selectedSampler) sel.val(s.selectedSampler);
            }
            ensureSelectHasOptions($("#ig_scheduler"), RUNPOD_IMAGE_SCHEDULERS, s.selectedScheduler);
            const ksRes = await fetch(`${url}/object_info/KSampler`);
            if (ksRes.ok) {
                const json = await ksRes.json();
                const schedulers = json?.KSampler?.input?.required?.scheduler?.[0] || [];
                ensureSelectHasOptions($("#ig_scheduler"), schedulers, s.selectedScheduler);
            }
            const lRes = await fetch(`${url}/object_info/LoraLoader`);
            if (lRes.ok) {
                const json = await lRes.json();
                const files = json["LoraLoader"].input.required.lora_name[0] || [];
                meguminComfyLoraCache = files;
                meguminComfyLoraCacheUrl = url;
                let canonChanged = false;
                for (let i = 1; i <= 4; i++) {
                    const sel = $(`#ig_lora_${i}`);
                    const key = i === 1 ? "selectedLora" : `selectedLora${i}`;
                    const val = s[key];
                    sel.empty().append('<option value="">-- No LoRA --</option>');
                    files.forEach(f => { sel.append($("<option></option>").attr("value", f).text(f)); });
                    if (val) {
                        const resolved = resolveLoraPathForDropdown(val, files);
                        if (resolved && resolved !== val) {
                            s[key] = resolved;
                            canonChanged = true;
                        }
                        sel.val(resolved || val);
                    }
                }
                if (canonChanged) saveProfileToMemory();
            }
        } catch (e) { console.warn(`[Megumin-Suite] ComfyLists failed`, e); }
    }

    // -------------------------------------------------------------
    // LORA INTELLIGENCE HELPERS
    // -------------------------------------------------------------
    /** Last POST body sent to ComfyUI `/prompt` (session memory; refreshed on each generation). */
    let igLastComfyApiRequest = null;

    /** Replace Megumin %placeholders% in workflow node inputs (strings only). Recurses into nested widget objects; arrays are left as-is because they are Comfy links. */
    function igSubstituteComfyPlaceholderDeep(val, repl, seedPlaceholderState) {
        if (typeof val === "string" && Object.prototype.hasOwnProperty.call(repl, val)) {
            if (val === "%seed%" && seedPlaceholderState) seedPlaceholderState.injected = true;
            return repl[val];
        }
        if (!val || typeof val !== "object" || Array.isArray(val)) return val;
        for (const k of Object.keys(val)) {
            val[k] = igSubstituteComfyPlaceholderDeep(val[k], repl, seedPlaceholderState);
        }
        return val;
    }

    function igWorkflowContainsPlaceholder(value, placeholder) {
        if (typeof value === "string") return value === placeholder;
        if (!value || typeof value !== "object") return false;
        if (Array.isArray(value)) return value.some(item => igWorkflowContainsPlaceholder(item, placeholder));
        return Object.values(value).some(item => igWorkflowContainsPlaceholder(item, placeholder));
    }

    function igBypassNanoTextNodesForStoredPrompt(workflow) {
        if (!workflow || typeof workflow !== "object") return false;
        const nanoNodeIds = new Set(Object.entries(workflow)
            .filter(([, node]) => node?.class_type === "MeguminNanoGPTText")
            .map(([nodeId]) => String(nodeId)));
        if (!nanoNodeIds.size) return false;

        const replaceLinks = (value) => {
            if (Array.isArray(value)) {
                if (value.length >= 2 && nanoNodeIds.has(String(value[0]))) return "%prompt%";
                for (let i = 0; i < value.length; i++) value[i] = replaceLinks(value[i]);
                return value;
            }
            if (!value || typeof value !== "object") return value;
            for (const key of Object.keys(value)) value[key] = replaceLinks(value[key]);
            return value;
        };

        for (const [nodeId, node] of Object.entries(workflow)) {
            if (nanoNodeIds.has(String(nodeId))) continue;
            if (node?.inputs && typeof node.inputs === "object") replaceLinks(node.inputs);
        }
        for (const nodeId of nanoNodeIds) delete workflow[nodeId];
        return true;
    }

    /**
     * Stock ComfyUI LoraLoader rejects empty/"None" names. Bypass idle slots by
     * rewiring MODEL/CLIP consumers to that node's inputs, then delete the node.
     * Leaves MeguminRuntimeLoraStack and rgthree stacks alone (they accept None).
     */
    function igBypassInactiveLoraLoaderNodes(workflow) {
        if (!workflow || typeof workflow !== "object") return false;
        const inactive = new Map();
        for (const [nodeId, node] of Object.entries(workflow)) {
            if (node?.class_type !== "LoraLoader") continue;
            const name = String(node.inputs?.lora_name ?? "").trim();
            if (name && name.toLowerCase() !== "none") continue;
            inactive.set(String(nodeId), {
                model: node.inputs?.model,
                clip: node.inputs?.clip
            });
        }
        if (!inactive.size) return false;

        const resolveLink = (link, visiting = new Set()) => {
            if (!Array.isArray(link) || link.length < 2) return link;
            const src = String(link[0]);
            if (!inactive.has(src) || visiting.has(src)) return link;
            visiting.add(src);
            const ports = inactive.get(src);
            const next = Number(link[1]) === 1 ? ports.clip : ports.model;
            return resolveLink(next, visiting);
        };

        const rewriteValue = (value) => {
            if (Array.isArray(value)) {
                if (value.length >= 2 && inactive.has(String(value[0])) && typeof value[1] === "number") {
                    return resolveLink(value);
                }
                for (let i = 0; i < value.length; i++) value[i] = rewriteValue(value[i]);
                return value;
            }
            if (!value || typeof value !== "object") return value;
            for (const key of Object.keys(value)) value[key] = rewriteValue(value[key]);
            return value;
        };

        for (const [nodeId, node] of Object.entries(workflow)) {
            if (inactive.has(String(nodeId))) continue;
            if (node?.inputs && typeof node.inputs === "object") rewriteValue(node.inputs);
        }
        for (const nodeId of inactive.keys()) delete workflow[nodeId];
        return true;
    }

    function igExtractComfyGeneratedPrompt(historyEntry, workflow) {
        const outputs = historyEntry?.outputs;
        if (!outputs || typeof outputs !== "object") return "";
        const nanoNodeIds = Object.entries(workflow || {})
            .filter(([, node]) => node?.class_type === "MeguminNanoGPTText")
            .map(([nodeId]) => String(nodeId));
        for (const nodeId of nanoNodeIds) {
            const nodeOutput = outputs[nodeId];
            if (!nodeOutput || typeof nodeOutput !== "object") continue;
            const candidates = [
                nodeOutput.text,
                nodeOutput.generated_text,
                nodeOutput.prompt,
                nodeOutput.result
            ];
            for (const candidate of candidates) {
                const value = Array.isArray(candidate) ? candidate[0] : candidate;
                if (typeof value === "string" && value.trim()) return stripUtilityThinkingWrapper(value);
            }
        }
        return "";
    }

    function igCollectWorkflowLoraNodes(workflow) {
        const out = [];
        if (!workflow || typeof workflow !== "object") return out;
        for (const nodeId of Object.keys(workflow)) {
            const node = workflow[nodeId];
            if (!node || !node.inputs) continue;
            if (!Object.prototype.hasOwnProperty.call(node.inputs, "lora_name")) continue;
            const inp = node.inputs;
            out.push({
                node_id: nodeId,
                class_type: node.class_type || "?",
                lora_name: inp.lora_name,
                strength_model: inp.strength_model,
                strength_clip: inp.strength_clip
            });
        }
        return out;
    }

    function igCollectWorkflowSamplerNodes(workflow) {
        const out = [];
        if (!workflow || typeof workflow !== "object") return out;
        for (const nodeId of Object.keys(workflow)) {
            const node = workflow[nodeId];
            if (!node || !node.inputs) continue;
            const inp = node.inputs;
            if (inp.sampler_name === undefined && inp.scheduler === undefined) continue;
            const row = { node_id: nodeId, class_type: node.class_type || "?" };
            if (inp.sampler_name !== undefined) row.sampler_name = inp.sampler_name;
            if (inp.scheduler !== undefined) row.scheduler = inp.scheduler;
            if (inp.steps !== undefined) row.steps = inp.steps;
            if (inp.cfg !== undefined) row.cfg = inp.cfg;
            if (inp.seed !== undefined) row.seed = inp.seed;
            if (inp.denoise !== undefined) row.denoise = inp.denoise;
            out.push(row);
        }
        return out;
    }

    function igBuildLastComfyApiSnapshot(s, workflow, finalPrompt, aiText, finalSeed, l1, l2, l3, l4, w1, w2, w3, w4) {
        const fullPayload = { prompt: JSON.parse(JSON.stringify(workflow)) };
        const cs = parseInt(s.clipSkip, 10);
        return {
            at: new Date().toISOString(),
            comfy_url: s.comfyUrl,
            workflow_file: s.currentWorkflowName,
            positive_prompt: finalPrompt,
            ai_text: aiText,
            negative_prompt: s.customNegative || "",
            final_seed: finalSeed,
            megumin: {
                model: s.selectedModel || "",
                sampler: s.selectedSampler || "",
                scheduler: s.selectedScheduler || "",
                steps: parseInt(s.steps, 10) || 20,
                cfg: parseFloat(s.cfg) || 7,
                denoise: parseFloat(s.denoise) || 1,
                clip_skip_ui: s.clipSkip,
                clip_skip_injected: -Math.abs(cs) || -1,
                width: parseInt(s.imgWidth, 10) || 512,
                height: parseInt(s.imgHeight, 10) || 512
            },
            lora_slots: [
                { slot: 1, file: l1 || "None", weight: w1 },
                { slot: 2, file: l2 || "None", weight: w2 },
                { slot: 3, file: l3 || "None", weight: w3 },
                { slot: 4, file: l4 || "None", weight: w4 }
            ],
            workflow_lora_nodes: igCollectWorkflowLoraNodes(workflow),
            workflow_sampler_nodes: igCollectWorkflowSamplerNodes(workflow),
            full_payload: fullPayload
        };
    }

    function igFormatLastComfyApiSummary(snap) {
        if (!snap) return "No ComfyUI request sent yet in this session.";
        const lines = [];
        lines.push(`Time: ${snap.at}`);
        lines.push(`POST ${snap.comfy_url}/prompt`);
        lines.push(`Workflow file: ${snap.workflow_file}`);
        lines.push("");
        lines.push("── Positive prompt ──");
        lines.push(String(snap.positive_prompt || "(empty)"));
        lines.push("");
        lines.push("── Negative prompt ──");
        lines.push(String(snap.negative_prompt || "(empty)"));
        lines.push("");
        lines.push("── Megumin placeholder values ──");
        lines.push(`Seed: ${snap.final_seed}`);
        const m = snap.megumin;
        lines.push(`Checkpoint (%model%): ${m.model || "(empty)"}`);
        lines.push(`Sampler (%sampler%): ${m.sampler || "(empty)"}`);
        lines.push(`Scheduler (%scheduler%): ${m.scheduler || "(empty)"}`);
        lines.push(`Steps / CFG / Denoise: ${m.steps} / ${m.cfg} / ${m.denoise}`);
        lines.push(`CLIP skip (UI → injected as %clip_skip%): ${m.clip_skip_ui} → ${m.clip_skip_injected}`);
        lines.push(`Size (%width% × %height%): ${m.width} × ${m.height}`);
        lines.push("");
        lines.push("── LoRA slots (after LoRA Intelligence / UI resolve) ──");
        snap.lora_slots.forEach((l) => {
            const f = l.file && l.file !== "None" ? l.file : "None";
            lines.push(`  Slot ${l.slot}: ${f}  weight ${l.weight}`);
        });
        lines.push("");
        lines.push("── LoRA loader nodes in graph (resolved) ──");
        if (!snap.workflow_lora_nodes.length) lines.push("  (none detected)");
        else {
            snap.workflow_lora_nodes.forEach((n) => {
                lines.push(`  [${n.node_id}] ${n.class_type}: ${JSON.stringify(n.lora_name)}  model ${n.strength_model}  clip ${n.strength_clip}`);
            });
        }
        lines.push("");
        lines.push("── Sampler / scheduler fields in graph ──");
        if (!snap.workflow_sampler_nodes.length) lines.push("  (none detected — workflow may use different node types)");
        else {
            snap.workflow_sampler_nodes.forEach((n) => {
                const bits = [`[${n.node_id}] ${n.class_type}`];
                if (n.sampler_name !== undefined) bits.push(`sampler_name=${JSON.stringify(n.sampler_name)}`);
                if (n.scheduler !== undefined) bits.push(`scheduler=${JSON.stringify(n.scheduler)}`);
                if (n.steps !== undefined) bits.push(`steps=${n.steps}`);
                if (n.cfg !== undefined) bits.push(`cfg=${n.cfg}`);
                if (n.seed !== undefined) bits.push(`seed=${n.seed}`);
                if (n.denoise !== undefined) bits.push(`denoise=${n.denoise}`);
                lines.push(`  ${bits.join("  ")}`);
            });
        }
        lines.push("");
        lines.push("── Tip ──");
        lines.push('Switch "View" to "Full JSON" for the exact payload sent to ComfyUI.');
        return lines.join("\n");
    }

    function igRefreshLastComfyApiPanel() {
        const $fmt = $("#li_last_comfy_req_view");
        const $ta = $("#li_last_comfy_req_body");
        if (!$fmt.length || !$ta.length) return;
        const mode = $fmt.val() || "summary";
        if (mode === "json") {
            $ta.val(igLastComfyApiRequest ? JSON.stringify(igLastComfyApiRequest.full_payload, null, 2) : igFormatLastComfyApiSummary(null));
        } else {
            $ta.val(igFormatLastComfyApiSummary(igLastComfyApiRequest));
        }
    }

    let cachedLoraFiles = null;

    function liRenderAssignmentTable(li, charKey, s) {
        const table = $("#li_assignment_table");
        table.empty();
        syncCurrentModeCharacterAssignments(li, charKey);

        if (!li.ensureLoras && !li.useCharDescriptions && !li.useDanbooruTags) {
            table.hide();
            return;
        } else {
            table.show();
        }

        const assignments = getModeCharacterAssignments(li, charKey);

        const showLoras = li.ensureLoras;
        const showDesc = li.useCharDescriptions;
        const showBooru = li.useDanbooruTags;
        const showMatchKw = showLoras || showBooru || showDesc;

        let gridCols = "1fr ";
        if (showMatchKw) gridCols += "1.5fr ";
        if (showLoras) gridCols += "1.5fr ";
        if (showBooru) gridCols += "2fr ";
        if (showDesc) gridCols += "2fr ";

        let headerHtml = `<div style="display: grid; grid-template-columns: ${gridCols}; gap: 8px; flex: 1;">
            <span style="font-size: 0.65rem; font-weight: 800; color: var(--gold); text-transform: uppercase;">Character</span>`;
        if (showMatchKw) {
            headerHtml += `<span style="font-size: 0.65rem; font-weight: 800; color: var(--gold); text-transform: uppercase;">Match Keywords</span>`;
        }
        if (showLoras) {
            headerHtml += `<span style="font-size: 0.65rem; font-weight: 800; color: var(--gold); text-transform: uppercase;">LoRA File</span>`;
        }
        if (showBooru) {
            headerHtml += `<span style="font-size: 0.65rem; font-weight: 800; color: #10b981; text-transform: uppercase; font-size: 0.65rem; font-weight: 800;">Booru Tags</span>`;
        }
        if (showDesc) {
            headerHtml += `<span style="font-size: 0.65rem; font-weight: 800; color: var(--gold); text-transform: uppercase;">Description</span>`;
        }
        headerHtml += `</div>`;

        const header = $(`
            <div class="li-assignment-header" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: rgba(245,158,11,0.1); border-radius: 6px; margin-bottom: 6px;">
                ${headerHtml}
                <span style="font-size:0.62rem; font-weight:800; color:var(--text-muted); text-transform:uppercase; margin-left:10px;">${psEscapeText(getAssignmentModeLabel(li))}</span>
                <button id="li_add_custom_assign" class="ps-modern-btn primary" style="padding: 2px 8px; font-size: 0.65rem; margin-left: 10px; background: var(--gold); color: #000;"><i class="fa-solid fa-plus"></i> Add</button>
            </div>
        `);

        header.find("#li_add_custom_assign").on("click", function() {
            assignments.push(ensureStructuredCharacterAssignment({ character: "", match_keywords: "", lora: "", description: "", plain_description: "", booru_tags: "", character_tag: "", series_tag: "", physical_tags: "", clothing_tags: "", alwaysInclude: false, neverInclude: false }));
            setModeCharacterAssignments(li, charKey, assignments);
            saveProfileToMemory();
            liRenderAssignmentTable(li, charKey, s);
        });

        table.append(header);

        if (assignments.length === 0) {
            table.append('<div style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 15px; border: 1px dashed var(--border-color); border-radius: 8px;">No assignments yet. Click "Analyze Characters" or "Add".</div>');
            return;
        }

        assignments.forEach((a, idx) => {
            ensureStructuredCharacterAssignment(a);

            if (showBooru) {
                const rowToggle = (key, label) => {
                    const enabled = a.tagFieldToggles?.[key] !== false;
                    return `<button type="button" class="ps-modern-btn secondary li-row-field-toggle ${enabled ? 'active' : ''}" data-field="${key}" title="Include ${label} for this character" style="padding: 4px 7px; font-size: 0.62rem; min-width: auto; border-color: ${enabled ? 'rgba(16,185,129,0.45)' : 'var(--border-color)'}; color: ${enabled ? '#10b981' : 'var(--text-muted)'};">${label}</button>`;
                };
                const tagField = (key, label, placeholder) => {
                    const isCharacterTag = key === "character_tag";
                    return `
                        <label style="display: flex; flex-direction: column; gap: 4px; min-width: 0;">
                            <span style="font-size: 0.62rem; font-weight: 800; color: #10b981; text-transform: uppercase;">${label}</span>
                            <input class="ps-modern-input li-edit-tag-field ${isCharacterTag ? 'li-edit-character-tag-field' : ''}" data-key="${key}" type="text" placeholder="${psEscapeAttr(placeholder)}" value="${psEscapeAttr(a[key] || '')}" autocomplete="off" autocapitalize="off" spellcheck="false" style="font-size: 0.78rem; color: #10b981; padding: 9px; min-width: 0;" />
                            ${isCharacterTag ? '<div class="li-character-tag-suggestions" style="display:none; max-height: 286px; overflow-y: auto; -webkit-overflow-scrolling: touch; border: 1px solid rgba(16,185,129,0.25); border-radius: 8px; background: rgba(6,20,16,0.98); box-shadow: 0 10px 24px rgba(0,0,0,0.32); padding: 5px; gap: 5px;"></div>' : ''}
                        </label>
                    `;
                };

                if (li.assignmentViewMode === 'plain') {
                    const plainValue = a.plain_description || getAssignmentTagBlock(a, li) || a.description || "";
                    const row = $(`
                        <div style="display: flex; flex-direction: column; gap: 10px; padding: 10px; background: rgba(0,0,0,0.15); border: 1px solid var(--border-color); border-radius: 8px; margin-bottom: 8px;">
                            <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                                <input class="ps-modern-input li-edit-char" type="text" placeholder="Character" value="${psEscapeAttr(a.character || '')}" style="flex: 1; min-width: 120px; font-size: 0.78rem; font-weight: 700; padding: 6px;" />
                                ${showMatchKw ? `<input class="ps-modern-input li-edit-match" type="text" placeholder="Match keywords" value="${psEscapeAttr(a.match_keywords || '')}" style="flex: 1.3; min-width: 140px; font-size: 0.68rem; color: var(--text-muted); padding: 6px;" />` : ''}
                                <button type="button" class="ps-modern-btn secondary li-always-include ${a.alwaysInclude ? 'active' : ''}" title="Always include this character even when match keywords are absent from recent chat" style="padding: 5px 8px; font-size: 0.65rem; color: ${a.alwaysInclude ? '#10b981' : 'var(--text-muted)'}; border-color: ${a.alwaysInclude ? 'rgba(16,185,129,0.45)' : 'var(--border-color)'};"><i class="fa-solid fa-thumbtack"></i> Always</button>
                                <button type="button" class="ps-modern-btn secondary li-never-include ${a.neverInclude ? 'active' : ''}" title="Never include this character in prompts, LoRAs, or manual tag insertion" style="padding: 5px 8px; font-size: 0.65rem; color: ${a.neverInclude ? '#ef4444' : 'var(--text-muted)'}; border-color: ${a.neverInclude ? 'rgba(239,68,68,0.45)' : 'var(--border-color)'};"><i class="fa-solid fa-ban"></i> Never</button>
                                <button class="ps-modern-btn secondary li-remove-assign" data-idx="${idx}" style="padding: 5px 8px; font-size: 0.65rem; color: #ef4444; border-color: rgba(239,68,68,0.3);"><i class="fa-solid fa-xmark"></i></button>
                            </div>
                            ${showLoras ? `<input class="ps-modern-input li-edit-lora" type="text" placeholder="LoRA file" value="${psEscapeAttr(a.lora || '')}" style="font-size: 0.7rem; color: #a855f7; padding: 6px;" />` : ''}
                            <textarea class="ps-modern-input li-edit-plain-desc" placeholder="Plain natural-language or tag-style character description. Used when Plain Text View is active." style="height: 84px; resize: vertical; font-size: 0.72rem; color: #10b981; padding: 8px;">${psEscapeText(plainValue)}</textarea>
                        </div>
                    `);

                    row.find(".li-edit-char").on("input", function() { a.character = $(this).val(); saveProfileToMemory(); });
                    if (showMatchKw) row.find(".li-edit-match").on("input", function() { a.match_keywords = $(this).val(); saveProfileToMemory(); });
                    if (showLoras) row.find(".li-edit-lora").on("input", function() { a.lora = $(this).val(); saveProfileToMemory(); });
                    row.find(".li-edit-plain-desc").on("input", function() { a.plain_description = $(this).val(); saveProfileToMemory(); });
                    row.find(".li-always-include").on("click", function() { a.alwaysInclude = !a.alwaysInclude; if (a.alwaysInclude) a.neverInclude = false; saveProfileToMemory(); liRenderAssignmentTable(li, charKey, s); });
                    row.find(".li-never-include").on("click", function() { a.neverInclude = !a.neverInclude; if (a.neverInclude) a.alwaysInclude = false; saveProfileToMemory(); liRenderAssignmentTable(li, charKey, s); });
                    row.find(".li-remove-assign").on("click", function() {
                        assignments.splice(idx, 1);
                        setModeCharacterAssignments(li, charKey, assignments);
                        saveProfileToMemory();
                        liRenderAssignmentTable(li, charKey, s);
                    });
                    table.append(row);
                    return;
                }

                const row = $(`
                    <div style="display: flex; flex-direction: column; gap: 10px; padding: 10px; background: rgba(0,0,0,0.15); border: 1px solid var(--border-color); border-radius: 8px; margin-bottom: 8px;">
                        <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                            <input class="ps-modern-input li-edit-char" type="text" placeholder="Character" value="${psEscapeAttr(a.character || '')}" style="flex: 1; min-width: 120px; font-size: 0.78rem; font-weight: 700; padding: 6px;" />
                            ${showMatchKw ? `<input class="ps-modern-input li-edit-match" type="text" placeholder="Match keywords" value="${psEscapeAttr(a.match_keywords || '')}" style="flex: 1.3; min-width: 140px; font-size: 0.68rem; color: var(--text-muted); padding: 6px;" />` : ''}
                            <button type="button" class="ps-modern-btn secondary li-always-include ${a.alwaysInclude ? 'active' : ''}" title="Always include this character even when match keywords are absent from recent chat" style="padding: 5px 8px; font-size: 0.65rem; color: ${a.alwaysInclude ? '#10b981' : 'var(--text-muted)'}; border-color: ${a.alwaysInclude ? 'rgba(16,185,129,0.45)' : 'var(--border-color)'};"><i class="fa-solid fa-thumbtack"></i> Always</button>
                            <button type="button" class="ps-modern-btn secondary li-never-include ${a.neverInclude ? 'active' : ''}" title="Never include this character in prompts, LoRAs, or manual tag insertion" style="padding: 5px 8px; font-size: 0.65rem; color: ${a.neverInclude ? '#ef4444' : 'var(--text-muted)'}; border-color: ${a.neverInclude ? 'rgba(239,68,68,0.45)' : 'var(--border-color)'};"><i class="fa-solid fa-ban"></i> Never</button>
                            <button class="ps-modern-btn secondary li-remove-assign" data-idx="${idx}" style="padding: 5px 8px; font-size: 0.65rem; color: #ef4444; border-color: rgba(239,68,68,0.3);"><i class="fa-solid fa-xmark"></i></button>
                        </div>
                        ${showLoras ? `<input class="ps-modern-input li-edit-lora" type="text" placeholder="LoRA file" value="${psEscapeAttr(a.lora || '')}" style="font-size: 0.7rem; color: #a855f7; padding: 6px;" />` : ''}
                        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                            <span style="font-size: 0.62rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase;">Include</span>
                            ${getTagFieldToggleDefaults().map(t => rowToggle(t.key, t.label)).join("")}
                        </div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px;">
                            ${tagField('character_tag', 'Character Tag', 'saber \\(fate\\)')}
                            ${tagField('series_tag', 'Series Tag', 'fate \\(series\\)')}
                            ${tagField('physical_tags', 'Body / Face', 'blonde hair, blue eyes')}
                            ${tagField('clothing_tags', 'Clothing', 'black jacket, dark jeans')}
                        </div>
                        ${showDesc ? `<textarea class="ps-modern-input li-edit-desc" placeholder="Physical description..." style="min-height: 84px; resize: vertical; font-size: 0.76rem; line-height: 1.45; color: #93c5fd; padding: 8px;">${psEscapeText(a.description || '')}</textarea>` : ''}
                    </div>
                `);

                row.find(".li-edit-char").on("input", function() { a.character = $(this).val(); saveProfileToMemory(); });
                if (showMatchKw) row.find(".li-edit-match").on("input", function() { a.match_keywords = $(this).val(); saveProfileToMemory(); });
                if (showLoras) row.find(".li-edit-lora").on("input", function() { a.lora = $(this).val(); saveProfileToMemory(); });
                if (showDesc) row.find(".li-edit-desc").on("input", function() { a.description = $(this).val(); saveProfileToMemory(); });
                const syncStructuredBooruTags = () => {
                    a.booru_tags = [
                        a.character_tag,
                        a.series_tag,
                        a.physical_tags,
                        a.clothing_tags
                    ].filter(Boolean).join(', ');
                };
                const suggestionBox = row.find(".li-character-tag-suggestions");
                let suggestionToken = 0;
                const hideCharacterSuggestions = () => suggestionBox.hide().empty();
                const renderCharacterSuggestionStatus = (message) => {
                    suggestionBox
                        .html(`<div style="padding: 11px 10px; min-height: 44px; display: flex; align-items: center; color: var(--text-muted); font-size: 0.78rem;">${psEscapeText(message)}</div>`)
                        .css("display", "flex")
                        .css("flex-direction", "column");
                };
                const updateCharacterSuggestions = async ($input) => {
                    const token = ++suggestionToken;
                    const query = String($input.val() || a.character || "").trim();
                    if (query.length < 2) {
                        hideCharacterSuggestions();
                        return;
                    }
                    renderCharacterSuggestionStatus("Loading character tags...");
                    await loadDanbooruCharacterSuggestions();
                    if (token !== suggestionToken) return;
                    const suggestions = findDanbooruCharacterSuggestions(query, 8);
                    suggestionBox.data("suggestions", suggestions);
                    if (suggestions.length === 0) {
                        renderCharacterSuggestionStatus("No character tag matches.");
                        return;
                    }
                    suggestionBox
                        .html(suggestions.map((item, suggestionIdx) => `
                            <button type="button" class="li-character-tag-suggestion" data-suggestion-idx="${suggestionIdx}" style="width: 100%; min-height: 46px; border: 1px solid rgba(16,185,129,0.24); background: rgba(16,185,129,0.08); color: var(--text-main); border-radius: 7px; padding: 8px 10px; text-align: left; display: flex; flex-direction: column; gap: 2px; touch-action: manipulation;">
                                <span style="font-size: 0.82rem; font-weight: 800; color: #10b981; overflow-wrap: anywhere;">${psEscapeText(item.character)}</span>
                                <span style="font-size: 0.7rem; color: var(--text-muted); overflow-wrap: anywhere;">${psEscapeText([item.copyright, item.count ? `${item.count.toLocaleString()} posts` : ""].filter(Boolean).join(" - "))}</span>
                                ${item.coreTags ? `<span style="font-size: 0.66rem; color: #86efac; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${psEscapeText(item.coreTags)}</span>` : ""}
                            </button>
                        `).join(""))
                        .css("display", "flex")
                        .css("flex-direction", "column");
                };
                const applyCharacterSuggestion = (suggestion) => {
                    if (!suggestion) return;
                    a.character_tag = suggestion.character;
                    if (!a.series_tag && suggestion.copyright) a.series_tag = suggestion.copyright;
                    syncStructuredBooruTags();
                    normalizeStructuredCharacterAssignment(a);
                    row.find('.li-edit-tag-field[data-key="character_tag"]').val(a.character_tag || "");
                    row.find('.li-edit-tag-field[data-key="series_tag"]').val(a.series_tag || "");
                    saveProfileToMemory();
                    hideCharacterSuggestions();
                };
                row.find(".li-always-include").on("click", function() { a.alwaysInclude = !a.alwaysInclude; if (a.alwaysInclude) a.neverInclude = false; saveProfileToMemory(); liRenderAssignmentTable(li, charKey, s); });
                row.find(".li-never-include").on("click", function() { a.neverInclude = !a.neverInclude; if (a.neverInclude) a.alwaysInclude = false; saveProfileToMemory(); liRenderAssignmentTable(li, charKey, s); });
                row.find(".li-row-field-toggle").on("click", function() {
                    const key = $(this).attr("data-field");
                    ensureStructuredCharacterAssignment(a);
                    a.tagFieldToggles[key] = !a.tagFieldToggles[key];
                    saveProfileToMemory();
                    liRenderAssignmentTable(li, charKey, s);
                });
                row.find(".li-edit-tag-field").on("input", function() {
                    const key = $(this).attr("data-key");
                    a[key] = $(this).val();
                    syncStructuredBooruTags();
                    saveProfileToMemory();
                    if (key === "character_tag") updateCharacterSuggestions($(this));
                });
                row.find(".li-edit-character-tag-field").on("focus", function() {
                    updateCharacterSuggestions($(this));
                });
                row.find(".li-edit-character-tag-field").on("blur", function() {
                    setTimeout(hideCharacterSuggestions, 180);
                });
                suggestionBox.on("mousedown touchstart", ".li-character-tag-suggestion", function(e) {
                    e.preventDefault();
                    const suggestions = suggestionBox.data("suggestions") || [];
                    const suggestionIdx = parseInt($(this).attr("data-suggestion-idx"), 10);
                    applyCharacterSuggestion(suggestions[suggestionIdx]);
                });
                row.find(".li-edit-tag-field").on("blur", function() {
                    const key = $(this).attr("data-key");
                    let value = a[key] || "";
                    if (value && danbooruTagsMap && danbooruTagsMap.size > 0) value = repairBooruTags(value);
                    a[key] = normalizeGeneratedTagField(value);
                    normalizeStructuredCharacterAssignment(a);
                    $(this).val(a[key]);
                    saveProfileToMemory();
                });
                row.find(".li-remove-assign").on("click", function() {
                    assignments.splice(idx, 1);
                    setModeCharacterAssignments(li, charKey, assignments);
                    saveProfileToMemory();
                    liRenderAssignmentTable(li, charKey, s);
                });
                table.append(row);
                return;
            }

            if (showDesc) {
                const row = $(`
                    <div class="li-assignment-row li-natural-assignment-row" style="display: flex; flex-direction: column; gap: 10px; padding: 10px; background: rgba(0,0,0,0.15); border: 1px solid var(--border-color); border-radius: 8px; margin-bottom: 8px;">
                        <div class="li-assignment-row-top" style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                            <input class="ps-modern-input li-edit-char" type="text" placeholder="Character" value="${psEscapeAttr(a.character || '')}" style="flex: 1; min-width: 130px; font-size: 0.82rem; font-weight: 700; padding: 8px;" />
                            ${showMatchKw ? `<input class="ps-modern-input li-edit-match" type="text" placeholder="Match keywords" value="${psEscapeAttr(a.match_keywords || '')}" style="flex: 1.3; min-width: 150px; font-size: 0.76rem; color: var(--text-muted); padding: 8px;" />` : ''}
                            ${showLoras ? `<input class="ps-modern-input li-edit-lora" type="text" placeholder="LoRA file" value="${psEscapeAttr(a.lora || '')}" style="flex: 1.2; min-width: 150px; font-size: 0.76rem; color: #a855f7; padding: 8px;" />` : ''}
                            <button type="button" class="ps-modern-btn secondary li-always-include ${a.alwaysInclude ? 'active' : ''}" title="Always include this character even when match keywords are absent from recent chat" style="padding: 6px 9px; font-size: 0.68rem; color: ${a.alwaysInclude ? '#10b981' : 'var(--text-muted)'}; border-color: ${a.alwaysInclude ? 'rgba(16,185,129,0.45)' : 'var(--border-color)'};"><i class="fa-solid fa-thumbtack"></i> Always</button>
                            <button type="button" class="ps-modern-btn secondary li-never-include ${a.neverInclude ? 'active' : ''}" title="Never include this character in prompts, LoRAs, or manual tag insertion" style="padding: 6px 9px; font-size: 0.68rem; color: ${a.neverInclude ? '#ef4444' : 'var(--text-muted)'}; border-color: ${a.neverInclude ? 'rgba(239,68,68,0.45)' : 'var(--border-color)'};"><i class="fa-solid fa-ban"></i> Never</button>
                            <button class="ps-modern-btn secondary li-remove-assign" data-idx="${idx}" title="Remove character" style="padding: 6px 9px; font-size: 0.68rem; color: #ef4444; border-color: rgba(239,68,68,0.3);"><i class="fa-solid fa-xmark"></i></button>
                        </div>
                        <label style="display: flex; flex-direction: column; gap: 5px;">
                            <span style="font-size: 0.64rem; font-weight: 800; color: #3b82f6; text-transform: uppercase;">Natural Description</span>
                            <textarea class="ps-modern-input li-edit-desc" placeholder="Stable physical description for Krea-style prompts..." style="min-height: 96px; resize: vertical; font-size: 0.82rem; line-height: 1.45; color: #93c5fd; padding: 10px;">${psEscapeText(a.description || '')}</textarea>
                        </label>
                    </div>
                `);

                row.find(".li-edit-char").on("input", function() { a.character = $(this).val(); saveProfileToMemory(); });
                if (showMatchKw) row.find(".li-edit-match").on("input", function() { a.match_keywords = $(this).val(); saveProfileToMemory(); });
                if (showLoras) row.find(".li-edit-lora").on("input", function() { a.lora = $(this).val(); saveProfileToMemory(); });
                row.find(".li-edit-desc").on("input", function() { a.description = $(this).val(); saveProfileToMemory(); });
                row.find(".li-always-include").on("click", function() { a.alwaysInclude = !a.alwaysInclude; if (a.alwaysInclude) a.neverInclude = false; saveProfileToMemory(); liRenderAssignmentTable(li, charKey, s); });
                row.find(".li-never-include").on("click", function() { a.neverInclude = !a.neverInclude; if (a.neverInclude) a.alwaysInclude = false; saveProfileToMemory(); liRenderAssignmentTable(li, charKey, s); });
                row.find(".li-remove-assign").on("click", function() {
                    assignments.splice(idx, 1);
                    setModeCharacterAssignments(li, charKey, assignments);
                    saveProfileToMemory();
                    liRenderAssignmentTable(li, charKey, s);
                });
                table.append(row);
                return;
            }

            let rowHtml = `<div style="display: grid; grid-template-columns: ${gridCols}; gap: 8px; flex: 1;">
                <input class="ps-modern-input li-edit-char" type="text" placeholder="Character" value="${a.character ? a.character.replace(/"/g, '&quot;') : ''}" style="font-size: 0.75rem; font-weight: 600; padding: 4px; border: 1px solid transparent; background: transparent; color: var(--text-main);" />`;
            if (showMatchKw) {
                rowHtml += `<input class="ps-modern-input li-edit-match" type="text" placeholder="Match (e.g. Megumin, Megu)" value="${a.match_keywords ? a.match_keywords.replace(/"/g, '&quot;') : ''}" style="font-size: 0.65rem; color: var(--text-muted); padding: 4px; border: 1px solid transparent; background: transparent;" />`;
            }
            if (showLoras) {
                rowHtml += `<input class="ps-modern-input li-edit-lora" type="text" placeholder="LoRA File" value="${a.lora ? a.lora.replace(/"/g, '&quot;') : ''}" style="font-size: 0.7rem; color: #a855f7; padding: 4px; border: 1px solid transparent; background: transparent;" />`;
            }
            if (showBooru) {
                rowHtml += `<input class="ps-modern-input li-edit-booru" type="text" placeholder="e.g. blue_eyes, long_hair, 1girl" value="${a.booru_tags ? a.booru_tags.replace(/"/g, '&quot;') : ''}" style="font-size: 0.65rem; color: #10b981; padding: 4px; border: 1px solid transparent; background: transparent;" />`;
            }
            if (showDesc) {
                rowHtml += `<input class="ps-modern-input li-edit-desc" type="text" placeholder="Physical description..." value="${a.description ? a.description.replace(/"/g, '&quot;') : ''}" style="font-size: 0.65rem; color: #3b82f6; padding: 4px; border: 1px solid transparent; background: transparent;" />`;
            }
            rowHtml += `</div>`;

            const row = $(`
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: rgba(0,0,0,0.15); border: 1px solid var(--border-color); border-radius: 6px; margin-bottom: 4px;">
                    ${rowHtml}
                    <div style="display: flex; gap: 6px; align-items: center; margin-left: 10px;">
                        <button type="button" class="ps-modern-btn secondary li-always-include ${a.alwaysInclude ? 'active' : ''}" title="Always include this character" style="padding: 2px 6px; font-size: 0.6rem; color: ${a.alwaysInclude ? '#10b981' : 'var(--text-muted)'}; border-color: ${a.alwaysInclude ? 'rgba(16,185,129,0.45)' : 'var(--border-color)'};"><i class="fa-solid fa-thumbtack"></i></button>
                        <button type="button" class="ps-modern-btn secondary li-never-include ${a.neverInclude ? 'active' : ''}" title="Never include this character" style="padding: 2px 6px; font-size: 0.6rem; color: ${a.neverInclude ? '#ef4444' : 'var(--text-muted)'}; border-color: ${a.neverInclude ? 'rgba(239,68,68,0.45)' : 'var(--border-color)'};"><i class="fa-solid fa-ban"></i></button>
                        <button class="ps-modern-btn secondary li-remove-assign" data-idx="${idx}" style="padding: 2px 6px; font-size: 0.6rem; color: #ef4444; border-color: rgba(239,68,68,0.3);"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                </div>
            `);

            row.find(".li-edit-char").on("input", function() { a.character = $(this).val(); saveProfileToMemory(); });
            if (showMatchKw) {
                row.find(".li-edit-match").on("input", function() { a.match_keywords = $(this).val(); saveProfileToMemory(); });
            }
            if (showLoras) {
                row.find(".li-edit-lora").on("input", function() { a.lora = $(this).val(); saveProfileToMemory(); });
            }
            if (showBooru) {
                row.find(".li-edit-booru").on("input", function() { a.booru_tags = $(this).val(); saveProfileToMemory(); });
                row.find(".li-edit-booru").on("blur", function() {
                    if (a.booru_tags && danbooruTagsMap && danbooruTagsMap.size > 0) {
                        const repaired = repairBooruTags(a.booru_tags);
                        if (repaired !== a.booru_tags) {
                            a.booru_tags = repaired;
                            $(this).val(repaired);
                            saveProfileToMemory();
                        }
                    }
                });
            }
            if (showDesc) {
                row.find(".li-edit-desc").on("input", function() { a.description = $(this).val(); saveProfileToMemory(); });
            }
            row.find(".li-always-include").on("click", function() { a.alwaysInclude = !a.alwaysInclude; if (a.alwaysInclude) a.neverInclude = false; saveProfileToMemory(); liRenderAssignmentTable(li, charKey, s); });
            row.find(".li-never-include").on("click", function() { a.neverInclude = !a.neverInclude; if (a.neverInclude) a.alwaysInclude = false; saveProfileToMemory(); liRenderAssignmentTable(li, charKey, s); });

            row.find(".li-remove-assign").on("click", function() {
                assignments.splice(idx, 1);
                setModeCharacterAssignments(li, charKey, assignments);
                saveProfileToMemory();
                liRenderAssignmentTable(li, charKey, s);
            });
            table.append(row);
        });
    }

    function toggleQuickGenButton() {
        const s = getLocalProfile()?.imageGen;
        if (s && s.enabled && s.triggerMode === 'manual') {
            $("#kazuma_quick_gen").css("display", "flex");
        } else {
            $("#kazuma_quick_gen").css("display", "none");
        }
    }

    async function igTestConnection() {
        try {
            const res = await fetch('/api/sd/comfy/ping', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ url: getLocalProfile().imageGen.comfyUrl }) });
            if (res.ok) { toastr.success("ComfyUI Connected!"); await igFetchComfyLists(); } else throw new Error("Ping failed");
        } catch (e) { toastr.error("Connection Failed: " + e.message); }
    }

    async function igPopulateWorkflows() {
        const sel = $("#ig_workflow_list"); sel.empty();
        try {
            const res = await fetch('/api/sd/comfy/workflows', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ url: getLocalProfile().imageGen.comfyUrl }) });
            if (res.ok) {
                const wfs = await res.json();
                wfs.forEach(w => sel.append(`<option value="${w}">${w}</option>`));
                if (getLocalProfile().imageGen.currentWorkflowName && wfs.includes(getLocalProfile().imageGen.currentWorkflowName)) {
                    sel.val(getLocalProfile().imageGen.currentWorkflowName);
                } else if (wfs.length > 0) {
                    sel.val(wfs[0]); getLocalProfile().imageGen.currentWorkflowName = wfs[0]; saveProfileToMemory();
                }
            }
        } catch (e) { sel.append('<option disabled>Failed to load</option>'); }
    }

    async function igNewWorkflowClick() {
        let name = await prompt("New workflow file name (e.g. 'my_flux.json'):");
        if (!name) return; if (!name.toLowerCase().endsWith('.json')) name += '.json';
        try {
            const res = await fetch('/api/sd/comfy/save-workflow', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ file_name: name, workflow: '{}' }) });
            if (!res.ok) throw new Error(await res.text());
            toastr.success("Workflow created!"); await igPopulateWorkflows(); $("#ig_workflow_list").val(name).trigger('change');
            setTimeout(igOpenWorkflowEditorClick, 500);
        } catch (e) { toastr.error(e.message); }
    }

    async function igDeleteWorkflowClick() {
        const name = getLocalProfile().imageGen.currentWorkflowName;
        if (!name) return; if (!confirm(`Delete ${name}?`)) return;
        try {
            const res = await fetch('/api/sd/comfy/delete-workflow', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ file_name: name }) });
            if (!res.ok) throw new Error(await res.text());
            toastr.success("Deleted."); await igPopulateWorkflows();
        } catch (e) { toastr.error(e.message); }
    }

    async function igOpenWorkflowEditorClick() {
        const name = getLocalProfile().imageGen.currentWorkflowName;
        if (!name) return toastr.warning("No workflow selected");
        let loadedContent = "{}";
        try {
            const res = await fetch('/api/sd/comfy/workflow', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ file_name: name }) });
            if (res.ok) {
                const rawBody = await res.json(); let jsonObj = rawBody;
                if (typeof rawBody === 'string') { try { jsonObj = JSON.parse(rawBody); } catch(e) {} }
                loadedContent = JSON.stringify(jsonObj, null, 4);
            }
        } catch (e) { toastr.error("Failed to load file. Starting empty."); }

        let currentJsonText = loadedContent;
        const $container = $(`
            <div style="display: flex; flex-direction: column; width: 100%; gap: 10px; font-family: 'Inter', sans-serif; color: var(--text-main);">
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-color); padding-bottom:10px;">
                    <h3 style="margin:0; color: var(--gold);">${name}</h3>
                    <div style="display:flex; gap:8px;">
                        <button class="ps-modern-btn secondary wf-format" title="Beautify JSON"><i class="fa-solid fa-align-left"></i> Format</button>
                        <button class="ps-modern-btn secondary wf-import" title="Upload .json file"><i class="fa-solid fa-upload"></i> Import</button>
                        <button class="ps-modern-btn secondary wf-export" title="Download .json file"><i class="fa-solid fa-download"></i> Export</button>
                        <input type="file" class="wf-file-input" accept=".json" style="display:none;" />
                    </div>
                </div>
                <div style="display: flex; gap: 15px;">
                    <textarea class="ps-modern-input wf-textarea" spellcheck="false" style="flex: 1; min-height: 500px; font-family: 'Consolas', 'Monaco', monospace; white-space: pre; resize: none; font-size: 13px; line-height: 1.4; background: #000;"></textarea>
                    <div style="width: 250px; flex-shrink: 0; display: flex; flex-direction: column; border-left: 1px solid var(--border-color); padding-left: 10px; max-height: 500px;">
                        <h4 style="margin: 0 0 10px 0; color: var(--text-muted);">Placeholders</h4>
                        <div class="wf-list" style="overflow-y: auto; flex: 1; padding-right: 5px;"></div>
                    </div>
                </div>
            </div>
        `);

        const $textarea = $container.find('.wf-textarea'); const $list = $container.find('.wf-list'); const $fileInput = $container.find('.wf-file-input');
        $textarea.val(currentJsonText);

        KAZUMA_PLACEHOLDERS.forEach(item => {
            const $itemDiv = $('<div></div>').css({ 'padding': '8px', 'margin-bottom': '6px', 'background': 'rgba(255,255,255,0.05)', 'border-radius': '6px', 'border': '1px solid transparent', 'transition': '0.2s' });
            $itemDiv.append($('<span></span>').text(item.key).css({'font-weight': 'bold', 'color': 'var(--gold)', 'font-family': 'monospace'})).append($('<div></div>').text(item.desc).css({ 'font-size': '0.7rem', 'color': 'var(--text-muted)', 'margin-top': '4px' }));
            $list.append($itemDiv);
        });

        const updateState = () => {
            currentJsonText = $textarea.val();
            $list.children().each(function() {
                const cleanKey = $(this).find('span').first().text().replace(/"/g, '');
                if (currentJsonText.includes(cleanKey)) $(this).css({'border-color': '#10b981', 'background': 'rgba(16, 185, 129, 0.1)'});
                else $(this).css({'border-color': 'transparent', 'background': 'rgba(255,255,255,0.05)'});
            });
        };
        $textarea.on('input', updateState); setTimeout(updateState, 100);

        $container.find('.wf-format').on('click', () => { try { $textarea.val(JSON.stringify(JSON.parse($textarea.val()), null, 4)); updateState(); toastr.success("Formatted"); } catch(e) { toastr.warning("Invalid JSON"); } });
        $container.find('.wf-import').on('click', () => $fileInput.click());
        $fileInput.on('change', (e) => { if (!e.target.files[0]) return; const r = new FileReader(); r.onload = (ev) => { $textarea.val(ev.target.result); updateState(); toastr.success("Imported"); }; r.readAsText(e.target.files[0]); $fileInput.val(''); });
        $container.find('.wf-export').on('click', () => { try { JSON.parse(currentJsonText); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([currentJsonText], {type:"application/json"})); a.download = name; a.click(); } catch(e) { toastr.warning("Invalid content"); } });

        const popup = new Popup($container, POPUP_TYPE.CONFIRM, '', { okButton: 'Save Changes', cancelButton: 'Cancel', wide: true, large: true, onClosing: () => { try { JSON.parse(currentJsonText); return true; } catch (e) { toastr.error("Invalid JSON."); return false; } } });
        if (await popup.show()) {
            try {
                const res = await fetch('/api/sd/comfy/save-workflow', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ file_name: name, workflow: JSON.stringify(JSON.parse(currentJsonText)) }) });
                if (!res.ok) throw new Error(await res.text()); toastr.success("Workflow Saved!");
            } catch (e) { toastr.error("Save Failed."); }
        }
    }

    function showKazumaProgress(text = "Processing...") {
        if ($("#kazuma_progress_overlay").length === 0) {
            $("body").append(`
                <div id="kazuma_progress_overlay" style="position: fixed; bottom: 20px; right: 20px; width: 300px; background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 15px; z-index: 99999; box-shadow: 0 10px 30px rgba(0,0,0,0.8); display: none; align-items: center; gap: 15px; font-family: 'Inter', sans-serif;">
                    <div style="flex:1">
                        <span id="kazuma_progress_text" style="font-weight: 600; font-size: 0.85rem; color: #fff; margin-bottom: 8px; display: block;">Generating Image...</span>
                        <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;">
                            <div style="height: 100%; width: 100%; background: linear-gradient(45deg, #a855f7 25%, transparent 25%, transparent 50%, #a855f7 50%, #a855f7 75%, transparent 75%, transparent); background-size: 20px 20px; animation: kazuma-stripe-anim 1s linear infinite;"></div>
                        </div>
                    </div>
                </div>
                <style>@keyframes kazuma-stripe-anim { 0% { background-position: 0 0; } 100% { background-position: 20px 0; } }</style>
            `);
        }
        $("#kazuma_progress_text").text(text); $("#kazuma_progress_overlay").css("display", "flex");
    }

    function getManualImageSelectableAssignments(li, charKey) {
        ensureLoraIntelDefaults(li);
        ensureStructuredCharacterAssignments(li, charKey);
        return getModeCharacterAssignments(li, charKey)
            .map(ensureStructuredCharacterAssignment)
            .filter(a => !a.neverInclude && String(a.character || "").trim());
    }

    function normalizeManualImageScene(scene) {
        const assignments = Array.isArray(scene?.assignments)
            ? scene.assignments.map(ensureStructuredCharacterAssignment).filter(a => a && !a.neverInclude)
            : [];
        const positions = Array.isArray(scene?.positions)
            ? scene.positions.map(p => ({
                label: String(p?.label || "").trim(),
                prompt: String(p?.prompt || "").trim()
            })).filter(p => p.label && p.prompt)
            : [];
        // Only the Manual Scene Selector sets userPickedCast. Auto/smart/
        // keyword-inferred casts must NOT be treated as a user override, or
        // "Send All Character References" silently shrinks after the first run.
        return {
            assignments,
            positions,
            userPickedCast: !!(scene?.userPickedCast && assignments.length > 0)
        };
    }

    function buildManualImageSceneInstruction(scene, s, li, booruStd = false) {
        const normalized = normalizeManualImageScene(scene);
        const lines = [];
        if (normalized.assignments.length > 0) {
            const names = normalized.assignments.map(a => a.character || "character").join(", ");
            lines.push(`Manual scene cast override: include exactly these analyzed character(s) from the selector when deciding who is present: ${names}. Ignore match-keyword absence for these characters for this generation. Do not add other analyzed characters just because their match keywords appear elsewhere.`);

            const allowStoredAppearanceGuidance = true;
            const booruLines = allowStoredAppearanceGuidance && li?.useDanbooruTags
                ? normalized.assignments.map(a => {
                    const tagBlock = getStableAssignmentTagBlock(a, li);
                    return tagBlock ? `${a.character || "character"}: ${tagBlock}` : "";
                }).filter(Boolean)
                : [];
            if (booruLines.length > 0) {
                if (booruStd || isNaturalLanguageImageStyle(s?.promptStyle)) {
                    lines.push(`Manual selected character appearance cues. Merge these into prose naturally and do not paste them as a tag dump: ${booruLines.join(" | ")}`);
                } else {
                    lines.push(`Manual selected character booru tags. Use these as the character appearance tags for the selected scene cast: ${booruLines.join(" | ")}`);
                }
            }
        }

        if (normalized.positions.length > 0) {
            lines.push(`MANDATORY selected adult action override: ${normalized.positions.map(p => `${p.label}: ${p.prompt}`).join(" | ")}. Apply the selected sex act/position to the selected visible adult character(s) even if the latest chat scene is doing a different action. Preserve the scene context around it: same environment, background, lighting, camera mood, visible participants, identities, clothing/nudity state unless the selected act logically requires shifting or opening clothing, and any important props. Change only the action, pose, body placement, and contact needed to depict the selected act clearly. Do not skip this override.`);
        }

        return lines.join("\n");
    }

    function showManualImageSceneSelector(s, li, charKey) {
        const assignments = getManualImageSelectableAssignments(li, charKey);
        if (assignments.length === 0) {
            toastr.warning("No analyzed characters available. Analyze or add character assignments first.");
            return Promise.resolve(null);
        }

        return new Promise((resolve) => {
            let done = false;
            const finish = (value) => {
                if (done) return;
                done = true;
                $overlay.remove();
                resolve(value ? normalizeManualImageScene(value) : null);
            };

            const renderAssignmentRow = (a, idx) => {
                const tagBlock = getStableAssignmentTagBlock(a, li) || getAssignmentTagBlock(a, li) || "";
                const modeLines = [];
                if (li?.useDanbooruTags) {
                    const tagText = tagBlock ? psEscapeText(tagBlock) : "No booru tags";
                    modeLines.push(`<div style="font-size:0.67rem; color:#10b981; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${psEscapeAttr(tagBlock)}">Tags: ${tagText}</div>`);
                }
                if (li?.useCharDescriptions) {
                    const descText = a.description || a.plain_description || "";
                    modeLines.push(`<div style="font-size:0.67rem; color:#3b82f6; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${psEscapeAttr(descText)}">Natural: ${psEscapeText(descText || "No description")}</div>`);
                }
                if (modeLines.length === 0) {
                    modeLines.push('<div style="font-size:0.67rem; color:var(--text-muted);">Selection will only force scene cast.</div>');
                }
                return `
                    <div class="ig-manual-scene-row" style="display:grid; grid-template-columns: auto minmax(0, 1fr) auto; gap:10px; align-items:center; padding:10px; background:rgba(0,0,0,0.18); border:1px solid var(--border-color); border-radius:8px;">
                        <input type="checkbox" class="ig-manual-scene-check" data-idx="${idx}" style="width:18px; height:18px;" />
                        <div style="min-width:0;">
                            <div style="font-size:0.85rem; font-weight:800; color:var(--text-main);">${psEscapeText(a.character || `Character ${idx + 1}`)}</div>
                            ${modeLines.join("")}
                        </div>
                        <button type="button" class="ps-modern-btn primary ig-manual-scene-one" data-idx="${idx}" style="background:var(--gold); color:#000; padding:6px 10px; font-size:0.7rem; font-weight:800;">Use Only</button>
                    </div>
                `;
            };

            const positionOptions = NSFW_POSITION_PRESETS
                .filter(p => p.prompt)
                .map((p, idx) => `
                    <label style="display:flex; align-items:center; gap:8px; padding:7px 8px; background:rgba(0,0,0,0.14); border:1px solid var(--border-color); border-radius:7px; cursor:pointer;">
                        <input type="checkbox" class="ig-manual-position-check" data-idx="${idx}" style="width:16px; height:16px;" />
                        <span style="font-size:0.76rem; font-weight:700; color:var(--text-main);">${psEscapeText(p.label)}</span>
                    </label>
                `).join("");

            const $overlay = $(`
                <div class="ig-manual-scene-overlay" style="position:fixed; inset:0; z-index:100000; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.72); font-family:'Inter', sans-serif;">
                    <style>
                        @media (max-width: 560px) {
                            .ig-manual-scene-overlay { align-items: stretch !important; padding: 8px !important; box-sizing: border-box !important; }
                            .ig-manual-scene-dialog { width: 100% !important; max-height: 100% !important; border-radius: 12px !important; }
                            .ig-manual-scene-header { align-items: flex-start !important; padding: 12px !important; }
                            .ig-manual-scene-body { padding: 10px !important; }
                            .ig-manual-scene-row { grid-template-columns: auto minmax(0, 1fr) !important; gap: 8px !important; }
                            .ig-manual-scene-one { grid-column: 1 / -1 !important; width: 100% !important; justify-content: center !important; }
                            .ig-manual-scene-position-grid { grid-template-columns: 1fr !important; }
                            .ig-manual-scene-footer { padding: 10px !important; flex-direction: column-reverse !important; }
                            .ig-manual-scene-footer button { width: 100% !important; justify-content: center !important; }
                        }
                    </style>
                    <div class="ig-manual-scene-dialog" style="width:min(760px, calc(100vw - 32px)); max-height:calc(100vh - 48px); display:flex; flex-direction:column; background:#18181b; border:1px solid var(--border-color); border-radius:14px; box-shadow:0 18px 60px rgba(0,0,0,0.65); overflow:hidden;">
                        <div class="ig-manual-scene-header" style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px 18px; border-bottom:1px solid var(--border-color);">
                            <div>
                                <div style="font-size:1rem; font-weight:900; color:var(--gold);"><i class="fa-solid fa-users-viewfinder"></i> Select Scene Characters</div>
                                <div style="font-size:0.73rem; color:var(--text-muted); margin-top:3px;">Choose one with Use Only, or check multiple characters and Send Selected. This overrides match keywords for this render only.</div>
                            </div>
                            <button type="button" class="ps-modern-btn secondary ig-manual-scene-cancel" style="padding:6px 10px;"><i class="fa-solid fa-xmark"></i></button>
                        </div>
                        <div class="ig-manual-scene-body" style="padding:14px 18px; overflow:auto; display:flex; flex-direction:column; gap:10px;">
                            ${assignments.map(renderAssignmentRow).join("")}
                            <details style="margin-top:4px; background:rgba(168,85,247,0.06); border:1px solid rgba(168,85,247,0.18); border-radius:9px; padding:10px;">
                                <summary style="cursor:pointer; user-select:none; font-size:0.82rem; font-weight:800; color:#c084fc;"><i class="fa-solid fa-venus-mars"></i> Sex-position action override</summary>
                                <div style="font-size:0.68rem; color:var(--text-muted); margin:8px 0 10px;">When selected, these override the current action/pose while keeping the scene environment, clothing, lighting, and background context.</div>
                                <div class="ig-manual-scene-position-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:7px;">${positionOptions}</div>
                            </details>
                        </div>
                        <div class="ig-manual-scene-footer" style="display:flex; justify-content:flex-end; gap:10px; padding:14px 18px; border-top:1px solid var(--border-color);">
                            <button type="button" class="ps-modern-btn secondary ig-manual-scene-cancel">Cancel</button>
                            <button type="button" class="ps-modern-btn primary ig-manual-scene-send" style="background:var(--gold); color:#000; font-weight:900;">Send Selected</button>
                        </div>
                    </div>
                </div>
            `);

            const readPositions = () => $overlay.find(".ig-manual-position-check:checked").map(function() {
                return NSFW_POSITION_PRESETS.filter(p => p.prompt)[parseInt($(this).attr("data-idx"), 10)];
            }).get().filter(Boolean);

            $("body").append($overlay);
            $overlay.find(".ig-manual-scene-one").on("click", function() {
                const idx = parseInt($(this).attr("data-idx"), 10);
                finish({ assignments: [assignments[idx]].filter(Boolean), positions: readPositions(), userPickedCast: true });
            });
            $overlay.find(".ig-manual-scene-send").on("click", function() {
                const selected = $overlay.find(".ig-manual-scene-check:checked").map(function() {
                    return assignments[parseInt($(this).attr("data-idx"), 10)];
                }).get().filter(Boolean);
                if (selected.length === 0) {
                    toastr.warning("Select at least one character, or click Use Only on a row.");
                    return;
                }
                finish({ assignments: selected, positions: readPositions(), userPickedCast: true });
            });
            $overlay.find(".ig-manual-scene-cancel").on("click", () => finish(null));
            $overlay.on("click", function(e) {
                if (e.target === this) finish(null);
            });
        });
    }

    async function igManualGenerate() {
        const s = getLocalProfile()?.imageGen;
        if (!s || !s.enabled) return;

        const clickedChat = getContext().chat || [];
        const clickedMessage = [...clickedChat].reverse().find(m => !m.is_system) || null;
        const clickedOrigin = clickedMessage ? getBackgroundOrigin(clickedMessage) : null;
        const li = s.loraIntel;
        const charKey = getCharacterKey() || "default";
        let manualScene = null;
        try {
            if (s.manualSceneSelector) {
                manualScene = await showManualImageSceneSelector(s, li, charKey);
                if (!manualScene) return;
            }
            activeManualImageScene = manualScene;
            const source = s.manualPromptSource || "comfy_llm";
            showKazumaProgress(source === "sillytavern" ? "Analyzing Scene..." : "Preparing Scene...");

            let promptText = "";
            let skipLeadPrefix = false;
            let aiText = "";
            let nanoSystemPrompt = "";
            if (source === "sillytavern") {
                let gen;
                if (s.generatorBackend === "direct") {
                    gen = await generateImagePromptText({ manualScene });
                } else {
                    gen = null;
                    await useMeguminEngine(async () => {
                        gen = await generateImagePromptText({ manualScene });
                    }, "Megumin Image");
                }
                promptText = gen ? gen.prompt : "";
                skipLeadPrefix = !!(gen && gen.skipLeadPrefix);
            } else {
                const sceneText = getSceneSnapshotForMessage(clickedMessage);
                const latestSceneText = getLatestVisualSceneText(clickedMessage);
                const normalizedManual = normalizeManualImageScene(manualScene);
                const selectedAssignments = normalizedManual.assignments;
                const selectedPositions = normalizedManual.positions;
                if (source === "comfy_llm") {
                    const nanoContext = buildComfyNanoPromptContext(s, sceneText, normalizedManual);
                    promptText = nanoContext.fallbackPrompt;
                    aiText = nanoContext.aiText;
                    nanoSystemPrompt = nanoContext.systemPrompt;
                } else {
                    const position = selectedPositions[0] || detectPositionPresetFromScene(latestSceneText);
                    promptText = buildDeterministicBackgroundPrompt(s, latestSceneText, {
                        assignments: selectedAssignments.length ? selectedAssignments : null,
                        position,
                        sceneType: position || isExplicitSceneText(latestSceneText) ? "explicit" : "normal"
                    });
                }
            }

            const imgRegex = /<img\s+prompt=["'](.*?)["']\s*\/?>/i;
            const match = promptText.match(imgRegex);
            if (match) promptText = match[1];

            toastr.info(isRunpodReady(getLocalProfile().imageGen) ? "Sending to RunPod..." : "Sending to ComfyUI...", "Megumin Suite");
            await igGenerateWithComfy(promptText, source === "comfy_llm" && clickedOrigin ? { origin: clickedOrigin } : null, {
                manualScene,
                aiText: aiText || promptText,
                nanoSystemPrompt,
                requireAiTextWorkflow: source === "comfy_llm",
                skipLeadPrefix: source === "comfy_llm" ? isNaturalLanguageImageStyle(s.promptStyle) : skipLeadPrefix
            });

        } catch(e) {
            console.error(e);
            $("#kazuma_progress_overlay").hide();
            toastr.error(e?.message || "Manual generation failed.");
        } finally {
            activeImageGenRequest = null;
            activeManualImageScene = null;
        }
    }

    const MANUAL_PROMPT_UNDO_LIMIT = 20;

    function igEnsureManualPromptState(s) {
        if (!s) return s;
        if (s.lastGeneratedImagePrompt === undefined) s.lastGeneratedImagePrompt = "";
        if (s.manualPromptFeedback === undefined) s.manualPromptFeedback = "";
        if (s.manualPrompt === undefined) s.manualPrompt = "";
        if (!Array.isArray(s.manualPromptUndoStack)) s.manualPromptUndoStack = [];
        return s;
    }

    function igRefreshManualUndoButton(s) {
        const stack = Array.isArray(s?.manualPromptUndoStack) ? s.manualPromptUndoStack : [];
        const $btn = $("#ig_manual_undo_btn");
        if (!$btn.length) return;
        $btn.prop("disabled", stack.length === 0);
        $btn.html(`<i class="fa-solid fa-rotate-left"></i> Undo (${stack.length})`);
    }

    function igRememberGeneratedImagePrompt(promptText, opts = {}) {
        const text = String(promptText || "").trim();
        if (!text) return;
        const s = getLocalProfile()?.imageGen;
        if (!s) return;
        igEnsureManualPromptState(s);
        const promptChanged = s.lastGeneratedImagePrompt !== text;
        if (promptChanged) {
            s.lastGeneratedImagePrompt = text;
            saveProfileToMemory();
        }
        if ($("#ig_last_image_prompt").length) $("#ig_last_image_prompt").val(text);
        if (opts.syncManual !== false) {
            const currentManual = String($("#ig_manual_prompt").val() ?? s.manualPrompt ?? "");
            if (currentManual.trim() !== text) {
                igSetManualPromptValue(s, text, {
                    recordUndo: true,
                    toast: opts.toast || null
                });
            }
        }
    }

    function igPushManualPromptUndo(s, previousPrompt) {
        igEnsureManualPromptState(s);
        const prev = String(previousPrompt ?? "");
        const last = s.manualPromptUndoStack[s.manualPromptUndoStack.length - 1];
        if (last === prev) return false;
        s.manualPromptUndoStack.push(prev);
        if (s.manualPromptUndoStack.length > MANUAL_PROMPT_UNDO_LIMIT) {
            s.manualPromptUndoStack.splice(0, s.manualPromptUndoStack.length - MANUAL_PROMPT_UNDO_LIMIT);
        }
        return true;
    }

    function igSetManualPromptValue(s, nextPrompt, opts = {}) {
        igEnsureManualPromptState(s);
        const next = String(nextPrompt || "");
        const current = String($("#ig_manual_prompt").val() ?? s.manualPrompt ?? "");
        if (next === current) {
            igRefreshManualUndoButton(s);
            return next;
        }
        if (opts.recordUndo) igPushManualPromptUndo(s, current);
        s.manualPrompt = next;
        if ($("#ig_manual_prompt").length) $("#ig_manual_prompt").val(next);
        saveProfileToMemory();
        igRefreshManualUndoButton(s);
        if (opts.toast) toastr.success(opts.toast);
        return next;
    }

    function igUndoManualPrompt(s) {
        igEnsureManualPromptState(s);
        if (!s.manualPromptUndoStack.length) return toastr.info("Nothing to undo.");
        const restored = s.manualPromptUndoStack.pop();
        s.manualPrompt = String(restored ?? "");
        if ($("#ig_manual_prompt").length) $("#ig_manual_prompt").val(s.manualPrompt);
        saveProfileToMemory();
        igRefreshManualUndoButton(s);
        toastr.success("Manual prompt restored.");
    }

    function buildManualPromptFeedbackSystemPrompt(s) {
        const styleHint = s?.promptStyle === "krea2"
            ? "Keep the result as one dense paragraph of fluent natural-language image-generation prose (not tag lists). Keep it a photograph starting with phrasing such as 'A photo of'; do not call it a digital illustration, anime, drawing, 2d, or cartoon."
            : ((s?.promptStyle === "sdxl")
                ? "Keep the result as one dense paragraph of fluent natural-language image-generation prose (not tag lists)."
                : "Keep the result as a comma-separated list of lowercase image tags (spaces instead of underscores), matching the existing style.");
        return [
            "You revise an existing image-generation prompt using the user's feedback.",
            "Start from CURRENT PROMPT and apply only the requested FEEDBACK changes.",
            "Preserve everything that the feedback does not mention: subjects, identities, pose, camera, setting, lighting, clothing/nudity state, and explicitness level.",
            "Do not invent a new scene unless the feedback asks for it.",
            "Every depicted person must remain an unmistakable adult.",
            styleHint,
            "Output contract: respond with the finished revised image prompt only. No preamble, quotes, labels, meta-commentary, or explanations."
        ].join(" ");
    }

    async function igRegenerateManualPromptWithFeedback(s, $btn) {
        igEnsureManualPromptState(s);
        const current = String($("#ig_manual_prompt").val() || s.manualPrompt || "").trim();
        const feedback = String($("#ig_manual_prompt_feedback").val() || s.manualPromptFeedback || "").trim();
        if (!current) return toastr.warning("Manual prompt is empty. Paste or load a prompt first.");
        if (!feedback) return toastr.warning("Add feedback first, then regenerate.");
        const writer = getPromptWriterSettings();
        if (!writer.apiKey) return toastr.warning(`Add a ${writer.label} API key in the Prompt Writer card first.`);

        s.manualPromptFeedback = feedback;
        saveProfileToMemory();

        const originalHtml = $btn?.length ? $btn.html() : "";
        if ($btn?.length) $btn.prop("disabled", true).html('<i class="fa-solid fa-spinner fa-spin"></i> Rewriting...');
        try {
            const revised = await callPromptWriter(
                buildManualPromptFeedbackSystemPrompt(s),
                `CURRENT PROMPT:\n${current}\n\nFEEDBACK:\n${feedback}`
            );
            if (!revised) throw new Error(`${writer.label} returned an empty response.`);
            const cleaned = stripUtilityThinkingWrapper(revised).trim();
            if (!cleaned) throw new Error(`${writer.label} returned an empty response.`);
            igSetManualPromptValue(s, cleaned, {
                recordUndo: true,
                toast: "Manual prompt updated from feedback."
            });
        } catch (e) {
            toastr.error(e?.message || "Could not regenerate the manual prompt.");
        } finally {
            if ($btn?.length) $btn.prop("disabled", false).html(originalHtml || '<i class="fa-solid fa-rotate"></i> Regenerate With Feedback');
        }
    }

    async function igRenderManualPrompt() {
        const s = getLocalProfile()?.imageGen;
        if (!s || !s.enabled) return toastr.warning("Image Generation must be enabled first.");
        const promptText = String($("#ig_manual_prompt").val() || s.manualPrompt || "").trim();
        if (!promptText) return toastr.warning("Manual prompt cannot be empty.");
        s.manualPrompt = promptText;
        saveProfileToMemory();

        showKazumaProgress("Preparing Manual Image...");
        try {
            await igGenerateWithComfy(promptText, null);
        } catch (e) {
            $("#kazuma_progress_overlay").hide();
            toastr.error("Manual image render failed: " + e.message);
        }
    }

    function igAddCharacterInfoToManualPrompt(s, li, charKey) {
        ensureLoraIntelDefaults(li);
        if (!li || getModeCharacterAssignments(li, charKey).length === 0) {
            toastr.warning("No character assignments available. Analyze characters first.");
            return;
        }
        let assignments = getMatchedCharacterAssignments(li, charKey);
        if (assignments.length === 0) assignments = getModeCharacterAssignments(li, charKey).map(ensureStructuredCharacterAssignment).filter(a => !a.neverInclude);

        const snippets = assignments.map((a) => {
            const tagBlock = getAssignmentTagBlock(a, li);
            return tagBlock || "";
        }).filter(Boolean);

        if (snippets.length === 0) {
            toastr.warning("No enabled character tag fields to add.");
            return;
        }

        const next = appendPromptTextToTextarea("#ig_manual_prompt", snippets.join(", "));
        s.manualPrompt = next;
        saveProfileToMemory();
        toastr.success("Character info added to manual prompt.");
    }

    // New Helper Function for generating the prompt text
    function getMatchedBooruTags(li, charKey, manualAssignments = null, opts = null) {
        if (!li || !li.enabled || !li.useDanbooruTags) return [];
        const matched = [];

        for (const a of getPromptAiCharacterAssignments(li, charKey, manualAssignments, opts)) {
            ensureStructuredCharacterAssignment(a);
            const tagBlock = getAssignmentTagBlock(a, li);
            if (!tagBlock) continue;
            matched.push({ character: a.character, tags: tagBlock });
        }
        return matched;
    }

    function getAssignmentNaturalDescription(a) {
        ensureStructuredCharacterAssignment(a);
        const plain = String(a.plain_description || "").trim();
        const booruDump = normalizeGeneratedTagField(a.booru_tags || "");
        if (plain && (!booruDump || normalizeGeneratedTagField(plain) !== booruDump)) return plain;
        return String(a.description || "").trim();
    }

    function getMatchedCharacterAssignments(li, charKey, manualAssignments = null, opts = null) {
        if (!li || !li.enabled) return [];
        return getPromptAiCharacterAssignments(li, charKey, manualAssignments, opts);
    }

    function getActiveCharacterAssignments(li, charKey, manualAssignments = null) {
        if (!li) return [];
        if (Array.isArray(manualAssignments) && manualAssignments.length > 0) {
            return manualAssignments.map(ensureStructuredCharacterAssignment).filter(a => a && !a.neverInclude);
        }
        const assignments = getModeCharacterAssignments(li, charKey)
            .map(ensureStructuredCharacterAssignment)
            .filter(a => !a.neverInclude);
        if (assignments.length === 0) return [];

        const recentChat = getRecentChatForLoraKeywords();
        const allowEmptyMatch = assignments.length <= 1;
        return assignments
            .filter(a => assignmentMatchesRecentChat(a, recentChat, allowEmptyMatch));
    }

    function getPromptAiCharacterAssignments(li, charKey, manualAssignments = null, opts = null) {
        if (!li) return [];
        const userPickedCast = !!(opts?.userPickedCast && Array.isArray(manualAssignments) && manualAssignments.length > 0);
        // User explicitly picked a cast in the Manual Scene Selector → only
        // those references. Otherwise (including keyword-inferred casts), honor
        // Send All so the prompt AI always gets the full appearance library.
        if (userPickedCast) {
            return manualAssignments.map(ensureStructuredCharacterAssignment).filter(a => a && !a.neverInclude);
        }
        if (li.sendAllCharactersToPromptAi) {
            return getModeCharacterAssignments(li, charKey)
                .map(ensureStructuredCharacterAssignment)
                .filter(a => a && !a.neverInclude);
        }
        if (Array.isArray(manualAssignments) && manualAssignments.length > 0) {
            return manualAssignments.map(ensureStructuredCharacterAssignment).filter(a => a && !a.neverInclude);
        }
        return getActiveCharacterAssignments(li, charKey, manualAssignments);
    }

    function shouldPromptAiChooseCharacters(li, manualAssignments = null, opts = null) {
        if (!li?.sendAllCharactersToPromptAi) return false;
        // Only a user-picked Manual Scene cast disables the choose-from-library
        // mode. Inferred/auto assignment lists must not.
        if (opts?.userPickedCast && Array.isArray(manualAssignments) && manualAssignments.length > 0) return false;
        return true;
    }

    function getPromptAiCharacterChoiceInstruction(li, manualAssignments = null, opts = null) {
        if (shouldPromptAiChooseCharacters(li, manualAssignments, opts)) {
            return "All analyzed character references are provided below as a reference library. Choose which character or characters are actually present from the latest roleplay message/scene, and use only those chosen characters in the image prompt. Do not include every reference character by default, and do not add absent characters just because their reference appears here.";
        }
        return "Use these stable appearance cues for who is present, then derive action, pose, expression, temporary state, setting, and composition from the chat scene.";
    }

    function getCurrentCharacterTextContext() {
        const context = getContext();
        if (context.characterId === undefined || context.characterId === null || !context.characters?.[context.characterId]) {
            return { description: "", firstMessage: "" };
        }
        const character = context.characters[context.characterId];
        return {
            description: String(character.description || character.desc || "").trim(),
            firstMessage: String(character.first_mes || character.first_message || character.firstMessage || "").trim()
        };
    }

    function getUserDisplayName() {
        const context = getContext();
        const raw = typeof substituteParams === 'function'
            ? substituteParams('{{user}}')
            : (context.name1 || context.userName || context.user_name || "the player character");
        const name = String(raw || "").trim();
        if (!name || name === "{{user}}") return "the player character";
        return name;
    }

    function getUserPersonaText() {
        if (typeof substituteParams !== 'function') return "";
        const raw = String(substituteParams('{{persona}}') || "").trim();
        if (!raw || raw === "{{persona}}" || /^no user persona found\.?$/i.test(raw)) return "";
        return cleanMessageTextForKeywords(raw);
    }

    function isUserPresentInRecentScene() {
        const context = getContext();
        const chat = context.chat || [];
        if (chat.length === 0) return false;
        const recent = chat.filter(m => !m.is_system).slice(-5);
        if (recent.some(m => m.is_user && cleanMessageTextForKeywords(m.mes))) return true;

        const userName = getUserDisplayName().toLowerCase();
        if (!userName || userName === "the player character") return false;
        const recentAiText = recent
            .filter(m => !m.is_user)
            .map(m => cleanMessageTextForKeywords(m.mes))
            .join("\n")
            .toLowerCase();
        return keywordAppearsInText(userName, recentAiText);
    }

    function buildPersonaImageGuidance(s, booruStd = false) {
        if (!isUserPresentInRecentScene()) return "";

        const userName = getUserDisplayName();
        const persona = getUserPersonaText();
        const personaLine = persona ? ` Persona appearance: ${persona}` : "";
        if (s?.promptPerspective === "pov") {
            return `The player character (${userName}) is present as the camera/viewpoint. Do not omit them: show visible first-person body cues when appropriate, such as hands, arms, torso, lap, clothing, shadow, reflection, or interaction contact.${personaLine}`;
        }
        if (isNaturalLanguageImageStyle(s?.promptStyle) || booruStd) {
            return `The player character (${userName}) is physically present in the scene. Include them as a visible participant, not just an implied observer. Describe their placement, interaction with the other character(s), pose/body contact, and visible appearance.${personaLine}`;
        }
        return `The player character (${userName}) is physically present. Include them as visible Anima-style prompt content, using tags for player/persona presence, count/composition, pose, interaction, body contact, clothing, and visible appearance. Do not make the scene solo unless the chat clearly says they are off-screen.${personaLine}`;
    }

    function getAssignmentTagBlock(a, li = null) {
        ensureStructuredCharacterAssignment(a);
        const parts = getAssignmentTagParts(a, li);
        return normalizeGeneratedTagField(parts.join(', '));
    }

    function getPlainAssignmentText(a) {
        ensureStructuredCharacterAssignment(a);
        const characterTag = getVerifiedBooruCharacterTag(a.character_tag);
        const stableStructured = [
            characterTag,
            a.series_tag,
            a.physical_tags,
            a.clothing_tags
        ].filter(Boolean).join(', ');
        const plainDescription = normalizeGeneratedTagField(a.plain_description || "");
        const fullTagDump = normalizeGeneratedTagField(a.booru_tags || "");
        const plainLooksAutoSeeded = plainDescription && fullTagDump && plainDescription === fullTagDump;
        return plainLooksAutoSeeded
            ? stableStructured
            : (a.plain_description || a.description || stableStructured);
    }

    function getStableAssignmentTagBlock(a, li = null) {
        ensureStructuredCharacterAssignment(a);
        if (li?.assignmentViewMode === 'plain') {
            return normalizeGeneratedTagField(getPlainAssignmentText(a));
        }
        const globalToggles = li?.tagFieldToggles || {};
        const rowToggles = a?.tagFieldToggles || {};
        const enabled = (key) => globalToggles[key] !== false && rowToggles[key] !== false;
        const characterTag = getVerifiedBooruCharacterTag(a.character_tag);
        return normalizeGeneratedTagField([
            enabled("characterTag") ? characterTag : "",
            enabled("seriesTag") ? a.series_tag : "",
            enabled("physicalTags") ? a.physical_tags : "",
            enabled("clothingTags") ? a.clothing_tags : ""
        ].filter(Boolean).join(', '));
    }

    function getMatchedCharacterGuidance(li, charKey, manualAssignments = null, opts = null) {
        if (!li || !li.enabled || !li.useDanbooruTags) return [];
        return getPromptAiCharacterAssignments(li, charKey, manualAssignments, opts)
            .map(a => ({ character: a.character || "character", tags: getStableAssignmentTagBlock(a, li) }))
            .filter(a => a.tags);
    }

    function getAssignmentTagParts(a, li) {
        ensureStructuredCharacterAssignment(a);
        if (li?.assignmentViewMode === 'plain') {
            return [getPlainAssignmentText(a)].filter(Boolean);
        }
        const globalToggles = li?.tagFieldToggles || {};
        const rowToggles = a?.tagFieldToggles || {};
        const enabled = (key) => globalToggles[key] !== false && rowToggles[key] !== false;
        const characterTag = getVerifiedBooruCharacterTag(a.character_tag);
        return [
            enabled("characterTag") ? characterTag : "",
            enabled("seriesTag") ? a.series_tag : "",
            enabled("physicalTags") ? a.physical_tags : "",
            enabled("clothingTags") ? a.clothing_tags : ""
        ].filter(Boolean);
    }

    function shouldUseCharacterGuidance(s, li) {
        return !!(s && li && li.enabled && li.useDanbooruTags && li.promptAssemblyMode === 'structured');
    }

    function isBooruStandardImageMode(s, li) {
        return !!(s && li && li.enabled && li.useDanbooruTags && s.promptStyle === 'standard');
    }

    /**
     * LoRA Intelligence → Booru Tags toggle only (not Ensure LoRAs, not Character descriptions).
     * Stable leading-tags prepend and [[img1]] prefix line both use buildBooruStandardTagLead(), which checks this.
     */
    function isLoraIntelBooruTagsMode(li) {
        return !!(li && li.enabled && li.useDanbooruTags);
    }

    /** Comfy / preview prefix from leading tags + LoRA triggers when Booru Tags mode is on; empty otherwise. */
    function buildBooruStandardTagLead(s, li) {
        if (!s || !isLoraIntelBooruTagsMode(li)) return '';
        const lead = String(s.standardBooruLeadTags || "").trim();
        const triggers = String(s.loraTriggers || "").trim();
        const parts = [];
        if (lead) parts.push(lead);
        if (triggers) parts.push(triggers);
        if (!parts.length) return '';
        return normalizeGeneratedTagField(parts.join(", "));
    }

    async function generateImagePromptText(opts = null) {
        const s = getLocalProfile().imageGen;
        const li = s.loraIntel;
        const manualScene = normalizeManualImageScene(opts?.manualScene || activeManualImageScene);

        const chat = getContext().chat;
        const charKey = getCharacterKey() || "default";

        const lastMessages = opts?.chatText || chat.filter(m => !m.is_system).slice(-5).map(m => {
            const text = cleanMessageTextForKeywords(m.mes);
            return `${m.name}: ${text.trim()}`;
        }).join("\n\n");

        const booruStd = isBooruStandardImageMode(s, li);
        const booruStableLeadPrepend = buildBooruStandardTagLead(s, li);
        const allowStoredAppearanceGuidance = true;
        const manualAssignments = manualScene.assignments;
        const castOpts = { userPickedCast: !!manualScene.userPickedCast };
        const characterGuidance = allowStoredAppearanceGuidance && shouldUseCharacterGuidance(s, li) ? getMatchedCharacterGuidance(li, charKey, manualAssignments, castOpts) : [];
        const guidedCharacters = characterGuidance.length > 0;
        const characterChoiceInstruction = getPromptAiCharacterChoiceInstruction(li, manualAssignments, castOpts);
        const personaGuidance = buildPersonaImageGuidance(s, booruStd);
        const manualSceneInstruction = buildManualImageSceneInstruction(manualScene, s, li, booruStd);

        let styleStr;
        if (s.promptStyle === "illustrious") {
            styleStr = "Use Danbooru-style tags separated by commas.";
        } else if (s.promptStyle === "krea2") {
            styleStr = KREA2_PROMPT_INSTRUCTION;
            if (booruStableLeadPrepend) {
                styleStr += " Do not repeat the user's fixed leading-tags field; the app applies those tags separately from your generated prose.";
            }
        } else if (s.promptStyle === "sdxl") {
            styleStr = "SDXL — output ONLY fluent English prose (one to several short paragraphs). Describe the subject, body, clothing, pose, expression, environment, lighting, and camera feel in full sentences. STRICTLY FORBIDDEN: comma-separated tag lists, Danbooru-style tokens with underscores, shorthand like \"1girl\" or \"solo\", or planning/meta text. If Extra Details contain shorthand or tag-like cues, translate every cue into natural language (e.g. a look-alike tag becomes a short phrase, never the raw token).";
            styleStr += ` ${IMAGE_BODY_SHAPE_POSITIVE_INSTRUCTION}`;
            if (booruStableLeadPrepend) {
                styleStr += " Do NOT prepend or repeat the user's fixed leading-tags field; it is inserted automatically after your output when LoRA Intelligence Booru Tags mode is on.";
            }
        } else if (booruStd) {
            styleStr = "Write ONLY a flowing natural-language image description (full sentences, not comma-separated tag lists). Turn visual shorthand into prose—for example \"1girl, blue eyes, huge breasts\" becomes \"a woman with blue eyes and huge breasts.\" Describe actions, poses, and interactions in clear descriptive language.";
            if (booruStableLeadPrepend) {
                styleStr += " Do NOT output a leading comma-separated tag block; only the user's fixed \"leading tags\" field is prepended automatically after this step.";
            }
            styleStr += " If Extra Details lists scene cues and/or character-appearance Danbooru-style tags, merge them into your prose (translate into natural descriptions; do not paste them as a tag dump). Output prose for the scene only.";
            styleStr += ` ${IMAGE_BODY_SHAPE_POSITIVE_INSTRUCTION}`;
        } else {
            styleStr = "Use a comma-separated list of detailed keywords and visual descriptors.";
        }
        if (li && li.enabled && li.useDanbooruTags && !isNaturalLanguageImageStyle(s.promptStyle) && !booruStd) {
            styleStr += " For Anima, use lowercase tags with spaces instead of underscores, escape literal parentheses in known character/series tags (example: saber \\(fate\\)), and do not combine story character names with look-alike tags.";
        }
        const maxAnimaTags = getAnimaMaxTags(s);
        if (maxAnimaTags && !isNaturalLanguageImageStyle(s.promptStyle) && !booruStd) {
            styleStr += ` Keep the complete prompt concise: output no more than ${maxAnimaTags} comma-separated tags total, prioritizing characters, action, pose, expression, camera, and setting.`;
        }
        styleStr += ` ${IMAGE_SCENE_FIDELITY_INSTRUCTION}`;
        if (s.structuredPromptRules) {
            styleStr += ` ${buildImagePromptStructureRules(s, booruStd)}`;
        }

        let perspStr = s.promptPerspective === "pov" ? "Frame the scene strictly from a First-Person (POV) perspective." : (s.promptPerspective === "character" ? "Focus intensely on the character's appearance." : "Describe the entire environment and atmosphere.");

        let extraStr = "None";
        if (booruStd) {
            const extraParts = [];
            const combinedExtra = [s.promptExtra, opts?.extraInstruction].map(v => String(v || "").trim()).filter(Boolean).join("\n");
            const pe = combinedExtra;
            if (pe) {
                extraParts.push(
                    booruStableLeadPrepend
                        ? `Scene tags and cues (from the user's Extra field, often comma-separated shorthand). Interpret and weave into your flowing description; translate into prose where needed. Do not paste this block unchanged as a prefix or suffix—the only automatic prefix is the separate \"leading tags\" field.\n${pe}`
                        : `Scene tags and cues (from the user's Extra field, often comma-separated shorthand). Interpret and weave into your flowing description; translate into prose where needed.\n${pe}`
                    );
            }
            if (guidedCharacters) {
                const guide = characterGuidance.map(m => `${m.character}: ${m.tags}`).join(' | ');
                extraParts.push(`Character reference library. ${characterChoiceInstruction} Translate tags into flowing prose; do not paste them as a tag block.\n${guide}`);
            } else if (allowStoredAppearanceGuidance && li && li.enabled) {
                const matchedBooru = getMatchedBooruTags(li, charKey, manualAssignments, castOpts);
                if (matchedBooru.length > 0) {
                    const booruInstr = matchedBooru.map(m => `${m.character}: ${m.tags}`).join(' | ');
                    extraParts.push(`Character appearance cues (Danbooru-style tags per role). ${characterChoiceInstruction} Weave the chosen character cues into your flowing description: translate into prose (face, hair, eyes, figure, clothing, any named character look-alike tag). Do not emit them as a comma-separated prefix or block.\n${booruInstr}`);
                }
            }
            if (personaGuidance) {
                extraParts.push(`Player character visibility:\n${personaGuidance}`);
            }
            if (s.adultTagPrecision) {
                extraParts.push(getAdultPrecisionInstruction(s));
            }
            if (manualSceneInstruction) {
                extraParts.push(manualSceneInstruction);
            }
            if (s.includePromptExamples) {
                extraParts.push(`Template example:\n${buildImagePromptExamples(s, booruStd)}`);
            }
            if (extraParts.length > 0) extraStr = extraParts.join("\n\n");
        } else {
            extraStr = [s.promptExtra, opts?.extraInstruction].map(v => String(v || "").trim()).filter(Boolean).join("\n") || "None";
            if (guidedCharacters) {
                const guide = characterGuidance.map(m => `${m.character}: ${m.tags}`).join(' | ');
                if (isNaturalLanguageImageStyle(s.promptStyle)) {
                    extraStr += `\nCharacter reference library. ${characterChoiceInstruction} Translate chosen character cues into fluent English only: ${guide}`;
                } else {
                    extraStr += `\nCharacter reference library. ${characterChoiceInstruction} Keep chosen Anima-style tags with spaces and escaped literal parentheses: ${guide}`;
                }
            } else if (allowStoredAppearanceGuidance && li && li.enabled) {
                const matchedBooru = getMatchedBooruTags(li, charKey, manualAssignments, castOpts);
                if (matchedBooru.length > 0) {
                    const booruInstr = matchedBooru.map(m => `${m.character}: ${m.tags}`).join(' | ');
                    extraStr += `\n${characterChoiceInstruction}`;
                    if (isNaturalLanguageImageStyle(s.promptStyle)) {
                        extraStr += `\nCharacter appearance shorthand (per role). Fold ONLY into flowing English prose—translate hair, eyes, figure, outfit, and any look-alike references; NEVER output as comma tags, underscores, or token lists: ${booruInstr}`;
                    } else {
                        extraStr += `\nCharacter appearance tags by role. Use these as Anima-style comma tags with spaces instead of underscores. Keep known character/series tags exact and escaped when they have parentheses. Do not combine story names with look-alike tags: ${booruInstr}`;
                    }
                }
            }
            if (personaGuidance) {
                extraStr += `\nPlayer character visibility: ${personaGuidance}`;
            }
            if (s.adultTagPrecision) {
                extraStr = appendImagePromptInstruction(extraStr, getAdultPrecisionInstruction(s));
            }
            if (manualSceneInstruction) {
                extraStr = appendImagePromptInstruction(extraStr, manualSceneInstruction);
            }
            if (s.includePromptExamples) {
                extraStr = appendImagePromptInstruction(extraStr, `Template example: ${buildImagePromptExamples(s, booruStd)}`);
            }
        }

        activeImageGenRequest = { chatText: lastMessages, styleStr: styleStr, perspStr: perspStr, extraStr: extraStr, isKrea2: s.promptStyle === "krea2" };

        let rawOutput;
        try {
            rawOutput = await generateQuietPrompt({ prompt: "___PS_IMAGE_GEN___" });
        } finally {
            activeImageGenRequest = null;
        }
        let finalPrompt = stripUtilityThinkingWrapper(rawOutput);
        if (s.promptStyle === "krea2" && findKrea2ForbiddenMinorTerm(finalPrompt)) {
            throw new Error("Krea 2 prompt blocked: generated input contained forbidden minor-related wording.");
        }
        if (s.promptStyle === "illustrious") {
            finalPrompt = stripPreambleBeforeBooruTags(finalPrompt);
        }

        finalPrompt = sanitizePromptTags(finalPrompt);
        if (!isNaturalLanguageImageStyle(s.promptStyle) && !booruStd) {
            finalPrompt = normalizeAnimaGeneratedTags(finalPrompt);
        }
        finalPrompt = limitAnimaPromptTags(finalPrompt, s, li);

        return { prompt: finalPrompt, skipLeadPrefix: false };
    }

    function igReadBlobAsDataUrl(blob) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
    }

    async function igMaybeCompressDataUrl(dataUrl, s) {
        let base64Clean = dataUrl;
        let format = igGetDataUrlFormat(dataUrl) || "png";
        if (s.compressImages) {
            base64Clean = await new Promise((resolve) => {
                const img = new Image();
                img.src = dataUrl;
                img.onload = () => {
                    const cvs = document.createElement('canvas');
                    cvs.width = img.width;
                    cvs.height = img.height;
                    cvs.getContext('2d').drawImage(img, 0, 0);
                    resolve(cvs.toDataURL("image/jpeg", 0.9));
                };
                img.onerror = () => resolve(dataUrl);
            });
            format = "jpeg";
        }
        return { base64Clean, format };
    }

    function igGetDataUrlFormat(dataUrl) {
        const match = String(dataUrl || "").match(/^data:image\/([^;]+);base64,/i);
        if (!match) return "";
        return match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase();
    }

    async function igAttachGeneratedImage(base64Clean, finalPrompt, target, format = "png") {
        const skipManualSync = !!(target?.libraryOnly || target?.background);
        igRememberGeneratedImagePrompt(finalPrompt, { syncManual: !skipManualSync });
        if (target?.origin && !target.message) {
            target = { ...target, ...(resolveBackgroundOrigin(target.origin) || {}) };
        }
        const charName = getContext().characters[getContext().characterId]?.name || "User";
        const cleanBase64 = String(base64Clean || "").includes(",") ? String(base64Clean).split(",").pop() : String(base64Clean || "");
        const savedPath = await saveBase64AsFile(cleanBase64, charName, `${charName}_${humanizedDateTime()}`, format);
        const mediaAttach = {
            url: savedPath,
            type: "image",
            source: "generated",
            prompt: finalPrompt,
            title: finalPrompt,
            generation_type: "free",
            megumin_background: target?.metadata || undefined
        };

        if (target?.libraryOnly) {
            const s = getLocalProfile()?.imageGen;
            const automation = ensureBackgroundAutomationSettings(s);
            automation.library.push({
                id: `megumin-lib-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                url: savedPath,
                filename: String(savedPath || "").split(/[\\/]/).filter(Boolean).pop() || "",
                prompt: finalPrompt,
                createdAt: Date.now(),
                ...(target.metadata || {})
            });
            if (automation.library.length > 500) automation.library.splice(0, automation.library.length - 500);
            saveProfileToMemory();
            refreshBatchLibraryInventory();
            if (!target.background) toastr.success("Batch image added to library.");
        } else if (target && target.message) {
            if (!target.message.extra) target.message.extra = {};
            if (!target.message.extra.media) target.message.extra.media = [];
            target.message.extra.media_display = "gallery";
            target.message.extra.media.push(mediaAttach);
            target.message.extra.media_index = target.message.extra.media.length - 1;
            if (typeof appendMediaToMessage === "function") appendMediaToMessage(target.message, target.element);
            await saveChat();
            if (!target.background) toastr.success("Gallery updated!");
        } else {
            const newMsg = { name: "Image Gen Kazuma", is_user: false, is_system: true, send_date: Date.now(), mes: "", extra: { media: [mediaAttach], media_display: "gallery", media_index: 0 }, force_avatar: "img/five.png" };
            getContext().chat.push(newMsg);
            await saveChat();
            if (typeof addOneMessage === "function") addOneMessage(newMsg);
            else await reloadCurrentChat();
            toastr.success("Image inserted!");
        }
    }

    async function attachLibraryImageToOrigin(libraryItem, origin) {
        const target = resolveBackgroundOrigin(origin);
        if (!target?.message) return false;
        if (!target.message.extra) target.message.extra = {};
        if (!Array.isArray(target.message.extra.media)) target.message.extra.media = [];
        target.message.extra.media_display = "gallery";
        target.message.extra.media.push({
            url: libraryItem.url,
            type: "image",
            source: "generated",
            prompt: libraryItem.prompt || "",
            title: libraryItem.prompt || "",
            generation_type: "free",
            megumin_background: { source: "qwen-library", libraryId: libraryItem.id }
        });
        target.message.extra.media_index = target.message.extra.media.length - 1;
        if (target.element?.length && typeof appendMediaToMessage === "function") {
            appendMediaToMessage(target.message, target.element);
        }
        await saveChat();
        return true;
    }

    function igRunpodCandidateToImage(candidate) {
        if (!candidate || typeof candidate !== "object") return null;
        const data = String(candidate.data || "").trim();
        if (!data) return null;
        if (candidate.type === "s3_url") {
            return /^https?:\/\//i.test(data) ? { url: data } : null;
        }
        if (candidate.type === "base64") {
            return {
                dataUrl: /^data:image\//i.test(data) ? data : `data:image/png;base64,${data}`,
                format: "png"
            };
        }
        return null;
    }

    function igFindRunpodImageCandidate(statusData) {
        // worker-comfyui 5.x returns generated images at output.images[].
        const images = statusData?.output?.images;
        if (!Array.isArray(images)) return null;
        return images.map(igRunpodCandidateToImage).find(Boolean) || null;
    }

    async function igResolveRunpodImageDataUrl(statusData) {
        const image = igFindRunpodImageCandidate(statusData);
        if (!image) {
            throw new Error("RunPod completed but no image data was found in the output.");
        }
        if (image.dataUrl) return image;
        const response = await fetch(image.url);
        if (!response.ok) throw new Error(`RunPod image download failed: ${response.status}`);
        const dataUrl = await igReadBlobAsDataUrl(await response.blob());
        return { dataUrl, format: igGetDataUrlFormat(dataUrl) || "png" };
    }

    async function igGenerateWithRunpod(workflow, finalPrompt, target, s) {
        const runpod = ensureRunpodSettings(s);
        if (!runpod.endpointId || !runpod.apiKey) {
            throw new Error("RunPod endpoint ID and API key are required.");
        }

        const endpointBase = `https://api.runpod.ai/v2/${encodeURIComponent(runpod.endpointId)}`;
        if (!target?.background) showKazumaProgress("Sending to RunPod...");
        const submitRes = await fetch(`${endpointBase}/run`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${runpod.apiKey}`
            },
            body: JSON.stringify({ input: { workflow } })
        });
        if (!submitRes.ok) {
            const text = await submitRes.text().catch(() => "");
            throw new Error(`RunPod submit failed: ${submitRes.status}${text ? ` ${text.slice(0, 160)}` : ""}`);
        }

        const submitData = await submitRes.json();
        const jobId = submitData.id || submitData.jobId || submitData.job_id;
        if (!jobId) throw new Error("RunPod returned no job ID.");

        if (!target?.background) showKazumaProgress("Rendering on RunPod...");
        const started = Date.now();
        while (Date.now() - started <= runpod.timeoutMs) {
            await new Promise(resolve => setTimeout(resolve, runpod.pollIntervalMs));
            const statusRes = await fetch(`${endpointBase}/status/${encodeURIComponent(jobId)}`, {
                headers: { "Authorization": `Bearer ${runpod.apiKey}` }
            });
            if (!statusRes.ok) throw new Error(`RunPod status failed: ${statusRes.status}`);
            const statusData = await statusRes.json();
            const status = String(statusData.status || "").toUpperCase();

            if (status === "COMPLETED") {
                if (!target?.background) showKazumaProgress("Downloading...");
                const image = await igResolveRunpodImageDataUrl(statusData);
                const { base64Clean, format } = await igMaybeCompressDataUrl(image.dataUrl, s);
                await igAttachGeneratedImage(base64Clean, finalPrompt, target, format || image.format || "png");
                return;
            }
            if (["FAILED", "CANCELLED", "CANCELED", "TIMED_OUT"].includes(status)) {
                throw new Error(`RunPod job failed: ${JSON.stringify(statusData.error || statusData)}`);
            }
        }

        throw new Error("RunPod job timed out.");
    }

    async function igGenerateWithComfy(positivePrompt, target = null, opts = null) {
        const s = getLocalProfile().imageGen;
        const background = !!opts?.background;
        ensureImageGenLoraArrays(s);
        const manualScene = normalizeManualImageScene(opts?.manualScene || activeManualImageScene);
        const manualAssignments = manualScene.assignments;
        if (ensureRunpodSettings(s).enabled && ensureRunpodDropdownValues(s)) saveProfileToMemory();
        igSyncImageGenLoraFromDom(s);
        let raw = stripUtilityThinkingWrapper(String(positivePrompt ?? ""));
        if (s.promptStyle === "krea2" && blockForbiddenKrea2Prompt(raw)) return;
        let finalPrompt;
        if (opts && opts.preserveStoredPrompt) {
            finalPrompt = raw.trim();
        } else {
            if (s.promptStyle === "illustrious") {
                raw = stripPreambleBeforeBooruTags(raw);
            }
            finalPrompt = sanitizePromptTags(raw);
            if (opts && opts.normalizeGeneratedPrompt && !isNaturalLanguageImageStyle(s.promptStyle)) {
                finalPrompt = normalizeAnimaGeneratedTags(finalPrompt);
            }
            finalPrompt = limitAnimaPromptTags(finalPrompt, s, s.loraIntel);
            if (!opts || !opts.skipLeadPrefix) {
                finalPrompt = ensureImageLeadPrefix(finalPrompt);
            }
        }
        if (s.promptStyle === "krea2" && blockForbiddenKrea2Prompt(finalPrompt)) return;
        let aiText = String(opts?.aiText ?? finalPrompt).trim() || finalPrompt;

        // --- CLIENT-SIDE PROMPT WRITER ---
        // Generate the render prompt in the browser BEFORE any GPU job exists:
        // the user sees/edits the real prompt, failures are loud and cheap,
        // and no billed GPU seconds are spent waiting on a chat API. The
        // in-workflow NanoGPT node stays as the fallback when this is
        // unavailable (no key / network / CORS).
        const nanoSystemPrompt = String(opts?.nanoSystemPrompt || "").trim() || buildNanoImageSystemPrompt(s);
        const wantsNanoPrompt = !!opts?.requireAiTextWorkflow
            || (background && !!String(opts?.aiText || "").trim() && String(opts?.aiText || "").trim() !== finalPrompt);
        const promptWriter = getPromptWriterSettings();
        let nanoPromptClientSide = false;
        if (wantsNanoPrompt) {
            if (!background) showKazumaProgress("Writing Image Prompt...");
            const generated = await callPromptWriter(nanoSystemPrompt, aiText);
            if (generated) {
                if (s.promptStyle === "krea2" && blockForbiddenKrea2Prompt(generated)) return;
                finalPrompt = sanitizePromptTags(generated);
                // Tag styles get the same Anima post-processing as the
                // legacy path: underscore/parenthesis normalization plus
                // the Max Tags dedupe/cap, then the user's Leading Tags
                // (quality/meta block) are prepended in code -- never
                // invented by the writer.
                if (!isNaturalLanguageImageStyle(s.promptStyle)) {
                    finalPrompt = normalizeAnimaGeneratedTags(finalPrompt);
                }
                finalPrompt = limitAnimaPromptTags(finalPrompt, s, s.loraIntel);
                if (!opts?.skipLeadPrefix) {
                    finalPrompt = ensureImageLeadPrefix(finalPrompt);
                }
                nanoPromptClientSide = true;
            } else if (promptWriter.apiKey && promptWriter.provider === "nanogpt") {
                toastr.warning("NanoGPT direct call failed. Falling back to the in-workflow NanoGPT node (prompt will not be previewable).", "Megumin Suite");
            } else if (promptWriter.apiKey) {
                toastr.warning(`${promptWriter.label} direct call failed. Rendering the deterministic prompt instead.`, "Megumin Suite");
            } else if (!background) {
                toastr.info(`Set your ${promptWriter.label} API key in Image Generation settings to write and preview the prompt before rendering.`, "Megumin Suite", { timeOut: 6000 });
            }
        }

        // --- INTERCEPT PROMPT IF PREVIEW IS ENABLED ---
        if (s.previewPrompt && !background) {
            $("#kazuma_progress_overlay").hide(); // Hide the progress bar temporarily

            const isWorkflowAiPrompt = !!opts?.requireAiTextWorkflow && !nanoPromptClientSide && promptWriter.provider === "nanogpt";
            const $content = isWorkflowAiPrompt
                ? $(`
                    <div style="display:flex; flex-direction:column; gap:10px; font-family:'Inter',sans-serif;">
                        <div style="font-size:.82rem; color:var(--text-main); font-weight:700;">NanoGPT will generate the final prompt inside ComfyUI after you send this workflow.</div>
                        <div style="font-size:.7rem; color:var(--text-muted);">The text below is the scene-native <code>%ai_text%</code> source. <code>%prompt%</code> holds a deterministic scene prompt used only if the NanoGPT call fails. Tip: set a NanoGPT API key in Image Generation settings to write the prompt in your browser instead — then you can see and edit the exact final prompt here before rendering.</div>
                        <textarea class="ps-modern-input ig-ai-source-preview" readonly style="height:180px; resize:vertical; font-family:monospace; font-size:.75rem; padding:10px;">${psEscapeText(aiText)}</textarea>
                        <details>
                            <summary style="cursor:pointer; font-size:.7rem; color:var(--text-muted);">Show configured-tag fallback</summary>
                            <textarea class="ps-modern-input ig-preview-textarea" style="height:100px; resize:vertical; font-family:monospace; font-size:.72rem; padding:10px; margin-top:7px;">${psEscapeText(finalPrompt)}</textarea>
                        </details>
                    </div>
                `)
                : $(`
                    <div style="display:flex; flex-direction:column; gap:10px; font-family: 'Inter', sans-serif;">
                        <div style="font-size: 0.85rem; color: var(--text-muted);">Review or modify the prompt before it goes to the image renderer.</div>
                        <textarea class="ps-modern-input ig-preview-textarea" style="height: 150px; resize: vertical; font-family: monospace; font-size: 0.85rem; padding: 10px;">${psEscapeText(finalPrompt)}</textarea>
                    </div>
                `);

            // CRITICAL FIX: SillyTavern destroys the popup HTML when it closes.
            // We MUST capture the text while the user is typing!
            let liveText = finalPrompt;
            $content.find(".ig-preview-textarea").on("input", function() {
                liveText = $(this).val();
            });

            const popup = new Popup(
                $content,
                POPUP_TYPE.CONFIRM,
                isWorkflowAiPrompt ? "Preview ComfyUI NanoGPT Request" : "Preview Image Prompt",
                { okButton: isWorkflowAiPrompt ? "Send to ComfyUI" : "Send to Renderer", cancelButton: "Cancel", wide: true }
            );
            const confirmed = await popup.show();

            if (!confirmed) {
                toastr.info("Generation cancelled.");
                return;
            }

            finalPrompt = liveText.trim();
            if (!finalPrompt) return toastr.warning("Prompt cannot be empty.");
            if (s.promptStyle === "krea2" && blockForbiddenKrea2Prompt(finalPrompt)) return;

            showKazumaProgress("Preparing to Render..."); // Bring progress bar back
        }

        let workflowRaw;
        try {
            const res = await fetch('/api/sd/comfy/workflow', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ file_name: s.currentWorkflowName }) });
            if (!res.ok) throw new Error("Load failed"); workflowRaw = await res.json();
        } catch (e) { return toastr.error(`Could not load ${s.currentWorkflowName}`); }

        let workflow = (typeof workflowRaw === 'string') ? JSON.parse(workflowRaw) : workflowRaw;
        // When the prompt was already written client-side, remove the
        // in-workflow NanoGPT node entirely: the worker must not re-run (and
        // possibly rewrite) the prompt the user just saw/approved, and
        // skipping it saves billed GPU seconds.
        const bypassInWorkflowNano = promptWriter.provider === "openrouter" && wantsNanoPrompt;
        if (opts?.preserveStoredPrompt || nanoPromptClientSide || bypassInWorkflowNano) igBypassNanoTextNodesForStoredPrompt(workflow);
        const workflowHasAiText = igWorkflowContainsPlaceholder(workflow, "%ai_text%");
        if (opts?.requireAiTextWorkflow && !nanoPromptClientSide && !bypassInWorkflowNano && !workflowHasAiText) {
            $("#kazuma_progress_overlay").hide();
            throw new Error(`The selected workflow "${s.currentWorkflowName}" has no %ai_text% input. Select anima_nanogpt.json (or a NanoGPT workflow) or switch quick-image source away from ComfyUI NanoGPT.`);
        }
        let finalSeed = parseInt(s.customSeed); if (finalSeed === -1 || isNaN(finalSeed)) finalSeed = Math.floor(Math.random() * 1000000000);

        const comfyLoraFiles = await ensureMeguminComfyLoraList(s);
        let loraPathCanonChanged = false;
        for (let i = 1; i <= 4; i++) {
            const key = i === 1 ? "selectedLora" : `selectedLora${i}`;
            const v = s[key];
            if (!v || v === "None" || v === "") continue;
            const r = resolveLoraPathForDropdown(v, comfyLoraFiles);
            if (r && r !== v) {
                s[key] = r;
                loraPathCanonChanged = true;
                const $dd = $(`#ig_lora_${i}`);
                if ($dd.length) $dd.val(r);
            }
        }
        if (loraPathCanonChanged) saveProfileToMemory();

        // --- LORA INTELLIGENCE INJECTION ---
        let slots = [s.selectedLora, s.selectedLora2, s.selectedLora3, s.selectedLora4];
        let weights = [parseFloat(s.selectedLoraWt) || 1.0, parseFloat(s.selectedLoraWt2) || 1.0, parseFloat(s.selectedLoraWt3) || 1.0, parseFloat(s.selectedLoraWt4) || 1.0];

        const li = s.loraIntel;
        const charKey = getCharacterKey() || "default";
        const hasManualLoraSelection = false;
        if (li && (hasManualLoraSelection || (li.enabled && li.ensureLoras)) && getModeCharacterAssignments(li, charKey).length > 0) {
            ensureImageGenLoraArrays(s);
            const locked = s.loraSlotLocked;
            const kwManaged = s.loraSlotKeywordManaged;

            const activeAssignments = getActiveCharacterAssignments(li, charKey, hasManualLoraSelection ? manualAssignments : null);

            const occupiedKeys = new Set();
            slots.forEach((sl, idx) => {
                if (!sl || sl === "None" || sl === "") return;
                if (locked[idx]) occupiedKeys.add(normalizeLoraKeyForDedupe(sl));
                else if (hasManualLoraSelection) return;
                else if (!kwManaged[idx]) occupiedKeys.add(normalizeLoraKeyForDedupe(sl));
            });

            const uniqueLoras = [];
            const seenLora = new Set();
            for (const a of activeAssignments) {
                const l = a.lora;
                if (!l || l === "None" || l === "") continue;
                const k = normalizeLoraKeyForDedupe(l);
                if (!k || seenLora.has(k)) continue;
                seenLora.add(k);
                if (occupiedKeys.has(k)) continue;
                uniqueLoras.push(l);
            }

            const slotEligible = (i) => {
                if (locked[i]) return false;
                if (hasManualLoraSelection) return true;
                const empty = !slots[i] || slots[i] === "None" || slots[i] === "";
                if (empty) return true;
                return kwManaged[i];
            };

            let uiChanged = false;
            let si = 0;
            for (let di = 0; di < uniqueLoras.length; di++) {
                while (si < 4 && !slotEligible(si)) si++;
                if (si >= 4) break;
                const rawPick = uniqueLoras[di];
                const resolved = resolveLoraPathForDropdown(rawPick, comfyLoraFiles) || rawPick;
                const curKey = slots[si] ? normalizeLoraKeyForDedupe(slots[si]) : "";
                const newKey = normalizeLoraKeyForDedupe(resolved);
                const empty = !slots[si] || slots[si] === "None" || slots[si] === "";
                if (curKey !== newKey || empty) {
                    slots[si] = resolved;
                    $(`#ig_lora_${si + 1}`).val(slots[si]);
                    uiChanged = true;
                }
                if (!kwManaged[si]) uiChanged = true;
                kwManaged[si] = true;
                si++;
            }

            const desiredKeysNormalized = new Set(
                uniqueLoras.map(l => normalizeLoraKeyForDedupe(resolveLoraPathForDropdown(l, comfyLoraFiles) || l)).filter(Boolean)
            );
            for (let i = 0; i < 4; i++) {
                if (locked[i]) continue;
                if (!hasManualLoraSelection && !kwManaged[i]) continue;
                const sk = slots[i] ? normalizeLoraKeyForDedupe(slots[i]) : "";
                if (!sk || !desiredKeysNormalized.has(sk)) {
                    if (slots[i]) {
                        slots[i] = "";
                        kwManaged[i] = false;
                        $(`#ig_lora_${i + 1}`).val("");
                        uiChanged = true;
                    }
                }
            }

            if (uiChanged) {
                s.selectedLora = slots[0];
                s.selectedLora2 = slots[1];
                s.selectedLora3 = slots[2];
                s.selectedLora4 = slots[3];
                s.selectedLoraWt = weights[0];
                s.selectedLoraWt2 = weights[1];
                s.selectedLoraWt3 = weights[2];
                s.selectedLoraWt4 = weights[3];
                saveProfileToMemory();
            }
        }

        let l1 = slots[0], l2 = slots[1], l3 = slots[2], l4 = slots[3];
        let w1 = weights[0], w2 = weights[1], w3 = weights[2], w4 = weights[3];
        let kreaIdentitySuffix = "";
        if (s.promptStyle === "krea2") {
            kreaIdentitySuffix = buildKreaLoraTriggerSuffix([l1, l2, l3, l4]);
            // The LoRA trigger words ("a woman" per selected identity) are
            // injected deterministically, never via LLM compliance, by
            // exactly one owner:
            //  - If the workflow still contains a MeguminNanoGPTText node,
            //    that node appends %krea_identity_suffix% in Python to
            //    whatever text it returns (LLM output or fallback_text).
            //  - Otherwise (client-side prompt, stored prompt, or plain
            //    workflows) they are appended to finalPrompt right here.
            // aiText (the LLM's input) never carries trigger bookkeeping, so
            // a weak model can't echo instruction-shaped text into the
            // render prompt.
            const workflowHasNanoNode = Object.values(workflow || {}).some(node => node?.class_type === "MeguminNanoGPTText");
            if (kreaIdentitySuffix && !workflowHasNanoNode) {
                finalPrompt = appendKreaRuntimeLoraTriggerInstruction(finalPrompt, [l1, l2, l3, l4]);
            }
        }
        finalPrompt = ensureSelectedVrtlIdentityPromptForLoras(finalPrompt, [l1, l2, l3, l4]);
        if (s.promptStyle === "krea2" && blockForbiddenKrea2Prompt(finalPrompt)) return;

        const nanoSettings = getNanoGptGlobalSettings();
        const comfyRepl = {
            "%prompt%": finalPrompt,
            "%ai_text%": aiText,
            "%krea_identity_suffix%": kreaIdentitySuffix,
            "%nanogpt_api_key%": nanoSettings.apiKey,
            "%nanogpt_model%": nanoSettings.model,
            "%nanogpt_temperature%": nanoSettings.temperature,
            "%nanogpt_system%": nanoSystemPrompt,
            "%negative_prompt%": s.customNegative || "",
            "%seed%": finalSeed,
            "%sampler%": s.selectedSampler || "euler",
            "%scheduler%": s.selectedScheduler || "simple",
            "%model%": s.selectedModel || "v1-5-pruned.ckpt",
            "%steps%": parseInt(s.steps, 10) || 20,
            "%scale%": parseFloat(s.cfg) || 7.0,
            "%denoise%": parseFloat(s.denoise) || 1.0,
            "%clip_skip%": -Math.abs(parseInt(s.clipSkip, 10)) || -1,
            "%lora1%": l1 || "None",
            "%lora2%": l2 || "None",
            "%lora3%": l3 || "None",
            "%lora4%": l4 || "None",
            "%lorawt1%": w1,
            "%lorawt2%": w2,
            "%lorawt3%": w3,
            "%lorawt4%": w4,
            "%width%": parseInt(s.imgWidth, 10) || 512,
            "%height%": parseInt(s.imgHeight, 10) || 512,
        };
        const seedPlaceholderState = { injected: false };

        for (const nodeId in workflow) {
            const node = workflow[nodeId];
            if (node.inputs) {
                for (const key in node.inputs) {
                    node.inputs[key] = igSubstituteComfyPlaceholderDeep(node.inputs[key], comfyRepl, seedPlaceholderState);
                }
                if (!seedPlaceholderState.injected && node.class_type === "KSampler" && 'seed' in node.inputs && typeof node.inputs['seed'] === 'number') { node.inputs.seed = finalSeed; }
            }
        }
        // Empty LoRA slots become "None" above; stock LoraLoader cannot load that.
        igBypassInactiveLoraLoaderNodes(workflow);

        igLastComfyApiRequest = igBuildLastComfyApiSnapshot(s, workflow, finalPrompt, aiText, finalSeed, l1, l2, l3, l4, w1, w2, w3, w4);
        igRefreshLastComfyApiPanel();

        if (isRunpodReady(s)) {
            try {
                await igGenerateWithRunpod(workflow, finalPrompt, target, s);
                if (!background) $("#kazuma_progress_overlay").hide();
            } catch (e) {
                if (!background) $("#kazuma_progress_overlay").hide();
                toastr.error("RunPod Error: " + e.message);
                throw e;
            }
            return;
        }
        if (ensureRunpodSettings(s).enabled) {
            if (!background) $("#kazuma_progress_overlay").hide();
            toastr.error("RunPod endpoint ID and API key are required.");
            throw new Error("RunPod endpoint ID and API key are required.");
        }

        try {
            const res = await fetch(`${s.comfyUrl}/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: workflow }) });
            if(!res.ok) throw new Error("Failed");
            const data = await res.json();

            if (!background) showKazumaProgress("Rendering Image...");
            const started = Date.now();
            const timeoutMs = 10 * 60 * 1000;
            while (Date.now() - started < timeoutMs) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                const historyRes = await fetch(`${s.comfyUrl}/history/${data.prompt_id}`);
                const h = await historyRes.json();
                if (!h[data.prompt_id]) continue;
                const generatedPrompt = igExtractComfyGeneratedPrompt(h[data.prompt_id], workflow);
                let finalImage = null;
                for (const nodeId in h[data.prompt_id].outputs) {
                    const nodeOut = h[data.prompt_id].outputs[nodeId];
                    if (nodeOut.images && nodeOut.images.length > 0) { finalImage = nodeOut.images[0]; break; }
                }
                if (!finalImage) throw new Error("ComfyUI completed without an image output.");
                if (!background) showKazumaProgress("Downloading...");
                const imgUrl = `${s.comfyUrl}/view?filename=${finalImage.filename}&subfolder=${finalImage.subfolder}&type=${finalImage.type}`;
                const response = await fetch(imgUrl);
                const base64Raw = await igReadBlobAsDataUrl(await response.blob());
                const { base64Clean, format } = await igMaybeCompressDataUrl(base64Raw, s);
                await igAttachGeneratedImage(base64Clean, generatedPrompt || finalPrompt, target, format);
                if (!background) $("#kazuma_progress_overlay").hide();
                return;
            }
            throw new Error("ComfyUI image job timed out.");
        } catch(e) {
            if (!background) $("#kazuma_progress_overlay").hide();
            toastr.error("Comfy Error: " + e.message);
            throw e;
        }
    }

    function cleanMessageTextForKeywords(text) {
        if (!text) return "";
        let t = String(text);
        t = t.replace(PS_BAD_STUFF_REGEX, "");
        t = t.replace(/<think>[\s\S]*?<\/redacted_thinking>/gis, "");
        t = t.replace(/<details>[\s\S]*?<\/details>/gs, "");
        t = t.replace(/<summary>[\s\S]*?<\/summary>/gs, "");
        t = t.replace(/<[^>]+>/g, "");
        return t.trim();
    }

    /** Remove reasoning wrappers from utility-model outputs. Tag pairs vary by provider. */
    function stripUtilityThinkingWrapper(text) {
        if (text == null) return "";
        let s = String(text);
        s = s.replace(/<think>[\s\S]*?<\/redacted_thinking>/gis, "");
        s = s.replace(/<thinking>[\s\S]*?<\/thinking>/gis, "");
        s = s.replace(/<think>[\s\S]*?<\/think>/gis, "");
        return s.trim();
    }

    function stripJsonCodeFences(text) {
        return String(text || "")
            .replace(/```(?:json|javascript|js)?/gi, "")
            .replace(/```/g, "")
            .trim();
    }

    function normalizeParsedCharacterAssignments(parsed) {
        if (Array.isArray(parsed)) return parsed;
        if (!parsed || typeof parsed !== "object") return [];
        const wrapped = parsed.assignments
            || parsed.characters
            || parsed.character_assignments
            || parsed.characterAssignments
            || parsed.results;
        if (Array.isArray(wrapped)) return wrapped;
        if (parsed.character || parsed.name) return [parsed];
        return [];
    }

    function getBalancedJsonSegment(text, openChar, closeChar) {
        const source = String(text || "");
        const start = source.indexOf(openChar);
        if (start < 0) return "";

        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let i = start; i < source.length; i++) {
            const ch = source[i];
            if (inString) {
                if (escaped) {
                    escaped = false;
                } else if (ch === "\\") {
                    escaped = true;
                } else if (ch === '"') {
                    inString = false;
                }
                continue;
            }

            if (ch === '"') {
                inString = true;
            } else if (ch === openChar) {
                depth += 1;
            } else if (ch === closeChar) {
                depth -= 1;
                if (depth === 0) return source.slice(start, i + 1);
            }
        }
        return "";
    }

    function parseCharacterAssignmentsResponse(rawOutput) {
        const text = stripJsonCodeFences(stripUtilityThinkingWrapper(rawOutput));
        const candidates = [
            text,
            getBalancedJsonSegment(text, "[", "]"),
            getBalancedJsonSegment(text, "{", "}")
        ].filter(Boolean);

        for (const candidate of candidates) {
            try {
                const assignments = normalizeParsedCharacterAssignments(JSON.parse(candidate));
                if (assignments.length > 0) return assignments;
            } catch (e) {
                // Try the next common response shape.
            }
        }

        const trimmed = text.trim();
        if (trimmed.startsWith("{") || trimmed.startsWith('"')) {
            try {
                const assignments = normalizeParsedCharacterAssignments(JSON.parse(`[${trimmed.replace(/,\s*$/, "")}]`));
                if (assignments.length > 0) return assignments;
            } catch (e) {
                // Fall through to the caller's parse warning.
            }
        }

        return [];
    }

    /** Illustrious / Danbooru: drop plain-English planning before the first booru-style subject leader. */
    function stripPreambleBeforeBooruTags(text) {
        const t = String(text || "").trim();
        if (!t) return t;
        const anchor = /\b(1girl|2girls|3girls|1boy|2boys|3boys|multiple_girls|multiple_boys|solo|no_humans)\b\s*,/i;
        const m = t.match(anchor);
        if (m && m.index > 0) return t.slice(m.index).trim();
        return t;
    }

    function getRecentChatForLoraKeywords() {
        const context = getContext();
        if (!context.chat || context.chat.length === 0) return "";
        const chat = context.chat;
        const lastUser = [...chat].reverse().find(m => m.is_user && !m.is_system);
        const lastAi = [...chat].reverse().find(m => !m.is_user && !m.is_system);
        const parts = [];
        if (lastUser?.mes) parts.push(cleanMessageTextForKeywords(lastUser.mes));
        if (lastAi?.mes) parts.push(cleanMessageTextForKeywords(lastAi.mes));
        return parts.join("\n").toLowerCase();
    }

    function normalizeLoraKeyForDedupe(name) {
        if (!name || typeof name !== "string") return "";
        return name.replace(/\\/g, "/").trim().toLowerCase();
    }

    function ensureSelectedVrtlIdentityPrompt(prompt, s) {
        return ensureSelectedVrtlIdentityPromptForLoras(prompt, [s?.selectedLora, s?.selectedLora2, s?.selectedLora3, s?.selectedLora4]);
    }

    function ensureSelectedVrtlIdentityPromptForLoras(prompt, loraNames) {
        const required = [...new Map(
            (Array.isArray(loraNames) ? loraNames : [])
                .flatMap(name => getVrtlLoraIdentityKeywords(name) || [])
                .map(keyword => [keyword.toLowerCase(), keyword])
        ).values()];
        if (required.length === 0) return prompt;

        const current = String(prompt || "");
        const missing = required.filter(keyword => !current.toLowerCase().includes(keyword.toLowerCase()));
        return missing.length > 0 ? `${missing.join(', ')}, ${current}`.replace(/,\s*$/, "") : current;
    }

    function igSyncImageGenLoraFromDom(s) {
        if (!s) return;
        for (let i = 1; i <= 4; i++) {
            const $sel = $(`#ig_lora_${i}`);
            if (!$sel.length) continue;
            const key = i === 1 ? "selectedLora" : `selectedLora${i}`;
            const wtKey = i === 1 ? "selectedLoraWt" : `selectedLoraWt${i}`;
            const options = $sel.find("option");
            const currentValue = s[key];
            const firstOptionText = String(options.first().text() || "").trim().toLowerCase();
            const dropdownIsUnloaded = options.length === 0 || (options.length === 1 && firstOptionText.includes("loading"));
            const val = $sel.val();
            if (dropdownIsUnloaded && currentValue) continue;
            if ((val === undefined || val === null) && currentValue) continue;
            if (val === "" && currentValue && options.length <= 1) continue;
            if (val !== undefined && val !== null) s[key] = val;
            const $wt = $(`#ig_lorawt_${i}`);
            if ($wt.length) {
                const w = parseFloat($wt.val());
                if (!isNaN(w)) s[wtKey] = w;
            }
        }
    }

    function getCleanedChatHistory() {
        const context = getContext();
        if (!context.chat || context.chat.length === 0) return "";

        const aiMessages = context.chat.filter(m => !m.is_user && !m.is_system).slice(-50);

        let cleanedMessages = aiMessages.map(m => cleanMessageTextForKeywords(m.mes));

        cleanedMessages = cleanedMessages.filter(t => t.length > 0);
        return cleanedMessages.join("\n\n");
    }



    function extendBaseDict(dict) {
        if (getLocalProfile().imageGen && getLocalProfile().imageGen.enabled) {
            const ig = getLocalProfile().imageGen;
            let shouldInject = false;
            let conditionalText = "";
            const mode = ig.triggerMode || "always";

            if (mode === "always") shouldInject = true;
            else if (mode === "frequency") {
                const chat = getContext().chat || [];
                const aiMsgCount = chat.filter(m => !m.is_user && !m.is_system).length;
                const freq = parseInt(ig.autoGenFreq) || 1;
                if ((aiMsgCount + 1) % freq === 0) shouldInject = true;
            } else if (mode === "conditional") {
                shouldInject = true;
                conditionalText = "CRITICAL INSTRUCTION: ONLY output the <img prompt=\"...\"> tag if the character is explicitly taking a photo, sending a picture, or sharing an image in this exact moment. If not, do NOT output the image tags at all.\n\n";
            }

            if (shouldInject) {
                const igLi = ig.loraIntel;
                const booruStd = isBooruStandardImageMode(ig, igLi);
                const charKeyImg = getCharacterKey() || "default";
                const allowStoredAppearanceGuidance = true;
                const promptUsesCharacterGuidance = allowStoredAppearanceGuidance && shouldUseCharacterGuidance(ig, igLi) && getMatchedCharacterGuidance(igLi, charKeyImg).length > 0;
                const characterChoiceInstruction = getPromptAiCharacterChoiceInstruction(igLi);

                const booruStableLead = buildBooruStandardTagLead(ig, igLi);
                const personaGuidance = buildPersonaImageGuidance(ig, booruStd);

                let styleStr = ig.promptStyle === "illustrious"
                    ? "Use Danbooru-style tags. Focus on anime."
                    : (ig.promptStyle === "krea2"
                        ? `Inside the <img prompt=\"\"> value: ${KREA2_PROMPT_INSTRUCTION}`
                        : (ig.promptStyle === "sdxl"
                            ? `Inside the <img prompt=\"\"> value: SDXL natural prose ONLY—fluent English in full sentences. FORBIDDEN: comma-separated tag dumps, Danbooru underscores, 1girl-style shorthand, lists of keywords. Translate any listed cues into description. ${IMAGE_BODY_SHAPE_POSITIVE_INSTRUCTION}`
                            : "Use keywords."));
                if (booruStd) {
                    styleStr = `Inside the image prompt, write ONLY flowing natural-language (full sentences, not booru tag lists). Turn shorthand into prose—for example "1girl, blue eyes, huge breasts" → "a woman with blue eyes and huge breasts." Describe actions and poses clearly. Do NOT repeat the opening tag block listed below; only the mandatory leading-tag prefix is supplied separately—your part is prose only. If Extra lists scene cues or character-appearance Danbooru tags below, weave them into that prose (translate to natural description; do not duplicate as a raw tag list). ${IMAGE_BODY_SHAPE_POSITIVE_INSTRUCTION}`;
                } else if (isNaturalLanguageImageStyle(ig.promptStyle) && booruStableLead) {
                    styleStr += " Do NOT repeat the comma-separated mandatory leading-tag prefix listed below; your attribute value is prose only, after that prefix is applied by the pipeline.";
                }
                if (igLi && igLi.enabled && igLi.useDanbooruTags && !isNaturalLanguageImageStyle(ig.promptStyle) && !booruStd) {
                    styleStr += " For Anima, use lowercase tags with spaces instead of underscores, escape literal parentheses in known character/series tags (example: saber \\(fate\\)), and do not combine story character names with look-alike tags.";
                }
                const maxAnimaTags = getAnimaMaxTags(ig);
                if (maxAnimaTags && !isNaturalLanguageImageStyle(ig.promptStyle) && !booruStd) {
                    styleStr += ` Keep the complete prompt concise: output no more than ${maxAnimaTags} comma-separated tags total, prioritizing characters, action, pose, expression, camera, and setting.`;
                }
                styleStr += ` ${IMAGE_SCENE_FIDELITY_INSTRUCTION}`;
                if (ig.structuredPromptRules) {
                    styleStr += ` ${buildImagePromptStructureRules(ig, booruStd)}`;
                }
                let perspStr = ig.promptPerspective === "pov" ? "First-Person (POV)." : (ig.promptPerspective === "character" ? "Focus on character appearance." : "Describe environment.");

                let liInstructions = "";
                if (igLi && igLi.enabled) {
                    const li = igLi;
                    {
                        const useStableCharacterGuidance = promptUsesCharacterGuidance;
                        const activeAssignments = getPromptAiCharacterAssignments(li, charKeyImg);

                        if (activeAssignments.length > 0) {
                            let descStrings = [];
                            let booruStrings = [];

                            activeAssignments.forEach(a => {
                                const tagBlock = allowStoredAppearanceGuidance ? (useStableCharacterGuidance ? getStableAssignmentTagBlock(a, li) : getAssignmentTagBlock(a, li)) : "";
                                if (allowStoredAppearanceGuidance && li.useDanbooruTags && tagBlock) {
                                    booruStrings.push(`${a.character}: ${tagBlock}`);
                                }
                                if (allowStoredAppearanceGuidance && li.useCharDescriptions && a.description) {
                                    descStrings.push(`${a.character}: ${a.description}`);
                                }
                            });

                            if ((useStableCharacterGuidance || shouldPromptAiChooseCharacters(li)) && booruStrings.length > 0) {
                                liInstructions += `\n${characterChoiceInstruction} Derive actions, poses, expressions, temporary state, setting, and composition from the chat scene.`;
                            }
                            if (booruStrings.length > 0) {
                                if (booruStd) {
                                    liInstructions += `\nCharacter appearance (per role); merge into your flowing prose naturally—do not paste as a comma tag block after the mandatory prefix: ${booruStrings.join(' | ')}`;
                                } else if (isNaturalLanguageImageStyle(ig.promptStyle)) {
                                    liInstructions += `\nCharacter cues (per role)—weave into English prose in the prompt value only; no underscore tokens or comma tag lists: ${booruStrings.join(' | ')}`;
                                } else {
                                    liInstructions += `\nCharacter appearance tags by role. Use these as Anima-style comma tags with spaces instead of underscores. Keep known character/series tags exact and escaped when they have parentheses. Do not combine story names with look-alike tags: ${booruStrings.join(' | ')}`;
                                }
                            }
                            if (descStrings.length > 0) {
                                liInstructions += `\nCharacter appearances: ${descStrings.join(' | ')}`;
                            }
                        }
                    }
                }
                if (personaGuidance) {
                    if (booruStd || isNaturalLanguageImageStyle(ig.promptStyle)) {
                        liInstructions += `\nPlayer character visibility: ${personaGuidance} Integrate this into the generated image description.`;
                    } else {
                        liInstructions += `\nPlayer character visibility: ${personaGuidance} Add concise Anima-style tags for this visible participant.`;
                    }
                }

                const peTrim = (ig.promptExtra && ig.promptExtra.trim()) ? ig.promptExtra.trim() : "";
                const extraLine = peTrim
                    ? (booruStd
                        ? `\nExtra (scene tags and cues—integrate into your flowing prose; translate shorthand to natural language; do not duplicate the mandatory leading-tag prefix):\n${peTrim}`
                        : (isNaturalLanguageImageStyle(ig.promptStyle)
                            ? `\nExtra (scene cues—translate into flowing English inside the prompt; no comma-tag or underscore fragments):\n${peTrim}`
                            : `\nExtra (tags / instructions to keep as comma-separated tags): ${peTrim}`))
                    : "";
                const tagLeadLine = booruStableLead
                    ? (isNaturalLanguageImageStyle(ig.promptStyle)
                        ? `\nReference leading tags (the app prepends these; do NOT paste them into the attribute—write prose only inside prompt=\"\"): ${booruStableLead}`
                        : `\nMandatory tag prefix (copy exactly at the start of the prompt value, then comma, then your prose): ${booruStableLead}`)
                    : "";

                const adultPrecisionLine = ig.adultTagPrecision ? `\n${getAdultPrecisionInstruction(ig)}` : "";
                const examplesLine = ig.includePromptExamples ? `\nTemplate example: ${buildImagePromptExamples(ig, booruStd)}` : "";

                dict["[[img1]]"] = `[IMAGE GENERATION]\n${conditionalText}Style: ${styleStr}\nPerspective: ${perspStr}${extraLine}${tagLeadLine}${liInstructions}${adultPrecisionLine}${examplesLine}`;
                dict["[[img2]]"] = `<img prompt="prompt">`;
            } else {
                dict["[[img1]]"] = ""; dict["[[img2]]"] = "";
            }
        } else {
            dict["[[img1]]"] = ""; dict["[[img2]]"] = "";
        }


    }

    function handlePromptInjection(messages, disablePrefill) {
        // --- INJECT IMAGE GEN PROMPT ---
        if (activeImageGenRequest) {
            const kreaOutputContract = activeImageGenRequest.isKrea2
                ? " KREA 2 OUTPUT CONTRACT: Return exactly one finished natural-language image prompt and nothing else. Start directly with the image description. Do not analyze the chat, enumerate details, explain decisions, plan, draft, refine, repeat, or add text before or after the prompt."
                : "";
            messages.length = 0;
            messages.push({
                "role": "system",
                "content": `You are an expert AI image prompt engineer. Read the scene and output exactly ONE image prompt. Obey Style Constraint and Camera Perspective. ${IMAGE_SCENE_FIDELITY_INSTRUCTION} STRICTLY FORBIDDEN: apologies, preambles, plans, meta commentary (e.g. "I need to", "I'll craft"), reasoning, bullet lists, <thinking> or <think> blocks, XML, markdown, or chat references. Your entire reply must be nothing except the raw prompt text.${kreaOutputContract}`
            });
            messages.push({
                "role": "user",
                "content": `Write an image generation prompt for the latest scene in this chat history.\n\n<chat>\n${activeImageGenRequest.chatText}\n</chat>\n\nScene Fidelity Requirement: ${IMAGE_SCENE_FIDELITY_INSTRUCTION}\nStyle Constraint: ${activeImageGenRequest.styleStr}\nCamera Perspective: ${activeImageGenRequest.perspStr}\nExtra Details: ${activeImageGenRequest.extraStr}\n\nOutput ONLY the raw prompt text. No other words before or after.${kreaOutputContract}`
            });
        if (!disablePrefill && !activeImageGenRequest.isKrea2) {
            messages.push({
                "role": "assistant",
                "content": "Understood.\n"
            });
        }

            console.log(`[${extensionName}] 🎯 Injected Image Gen array in memory.`);
            return true;
        }

        // --- INJECT LORA ASSIGNMENT PROMPT ---
        if (activeLoraAssignRequest) {
            messages.length = 0;

            let modeInstructions = "";
            let jsonFormat = `  {"character": "Name"`;
            const needsMatchKeywords = activeLoraAssignRequest.useTags || activeLoraAssignRequest.useDescriptions;

            if (needsMatchKeywords) {
                jsonFormat += `, "match_keywords": "Name, Nickname, Title"`;
                modeInstructions += "Use 'match_keywords' to list name variations, aliases, titles, and common references for keyword detection. ";
            }
            if (activeLoraAssignRequest.useTags) {
                jsonFormat += `, "character_tag": "${activeLoraAssignRequest.ensureCharacterTag ? "verified_danbooru_character_tag_or_empty" : "danbooru_character_tag_or_empty"}", "series_tag": "danbooru_series_tag_or_empty", "physical_tags": "comma-separated Danbooru body/face/hair/eye tags", "clothing_tags": "comma-separated Danbooru outfit/accessory tags"`;
                let booruInstr = "You MUST provide Danbooru-style tag fields for each character. TAG FIELDS MUST CONTAIN ONLY comma-separated Danbooru tags: lowercase, underscores for multi-word tags, no full sentences, no prose descriptions, no 'with/and/wearing' phrases, no markdown, and no explanations. Put stable look-alike identity tags in character_tag, series/franchise tags in series_tag, body/face/hair/eyes/build in physical_tags, and stable outfit/accessory details in clothing_tags. Example physical_tags: long_hair, black_hair, red_eyes, pale_skin, slim, medium_breasts. Example clothing_tags: witch_hat, cape, black_dress, boots. ";
                if (activeLoraAssignRequest.ensureCharacterTag) {
                    booruInstr += "ADDITIONALLY: For EACH character, try to provide a single real Danbooru character tag in character_tag only when there is a clearly plausible visual match, such as megumin_(konosuba), asuka_langley_soryu, or saber_(fate). Pick based on hair color, eye color, clothing silhouette, and body type. If no believable Danbooru character look-alike exists, leave character_tag empty; do not invent a tag from the roleplay name and do not choose an unrelated famous character. ";
                } else {
                    booruInstr += "If no good Danbooru character look-alike exists and Ensure Character Tag is off, character_tag may be empty, but every other tag field must still be tag-only. ";
                }
                modeInstructions += booruInstr;
            }
            if (activeLoraAssignRequest.useDescriptions) {
                jsonFormat += `, "description": "physical description here..."`;
                const style = activeLoraAssignRequest.descStyle === 'natural'
                    ? "natural language for Krea-style prompts (one compact reusable sentence with adult age bracket if known, face, hair, eyes, body type, skin, species traits, stable clothing/accessories, and visual identity cues)"
                    : "danbooru tags (e.g. 'tall, blonde hair')";
                modeInstructions += `You MUST provide a stable physical appearance description for each character in ${style}. For adult female characters, unless the character card, chat, or user feedback explicitly defines a fuller build, describe the body with positive slim-curvy wording such as slender-curvy, slim hourglass figure, narrow waist, graceful neck and shoulders, slender arms, toned or softly fit stomach, proportionate soft hips and thighs, and elegant facial features. Treat mature as adult age or confidence only, not body size; prefer adult woman or woman in her late 20s/30s over mature female. Do not include the current sex act, pose, facial expression, temporary nudity, fluids, location, camera, or scene action in this reusable character description. `;
            }
            jsonFormat += `}`;

            const feedback = String(activeLoraAssignRequest.feedback || "").trim();
            const previousAssignments = String(activeLoraAssignRequest.previousAssignments || "").trim();
            const feedbackSection = feedback
                ? `\n\n<regeneration_feedback>\n${feedback}\n</regeneration_feedback>\n\n<previous_character_metadata_json>\n${previousAssignments || "[]"}\n</previous_character_metadata_json>\n\nFeedback rules:\n- Treat the feedback as corrections to the previous character metadata.\n- If the feedback names one character, revise that character while preserving unrelated characters unless the chat clearly contradicts them.\n- If the feedback says all/everyone/redo, regenerate the whole array using the feedback as the priority correction.\n- Still return the full corrected JSON array for all important characters, not only the changed character.`
                : "";

            const cardContextParts = [];
            if (activeLoraAssignRequest.cardDescription) {
                cardContextParts.push(`<character_card_description>\n${activeLoraAssignRequest.cardDescription}\n</character_card_description>`);
            }
            if (activeLoraAssignRequest.firstMessage) {
                cardContextParts.push(`<first_message>\n${activeLoraAssignRequest.firstMessage}\n</first_message>`);
            }
            const cardContextSection = cardContextParts.length > 0 ? `\n\n<character_card_context>\n${cardContextParts.join('\n\n')}\n</character_card_context>` : "";

            messages.push({
                "role": "system",
                "content": `You are an expert at analyzing roleplay conversations and extracting character visual metadata for image generation. ${modeInstructions}`
            });
            messages.push({
                "role": "user",
                "content": `Analyze this conversation and extract visual metadata for the important characters.\n\n<chat>\n${activeLoraAssignRequest.chatText}\n</chat>${cardContextSection}${feedbackSection}\n\nReturn a JSON array with this exact format:\n[\n${jsonFormat}\n]\n\nRules:\n- Use the character card context to improve names, aliases, first-message identity cues, match_keywords, and stable visual traits.\n- Prefer the actual chat for who is present when the chat has enough scene content.\n- If the chat is empty or sparse, the character card description and first message are sufficient context for the initial character metadata.\n- Do not include temporary actions, pose, expression, state, setting, or composition in character metadata.\n- Do not invent extra currently-present characters only because they are mentioned in the card context.\n- Output ONLY the JSON array, no explanation`
            });
        if (!disablePrefill) {
            messages.push({
                "role": "assistant",
                "content": "[\n"
            });
        }
            console.log(`[${extensionName}] Injected character-analysis prompt array in memory.`);
            return true;
        }


        return false;
    }

    async function handleMessageReceived() {
        const s = getLocalProfile()?.imageGen;
        if (!s || !s.enabled) return;

        const chat = getContext().chat;
        if (!chat || !chat.length) return;

        const lastMsg = chat[chat.length - 1];
        if (lastMsg.is_user || lastMsg.is_system) return;

        const imgRegex = /<img\s+prompt=["'](.*?)["']\s*\/?>/i;
        const match = lastMsg.mes.match(imgRegex);
        if (!match) return;

        const extractedPrompt = match[1];
        lastMsg.mes = lastMsg.mes.replace(imgRegex, "").trim();
        await saveChat();
        reloadCurrentChat();

        setTimeout(() => {
            toastr.info(isRunpodReady(s) ? "Image tag detected. Sending to RunPod..." : "Image tag detected. Sending to ComfyUI...");
            igGenerateWithComfy(extractedPrompt, null, { normalizeGeneratedPrompt: true });
        }, 500);
    }

    function refreshBackgroundQueueStatus() {
        const automation = ensureBackgroundAutomationSettings(getLocalProfile()?.imageGen || {});
        const state = automation.queuePaused ? "Paused" : (backgroundImageWorkerActive ? "Working" : "Idle");
        const label = `${state} · ${backgroundImageQueue.length} queued`;
        $("#ig_bg_queue_status").text(label);
    }

    function getBackgroundOrigin(message) {
        const chat = getContext().chat || [];
        const index = chat.indexOf(message);
        const revisionKey = getMessageRevisionKey(message, index);
        return {
            index,
            sendDate: message?.send_date || null,
            name: message?.name || "",
            revisionKey,
            originKey: `${getCharacterKey() || "default"}:${revisionKey}`
        };
    }

    function hashBackgroundText(text) {
        let hash = 2166136261;
        const value = String(text || "");
        for (let i = 0; i < value.length; i++) {
            hash ^= value.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    }

    function getMessageRevisionKey(message, index) {
        const swipe = Number.isInteger(message?.swipe_id) ? message.swipe_id : 0;
        const textHash = hashBackgroundText(cleanMessageTextForKeywords(message?.mes || ""));
        return `${message?.send_date || index}:${index}:${swipe}:${textHash}`;
    }

    function setQwenStatus(text) {
        const s = getLocalProfile()?.imageGen;
        if (!s) return;
        const automation = ensureBackgroundAutomationSettings(s);
        automation.qwenStatus = String(text || "Idle");
        automation.qwenStatusAt = Date.now();
        $("#ig_bg_qwen_status").text(automation.qwenStatus);
        $("#ig_bg_qwen_status_compact").text(`Qwen: ${automation.qwenStatus}`).attr("title", automation.qwenStatus);
        saveProfileToMemory();
    }

    function resolveBackgroundOrigin(origin) {
        const chat = getContext().chat || [];
        let index = origin?.sendDate ? chat.findIndex(m => m?.send_date === origin.sendDate && m?.name === origin.name) : -1;
        if (index < 0 && Number.isInteger(origin?.index) && chat[origin.index]) index = origin.index;
        if (index < 0) return null;
        return { message: chat[index], element: $(`.mes[mesid="${index}"]`) };
    }

    function getSceneSnapshotForMessage(message) {
        const chat = getContext().chat || [];
        if (!chat.length) return "";
        const foundIndex = chat.indexOf(message);
        const index = foundIndex >= 0 ? foundIndex : chat.length - 1;
        return chat.slice(Math.max(0, index - 4), index + 1)
            .filter(m => !m.is_system)
            .map(m => `${m.name}: ${cleanMessageTextForKeywords(m.mes).trim()}`)
            .filter(Boolean)
            .join("\n\n");
    }

    function getLatestVisualSceneText(message = null) {
        const chat = getContext().chat || [];
        const target = message || [...chat].reverse().find(m => !m.is_user && !m.is_system);
        return cleanMessageTextForKeywords(target?.mes || "");
    }

    function isExplicitSceneText(text) {
        return /\b(?:sex|fucking|fuck(?:s|ed|ing)?|penetrat(?:e|es|ed|ing|ion)|missionary|cowgirl|doggy|doggystyle|oral|blowjob|deepthroat|cunnilingus|handjob|fingering|anal|cum|ejaculat(?:e|es|ed|ing|ion)|orgasm|naked|nude|erection|cock|penis|pussy|vagina|breasts?|nipples?|thrust(?:s|ed|ing)?|grind(?:s|ing)?|masturbat(?:e|es|ed|ing|ion))\b/i.test(String(text || ""));
    }

    function shouldAutoGenerateScene(text, automation) {
        if (findKrea2ForbiddenMinorTerm(text)) return false;
        const explicit = isExplicitSceneText(text);
        const mode = automation.autoTriggerMode || "explicit";
        const triggerMatch = mode === "both" || (mode === "explicit" && explicit) || (mode === "normal" && !explicit);
        const chance = Math.max(0, Math.min(100, parseInt(automation.autoRandomChance, 10) || 0));
        const randomMatch = chance > 0 && Math.random() * 100 < chance;
        return mode === "random" ? randomMatch : (triggerMatch || randomMatch);
    }

    function detectPositionPresetFromScene(text) {
        const normalized = String(text || "").toLowerCase().replace(/[_-]+/g, " ");
        const aliases = [
            ["reverse cowgirl", "Reverse Cowgirl"],
            ["mating press", "Mating Press"],
            ["legs over shoulders", "Legs Over Shoulders"],
            ["against the wall", "Against Wall"],
            ["doggy style", "Doggy Style"],
            ["doggystyle", "Doggy Style"],
            ["deepthroat", "Deepthroat"],
            ["face sitting", "Face Sitting"],
            ["facesitting", "Face Sitting"],
            ["cunnilingus", "Cunnilingus"],
            ["blowjob", "Blowjob"],
            ["handjob", "Handjob"],
            ["footjob", "Footjob"],
            ["fingering", "Fingering"],
            ["missionary", "Missionary"],
            ["cowgirl", "Cowgirl"],
            ["spooning", "Spooning"],
            ["lotus", "Lotus"],
            ["standing oral", "Standing Oral"],
            ["69", "Oral 69"],
            ["anal", "Anal"],
            ["threesome", "Threesome"],
            ["double penetration", "Double Penetration"],
            ["paizuri", "Paizuri POV"],
            ["titfuck", "Titfuck"],
            ["grinding", "Grinding"],
            ["lap dance", "Lap Dance"]
        ];
        for (const [needle, label] of aliases) {
            if (normalized.includes(needle)) return NSFW_POSITION_PRESETS.find(p => p.label === label) || null;
        }
        if (/\b(?:mouth|lips?|tongue|throat)\b[\s\S]{0,100}\b(?:cock|penis|shaft|head|tip)\b|\b(?:cock|penis|shaft)\b[\s\S]{0,100}\b(?:mouth|lips?|tongue|throat|suck(?:s|ed|ing)?)\b/.test(normalized)) {
            return NSFW_POSITION_PRESETS.find(p => p.label === "Blowjob") || null;
        }
        if (/\b(?:penetrat(?:e|es|ed|ing|ion)|thrust(?:s|ed|ing)?|fucking|sex)\b/.test(normalized)) {
            return NSFW_POSITION_PRESETS.find(p => p.label === "Missionary") || null;
        }
        return null;
    }

    function extractDeterministicSceneTags(sceneText) {
        const text = String(sceneText || "").toLowerCase();
        const tags = [];
        const add = (condition, ...values) => { if (condition) tags.push(...values); };
        add(/\bbed(?:room)?\b/.test(text), "bedroom", "on bed");
        add(/\b(?:bath|shower|bathroom)\b/.test(text), "bathroom");
        add(/\b(?:pool|hot tub|jacuzzi)\b/.test(text), "poolside");
        add(/\b(?:kitchen)\b/.test(text), "kitchen");
        add(/\b(?:office|desk)\b/.test(text), "office");
        add(/\b(?:fitting room|changing room|dressing room)\b/.test(text), "fitting room", "fluorescent lighting");
        add(/\b(?:car|vehicle)\b/.test(text), "car interior");
        add(/\b(?:forest|woods)\b/.test(text), "forest");
        add(/\b(?:beach|shore)\b/.test(text), "beach");
        add(/\b(?:night|darkness|moonlight)\b/.test(text), "night", "dim lighting");
        add(/\b(?:sunlight|daylight|morning)\b/.test(text), "natural light");
        add(/\b(?:naked|nude|undressed)\b/.test(text), "nude");
        add(/\btopless\b/.test(text), "topless", "exposed breasts");
        add(/\b(?:underwear|lingerie|panties|bra)\b/.test(text), "lingerie");
        add(/\b(?:sweat|sweaty)\b/.test(text), "sweat");
        add(/\b(?:blush|blushing|flushed)\b/.test(text), "blush", "flushed face");
        add(/\b(?:moan|moaning)\b/.test(text), "moaning", "open mouth");
        add(/\b(?:cum|ejaculat(?:e|es|ed|ing|ion))\b/.test(text), "cum", "ejaculation");
        add(/\b(?:pov|first person)\b/.test(text), "pov");
        return [...new Set(tags)];
    }

    function applyDeterministicSceneOverride(analysis, sceneText, knownNames) {
        const position = detectPositionPresetFromScene(sceneText);
        if (!position && !isExplicitSceneText(sceneText)) return analysis;
        const normalized = String(sceneText || "").toLowerCase();
        const matchedNames = knownNames.filter(name => normalized.includes(String(name || "").toLowerCase()));
        const sceneTags = extractDeterministicSceneTags(sceneText);
        return {
            ...analysis,
            trigger: true,
            sceneType: "explicit",
            position: position?.label || analysis.position || "explicit sex",
            location: analysis.location || sceneTags.find(tag => /room|office|bedroom|bathroom|pool|beach|forest|kitchen|car/.test(tag)) || "",
            characters: analysis.characters?.length ? analysis.characters : matchedNames,
            query: analysis.query || [position?.label, ...matchedNames, ...sceneTags].filter(Boolean).join(", "),
            confidence: Math.max(Number(analysis.confidence) || 0, 1)
        };
    }

    function getDeterministicSceneAssignments(s, sceneText, preferredAssignments = null) {
        const li = s.loraIntel;
        const charKey = getCharacterKey() || "default";
        if (Array.isArray(preferredAssignments) && preferredAssignments.length) {
            return preferredAssignments.map(ensureStructuredCharacterAssignment).filter(a => !a.neverInclude);
        }
        const all = getModeCharacterAssignments(li, charKey).map(ensureStructuredCharacterAssignment).filter(a => !a.neverInclude);
        const normalized = String(sceneText || "").toLowerCase();
        const matched = all.filter(a => a.alwaysInclude || assignmentMatchesRecentChat(a, normalized, all.length <= 1));
        return matched.length ? matched : (all.length === 1 ? all : []);
    }

    function buildDeterministicBackgroundPrompt(s, sceneText, options = {}) {
        const assignments = getDeterministicSceneAssignments(s, sceneText, options.assignments);
        const position = options.position || detectPositionPresetFromScene(sceneText);
        const explicit = options.sceneType === "explicit" || isExplicitSceneText(sceneText) || !!position;
        const sceneTags = extractDeterministicSceneTags(sceneText);
        const characterTags = assignments.flatMap(a => getAssignmentTagParts(a, s.loraIntel)).filter(Boolean);
        const femaleCount = assignments.filter(a => inferAssignmentSex(a) === "female").length;
        const maleCount = assignments.filter(a => inferAssignmentSex(a) === "male").length;
        const userSex = String(getLocalProfile()?.userPronouns || "").toLowerCase();
        let girls = femaleCount;
        let boys = maleCount;
        if (explicit && girls + boys < 2) {
            if (userSex === "female") girls++;
            else boys++;
        }
        if (explicit && girls === 0) girls = 1;
        if (explicit && boys === 0) boys = 1;
        const countTags = [
            girls > 0 ? `${girls}girl${girls > 1 ? "s" : ""}` : "",
            boys > 0 ? `${boys}boy${boys > 1 ? "s" : ""}` : ""
        ].filter(Boolean);
        const positionStaging = position ? getBatchPositionStaging(position.label, position.prompt) : "";
        const anatomySetting = ensureBackgroundAutomationSettings(s).batchMaleAnatomy || "standard";
        const anatomy = explicit && batchPositionUsesPenis(position?.label || "")
            ? (anatomySetting === "huge" ? "huge penis" : (anatomySetting === "large" ? "large penis" : "erect penis"))
            : "";
        const baseTags = [
            buildBooruStandardTagLead(s, s.loraIntel),
            s.promptExtra,
            ...countTags,
            explicit ? "hetero, sex, nude, uncensored" : "",
            anatomy,
            ...characterTags,
            positionStaging,
            ...sceneTags
        ].filter(Boolean);

        if (!isNaturalLanguageImageStyle(s.promptStyle)) {
            return normalizeGeneratedTagField(baseTags.join(", "));
        }

        const people = assignments.map(a => {
            const appearance = getPlainAssignmentText(a) || getAssignmentTagBlock(a, s.loraIntel);
            return [a.character, appearance].filter(Boolean).join(": ");
        }).filter(Boolean).join(" | ");
        const participantText = explicit
            ? `${girls} adult ${girls === 1 ? "woman" : "women"} and ${boys} adult ${boys === 1 ? "man" : "men"}`
            : `${Math.max(1, assignments.length)} adult character${assignments.length === 1 ? "" : "s"}`;
        const opener = s.promptStyle === "krea2"
            ? `A photo of ${participantText}.`
            : `A clear image of ${participantText}.`;
        return [
            opener,
            people ? `Character identities and appearance: ${people}.` : "",
            positionStaging ? `They are performing this exact action: ${positionStaging}.` : "",
            anatomy ? `The adult male has a visibly ${anatomy}.` : "",
            sceneTags.length ? `Visible scene details: ${sceneTags.join(", ")}.` : "",
            s.promptExtra ? `Additional visual cues: ${s.promptExtra}.` : ""
        ].filter(Boolean).join(" ");
    }

    function parseQwenJson(raw) {
        const text = String(raw || "").replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) throw new Error("Qwen returned no JSON object.");
        const parsed = JSON.parse(match[0]);
        return {
            trigger: parsed.trigger === true,
            sceneType: String(parsed.sceneType || parsed.scene_type || "normal").toLowerCase(),
            characters: Array.isArray(parsed.characters) ? parsed.characters.map(String) : [],
            position: String(parsed.position || parsed.action || "").trim(),
            location: String(parsed.location || "").trim(),
            clothing: String(parsed.clothing || "").trim(),
            query: String(parsed.query || "").trim(),
            confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0))
        };
    }

    async function classifySceneWithLocalQwen(sceneText, knownCharacters, automation) {
        if (!automation.qwenUrl) throw new Error("Set the local Qwen endpoint URL first.");
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), Math.max(5000, parseInt(automation.qwenTimeoutMs, 10) || 30000));
        const system = `You are a tiny scene router for a local roleplay image system. Analyze only the supplied text. Return exactly one compact JSON object with keys trigger, sceneType, characters, position, location, clothing, query, confidence. trigger means a still image would usefully represent the latest visible moment. sceneType must be normal, romantic, or explicit. Use only character names from the supplied known-character list. If any participant may be under 18, set trigger false and confidence 1. Never add commentary.`;
        try {
            const response = await fetch(automation.qwenUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: controller.signal,
                body: JSON.stringify({
                    model: automation.qwenModel || "Qwen2-0.5B-Instruct",
                    temperature: 0,
                    max_tokens: 180,
                    messages: [
                        { role: "system", content: system },
                        { role: "user", content: `Known characters: ${knownCharacters.join(", ") || "none"}\n\nLatest RP scene:\n${sceneText}` }
                    ]
                })
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            const raw = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? data?.message?.content ?? data?.response;
            return parseQwenJson(raw);
        } catch (e) {
            if (e?.name === "AbortError") throw new Error("Qwen request timed out.");
            throw e;
        } finally {
            clearTimeout(timeout);
        }
    }

    function findBestLibraryImage(analysis, automation) {
        const wantedChars = analysis.characters.map(v => v.toLowerCase());
        const wantedPosition = analysis.position.toLowerCase();
        const wantedLocation = analysis.location.toLowerCase();
        let best = null;
        let bestScore = 0;
        for (const item of automation.library) {
            let score = 0;
            const itemChars = Array.isArray(item.characters) ? item.characters.map(v => String(v).toLowerCase()) : [];
            for (const name of wantedChars) if (itemChars.includes(name)) score += 3;
            if (wantedPosition && String(item.position || "").toLowerCase().includes(wantedPosition)) score += 5;
            if (wantedLocation && String(item.location || "").toLowerCase().includes(wantedLocation)) score += 2;
            if (analysis.sceneType && String(item.sceneType || "").toLowerCase() === analysis.sceneType) score += 1;
            if (score > bestScore) { best = item; bestScore = score; }
        }
        return bestScore >= 3 ? best : null;
    }

    function enqueueBackgroundImageJob(job) {
        if (job.originKey && backgroundOriginKeys.has(job.originKey)) return false;
        if (job.originKey) backgroundOriginKeys.add(job.originKey);
        if (job.priority === "batch") backgroundImageQueue.push(job);
        else backgroundImageQueue.unshift(job);
        refreshBackgroundQueueStatus();
        processBackgroundImageQueue();
        return true;
    }

    // Concrete style references for the prompt-writer LLM. Two registers on
    // purpose: an explicit example (so adult scenes get direct anatomical
    // prose instead of euphemism) and a non-sexual example (so normal scenes
    // stay normal instead of drifting explicit). Both model the exact target
    // shape: photographic opener ("A photo of"), one paragraph, per-person
    // sentences with spatial anchors, "a woman ..." subject construction
    // (which doubles as the Krea LoRA trigger phrase), setting/lighting/camera close.
    const KREA2_WRITER_STYLE_EXAMPLES = `STYLE EXAMPLE (explicit register -- copy the shape and directness, never the people, bodies, setting, or act):
A photo of two women in warm lamplight, eye-level medium shot on a rumpled bed. A woman with long crimson hair and red eyes kneels on the left on all fours, fully nude with small bare breasts, back arched, face flushed and mouth open in a moan as she grips the white sheets. A woman with wavy blonde hair and green eyes kneels close behind her on the right, nude with large breasts pressed against the first woman's back, one hand between her thighs with fingers visibly penetrating her, the other hand cupping her breast. Sweat glistens on both bodies. Dim bedside lamp, rumpled sheets, shallow depth of field, warm skin-toned palette, photographic skin texture.

STYLE EXAMPLE (normal register -- copy the shape, never the people, clothing, or setting):
A photo of a cozy afternoon cafe, medium shot at eye level. A woman with short black hair and amber eyes sits on the left of a small wooden table in an oversized beige sweater, laughing with a coffee cup raised halfway. A woman with a silver ponytail and blue eyes sits across from her on the right in a fitted denim jacket, leaning forward mid-story with animated hands. Warm window light, a blurred pastry counter in the background, soft bokeh, gentle golden palette.`;

    // Concrete few-shot shape references for the Anima tag writer. Same
    // two-register rationale as KREA2_WRITER_STYLE_EXAMPLES: an explicit
    // example (direct act/anatomy tags instead of euphemism) and a safe
    // example (normal scenes stay normal). Quality/safety/meta tags
    // (masterpiece, score_N, safe, nsfw, explicit, etc.) are intentionally
    // omitted -- those come from the user's Leading Tags setting and are
    // prepended in code. Examples therefore start at the count block.
    const ANIMA_WRITER_STYLE_EXAMPLES = `STYLE EXAMPLE (explicit register -- copy the tag order, grouping, and directness, never the people, bodies, setting, or act; do not invent quality/safety prefix tags -- those are prepended separately):
2girls, yuri, long hair, red hair, red eyes, small breasts, completely nude, all fours, arched back, moaning, open mouth, blush, sheet grab, second woman kneeling behind her, wavy hair, blonde hair, green eyes, large breasts, nude, breast press, fingering from behind, vaginal, grabbing another's breast, sweat, trembling, indoors, bedroom, on bed, bed sheet, dim lighting, lamp, depth of field

STYLE EXAMPLE (safe register -- copy the tag order and grouping, never the people, clothing, or setting; do not invent quality/safety prefix tags -- those are prepended separately):
2girls, cafe, sitting, short hair, black hair, brown eyes, oversized sweater, holding cup, laughing, second woman across the table, grey hair, ponytail, blue eyes, denim jacket, leaning forward, talking, wooden table, window, sunlight, blurry background, indoors, warm lighting, medium shot`;

    /**
     * Single source of truth for the prompt-writer LLM's instructions.
     * Instructions live ONLY here (the system message); the user message is
     * pure scene data. Mixing instructions into the user message is what made
     * small models echo instruction text verbatim into rendered prompts.
     */
    function buildNanoImageSystemPrompt(s) {
        const parts = [];
        if (s?.promptStyle === "krea2" || s?.promptStyle === "sdxl") {
            const mediumRule = s?.promptStyle === "krea2"
                ? "Open with photographic phrasing such as 'A photo of' plus camera framing. Never call the image a digital illustration, anime, drawing, 2d, cartoon, render, or similar non-photo medium."
                : "Cover, in order: medium/style and camera framing.";
            parts.push(
                "You convert roleplay scene data into one finished natural-language image-generation prompt.",
                "Write one dense paragraph of fluent, concrete English prose describing only what is visible in the latest moment of the SCENE section. The most recent message matters most.",
                `${mediumRule} Then cover each visible adult subject with face, hair, body, clothing or nudity state, placement, pose, expression, and current action; then setting, lighting, and color mood.`,
                "The CHARACTERS section is appearance reference only -- it tells you what each named person looks like. Never treat it as evidence of action, pose, nudity, or camera. Translate any tag shorthand in it into prose.",
                "If more than one person is visible, give each their own sentence with a clear spatial anchor (left, right, foreground, behind, kneeling, standing) and keep each person's features inside their own sentence so identities never merge.",
                "Prefer introducing each female subject as 'a woman with ...' before using her name or pronouns.",
                "Every depicted person must be an unmistakable adult.",
                "Never use Danbooru tags, underscores, 1girl-style shorthand, quality-token lists, or comma-separated tag dumps."
            );
        } else {
            const booruStd = isBooruStandardImageMode(s, s?.loraIntel);
            const maxTags = getAnimaMaxTags(s);
            const leadTags = buildBooruStandardTagLead(s, s?.loraIntel);
            parts.push(
                "You convert roleplay scene data into one finished image-generation prompt for the Anima anime model: a single comma-separated list of lowercase Danbooru-style tags with spaces instead of underscores. Score tags like score_7 are the only tags that keep underscores. Prefer real booru tags (Gelbooru spelling when it differs from Danbooru) over invented phrases.",
                "Depict only the latest visible moment of the SCENE section; the most recent message matters most.",
                "Follow the official Anima tag order after any fixed leading tags: character-count tags, per-character appearance blocks, then act/pose/contact tags, then setting, lighting, and camera/composition tags.",
                // Quality/safety/meta tags are owned by the user's Leading Tags
                // setting and prepended in code -- the writer must never invent
                // its own masterpiece/score_N/safe/nsfw/explicit block.
                leadTags
                    ? `Do not invent quality, safety, or meta tags such as masterpiece, best quality, score_N, highres, newest, safe, sensitive, nsfw, or explicit. The app automatically prepends these fixed Leading Tags after you write: ${leadTags}. Leave them out of your output entirely.`
                    : "Do not invent quality, safety, or meta tags such as masterpiece, best quality, score_N, highres, newest, safe, sensitive, nsfw, or explicit. Start directly with the character-count tags.",
                "Start with the exact visible person count using tags such as 1girl, 1boy, 2girls, or 1boy, 1girl.",
                "The CHARACTERS section is appearance reference only; never treat it as evidence of action, pose, nudity, or camera. Copy each depicted character's appearance tags into that character's own block, dropping any reference tag the current scene contradicts (for example clothing tags when that character is undressed in the scene).",
                "When more than one person is visible, keep each character's hair, eye, body, breast-size, and clothing tags inside one contiguous block, and anchor every block after the first with a short spatial phrase such as 'second woman kneeling behind her' (Anima accepts short natural-language phrases mixed with tags). Never interleave two characters' appearance tags.",
                "Every depicted person must be an unmistakable adult.",
                maxTags && !booruStd ? `Output at most ${maxTags} comma-separated tags total. When trimming, keep character-count, per-character appearance, and act/pose/contact tags before scenery and mood detail.` : "",
                "Never output underscores between words, artist tags, watermark or username tags, weighted tags like (tag:1.2), duplicate tags, or full sentences beyond the short spatial anchor phrases."
            );
        }
        if (s?.adultTagPrecision) parts.push(getAdultPrecisionInstruction(s));
        if (isNaturalLanguageImageStyle(s?.promptStyle)) parts.push(IMAGE_BODY_SHAPE_POSITIVE_INSTRUCTION);
        parts.push(
            "Match the scene's explicitness exactly: if the scene is sexually explicit, name the act, position, contact points, anatomy, and fluids directly with plain adult words -- never euphemize, soften, or omit what is happening. If the scene is not sexual, write a fully non-sexual prompt and do not add nudity, arousal, or innuendo that is not in the scene.",
            "If a SELECTED ACTION section exists, it is the action to depict, overriding the scene text.",
            "If an EXTRA GUIDANCE section exists, weave those visual cues in where they fit.",
            "Output contract: respond with the finished image prompt only. No preamble, quotes, labels, meta-commentary, explanations, file names, or IDs."
        );
        const rules = parts.filter(Boolean).join(" ");
        // Concrete few-shot shape references matter more than rules for
        // small prompt-writer models; every style gets register-matched
        // examples (prose for Krea2/SDXL, Anima tag lists otherwise).
        if (s?.promptStyle === "krea2" || s?.promptStyle === "sdxl") {
            return `${rules}\n\n${KREA2_WRITER_STYLE_EXAMPLES}`;
        }
        return `${rules}\n\n${ANIMA_WRITER_STYLE_EXAMPLES}`;
    }

    function buildComfyNanoPromptContext(s, sceneText, manualScene = null) {
        const normalizedScene = normalizeManualImageScene(manualScene);
        const li = s.loraIntel;
        const charKey = getCharacterKey() || "default";
        const castOpts = { userPickedCast: !!normalizedScene.userPickedCast };
        // Scene-cast for fallback/LoRA inference may be keyword-filtered; that
        // must not shrink the prompt-AI reference library when Send All is on.
        const assignments = normalizedScene.assignments.length
            ? normalizedScene.assignments
            : getDeterministicSceneAssignments(s, sceneText);
        const promptReferenceAssignments = shouldPromptAiChooseCharacters(li, normalizedScene.assignments, castOpts)
            ? getPromptAiCharacterAssignments(li, charKey, normalizedScene.assignments, castOpts)
            : (Array.isArray(assignments) ? assignments : []);
        const naturalDescriptionLines = li?.enabled && li.useCharDescriptions
            ? promptReferenceAssignments.map(a => {
                const desc = getAssignmentNaturalDescription(a);
                return desc ? `${a.character || "character"}: ${desc}` : "";
            }).filter(Boolean)
            : [];
        const booruReferenceLines = li?.enabled && li.useDanbooruTags
            ? promptReferenceAssignments.map(a => {
                const tagBlock = getStableAssignmentTagBlock(a, li);
                return tagBlock ? `${a.character || "character"}: ${tagBlock}` : "";
            }).filter(Boolean)
            : [];
        const characterLines = naturalDescriptionLines.length ? naturalDescriptionLines : booruReferenceLines;
        const selectedActionTags = normalizedScene.positions
            .map(position => getBatchPositionStaging(position.label, position.prompt))
            .filter(Boolean);
        // Leading Tags are prepended in code (ensureImageLeadPrefix), not
        // mixed into EXTRA GUIDANCE -- otherwise the writer either echoes
        // or invents a competing quality block.
        const extraGuidance = normalizeGeneratedTagField(String(s.promptExtra || "").trim());
        const chooseInstruction = shouldPromptAiChooseCharacters(li, normalizedScene.assignments, castOpts)
            ? getPromptAiCharacterChoiceInstruction(li, normalizedScene.assignments, castOpts)
            : "";

        // Deterministic fallback: a real scene-derived prompt (characters,
        // detected action, scene tags) that renders something sensible even
        // when every LLM path fails. Never instruction text.
        const fallbackPosition = normalizedScene.positions[0] || detectPositionPresetFromScene(sceneText);
        const fallbackPrompt = buildDeterministicBackgroundPrompt(s, sceneText, {
            assignments: assignments.length ? assignments : null,
            position: fallbackPosition,
            sceneType: (fallbackPosition || isExplicitSceneText(sceneText)) ? "explicit" : "normal"
        }) || (s.promptStyle === "krea2" ? "a photo of the current roleplay scene" : "a detailed cinematic illustration of the current roleplay scene");

        // User message = pure data with named sections. All instructions live
        // in the system prompt (buildNanoImageSystemPrompt), except the
        // choose-who-appears line which only applies when Send All is on.
        return {
            systemPrompt: [
                buildNanoImageSystemPrompt(s),
                chooseInstruction
            ].filter(Boolean).join(" "),
            fallbackPrompt,
            aiText: [
                characterLines.length ? `CHARACTERS (appearance reference only):\n${characterLines.join("\n")}` : "",
                selectedActionTags.length ? `SELECTED ACTION:\n${selectedActionTags.join(", ")}` : "",
                extraGuidance ? `EXTRA GUIDANCE:\n${extraGuidance}` : "",
                `SCENE (latest roleplay messages, newest last):\n${String(sceneText || "").trim()}`
            ].filter(Boolean).join("\n\n")
        };
    }

    function buildBackgroundAiText(job) {
        // Pure data sections only; instructions live in buildNanoImageSystemPrompt.
        const source = String(job?.sceneText || "").trim();
        const required = String(job?.directPrompt || "").trim();
        const position = String(job?.metadata?.position || "").trim();
        const sceneType = String(job?.metadata?.sceneType || "").trim();
        return [
            sceneType ? `SCENE TYPE:\n${sceneType}` : "",
            position ? `SELECTED ACTION:\n${position}` : "",
            required ? `EXTRA GUIDANCE:\n${required}` : "",
            source ? `SCENE (latest roleplay messages, newest last):\n${source}` : "",
        ].filter(Boolean).join("\n\n");
    }

    async function processBackgroundImageQueue() {
        if (backgroundImageWorkerActive) return;
        const initialAutomation = ensureBackgroundAutomationSettings(getLocalProfile()?.imageGen || {});
        if (initialAutomation.queuePaused) {
            refreshBackgroundQueueStatus();
            return;
        }
        backgroundImageWorkerActive = true;
        refreshBackgroundQueueStatus();
        while (backgroundImageQueue.length > 0) {
            const automation = ensureBackgroundAutomationSettings(getLocalProfile()?.imageGen || {});
            if (automation.queuePaused) break;
            const job = backgroundImageQueue.shift();
            backgroundActiveJob = job;
            refreshBackgroundQueueStatus();
            try {
                const s = getLocalProfile()?.imageGen;
                if (!s?.enabled) throw new Error("Image Generation was disabled.");
                if (!job.directPrompt) throw new Error("Background jobs require a deterministic direct prompt.");
                const gen = { prompt: job.directPrompt, skipLeadPrefix: false };
                const target = job.libraryOnly
                    ? { libraryOnly: true, background: true, metadata: job.metadata }
                    : { ...(resolveBackgroundOrigin(job.origin) || {}), background: true, metadata: job.metadata };
                if (!job.libraryOnly && !target.message) throw new Error("The originating RP message no longer exists.");
                await igGenerateWithComfy(gen.prompt, target, {
                    skipLeadPrefix: !!gen.skipLeadPrefix,
                    manualScene: job.manualScene,
                    background: true,
                    aiText: job.aiText || buildBackgroundAiText(job)
                });
            } catch (e) {
                console.error("[Megumin Suite] Background image job failed:", e);
            } finally {
                if (job.originKey) backgroundOriginKeys.delete(job.originKey);
                backgroundActiveJob = null;
            }
        }
        backgroundImageWorkerActive = false;
        refreshBackgroundQueueStatus();
    }

    function inferAssignmentSex(assignment) {
        const text = [
            assignment?.character,
            assignment?.character_tag,
            assignment?.physical_tags,
            assignment?.booru_tags,
            assignment?.plain_description,
            assignment?.description
        ].filter(Boolean).join(" ").toLowerCase().replace(/[_-]+/g, " ");
        if (/\b(?:1girl|woman|female|girl|lady|she|her|breasts?|pussy|vagina)\b/.test(text)) return "female";
        if (/\b(?:1boy|man|male|guy|he|him|penis|cock)\b/.test(text)) return "male";
        return "unknown";
    }

    function assignmentHasMinorWording(assignment) {
        const text = [
            assignment?.character,
            assignment?.character_tag,
            assignment?.physical_tags,
            assignment?.clothing_tags,
            assignment?.booru_tags,
            assignment?.plain_description,
            assignment?.description
        ].filter(Boolean).join(" ");
        return !!findKrea2ForbiddenMinorTerm(text);
    }

    function getBatchPositionStaging(positionName, positionPrompt) {
        const key = String(positionName || "").toLowerCase();
        const vaginal = "vaginal penetration, penis visibly entering vagina, connected bodies";
        const anal = "anal penetration, penis visibly entering anus, connected bodies";
        if (key === "missionary") return `${positionPrompt}, ${vaginal}, adult man above or between the adult woman's spread legs`;
        if (key === "cowgirl") return `${positionPrompt}, ${vaginal}, adult woman riding the adult man`;
        if (key === "reverse cowgirl") return `${positionPrompt}, ${vaginal}, adult woman riding while facing away`;
        if (["doggy style", "spooning", "standing", "against wall", "legs over shoulders", "mating press"].includes(key)) return `${positionPrompt}, ${vaginal}`;
        if (key === "anal") return `${positionPrompt}, ${anal}`;
        if (key === "blowjob" || key === "deepthroat" || key === "standing oral") return `${positionPrompt}, visible erect penis in mouth, clear oral contact`;
        if (key === "titfuck" || key === "paizuri pov") return `${positionPrompt}, visible erect penis between breasts`;
        if (key === "handjob") return `${positionPrompt}, visible erect penis held in hand`;
        if (key === "footjob") return `${positionPrompt}, visible erect penis between feet`;
        if (key === "oral 69") return `${positionPrompt}, two adult partners giving mutual oral sex with explicit genital contact`;
        if (key === "cunnilingus") return `${positionPrompt}, adult partner's mouth visibly contacting the adult woman's vulva`;
        if (key === "face sitting" || key === "riding face") return `${positionPrompt}, adult woman's vulva visibly pressed to the partner's mouth`;
        if (key === "fingering") return `${positionPrompt}, fingers visibly inside or spreading the adult woman's vagina`;
        if (key === "double penetration") return `${positionPrompt}, one adult woman and two adult men, simultaneous vaginal and anal penetration, two visible erect penises`;
        if (key === "threesome") return `${positionPrompt}, three adults, one adult woman and two adult men, explicit shared sexual contact`;
        return positionPrompt;
    }

    function batchPositionUsesPenis(positionName) {
        return !["cunnilingus", "face sitting", "riding face", "fingering", "grinding", "lap dance"].includes(String(positionName || "").toLowerCase());
    }

    function buildBatchScenePlan(primary, assignments, positionName, positionPrompt, s, automation) {
        const primarySex = inferAssignmentSex(primary);
        const preferredPartnerSex = primarySex === "male" ? "female" : "male";
        const partner = assignments.find(a => a !== primary && inferAssignmentSex(a) === preferredPartnerSex);
        const isThreePerson = /^(double penetration|threesome)$/i.test(positionName);
        const manualAssignments = [primary];
        if (partner) manualAssignments.push(partner);

        const primaryName = primary.character || "the selected adult character";
        const partnerName = partner?.character || (preferredPartnerSex === "female" ? "a generic adult woman" : "a generic adult man");
        const characters = [primaryName, partnerName];
        let castDescription;
        if (isThreePerson) {
            castDescription = primarySex === "male"
                ? `${primaryName}, ${partnerName}, and one additional generic adult man`
                : `${primaryName}, ${partnerName}, and one additional generic adult man`;
            characters.push("generic adult man");
        } else {
            castDescription = `${primaryName} and ${partnerName}`;
        }

        const staging = getBatchPositionStaging(positionName, positionPrompt);
        const anatomySetting = automation.batchMaleAnatomy || "standard";
        const anatomy = batchPositionUsesPenis(positionName)
            ? (anatomySetting === "huge" ? "huge penis" : (anatomySetting === "large" ? "large penis" : "clearly visible erect penis"))
            : "";
        const anatomyProse = anatomySetting === "huge"
            ? "The adult male has a huge, fully visible erect penis."
            : (anatomySetting === "large"
                ? "The adult male has a large, fully visible erect penis."
                : "The adult male's erect penis is clearly visible.");
        const naturalLanguage = isNaturalLanguageImageStyle(s.promptStyle);
        const castInstruction = naturalLanguage
            ? `Depict exactly ${isThreePerson ? "three" : "two"} consenting adults: ${castDescription}. Describe every person and the explicit anatomy/contact in fluent prose. Do not use shorthand such as 1girl or 1boy.`
            : `Mandatory cast and anatomy tags: ${isThreePerson ? "1girl, 2boys" : (primarySex === "male" ? "1boy, 1girl" : "1girl, 1boy")}, hetero, sex, nude, uncensored${anatomy ? `, ${anatomy}` : ""}.`;
        const extraInstruction = `Batch-library render. ${castInstruction} Selected adult character focus: ${primaryName}. Exact act staging: ${staging}${anatomy && naturalLanguage ? `. ${anatomyProse}` : "."} Keep analyzed character identities stable. Do not omit the partner, crop away the required contact, replace penetration with posing, or turn this into a solo pinup.`;
        const selectedAssignments = manualAssignments;
        let directPrompt;
        if (naturalLanguage) {
            const identities = selectedAssignments.map(a => {
                const vrtl = getVrtlLoraIdentityKeywords(a.lora);
                if (vrtl?.length) return `${a.character}: ${vrtl.join(", ")}`;
                const description = a.plain_description || a.description || getAssignmentTagBlock(a, s.loraIntel);
                return description ? `${a.character}: ${description}` : a.character;
            }).filter(Boolean).join(" | ");
            directPrompt = `${extraInstruction}${identities ? ` Character identity references: ${identities}.` : ""}`;
        } else {
            const characterTags = selectedAssignments.flatMap(a => getAssignmentTagParts(a, s.loraIntel)).filter(Boolean);
            const castTags = isThreePerson ? ["1girl", "2boys"] : (primarySex === "male" ? ["1boy", "1girl"] : ["1girl", "1boy"]);
            directPrompt = [
                ...castTags,
                "hetero",
                "sex",
                "nude",
                "uncensored",
                anatomy,
                ...characterTags,
                staging
            ].filter(Boolean).join(", ");
        }

        return {
            manualScene: { assignments: manualAssignments, positions: [{ label: positionName, prompt: staging }] },
            sceneText: `${castDescription}, all explicitly adult and consenting, performing this exact act: ${staging}.`,
            extraInstruction,
            directPrompt,
            characters
        };
    }

    function queueBatchCategoryJobs(characterName, positionName, requestedCount, addMore = false) {
        const s = getLocalProfile()?.imageGen;
        const automation = ensureBackgroundAutomationSettings(s);
        if (!automation.batchEnabled) throw new Error("Enable Batch Library Generator first.");
        const li = s.loraIntel;
        const charKey = getCharacterKey() || "default";
        const assignments = getModeCharacterAssignments(li, charKey).map(ensureStructuredCharacterAssignment).filter(a => !a.neverInclude && !assignmentHasMinorWording(a));
        if (!assignments.length) throw new Error("Analyze characters before starting a batch.");
        const assignment = assignments.find(a => String(a.character || "").toLowerCase() === String(characterName || "").toLowerCase());
        if (!assignment) throw new Error(`Analyzed character not found: ${characterName}`);
        const preset = NSFW_POSITION_PRESETS.find(p => p.label.toLowerCase() === String(positionName || "").toLowerCase());
        const positionPrompt = preset?.prompt || positionName;
        const groupKey = `batch-group-v3:${charKey}:${assignment.character}:${positionName}:${automation.batchMaleAnatomy}`.toLowerCase();
        const ready = automation.library.filter(item =>
            item.batchGroupKey === groupKey ||
            (!item.batchGroupKey && getBatchLibraryPrimaryCharacter(item).toLowerCase() === String(assignment.character).toLowerCase() && String(item.position || "").toLowerCase() === String(positionName).toLowerCase())
        );
        const pending = backgroundImageQueue.filter(job => job.metadata?.batchGroupKey === groupKey);
        if (backgroundActiveJob?.metadata?.batchGroupKey === groupKey) pending.push(backgroundActiveJob);
        const wanted = Math.max(1, parseInt(requestedCount, 10) || 1);
        const jobsToAdd = addMore ? wanted : Math.max(0, wanted - ready.length - pending.length);
        let nextVariant = Math.max(
            0,
            ...ready.map(item => parseInt(item.batchVariant, 10) || 0),
            ...pending.map(job => parseInt(job.metadata?.batchVariant, 10) || 0)
        ) + 1;
        let count = 0;
        for (let i = 0; i < jobsToAdd; i++, nextVariant++) {
            const scenePlan = buildBatchScenePlan(assignment, assignments, positionName, positionPrompt, s, automation);
            const batchKey = `${groupKey}:variant:${nextVariant}`;
            enqueueBackgroundImageJob({
                priority: "batch",
                libraryOnly: true,
                sceneText: scenePlan.sceneText,
                extraInstruction: scenePlan.extraInstruction,
                directPrompt: scenePlan.directPrompt,
                manualScene: scenePlan.manualScene,
                metadata: {
                    batchKey,
                    batchGroupKey: groupKey,
                    batchVariant: nextVariant,
                    primaryCharacter: assignment.character,
                    characters: scenePlan.characters,
                    position: positionName,
                    sceneType: "explicit",
                    source: "batch"
                }
            });
            count++;
        }
        return count;
    }

    function queueCharacterBatchJobs() {
        const s = getLocalProfile()?.imageGen;
        const automation = ensureBackgroundAutomationSettings(s);
        if (!automation.batchEnabled) throw new Error("Enable Batch Library Generator first.");
        const li = s.loraIntel;
        const charKey = getCharacterKey() || "default";
        const assignments = getModeCharacterAssignments(li, charKey).map(ensureStructuredCharacterAssignment).filter(a => !a.neverInclude && !assignmentHasMinorWording(a));
        if (!assignments.length) throw new Error("Analyze characters before starting a batch.");
        const positionNames = automation.batchPositions.map(v => String(v).trim()).filter(Boolean);
        if (!positionNames.length) throw new Error("Add at least one batch position.");
        let count = 0;
        for (const assignment of assignments) {
            for (const positionName of positionNames) {
                count += queueBatchCategoryJobs(assignment.character, positionName, automation.batchImagesPerGroup, false);
            }
        }
        return count;
    }

    async function handleBackgroundAutomation(triggerReason = "message-received") {
        return;
        const s = getLocalProfile()?.imageGen;
        if (!s?.enabled) return;
        const automation = ensureBackgroundAutomationSettings(s);
        if (!automation.autoEnabled && !automation.smartEnabled) return;
        const chat = getContext().chat || [];
        const message = chat[chat.length - 1];
        if (!message || message.is_user || message.is_system) return;
        const origin = getBackgroundOrigin(message);
        if (automation.lastProcessedRevisionKey === origin.revisionKey) return;
        if (backgroundOriginKeys.has(origin.originKey)) return;
        const aiCount = chat.filter(m => !m.is_user && !m.is_system).length;
        const cooldown = Math.max(0, parseInt(automation.cooldownReplies, 10) || 0);
        const lastAutoAiCount = parseInt(automation.lastAutoAiCount, 10) || 0;
        const isMessageRevision = automation.lastProcessedMessageIndex === origin.index && automation.lastProcessedRevisionKey !== origin.revisionKey;
        if (!isMessageRevision && lastAutoAiCount > 0 && aiCount - lastAutoAiCount <= cooldown) {
            if (automation.smartEnabled) setQwenStatus(`Skipped · cooldown (${triggerReason})`);
            return;
        }
        const sceneText = getSceneSnapshotForMessage(message);
        const latestSceneText = getLatestVisualSceneText(message);
        if (!sceneText || findKrea2ForbiddenMinorTerm(sceneText)) {
            if (automation.smartEnabled) setQwenStatus("Skipped · empty or age-safety guard");
            return;
        }
        automation.lastProcessedRevisionKey = origin.revisionKey;
        automation.lastProcessedMessageIndex = origin.index;
        saveProfileToMemory();
        const li = s.loraIntel;
        const charKey = getCharacterKey() || "default";
        const assignments = getModeCharacterAssignments(li, charKey).map(ensureStructuredCharacterAssignment).filter(a => !a.neverInclude);
        const knownNames = assignments.map(a => a.character).filter(Boolean);

        if (automation.smartEnabled) {
            try {
                setQwenStatus(`Checking ${triggerReason.replace(/-/g, " ")}…`);
                let qwenAnalysis;
                try {
                    qwenAnalysis = await classifySceneWithLocalQwen(sceneText, knownNames, automation);
                } catch (qwenError) {
                    if (!detectPositionPresetFromScene(latestSceneText) && !isExplicitSceneText(latestSceneText)) throw qwenError;
                    console.warn("[Megumin Suite] Qwen failed; using deterministic explicit-scene routing:", qwenError);
                    qwenAnalysis = {
                        trigger: false,
                        sceneType: "explicit",
                        characters: [],
                        position: "",
                        location: "",
                        clothing: "",
                        query: "",
                        confidence: 0
                    };
                    setQwenStatus("Qwen failed · deterministic explicit override");
                }
                const analysis = applyDeterministicSceneOverride(qwenAnalysis, latestSceneText, knownNames);
                if (analysis.trigger && analysis.confidence >= Number(automation.qwenMinConfidence || 0.7)) {
                    if (automation.smartSearchLibrary) {
                        const ready = findBestLibraryImage(analysis, automation);
                        if (ready && await attachLibraryImageToOrigin(ready, origin)) {
                            setQwenStatus(`Library hit · ${analysis.position || analysis.sceneType} · attached to message ${origin.index + 1}`);
                            automation.lastAutoAiCount = aiCount;
                            saveProfileToMemory();
                            return;
                        }
                    }
                    if (automation.smartGenerateFallback) {
                        // Qwen is only a trigger/library router. A fresh render lets
                        // NanoGPT infer the scene from RP text plus configured identity tags;
                        // neither Qwen JSON nor deterministic action presets constrain it.
                        const selected = getDeterministicSceneAssignments(s, latestSceneText);
                        const sceneType = isExplicitSceneText(latestSceneText) ? "explicit" : "normal";
                        const nanoContext = buildComfyNanoPromptContext(s, sceneText, {
                            assignments: selected,
                            positions: []
                        });
                        enqueueBackgroundImageJob({
                            priority: "smart",
                            origin,
                            originKey: origin.originKey,
                            sceneText,
                            directPrompt: nanoContext.fallbackPrompt,
                            aiText: nanoContext.aiText,
                            manualScene: selected.length ? { assignments: selected, positions: [] } : null,
                            metadata: {
                                source: "smart-fresh-render",
                                sceneType
                            }
                        });
                        setQwenStatus(`No library match · independent NanoGPT render queued for message ${origin.index + 1}`);
                        automation.lastAutoAiCount = aiCount;
                        saveProfileToMemory();
                        return;
                    }
                    setQwenStatus("Matched scene · no fallback action enabled");
                } else {
                    setQwenStatus(`No fetch · ${Math.round(analysis.confidence * 100)}% confidence${analysis.trigger ? " below threshold" : ""}`);
                }
            } catch (e) {
                console.warn("[Megumin Suite] Smart Qwen mode skipped this message:", e);
                setQwenStatus(`Error · ${e.message}`);
            }
        }

        if (automation.autoEnabled && shouldAutoGenerateScene(latestSceneText, automation)) {
            const position = detectPositionPresetFromScene(latestSceneText);
            const directPrompt = buildDeterministicBackgroundPrompt(s, latestSceneText, {
                position,
                sceneType: isExplicitSceneText(latestSceneText) ? "explicit" : "normal"
            });
            enqueueBackgroundImageJob({
                priority: "auto",
                origin,
                originKey: origin.originKey,
                sceneText,
                directPrompt,
                manualScene: position ? { assignments: getDeterministicSceneAssignments(s, latestSceneText), positions: [position] } : null,
                metadata: { source: "auto", sceneType: isExplicitSceneText(latestSceneText) ? "explicit" : "normal" }
            });
            if (automation.smartEnabled) {
                setQwenStatus(`Qwen skipped · Auto render queued for message ${origin.index + 1}`);
            }
            automation.lastAutoAiCount = aiCount;
            saveProfileToMemory();
        }
    }

    function registerImageSwipeHandler() {
        const meguminSwipeHandler = async (data) => {
            const s = getLocalProfile()?.imageGen;
            if (!s || !s.enabled) return;

            const { message, direction, element } = data;
            if (direction !== "right") return;

            const media = message.extra?.media || [];
            const idx = message.extra?.media_index || 0;
            if (idx < media.length - 1) return;

            const mediaObj = media[idx];
            const storedPrompt = String(mediaObj?.prompt || mediaObj?.title || "").trim();
            if (!storedPrompt) return;

            let ogPower = null;
            if (window.power_user && window.power_user.image_overswipe) {
                ogPower = window.power_user.image_overswipe;
                window.power_user.image_overswipe = "off";
            }

            let ogExt = null;
            if (extension_settings.image_generation && extension_settings.image_generation.overswipe) {
                ogExt = extension_settings.image_generation.overswipe;
                extension_settings.image_generation.overswipe = false;
            }

            setTimeout(() => {
                if (ogPower && window.power_user) window.power_user.image_overswipe = ogPower;
                if (ogExt && extension_settings.image_generation) extension_settings.image_generation.overswipe = ogExt;
            }, 200);

            toastr.info("Regenerating Image...", "Megumin Suite");
            await igGenerateWithComfy(storedPrompt, { message: message, element: $(element) }, { preserveStoredPrompt: true });
        };

        eventSource.on(event_types.IMAGE_SWIPED, meguminSwipeHandler);

        if (eventSource._events && Array.isArray(eventSource._events[event_types.IMAGE_SWIPED])) {
            const arr = eventSource._events[event_types.IMAGE_SWIPED];
            if (arr.length > 1 && arr[arr.length - 1] === meguminSwipeHandler) {
                arr.unshift(arr.pop());
            }
        }
    }

    return {
        renderImageGen,
        renderKreaLoraGallery,
        toggleQuickGenButton,
        loadDanbooruTags,
        igGenerateWithComfy,
        igManualGenerate,
        igBypassInactiveLoraLoaderNodes,
        getCleanedChatHistory,
        cleanMessageTextForKeywords,
        stripUtilityThinkingWrapper,
        extendBaseDict,
        handlePromptInjection,
        handleMessageReceived,
        registerImageSwipeHandler,
    };
}
