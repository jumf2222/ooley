type Type = Number | String | Boolean | Object | UInt8

export class UInt8 { }

export interface Dictionary<T> {
    [Key: string]: T;
}

const ICE_SERVERS: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    {
        urls: "turn:129.213.138.47",
        username: "webrtc",
        credential: "696969"
    }
];

const PEER_CONNECTION_CONFIG: RTCConfiguration = {
    iceServers: ICE_SERVERS
};

const enum MODE {
    SERVER,
    CLIENT
}

const SERVER_IP = "wss.ooley.me";

export interface User {
    objects: Object[],
    rpcLogInd: number;
    tcpCon: RTCDataChannel | null,
    udpCon: RTCDataChannel | null,
    syncing: boolean
    _peerCon: RTCPeerConnection | null,
    _uuid: string;
}

export interface RPC {
    signature: Type[];
    func: Function;
}

export interface ObjectTypes {
    signature: Type[];
    constr: Function;
}

export class NetworkManager {

    static _instance: NetworkManager;
    _buffer = new ArrayBuffer(4 * 1024);
    buffer = new DataView(this._buffer);
    rpcs: RPC[] = [{ signature: [], func: () => { } }, { signature: [], func: () => { } }];
    objectTypes: ObjectTypes[] = [{ signature: [], constr: () => { } }];

    rpcLog: ArrayBuffer[] = [];
    users: (User | null)[] = [null];
    userId = 0;
    mode: MODE = MODE.CLIENT;
    private signalingConnection: WebSocket | null = null;
    private connectingPromise: [Function, Function] | null = null;
    sendLoopTimeout: NodeJS.Timeout | null = null;
    invalid = false;
    lastTime = 0;

    onUserConnected: (userId: number) => void = (userId) => { console.log("User Connected with id", userId); };
    onUserDisconnected: (userId: number) => void = (userId) => { console.log("User Disconnected with id", userId); };
    onSyncCompleted: () => void = () => { console.log("Completed sync"); };

    static get instance() {
        if (NetworkManager._instance == null)
            NetworkManager._instance = new NetworkManager;
        return this._instance;
    }

    async startHost(): Promise<string> {
        this.mode = MODE.SERVER;
        try {
            setTimeout(() => { this.sendLoop() }, 0);
            return this.setupSignalingServer();
        } catch (error) {
            throw new Error(error);
        }
    }

    private async setupSignalingServer(): Promise<string> {
        return new Promise((resolve, reject) => {
            this.userId = 0;
            let signalCon = new WebSocket(`wss://${SERVER_IP}`);
            this.signalingConnection = signalCon;

            signalCon.onmessage = async (event) => {
                const message = JSON.parse(event.data);

                try {
                    if (this.mode === MODE.SERVER) { // Server
                        let ind = this.users.findIndex(user => user?._uuid === message.uuid);

                        if (message.roomCreated) {
                            return resolve(message.roomId);
                        } else if (message.ice) {
                            if (ind === -1) { console.error('Invalid user', message.uuid, this.users); return; }
                            let user = this.users[ind] as User;

                            if (!user._peerCon) { console.error('Signalling error: No peer con'); return; };
                            await user._peerCon.addIceCandidate(new RTCIceCandidate(message.ice));
                        } else if (this.mode === MODE.SERVER && message.sdpOffer) {
                            if (ind !== -1) { console.error('Signalling error: No peer con'); return; };

                            let con = new RTCPeerConnection(PEER_CONNECTION_CONFIG);
                            // SETUP TRACKS
                            let user: User = {
                                syncing: true,
                                rpcLogInd: 0,
                                objects: [],
                                tcpCon: null,
                                udpCon: null,
                                _peerCon: con,
                                _uuid: message.uuid
                            };
                            let userId = this.users.length;
                            this.users.push(user);

                            con.onicecandidate = (event) => {
                                if (event.candidate != null && this.signalingConnection?.readyState === 1) {
                                    this.signalingConnection?.send(JSON.stringify({ ice: event.candidate, uuid: user._uuid, roomId: message.roomId }));
                                } else if (this.mode === MODE.CLIENT) {
                                    // this.signalingConnection?.close();
                                }
                            };

                            await con.setRemoteDescription(new RTCSessionDescription(message.sdpOffer));

                            this._setupTracks(user);

                            if (!user._peerCon) { console.error('Signalling error: No peer con'); return; };
                            await user._peerCon.setLocalDescription(await user._peerCon.createAnswer());
                            signalCon.send(JSON.stringify({ sdpAnswer: user._peerCon.localDescription, uuid: message.uuid, roomId: message.roomId, userId: userId }));

                            if (!user.tcpCon) { console.error('Signalling error: No tcp con'); return; };
                            if (!user.udpCon) { console.error('Signalling error: No udp con'); return; };
                            let readyHandler = (event: Event) => {
                                if (user.tcpCon?.readyState === 'open' && user.udpCon?.readyState === 'open') { // User Connected
                                    this.invalid = true;
                                }
                            };

                            user._peerCon.oniceconnectionstatechange = () => {
                                if (user._peerCon?.iceConnectionState == 'disconnected') {
                                    this.disconnectUser(userId);
                                }
                            };
                            user.tcpCon.onopen = readyHandler;
                            user.udpCon.onopen = readyHandler;
                        }
                    } else { // Client
                        let user = this.users[0] as User;
                        if (!user._peerCon) { console.error('Signalling error: No peer con'); return; };

                        if (message.ice) {
                            user._peerCon.addIceCandidate(new RTCIceCandidate(message.ice));
                        } else if (message.sdpAnswer) {
                            this.userId = message.userId;
                            if (this.connectingPromise) {
                                this.connectingPromise[0](message.roomId);
                                this.connectingPromise = null;
                            }
                            await user._peerCon.setRemoteDescription(new RTCSessionDescription(message.sdpAnswer));
                        }
                    }
                } catch (error) {
                    console.error('Signalling error:', error);
                }
            };

            signalCon.onclose = () => {
                if (this.mode === MODE.CLIENT && this.connectingPromise) {
                    this.connectingPromise[1](new Error("Invalid roomId"));
                    this.connectingPromise = null;
                    console.error("Failed to connect");
                }
            }

            signalCon.onerror = (error) => {
                console.error('Websocket error', error);
                if (this.connectingPromise) {
                    this.connectingPromise[1](new Error("Websocket error!"));
                    this.connectingPromise = null;
                }
                reject(new Error("Websocket error!"));
            };
            signalCon.onopen = (_) => {
                if (this.mode === MODE.CLIENT) {
                    resolve("");
                } else {
                    this.signalingConnection?.send(JSON.stringify({ startHost: true }))
                }
            };
        });
    }

    _setupTracks(user: User) {
        if (!user._peerCon) { return; }

        // SETUP TRACKS
        user.tcpCon = user._peerCon.createDataChannel('tcp', { ordered: true, negotiated: true, id: 0 });
        user.udpCon = user._peerCon.createDataChannel('udp', { ordered: false, maxRetransmits: 0, negotiated: true, id: 1 });

        user.tcpCon.binaryType = 'arraybuffer';

        user.udpCon.binaryType = 'arraybuffer';
        user.udpCon.onmessage = (evt) => { console.log("UDP DATA", evt.data); };
    }

    connect(roomId: string): Promise<string> {
        return new Promise(async (resolve, reject) => {
            if (this.mode === MODE.SERVER) { return reject(new Error("Mode is server!")); }
            if (this.connectingPromise) { return reject(new Error("Already Connecting!")); }
            this.connectingPromise = [resolve, reject];

            try {
                await this.setupSignalingServer();
            } catch (error) {
                console.error("Connection error:", error);
                return reject(new Error("Failed to create connection!"));
            }

            let uuid = this.createUuid();
            let con = new RTCPeerConnection(PEER_CONNECTION_CONFIG);
            let user: User = {
                syncing: true,
                rpcLogInd: 0,
                objects: [],
                tcpCon: null,
                udpCon: null,
                _peerCon: con,
                _uuid: uuid
            };

            con.onicecandidate = (event) => {
                if (event.candidate != null && this.signalingConnection?.readyState === 1) {
                    this.signalingConnection?.send(JSON.stringify({ ice: event.candidate, uuid: user._uuid, roomId: roomId }));
                } else if (this.mode === MODE.CLIENT) {
                    // this.signalingConnection?.close();
                }
            };

            this.users[0] = user;
            this._setupTracks(user);
            if (!user._peerCon) { return reject(new Error("No peer con!")); }
            if (!user.tcpCon) { return reject(new Error("No peer con!")); }
            if (!user.udpCon) { return reject(new Error("No peer con!")); }
            let readyHandler = (event: Event) => {
                if (user.tcpCon?.readyState === 'open' && user.udpCon?.readyState === 'open') {
                    this.users[this.userId] = { syncing: true, rpcLogInd: 0, objects: [], tcpCon: null, udpCon: null, _peerCon: null, _uuid: "" };
                    this.connectingPromise = null;
                    resolve(roomId);
                }
            };

            user.tcpCon.onmessage = (evt) => { this._decodeRPC(new DataView(evt.data), 0); };
            user.tcpCon.onopen = readyHandler
            user.udpCon.onopen = readyHandler;
            await user._peerCon.setLocalDescription(await user._peerCon.createOffer());
            this.signalingConnection?.send(JSON.stringify({ sdpOffer: user._peerCon.localDescription, uuid: uuid, roomId: roomId }));
        });
    }

    private createUuid(): string {
        function s4() {
            return Math.floor((1 + Math.random()) * 0x10000)
                .toString(16)
                .substring(1);
        }
        return `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
    }

    spawn(objType: number, ...args: any[]) {
        let obj = this._spawn(this.userId, objType, args);
        this.sendRPC(0, this.encodeRPC(this.userId, objType, 0, args));
        return obj;
    }

    private _spawn(userId: number, objType: number, args: any[]) {
        let user = this.users[userId];
        if (!user) return null;
        let obj = new (this.objectTypes[objType].constr as any)(...args);
        console.log("created", obj);
        user.objects.push(obj);
        obj._objId = user.objects.length - 1;
        obj._ownerId = userId;
        if (obj.onSpawn) { obj.onSpawn(); }
        return obj;
    }

    registerRPC(fn: Function, args: Type[]) {
        this.rpcs.push({ func: fn, signature: args });
        return this.rpcs.length - 1;
    }

    registerNetworkedObject(objConstr: Function, args: Type[]) {
        this.objectTypes.push({ signature: args, constr: objConstr });
        objConstr.prototype._classId = this.objectTypes.length - 1;
        return this.objectTypes.length - 1;
    }

    sendRPC(to: number, data: DataView) {
        let user = this.users[to];
        if (!user || user.tcpCon?.readyState !== "open") return;
        user.tcpCon.send(data);
    }

    sendRPCAll(data: DataView) {
        if (this.mode !== MODE.SERVER) { return; }
        this.rpcLog.push(data.buffer.slice(data.byteOffset, data.byteLength));
        this.invalid = true;
    }

    sendLoop() {
        if (this.invalid) {
            this.invalid = false;

            for (let i = 0; i < this.users.length; i++) {
                let user = this.users[i];
                if (!user || user.tcpCon?.readyState !== "open") continue;

                let amt = 0;
                for (let j = user.rpcLogInd; j < this.rpcLog.length; j++) {
                    if (user.tcpCon.bufferedAmount > 10000) { this.invalid = true; break; }

                    amt += this.rpcLog[j].byteLength;
                    user.tcpCon.send(this.rpcLog[j]);
                    user.rpcLogInd++;
                }

                if (user.syncing && user.rpcLogInd === this.rpcLog.length) {
                    user.syncing = false;
                    console.log("User", i, "Synced");
                    user.tcpCon.onmessage = (evt) => { this._decodeRPC(new DataView(evt.data), i); };
                    this.onUserConnected(i);
                    this.sendRPCAll(this.encodeRPC(i, 0, 0, [])); // Send on user connected
                }
            }
        }
        setTimeout(() => { this.sendLoop() }, 0);
    }

    encodeRPC(ownerId: number, objId: number, rpcId: number, args: any) {
        this.buffer.setUint8(0, ownerId);
        this.buffer.setUint8(1, rpcId);
        this.buffer.setUint16(2, objId, true);
        let length = this._writeToBuf(this.rpcs[rpcId].signature, 4, args);
        return new DataView(this._buffer, 0, length);
    }

    private disconnectUser(userId: number) {
        this.sendRPCAll(this.encodeRPC(userId, 0, 1, []));
        this.onUserDisconnected(userId);
        this.users[userId]?._peerCon?.close();
        this.users[userId] = null;
    }

    private _decodeRPC(data: DataView, callingUserId: number) {
        let userId = data.getUint8(0);
        let rpcId = data.getUint8(1);
        let objId = data.getUint16(2, true);
        let args: any[] = [];

        if (rpcId === 0) { // Spawn
            if (objId === 0) {// User Connected
                if (this.mode === MODE.SERVER) { // Invalid command, kick client
                    this.disconnectUser(callingUserId);
                    return;
                }

                if (userId === this.userId) { console.log("Connected"); this.onSyncCompleted(); return; }
                this.users[userId] = { syncing: true, rpcLogInd: 0, objects: [], tcpCon: null, udpCon: null, _peerCon: null, _uuid: "" };
                this.onUserConnected(userId);
            } else {
                if (userId === this.userId) { return; }
                if (this.mode === MODE.SERVER) { this.sendRPCAll(data); }

                this._readFromBuf(this.objectTypes[objId].signature, 4, data, args);
                this._spawn(userId, objId, args);
            }
        } else if (rpcId === 1) { // Destroy
            if (objId === 0) {// User Disconnected
                if (this.mode === MODE.SERVER) { // Invalid command, kick client
                    this.disconnectUser(callingUserId);
                    return;
                }
                this.onUserDisconnected(userId);
                this.users[userId] = null;
            } else {
                if (userId === this.userId) { return; }
                if (this.mode === MODE.SERVER) { this.sendRPCAll(data); }

                this._readFromBuf(this.objectTypes[objId].signature, 4, data, args);
                this._spawn(userId, objId, args);
            }
        } else {
            let user = this.users[userId];
            if (!user) {
                if (this.mode === MODE.SERVER) { this.disconnectUser(callingUserId); }
                return;
            }
            this._readFromBuf(this.rpcs[rpcId].signature, 4, data, args);
            this.rpcs[rpcId].func.call(user.objects[objId], ...args);
        }
    }

    private _readFromBuf(types: Type[], ind: number, data: DataView, output: any[]): number {
        for (let i = 0; i < types.length; i++) {
            if (types[i] instanceof Array) {
                let count = data.getFloat64(ind, true);
                ind += 8;
                let items: any[] = [];

                for (let j = 0; j < count; j++) {
                    ind = this._readFromBuf([(types[i] as Type[])[0]], ind, data, items);
                }

                output.push(items);
                continue;
            }

            switch (types[i]) {
                case UInt8:
                    output.push(data.getUint8(ind));
                    ind += 1;
                    break;

                case Number:
                    output.push(data.getFloat64(ind, true));
                    ind += 8;
                    break;

                case Boolean:
                    output.push(data.getUint8(ind) === 1);
                    ind += 1;
                    break;

                case String:
                    let s = "";
                    while (data.getUint16(ind, true)) {
                        s += String.fromCharCode(data.getUint16(ind, true));
                        ind += 2;
                    }
                    output.push(s);
                    ind += 2;
                    break;

                case Object:
                    ind = this._readFromBuf([String], ind, data, output);
                    output[output.length - 1] = JSON.parse(output[output.length - 1]);
                    break;

                default:
                    console.error("Unsupported Type");
                    break;
            }
        }
        return ind;
    }

    private _writeToBuf(types: Type[], ind: number, data: any[]): number {
        for (let i = 0; i < types.length; i++) {
            if (types[i] instanceof Array) {
                this.buffer.setFloat64(ind, (data[i] as []).length, true);
                ind += 8;

                for (let j = 0; j < (data[i] as []).length; j++) {
                    ind = this._writeToBuf([(types[i] as Type[])[0]], ind, [data[i][j]]);
                }
                continue;
            }

            switch (types[i]) {
                case UInt8:
                    this.buffer.setUint8(ind, data[i]);
                    ind += 1;
                    break;

                case Number:
                    this.buffer.setFloat64(ind, data[i], true);
                    ind += 8;
                    break;

                case Boolean:
                    this.buffer.setUint8(ind, data[i] ? 1 : 0);
                    ind += 1;
                    break;

                case String:
                    for (let j = 0; j < (data[i] as string).length; j++) {
                        this.buffer.setUint16(ind, data[i].charCodeAt(j), true);
                        ind += 2;
                    }
                    this.buffer.setUint16(ind, 0, true);
                    ind += 2;
                    break;

                case Object:
                    ind = this._writeToBuf([String], ind, [JSON.stringify(data[i])]);
                    break;

                default:
                    console.error("Unsupported Type");
                    break;
            }
        }
        return ind;
    }
}

export function Replicated(...types: Type[]) {
    return function <T extends { new(...args: any[]): {} }>(constr: T) {
        let orig = constr;
        let manager = NetworkManager.instance;
        let id = manager.registerNetworkedObject(constr, types);
        let newConst = function (...args: any[]) {
            return manager.spawn(id, args);
        }

        newConst.prototype = orig.prototype;
        return newConst as any as T;
    }
}

export function Watched(arg: Type) {
    return function (target: any, propertyKey: string) {
        Object.defineProperty(target, propertyKey, {
            get: function () {
                return this["_" + propertyKey];
            },
            set: function (test) {
                this["_" + propertyKey] = test;
            }
        })
    }
}

// export function RPC(...types: Type[]) {
//     return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {

//         let orig = descriptor.value;
//         let id = NetworkManager.instance.registerRPC(orig, types);
//         descriptor.value = function (...args: any[]) {
//             orig(...args);
//             NetworkManager.instance.sendRPC((this as any)._objId, id, args);
//         }
//     }
// }

export function ClientRPC(...types: Type[]) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {

        let manager = NetworkManager.instance;
        let orig = descriptor.value;
        let id = manager.registerRPC(orig, types);
        descriptor.value = function (...args: any[]) {
            if (manager.mode === MODE.CLIENT) { return; }
            manager.sendRPCAll(manager.encodeRPC((this as any)._ownerId, (this as any)._objId, id, args));
        }
    }
}

export function ServerRPC(...types: Type[]) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {

        let manager = NetworkManager.instance;
        let orig = descriptor.value;
        let id = manager.registerRPC(orig, types);
        descriptor.value = function (...args: any[]) {
            if (manager.mode === MODE.SERVER) { return; }
            manager.sendRPC(0, manager.encodeRPC(manager.userId, (this as any)._objId, id, args));
        }
    }
}

export function IRPC(...types: Type[]) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {

        let manager = NetworkManager.instance;
        let orig = descriptor.value;
        let newFun = function (...args: any[]) {
            //@ts-ignore
            if (this._ownerId !== manager.userId) { orig.call(this, ...args); }
        };

        let clientId = manager.registerRPC(newFun, types);
        descriptor.value = function (...args: any[]) {
            if (manager.mode === MODE.SERVER) { return; }
            orig.call(this, ...args);
            manager.sendRPC(0, manager.encodeRPC(manager.userId, (this as any)._objId, serverId, args));
        }

        let serverFn = function (...args: any[]) {
            if (manager.mode === MODE.CLIENT) { return; }
            //@ts-ignore
            manager.sendRPCAll(manager.encodeRPC(this._ownerId, this._objId, clientId, args));
        }
        let serverId = manager.registerRPC(serverFn, types);
    }
}

export function RPC(...types: Type[]) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {

        let manager = NetworkManager.instance;
        let orig = descriptor.value;

        let clientId = manager.registerRPC(orig, types);
        descriptor.value = function (...args: any[]) {
            if (manager.mode === MODE.SERVER) { return; }
            manager.sendRPC(0, manager.encodeRPC(manager.userId, (this as any)._objId, serverId, args));
        }

        let serverFn = function (...args: any[]) {
            if (manager.mode === MODE.CLIENT) { return; }
            //@ts-ignore
            manager.sendRPCAll(manager.encodeRPC(this._ownerId, this._objId, clientId, args));
        }
        let serverId = manager.registerRPC(serverFn, types);
    }
}
