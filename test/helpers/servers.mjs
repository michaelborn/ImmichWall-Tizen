export async function listen(server, host = '127.0.0.1') {
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, host, resolve);
    });
    const address = server.address();
    return `http://${host}:${address.port}`;
}

export async function close(server) {
    if (!server?.listening) return;
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
}
