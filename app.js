if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(console.error);
    });
}

// UI Elements
const folderBtn = document.getElementById('folder-btn');
const exportCsvBtn = document.getElementById('export-csv-btn');
const exportM3u8Btn = document.getElementById('export-m3u8-btn');
const resultsBody = document.getElementById('results-body');
const tracksTable = document.getElementById('tracks-table');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const notationSelect = document.getElementById('notation-select');
const optFilename = document.getElementById('opt-filename');
const optTitle = document.getElementById('opt-title');
const optTags = document.getElementById('opt-tags');

// Player Elements
const playerDeck = document.getElementById('player-deck');
const playPauseBtn = document.getElementById('play-pause-btn');
const iconPlay = document.getElementById('icon-play');
const iconPause = document.getElementById('icon-pause');
const playerTrackName = document.getElementById('player-track-name');
const playerBpm = document.getElementById('player-bpm');
const playerKey = document.getElementById('player-key');
const playerGenre = document.getElementById('player-genre');

// State Management
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
const poolSize = Math.min(navigator.hardwareConcurrency || 2, 4);
const workers = [];
const workerCallbacks = {};
for (let i = 0; i < poolSize; i++) {
    const worker = new Worker('worker.js');
    worker.onmessage = (e) => {
        const { taskId, bpm, camelotCode, success, error } = e.data;
        if (workerCallbacks[taskId]) {
            workerCallbacks[taskId]({ bpm, camelotCode, success, error });
            delete workerCallbacks[taskId];
        }
    };
    workers.push(worker);
}
const fileRegistry = {}; 
let exportData = []; // Stores processed track metadata for export
let currentObjectUrl = null;
let isAnalyzing = false;

let wavesurfer = null;
document.addEventListener('DOMContentLoaded', () => {
    wavesurfer = WaveSurfer.create({
        container: '#waveform-container',
        waveColor: '#3d3d5c',
        progressColor: '#00e5ff',
        cursorColor: '#ffffff',
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        height: 50,
        normalize: true,
    });

    wavesurfer.on('play', () => {
        iconPlay.style.display = 'none';
        iconPause.style.display = 'block';
    });

    wavesurfer.on('pause', () => {
        iconPlay.style.display = 'block';
        iconPause.style.display = 'none';
    });

    playPauseBtn.addEventListener('click', () => {
        wavesurfer.playPause();
    });

    // Spacebar Play/Pause Hotkey
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space') {
            const active = document.activeElement;
            if (active && (active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA')) {
                return;
            }
            if (wavesurfer && playerDeck.classList.contains('visible')) {
                e.preventDefault();
                wavesurfer.playPause();
            }
        }
    });

    renderCamelotWheel();
    setupSorting();
    setupSidebarFilterListeners();
});

function analyseInWorker(channelData, sampleRate, workerIndex) {
    return new Promise((resolve) => {
        const taskId = `task-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
        workerCallbacks[taskId] = resolve;
        workers[workerIndex].postMessage({ taskId, channelData, sampleRate });
    });
}

function formatKey(camelotCode, keyText, format) {
    return format === 'camelot' ? camelotCode : keyText;
}

function getCompatibleKeys(camelotCode) {
    if (!camelotCode || camelotCode === "Unknown") return [];
    const match = camelotCode.match(/^(\d+)([AB])$/);
    if (!match) return [];
    
    const hour = parseInt(match[1], 10);
    const letter = match[2];
    
    const exactHour = hour;
    const hourMinus = hour === 1 ? 12 : hour - 1;
    const hourPlus = hour === 12 ? 1 : hour + 1;
    const oppositeLetter = letter === 'A' ? 'B' : 'A';
    
    return [
        `${exactHour}${letter}`,
        `${hourMinus}${letter}`,
        `${hourPlus}${letter}`,
        `${exactHour}${oppositeLetter}`
    ];
}

// Recursive function to deeply scan folders for MP3s
async function getAudioFilesRecursively(dirHandle) {
    let files = [];
    for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.mp3')) {
            files.push(entry);
        } else if (entry.kind === 'directory' && entry.name !== 'Processed_Tracks') {
            const subDirHandle = await dirHandle.getDirectoryHandle(entry.name);
            const nestedFiles = await getAudioFilesRecursively(subDirHandle);
            files = files.concat(nestedFiles);
        }
    }
    return files;
}

resultsBody.addEventListener('click', (e) => {
    const row = e.target.closest('tr.track-row.ready');
    if (!row) return;

    if (row.classList.contains('selected-master')) {
        tracksTable.classList.remove('has-selection');
        row.classList.remove('selected-master');
        document.querySelectorAll('tr.track-row').forEach(r => r.classList.remove('harmonic-match'));
        wavesurfer.pause();
        playerDeck.classList.remove('visible');
        highlightKeyOnWheel(null);
        return;
    }

    tracksTable.classList.add('has-selection');
    document.querySelectorAll('tr.track-row').forEach(r => {
        r.classList.remove('selected-master', 'harmonic-match');
    });

    row.classList.add('selected-master');
    const selectedKey = row.getAttribute('data-key');
    highlightKeyOnWheel(selectedKey);
    const matches = getCompatibleKeys(selectedKey);

    document.querySelectorAll('tr.track-row.ready').forEach(r => {
        if (r !== row && matches.includes(r.getAttribute('data-key'))) {
            r.classList.add('harmonic-match');
        }
    });

    const rowId = row.id;
    if (fileRegistry[rowId]) {
        const file = fileRegistry[rowId];
        
        if (currentObjectUrl) {
            URL.revokeObjectURL(currentObjectUrl);
        }
        currentObjectUrl = URL.createObjectURL(file);
        
        playerTrackName.textContent = row.querySelector('.new-name').textContent;
        playerBpm.textContent = `${row.getAttribute('data-bpm')} BPM`;
        const format = notationSelect.value;
        playerKey.textContent = formatKey(selectedKey, row.getAttribute('data-key-text'), format);
        playerGenre.textContent = row.getAttribute('data-genre') || "Unknown";
        playerDeck.classList.add('visible');

        wavesurfer.load(currentObjectUrl);
        wavesurfer.once('ready', () => {
            wavesurfer.play();
        });
    }
});

folderBtn.addEventListener('click', async () => {
    try {
        const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        await startProcessingDirectory(dirHandle);
    } catch (err) {
        console.error("Folder selection cancelled or failed:", err);
        folderBtn.disabled = false;
        folderBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> Select Folder to Process`;
    }
});

async function startProcessingDirectory(dirHandle) {
    try {
        isAnalyzing = true;
        
        resultsBody.innerHTML = ''; 
        tracksTable.classList.remove('has-selection');
        playerDeck.classList.remove('visible');
        if (wavesurfer) wavesurfer.pause();
        
        for (let key in fileRegistry) delete fileRegistry[key];
        exportData = []; 

        folderBtn.disabled = true;
        exportCsvBtn.disabled = true;
        exportM3u8Btn.disabled = true;
        
        folderBtn.innerHTML = "Scanning folders...";
        progressContainer.style.display = 'block';
        progressText.style.display = 'block';

        const filesToProcess = await getAudioFilesRecursively(dirHandle);

        if (filesToProcess.length === 0) {
            folderBtn.disabled = false;
            folderBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> Select Folder to Process`;
            progressText.textContent = "No MP3 files found in the selected folder.";
            isAnalyzing = false;
            return;
        }

        let processedCount = 0;
        updateProgress(0, filesToProcess.length);

        const outDirHandle = await dirHandle.getDirectoryHandle('Processed_Tracks', { create: true });
        const queue = [...filesToProcess];
        
        const runNext = async (workerIndex) => {
            if (queue.length === 0) return;
            const entry = queue.shift();
            try {
                await processBatchFile(entry, outDirHandle, workerIndex);
            } catch (err) {
                console.error("Error processing file in queue:", err);
            }
            processedCount++;
            updateProgress(processedCount, filesToProcess.length);
            await runNext(workerIndex);
        };

        const promises = [];
        for (let i = 0; i < Math.min(poolSize, filesToProcess.length); i++) {
            promises.push(runNext(i));
        }
        await Promise.all(promises);

        // Clean orphan files from Processed_Tracks that don't match any processed track in this batch
        try {
            const validNewNames = new Set(exportData.map(d => d.newName));
            for await (const entry of outDirHandle.values()) {
                if (entry.kind === 'file' && !validNewNames.has(entry.name)) {
                    await outDirHandle.removeEntry(entry.name);
                    console.log(`Pruned orphaned processed track: ${entry.name}`);
                }
            }
        } catch (e) {
            console.error("Error cleaning orphaned files:", e);
        }

        folderBtn.disabled = false;
        folderBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> Select Folder to Process`;
        progressText.textContent = "Batch Processing Complete!";

        if (exportData.length > 0) {
            exportCsvBtn.disabled = false;
            exportM3u8Btn.disabled = false;
        }

    } catch (err) {
        console.error("Folder processing failed:", err);
        folderBtn.disabled = false;
        folderBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> Select Folder to Process`;
    } finally {
        isAnalyzing = false;
    }
}

function updateProgress(current, total) {
    const percentage = total === 0 ? 0 : (current / total) * 100;
    progressBar.style.width = `${percentage}%`;
    progressText.textContent = `Analysing ${current} of ${total} files...`;
}

async function processBatchFile(fileHandle, outDirHandle, workerIndex) {
    const rowId = `track-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    const tr = document.createElement('tr');
    tr.id = rowId;
    tr.className = 'track-row';
    tr.innerHTML = `
        <td class="track-name" title="${fileHandle.name}">${fileHandle.name}</td>
        <td class="new-name" title="-">-</td>
        <td class="bpm-value">-</td>
        <td>
            <span class="badge" style="background-color: var(--border-colour); color: var(--text-main);">-</span>
            <span class="match-indicator">Match</span>
        </td>
        <td class="energy-value">-</td>
        <td class="genre-value">-</td>
        <td class="status loading">Analysing...</td>
        <td class="action-cell">-</td>
    `;
    resultsBody.appendChild(tr);

    try {
        const file = await fileHandle.getFile();
        const arrayBuffer = await file.arrayBuffer();
        
        // 1. Scan output directory for any existing processed version of this track
        let existingFileHandle = null;
        const cleanFile = stripKeyPrefix(file.name);
        try {
            for await (const entry of outDirHandle.values()) {
                if (entry.kind === 'file') {
                    const cleanEntry = stripKeyPrefix(entry.name);
                    if (cleanEntry === cleanFile) {
                        existingFileHandle = entry;
                        break;
                    }
                }
            }
        } catch (e) {
            console.error("Error pre-scanning for existing processed file:", e);
        }

        let result = null;
        let energyLevel = '--';
        let beatOffset = 0.0;
        let genre = "Unknown";
        let fileExists = false;
        let existingFile = null;

        // If existing processed file is found, try loading metadata from it to skip analysis
        if (existingFileHandle) {
            try {
                existingFile = await existingFileHandle.getFile();
                const existingBuffer = await existingFile.arrayBuffer();
                const existingTags = parseID3TagsFromBuffer(existingBuffer);
                genre = existingTags.genre || "Unknown";

                // Try to resolve key from TKEY
                let resolved = resolveKey(existingTags.key);
                
                // If not in TKEY, try parsing it from the prepended title or the filename
                if (!resolved) {
                    const titleMatch = existingTags.title ? existingTags.title.match(/^(\d{1,2}[ABab]|[A-G]#?b?(?:\s*(?:Major|Minor|maj|min|m|M)))(?:\s*-\s*(\d{1,2}))?/i) : null;
                    if (titleMatch) {
                        resolved = resolveKey(titleMatch[1]);
                        if (titleMatch[2]) {
                            energyLevel = titleMatch[2];
                        }
                    }
                }
                
                // Try parsing energy from the filename if we haven't found it yet
                if (energyLevel === '--') {
                    const fileMatch = existingFileHandle.name.match(/^(\d{1,2}[ABab]|[A-G]#?b?(?:\s*(?:Major|Minor|maj|min|m|M)))(?:\s*-\s*(\d{1,2}))?/i);
                    if (fileMatch) {
                        if (!resolved) {
                            resolved = resolveKey(fileMatch[1]);
                        }
                        if (fileMatch[2]) {
                            energyLevel = fileMatch[2];
                        }
                    }
                }

                if (resolved) {
                    const resolvedBpm = existingTags.bpm ? Math.round(parseFloat(existingTags.bpm)) : 'Unknown';
                    result = {
                        success: true,
                        camelotCode: resolved.camelotCode,
                        keyText: resolved.keyText,
                        bpm: resolvedBpm
                    };
                    
                    if (energyLevel === '--' && resolvedBpm !== 'Unknown') {
                        const bpmNum = parseInt(resolvedBpm, 10);
                        if (bpmNum > 0) {
                            energyLevel = Math.max(3, Math.min(9, Math.round((bpmNum - 80) / 10) + 3));
                        }
                    }
                    fileExists = true;
                }
            } catch (err) {
                console.warn("Could not load tags from existing processed file, falling back to analysis:", err);
            }
        }

        let resolved = false;
        // 2. If we couldn't load from existing file, analyze the input file
        if (!result) {
            // Parse existing ID3 tags in one pass from input file
            const parsedTags = parseID3TagsFromBuffer(arrayBuffer);
            genre = parsedTags.genre || "Unknown";
            
            // Check if there is already a valid key in the ID3 tag to skip DSP analysis
            const tagResolved = resolveKey(parsedTags.key);
            const resolvedBpm = parsedTags.bpm ? Math.round(parseFloat(parsedTags.bpm)) : 'Unknown';
            
            if (tagResolved) {
                resolved = true;
                result = {
                    success: true,
                    camelotCode: tagResolved.camelotCode,
                    keyText: tagResolved.keyText,
                    bpm: resolvedBpm
                };
                if (resolvedBpm !== 'Unknown') {
                    const bpmNum = parseInt(resolvedBpm, 10);
                    if (bpmNum > 0) {
                        energyLevel = Math.max(3, Math.min(9, Math.round((bpmNum - 80) / 10) + 3));
                    }
                }
            } else {
                // No valid key found, decode audio and analyze
                const audioBufferCopy = arrayBuffer.slice(0); 
                const decodedAudio = await audioContext.decodeAudioData(audioBufferCopy);
                const channelData = decodedAudio.getChannelData(0);
                
                // Calculate energy level (1-10)
                energyLevel = calculateEnergyLevel(channelData);
                
                const dspResult = await analyseInWorker(channelData, decodedAudio.sampleRate, workerIndex);
                if (!dspResult.success) throw new Error(dspResult.error);
                result = {
                    success: true,
                    camelotCode: dspResult.camelotCode,
                    keyText: dspResult.keyText,
                    bpm: dspResult.bpm
                };
                
                // Calculate beatgrid phase offset (seconds)
                beatOffset = locateBeatGrid(channelData, decodedAudio.sampleRate, result.bpm);
            }
        } else {
            // Mock resolved as true so if we skipped, status is correctly rendered
            resolved = true;
        }

        const format = notationSelect.value;
        const chosenKey = formatKey(result.camelotCode, result.keyText, format);
        
        // Determine saved filename based on the Rename Filename option
        const energyStr = (energyLevel !== '--') ? `${energyLevel} - ` : '';
        const cleanFilename = stripKeyPrefix(file.name);
        const savedFilename = optFilename.checked ? `${chosenKey} - ${energyStr}${cleanFilename}` : file.name;

        // Clean other duplicate processed files that have a different name
        const duplicatesToDelete = [];
        if (existingFileHandle && existingFileHandle.name !== savedFilename) {
            duplicatesToDelete.push(existingFileHandle.name);
            fileExists = false; // Name changed, so we need to rewrite
        }
        
        // Scan for any other matching duplicates just in case
        try {
            for await (const entry of outDirHandle.values()) {
                if (entry.kind === 'file') {
                    const cleanEntry = stripKeyPrefix(entry.name);
                    if (cleanEntry === cleanFile && entry.name !== savedFilename && entry.name !== (existingFileHandle ? existingFileHandle.name : '')) {
                        duplicatesToDelete.push(entry.name);
                    }
                }
            }
        } catch (e) {
            console.error("Error scanning for duplicates:", e);
        }

        for (const dupName of duplicatesToDelete) {
            try {
                await outDirHandle.removeEntry(dupName);
            } catch (err) {
                console.warn(`Could not remove duplicate entry ${dupName}:`, err);
            }
        }

        let outputBuffer = arrayBuffer;
        let savedFile = null;

        const energySuffix = (energyLevel !== '--') ? ` - ${energyLevel}` : '';
        const titleKeyPrefix = `${chosenKey}${energySuffix}`;

        if (fileExists && existingFile) {
            // Check if existing file needs tag updates
            const existingTags = parseID3TagsFromBuffer(await existingFile.arrayBuffer());
            let needsUpdate = false;
            if (optTitle.checked) {
                const expectedPrefix = `${titleKeyPrefix} - `;
                if (!existingTags.title || !existingTags.title.startsWith(expectedPrefix)) {
                    needsUpdate = true;
                }
            }
            if (optTags.checked) {
                if (!existingTags.key) {
                    needsUpdate = true;
                }
            }

            if (!needsUpdate) {
                savedFile = existingFile;
            } else {
                outputBuffer = updateID3Tags(await existingFile.arrayBuffer(), result.camelotCode, result.bpm, {
                    prependTitle: optTitle.checked,
                    titleKeyPrefix: titleKeyPrefix,
                    writeTags: optTags.checked
                }, file.name);

                savedFile = new File([outputBuffer], savedFilename, { type: file.type });
                const writable = await existingFileHandle.createWritable();
                await writable.write(outputBuffer);
                await writable.close();
                fileExists = false; // So status shows 'Saved' rather than 'Skipped (Exists)'
            }
        } else {
            // Write tags to input file buffer and save
            if (optTitle.checked || optTags.checked) {
                outputBuffer = updateID3Tags(arrayBuffer, result.camelotCode, result.bpm, {
                    prependTitle: optTitle.checked,
                    titleKeyPrefix: titleKeyPrefix,
                    writeTags: optTags.checked
                }, file.name);
            }

            savedFile = new File([outputBuffer], savedFilename, { type: file.type });
            const newFileHandle = await outDirHandle.getFileHandle(savedFilename, { create: true });
            const writable = await newFileHandle.createWritable();
            await writable.write(outputBuffer);
            await writable.close();
        }

        fileRegistry[rowId] = savedFile;

        exportData.push({
            originalName: file.name,
            newName: savedFilename,
            bpm: result.bpm,
            key: result.camelotCode,
            keyText: result.keyText,
            energy: energyLevel,
            genre: genre,
            beatOffset: beatOffset,
            fileObject: savedFile,
            rowId: rowId
        });

        const trackIndex = exportData.length - 1;

        const badgeColour = result.camelotCode !== "Unknown" ? `var(--cam-${result.camelotCode.toLowerCase()})` : "var(--border-colour)";

        tr.setAttribute('data-key', result.camelotCode);
        tr.setAttribute('data-key-text', result.keyText);
        tr.setAttribute('data-bpm', result.bpm);
        tr.setAttribute('data-energy', energyLevel);
        tr.setAttribute('data-genre', genre);
        tr.classList.add('ready');

        const newNameEl = document.querySelector(`#${rowId} .new-name`);
        newNameEl.textContent = savedFilename;
        newNameEl.setAttribute('title', savedFilename);

        document.querySelector(`#${rowId} .bpm-value`).textContent = result.bpm;
        document.querySelector(`#${rowId} .energy-value`).innerHTML = getEnergyBarHtml(energyLevel);

        const genreEl = document.querySelector(`#${rowId} .genre-value`);
        genreEl.textContent = genre;
        genreEl.setAttribute('title', genre);
        
        const badge = document.querySelector(`#${rowId} .badge`);
        badge.textContent = chosenKey;
        badge.style.backgroundColor = badgeColour;
        badge.style.color = '#000';

        const status = document.querySelector(`#${rowId} .status`);
        status.textContent = fileExists ? 'Skipped (Exists)' : (resolved ? 'Loaded (Tag)' : 'Saved');
        status.className = 'status complete';

        const actionCell = document.querySelector(`#${rowId} .action-cell`);
        if (actionCell) {
            actionCell.innerHTML = `
                <button class="action-icon-btn add-to-setlist-btn" data-index="${trackIndex}" title="Add to Setlist Timeline" style="color: var(--accent-colour); padding: 4px 8px; border: 1px solid rgba(0, 229, 255, 0.2); font-size: 0.8rem; border-radius: 4px; font-weight: bold; background: transparent; cursor: pointer;">
                    + Setlist
                </button>
            `;
            actionCell.querySelector('.add-to-setlist-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                addTrackToSetlist(trackIndex);
                
                const btn = e.currentTarget;
                const originalText = btn.textContent;
                btn.textContent = 'Added ✔';
                btn.style.color = 'var(--match-colour)';
                btn.style.borderColor = 'var(--match-colour)';
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.style.color = 'var(--accent-colour)';
                    btn.style.borderColor = 'rgba(0, 229, 255, 0.2)';
                }, 1000);
            });
        }

    } catch (error) {
        console.error(`Error processing ${fileHandle.name}:`, error);
        const status = document.querySelector(`#${rowId} .status`);
        status.textContent = 'Error';
        status.className = 'status error';
    }
}

const camelotToStandard = {
    "8B": "C Major",  "5A": "C Minor", "3B": "C# Major", "12A": "C# Minor",
    "10B": "D Major", "7A": "D Minor", "5B": "D# Major", "2A": "D# Minor",
    "12B": "E Major", "9A": "E Minor", "7B": "F Major",  "4A": "F Minor",
    "2B": "F# Major", "11A": "F# Minor", "9B": "G Major",  "6A": "G Minor",
    "4B": "G# Major", "1A": "G# Minor", "11B": "A Major", "8A": "A Minor",
    "6B": "A# Major", "3A": "A# Minor", "1B": "B Major",  "10A": "B Minor"
};

const standardToCamelot = {};
for (const [cam, std] of Object.entries(camelotToStandard)) {
    standardToCamelot[std] = cam;
}

function resolveKey(keyString) {
    if (!keyString) return null;
    let clean = keyString.trim().replace(/\0+$/, '');
    if (!clean) return null;
    
    // Split by slash, space, or hyphen to handle complex or dual keys (e.g. 8A/12A, 8A - A minor)
    clean = clean.split(/[/\s-]/)[0].trim();
    
    // Camelot format check
    const camelotMatch = clean.match(/^(\d{1,2})([ABab])$/);
    if (camelotMatch) {
        const num = camelotMatch[1];
        const letter = camelotMatch[2].toUpperCase();
        const code = num + letter;
        if (camelotToStandard[code]) {
            return {
                camelotCode: code,
                keyText: camelotToStandard[code]
            };
        }
    }
    
    // Standard notation lookup mapping
    const stdLookup = {
        "c": "C Major", "cm": "C Minor", "cmin": "C Minor", "cminor": "C Minor",
        "c#": "C# Major", "c#m": "C# Minor", "c#min": "C# Minor", "c#minor": "C# Minor", "db": "C# Major", "dbm": "C# Minor",
        "d": "D Major", "dm": "D Minor", "dmin": "D Minor", "dminor": "D Minor",
        "d#": "D# Major", "d#m": "D# Minor", "d#min": "D# Minor", "d#minor": "D# Minor", "eb": "D# Major", "ebm": "D# Minor",
        "e": "E Major", "em": "E Minor", "emin": "E Minor", "eminor": "E Minor",
        "f": "F Major", "fm": "F Minor", "fmin": "F Minor", "fminor": "F Minor",
        "f#": "F# Major", "f#m": "F# Minor", "f#min": "F# Minor", "f#minor": "F# Minor", "gb": "F# Major", "gbm": "F# Minor",
        "g": "G Major", "gm": "G Minor", "gmin": "G Minor", "gminor": "G Minor",
        "g#": "G# Major", "g#m": "G# Minor", "g#min": "G# Minor", "g#minor": "G# Minor", "ab": "G# Major", "abm": "G# Minor",
        "a": "A Major", "am": "A Minor", "amin": "A Minor", "aminor": "A Minor",
        "a#": "A# Major", "a#m": "A# Minor", "a#min": "A# Minor", "a#minor": "A# Minor", "bb": "A# Major", "bbm": "A# Minor",
        "b": "B Major", "bm": "B Minor", "bmin": "B Minor", "bminor": "B Minor"
    };
    
    const lookupKey = clean.toLowerCase().replace(/\s+minor/g, 'm').replace(/\s+major/g, '').trim();
    if (stdLookup[lookupKey]) {
        const resolvedStd = stdLookup[lookupKey];
        return {
            camelotCode: standardToCamelot[resolvedStd],
            keyText: resolvedStd
        };
    }
    
    return null;
}

// Custom native ID3v2 parser to extract TCON (Genre), TKEY (Key), TBPM (BPM), and TIT2 (Title)
function parseID3TagsFromBuffer(arrayBuffer) {
    const tags = { genre: "Unknown", key: null, bpm: null, title: null };
    const uint8 = new Uint8Array(arrayBuffer);
    if (uint8[0] !== 0x49 || uint8[1] !== 0x44 || uint8[2] !== 0x33) {
        return tags;
    }
    
    const majorVersion = uint8[3];
    const flags = uint8[5];
    const tagSize = ((uint8[6] & 0x7F) << 21) | 
                    ((uint8[7] & 0x7F) << 14) | 
                    ((uint8[8] & 0x7F) << 7) | 
                    (uint8[9] & 0x7F);
                    
    let offset = 10;
    if (flags & 0x40) {
        const extHeaderSize = ((uint8[offset] & 0x7F) << 21) | 
                              ((uint8[offset+1] & 0x7F) << 14) | 
                              ((uint8[offset+2] & 0x7F) << 7) | 
                              (uint8[offset+3] & 0x7F);
        offset += 4 + extHeaderSize;
    }
    
    const endOfTags = 10 + tagSize;
    const genresList = ["Blues", "Classic Rock", "Country", "Dance", "Disco", "Funk", "Grunge", "Metal", "New Age", "Oldies", "Other", "Pop", "R&B", "Rap", "Reggae", "Rock", "Techno", "Industrial", "Alternative", "Ska", "Death Metal", "Pranks", "Soundtrack", "Euro-Techno", "Ambient", "Trip-Hop", "Vocal", "Jazz", "Acid Punk", "Acid", "House", "Game", "Sound Clip", "Gospel", "Noise", "AlternRock", "Bass", "Soul", "Punk", "Space", "Meditative", "Instrumental Pop", "Instrumental Rock", "Ethnic", "Gothic", "Darkwave", "Techno-Industrial", "Electronic", "Pop-Folk", "Eurodance", "Dream", "Southern Rock", "Comedy", "Cult", "Gangsta", "Top 40", "Christian Rap", "Pop/Funk", "Jungle", "Native American", "Cabaret", "New Wave", "Psychadelic", "Rave", "Showtunes", "Trailer", "Lo-Fi", "Tribal", "Acid Jazz", "Club", "Tango", "Samba", "Folklore", "Ballad", "Power Ballad", "Rhythmic Soul", "Freestyle", "Duet", "Punk Rock", "Drum Solo", "Acapella", "Euro-House", "Dance Hall"];

    while (offset + 10 <= endOfTags) {
        const frameId = String.fromCharCode(uint8[offset], uint8[offset+1], uint8[offset+2], uint8[offset+3]);
        if (uint8[offset] === 0) break;
        
        let frameSize = 0;
        if (majorVersion === 3) {
            frameSize = (uint8[offset+4] << 24) | (uint8[offset+5] << 16) | (uint8[offset+6] << 8) | uint8[offset+7];
        } else if (majorVersion === 4) {
            frameSize = ((uint8[offset+4] & 0x7F) << 21) | ((uint8[offset+5] & 0x7F) << 14) | ((uint8[offset+6] & 0x7F) << 7) | (uint8[offset+7] & 0x7F);
        } else {
            break;
        }
        
        if (frameSize <= 0) break;
        const totalFrameSize = 10 + frameSize;
        if (offset + totalFrameSize > endOfTags) break;
        
        if (frameId === 'TCON') {
            let genreVal = decodeTextFrame(uint8, offset, frameSize);
            const match = genreVal.match(/^\((\d+)\)$/);
            if (match) {
                const id = parseInt(match[1], 10);
                if (id >= 0 && id < genresList.length) {
                    genreVal = genresList[id];
                }
            }
            tags.genre = genreVal || "Unknown";
        } else if (frameId === 'TKEY') {
            tags.key = decodeTextFrame(uint8, offset, frameSize);
        } else if (frameId === 'TBPM') {
            tags.bpm = decodeTextFrame(uint8, offset, frameSize);
        } else if (frameId === 'TIT2') {
            tags.title = decodeTextFrame(uint8, offset, frameSize);
        }
        
        offset += totalFrameSize;
    }
    return tags;
}

// Custom native ID3v2 frame-preserving editor
function decodeTextFrame(uint8, offset, frameSize) {
    const encoding = uint8[offset + 10];
    const textBytes = uint8.subarray(offset + 11, offset + 10 + frameSize);
    let text = "";
    try {
        if (encoding === 0) {
            text = String.fromCharCode.apply(null, textBytes);
        } else if (encoding === 1) {
            text = new TextDecoder('utf-16').decode(textBytes);
        } else if (encoding === 2) {
            text = new TextDecoder('utf-16be').decode(textBytes);
        } else if (encoding === 3) {
            text = new TextDecoder('utf-8').decode(textBytes);
        }
    } catch (e) {
        text = "";
    }
    return text.replace(/\0+$/, '').trim();
}

function encodeText(str, majorVersion) {
    let isAscii = true;
    for (let i = 0; i < str.length; i++) {
        if (str.charCodeAt(i) > 127) {
            isAscii = false;
            break;
        }
    }
    
    if (majorVersion === 4) {
        return {
            encoding: 3, // UTF-8
            bytes: new TextEncoder().encode(str)
        };
    } else {
        if (isAscii) {
            const bytes = new Uint8Array(str.length);
            for (let i = 0; i < str.length; i++) {
                bytes[i] = str.charCodeAt(i);
            }
            return { encoding: 0, bytes }; // Latin-1
        } else {
            const bytes = new Uint8Array(2 + str.length * 2);
            bytes[0] = 0xFF; // BOM LE
            bytes[1] = 0xFE;
            for (let i = 0; i < str.length; i++) {
                const code = str.charCodeAt(i);
                bytes[2 + i * 2] = code & 0xFF;
                bytes[2 + i * 2 + 1] = (code >> 8) & 0xFF;
            }
            return { encoding: 1, bytes }; // UTF-16 with BOM
        }
    }
}

function createTextFrame(id, text, majorVersion = 3) {
    const encoded = encodeText(text, majorVersion);
    const frameSize = 1 + encoded.bytes.length; // 1 byte encoding + text bytes
    const frameData = new Uint8Array(10 + frameSize);
    
    frameData[0] = id.charCodeAt(0);
    frameData[1] = id.charCodeAt(1);
    frameData[2] = id.charCodeAt(2);
    frameData[3] = id.charCodeAt(3);
    
    if (majorVersion === 4) {
        // Syncsafe integer for ID3v2.4
        frameData[4] = (frameSize >> 21) & 0x7F;
        frameData[5] = (frameSize >> 14) & 0x7F;
        frameData[6] = (frameSize >> 7) & 0x7F;
        frameData[7] = frameSize & 0x7F;
    } else {
        // Standard 32-bit big endian for ID3v2.3
        frameData[4] = (frameSize >> 24) & 0xFF;
        frameData[5] = (frameSize >> 16) & 0xFF;
        frameData[6] = (frameSize >> 8) & 0xFF;
        frameData[7] = frameSize & 0xFF;
    }
    
    frameData[8] = 0;
    frameData[9] = 0;
    frameData[10] = encoded.encoding;
    frameData.set(encoded.bytes, 11);
    
    return frameData;
}
function stripKeyPrefix(title) {
    // Matches camelot key (e.g. 8A, 11B) or open key/traditional key (e.g. C# Minor, Bbm)
    // optionally followed by a hyphen and energy rating (1-10)
    // followed by a hyphen and space.
    const regex = /^(\d{1,2}[ABab]|[A-G]#?b?(?:\s*(?:Major|Minor|maj|min|m|M)))(?:\s*-\s*\d{1,2})?\s*-\s*/i;
    return title.replace(regex, '');
}

function updateID3Tags(arrayBuffer, camelotCode, bpm, options, fallbackFilename) {
    const uint8 = new Uint8Array(arrayBuffer);
    
    // Check for ID3 header
    if (uint8[0] !== 0x49 || uint8[1] !== 0x44 || uint8[2] !== 0x33) {
        // Return original if no tags need to be written
        if (!options.writeTags && !options.prependTitle) {
            return arrayBuffer;
        }
        // Otherwise create new tag using fallback
        return createMinimalID3Tag(arrayBuffer, camelotCode, bpm, options, fallbackFilename);
    }
    
    const majorVersion = uint8[3];
    const revision = uint8[4];
    const flags = uint8[5];
    const tagSize = ((uint8[6] & 0x7F) << 21) | 
                    ((uint8[7] & 0x7F) << 14) | 
                    ((uint8[8] & 0x7F) << 7) | 
                    (uint8[9] & 0x7F);
                    
    let offset = 10;
    if (flags & 0x40) {
        const extHeaderSize = ((uint8[offset] & 0x7F) << 21) | 
                              ((uint8[offset+1] & 0x7F) << 14) | 
                              ((uint8[offset+2] & 0x7F) << 7) | 
                              (uint8[offset+3] & 0x7F);
        offset += 4 + extHeaderSize;
    }
    
    const preservedFrames = [];
    const newFrames = [];
    const endOfTags = 10 + tagSize;
    let foundTitle = false;
    
    while (offset + 10 <= endOfTags) {
        const frameId = String.fromCharCode(uint8[offset], uint8[offset+1], uint8[offset+2], uint8[offset+3]);
        if (uint8[offset] === 0) break; // Padding
        
        let frameSize = 0;
        if (majorVersion === 3) {
            frameSize = (uint8[offset+4] << 24) | (uint8[offset+5] << 16) | (uint8[offset+6] << 8) | uint8[offset+7];
        } else if (majorVersion === 4) {
            frameSize = ((uint8[offset+4] & 0x7F) << 21) | ((uint8[offset+5] & 0x7F) << 14) | ((uint8[offset+6] & 0x7F) << 7) | (uint8[offset+7] & 0x7F);
        } else {
            return arrayBuffer; // Unknown version, return unmodified
        }
        
        if (frameSize <= 0) break;
        
        const totalFrameSize = 10 + frameSize;
        if (offset + totalFrameSize > endOfTags) break;
        
        if (frameId === 'TKEY' || frameId === 'TBPM') {
            if (options.writeTags) {
                offset += totalFrameSize;
                continue; // Skip so we can replace
            }
        }
        
        if (frameId === 'TIT2') {
            foundTitle = true;
            if (options.prependTitle) {
                const originalTitle = decodeTextFrame(uint8, offset, frameSize);
                const prefix = `${options.titleKeyPrefix || camelotCode} - `;
                
                // Clean any existing key/energy prefix from the beginning
                const cleanTitle = stripKeyPrefix(originalTitle);
                const newTitle = prefix + cleanTitle;
                
                newFrames.push(createTextFrame('TIT2', newTitle, majorVersion));
                offset += totalFrameSize;
                continue;
            }
        }
        
        preservedFrames.push(uint8.subarray(offset, offset + totalFrameSize));
        offset += totalFrameSize;
    }
    
    // Add new TKEY / TBPM if needed
    if (options.writeTags) {
        if (camelotCode && camelotCode !== 'Unknown') {
            newFrames.push(createTextFrame('TKEY', camelotCode, majorVersion));
        }
        if (bpm && bpm !== 'Unknown') {
            newFrames.push(createTextFrame('TBPM', bpm.toString(), majorVersion));
        }
    }
    
    // Add new TIT2 if not found and prependTitle is requested
    if (options.prependTitle && !foundTitle) {
        const cleanName = fallbackFilename.replace(/\.[^/.]+$/, "");
        newFrames.push(createTextFrame('TIT2', `${options.titleKeyPrefix || camelotCode} - ${cleanName}`, majorVersion));
    }
    
    let framesSizeSum = 0;
    preservedFrames.forEach(f => framesSizeSum += f.length);
    newFrames.forEach(f => framesSizeSum += f.length);
    
    const paddingSize = 1024;
    const newTagSize = framesSizeSum + paddingSize;
    
    const audioDataOffset = 10 + tagSize;
    const audioDataLength = uint8.length - audioDataOffset;
    
    const newFileBuffer = new Uint8Array(10 + newTagSize + audioDataLength);
    
    // Write Header
    newFileBuffer[0] = 0x49; // I
    newFileBuffer[1] = 0x44; // D
    newFileBuffer[2] = 0x33; // 3
    newFileBuffer[3] = majorVersion;
    newFileBuffer[4] = revision;
    newFileBuffer[5] = flags & ~0x40; // Clear extended header flag
    
    newFileBuffer[6] = (newTagSize >> 21) & 0x7F;
    newFileBuffer[7] = (newTagSize >> 14) & 0x7F;
    newFileBuffer[8] = (newTagSize >> 7) & 0x7F;
    newFileBuffer[9] = newTagSize & 0x7F;
    
    let writeOffset = 10;
    
    preservedFrames.forEach(f => {
        newFileBuffer.set(f, writeOffset);
        writeOffset += f.length;
    });
    
    newFrames.forEach(f => {
        newFileBuffer.set(f, writeOffset);
        writeOffset += f.length;
    });
    
    for (let i = 0; i < paddingSize; i++) {
        newFileBuffer[writeOffset + i] = 0;
    }
    writeOffset += paddingSize;
    
    newFileBuffer.set(uint8.subarray(audioDataOffset), writeOffset);
    
    return newFileBuffer.buffer;
}

function createMinimalID3Tag(arrayBuffer, camelotCode, bpm, options, fallbackFilename) {
    // If no existing ID3 tags, create a fresh one from scratch
    const newFrames = [];
    if (options.prependTitle) {
        const cleanName = fallbackFilename.replace(/\.[^/.]+$/, "");
        newFrames.push(createTextFrame('TIT2', `${options.titleKeyPrefix || camelotCode} - ${cleanName}`, 3));
    }
    if (options.writeTags) {
        if (camelotCode && camelotCode !== 'Unknown') {
            newFrames.push(createTextFrame('TKEY', camelotCode, 3));
        }
        if (bpm && bpm !== 'Unknown') {
            newFrames.push(createTextFrame('TBPM', bpm.toString(), 3));
        }
    }
    
    let framesSizeSum = 0;
    newFrames.forEach(f => framesSizeSum += f.length);
    
    const paddingSize = 256;
    const tagSize = framesSizeSum + paddingSize;
    
    const uint8 = new Uint8Array(arrayBuffer);
    const newBuffer = new Uint8Array(10 + tagSize + uint8.length);
    
    newBuffer[0] = 0x49; newBuffer[1] = 0x44; newBuffer[2] = 0x33; // ID3
    newBuffer[3] = 3; newBuffer[4] = 0; newBuffer[5] = 0; // version 2.3.0
    
    newBuffer[6] = (tagSize >> 21) & 0x7F;
    newBuffer[7] = (tagSize >> 14) & 0x7F;
    newBuffer[8] = (tagSize >> 7) & 0x7F;
    newBuffer[9] = tagSize & 0x7F;
    
    let writeOffset = 10;
    newFrames.forEach(f => {
        newBuffer.set(f, writeOffset);
        writeOffset += f.length;
    });
    
    writeOffset += paddingSize; // zeros by default
    newBuffer.set(uint8, writeOffset);
    
    return newBuffer.buffer;
}


// Tab Close Protection
window.addEventListener('beforeunload', (e) => {
    if (isAnalyzing) {
        e.preventDefault();
        e.returnValue = 'Batch analysis is currently in progress. Are you sure you want to leave and lose progress?';
    }
});

// Drag and drop handlers
window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!folderBtn.disabled) {
        document.body.classList.add('drag-over');
    }
});

window.addEventListener('dragleave', () => {
    document.body.classList.remove('drag-over');
});

window.addEventListener('drop', async (e) => {
    e.preventDefault();
    document.body.classList.remove('drag-over');
    if (folderBtn.disabled) return;
    
    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
        const item = items[0];
        if (item.kind === 'file') {
            if (typeof item.getAsFileSystemHandle === 'function') {
                try {
                    const handle = await item.getAsFileSystemHandle();
                    if (handle.kind === 'directory') {
                        // Request readwrite permission
                        const opt = { mode: 'readwrite' };
                        if (await handle.queryPermission(opt) === 'granted' || await handle.requestPermission(opt) === 'granted') {
                            await startProcessingDirectory(handle);
                        }
                    } else {
                        alert("Please drop a folder, not individual files.");
                    }
                } catch (err) {
                    console.error("Error getting directory handle:", err);
                }
            } else {
                alert("This browser does not support drag and drop directory handles. Please click 'Select Folder to Process' instead.");
            }
        }
    }
});

// Inject Drag-over style dynamically
const dragOverStyle = document.createElement('style');
dragOverStyle.textContent = `
    body.drag-over {
        position: relative;
    }
    body.drag-over::after {
        content: "Drop Folder to Process";
        position: fixed;
        top: 0; left: 0; width: 100%; height: 100%;
        background-color: rgba(13, 13, 18, 0.95);
        border: 4px dashed var(--accent-colour);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 2rem;
        font-weight: 800;
        color: var(--accent-colour);
        z-index: 9999;
        pointer-events: none;
        box-sizing: border-box;
    }
`;
document.head.appendChild(dragOverStyle);

// Exports
exportCsvBtn.addEventListener('click', () => {
    if (exportData.length === 0) return;
    
    const format = notationSelect.value;
    let csvContent = "Original Name,New Filename,BPM,Key,Energy,Genre\n";
    exportData.forEach(track => {
        const ogName = `"${track.originalName.replace(/"/g, '""')}"`;
        const newName = `"${track.newName.replace(/"/g, '""')}"`;
        const keyVal = formatKey(track.key, track.keyText, format);
        const energyVal = track.energy || '--';
        const genreVal = `"${(track.genre || "Unknown").replace(/"/g, '""')}"`;
        csvContent += `${ogName},${newName},${track.bpm},${keyVal},${energyVal},${genreVal}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    triggerDownload(blob, `CreepyCrate_Key_DJ_Setlist_${Date.now()}.csv`);
});

exportM3u8Btn.addEventListener('click', () => {
    if (exportData.length === 0) return;

    let m3u8Content = "#EXTM3U\n";
    exportData.forEach(track => {
        m3u8Content += `#EXTINF:-1,${track.newName.replace('.mp3', '')}\n`;
        m3u8Content += `Processed_Tracks/${track.newName}\n`; 
    });

    const blob = new Blob([m3u8Content], { type: 'application/x-mpegURL;charset=utf-8;' });
    triggerDownload(blob, `CreepyCrate_Key_DJ_Playlist_${Date.now()}.m3u8`);
});

function triggerDownload(blob, filename) {
    const link = document.createElement("a");
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

// Next-Level Industry Features Helper Functions

// 1. Audio Energy Level Calculator (RMS-based)
function calculateEnergyLevel(channelData) {
    const len = channelData.length;
    // Fast-sample: read up to 100,000 points to keep execution sub-millisecond
    const sampleLimit = Math.min(len, 2000000);
    let sumSquares = 0;
    const step = Math.max(1, Math.floor(sampleLimit / 100000));
    let count = 0;
    
    for (let i = 0; i < sampleLimit; i += step) {
        const val = channelData[i];
        sumSquares += val * val;
        count++;
    }
    
    const rms = Math.sqrt(sumSquares / count);
    
    // Scale RMS from typical ranges [0.04, 0.28] to a [1, 10] energy integer
    const minRms = 0.04;
    const maxRms = 0.28;
    let energy = Math.round(((rms - minRms) / (maxRms - minRms)) * 9) + 1;
    energy = Math.max(1, Math.min(10, energy));
    return energy;
}

// 2. Styled Energy Flame Rating HTML
function getEnergyBarHtml(level) {
    if (level === '--' || isNaN(level)) return '<span style="color: var(--text-muted);">--</span>';
    
    let barColor = 'var(--accent-colour)'; // low (cyan)
    if (level >= 8) barColor = '#ff3d00'; // high (red-orange)
    else if (level >= 5) barColor = '#ffb300'; // medium (amber)
    
    let flames = '';
    const numFlames = Math.ceil(level / 2); // 1 to 5 flame symbols
    for (let i = 0; i < 5; i++) {
        if (i < numFlames) {
            flames += `<span style="color: ${barColor}; filter: drop-shadow(0 0 2px ${barColor});">🔥</span>`;
        } else {
            flames += '<span style="opacity: 0.12;">🔥</span>';
        }
    }
    
    return `<div class="energy-bar-container" title="Energy Level: ${level}/10">${flames}</div>`;
}

// 3. Render Responsive SVG Camelot Wheel
function renderCamelotWheel() {
    const container = document.getElementById('camelot-wheel-container');
    if (!container) return;
    
    const size = 270;
    const center = size / 2;
    const rOuter = size / 2 - 8;
    const rMiddle = size / 2 - 40;
    const rInner = size / 2 - 72;
    
    let svgHtml = `<svg viewBox="0 0 ${size} ${size}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style="overflow: visible;">`;
    
    // Sectors hours in traditional 12-hour wheel format starting from 12 o'clock (12B/12A, 1B/1A, etc.)
    const hours = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    
    const getCoordinates = (percent) => {
        const x = Math.cos(2 * Math.PI * percent);
        const y = Math.sin(2 * Math.PI * percent);
        return [x, y];
    };
    
    for (let i = 0; i < 12; i++) {
        const hour = hours[i];
        // -0.25 percent shifts 0 degrees to 12 o'clock
        const startPercent = (i - 0.5) / 12 - 0.25;
        const endPercent = (i + 0.5) / 12 - 0.25;
        
        const [startXOuter, startYOuter] = getCoordinates(startPercent);
        const [endXOuter, endYOuter] = getCoordinates(endPercent);
        
        const [startXMiddle, startYMiddle] = getCoordinates(startPercent);
        const [endXMiddle, endYMiddle] = getCoordinates(endPercent);
        
        const [startXInner, startYInner] = getCoordinates(startPercent);
        const [endXInner, endYInner] = getCoordinates(endPercent);
        
        // Outer Ring Path (Major Keys - B)
        const pathB = [
            `M ${center + startXMiddle * rMiddle} ${center + startYMiddle * rMiddle}`,
            `L ${center + startXOuter * rOuter} ${center + startYOuter * rOuter}`,
            `A ${rOuter} ${rOuter} 0 0 1 ${center + endXOuter * rOuter} ${center + endYOuter * rOuter}`,
            `L ${center + endXMiddle * rMiddle} ${center + endYMiddle * rMiddle}`,
            `A ${rMiddle} ${rMiddle} 0 0 0 ${center + startXMiddle * rMiddle} ${center + startYMiddle * rMiddle}`,
            'Z'
        ].join(' ');
        
        // Inner Ring Path (Minor Keys - A)
        const pathA = [
            `M ${center + startXInner * rInner} ${center + startYInner * rInner}`,
            `L ${center + startXMiddle * rMiddle} ${center + startYMiddle * rMiddle}`,
            `A ${rMiddle} ${rMiddle} 0 0 1 ${center + endXMiddle * rMiddle} ${center + endYMiddle * rMiddle}`,
            `L ${center + endXInner * rInner} ${center + endYInner * rInner}`,
            `A ${rInner} ${rInner} 0 0 0 ${center + startXInner * rInner} ${center + startYInner * rInner}`,
            'Z'
        ].join(' ');
        
        const midPercent = i / 12 - 0.25;
        const [midX, midY] = getCoordinates(midPercent);
        const textB_R = (rOuter + rMiddle) / 2;
        const textA_R = (rMiddle + rInner) / 2;
        
        const keyB = `${hour}B`;
        const keyA = `${hour}A`;
        
        svgHtml += `
            <g class="wheel-group">
                <!-- B (Major) Outer Sector -->
                <path d="${pathB}" class="wheel-segment segment-b" data-key="${keyB}" fill="#161622" stroke="#222230" stroke-width="1.2" cursor="pointer">
                    <title>${keyB} (${camelotToStandard[keyB]})</title>
                </path>
                <text x="${center + midX * textB_R}" y="${center + midY * textB_R + 3.5}" fill="#9595aa" font-size="9.5" font-weight="700" text-anchor="middle" pointer-events="none">${keyB}</text>
                
                <!-- A (Minor) Inner Sector -->
                <path d="${pathA}" class="wheel-segment segment-a" data-key="${keyA}" fill="#111119" stroke="#222230" stroke-width="1.2" cursor="pointer">
                    <title>${keyA} (${camelotToStandard[keyA]})</title>
                </path>
                <text x="${center + midX * textA_R}" y="${center + midY * textA_R + 3.5}" fill="#78788c" font-size="9" font-weight="700" text-anchor="middle" pointer-events="none">${keyA}</text>
            </g>
        `;
    }
    
    // Add center display HUD
    svgHtml += `
        <circle cx="${center}" cy="${center}" r="${rInner}" fill="#0a0a0f" stroke="#222230" stroke-width="1.8" />
        <text x="${center}" y="${center - 4}" fill="var(--accent-colour)" font-size="11.5" font-weight="800" text-anchor="middle" letter-spacing="0.5px">HARMONIC</text>
        <text x="${center}" y="${center + 11}" fill="#78788c" font-size="9.5" font-weight="700" text-anchor="middle" letter-spacing="0.5px">HUD</text>
    `;
    
    svgHtml += '</svg>';
    container.innerHTML = svgHtml;
    
    // Bind segment click triggers
    container.querySelectorAll('.wheel-segment').forEach(seg => {
        seg.addEventListener('click', (e) => {
            const key = e.target.getAttribute('data-key');
            toggleKeyFilter(key);
        });
    });
}

// 4. Highlight Key and Compatible Sectors on Wheel
function highlightKeyOnWheel(camelotCode) {
    document.querySelectorAll('.wheel-segment').forEach(seg => {
        seg.classList.remove('selected', 'compatible');
        seg.style.fill = '';
        seg.style.fillOpacity = '';
        seg.style.filter = '';
        seg.style.stroke = '';
    });
    
    if (!camelotCode || camelotCode === 'Unknown') return;
    
    const target = document.querySelector(`.wheel-segment[data-key="${camelotCode}"]`);
    if (target) {
        target.classList.add('selected');
        const color = `var(--cam-${camelotCode.toLowerCase()})`;
        target.style.fill = color;
        target.style.filter = `drop-shadow(0 0 5px ${color})`;
        target.style.stroke = '#ffffff';
    }
    
    const compatible = getCompatibleKeys(camelotCode);
    compatible.forEach(key => {
        if (key === camelotCode) return;
        const compSeg = document.querySelector(`.wheel-segment[data-key="${key}"]`);
        if (compSeg) {
            compSeg.classList.add('compatible');
            const color = `var(--cam-${key.toLowerCase()})`;
            compSeg.style.fill = color;
            compSeg.style.fillOpacity = '0.35';
            compSeg.style.stroke = color;
        }
    });
}

// 5. Toggle List Key Filter via Wheel segments
let activeFilterKey = null;
function toggleKeyFilter(key) {
    const tableRows = document.querySelectorAll('tr.track-row.ready');
    const container = document.getElementById('camelot-wheel-container');
    const textCenter = container.querySelector('text[fill="var(--accent-colour)"]');
    const textSub = container.querySelector('text[fill="#78788c"]');
    
    if (activeFilterKey === key) {
        activeFilterKey = null;
        tableRows.forEach(r => r.style.display = '');
        highlightKeyOnWheel(null);
        if (textCenter) textCenter.textContent = "HARMONIC";
        if (textSub) textSub.textContent = "HUD";
    } else {
        activeFilterKey = key;
        const compatibles = [key, ...getCompatibleKeys(key)];
        tableRows.forEach(r => {
            const rowKey = r.getAttribute('data-key');
            r.style.display = compatibles.includes(rowKey) ? '' : 'none';
        });
        highlightKeyOnWheel(key);
        if (textCenter) textCenter.textContent = key;
        if (textSub) textSub.textContent = "FILTER ON";
    }
}

// 6. Header Column Sorting Setup
let sortCol = null;
let sortAsc = true;
function setupSorting() {
    document.querySelectorAll('th.sortable').forEach(header => {
        header.addEventListener('click', () => {
            const col = header.getAttribute('data-col');
            if (sortCol === col) {
                if (sortAsc) {
                    sortAsc = false;
                } else {
                    sortCol = null;
                }
            } else {
                sortCol = col;
                sortAsc = true;
            }
            updateSortIndicators();
            sortTable();
        });
    });
}

function updateSortIndicators() {
    document.querySelectorAll('th.sortable').forEach(header => {
        const col = header.getAttribute('data-col');
        const icon = header.querySelector('.sort-icon');
        if (col === sortCol) {
            icon.textContent = sortAsc ? ' ▲' : ' ▼';
            header.classList.add('active-sort');
        } else {
            icon.textContent = '';
            header.classList.remove('active-sort');
        }
    });
}

function sortTable() {
    const tbody = document.getElementById('results-body');
    const rows = Array.from(tbody.querySelectorAll('tr.track-row'));
    
    if (!sortCol) {
        // Fallback to original insertion order
        rows.sort((a, b) => {
            return parseInt(a.id.split('-')[2]) - parseInt(b.id.split('-')[2]);
        });
    } else {
        rows.sort((a, b) => {
            let valA, valB;
            
            if (sortCol === 'originalName') {
                valA = a.querySelector('.track-name').textContent.toLowerCase();
                valB = b.querySelector('.track-name').textContent.toLowerCase();
            } else if (sortCol === 'newName') {
                valA = a.querySelector('.new-name').textContent.toLowerCase();
                valB = b.querySelector('.new-name').textContent.toLowerCase();
            } else if (sortCol === 'bpm') {
                valA = parseFloat(a.getAttribute('data-bpm')) || 0;
                valB = parseFloat(b.getAttribute('data-bpm')) || 0;
            } else if (sortCol === 'key') {
                valA = getKeySortOrder(a.getAttribute('data-key'));
                valB = getKeySortOrder(b.getAttribute('data-key'));
            } else if (sortCol === 'energy') {
                valA = parseInt(a.getAttribute('data-energy')) || 0;
                valB = parseInt(b.getAttribute('data-energy')) || 0;
            } else if (sortCol === 'genre') {
                valA = (a.getAttribute('data-genre') || '').toLowerCase();
                valB = (b.getAttribute('data-genre') || '').toLowerCase();
            } else if (sortCol === 'status') {
                valA = a.querySelector('.status').textContent.toLowerCase();
                valB = b.querySelector('.status').textContent.toLowerCase();
            }
            
            if (valA < valB) return sortAsc ? -1 : 1;
            if (valA > valB) return sortAsc ? 1 : -1;
            return 0;
        });
    }
    
    rows.forEach(row => tbody.appendChild(row));
}

function getKeySortOrder(camelotCode) {
    if (!camelotCode || camelotCode === 'Unknown') return 999;
    const match = camelotCode.match(/^(\d+)([AB])$/);
    if (!match) return 999;
    
    const num = parseInt(match[1], 10);
    const ring = match[2];
    return (ring === 'A' ? 0 : 12) + num;
}

// 7. Beatgrid phase offset detection logic
function locateBeatGrid(channelData, sampleRate, bpm) {
    if (!bpm || bpm === 'Unknown' || isNaN(bpm)) return 0;
    const beatIntervalSamples = (60 / bpm) * sampleRate;
    
    // Calculate short-time energy envelope for the first 15 seconds
    const frameSize = 1024;
    const stepSize = 256;
    const energy = [];
    const searchLimit = Math.min(channelData.length, sampleRate * 15);
    
    for (let i = 0; i < searchLimit; i += stepSize) {
        let sum = 0;
        const limit = Math.min(channelData.length, i + frameSize);
        for (let j = i; j < limit; j++) {
            sum += channelData[j] * channelData[j];
        }
        energy.push(sum);
    }
    
    // Find the best phase (offset) between 0 and beatIntervalSamples
    let bestOffsetSamples = 0;
    let maxEnergySum = 0;
    
    const numCandidates = 60;
    for (let c = 0; c < numCandidates; c++) {
        const offsetSamples = (c / numCandidates) * beatIntervalSamples;
        let sum = 0;
        
        // Sum energy at grid points (e.g. first 12 beats)
        for (let t = 0; t < 12; t++) {
            const targetSample = offsetSamples + t * beatIntervalSamples;
            const energyIdx = Math.floor(targetSample / stepSize);
            if (energyIdx < energy.length) {
                sum += energy[energyIdx];
            }
        }
        
        if (sum > maxEnergySum) {
            maxEnergySum = sum;
            bestOffsetSamples = offsetSamples;
        }
    }
    
    return bestOffsetSamples / sampleRate;
}

// 8. View switching tab listeners
const btnViewCrate = document.getElementById('btn-view-crate');
const btnViewSetlist = document.getElementById('btn-view-setlist');
const crateView = document.getElementById('crate-view');
const setlistView = document.getElementById('setlist-view');

if (btnViewCrate && btnViewSetlist) {
    btnViewCrate.addEventListener('click', () => {
        btnViewCrate.classList.add('active');
        btnViewSetlist.classList.remove('active');
        crateView.style.display = 'flex';
        setlistView.style.display = 'none';
    });

    btnViewSetlist.addEventListener('click', () => {
        btnViewSetlist.classList.add('active');
        btnViewCrate.classList.remove('active');
        setlistView.style.display = 'flex';
        crateView.style.display = 'none';
        
        if (wavesurfer) wavesurfer.pause();
        
        populateSidebarGenres();
        renderSetlistSidebar();
        renderSetlistTimeline();
    });
}

// 9. Setlist Flow & Timeline reordering
let setlistTracks = [];
let timelineIdCounter = 0;

function addTrackToSetlist(trackIndex) {
    const track = exportData[trackIndex];
    if (!track) return;
    
    setlistTracks.push({
        trackIndex: trackIndex,
        id: `setlist-item-${timelineIdCounter++}`
    });
    
    renderSetlistTimeline();
}

function removeTrackFromSetlist(index) {
    setlistTracks.splice(index, 1);
    renderSetlistTimeline();
}

let sidebarSearchVal = '';
let sidebarGenreVal = 'all';
let sidebarCompatOnly = false;

function setupSidebarFilterListeners() {
    const search = document.getElementById('sidebar-search');
    const genreFilter = document.getElementById('sidebar-genre-filter');
    const compatFilter = document.getElementById('sidebar-compat-filter');
    
    if (search) {
        search.addEventListener('input', (e) => {
            sidebarSearchVal = e.target.value.toLowerCase();
            renderSetlistSidebar();
        });
    }
    
    if (genreFilter) {
        genreFilter.addEventListener('change', (e) => {
            sidebarGenreVal = e.target.value;
            renderSetlistSidebar();
        });
    }
    
    if (compatFilter) {
        compatFilter.addEventListener('change', (e) => {
            sidebarCompatOnly = e.target.checked;
            renderSetlistSidebar();
        });
    }
}

function populateSidebarGenres() {
    const genreFilter = document.getElementById('sidebar-genre-filter');
    if (!genreFilter) return;
    
    const currentSelection = genreFilter.value;
    const genres = new Set();
    
    exportData.forEach(track => {
        if (track.genre && track.genre !== 'Unknown') {
            genres.add(track.genre);
        }
    });
    
    const sortedGenres = Array.from(genres).sort();
    
    let html = '<option value="all">All Genres</option>';
    sortedGenres.forEach(g => {
        html += `<option value="${g}">${g}</option>`;
    });
    
    genreFilter.innerHTML = html;
    
    if (sortedGenres.includes(currentSelection)) {
        genreFilter.value = currentSelection;
        sidebarGenreVal = currentSelection;
    } else {
        genreFilter.value = 'all';
        sidebarGenreVal = 'all';
    }
}

function renderSetlistSidebar() {
    const listContainer = document.getElementById('setlist-library-list');
    if (!listContainer) return;
    
    if (exportData.length === 0) {
        listContainer.innerHTML = `
            <div style="font-size: 0.85rem; color: var(--text-muted); text-align: center; padding: 1.5rem 0;">
                No tracks analyzed yet. Click 'Crate Library' to select a folder.
            </div>
        `;
        return;
    }
    
    let activeKey = null;
    if (wavesurferA && wavesurferA.getDuration() > 0 && loadedTrackIndexA !== -1) {
        activeKey = exportData[loadedTrackIndexA].key;
    } else if (wavesurferB && wavesurferB.getDuration() > 0 && loadedTrackIndexB !== -1) {
        activeKey = exportData[loadedTrackIndexB].key;
    }
    
    let html = '';
    const format = notationSelect.value;
    let filteredCount = 0;
    
    exportData.forEach((track, index) => {
        // 1. Search Query Filter
        if (sidebarSearchVal) {
            if (!track.originalName.toLowerCase().includes(sidebarSearchVal)) {
                return;
            }
        }
        
        // 2. Genre Dropdown Filter
        if (sidebarGenreVal !== 'all') {
            if (track.genre !== sidebarGenreVal) {
                return;
            }
        }
        
        // 3. Harmonic Key Compatibility Filter (matching Deck A/B active track)
        if (sidebarCompatOnly && activeKey) {
            const compatibleList = getCompatibleKeys(activeKey);
            if (!compatibleList.includes(track.key)) {
                return;
            }
        }
        
        filteredCount++;
        
        const keyVal = formatKey(track.key, track.keyText, format);
        const keyBadgeColor = track.key !== "Unknown" ? `var(--cam-${track.key.toLowerCase()})` : "var(--border-colour)";
        
        html += `
            <div class="setlist-lib-item" data-index="${index}">
                <div class="setlist-lib-title" title="${track.originalName}">${track.originalName}</div>
                <div class="setlist-lib-meta">
                    <span class="badge" style="background-color: ${keyBadgeColor}; color: #000; font-size: 0.75rem; padding: 2px 6px; font-weight: 800;">${keyVal}</span>
                    <span style="font-family: monospace; font-size: 0.8rem; font-weight: bold; color: var(--accent-colour);">${track.bpm} BPM</span>
                    <button class="action-icon-btn add-to-timeline-btn" data-index="${index}" title="Add to Setlist Timeline" style="color: var(--accent-colour);">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </button>
                </div>
            </div>
        `;
    });
    
    if (filteredCount === 0) {
        listContainer.innerHTML = `
            <div style="font-size: 0.85rem; color: var(--text-muted); text-align: center; padding: 1.5rem 0;">
                No matching tracks found.
            </div>
        `;
        return;
    }
    
    listContainer.innerHTML = html;
    
    listContainer.querySelectorAll('.add-to-timeline-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.getAttribute('data-index'), 10);
            addTrackToSetlist(idx);
        });
    });

    listContainer.querySelectorAll('.setlist-lib-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.add-to-timeline-btn')) return;
            const idx = parseInt(item.getAttribute('data-index'), 10);
            addTrackToSetlist(idx);
        });
    });
}

function renderSetlistTimeline() {
    const container = document.getElementById('setlist-timeline');
    if (!container) return;
    
    if (setlistTracks.length === 0) {
        container.innerHTML = `
            <div style="color: var(--text-muted); text-align: center; padding: 2.2rem 0; font-size: 0.85rem; font-weight: 500;">
                Drag tracks from the sidebar library here or click their '+' button to build your set.
            </div>
        `;
        updateMixerControlsState();
        return;
    }
    
    const format = notationSelect.value;
    let html = '';
    
    for (let i = 0; i < setlistTracks.length; i++) {
        const item = setlistTracks[i];
        const track = exportData[item.trackIndex];
        const keyVal = formatKey(track.key, track.keyText, format);
        const keyBadgeColor = track.key !== "Unknown" ? `var(--cam-${track.key.toLowerCase()})` : "var(--border-colour)";
        
        html += `
            <div class="timeline-card" id="${item.id}" data-index="${i}" draggable="true">
                <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex-grow: 1;">
                    <div class="timeline-card-drag-handle">☰</div>
                    <div class="timeline-card-details">
                        <div class="timeline-card-title" title="${track.originalName}">${track.originalName}</div>
                        <div class="timeline-card-meta">
                            <span class="badge" style="background-color: ${keyBadgeColor}; color: #000; font-size: 0.75rem; padding: 1px 5px; font-weight: 800;">${keyVal}</span>
                            <span style="font-family: monospace; font-size: 0.8rem; font-weight: bold; color: var(--accent-colour);">${track.bpm} BPM</span>
                            <span style="font-size: 0.75rem; color: var(--text-muted);">${track.genre || "Unknown"}</span>
                        </div>
                    </div>
                </div>
                <div class="timeline-card-actions">
                    <button class="action-icon-btn load-deck-btn" data-deck="a" data-index="${i}" title="Load to Deck A" style="color: var(--accent-colour); font-size: 0.75rem; font-weight: 800; border: 1px solid rgba(0, 229, 255, 0.2); padding: 2px 6px;">LOAD A</button>
                    <button class="action-icon-btn load-deck-btn" data-deck="b" data-index="${i}" title="Load to Deck B" style="color: #e3e553; font-size: 0.75rem; font-weight: 800; border: 1px solid rgba(227, 229, 83, 0.2); padding: 2px 6px;">LOAD B</button>
                    <button class="action-icon-btn delete-btn remove-timeline-btn" data-index="${i}" title="Remove from Setlist">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
            </div>
        `;
        
        if (i < setlistTracks.length - 1) {
            const nextItem = setlistTracks[i + 1];
            const nextTrack = exportData[nextItem.trackIndex];
            const transInfo = getTransitionCompatibility(track, nextTrack);
            
            html += `
                <div class="transition-flow-indicator ${transInfo.class}">
                    <span>${transInfo.icon}</span>
                    <span>${transInfo.text}</span>
                    <span style="font-family: monospace; font-size: 0.75rem; opacity: 0.8;">(${transInfo.bpmDiff > 0 ? '+' : ''}${transInfo.bpmDiff.toFixed(1)}% BPM)</span>
                </div>
            `;
        }
    }
    
    container.innerHTML = html;
    
    container.querySelectorAll('.remove-timeline-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.getAttribute('data-index'), 10);
            removeTrackFromSetlist(idx);
        });
    });
    
    container.querySelectorAll('.load-deck-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const deck = btn.getAttribute('data-deck');
            const idx = parseInt(btn.getAttribute('data-index'), 10);
            loadTrackToDeck(deck, idx);
        });
    });
    
    setupTimelineDragAndDrop();
    updateMixerControlsState();
}

function getTransitionCompatibility(track1, track2) {
    const bpm1 = parseFloat(track1.bpm);
    const bpm2 = parseFloat(track2.bpm);
    let bpmDiff = 0;
    if (bpm1 > 0 && bpm2 > 0) {
        bpmDiff = ((bpm2 - bpm1) / bpm1) * 100;
    }
    
    const key1 = track1.key;
    const key2 = track2.key;
    
    if (key1 === 'Unknown' || key2 === 'Unknown') {
        return { class: 'compatible', icon: '❓', text: 'Unknown Key Transition', bpmDiff };
    }
    
    if (key1 === key2) {
        return { class: 'perfect', icon: '✨', text: 'Perfect Match (Same Key)', bpmDiff };
    }
    
    const compKeys = getCompatibleKeys(key1);
    if (compKeys.includes(key2)) {
        const match1 = key1.match(/^(\d+)([AB])$/);
        const match2 = key2.match(/^(\d+)([AB])$/);
        const h1 = parseInt(match1[1], 10);
        const l1 = match1[2];
        const h2 = parseInt(match2[1], 10);
        const l2 = match2[2];
        
        let typeText = 'Compatible Key';
        if (l1 !== l2) {
            typeText = 'Relative Major/Minor';
        } else if (h2 === (h1 === 12 ? 1 : h1 + 1) || h2 === (h1 === 1 ? 12 : h1 - 1)) {
            typeText = 'Adjacent Hour Shift';
        }
        
        return { class: 'perfect', icon: '✅', text: typeText, bpmDiff };
    }
    
    const match1 = key1.match(/^(\d+)([AB])$/);
    const match2 = key2.match(/^(\d+)([AB])$/);
    const h1 = parseInt(match1[1], 10);
    const l1 = match1[2];
    const h2 = parseInt(match2[1], 10);
    const l2 = match2[2];
    
    const dist = Math.abs(h2 - h1);
    const circularDist = Math.min(dist, 12 - dist);
    
    if (l1 === l2 && circularDist === 2) {
        return { class: 'compatible', icon: '⚡', text: 'Energy Boost (+2 Hours)', bpmDiff };
    }
    
    if (Math.abs(bpmDiff) <= 3) {
        return { class: 'compatible', icon: '🎚️', text: 'Tempo Match (BPM Compatible)', bpmDiff };
    }
    
    return { class: 'clash', icon: '⚠️', text: 'Harmonic Clash', bpmDiff };
}

function setupTimelineDragAndDrop() {
    const container = document.getElementById('setlist-timeline');
    const cards = container.querySelectorAll('.timeline-card');
    
    cards.forEach(card => {
        card.addEventListener('dragstart', (e) => {
            card.classList.add('dragging');
            e.dataTransfer.setData('text/plain', card.getAttribute('data-index'));
        });
        
        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
            renderSetlistTimeline();
        });
    });
    
    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        container.classList.add('drag-over');
        
        const afterElement = getDragAfterElement(container, e.clientY);
        const dragging = container.querySelector('.dragging');
        if (dragging) {
            if (afterElement == null) {
                container.appendChild(dragging);
            } else {
                container.insertBefore(dragging, afterElement);
            }
        }
    });
    
    container.addEventListener('dragleave', () => {
        container.classList.remove('drag-over');
    });
    
    container.addEventListener('drop', (e) => {
        e.preventDefault();
        container.classList.remove('drag-over');
        
        const reordered = [];
        container.querySelectorAll('.timeline-card').forEach(card => {
            const oldIdx = parseInt(card.getAttribute('data-index'), 10);
            reordered.push(setlistTracks[oldIdx]);
        });
        
        setlistTracks = reordered;
        renderSetlistTimeline();
    });
}

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.timeline-card:not(.dragging)')];
    
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// 10. Dual-Deck DJ Mixer controls
let wavesurferA = null;
let wavesurferB = null;
let activeObjectUrlA = null;
let activeObjectUrlB = null;

let trackBpmA = 0;
let trackBpmB = 0;
let trackOffsetA = 0;
let trackOffsetB = 0;

function initMixerDecks() {
    if (wavesurferA || wavesurferB) return;
    
    wavesurferA = WaveSurfer.create({
        container: '#waveform-a',
        waveColor: '#303045',
        progressColor: 'var(--accent-colour)',
        cursorColor: '#ffffff',
        barWidth: 1.5,
        barGap: 1,
        height: 50,
        normalize: true
    });
    
    wavesurferB = WaveSurfer.create({
        container: '#waveform-b',
        waveColor: '#303045',
        progressColor: '#e3e553',
        cursorColor: '#ffffff',
        barWidth: 1.5,
        barGap: 1,
        height: 50,
        normalize: true
    });
    
    wavesurferA.on('play', () => {
        document.getElementById('deck-a-play').classList.add('playing');
        document.getElementById('deck-a-play').textContent = 'Pause';
        updateMixerControlsState();
    });
    wavesurferA.on('pause', () => {
        document.getElementById('deck-a-play').classList.remove('playing');
        document.getElementById('deck-a-play').textContent = 'Play';
        updateMixerControlsState();
    });
    
    wavesurferB.on('play', () => {
        document.getElementById('deck-b-play').classList.add('playing');
        document.getElementById('deck-b-play').textContent = 'Pause';
        updateMixerControlsState();
    });
    wavesurferB.on('pause', () => {
        document.getElementById('deck-b-play').classList.remove('playing');
        document.getElementById('deck-b-play').textContent = 'Play';
        updateMixerControlsState();
    });
    
    document.getElementById('deck-a-play').addEventListener('click', () => wavesurferA.playPause());
    document.getElementById('deck-b-play').addEventListener('click', () => wavesurferB.playPause());
    
    const sliderPitchA = document.getElementById('deck-a-pitch');
    const labelPitchA = document.getElementById('deck-a-pitch-label');
    sliderPitchA.addEventListener('input', () => {
        const rate = parseFloat(sliderPitchA.value);
        labelPitchA.textContent = `${rate.toFixed(2)}x`;
        wavesurferA.setPlaybackRate(rate);
        if (trackBpmA > 0) {
            const currentBpm = trackBpmA * rate;
            document.getElementById('deck-a-bpm-display').textContent = `${currentBpm.toFixed(1)} BPM`;
        }
    });
    
    const sliderPitchB = document.getElementById('deck-b-pitch');
    const labelPitchB = document.getElementById('deck-b-pitch-label');
    sliderPitchB.addEventListener('input', () => {
        const rate = parseFloat(sliderPitchB.value);
        labelPitchB.textContent = `${rate.toFixed(2)}x`;
        wavesurferB.setPlaybackRate(rate);
        if (trackBpmB > 0) {
            const currentBpm = trackBpmB * rate;
            document.getElementById('deck-b-bpm-display').textContent = `${currentBpm.toFixed(1)} BPM`;
        }
    });
    
    document.getElementById('deck-a-vol').addEventListener('input', updateDeckVolumes);
    document.getElementById('deck-b-vol').addEventListener('input', updateDeckVolumes);
    document.getElementById('crossfader').addEventListener('input', updateDeckVolumes);
    
    document.getElementById('deck-a-sync').addEventListener('click', () => syncDeckTo('a'));
    document.getElementById('deck-b-sync').addEventListener('click', () => syncDeckTo('b'));
    document.getElementById('btn-automix').addEventListener('click', triggerAutoMix);
    
    // Grid Nudges
    document.getElementById('deck-a-grid-left').addEventListener('click', () => nudgeGrid('a', 'left'));
    document.getElementById('deck-a-grid-right').addEventListener('click', () => nudgeGrid('a', 'right'));
    document.getElementById('deck-b-grid-left').addEventListener('click', () => nudgeGrid('b', 'left'));
    document.getElementById('deck-b-grid-right').addEventListener('click', () => nudgeGrid('b', 'right'));
    
    // Jog Platter Bends
    document.getElementById('deck-a-bend-left').addEventListener('click', () => triggerJogBend('a', 'left'));
    document.getElementById('deck-a-bend-right').addEventListener('click', () => triggerJogBend('a', 'right'));
    document.getElementById('deck-b-bend-left').addEventListener('click', () => triggerJogBend('b', 'left'));
    document.getElementById('deck-b-bend-right').addEventListener('click', () => triggerJogBend('b', 'right'));
    
    // Metronome Toggles
    const metroBtnA = document.getElementById('deck-a-metronome');
    metroBtnA.addEventListener('click', () => {
        metronomeActiveA = !metronomeActiveA;
        if (metronomeActiveA) {
            metroBtnA.classList.add('active');
            metroBtnA.querySelector('span:last-child').textContent = '🔊';
            audioContext.resume();
        } else {
            metroBtnA.classList.remove('active');
            metroBtnA.querySelector('span:last-child').textContent = '🔇';
        }
    });
    
    const metroBtnB = document.getElementById('deck-b-metronome');
    metroBtnB.addEventListener('click', () => {
        metronomeActiveB = !metronomeActiveB;
        if (metronomeActiveB) {
            metroBtnB.classList.add('active');
            metroBtnB.querySelector('span:last-child').textContent = '🔊';
            audioContext.resume();
        } else {
            metroBtnB.classList.remove('active');
            metroBtnB.querySelector('span:last-child').textContent = '🔇';
        }
    });
    
    // Quantized Loop Sizes & Toggles
    document.querySelectorAll('.loop-size-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const deck = btn.getAttribute('data-deck');
            const size = parseInt(btn.getAttribute('data-size'), 10);
            setLoopSize(deck, size);
        });
    });
    
    document.getElementById('deck-a-loop-toggle').addEventListener('click', () => toggleLoop('a'));
    document.getElementById('deck-b-loop-toggle').addEventListener('click', () => toggleLoop('b'));
    
    // Layout switcher
    const btnToggleLayout = document.getElementById('btn-toggle-layout');
    const decksContainer = document.querySelector('.decks-container');
    let isLayoutStacked = false;
    
    if (btnToggleLayout && decksContainer) {
        btnToggleLayout.addEventListener('click', () => {
            isLayoutStacked = !isLayoutStacked;
            if (isLayoutStacked) {
                decksContainer.classList.add('layout-stacked');
                btnToggleLayout.textContent = 'Layout: Stacked';
                btnToggleLayout.classList.add('active');
            } else {
                decksContainer.classList.remove('layout-stacked');
                btnToggleLayout.textContent = 'Layout: Side-by-Side';
                btnToggleLayout.classList.remove('active');
            }
            // Redraw waveforms
            setTimeout(() => {
                if (wavesurferA) drawBeatGridLines('a', trackBpmA, trackOffsetA);
                if (wavesurferB) drawBeatGridLines('b', trackBpmB, trackOffsetB);
            }, 100);
        });
    }
}

function updateDeckVolumes() {
    const volA = parseFloat(document.getElementById('deck-a-vol').value);
    const volB = parseFloat(document.getElementById('deck-b-vol').value);
    const crossValue = parseFloat(document.getElementById('crossfader').value);
    
    let gainA = 1;
    let gainB = 1;
    
    if (crossValue > 0) {
        gainA = 1 - crossValue;
    } else if (crossValue < 0) {
        gainB = 1 + crossValue;
    }
    
    if (wavesurferA) wavesurferA.setVolume(volA * gainA);
    if (wavesurferB) wavesurferB.setVolume(volB * gainB);
}

function loadTrackToDeck(deck, timelineIdx) {
    initMixerDecks();
    
    const setlistItem = setlistTracks[timelineIdx];
    if (!setlistItem) return;
    
    const track = exportData[setlistItem.trackIndex];
    if (!track || !track.fileObject) return;
    
    const objectUrl = URL.createObjectURL(track.fileObject);
    
    if (deck === 'a') {
        if (activeObjectUrlA) URL.revokeObjectURL(activeObjectUrlA);
        activeObjectUrlA = objectUrl;
        loadedTrackIndexA = setlistItem.trackIndex;
        
        document.getElementById('deck-a-title').textContent = track.originalName;
        document.getElementById('deck-a-bpm-display').textContent = `${track.bpm} BPM`;
        
        // Reset Loop & Metronome states
        loopActiveA = false;
        const loopBtn = document.getElementById('deck-a-loop-toggle');
        loopBtn.textContent = 'LOOP OFF';
        loopBtn.classList.remove('active');
        
        metronomeActiveA = false;
        const metroBtn = document.getElementById('deck-a-metronome');
        metroBtn.classList.remove('active');
        metroBtn.querySelector('span:last-child').textContent = '🔇';
        
        trackBpmA = parseFloat(track.bpm) || 120;
        trackOffsetA = track.beatOffset || 0.0;
        
        enableDeckControls('a', true);
        
        wavesurferA.load(objectUrl);
        wavesurferA.unAll();
        
        wavesurferA.on('play', () => {
            document.getElementById('deck-a-play').classList.add('playing');
            document.getElementById('deck-a-play').textContent = 'Pause';
            updateMixerControlsState();
        });
        wavesurferA.on('pause', () => {
            document.getElementById('deck-a-play').classList.remove('playing');
            document.getElementById('deck-a-play').textContent = 'Play';
            updateMixerControlsState();
        });
        
        wavesurferA.once('decode', () => {
            const decoded = wavesurferA.getDecodedData();
            if (decoded) {
                const channelData = decoded.getChannelData(0);
                
                // On-the-fly beatgrid extraction
                if (!track.beatOffset) {
                    track.beatOffset = locateBeatGrid(channelData, decoded.sampleRate, trackBpmA);
                }
                trackOffsetA = track.beatOffset || 0.0;
                
                // On-the-fly energy extraction
                if (!track.energy || track.energy === '--') {
                    track.energy = calculateEnergyLevel(channelData);
                    if (track.rowId) {
                        const row = document.getElementById(track.rowId);
                        if (row) {
                            row.setAttribute('data-energy', track.energy);
                            const energyVal = row.querySelector('.energy-value');
                            if (energyVal) energyVal.innerHTML = getEnergyBarHtml(track.energy);
                        }
                    }
                }
            }
            
            wavesurferA.setPlaybackRate(1.00);
            drawBeatGridLines('a', trackBpmA, trackOffsetA);
            updateMixerControlsState();
        });
        
        wavesurferA.on('timeupdate', (time) => {
            checkMetronomeTick('a', time);
            checkLoopBoundaries('a', time);
        });
        
    } else {
        if (activeObjectUrlB) URL.revokeObjectURL(activeObjectUrlB);
        activeObjectUrlB = objectUrl;
        loadedTrackIndexB = setlistItem.trackIndex;
        
        document.getElementById('deck-b-title').textContent = track.originalName;
        document.getElementById('deck-b-bpm-display').textContent = `${track.bpm} BPM`;
        
        // Reset Loop & Metronome states
        loopActiveB = false;
        const loopBtn = document.getElementById('deck-b-loop-toggle');
        loopBtn.textContent = 'LOOP OFF';
        loopBtn.classList.remove('active');
        
        metronomeActiveB = false;
        const metroBtn = document.getElementById('deck-b-metronome');
        metroBtn.classList.remove('active');
        metroBtn.querySelector('span:last-child').textContent = '🔇';
        
        trackBpmB = parseFloat(track.bpm) || 120;
        trackOffsetB = track.beatOffset || 0.0;
        
        enableDeckControls('b', true);
        
        wavesurferB.load(objectUrl);
        wavesurferB.unAll();
        
        wavesurferB.on('play', () => {
            document.getElementById('deck-b-play').classList.add('playing');
            document.getElementById('deck-b-play').textContent = 'Pause';
            updateMixerControlsState();
        });
        wavesurferB.on('pause', () => {
            document.getElementById('deck-b-play').classList.remove('playing');
            document.getElementById('deck-b-play').textContent = 'Play';
            updateMixerControlsState();
        });
        
        wavesurferB.once('decode', () => {
            const decoded = wavesurferB.getDecodedData();
            if (decoded) {
                const channelData = decoded.getChannelData(0);
                
                // On-the-fly beatgrid extraction
                if (!track.beatOffset) {
                    track.beatOffset = locateBeatGrid(channelData, decoded.sampleRate, trackBpmB);
                }
                trackOffsetB = track.beatOffset || 0.0;
                
                // On-the-fly energy extraction
                if (!track.energy || track.energy === '--') {
                    track.energy = calculateEnergyLevel(channelData);
                    if (track.rowId) {
                        const row = document.getElementById(track.rowId);
                        if (row) {
                            row.setAttribute('data-energy', track.energy);
                            const energyVal = row.querySelector('.energy-value');
                            if (energyVal) energyVal.innerHTML = getEnergyBarHtml(track.energy);
                        }
                    }
                }
            }
            
            wavesurferB.setPlaybackRate(1.00);
            drawBeatGridLines('b', trackBpmB, trackOffsetB);
            updateMixerControlsState();
        });
        
        wavesurferB.on('timeupdate', (time) => {
            checkMetronomeTick('b', time);
            checkLoopBoundaries('b', time);
        });
    }
}

function drawBeatGridLines(deck, bpm, offset) {
    const ws = deck === 'a' ? wavesurferA : wavesurferB;
    const containerId = deck === 'a' ? 'waveform-a' : 'waveform-b';
    const container = document.getElementById(containerId);
    if (!container || !ws) return;
    
    container.querySelectorAll('.beatgrid-line').forEach(l => l.remove());
    
    const duration = ws.getDuration();
    const beatInterval = 60 / bpm;
    let t = offset;
    
    const wsWrapper = container.querySelector('div');
    if (!wsWrapper) return;
    
    while (t < duration) {
        const percent = (t / duration) * 100;
        const line = document.createElement('div');
        line.className = 'beatgrid-line';
        line.style.left = `${percent}%`;
        wsWrapper.appendChild(line);
        t += beatInterval;
    }
}

function syncDeckTo(targetDeck) {
    if (!wavesurferA || !wavesurferB) return;
    
    if (targetDeck === 'b') {
        if (trackBpmB <= 0 || trackBpmA <= 0) return;
        
        const currentRateA = parseFloat(document.getElementById('deck-a-pitch').value) || 1.0;
        const currentBpmA = trackBpmA * currentRateA;
        const targetRate = currentBpmA / trackBpmB;
        
        document.getElementById('deck-b-pitch').value = targetRate.toFixed(3);
        document.getElementById('deck-b-pitch-label').textContent = `${targetRate.toFixed(2)}x`;
        wavesurferB.setPlaybackRate(targetRate);
        document.getElementById('deck-b-bpm-display').textContent = `${currentBpmA.toFixed(1)} BPM`;
        
        const timeA = wavesurferA.getCurrentTime();
        const intervalA = 60 / currentBpmA;
        const currentBeatIndexA = (timeA - trackOffsetA) / intervalA;
        
        const intervalB_pitched = 60 / (trackBpmB * targetRate);
        const targetTimeB = (currentBeatIndexA * intervalB_pitched) + trackOffsetB;
        
        wavesurferB.setTime(targetTimeB);
    } else {
        if (trackBpmA <= 0 || trackBpmB <= 0) return;
        
        const currentRateB = parseFloat(document.getElementById('deck-b-pitch').value) || 1.0;
        const currentBpmB = trackBpmB * currentRateB;
        const targetRate = currentBpmB / trackBpmA;
        
        document.getElementById('deck-a-pitch').value = targetRate.toFixed(3);
        document.getElementById('deck-a-pitch-label').textContent = `${targetRate.toFixed(2)}x`;
        wavesurferA.setPlaybackRate(targetRate);
        document.getElementById('deck-a-bpm-display').textContent = `${currentBpmB.toFixed(1)} BPM`;
        
        const timeB = wavesurferB.getCurrentTime();
        const intervalB = 60 / currentBpmB;
        const currentBeatIndexB = (timeB - trackOffsetB) / intervalB;
        
        const intervalA_pitched = 60 / (trackBpmA * targetRate);
        const targetTimeA = (currentBeatIndexB * intervalA_pitched) + trackOffsetA;
        
        wavesurferA.setTime(targetTimeA);
    }
}

let isAutomixing = false;
function triggerAutoMix() {
    if (isAutomixing) return;
    if (!wavesurferA || !wavesurferB) return;
    
    const isPlayingA = wavesurferA.isPlaying();
    const isPlayingB = wavesurferB.isPlaying();
    
    if (!isPlayingA && !isPlayingB) return;
    if (isPlayingA && isPlayingB) return;
    
    isAutomixing = true;
    document.getElementById('btn-automix').disabled = true;
    
    const sourceDeck = isPlayingA ? 'a' : 'b';
    const targetDeck = sourceDeck === 'a' ? 'b' : 'a';
    
    const wsSrc = sourceDeck === 'a' ? wavesurferA : wavesurferB;
    const wsTgt = sourceDeck === 'a' ? wavesurferB : wavesurferA;
    
    const bpmSrc = sourceDeck === 'a' ? trackBpmA : trackBpmB;
    
    syncDeckTo(targetDeck);
    wsTgt.play();
    
    const transitionDurationSec = (64 / bpmSrc) * 60;
    const startTime = Date.now();
    const startCrossValue = sourceDeck === 'a' ? -1 : 1;
    const endCrossValue = sourceDeck === 'a' ? 1 : -1;
    
    const crossfader = document.getElementById('crossfader');
    
    const fadeInterval = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        const progress = Math.min(1, elapsed / transitionDurationSec);
        
        const currentValue = startCrossValue + progress * (endCrossValue - startCrossValue);
        crossfader.value = currentValue.toFixed(2);
        updateDeckVolumes();
        
        if (progress >= 1) {
            clearInterval(fadeInterval);
            wsSrc.pause();
            
            crossfader.value = "0";
            document.getElementById('deck-a-vol').value = sourceDeck === 'a' ? "0.0" : "0.8";
            document.getElementById('deck-b-vol').value = sourceDeck === 'b' ? "0.0" : "0.8";
            updateDeckVolumes();
            
            isAutomixing = false;
            document.getElementById('btn-automix').disabled = false;
            updateMixerControlsState();
        }
    }, 100);
}

function updateMixerControlsState() {
    const isLoadedA = wavesurferA && wavesurferA.getDuration() > 0;
    const isLoadedB = wavesurferB && wavesurferB.getDuration() > 0;
    
    document.getElementById('deck-a-sync').disabled = !(isLoadedA && isLoadedB);
    document.getElementById('deck-b-sync').disabled = !(isLoadedA && isLoadedB);
    document.getElementById('btn-automix').disabled = !(isLoadedA && isLoadedB && (wavesurferA.isPlaying() || wavesurferB.isPlaying()));
}

// -------------------------------------------------------------
// Advanced DJ Mixer Implementation (Nudge, Jog Bend, Loop, Metronome)
// -------------------------------------------------------------
let loadedTrackIndexA = -1;
let loadedTrackIndexB = -1;

let loopActiveA = false;
let loopActiveB = false;
let loopStartA = 0;
let loopStartB = 0;
let loopEndA = 0;
let loopEndB = 0;
let loopSizeA = 1;
let loopSizeB = 1;

let metronomeActiveA = false;
let metronomeActiveB = false;
let lastTickIndexA = -1;
let lastTickIndexB = -1;

let bendTimeoutA = null;
let bendTimeoutB = null;

function enableDeckControls(deck, enabled) {
    const d = deck.toLowerCase();
    document.getElementById(`deck-${d}-play`).disabled = !enabled;
    document.getElementById(`deck-${d}-pitch`).disabled = !enabled;
    
    document.getElementById(`deck-${d}-grid-left`).disabled = !enabled;
    document.getElementById(`deck-${d}-grid-right`).disabled = !enabled;
    document.getElementById(`deck-${d}-bend-left`).disabled = !enabled;
    document.getElementById(`deck-${d}-bend-right`).disabled = !enabled;
    document.getElementById(`deck-${d}-metronome`).disabled = !enabled;
    document.getElementById(`deck-${d}-loop-toggle`).disabled = !enabled;
    
    document.querySelectorAll(`.loop-size-btn[data-deck="${d}"]`).forEach(btn => {
        btn.disabled = !enabled;
    });
}

function nudgeGrid(deck, direction) {
    const step = 0.01; // 10ms step size
    if (deck === 'a') {
        trackOffsetA += (direction === 'right' ? step : -step);
        if (trackOffsetA < 0) trackOffsetA = 0;
        
        if (loadedTrackIndexA !== -1 && exportData[loadedTrackIndexA]) {
            exportData[loadedTrackIndexA].beatOffset = trackOffsetA;
        }
        drawBeatGridLines('a', trackBpmA, trackOffsetA);
    } else {
        trackOffsetB += (direction === 'right' ? step : -step);
        if (trackOffsetB < 0) trackOffsetB = 0;
        
        if (loadedTrackIndexB !== -1 && exportData[loadedTrackIndexB]) {
            exportData[loadedTrackIndexB].beatOffset = trackOffsetB;
        }
        drawBeatGridLines('b', trackBpmB, trackOffsetB);
    }
}

function triggerJogBend(deck, direction) {
    const ws = deck === 'a' ? wavesurferA : wavesurferB;
    if (!ws || !ws.isPlaying()) return;
    
    const slider = document.getElementById(`deck-${deck}-pitch`);
    const originalRate = parseFloat(slider.value) || 1.0;
    
    const bendAmount = 0.035; // 3.5% speed bend
    const targetRate = direction === 'right' ? originalRate + bendAmount : originalRate - bendAmount;
    
    ws.setPlaybackRate(targetRate);
    
    if (deck === 'a') {
        if (bendTimeoutA) clearTimeout(bendTimeoutA);
        bendTimeoutA = setTimeout(() => {
            wavesurferA.setPlaybackRate(originalRate);
            bendTimeoutA = null;
        }, 150);
    } else {
        if (bendTimeoutB) clearTimeout(bendTimeoutB);
        bendTimeoutB = setTimeout(() => {
            wavesurferB.setPlaybackRate(originalRate);
            bendTimeoutB = null;
        }, 150);
    }
}

function checkMetronomeTick(deck, time) {
    const active = deck === 'a' ? metronomeActiveA : metronomeActiveB;
    if (!active) return;
    
    const bpm = deck === 'a' ? trackBpmA : trackBpmB;
    const offset = deck === 'a' ? trackOffsetA : trackOffsetB;
    const slider = document.getElementById(`deck-${deck}-pitch`);
    const rate = parseFloat(slider.value) || 1.0;
    const currentBpm = bpm * rate;
    
    if (currentBpm <= 0) return;
    
    const interval = 60 / currentBpm;
    const relativeTime = time - offset;
    const beatIndex = Math.round(relativeTime / interval);
    const beatTime = offset + beatIndex * interval;
    
    const windowSec = 0.035; // 35ms beat-matching precision window
    const dist = Math.abs(time - beatTime);
    const lastIdx = deck === 'a' ? lastTickIndexA : lastTickIndexB;
    
    if (dist < windowSec && beatIndex !== lastIdx && beatIndex >= 0) {
        if (deck === 'a') lastTickIndexA = beatIndex;
        else lastTickIndexB = beatIndex;
        
        playMetronomeClick();
    }
}

function playMetronomeClick() {
    try {
        const osc = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        osc.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        osc.frequency.setValueAtTime(900, audioContext.currentTime); // synth beep frequency
        gainNode.gain.setValueAtTime(0.18, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.035);
        
        osc.start(audioContext.currentTime);
        osc.stop(audioContext.currentTime + 0.04);
    } catch (e) {
        console.warn("Could not trigger metronome tick:", e);
    }
}

function toggleLoop(deck) {
    const ws = deck === 'a' ? wavesurferA : wavesurferB;
    if (!ws) return;
    
    const active = deck === 'a' ? loopActiveA : loopActiveB;
    const button = document.getElementById(`deck-${deck}-loop-toggle`);
    
    if (!active) {
        // Turning loop ON: quantize playhead to nearest beat
        const bpm = deck === 'a' ? trackBpmA : trackBpmB;
        const offset = deck === 'a' ? trackOffsetA : trackOffsetB;
        const rate = parseFloat(document.getElementById(`deck-${deck}-pitch`).value) || 1.0;
        const currentBpm = bpm * rate;
        
        if (currentBpm <= 0) return;
        
        const interval = 60 / currentBpm;
        const time = ws.getCurrentTime();
        const relativeTime = time - offset;
        const beatIndex = Math.round(relativeTime / interval);
        
        const start = offset + beatIndex * interval;
        const size = deck === 'a' ? loopSizeA : loopSizeB;
        const end = start + size * interval;
        
        if (deck === 'a') {
            loopStartA = start;
            loopEndA = end;
            loopActiveA = true;
        } else {
            loopStartB = start;
            loopEndB = end;
            loopActiveB = true;
        }
        
        button.textContent = `LOOP ON (${size}B)`;
        button.classList.add('active');
    } else {
        // Turning loop OFF
        if (deck === 'a') loopActiveA = false;
        else loopActiveB = false;
        
        button.textContent = 'LOOP OFF';
        button.classList.remove('active');
    }
}

function setLoopSize(deck, size) {
    if (deck === 'a') {
        loopSizeA = size;
        if (loopActiveA && wavesurferA) {
            const bpm = trackBpmA;
            const rate = parseFloat(document.getElementById('deck-a-pitch').value) || 1.0;
            const interval = 60 / (bpm * rate);
            loopEndA = loopStartA + size * interval;
            document.getElementById('deck-a-loop-toggle').textContent = `LOOP ON (${size}B)`;
        }
    } else {
        loopSizeB = size;
        if (loopActiveB && wavesurferB) {
            const bpm = trackBpmB;
            const rate = parseFloat(document.getElementById('deck-b-pitch').value) || 1.0;
            const interval = 60 / (bpm * rate);
            loopEndB = loopStartB + size * interval;
            document.getElementById('deck-b-loop-toggle').textContent = `LOOP ON (${size}B)`;
        }
    }
    
    document.querySelectorAll(`.loop-size-btn[data-deck="${deck}"]`).forEach(btn => {
        const btnSize = parseInt(btn.getAttribute('data-size'), 10);
        if (btnSize === size) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

function checkLoopBoundaries(deck, time) {
    const active = deck === 'a' ? loopActiveA : loopActiveB;
    if (!active) return;
    
    const start = deck === 'a' ? loopStartA : loopStartB;
    const end = deck === 'a' ? loopEndA : loopEndB;
    const ws = deck === 'a' ? wavesurferA : wavesurferB;
    
    if (ws && time >= end) {
        ws.setTime(start);
    }
}


