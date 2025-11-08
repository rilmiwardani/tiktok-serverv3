require('dotenv').config();

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { TikTokConnectionWrapper, getGlobalConnectionCount } = require('./connectionWrapper');
const { clientBlocked } = require('./limiter');

const app = express();
const httpServer = createServer(app);

// Enable cross origin resource sharing for all origins
const io = new Server(httpServer, {
    cors: {
        origin: '*'
    }
});

// Store active connections
const activeConnections = new Map();

io.on('connection', (socket) => {
    console.log('New frontend connection:', socket.id);
    let tiktokConnectionWrapper;

    // BATCHING SYSTEM
    // Kita kumpulkan event di sini dan kirim setiap interval
    let eventBatch = [];
    const batchInterval = setInterval(() => {
        if (eventBatch.length > 0) {
            // Kirim batch ke frontend
            socket.emit('tiktokBatch', eventBatch);
            // Kosongkan batch
            eventBatch = [];
        }
    }, 1000); // Kirim setiap 1 detik (sesuaikan jika perlu lebih cepat, misal 500ms)

    socket.on('setUniqueId', (uniqueId, options) => {
        // Cleanup koneksi lama jika ada
        if (tiktokConnectionWrapper) {
            tiktokConnectionWrapper.disconnect();
        }

        // Basic options sanitation
        if (typeof options === 'object' && options) {
            delete options.requestOptions;
            delete options.websocketOptions;
        } else {
            options = {};
        }

        // Rate limiter check
        if (process.env.ENABLE_RATE_LIMIT && clientBlocked(io, socket)) {
            socket.emit('tiktokDisconnected', 'Rate limit exceeded. Too many connections.');
            return;
        }

        try {
            console.log(`Connecting to TikTok LIVE: ${uniqueId}`);
            tiktokConnectionWrapper = new TikTokConnectionWrapper(uniqueId, options, true);
            tiktokConnectionWrapper.connect();
        } catch (err) {
            socket.emit('tiktokDisconnected', err.toString());
            return;
        }

        // Forward connection state events
        tiktokConnectionWrapper.once('connected', state => socket.emit('tiktokConnected', state));
        tiktokConnectionWrapper.once('disconnected', reason => socket.emit('tiktokDisconnected', reason));

        // --- EVENT HANDLING WITH BATCHING ---

        // 1. CHAT & GUESS
        tiktokConnectionWrapper.connection.on('chat', (msg) => {
            // Masukkan ke batch sebagai 'chat' untuk ditampilkan di kotak obrolan
            eventBatch.push({ type: 'chat', ...msg });

            // LOGIKA DETEKSI TEBAKAN DI BACKEND
            // Bersihkan pesan: hapus spasi, ubah ke huruf besar
            const cleanedMsg = (msg.comment || '').replace(/\s+/g, '').toUpperCase();
            
            // Cek jika ini terlihat seperti tebakan (panjang 5-7 huruf, hanya huruf)
            // Regex ini mengecek apakah string HANYA berisi huruf A-Z dan panjangnya 5, 6, atau 7
            if (/^[A-Z]{5,7}$/.test(cleanedMsg)) {
                // Duplikasi event sebagai tipe 'guess' khusus untuk game engine
                eventBatch.push({
                    type: 'guess',
                    guess: cleanedMsg, // Kirim kata yang sudah bersih
                    userId: msg.userId,
                    uniqueId: msg.uniqueId,
                    nickname: msg.nickname,
                    profilePictureUrl: msg.profilePictureUrl,
                    // Salin data penting lainnya jika perlu
                    followRole: msg.followRole,
                    isModerator: msg.isModerator,
                    isNewGifter: msg.isNewGifter,
                    isSubscriber: msg.isSubscriber,
                    topGifterRank: msg.topGifterRank
                });
            }
        });

        // 2. GIFT
        tiktokConnectionWrapper.connection.on('gift', (msg) => {
            // Forward gift type 1 (streak) only when it finishes, OR regular gifts
            if (msg.giftType === 1 && !msg.repeatEnd) {
                // Streak sedang berjalan, opsional: bisa di-skip untuk menghemat bandwidth
                // atau tetap dikirim jika ingin update realtime streak.
                // Untuk game Wordle, biasanya kita butuh total akhir atau setiap sentuhan.
                // Kita kirim saja, biarkan frontend memfilter jika mau.
                 eventBatch.push({ type: 'gift', ...msg });
            } else {
                 eventBatch.push({ type: 'gift', ...msg });
            }
        });

        // 3. OTHER EVENTS (Forwarding standard events to batch)
        tiktokConnectionWrapper.connection.on('like', (msg) => eventBatch.push({ type: 'like', ...msg }));
        tiktokConnectionWrapper.connection.on('member', (msg) => eventBatch.push({ type: 'member', ...msg }));
        tiktokConnectionWrapper.connection.on('social', (msg) => eventBatch.push({ type: 'social', ...msg }));
        tiktokConnectionWrapper.connection.on('roomUser', (msg) => eventBatch.push({ type: 'roomUser', ...msg }));
        tiktokConnectionWrapper.connection.on('streamEnd', () => eventBatch.push({ type: 'streamEnd' }));

        // Optional: Tangani perintah khusus !win dari chat di backend jika mau lebih aman,
        // tapi saat ini frontend Anda sudah menanganinya via 'chat' event.
    });

    socket.on('disconnect', () => {
        console.log('Frontend disconnected:', socket.id);
        clearInterval(batchInterval); // Hentikan loop batch
        if (tiktokConnectionWrapper) {
            tiktokConnectionWrapper.disconnect();
        }
    });
});

// Emit global stats every 5 seconds
setInterval(() => {
    io.emit('statistic', { globalConnectionCount: getGlobalConnectionCount() });
}, 5000);

const port = process.env.PORT || 3000;
httpServer.listen(port);
console.log(`Server running on port ${port}`);
