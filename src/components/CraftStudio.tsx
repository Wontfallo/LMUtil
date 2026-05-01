import React, { useRef, useState, useEffect, useCallback } from 'react';
import Pica from 'pica';
import JSZip from 'jszip';
import {
    ImageIcon,
    Upload,
    Trash2,
    FlipHorizontal,
    FlipVertical,
    Crop,
    Check,
    X,
    Download,
    FolderArchive,
    Loader2
} from 'lucide-react';

interface SourceFile extends File {
    url: string;
}

interface ProcessedData {
    blob: Blob;
    name: string;
    url: string;
    sourceIndex: number;
}

interface CropRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

const OUTPUT_SIZES = [
    { value: '854x480', label: '854×480 (480p Wide)' },
    { value: '480x854', label: '480×854 (480p Tall)' },
    { value: '640x480', label: '640×480 (480p 4:3)' },
    { value: '480x640', label: '480×640 (480p 3:4)' },
    { value: '720x480', label: '720×480 (480p DVD)' },
    { value: '480x720', label: '480×720 (480p DVD Tall)' },
    { value: '512x512', label: '512×512' },
    { value: '768x768', label: '768×768' },
    { value: '1024x1024', label: '1024×1024' },
    { value: '1280x720', label: '1280×720 (720p)' },
    { value: '720x1280', label: '720×1280 (720p Tall)' },
    { value: '1920x1080', label: '1920×1080 (1080p)' },
    { value: '1080x1920', label: '1080×1920 (1080p Tall)' },
];

const SIZING_METHODS = [
    { value: 'pad-color', label: 'Pad with Color' },
    { value: 'pad-pixelate', label: 'Pad with Pixelation' },
    { value: 'pad-mirror', label: 'Pad with Mirror' },
    { value: 'crop', label: 'Crop to Fit' },
];

const CraftStudio: React.FC = () => {
    const pica = useRef<ReturnType<typeof Pica> | null>(null);

    // File state
    const [sourceFiles, setSourceFiles] = useState<SourceFile[]>([]);
    const [processedData, setProcessedData] = useState<ProcessedData[]>([]);
    const [currentPreviewIndex, setCurrentPreviewIndex] = useState(0);

    // Settings state
    const [outputSize, setOutputSize] = useState('854x480');
    const [sizingMethod, setSizingMethod] = useState('pad-color');
    const [padColor, setPadColor] = useState('#000000');

    // UI state
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [statusText, setStatusText] = useState('Ready. Add files to begin.');
    const [isDragging, setIsDragging] = useState(false);
    const dragCounter = useRef(0);

    // Canvas state
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [previewImage, setPreviewImage] = useState<HTMLImageElement | null>(null);
    const [isCropping, setIsCropping] = useState(false);
    const [isDrawing, setIsDrawing] = useState(false);
    const [cropRect, setCropRect] = useState<CropRect>({ x: 0, y: 0, w: 0, h: 0 });

    // File input ref
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Initialize pica
    useEffect(() => {
        pica.current = new Pica();
    }, []);

    // Cleanup URLs on unmount
    useEffect(() => {
        return () => {
            sourceFiles.forEach(file => URL.revokeObjectURL(file.url));
            processedData.forEach(data => URL.revokeObjectURL(data.url));
        };
    }, []);

    // Draw preview on canvas
    const drawPreview = useCallback(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx || !previewImage) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(previewImage, 0, 0, canvas.width, canvas.height);
    }, [previewImage]);

    useEffect(() => {
        if (previewImage) {
            const canvas = canvasRef.current;
            if (canvas) {
                canvas.width = previewImage.width;
                canvas.height = previewImage.height;
                drawPreview();
            }
        }
    }, [previewImage, drawPreview]);

    // Display source image
    const displaySourceImage = useCallback((file: SourceFile) => {
        const img = new Image();
        img.onload = () => {
            setPreviewImage(img);
        };
        img.src = file.url;
    }, []);

    // Handle files (from input or drag/drop)
    const handleFiles = useCallback((files: FileList | File[]) => {
        const imageFiles = Array.from(files).filter(file =>
            file.type.startsWith('image/')
        );

        if (imageFiles.length === 0) {
            setStatusText('No valid image files selected.');
            return;
        }

        const newFiles: SourceFile[] = imageFiles.map(file => {
            const newFile = new File([file], file.name, { type: file.type, lastModified: file.lastModified }) as SourceFile;
            newFile.url = URL.createObjectURL(newFile);
            return newFile;
        });

        setSourceFiles(prev => {
            const updated = [...prev, ...newFiles];
            setStatusText(`${updated.length} image(s) loaded.`);
            return updated;
        });

        // Display first new file if no preview yet
        if (sourceFiles.length === 0 && newFiles.length > 0) {
            displaySourceImage(newFiles[0]);
            setCurrentPreviewIndex(0);
        }
    }, [sourceFiles.length, displaySourceImage]);

    // Drag and drop handlers
    const handleDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        dragCounter.current++;
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        dragCounter.current--;
        if (dragCounter.current === 0) {
            setIsDragging(false);
        }
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        dragCounter.current = 0;
        setIsDragging(false);

        const files = Array.from(e.dataTransfer.files).filter(file =>
            file.type.startsWith('image/')
        );
        if (files.length > 0) {
            handleFiles(files);
        }
    }, [handleFiles]);

    // Clear all
    const clearAll = useCallback(() => {
        sourceFiles.forEach(file => URL.revokeObjectURL(file.url));
        processedData.forEach(data => URL.revokeObjectURL(data.url));

        setSourceFiles([]);
        setProcessedData([]);
        setCurrentPreviewIndex(0);
        setPreviewImage(null);
        setStatusText('Ready. Add files to begin.');
        setIsCropping(false);
    }, [sourceFiles, processedData]);

    // Flip dimensions
    const flipDimensions = useCallback(() => {
        const [w, h] = outputSize.split('x');
        setOutputSize(`${h}x${w}`);
    }, [outputSize]);

    // Flip image
    const flipImage = useCallback((direction: 'horizontal' | 'vertical') => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx || !previewImage) return;

        const temp = document.createElement('canvas');
        temp.width = canvas.width;
        temp.height = canvas.height;
        const tctx = temp.getContext('2d')!;

        tctx.save();
        if (direction === 'horizontal') {
            tctx.scale(-1, 1);
            tctx.drawImage(previewImage, -temp.width, 0, temp.width, temp.height);
        } else {
            tctx.scale(1, -1);
            tctx.drawImage(previewImage, 0, -temp.height, temp.width, temp.height);
        }
        tctx.restore();

        const newImg = new Image();
        newImg.onload = () => setPreviewImage(newImg);
        newImg.src = temp.toDataURL('image/png');
    }, [previewImage]);

    // Crop mode
    const toggleCropMode = useCallback(() => {
        if (isCropping) {
            // Cancel crop - revert to original
            if (sourceFiles[currentPreviewIndex]) {
                displaySourceImage(sourceFiles[currentPreviewIndex]);
            }
            setIsCropping(false);
            setCropRect({ x: 0, y: 0, w: 0, h: 0 });
        } else {
            setIsCropping(true);
        }
    }, [isCropping, sourceFiles, currentPreviewIndex, displaySourceImage]);

    // Get mouse position on canvas
    const getMousePos = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }, []);

    // Canvas mouse handlers for cropping
    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!isCropping) return;
        setIsDrawing(true);
        const pos = getMousePos(e);
        setCropRect({ x: pos.x, y: pos.y, w: 0, h: 0 });
    }, [isCropping, getMousePos]);

    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!isCropping || !isDrawing) return;
        const pos = getMousePos(e);
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');

        setCropRect(prev => {
            const newRect = { ...prev, w: pos.x - prev.x, h: pos.y - prev.y };

            // Redraw with selection
            if (ctx && previewImage && canvas) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(previewImage, 0, 0, canvas.width, canvas.height);
                ctx.strokeStyle = '#f59e0b';
                ctx.lineWidth = 2;
                ctx.setLineDash([6, 4]);
                ctx.strokeRect(prev.x, prev.y, newRect.w, newRect.h);
                ctx.setLineDash([]);
            }

            return newRect;
        });
    }, [isCropping, isDrawing, getMousePos, previewImage]);

    const handleMouseUp = useCallback(() => {
        if (!isCropping || !isDrawing) return;
        setIsDrawing(false);
    }, [isCropping, isDrawing]);

    // Apply crop
    const applyCrop = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas || Math.abs(cropRect.w) < 2 || Math.abs(cropRect.h) < 2) {
            setIsCropping(false);
            setCropRect({ x: 0, y: 0, w: 0, h: 0 });
            drawPreview();
            return;
        }

        let { x, y, w, h } = cropRect;
        if (w < 0) { x += w; w = Math.abs(w); }
        if (h < 0) { y += h; h = Math.abs(h); }

        const temp = document.createElement('canvas');
        temp.width = w;
        temp.height = h;
        const tctx = temp.getContext('2d')!;
        tctx.drawImage(canvas, x, y, w, h, 0, 0, w, h);

        temp.toBlob((blob) => {
            if (!blob) return;
            const currentFile = sourceFiles[currentPreviewIndex];
            const newFile = new File([blob], currentFile.name, { type: 'image/png', lastModified: Date.now() }) as SourceFile;

            URL.revokeObjectURL(currentFile.url);
            newFile.url = URL.createObjectURL(newFile);

            setSourceFiles(prev => {
                const updated = [...prev];
                updated[currentPreviewIndex] = newFile;
                return updated;
            });

            displaySourceImage(newFile);
        }, 'image/png');

        setIsCropping(false);
        setCropRect({ x: 0, y: 0, w: 0, h: 0 });
    }, [cropRect, sourceFiles, currentPreviewIndex, displaySourceImage, drawPreview]);

    // Create padded or cropped canvas
    const createPaddedOrCroppedCanvas = useCallback(async (
        img: HTMLImageElement,
        targetWidth: number,
        targetHeight: number,
        method: string,
        color: string
    ): Promise<HTMLCanvasElement> => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        const targetRatio = targetWidth / targetHeight;
        const imgRatio = img.width / img.height;

        if (method === 'crop') {
            let drawWidth, drawHeight, offsetX, offsetY;
            if (imgRatio > targetRatio) {
                drawHeight = targetHeight;
                drawWidth = drawHeight * imgRatio;
                offsetX = (targetWidth - drawWidth) / 2;
                offsetY = 0;
            } else {
                drawWidth = targetWidth;
                drawHeight = drawWidth / imgRatio;
                offsetX = 0;
                offsetY = (targetHeight - drawHeight) / 2;
            }
            ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
        } else {
            let drawWidth, drawHeight, offsetX, offsetY;
            if (imgRatio > targetRatio) {
                drawWidth = targetWidth;
                drawHeight = drawWidth / imgRatio;
                offsetX = 0;
                offsetY = (targetHeight - drawHeight) / 2;
            } else {
                drawHeight = targetHeight;
                drawWidth = drawHeight * imgRatio;
                offsetX = (targetWidth - drawWidth) / 2;
                offsetY = 0;
            }

            if (method === 'pad-color') {
                ctx.fillStyle = color;
                ctx.fillRect(0, 0, targetWidth, targetHeight);
            } else if (method === 'pad-pixelate') {
                const pixelCanvas = document.createElement('canvas');
                pixelCanvas.width = 32;
                pixelCanvas.height = 32;
                pixelCanvas.getContext('2d')!.drawImage(img, 0, 0, 32, 32);
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(pixelCanvas, 0, 0, targetWidth, targetHeight);
                ctx.imageSmoothingEnabled = true;
            } else if (method === 'pad-mirror') {
                ctx.save();
                ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
                ctx.filter = 'blur(20px)';
                ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
                ctx.filter = 'none';
                ctx.restore();
            }

            ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
        }

        return canvas;
    }, []);

    // Process single image
    const processImage = useCallback(async (file: SourceFile): Promise<Blob> => {
        const [targetWidth, targetHeight] = outputSize.split('x').map(Number);

        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = async () => {
                try {
                    const canvas = await createPaddedOrCroppedCanvas(img, targetWidth, targetHeight, sizingMethod, padColor);
                    const finalCanvas = document.createElement('canvas');
                    finalCanvas.width = targetWidth;
                    finalCanvas.height = targetHeight;

                    if (pica.current) {
                        await pica.current.resize(canvas, finalCanvas, { quality: 3 });
                    } else {
                        const ctx = finalCanvas.getContext('2d')!;
                        ctx.drawImage(canvas, 0, 0);
                    }

                    finalCanvas.toBlob((blob) => {
                        if (blob) resolve(blob);
                        else reject(new Error('Failed to create blob'));
                    }, 'image/png');
                } catch (error) {
                    reject(error);
                }
            };
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = file.url;
        });
    }, [outputSize, sizingMethod, padColor, createPaddedOrCroppedCanvas]);

    // Process all images
    const processAndPreviewAll = useCallback(async () => {
        if (sourceFiles.length === 0) return;

        setIsProcessing(true);
        setProgress(0);
        setStatusText('Processing images...');

        // Cleanup old processed data
        processedData.forEach(data => URL.revokeObjectURL(data.url));
        const newProcessedData: ProcessedData[] = [];

        try {
            for (let i = 0; i < sourceFiles.length; i++) {
                setStatusText(`Processing ${i + 1}/${sourceFiles.length}...`);
                const blob = await processImage(sourceFiles[i]);
                const url = URL.createObjectURL(blob);
                newProcessedData.push({
                    blob,
                    name: sourceFiles[i].name.replace(/\.[^.]+$/, '.png'),
                    url,
                    sourceIndex: i
                });
                setProgress(((i + 1) / sourceFiles.length) * 100);
            }

            setProcessedData(newProcessedData);

            // Display first processed image
            if (newProcessedData.length > 0) {
                const img = new Image();
                img.onload = () => setPreviewImage(img);
                img.src = newProcessedData[0].url;
                setCurrentPreviewIndex(0);
            }

            setStatusText(`Processing complete. ${newProcessedData.length} images ready.`);
        } catch (error) {
            setStatusText(`Error processing images: ${error}`);
        } finally {
            setIsProcessing(false);
            setProgress(0);
        }
    }, [sourceFiles, processedData, processImage]);

    // Display processed image
    const displayProcessedImage = useCallback((index: number) => {
        if (index < 0 || index >= processedData.length) return;
        setCurrentPreviewIndex(index);
        const img = new Image();
        img.onload = () => setPreviewImage(img);
        img.src = processedData[index].url;
    }, [processedData]);

    // Download single image
    const downloadCurrent = useCallback(() => {
        if (processedData.length > 0 && processedData[currentPreviewIndex]) {
            const data = processedData[currentPreviewIndex];
            const a = document.createElement('a');
            a.href = data.url;
            a.download = data.name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } else if (sourceFiles.length > 0 && sourceFiles[currentPreviewIndex]) {
            const file = sourceFiles[currentPreviewIndex];
            const a = document.createElement('a');
            a.href = file.url;
            a.download = file.name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }
    }, [processedData, sourceFiles, currentPreviewIndex]);

    // Download all as ZIP
    const downloadZip = useCallback(async () => {
        if (processedData.length === 0) return;

        setStatusText('Creating ZIP file...');
        const zip = new JSZip();

        processedData.forEach(data => {
            zip.file(data.name, data.blob);
        });

        try {
            const content = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(content);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'processed_images.zip';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            setStatusText('ZIP download complete.');
        } catch (error) {
            setStatusText(`Error creating ZIP: ${error}`);
        }
    }, [processedData]);

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'SELECT') return;

            const items = processedData.length > 0 ? processedData : sourceFiles;
            if (items.length > 0) {
                if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    const newIndex = currentPreviewIndex > 0 ? currentPreviewIndex - 1 : items.length - 1;
                    if (processedData.length > 0) {
                        displayProcessedImage(newIndex);
                    } else {
                        setCurrentPreviewIndex(newIndex);
                        displaySourceImage(sourceFiles[newIndex]);
                    }
                } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    const newIndex = currentPreviewIndex < items.length - 1 ? currentPreviewIndex + 1 : 0;
                    if (processedData.length > 0) {
                        displayProcessedImage(newIndex);
                    } else {
                        setCurrentPreviewIndex(newIndex);
                        displaySourceImage(sourceFiles[newIndex]);
                    }
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [processedData, sourceFiles, currentPreviewIndex, displayProcessedImage, displaySourceImage]);

    // Get flipped dimensions label
    const getFlippedDimensions = () => {
        const [w, h] = outputSize.split('x');
        return `${h}×${w}`;
    };

    const hasFiles = sourceFiles.length > 0;
    const hasProcessed = processedData.length > 0;

    return (
        <div
            className="craft-studio"
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            {/* Drag Overlay */}
            {isDragging && (
                <div className="craft-drag-overlay">
                    <div className="drag-overlay-content">
                        <Upload size={48} />
                        <span>Drop images here</span>
                    </div>
                </div>
            )}

            {/* Header */}
            <header className="craft-header">
                <div className="craft-header-left">
                    <ImageIcon size={24} className="craft-header-icon" />
                    <h1>Craft Studio</h1>
                </div>
            </header>

            {/* Controls Bar */}
            <div className="craft-controls">
                <div className="craft-control-group">
                    <button
                        className="craft-btn primary"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <Upload size={16} />
                        Add Files
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={(e) => e.target.files && handleFiles(e.target.files)}
                    />
                    <button
                        className="craft-btn secondary"
                        onClick={clearAll}
                        disabled={!hasFiles}
                    >
                        <Trash2 size={16} />
                        Clear All
                    </button>
                </div>

                <div className="craft-control-group">
                    <button
                        className="craft-btn icon"
                        onClick={() => flipImage('horizontal')}
                        disabled={!hasFiles}
                        title="Flip Horizontal"
                    >
                        <FlipHorizontal size={16} />
                    </button>
                    <button
                        className="craft-btn icon"
                        onClick={() => flipImage('vertical')}
                        disabled={!hasFiles}
                        title="Flip Vertical"
                    >
                        <FlipVertical size={16} />
                    </button>
                    {isCropping ? (
                        <>
                            <button
                                className="craft-btn success"
                                onClick={applyCrop}
                            >
                                <Check size={16} />
                                Apply Crop
                            </button>
                            <button
                                className="craft-btn danger"
                                onClick={toggleCropMode}
                            >
                                <X size={16} />
                                Cancel
                            </button>
                        </>
                    ) : (
                        <button
                            className="craft-btn secondary"
                            onClick={toggleCropMode}
                            disabled={!hasFiles}
                        >
                            <Crop size={16} />
                            Crop
                        </button>
                    )}
                </div>

                <div className="craft-control-group">
                    <label>Output Size:</label>
                    <select
                        value={outputSize}
                        onChange={(e) => setOutputSize(e.target.value)}
                        className="craft-select"
                    >
                        {OUTPUT_SIZES.map(size => (
                            <option key={size.value} value={size.value}>{size.label}</option>
                        ))}
                    </select>
                    <button
                        className="craft-btn icon"
                        onClick={flipDimensions}
                        title={`Flip to ${getFlippedDimensions()}`}
                    >
                        ⇄
                    </button>
                </div>

                <div className="craft-control-group">
                    <label>Sizing Method:</label>
                    <select
                        value={sizingMethod}
                        onChange={(e) => setSizingMethod(e.target.value)}
                        className="craft-select"
                    >
                        {SIZING_METHODS.map(method => (
                            <option key={method.value} value={method.value}>{method.label}</option>
                        ))}
                    </select>
                    {sizingMethod === 'pad-color' && (
                        <input
                            type="color"
                            value={padColor}
                            onChange={(e) => setPadColor(e.target.value)}
                            className="craft-color-input"
                            title="Padding color"
                        />
                    )}
                </div>

                <div className="craft-control-group">
                    <button
                        className="craft-btn primary"
                        onClick={processAndPreviewAll}
                        disabled={!hasFiles || isProcessing}
                    >
                        {isProcessing ? <Loader2 size={16} className="spinning" /> : <ImageIcon size={16} />}
                        Process & Preview
                    </button>
                    <button
                        className="craft-btn success"
                        onClick={downloadZip}
                        disabled={!hasProcessed}
                    >
                        <FolderArchive size={16} />
                        Download .zip
                    </button>
                </div>
            </div>

            {/* Main Preview Area */}
            <div className="craft-main-preview">
                {!hasFiles ? (
                    <div className="craft-placeholder">
                        <Upload size={48} />
                        <span>Drag & Drop Images Here</span>
                        <span className="craft-hint">or use the Add Files button</span>
                    </div>
                ) : (
                    <>
                        <canvas
                            ref={canvasRef}
                            className={`craft-canvas ${isCropping ? 'cropping' : ''}`}
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            onMouseLeave={handleMouseUp}
                        />
                        {(hasFiles || hasProcessed) && (
                            <button
                                className="craft-download-btn"
                                onClick={downloadCurrent}
                            >
                                <Download size={14} />
                                Download
                            </button>
                        )}
                    </>
                )}
            </div>

            {/* Thumbnail Strip */}
            {hasFiles && (
                <div className="craft-thumbnail-strip">
                    <div className="craft-thumbnail-container">
                        {(hasProcessed ? processedData : sourceFiles).map((item, index) => (
                            <img
                                key={index}
                                src={'url' in item ? item.url : (item as SourceFile).url}
                                className={`craft-thumbnail ${index === currentPreviewIndex ? 'active' : ''}`}
                                onClick={() => {
                                    setCurrentPreviewIndex(index);
                                    if (hasProcessed) {
                                        displayProcessedImage(index);
                                    } else {
                                        displaySourceImage(item as SourceFile);
                                    }
                                }}
                                alt={`Thumbnail ${index + 1}`}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* Bottom Status Bar */}
            <div className="craft-status-bar">
                <span className="craft-status-text">{statusText}</span>
                <div className="craft-progress-bar">
                    <div
                        className="craft-progress-fill"
                        style={{ width: `${progress}%` }}
                    />
                </div>
            </div>
        </div>
    );
};

export default CraftStudio;
