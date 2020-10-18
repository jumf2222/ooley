const WebSocket = require("ws");
const wss = new WebSocket.Server({ port: 80 });

let rooms = {};

function createUuid() {
    // @ts-ignore
    return String(Math.floor(Math.random() * 999999)).padStart(6, "0");
}

wss.on("connection", (ws) => {
    ws.on("message", (message) => {
        // @ts-ignore
        let msg = JSON.parse(message);
        console.log("Decoded:", msg);
        if (msg.startHost) {
            let uuid = createUuid();
            while (rooms[uuid]) {
                let uuid = createUuid();
            }
            rooms[uuid] = { host: ws };
            ws.send(JSON.stringify({ roomCreated: true, roomId: uuid }));
            return;
        }

        let room = rooms[msg.roomId];
        if (!room || msg.uuid === "host") return ws.close();

        if (room.host.readyState !== WebSocket.OPEN) {
            wss.clients.forEach((client) => {
                client.close();
            });
            delete rooms[msg.roomId];
            ws.close();
            return;
        }

        if (ws === room.host) {
            if (room[msg.uuid]) room[msg.uuid].send(message);
        } else {
            room[msg.uuid] = ws;
            room.host.send(message);
        }
    });

    ws.on("close", (code, reason) => {
        for (const key of Object.keys(rooms)) {
            if (rooms[key].host === ws) {
                delete rooms[key];
                break;
            } else {
                for (const uuid of Object.keys(rooms[key])) {
                    if (rooms[key][uuid] === ws) {
                        delete rooms[key][uuid];
                    }
                }
            }
        }
    });
});
