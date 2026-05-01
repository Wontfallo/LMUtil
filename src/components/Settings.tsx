import React, { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '../store/appStore.ts';
import { useTTSStore } from '../store/ttsStore.ts';
import { X, Sliders, Volume2, Globe, Filter } from 'lucide-react';

interface SettingsProps {
    onClose: () => void;
}

// Settings modal now handles ONLY global settings
// Per-chat settings (userName, aiName, avatars, systemPrompt) are in RightPanel

const Settings: React.FC<SettingsProps> = ({ onClose }) => {
    const { provider, setProvider, model, setModel } = useAppStore();
    const { isEnabled, setEnabled, voices, selectedVoice, setVoice, rate, setRate, pitch, setPitch, loadVoices } = useTTSStore();
    const [models, setModels] = useState<any[]>([]);

    // Voice filter state
    const [languageFilter, setLanguageFilter] = useState('');
    const [genderFilter, setGenderFilter] = useState('');
    const [regionFilter, setRegionFilter] = useState('');

    // Extract unique values from voices
    const { languages, genders, regions } = useMemo(() => {
        const langs = new Set<string>();
        const gends = new Set<string>();
        const regs = new Set<string>();

        voices.forEach(v => {
            const [lang, region] = (v.Locale || '').split('-');
            if (lang) langs.add(lang.toLowerCase());
            if (region) regs.add(region.toUpperCase());
            if (v.Gender) gends.add(v.Gender);
        });

        return {
            languages: Array.from(langs).sort(),
            genders: Array.from(gends).sort(),
            regions: Array.from(regs).sort()
        };
    }, [voices]);

    // Filter voices based on selections
    const filteredVoices = useMemo(() => {
        return voices.filter(v => {
            const [lang, region] = (v.Locale || '').split('-');

            if (languageFilter && lang?.toLowerCase() !== languageFilter) return false;
            if (genderFilter && v.Gender !== genderFilter) return false;
            if (regionFilter && region?.toUpperCase() !== regionFilter) return false;

            return true;
        });
    }, [voices, languageFilter, genderFilter, regionFilter]);

    useEffect(() => {
        const fetchModels = async () => {
            const list = await window.ipcRenderer.listModels();
            setModels(list);
        };
        fetchModels();
        loadVoices();
    }, [provider]);

    return (
        <div className="settings-overlay">
            <div className="settings-modal">
                <div className="settings-header">
                    <div className="title-area">
                        <Sliders size={20} />
                        <h3>Global Settings</h3>
                    </div>
                    <button className="close-btn" onClick={onClose}><X size={20} /></button>
                </div>

                <div className="settings-body">
                    <p className="settings-info" style={{ padding: '1rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                        Per-chat settings (AI name, avatar, system prompt, model parameters) are now managed in the right panel for each conversation.
                    </p>

                    <section className="settings-section">
                        <h4><Globe size={16} /> Provider</h4>
                        <div className="setting-group">
                            <label>LLM Provider</label>
                            <select value={provider} onChange={(e) => setProvider(e.target.value as any)}>
                                <option value="ollama">Ollama</option>
                                <option value="lmstudio">LM Studio</option>
                            </select>
                        </div>
                        <div className="setting-group">
                            <label>Default Model</label>
                            <select value={model} onChange={(e) => setModel(e.target.value)}>
                                {models.map(m => (
                                    <option key={m.id} value={m.id}>{m.name}</option>
                                ))}
                            </select>
                        </div>
                    </section>

                    <section className="settings-section">
                        <h4><Volume2 size={16} /> Default TTS Voice</h4>
                        <div className="setting-group toggle">
                            <label>Enable TTS</label>
                            <input
                                type="checkbox"
                                checked={isEnabled}
                                onChange={(e) => setEnabled(e.target.checked)}
                            />
                        </div>
                        <div className="setting-group">
                            <label><Filter size={14} /> Filters</label>
                            <div className="filter-row">
                                <select value={languageFilter} onChange={(e) => setLanguageFilter(e.target.value)}>
                                    <option value="">All Languages</option>
                                    {languages.map(l => <option key={l} value={l}>{l.toUpperCase()}</option>)}
                                </select>
                                <select value={genderFilter} onChange={(e) => setGenderFilter(e.target.value)}>
                                    <option value="">All Genders</option>
                                    {genders.map(g => <option key={g} value={g}>{g}</option>)}
                                </select>
                                <select value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)}>
                                    <option value="">All Regions</option>
                                    {regions.map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="setting-group">
                            <label>Default Voice</label>
                            <select value={selectedVoice} onChange={(e) => setVoice(e.target.value)}>
                                {filteredVoices.map(v => (
                                    <option key={v.ShortName} value={v.ShortName}>{v.FriendlyName}</option>
                                ))}
                            </select>
                        </div>
                        <div className="setting-group">
                            <label>Rate: {rate}</label>
                            <input
                                type="range"
                                min="-50"
                                max="+200"
                                value={parseInt(rate)}
                                onChange={(e) => setRate(`${e.target.value}%`)}
                            />
                        </div>
                        <div className="setting-group">
                            <label>Pitch: {pitch}</label>
                            <input
                                type="range"
                                min="-50"
                                max="+50"
                                value={parseInt(pitch)}
                                onChange={(e) => setPitch(`${e.target.value}Hz`)}
                            />
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
};

export default Settings;

