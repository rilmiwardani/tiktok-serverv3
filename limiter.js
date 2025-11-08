let ipRequestCounts = {};
let maxIpConnections = 20; // Sedikit dinaikkan untuk keamanan jika pakai proxy
let maxIpRequestsPerMinute = 10;

setInterval(() => {
    ipRequestCounts = {};
}, 60 * 1000)

function clientBlocked(io, currentSocket) {
    // Jika running di Railway tanpa konfigurasi khusus, IP mungkin tidak akurat terbaca
    // karena di belakang proxy. Untuk kesederhanaan, kita bisa bypass atau pakai header yang benar.
    // Kode di bawah mencoba membaca header standar proxy.
    
    let currentIp = getSocketIp(currentSocket);

    if (!currentIp) {
        // Jika IP tidak terdeteksi, loloskan saja (atau blokir tergantung seberapa ketat Anda mau)
        return false; 
    }

    let ipCounts = getOverallIpConnectionCounts(io);
    let currentIpConnections = ipCounts[currentIp] || 0;
    let currentIpRequests = ipRequestCounts[currentIp] || 0;

    ipRequestCounts[currentIp] = currentIpRequests + 1;

    if (currentIpConnections > maxIpConnections) {
        console.info(`LIMITER: Max connection count of ${maxIpConnections} exceeded for client ${currentIp}`);
        return true;
    }

    if (currentIpRequests > maxIpRequestsPerMinute) {
        console.info(`LIMITER: Max request count of ${maxIpRequestsPerMinute} exceeded for client ${currentIp}`);
        return true;
    }

    return false;
}

function getOverallIpConnectionCounts(io) {
    let ipCounts = {};
    io.of('/').sockets.forEach(socket => {
        let ip = getSocketIp(socket);
        if (ip) {
            if (!ipCounts[ip]) {
                ipCounts[ip] = 1;
            } else {
                ipCounts[ip] += 1;
            }
        }
    })
    return ipCounts;
}

function getSocketIp(socket) {
    // Mencoba mendapatkan IP asli user meskipun di belakang proxy (seperti Railway/Cloudflare)
    let ip = socket.handshake.headers['x-forwarded-for'] || 
             socket.handshake.headers['x-real-ip'] ||
             socket.handshake.address;
             
    // Jika x-forwarded-for berisi banyak IP (dipisahkan koma), ambil yang pertama
    if (ip && ip.indexOf(',') > -1) {
        ip = ip.split(',')[0].trim();
    }
    
    return ip;
}

module.exports = {
    clientBlocked
}
