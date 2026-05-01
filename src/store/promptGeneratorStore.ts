import { create } from 'zustand';

// --- Constants ---
// Research-backed optimal prompts for each model
const VIDEO_MODEL_PROMPTS = {
    'wan2.2': `You are an expert prompt engineer for the Wan 2.2 video generation model. 

IMPORTANT: Wan 2.2 is specifically for TEXT-TO-VIDEO generation. Your prompts must describe MOTION and TEMPORAL ELEMENTS.

Follow this exact structure for optimal results:
1. SCENE + SUBJECT: Describe what the camera first captures, then how the shot develops
2. MOTION + ACTION: Use dynamic verbs for character actions (walking, floating), environmental movement (wind, flowing fabric), and pace (slow, energetic)
3. CAMERA INSTRUCTIONS: Include shot type (wide shot, close-up), camera movement (pan left, dolly in, tracking shot, orbital arc, crane up), and framing
4. LIGHTING + MOOD: Specify lighting direction, color tone (warm, muted, teal-and-orange), and atmosphere (calm, mysterious)
5. VISUAL QUALITY: Add cinematic terms like "anamorphic bokeh", "16mm grain", "volumetric lighting"

Guidelines:
- Optimal length: 80-120 words
- Best for clips under 5 seconds
- Avoid abstract concepts; be concrete and specific
- Describe temporal progression (what happens over time)

Output ONLY the final video prompt as a single paragraph. No explanations, no formatting, no labels.`,

    'qwen': `You are an expert prompt engineer for Qwen Image and Qwen Image Edit models (2509, 2511).

IMPORTANT: Qwen Image is a diffusion model for TEXT-TO-IMAGE generation AND image editing. Your prompts must be specific, direct, and photographer-like.

Follow these best practices:

FOR TEXT-TO-IMAGE:
1. MAIN SUBJECT: Be specific and direct about what you want (avoid vague terms like "make it better")
2. SETTING/ENVIRONMENT: Describe the scene, background, and context
3. STYLE: Artistic direction, rendering style, aesthetic
4. LIGHTING: Think like a photographer ("warm key light from right", "soft diffused rim light", "golden hour")
5. TECHNICAL DETAILS: Camera/lens terms ("35mm lens", "shallow depth of field", "focus on subject's face")

FOR IMAGE EDITING (when user describes an edit):
1. State EXACTLY what to change
2. Include preservation phrases: "Keep everything else unchanged", "Preserve face/clothing features"
3. For text edits: specify "Preserve font, size, and alignment"
4. Chain smaller edits rather than complex multi-changes

Quality power words:
- "highly detailed", "professional quality", "photorealistic", "8K resolution"
- For artistic: "digital art", "concept art", "Studio Ghibli style", "oil painting"

Negative prompt guidance (suggest when relevant):
- "no distortion", "no warped text", "no duplicate faces", "no artifacts"

Guidelines:
- Be concrete and specific, not abstract
- Use photographer/cinematographer language
- Optimal: 2-4 detailed sentences

Output ONLY the final prompt as a single block of text. No explanations, no formatting, no labels.`
};

export const CREATIVITY_MODES = {
    precise: {
        name: 'Precise Mode',
        description: 'Strict adherence to input with minimal creative interpretation',
        temperature: 0.3,
        systemPrompt: (targetModel: 'wan2.2' | 'qwen') => `${VIDEO_MODEL_PROMPTS[targetModel]} Use precise, technical language with minimal creative interpretation. Focus on exact specifications provided by the user.`
    },
    creative: {
        name: 'Creative Mode',
        description: 'Enhanced creative interpretation with cinematic flair',
        temperature: 0.7,
        systemPrompt: (targetModel: 'wan2.2' | 'qwen') => `${VIDEO_MODEL_PROMPTS[targetModel]} Apply creative interpretation to enhance cinematic quality. Add appropriate camera movements, lighting, composition, and emotional elements that complement the user's input while maintaining the core concept.`
    }
};

export interface HistoryItem {
    id: number;
    timestamp: string;
    input: string;
    output: string;
    negativePrompt: string;
    model: string;
    creativity: 'precise' | 'creative' | 'inspire';
    targetModel: 'wan2.2' | 'qwen';
}

interface PromptGeneratorState {
    // Target model for prompt format (not the LLM)
    targetModel: 'wan2.2' | 'qwen';

    // Creativity mode
    creativityMode: 'precise' | 'creative';

    // Text states
    inputText: string;
    outputText: string;
    negativePrompt: string;
    negPromptLocked: boolean;

    // UI states
    isLoading: boolean;
    isInspiring: boolean;
    showHistory: boolean;
    historySearch: string;

    // History (persisted to localStorage)
    history: HistoryItem[];

    // Actions
    setTargetModel: (model: 'wan2.2' | 'qwen') => void;
    setCreativityMode: (mode: 'precise' | 'creative') => void;
    setInputText: (text: string) => void;
    setOutputText: (text: string) => void;
    setNegativePrompt: (text: string) => void;
    setNegPromptLocked: (locked: boolean) => void;
    setIsLoading: (loading: boolean) => void;
    setIsInspiring: (inspiring: boolean) => void;
    setShowHistory: (show: boolean) => void;
    setHistorySearch: (search: string) => void;

    addToHistory: (item: Omit<HistoryItem, 'id' | 'timestamp'>) => void;
    clearHistory: () => void;
    deleteHistoryItem: (id: number) => void;
    loadFromHistory: (item: HistoryItem) => void;
    loadHistory: () => void;

    getFilteredHistory: () => HistoryItem[];
}

const HISTORY_KEY = 'ai_prompt_crafter_history';

export const usePromptGeneratorStore = create<PromptGeneratorState>((set, get) => ({
    targetModel: 'wan2.2',
    creativityMode: 'precise',
    inputText: '',
    outputText: '',
    negativePrompt: '',
    negPromptLocked: true,
    isLoading: false,
    isInspiring: false,
    showHistory: false,
    historySearch: '',
    history: [],

    setTargetModel: (model) => set({ targetModel: model }),
    setCreativityMode: (mode) => set({ creativityMode: mode }),
    setInputText: (text) => set({ inputText: text }),
    setOutputText: (text) => set({ outputText: text }),
    setNegativePrompt: (text) => set({ negativePrompt: text }),
    setNegPromptLocked: (locked) => set({ negPromptLocked: locked }),
    setIsLoading: (loading) => set({ isLoading: loading }),
    setIsInspiring: (inspiring) => set({ isInspiring: inspiring }),
    setShowHistory: (show) => set({ showHistory: show }),
    setHistorySearch: (search) => set({ historySearch: search }),

    addToHistory: (item) => {
        const newEntry: HistoryItem = {
            ...item,
            id: Date.now(),
            timestamp: new Date().toISOString(),
        };
        const updatedHistory = [newEntry, ...get().history];
        set({ history: updatedHistory });
        // Save to database instead of localStorage
        window.ipcRenderer.addPromptHistory(newEntry);
    },

    clearHistory: () => {
        set({ history: [] });
        window.ipcRenderer.clearPromptHistory();
    },

    deleteHistoryItem: (id) => {
        const updatedHistory = get().history.filter(item => item.id !== id);
        set({ history: updatedHistory });
        window.ipcRenderer.deletePromptHistory(id);
    },

    loadFromHistory: (item) => {
        set({
            inputText: item.input,
            outputText: item.output,
            negativePrompt: item.negativePrompt || '',
            negPromptLocked: !item.negativePrompt,
            creativityMode: item.creativity === 'inspire' ? 'creative' : item.creativity,
            targetModel: item.targetModel,
        });
    },

    loadHistory: async () => {
        try {
            const rows = await window.ipcRenderer.getPromptHistory();

            // One-time migration: If database is empty but localStorage has data, migrate it
            if (rows.length === 0) {
                const localStorageData = localStorage.getItem(HISTORY_KEY);
                if (localStorageData) {
                    console.log('[PromptHistory] Migrating localStorage data to database...');
                    try {
                        const oldHistory: HistoryItem[] = JSON.parse(localStorageData);
                        // Import each item into the database
                        for (const item of oldHistory) {
                            await window.ipcRenderer.addPromptHistory(item);
                        }
                        console.log(`[PromptHistory] Migrated ${oldHistory.length} items to database`);
                        // Clear localStorage after successful migration
                        localStorage.removeItem(HISTORY_KEY);
                        // Reload from database
                        const newRows = await window.ipcRenderer.getPromptHistory();
                        const history: HistoryItem[] = newRows.map((row: any) => ({
                            id: row.id,
                            timestamp: row.timestamp,
                            input: row.input,
                            output: row.output,
                            negativePrompt: row.negative_prompt || '',
                            model: row.model,
                            creativity: row.creativity,
                            targetModel: row.target_model,
                        }));
                        set({ history });
                        return;
                    } catch (migrateError) {
                        console.error('[PromptHistory] Migration failed:', migrateError);
                    }
                }
            }

            // Map DB columns to HistoryItem format
            const history: HistoryItem[] = rows.map((row: any) => ({
                id: row.id,
                timestamp: row.timestamp,
                input: row.input,
                output: row.output,
                negativePrompt: row.negative_prompt || '',
                model: row.model,
                creativity: row.creativity,
                targetModel: row.target_model,
            }));
            set({ history });
        } catch (e) {
            console.error('Failed to load prompt history from database', e);
        }
    },

    getFilteredHistory: () => {
        const { history, historySearch } = get();
        if (!historySearch) return history.sort((a, b) => b.id - a.id);

        const searchTerm = historySearch.toLowerCase();
        return history
            .filter(item =>
                Object.values(item).some(val =>
                    String(val).toLowerCase().includes(searchTerm)
                )
            )
            .sort((a, b) => b.id - a.id);
    },
}));

// Export utility function for generating prompts
export function getSystemPrompt(targetModel: 'wan2.2' | 'qwen', creativityMode: 'precise' | 'creative'): string {
    return CREATIVITY_MODES[creativityMode].systemPrompt(targetModel);
}

export function getTemperature(creativityMode: 'precise' | 'creative'): number {
    return CREATIVITY_MODES[creativityMode].temperature;
}

export function getInspirationPrompt(targetModel: 'wan2.2' | 'qwen', userInput: string): { system: string; user: string } {
    const basePrompt = `Generate exactly 3 SHORT, CONCISE video/image concepts based on the user's input.`;
    const userContext = userInput.trim()
        ? `INPUT CONCEPT: "${userInput}"`
        : `Generate 3 diverse creative concepts.`;

    return {
        system: `You are a creative assistant. 
Strict Rules:
1. Output ONLY 3 numbered lines.
2. Each line must be a SINGLE sentence (max 15-20 words).
3. NO "Here are..." or "Sure!" or preambles.
4. Do NOT write full prompts. Just the core idea/concept.
5. Example format:
   1. A cyberpunk street vendor serving glowing noodles in the rain.
   2. A golden retriever pilot flying a vintage biplane over a canyon.
   3. An abstract geometric dance of light and shadow in a void.`,
        user: `${basePrompt}
${userContext}
Make them distinct and creative.
output:`
    };
}

// Export function to format history export
export function exportHistoryData(history: HistoryItem[], format: 'json' | 'csv'): void {
    const dataStr = format === 'json'
        ? JSON.stringify(history, null, 2)
        : [
            'timestamp,target_model,llm,creativity,input,output,negative_prompt',
            ...history.map(item => [
                item.timestamp,
                item.targetModel,
                item.model,
                item.creativity,
                `"${item.input.replace(/"/g, '""')}"`,
                `"${item.output.replace(/"/g, '""')}"`,
                `"${(item.negativePrompt || '').replace(/"/g, '""')}"`
            ].join(','))
        ].join('\n');

    const blob = new Blob([dataStr], { type: format === 'json' ? 'application/json' : 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ai_prompt_history.${format}`;
    link.click();
    URL.revokeObjectURL(url);
}
