import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';

// --- Types ---
export interface PromptTemplate {
    id: string;
    name: string;
    description: string;
    systemPrompt: string;
    images: string[];           // Base64 image data
    targetType: 'wan2.2' | 'qwen' | 'any';
    requiresVision: boolean;
    createdAt: string;
    updatedAt: string;
}

interface PromptLibraryState {
    templates: PromptTemplate[];
    selectedTemplateId: string | null;    // Currently editing template
    activeTemplateId: string | null;      // Template being used for generation
    searchFilter: string;
    isLoading: boolean;

    // Edit state
    editingTemplate: Partial<PromptTemplate> | null;
    isCreating: boolean;

    // Actions
    loadTemplates: () => Promise<void>;
    createTemplate: (template: Omit<PromptTemplate, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
    updateTemplate: (template: PromptTemplate) => Promise<void>;
    deleteTemplate: (id: string) => Promise<void>;
    setActiveTemplate: (id: string | null) => void;
    setSelectedTemplate: (id: string | null) => void;
    setSearchFilter: (filter: string) => void;
    getActiveSystemPrompt: () => string | null;
    getActiveImages: () => string[];
    getFilteredTemplates: () => PromptTemplate[];

    // Edit actions
    startCreating: () => void;
    startEditing: (template: PromptTemplate) => void;
    cancelEditing: () => void;
    setEditingField: <K extends keyof PromptTemplate>(field: K, value: PromptTemplate[K]) => void;
    saveEditing: () => Promise<void>;
    addImageToEditing: (base64: string) => void;
    removeImageFromEditing: (index: number) => void;
}

// --- Store ---
export const usePromptLibraryStore = create<PromptLibraryState>((set, get) => ({
    templates: [],
    selectedTemplateId: null,
    activeTemplateId: null,
    searchFilter: '',
    isLoading: false,
    editingTemplate: null,
    isCreating: false,

    loadTemplates: async () => {
        set({ isLoading: true });
        try {
            const rows = await window.ipcRenderer.getPromptLibrary();
            const templates: PromptTemplate[] = rows.map((row: any) => ({
                id: row.id,
                name: row.name,
                description: row.description || '',
                systemPrompt: row.system_prompt,
                images: row.images ? JSON.parse(row.images) : [],
                targetType: row.target_type || 'any',
                requiresVision: Boolean(row.requires_vision),
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            }));
            set({ templates, isLoading: false });
        } catch (error) {
            console.error('[PromptLibrary] Failed to load templates:', error);
            set({ isLoading: false });
        }
    },

    createTemplate: async (template) => {
        const newTemplate: PromptTemplate = {
            ...template,
            id: uuidv4(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        try {
            await window.ipcRenderer.addPromptLibrary(newTemplate);
            set(state => ({
                templates: [newTemplate, ...state.templates],
                editingTemplate: null,
                isCreating: false,
            }));
        } catch (error) {
            console.error('[PromptLibrary] Failed to create template:', error);
        }
    },

    updateTemplate: async (template) => {
        try {
            await window.ipcRenderer.updatePromptLibrary(template);
            set(state => ({
                templates: state.templates.map(t =>
                    t.id === template.id ? { ...template, updatedAt: new Date().toISOString() } : t
                ),
                editingTemplate: null,
                selectedTemplateId: null,
            }));
        } catch (error) {
            console.error('[PromptLibrary] Failed to update template:', error);
        }
    },

    deleteTemplate: async (id) => {
        try {
            await window.ipcRenderer.deletePromptLibrary(id);
            set(state => ({
                templates: state.templates.filter(t => t.id !== id),
                activeTemplateId: state.activeTemplateId === id ? null : state.activeTemplateId,
                selectedTemplateId: state.selectedTemplateId === id ? null : state.selectedTemplateId,
                editingTemplate: state.editingTemplate?.id === id ? null : state.editingTemplate,
            }));
        } catch (error) {
            console.error('[PromptLibrary] Failed to delete template:', error);
        }
    },

    setActiveTemplate: (id) => {
        set({ activeTemplateId: id });
    },

    setSelectedTemplate: (id) => {
        set({ selectedTemplateId: id });
    },

    setSearchFilter: (filter) => {
        set({ searchFilter: filter });
    },

    getActiveSystemPrompt: () => {
        const { templates, activeTemplateId } = get();
        if (!activeTemplateId) return null;
        const template = templates.find(t => t.id === activeTemplateId);
        return template?.systemPrompt || null;
    },

    getActiveImages: () => {
        const { templates, activeTemplateId } = get();
        if (!activeTemplateId) return [];
        const template = templates.find(t => t.id === activeTemplateId);
        return template?.images || [];
    },

    getFilteredTemplates: () => {
        const { templates, searchFilter } = get();
        if (!searchFilter.trim()) return templates;

        const lower = searchFilter.toLowerCase();
        return templates.filter(t =>
            t.name.toLowerCase().includes(lower) ||
            t.description.toLowerCase().includes(lower) ||
            t.systemPrompt.toLowerCase().includes(lower)
        );
    },

    // --- Edit Actions ---
    startCreating: () => {
        set({
            isCreating: true,
            selectedTemplateId: null,
            editingTemplate: {
                name: '',
                description: '',
                systemPrompt: '',
                images: [],
                targetType: 'any',
                requiresVision: false,
            }
        });
    },

    startEditing: (template) => {
        set({
            isCreating: false,
            selectedTemplateId: template.id,
            editingTemplate: { ...template }
        });
    },

    cancelEditing: () => {
        set({
            isCreating: false,
            selectedTemplateId: null,
            editingTemplate: null,
        });
    },

    setEditingField: (field, value) => {
        set(state => ({
            editingTemplate: state.editingTemplate
                ? { ...state.editingTemplate, [field]: value }
                : null
        }));
    },

    saveEditing: async () => {
        const { editingTemplate, isCreating, createTemplate, updateTemplate } = get();
        if (!editingTemplate) return;

        if (!editingTemplate.name?.trim() || !editingTemplate.systemPrompt?.trim()) {
            console.warn('[PromptLibrary] Name and system prompt are required');
            return;
        }

        if (isCreating) {
            await createTemplate({
                name: editingTemplate.name!,
                description: editingTemplate.description || '',
                systemPrompt: editingTemplate.systemPrompt!,
                images: editingTemplate.images || [],
                targetType: editingTemplate.targetType || 'any',
                requiresVision: editingTemplate.requiresVision || false,
            });
        } else {
            await updateTemplate(editingTemplate as PromptTemplate);
        }
    },

    addImageToEditing: (base64) => {
        set(state => ({
            editingTemplate: state.editingTemplate
                ? {
                    ...state.editingTemplate,
                    images: [...(state.editingTemplate.images || []), base64]
                }
                : null
        }));
    },

    removeImageFromEditing: (index) => {
        set(state => ({
            editingTemplate: state.editingTemplate
                ? {
                    ...state.editingTemplate,
                    images: (state.editingTemplate.images || []).filter((_, i) => i !== index)
                }
                : null
        }));
    },
}));

export default usePromptLibraryStore;
