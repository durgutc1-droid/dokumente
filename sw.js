// Warten, bis das gesamte HTML-Dokument geladen ist, bevor wir starten.
document.addEventListener('DOMContentLoaded', () => {

    const { jsPDF } = window.jspdf;
    const dom = {
        app: document.getElementById('app'),
        initialLoadingScreen: document.getElementById('initial-loading-screen'),
        statusIndicator: document.getElementById('status-indicator'),
        aiBadge: document.getElementById('ai-badge'),
        scanFileBtn: document.getElementById('scan-file-btn'),
        backBtn: document.getElementById('back-btn'),
        currentFolderNameEl: document.getElementById('current-folder-name'),
        breadcrumbEl: document.getElementById('breadcrumb'),
        itemContainer: document.getElementById('item-container'),
        addFolderBtn: document.getElementById('add-folder-btn'),
        cameraModal: document.getElementById('camera-modal'),
        cameraView: document.getElementById('camera-view'),
        cameraCanvas: document.getElementById('camera-canvas'),
        captureBtn: document.getElementById('capture-btn'),
        cancelCameraBtn: document.getElementById('cancel-camera-btn'),
        confirmModal: document.getElementById('confirm-modal'),
        confirmMessage: document.getElementById('confirm-message'),
        confirmYes: document.getElementById('confirm-yes'),
        confirmNo: document.getElementById('confirm-no'),
        inputModal: document.getElementById('input-modal'),
        inputMessage: document.getElementById('input-message'),
        inputField: document.getElementById('input-field'),
        inputOk: document.getElementById('input-ok'),
        inputCancel: document.getElementById('input-cancel'),
        summaryModal: document.getElementById('summary-modal'),
        summaryText: document.getElementById('summary-text'),
        summaryClose: document.getElementById('summary-close'),
        speakSummaryBtn: document.getElementById('speak-summary-btn'),
        loadingModal: document.getElementById('loading-modal'),
    };

    let currentFolderId = null;
    let dbPromise = null;
    let cameraStream;
    const STEUER_CATEGORIES = ["Rechnungen", "Versicherungen", "Spenden", "Sonstiges"];
    const MIETER_ADDRESS = "Anton-Günther-str.42";

    // --- Datenbank Logik (stabiler) ---
    function getDB() {
        if (!dbPromise) {
            dbPromise = new Promise((resolve, reject) => {
                const request = indexedDB.open('AktenOrdnerDB_Offline', 7); // Version erhöht
                request.onerror = (e) => reject(e.target.error);
                request.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains('folders')) {
                        const folderStore = db.createObjectStore('folders', { keyPath: 'id', autoIncrement: true });
                        folderStore.createIndex('parentId', 'parentId', { unique: false });
                    }
                    if (!db.objectStoreNames.contains('files')) {
                        const fileStore = db.createObjectStore('files', { keyPath: 'id', autoIncrement: true });
                        fileStore.createIndex('folderId', 'folderId', { unique: false });
                    }
                };
                request.onsuccess = (e) => {
                    const db = e.target.result;
                    db.onclose = () => { dbPromise = null; console.warn("DB connection closed."); };
                    resolve(db);
                };
            });
        }
        return dbPromise;
    }

    async function render() {
        try {
            const db = await getDB();
            dom.itemContainer.innerHTML = '';
            const currentFolder = await getById('folders', currentFolderId);
            dom.currentFolderNameEl.textContent = currentFolder ? currentFolder.name : 'Hauptmenü';
            dom.backBtn.style.visibility = currentFolderId === null ? 'hidden' : 'visible';
            dom.scanFileBtn.style.display = currentFolderId === null ? 'none' : 'flex';
            
            await renderBreadcrumb();
            
            const folders = await getItemsFromDB('folders', 'parentId', currentFolderId);
            const currentYear = new Date().getFullYear();
            folders.forEach(folder => {
                const isLocked = folder.name.startsWith("Steuererklärung") && parseInt(folder.name.split(" ")[1]) < currentYear;
                createFolderElement(folder, isLocked);
            });

            if (currentFolderId !== null) {
                const files = await getItemsFromDB('files', 'folderId', currentFolderId);
                files.sort((a, b) => new Date(b.date) - new Date(a.date));
                files.forEach(createFileElement);
            }
        } catch (error) {
            console.error("Fehler beim Rendern:", error);
        }
    }

    function createFolderElement(folder, isLocked = false) {
        const div = document.createElement('div');
        div.className = `item p-2 rounded-lg hover:bg-gray-100 cursor-pointer ${isLocked ? 'locked-folder' : ''}`;
        div.innerHTML = `<i class="fas fa-folder text-6xl text-yellow-500"></i><span class="mt-2 text-sm word-break">${folder.name}</span>${isLocked ? '<div class="lock-icon"><i class="fas fa-lock"></i></div>' : ''}<div class="actions"><div class="action-btn delete" data-type="folder" data-id="${folder.id}"><i class="fas fa-times"></i></div></div>`;
        div.addEventListener('click', () => navigateToFolder(folder.id));
        dom.itemContainer.appendChild(div);
    }

    function createFileElement(file) {
        const iconClass = file.type.startsWith('image/') ? 'fa-file-image text-blue-500' : 'fa-file-pdf text-red-500';
        const dateString = new Date(file.date).toLocaleDateString('de-DE');
        const div = document.createElement('div');
        div.className = 'item p-2 rounded-lg hover:bg-gray-100 cursor-pointer';
        div.innerHTML = `<i class="fas ${iconClass} text-6xl"></i><span class="mt-2 text-sm font-semibold word-break">${file.name}</span><span class="text-xs text-gray-500">${dateString}</span><div class="actions"><div class="action-btn summary" data-summary="${file.summary || ''}"><i class="fas fa-comment-alt"></i></div><div class="action-btn print" data-id="${file.id}"><i class="fas fa-print"></i></div><div class="action-btn delete" data-id="${file.id}"><i class="fas fa-times"></i></div></div>`;
        div.addEventListener('click', (e) => { if (!e.target.closest('.actions')) openFile(file.id); });
        dom.itemContainer.appendChild(div);
    }

    async function ensureSteuerFolder(year) {
        const folderName = `Steuererklärung ${year}`;
        let steuerFolder = await findFolderByName(folderName, null);
        if (!steuerFolder) steuerFolder = await addItem('folders', { name: folderName, parentId: null });
        for (const cat of STEUER_CATEGORIES) {
            if (!(await findFolderByName(cat, steuerFolder.id))) await addItem('folders', { name: cat, parentId: steuerFolder.id });
        }
        return steuerFolder;
    }

    async function ensureMieterFolder() {
        if (!(await findFolderByName("Mieter", null))) await addItem('folders', { name: "Mieter", parentId: null });
    }

    async function copyFileToSteuerFolder(file) {
        if (!file.isTaxRelevant || !file.date || !file.category) return;
        const year = new Date(file.date).getFullYear();
        await ensureSteuerFolder(year);
        const steuerFolder = await findFolderByName(`Steuererklärung ${year}`, null);
        const categoryFolder = await findFolderByName(file.category, steuerFolder.id);
        if (categoryFolder) {
            const fileCopy = { ...file, folderId: categoryFolder.id, isCopy: true, originalId: file.id };
            delete fileCopy.id;
            await addItem('files', fileCopy);
        }
    }

    async function copyFileToMieterFolder(file) {
        const mieterFolder = await findFolderByName("Mieter", null);
        if (mieterFolder) {
            const fileCopy = { ...file, folderId: mieterFolder.id, isCopy: true, originalId: file.id };
            delete fileCopy.id;
            await addItem('files', fileCopy);
        }
    }

    dom.captureBtn.addEventListener('click', async () => {
        try {
            dom.cameraCanvas.width = dom.cameraView.videoWidth;
            dom.cameraCanvas.height = dom.cameraView.videoHeight;
            dom.cameraCanvas.getContext('2d').drawImage(dom.cameraView, 0, 0, dom.cameraCanvas.width, dom.cameraCanvas.height);
            dom.cancelCameraBtn.click();
            
            let aiResult = { filename: '', isTaxRelevant: false, category: 'Sonstiges', containsAddress: false, summary: 'Keine Zusammenfassung verfügbar.' };
            if (navigator.onLine) {
                dom.loadingModal.style.display = 'flex';
                const base64 = dom.cameraCanvas.toDataURL('image/jpeg', 0.9).split(',')[1];
                try { aiResult = await getAiAnalysis(base64); } catch (error) { console.error("Fehler bei der Gemini-Analyse:", error); }
                dom.loadingModal.style.display = 'none';
            }
            
            const docDate = await showInput("Datum des Dokuments (YYYY-MM-DD):", new Date().toISOString().slice(0, 10));
            if (!docDate || !/^\d{4}-\d{2}-\d{2}$/.test(docDate)) return;

            const fileName = await showInput("Dateiname:", aiResult.filename || `dokument-${Date.now()}`);
            if (!fileName) return;
            
            const isTaxRelevant = await showConfirm(`KI-Vorschlag: Dieses Dokument ist ${aiResult.isTaxRelevant ? `als '${aiResult.category}' steuerrelevant` : 'nicht steuerrelevant'}. Ist das korrekt?`);
            let category = null;
            if(isTaxRelevant) category = await showInput("Bitte Kategorie bestätigen:", aiResult.category) || 'Sonstiges';

            dom.cameraCanvas.toBlob(async blob => {
                const fileData = { name: fileName, date: docDate, folderId: currentFolderId, isTaxRelevant, category, type: blob.type, data: blob, summary: aiResult.summary };
                const newFile = await addItem('files', fileData);
                if (newFile.isTaxRelevant) await copyFileToSteuerFolder(newFile);
                if (aiResult.containsAddress) await copyFileToMieterFolder(newFile);
                render();
            }, 'image/jpeg', 0.9);
        } catch(err) { console.error("Fehler im Scan-Prozess:", err); }
    });

    async function getAiAnalysis(base64ImageData) {
        const apiKey = "";
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
        const promptText = `Analysiere dieses Dokument. Antworte mit einem JSON-Objekt. 1. "filename": Ein kurzer Dateiname (Format: "Typ-Beschreibung-YYYY-MM-DD"). 2. "isTaxRelevant": boolean. 3. "category": 'Rechnungen', 'Versicherungen', 'Spenden' oder 'Sonstiges'. 4. "containsAddress": boolean, ob der Text "${MIETER_ADDRESS}" exakt enthalten ist. 5. "summary": Fasse den Inhalt in einem prägnanten deutschen Satz zusammen. JSON-Format: {"filename": "...", "isTaxRelevant": boolean, "category": "...", "containsAddress": boolean, "summary": "..."}`;
        const payload = { contents: [{ parts: [{ text: promptText }, { inlineData: { mimeType: "image/jpeg", data: base64ImageData } }] }], generationConfig: { responseMimeType: "application/json" } };
        const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!response.ok) throw new Error(`API request failed: ${response.status}`);
        const result = await response.json();
        const jsonString = result.candidates?.[0]?.content?.parts?.[0]?.text;
        return JSON.parse(jsonString);
    }
    
    function updateOnlineStatus() {
        const isOnline = navigator.onLine;
        dom.statusIndicator.className = `w-3 h-3 rounded-full transition-colors ${isOnline ? 'bg-green-500' : 'bg-gray-400'}`;
        dom.statusIndicator.title = isOnline ? 'Online. KI-Funktionen sind verfügbar.' : 'Offline. KI-Funktionen sind deaktiviert.';
        dom.aiBadge.style.display = isOnline ? 'block' : 'none';
    }
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    dom.itemContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.action-btn');
        if (!btn) return;
        e.stopPropagation();
        const id = parseInt(btn.dataset.id);
        const type = btn.dataset.type === 'folder' ? 'folder' : 'file';
        if (btn.classList.contains('delete')) deleteItem(id, type);
        else if (btn.classList.contains('print')) printFile(id);
        else if (btn.classList.contains('summary')) showSummaryModal(btn.dataset.summary);
    });
    
    async function printFile(fileId) {
        const file = await getById('files', fileId);
        if (!file || !file.data) return;
        const url = URL.createObjectURL(file.data);
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = url;
        document.body.appendChild(iframe);
        iframe.onload = () => {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
            setTimeout(() => { document.body.removeChild(iframe); URL.revokeObjectURL(url); }, 1000);
        };
    }

    function navigateToFolder(folderId) { currentFolderId = folderId; render(); }
    dom.backBtn.addEventListener('click', async () => { if (currentFolderId !== null) { const c = await getById('folders', currentFolderId); navigateToFolder(c.parentId); } });
    dom.addFolderBtn.addEventListener('click', async () => {
        const name = await showInput("Wie soll der neue Ordner heißen?");
        if (name) { try { await addItem('folders', { name, parentId: currentFolderId }); render(); } catch (err) { console.error("Fehler beim Erstellen des Ordners:", err); } }
    });
    dom.scanFileBtn.addEventListener('click', async () => {
        dom.cameraModal.style.display = 'flex';
        try { cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); dom.cameraView.srcObject = cameraStream; } catch (err) { console.error("Kamerafehler:", err); dom.cameraModal.style.display = 'none'; }
    });
    dom.cancelCameraBtn.addEventListener('click', () => { dom.cameraModal.style.display = 'none'; if (cameraStream) cameraStream.getTracks().forEach(t => t.stop()); });
    async function openFile(fileId) { const f = await getById('files', fileId); if (f && f.data) window.open(URL.createObjectURL(f.data), '_blank'); }
    
    function showConfirm(message) {
        return new Promise((resolve) => {
            dom.confirmMessage.textContent = message;
            dom.confirmModal.style.display = 'flex';
            const onYes = () => { cleanup(); resolve(true); };
            const onNo = () => { cleanup(); resolve(false); };
            const cleanup = () => { dom.confirmYes.removeEventListener('click', onYes); dom.confirmNo.removeEventListener('click', onNo); dom.confirmModal.style.display = 'none'; };
            dom.confirmYes.addEventListener('click', onYes, { once: true });
            dom.confirmNo.addEventListener('click', onNo, { once: true });
        });
    }

    function showInput(message, defaultValue = "") {
        return new Promise((resolve) => {
            dom.inputMessage.textContent = message;
            dom.inputField.value = defaultValue;
            dom.inputModal.style.display = 'flex';
            dom.inputField.focus();
            const onOk = () => { const value = dom.inputField.value; cleanup(); resolve(value && value.trim() !== '' ? value.trim() : null); };
            const onCancel = () => { cleanup(); resolve(null); };
            const cleanup = () => { dom.inputOk.removeEventListener('click', onOk); dom.inputCancel.removeEventListener('click', onCancel); dom.inputModal.style.display = 'none'; };
            dom.inputOk.addEventListener('click', onOk, { once: true });
            dom.inputCancel.addEventListener('click', onCancel, { once: true });
        });
    }

    function showSummaryModal(summary) {
        dom.summaryText.textContent = summary || "Keine Zusammenfassung verfügbar.";
        dom.summaryModal.style.display = 'flex';
    }
    dom.summaryClose.addEventListener('click', () => dom.summaryModal.style.display = 'none');
    dom.speakSummaryBtn.addEventListener('click', () => {
        const textToSpeak = dom.summaryText.textContent;
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(textToSpeak);
            utterance.lang = 'de-DE';
            window.speechSynthesis.speak(utterance);
        }
    });

    async function deleteItem(id, type) {
        const confirmed = await showConfirm("Wollen Sie dies wirklich löschen?");
        if (confirmed) {
            if (type === 'folder') await deleteFolderContents(id);
            await deleteFromDB(type + 's', id);
            render();
        }
    }
    async function deleteFolderContents(folderId) {
        const subFolders = await getItemsFromDB('folders', 'parentId', folderId);
        for (const f of subFolders) await deleteItem(f.id, 'folder');
        const files = await getItemsFromDB('files', 'folderId', folderId);
        for (const f of files) await deleteFromDB('files', f.id);
    }
    async function renderBreadcrumb() {
        dom.breadcrumbEl.innerHTML = ''; if (currentFolderId === null) return; let path = []; let currentId = currentFolderId;
        while (currentId !== null) { const folder = await getById('folders', currentId); if (folder) { path.unshift(folder); currentId = folder.parentId; } else { break; } }
        const homeLink = document.createElement('a'); homeLink.href = '#'; homeLink.textContent = 'Hauptmenü'; homeLink.onclick = (e) => { e.preventDefault(); navigateToFolder(null); }; dom.breadcrumbEl.appendChild(homeLink);
        path.forEach(f => { dom.breadcrumbEl.append(' / '); const link = document.createElement('a'); link.href = '#'; link.textContent = f.name; link.onclick = (e) => { e.preventDefault(); navigateToFolder(f.id); }; dom.breadcrumbEl.appendChild(link); });
    }

    async function getStore(storeName, mode) { const db = await getDB(); return db.transaction(storeName, mode).objectStore(storeName); }
    async function addItem(storeName, item) { const store = await getStore(storeName, 'readwrite'); return new Promise((resolve, reject) => { const req = store.add(item); req.onsuccess = e => resolve({ ...item, id: e.target.result }); req.onerror = e => reject(req.error); }); }
    async function getById(storeName, id) { if (id === null) return null; const store = await getStore(storeName, 'readonly'); return new Promise((resolve, reject) => { const req = store.get(id); req.onsuccess = e => resolve(e.target.result); req.onerror = e => reject(req.error); }); }
    async function deleteFromDB(storeName, id) { const store = await getStore(storeName, 'readwrite'); return new Promise((resolve, reject) => { const req = store.delete(id); req.onsuccess = resolve; req.onerror = e => reject(req.error); }); }
    async function getItemsFromDB(storeName, indexName, value) { const store = await getStore(storeName, 'readonly'); return new Promise((resolve, reject) => { const req = store.index(indexName).getAll(value); req.onsuccess = e => resolve(e.target.result); req.onerror = e => reject(req.error); }); }
    async function findFolderByName(name, parentId) { const store = await getStore('folders', 'readonly'); return new Promise((resolve, reject) => { const req = store.getAll(); req.onsuccess = e => resolve(e.target.result.find(f => f.name === name && f.parentId === parentId)); req.onerror = e => reject(req.error); }); }

    // App starten
    getDB().then(() => {
        initApp();
    }).catch(err => {
        console.error("Konnte Datenbank nicht initialisieren:", err);
        dom.initialLoadingScreen.innerHTML = '<p class="text-red-500">Fehler beim Starten der App.</p>';
    });

    function initApp() {
        dom.initialLoadingScreen.style.display = 'none';
        dom.app.classList.remove('opacity-0');
        initDB();
    }
});
