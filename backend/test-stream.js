import http from 'http';

const req = http.request('http://localhost:3001/api/chat', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        // We need an auth token if the route is protected
    }
});

req.write(JSON.stringify({
    messages: [{ role: 'user', content: 'Tell me a long story.' }],
}));
req.end();

req.on('response', (res) => {
    console.log('STATUS:', res.statusCode);
    res.on('data', (chunk) => {
        console.log(`[${new Date().toISOString()}] chunk: ${chunk.toString().length} bytes`);
    });
    res.on('end', () => console.log('DONE'));
});
