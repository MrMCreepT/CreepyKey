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
        return;
    }

    tracksTable.classList.add('has-selection');
    document.querySelectorAll('tr.track-row').forEach(r => {
        r.classList.remove('selected-master', 'harmonic-match');
    });

    row.classList.add('selected-master');
    const selectedKey = row.getAttribute('data-key');
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
        <td class="track-name">${fileHandle.name}</td>
        <td class="new-name">-</td>
        <td class="bpm-value">-</td>
        <td>
            <span class="badge" style="background-color: var(--border-colour); color: var(--text-main);">-</span>
            <span class="match-indicator">Match</span>
        </td>
        <td class="genre-value">-</td>
        <td class="status loading">Analysing...</td>
    `;
    resultsBody.appendChild(tr);

    try {
        const file = await fileHandle.getFile();
        const arrayBuffer = await file.arrayBuffer();
        
        // Parse existing ID3 tags in one pass
        const parsedTags = parseID3TagsFromBuffer(arrayBuffer);
        const genre = parsedTags.genre;
        
        // Check if there is already a valid key in the ID3 tag to skip DSP analysis
        const resolved = resolveKey(parsedTags.key);
        const resolvedBpm = parsedTags.bpm ? Math.round(parseFloat(parsedTags.bpm)) : 'Unknown';
        
        let result = null;
        if (resolved) {
            result = {
                success: true,
                camelotCode: resolved.camelotCode,
                keyText: resolved.keyText,
                bpm: resolvedBpm
            };
        } else {
            // No valid key found, decode audio and analyze
            const audioBufferCopy = arrayBuffer.slice(0); 
            const decodedAudio = await audioContext.decodeAudioData(audioBufferCopy);
            const channelData = decodedAudio.getChannelData(0);
            const dspResult = await analyseInWorker(channelData, decodedAudio.sampleRate, workerIndex);
            if (!dspResult.success) throw new Error(dspResult.error);
            result = {
                success: true,
                camelotCode: dspResult.camelotCode,
                keyText: dspResult.keyText,
                bpm: dspResult.bpm
            };
        }

        const format = notationSelect.value;
        const chosenKey = formatKey(result.camelotCode, result.keyText, format);
        
        // Determine saved filename based on the Rename Filename option
        const savedFilename = optFilename.checked ? `${chosenKey} - ${file.name}` : file.name;

        // Check if the destination file already exists in Processed_Tracks folder
        let fileExists = false;
        let existingFileHandle = null;
        try {
            existingFileHandle = await outDirHandle.getFileHandle(savedFilename);
            fileExists = true;
        } catch (e) {
            // File does not exist
        }

        let outputBuffer = arrayBuffer;
        let savedFile = null;

        if (fileExists) {
            // If the output file already exists, do a quick check to see if it needs tag updates
            const existingFile = await existingFileHandle.getFile();
            const existingBuffer = await existingFile.arrayBuffer();
            const existingTags = parseID3TagsFromBuffer(existingBuffer);

            let needsUpdate = false;
            if (optTitle.checked) {
                const prefix = `${chosenKey} - `;
                if (!existingTags.title || !existingTags.title.startsWith(prefix)) {
                    needsUpdate = true;
                }
            }
            if (optTags.checked) {
                if (!existingTags.key) {
                    needsUpdate = true;
                }
            }

            if (!needsUpdate) {
                // Already has all requested updates, reuse the existing file directly
                savedFile = existingFile;
            } else {
                // Output file is out of sync with selected tag options; update and rewrite it
                outputBuffer = updateID3Tags(arrayBuffer, result.camelotCode, result.bpm, {
                    prependTitle: optTitle.checked,
                    titleKeyPrefix: chosenKey,
                    writeTags: optTags.checked
                }, file.name);

                savedFile = new File([outputBuffer], savedFilename, { type: file.type });
                const writable = await existingFileHandle.createWritable();
                await writable.write(outputBuffer);
                await writable.close();
                fileExists = false; // Mark false so UI status correctly shows 'Saved' rather than 'Skipped'
            }
        } else {
            // Perform custom binary ID3v2 tag updates if options are selected
            if (optTitle.checked || optTags.checked) {
                outputBuffer = updateID3Tags(arrayBuffer, result.camelotCode, result.bpm, {
                    prependTitle: optTitle.checked,
                    titleKeyPrefix: chosenKey,
                    writeTags: optTags.checked
                }, file.name);
            }

            savedFile = new File([outputBuffer], savedFilename, { type: file.type });

            // Save the processed file under the decided filename
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
            genre: genre
        });

        const badgeColour = result.camelotCode !== "Unknown" ? `var(--cam-${result.camelotCode.toLowerCase()})` : "var(--border-colour)";

        tr.setAttribute('data-key', result.camelotCode);
        tr.setAttribute('data-key-text', result.keyText);
        tr.setAttribute('data-bpm', result.bpm);
        tr.setAttribute('data-genre', genre);
        tr.classList.add('ready');

        document.querySelector(`#${rowId} .new-name`).textContent = savedFilename;
        document.querySelector(`#${rowId} .bpm-value`).textContent = result.bpm;
        document.querySelector(`#${rowId} .genre-value`).textContent = genre;
        
        const badge = document.querySelector(`#${rowId} .badge`);
        badge.textContent = chosenKey;
        badge.style.backgroundColor = badgeColour;
        badge.style.color = '#000';

        const status = document.querySelector(`#${rowId} .status`);
        status.textContent = fileExists ? 'Skipped (Exists)' : (resolved ? 'Loaded (Tag)' : 'Saved');
        status.className = 'status complete';

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
                // Prepend Key if not already prepended
                const prefix = `${options.titleKeyPrefix || camelotCode} - `;
                let newTitle = originalTitle;
                if (!originalTitle.startsWith(prefix)) {
                    newTitle = prefix + originalTitle;
                }
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
    let csvContent = "Original Name,New Filename,BPM,Key,Genre\n";
    exportData.forEach(track => {
        const ogName = `"${track.originalName.replace(/"/g, '""')}"`;
        const newName = `"${track.newName.replace(/"/g, '""')}"`;
        const keyVal = formatKey(track.key, track.keyText, format);
        const genreVal = `"${(track.genre || "Unknown").replace(/"/g, '""')}"`;
        csvContent += `${ogName},${newName},${track.bpm},${keyVal},${genreVal}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    triggerDownload(blob, `CreepyKey_Setlist_${Date.now()}.csv`);
});

exportM3u8Btn.addEventListener('click', () => {
    if (exportData.length === 0) return;

    let m3u8Content = "#EXTM3U\n";
    exportData.forEach(track => {
        m3u8Content += `#EXTINF:-1,${track.newName.replace('.mp3', '')}\n`;
        m3u8Content += `Processed_Tracks/${track.newName}\n`; 
    });

    const blob = new Blob([m3u8Content], { type: 'application/x-mpegURL;charset=utf-8;' });
    triggerDownload(blob, `CreepyKey_Playlist_${Date.now()}.m3u8`);
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
