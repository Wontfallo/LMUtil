import React, { useEffect, useState, useRef } from 'react';
import {
    Plus,
    Search,
    X,
    Trash2,
    Save,
    Eye,
    EyeOff,
    Video,
    Image,
    ImagePlus,
    Check,
    Radio,
    Settings2,
    FileText,
    ChevronDown,
    ChevronUp
} from 'lucide-react';
import { usePromptLibraryStore, PromptTemplate } from '../store/promptLibraryStore';

const PromptLibrary: React.FC = () => {
    const {
        templates,
        activeTemplateId,
        searchFilter,
        isLoading,
        editingTemplate,
        isCreating,
        loadTemplates,
        deleteTemplate,
        setActiveTemplate,
        setSearchFilter,
        getFilteredTemplates,
        startCreating,
        startEditing,
        cancelEditing,
        setEditingField,
        saveEditing,
        addImageToEditing,
        removeImageFromEditing,
    } = usePromptLibraryStore();

    // Resize state removed - handled by Sidebar
    const [expandedEditor, setExpandedEditor] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Load templates on mount
    useEffect(() => {
        loadTemplates();
    }, []);

    const handleImageUpload = async () => {
        const result = await window.ipcRenderer.openDialog({
            title: 'Select Image',
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
            properties: ['openFile', 'multiSelections']
        });

        if (result && result.length > 0) {
            for (const filePath of result) {
                const base64 = await window.ipcRenderer.readFileAsBase64(filePath);
                addImageToEditing(base64);
            }
        }
    };

    const handleDeleteTemplate = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (confirm('Delete this prompt template?')) {
            await deleteTemplate(id);
        }
    };

    const filteredTemplates = getFilteredTemplates();

    const getTargetIcon = (type: string) => {
        switch (type) {
            case 'wan2.2': return <Video size={12} />;
            case 'qwen': return <Image size={12} />;
            default: return <Settings2 size={12} />;
        }
    };

    return (
        <div className="prompt-library sidebar-panel">
            {/* Header */}
            <div className="library-header">
                <h3>
                    <FileText size={16} />
                    Prompt Library
                </h3>
                <button
                    className="library-new-btn"
                    onClick={startCreating}
                    title="Create new template"
                >
                    <Plus size={16} />
                </button>
            </div>

            {/* Search */}
            <div className="library-search">
                <Search size={14} />
                <input
                    type="text"
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    placeholder="Search templates..."
                />
                {searchFilter && (
                    <button onClick={() => setSearchFilter('')}>
                        <X size={14} />
                    </button>
                )}
            </div>

            {/* Editor Panel (when creating/editing) */}
            {editingTemplate && (
                <div className={`library-editor ${expandedEditor ? 'expanded' : ''}`}>
                    <div className="editor-header">
                        <h4>{isCreating ? 'New Template' : 'Edit Template'}</h4>
                        <button
                            className="editor-expand-btn"
                            onClick={() => setExpandedEditor(!expandedEditor)}
                            title={expandedEditor ? 'Collapse' : 'Expand'}
                        >
                            {expandedEditor ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                    </div>

                    <div className="editor-field">
                        <label>Name</label>
                        <input
                            type="text"
                            value={editingTemplate.name || ''}
                            onChange={(e) => setEditingField('name', e.target.value)}
                            placeholder="Template name..."
                        />
                    </div>

                    <div className="editor-field">
                        <label>Description</label>
                        <input
                            type="text"
                            value={editingTemplate.description || ''}
                            onChange={(e) => setEditingField('description', e.target.value)}
                            placeholder="Short description..."
                        />
                    </div>

                    <div className="editor-field">
                        <label>Target</label>
                        <div className="editor-target-toggle">
                            {(['any', 'wan2.2', 'qwen'] as const).map(type => (
                                <button
                                    key={type}
                                    className={`target-option ${editingTemplate.targetType === type ? 'active' : ''}`}
                                    onClick={() => setEditingField('targetType', type)}
                                >
                                    {getTargetIcon(type)}
                                    {type === 'any' ? 'Any' : type}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="editor-field">
                        <label>System Prompt</label>
                        <textarea
                            value={editingTemplate.systemPrompt || ''}
                            onChange={(e) => setEditingField('systemPrompt', e.target.value)}
                            placeholder="Enter your custom system prompt..."
                            rows={expandedEditor ? 12 : 5}
                        />
                    </div>

                    {/* Vision / Images */}
                    <div className="editor-field">
                        <div className="editor-vision-header">
                            <label>
                                <input
                                    type="checkbox"
                                    checked={editingTemplate.requiresVision || false}
                                    onChange={(e) => setEditingField('requiresVision', e.target.checked)}
                                />
                                Requires Vision Model
                            </label>
                            <button
                                className="editor-add-image-btn"
                                onClick={handleImageUpload}
                                title="Add images"
                            >
                                <ImagePlus size={14} />
                            </button>
                        </div>

                        {editingTemplate.images && editingTemplate.images.length > 0 && (
                            <div className="editor-images">
                                {editingTemplate.images.map((img, idx) => (
                                    <div key={idx} className="editor-image-thumb">
                                        <img src={img} alt={`Image ${idx + 1}`} />
                                        <button onClick={() => removeImageFromEditing(idx)}>
                                            <X size={12} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Actions */}
                    <div className="editor-actions">
                        <button className="editor-cancel-btn" onClick={cancelEditing}>
                            Cancel
                        </button>
                        <button
                            className="editor-save-btn"
                            onClick={saveEditing}
                            disabled={!editingTemplate.name?.trim() || !editingTemplate.systemPrompt?.trim()}
                        >
                            <Save size={14} />
                            Save
                        </button>
                    </div>
                </div>
            )}

            {/* Template List */}
            <div className="library-list">
                {isLoading ? (
                    <div className="library-loading">Loading...</div>
                ) : filteredTemplates.length === 0 ? (
                    <div className="library-empty">
                        {searchFilter ? 'No matching templates' : 'No templates yet'}
                    </div>
                ) : (
                    filteredTemplates.map((template) => (
                        <div
                            key={template.id}
                            className={`library-template-card ${activeTemplateId === template.id ? 'active' : ''}`}
                            onClick={() => startEditing(template)}
                        >
                            <div className="template-card-header">
                                <button
                                    className={`template-activate-btn ${activeTemplateId === template.id ? 'active' : ''}`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setActiveTemplate(activeTemplateId === template.id ? null : template.id);
                                    }}
                                    title={activeTemplateId === template.id ? 'Deactivate' : 'Use this template'}
                                >
                                    {activeTemplateId === template.id ? <Check size={12} /> : <Radio size={12} />}
                                </button>
                                <span className="template-name">{template.name}</span>
                                <button
                                    className="template-delete-btn"
                                    onClick={(e) => handleDeleteTemplate(e, template.id)}
                                    title="Delete template"
                                >
                                    <Trash2 size={12} />
                                </button>
                            </div>
                            {template.description && (
                                <div className="template-description">{template.description}</div>
                            )}
                            <div className="template-tags">
                                <span className={`tag target ${template.targetType}`}>
                                    {getTargetIcon(template.targetType)}
                                    {template.targetType}
                                </span>
                                {template.requiresVision && (
                                    <span className="tag vision">
                                        <Eye size={10} />
                                        Vision
                                    </span>
                                )}
                                {template.images && template.images.length > 0 && (
                                    <span className="tag images">
                                        <Image size={10} />
                                        {template.images.length}
                                    </span>
                                )}
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Active Template Indicator */}
            {activeTemplateId && (
                <div className="library-active-indicator">
                    <Check size={12} />
                    Using: {templates.find(t => t.id === activeTemplateId)?.name}
                </div>
            )}
        </div>
    );
};

export default PromptLibrary;
