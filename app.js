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
const dspWorker = new Worker('worker.js');
const workerCallbacks = {};
const fileRegistry = {}; 
let exportData = []; // Stores processed track metadata for export

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
});

dspWorker.onmessage = (e) => {
    const { taskId, bpm, camelotCode, success, error } = e.data;
    if (workerCallbacks[taskId]) {
        workerCallbacks[taskId]({ bpm, camelotCode, success, error });
        delete workerCallbacks[taskId];
    }
};

function analyseInWorker(channelData, sampleRate) {
    return new Promise((resolve) => {
        const taskId = `task-${Date.now()}-${Math.random()}`;
        workerCallbacks[taskId] = resolve;
        dspWorker.postMessage({ taskId, channelData, sampleRate });
    });
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
        const objectUrl = URL.createObjectURL(file);
        
        playerTrackName.textContent = row.querySelector('.new-name').textContent;
        playerBpm.textContent = `${row.getAttribute('data-bpm')} BPM`;
        playerKey.textContent = selectedKey;
        playerGenre.textContent = row.getAttribute('data-genre') || "Unknown";
        playerDeck.classList.add('visible');

        wavesurfer.load(objectUrl);
        wavesurfer.once('ready', () => {
            wavesurfer.play();
        });
    }
});

folderBtn.addEventListener('click', async () => {
    try {
        const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        const outDirHandle = await dirHandle.getDirectoryHandle('Processed_Tracks', { create: true });
        
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
            return;
        }

        let processedCount = 0;
        updateProgress(0, filesToProcess.length);

        for (const entry of filesToProcess) {
            await processBatchFile(entry, outDirHandle);
            processedCount++;
            updateProgress(processedCount, filesToProcess.length);
        }

        folderBtn.disabled = false;
        folderBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> Select Folder to Process`;
        progressText.textContent = "Batch Processing Complete!";

        if (exportData.length > 0) {
            exportCsvBtn.disabled = false;
            exportM3u8Btn.disabled = false;
        }

    } catch (err) {
        console.error("Folder selection cancelled or failed:", err);
        folderBtn.disabled = false;
        folderBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> Select Folder to Process`;
    }
});

function updateProgress(current, total) {
    const percentage = total === 0 ? 0 : (current / total) * 100;
    progressBar.style.width = `${percentage}%`;
    progressText.textContent = `Analysing ${current} of ${total} files...`;
}

async function processBatchFile(fileHandle, outDirHandle) {
    const rowId = `track-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
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
        
        // Natively parse Genre from ID3v2 tag
        const genre = parseGenreFromBuffer(arrayBuffer);
        
        const audioBufferCopy = arrayBuffer.slice(0); 
        const decodedAudio = await audioContext.decodeAudioData(audioBufferCopy);

        const channelData = decodedAudio.getChannelData(0);
        const result = await analyseInWorker(channelData, decodedAudio.sampleRate);

        if (!result.success) throw new Error(result.error);

        const newFilename = `${result.camelotCode} - ${file.name}`;

        // Save a copy of the original file under the new renamed filename (preserving 100% of original tags, cue points, and artwork)
        const newFileHandle = await outDirHandle.getFileHandle(newFilename, { create: true });
        const writable = await newFileHandle.createWritable();
        await writable.write(arrayBuffer);
        await writable.close();

        fileRegistry[rowId] = file;

        exportData.push({
            originalName: file.name,
            newName: newFilename,
            bpm: result.bpm,
            key: result.camelotCode,
            genre: genre
        });

        const badgeColour = result.camelotCode !== "Unknown" ? `var(--cam-${result.camelotCode.toLowerCase()})` : "var(--border-colour)";

        tr.setAttribute('data-key', result.camelotCode);
        tr.setAttribute('data-bpm', result.bpm);
        tr.setAttribute('data-genre', genre);
        tr.classList.add('ready');

        document.querySelector(`#${rowId} .new-name`).textContent = newFilename;
        document.querySelector(`#${rowId} .bpm-value`).textContent = result.bpm;
        document.querySelector(`#${rowId} .genre-value`).textContent = genre;
        
        const badge = document.querySelector(`#${rowId} .badge`);
        badge.textContent = result.camelotCode;
        badge.style.backgroundColor = badgeColour;
        badge.style.color = '#000';

        const status = document.querySelector(`#${rowId} .status`);
        status.textContent = 'Saved';
        status.className = 'status complete';

    } catch (error) {
        console.error(`Error processing ${fileHandle.name}:`, error);
        const status = document.querySelector(`#${rowId} .status`);
        status.textContent = 'Error';
        status.className = 'status error';
    }
}

// Custom native ID3v2 parser to extract TCON (Genre)
function parseGenreFromBuffer(arrayBuffer) {
    const uint8 = new Uint8Array(arrayBuffer);
    if (uint8[0] !== 0x49 || uint8[1] !== 0x44 || uint8[2] !== 0x33) {
        return "Unknown";
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
        
        const totalFrameSize = 10 + frameSize;
        if (offset + totalFrameSize > endOfTags) break;
        
        if (frameId === 'TCON') {
            const encoding = uint8[offset + 10];
            const textBytes = uint8.subarray(offset + 11, offset + 10 + frameSize);
            let genre = "";
            
            try {
                if (encoding === 0) {
                    genre = String.fromCharCode.apply(null, textBytes);
                } else if (encoding === 1) {
                    genre = new TextDecoder('utf-16').decode(textBytes);
                } else if (encoding === 2) {
                    genre = new TextDecoder('utf-16be').decode(textBytes);
                } else if (encoding === 3) {
                    genre = new TextDecoder('utf-8').decode(textBytes);
                }
            } catch (e) {
                genre = "Unknown";
            }
            
            genre = genre.replace(/\0+$/, '').trim();
            const match = genre.match(/^\((\d+)\)$/);
            if (match) {
                const id = parseInt(match[1], 10);
                if (id >= 0 && id < genresList.length) {
                    return genresList[id];
                }
            }
            return genre || "Unknown";
        }
        
        offset += totalFrameSize;
    }
    return "Unknown";
}

// Custom native ID3v2 frame-preserving editor


// Exports
exportCsvBtn.addEventListener('click', () => {
    if (exportData.length === 0) return;
    
    let csvContent = "Original Name,New Filename,BPM,Key,Genre\n";
    exportData.forEach(track => {
        const ogName = `"${track.originalName.replace(/"/g, '""')}"`;
        const newName = `"${track.newName.replace(/"/g, '""')}"`;
        const genreVal = `"${(track.genre || "Unknown").replace(/"/g, '""')}"`;
        csvContent += `${ogName},${newName},${track.bpm},${track.key},${genreVal}\n`;
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
