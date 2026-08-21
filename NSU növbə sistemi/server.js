const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Fayl yolları
const DATA_FILE = path.join(__dirname, 'data.json');
const BAK_FILE = path.join(__dirname, 'data.json.bak');
const TMP_FILE = path.join(__dirname, 'data.json.tmp');

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Şifrə
const ADMIN_PASS = '@ndu19672025';

// Aktiv admin tokenləri: token -> {createdAt}
const adminTokens = new Map();

// Token təmizləyicisi: 8 saatdan köhnə tokenləri sil
setInterval(() => {
    const limit = Date.now() - 8 * 60 * 60 * 1000;
    for (const [t, val] of adminTokens) {
        if (val.createdAt < limit) adminTokens.delete(t);
    }
}, 60 * 60 * 1000);

// Yaddaş
let queue = [];
let queueCounter = 1;
let desks = { 1: null, 2: null, 3: null, 4: null, 5: null };
let totalServed = 0;
let allOperations = [];

// -------------  Fayl funksiyaları  -------------
function loadData() {
    try {
        if (fs.existsSync(DATA_FILE) && fs.statSync(DATA_FILE).size > 0) {
            const raw = fs.readFileSync(DATA_FILE, 'utf8');
            const data = JSON.parse(raw);
            queue = data.queue || [];
            queueCounter = data.queueCounter || 1;
            desks = data.desks || { 1: null, 2: null, 3: null, 4: null, 5: null };
            totalServed = data.totalServed || 0;
            allOperations = data.allOperations || [];
            return;
        }
    } catch (e) {
        console.error('Fayl oxuma xətası:', e);
    }

    // Ehtiyat faylı yoxla
    try {
        if (fs.existsSync(BAK_FILE) && fs.statSync(BAK_FILE).size > 0) {
            const data = JSON.parse(fs.readFileSync(BAK_FILE, 'utf8'));
            queue = data.queue || [];
            queueCounter = data.queueCounter || 1;
            desks = data.desks || { 1: null, 2: null, 3: null, 4: null, 5: null };
            totalServed = data.totalServed || 0;
            allOperations = data.allOperations || [];
            console.log('Məlumatlar ehtiyat (backup) faylından bərpa olundu.');
        }
    } catch (errBak) {
        console.error('Ehtiyat fayl oxuma xətası:', errBak);
    }
}

function saveData() {
    try {
        const data = {
            queue,
            queueCounter,
            desks,
            totalServed,
            allOperations
        };
        const jsonStr = JSON.stringify(data, null, 2);

        // Əvvəlcə müvəqqəti fayla yazılır
        fs.writeFileSync(TMP_FILE, jsonStr, 'utf8');

        // Əsas fayl mövcuddursa və ölçüsü > 0-dırsa, ehtiyat nüsxə çıxarılır
        if (fs.existsSync(DATA_FILE) && fs.statSync(DATA_FILE).size > 0) {
            fs.copyFileSync(DATA_FILE, BAK_FILE);
        }

        // Təhlükəsiz atomik əvəzləmə (Atomic Replace)
        fs.renameSync(TMP_FILE, DATA_FILE);
    } catch (e) {
        console.error('Fayl yazma xətası:', e);
    }
}

// İlkin yükləmə
loadData();
// Əgər data.json boşdursa, ilkin strukturu yaz
if (!fs.existsSync(DATA_FILE) || fs.statSync(DATA_FILE).size === 0) {
    saveData();
}

// -------------  ROUTES  -------------
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-login.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-login.html')));
// Admin paneli - yalnız etibarlı token ilə açılır
app.get('/admin-panel', (req, res) => {
    const token = req.query.token || '';
    if (!token || !adminTokens.has(token)) return res.redirect('/admin');
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Admin login - şifrəni yalnız server yoxlayır, tokeni qaytarır
app.post('/api/admin/login', (req, res) => {
    const { pwd } = req.body || {};
    if (!pwd || pwd !== ADMIN_PASS) {
        return res.status(401).json({ error: 'Yanlış şifrə!' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    adminTokens.set(token, { createdAt: Date.now() });
    res.json({ success: true, token });
});

// Token yoxlanışı endpoint - admin.html-dən yoxlamaq üçün
app.post('/api/admin/verify', (req, res) => {
    const { token } = req.body || {};
    if (!token || !adminTokens.has(token)) {
        return res.status(401).json({ valid: false });
    }
    res.json({ valid: true });
});
app.get('/monitor', (req, res) => res.sendFile(path.join(__dirname, 'public', 'monitor.html')));
app.get('/desk/:number', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'desk.html'));
});

// API
app.post('/api/queue/add', (req, res) => {
    const { name, serviceType } = req.body;
    if (!name) return res.status(400).json({ error: 'Ad daxil edilməlidir' });
    const item = {
        id: Date.now(),
        number: queueCounter++,
        name: name.trim(),
        serviceType: serviceType?.trim() || 'Ümumi xidmət',
        status: 'waiting',
        addedTime: new Date(),
        calledTime: null,
        completedTime: null
    };
    queue.push(item);
    allOperations.push({ ...item });
    saveData();
    io.emit('queueUpdated', { queue, desks, stats: getStats() });
    res.json(item);
});

app.post('/api/queue/call', (req, res) => {
    const { queueId, deskNumber } = req.body;
    const item = queue.find(q => q.id === queueId);
    if (!item || item.status !== 'waiting')
        return res.status(400).json({ error: 'Növbə tapılmadı və ya artıq çağırılıb' });
    if (desks[deskNumber]) completeServiceInternal(desks[deskNumber].id);
    item.status = 'serving';
    item.calledTime = new Date();
    desks[deskNumber] = item;
    saveData();
    io.emit('customerCalled', { queueNumber: item.number, deskNumber, customerName: item.name, time: new Date() });
    io.emit('queueUpdated', { queue, desks, stats: getStats() });
    res.json({ success: true });
});

app.post('/api/queue/complete', (req, res) => {
    const ok = completeServiceInternal(req.body.queueId);
    if (!ok) return res.status(400).json({ error: 'Növbə tapılmadı' });
    io.emit('queueUpdated', { queue, desks, stats: getStats() });
    res.json({ success: true });
});

app.post('/api/queue/recall', (req, res) => {
    const item = queue.find(q => q.id === req.body.queueId);
    if (!item) return res.status(400).json({ error: 'Növbə tapılmadı' });
    let deskNumber = 0;
    for (const d in desks) if (desks[d] && desks[d].id === item.id) { deskNumber = d; break; }
    if (deskNumber) io.emit('customerCalled', { queueNumber: item.number, deskNumber, customerName: item.name, time: new Date(), isRecall: true });
    res.json({ success: true });
});

app.post('/api/queue/remove', (req, res) => {
    const idx = queue.findIndex(q => q.id === req.body.queueId);
    if (idx === -1) return res.status(400).json({ error: 'Tapılmadı' });
    queue.splice(idx, 1);
    saveData();
    io.emit('queueUpdated', { queue, desks, stats: getStats() });
    res.json({ success: true });
});

app.post('/api/queue/edit', (req, res) => {
    const { queueId, name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Ad boş ola bilməz' });
    const item = queue.find(q => q.id === queueId);
    if (!item) return res.status(400).json({ error: 'Növbə tapılmadı' });
    item.name = name.trim();
    // allOperations içindəki qeydi də yenilə
    const opIdx = allOperations.findIndex(op => op.id === queueId);
    if (opIdx !== -1) allOperations[opIdx].name = name.trim();
    saveData();
    io.emit('queueUpdated', { queue, desks, stats: getStats() });
    res.json({ success: true });
});

app.post('/api/admin/reset', (req, res) => {
    const { pwd } = req.body;
    if (pwd !== ADMIN_PASS) {
        return res.status(401).json({ error: 'Yanlış admin şifrəsi!' });
    }

    queue = [];
    queueCounter = 1;
    desks = { 1: null, 2: null, 3: null, 4: null, 5: null };
    totalServed = 0;
    allOperations = [];

    saveData();
    io.emit('queueUpdated', { queue, desks, stats: getStats() });
    res.json({ success: true, message: 'Bütün məlumatlar uğurla sıfırlandı' });
});

app.get('/api/state', (req, res) => res.json({ queue, desks, stats: getStats(), allOperations }));

// ----------  HELPERS  ----------
function completeServiceInternal(queueId) {
    const item = queue.find(q => q.id === queueId);
    if (!item) return false;
    item.status = 'completed';
    item.completedTime = new Date();
    for (const d in desks) if (desks[d] && desks[d].id === queueId) desks[d] = null;
    totalServed++;
    const opIdx = allOperations.findIndex(op => op.id === queueId);
    if (opIdx !== -1) allOperations[opIdx] = { ...item };
    saveData();
    return true;
}

function getStats() {
    const waiting = queue.filter(q => q.status === 'waiting').length;
    const activeDesks = Object.values(desks).filter(d => d !== null).length;
    const completed = queue.filter(q => q.status === 'completed');
    let avg = 0;
    if (completed.length) {
        const total = completed.reduce((sum, q) => {
            const added = q.addedTime ? new Date(q.addedTime).getTime() : 0;
            const comp = q.completedTime ? new Date(q.completedTime).getTime() : 0;
            return sum + (comp && added ? (comp - added) : 0);
        }, 0);
        avg = Math.round(total / (completed.length * 60000)) || 0;
    }
    return { totalServed, currentWaiting: waiting, averageTime: avg, activeDeskCount: activeDesks };
}

// ----------  SOCKET  ----------
io.on('connection', socket => {
    console.log('Yeni əlaqə:', socket.id);
    socket.emit('queueUpdated', { queue, desks, stats: getStats() });
    socket.on('disconnect', () => console.log('Əlaqə kəsildi:', socket.id));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server ${PORT} portunda işləyir`);
    console.log('Linkləri:');
    console.log(`Admin: http://localhost:${PORT}/admin`);
    console.log(`Monitor: http://localhost:${PORT}/monitor`);
    console.log(`1-ci masa: http://localhost:${PORT}/desk/1`);
    console.log(`2-ci masa: http://localhost:${PORT}/desk/2`);
    console.log(`3-cü masa: http://localhost:${PORT}/desk/3`);
    console.log(`4-cü masa: http://localhost:${PORT}/desk/4`);
    console.log(`5-ci masa: http://localhost:${PORT}/desk/5`);
});
