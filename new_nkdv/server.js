// 简单的HTTP服务器用于测试NKDV WASM
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8000;

// MIME类型映射
const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.wasm': 'application/wasm',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.csv': 'text/csv',
    '.data': 'application/octet-stream'
};

const server = http.createServer((req, res) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    
    // 解析URL
    let filePath = '.' + req.url;
    if (filePath === './') {
        filePath = './test_scenario_b.html';
    }
    
    // 获取文件扩展名
    const extname = String(path.extname(filePath)).toLowerCase();
    const contentType = mimeTypes[extname] || 'application/octet-stream';
    
    // 读取文件
    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end('<h1>404 - File Not Found</h1>', 'utf-8');
            } else {
                res.writeHead(500);
                res.end('Server Error: ' + error.code, 'utf-8');
            }
        } else {
            // 添加CORS头以支持跨域
            res.writeHead(200, {
                'Content-Type': contentType,
                'Access-Control-Allow-Origin': '*',
                'Cross-Origin-Opener-Policy': 'same-origin',
                'Cross-Origin-Embedder-Policy': 'require-corp'
            });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('NKDV WASM 测试服务器已启动');
    console.log('='.repeat(60));
    console.log(`服务器地址: http://localhost:${PORT}`);
    console.log('');
    console.log('可用的测试页面:');
    console.log(`  - 真实WASM测试: http://localhost:${PORT}/test_scenario_b.html`);
    console.log(`  - Mock测试:     http://localhost:${PORT}/test_scenario_b_mock.html`);
    console.log('');
    console.log('按 Ctrl+C 停止服务器');
    console.log('='.repeat(60));
});