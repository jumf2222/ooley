import adapter from 'webrtc-adapter';
import { NetworkManager, RPC, Watched, Replicated, ClientRPC, ServerRPC, IRPC, UInt8 } from "./networkManager";
import { Vec2, Color } from "./util";
import { DouglasPeucker } from "./dp_iter";
import './roomStyle.css';

const canvas = document.getElementById("paint-board") as HTMLCanvasElement;
const context = canvas.getContext("2d") as CanvasRenderingContext2D;
// const chatInput: HTMLInputElement = document.getElementById("chatInput") as HTMLInputElement;
// const chatbox: HTMLDivElement = document.getElementById("chatbox") as HTMLDivElement;

const colors = [
    new Color(94, 189, 62),
    new Color(255, 185, 0),
    new Color(247, 130, 0),
    new Color(226, 56, 56),
    new Color(151, 57, 153),
    new Color(0, 156, 223),
];

const COLOR_SWITCH_TIME = 750; // MS
const SMOOTHING_SAMPLES = 3;
let manager: DrawingManager | null = null;

let setup = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.lineWidth = 2;
};

window.addEventListener("resize", setup);
setup();


export class Stroke {
    points: Vec2[] = [];
    isDrawing: boolean = false;
    colorInd: number = 0;
    colorTime: number = 0;

    constructor(public color: Color, public width: number = 1, public rainbow: boolean = false) { }

    draw(dt: number) {
        if (this.rainbow) {
            let col = colors[(this.colorInd) % colors.length];
            let nextCol = colors[(this.colorInd + 1) % colors.length];
            let t = this.colorTime / COLOR_SWITCH_TIME;
            context.strokeStyle = col.lerp(nextCol, t).toColorString();
            this.colorTime += dt;
            while (this.colorTime >= COLOR_SWITCH_TIME) {
                this.colorTime -= COLOR_SWITCH_TIME;
                this.colorInd = (this.colorInd + 1) % colors.length;
            }
        } else {
            context.strokeStyle = this.color.toColorString();
        }

        context.lineWidth = this.width;

        if (this.points.length > 1) {
            context.beginPath();
            context.moveTo(this.points[0].x, this.points[0].y);
            for (let i = 1; i < this.points.length; i++) {
                context.lineTo(this.points[i].x, this.points[i].y);
            }
            context.stroke();
        }
    }

    mouseDown(x: number, y: number) {
        this.isDrawing = true;
        this._addPoint(x, y);
    }

    mouseUp(x: number, y: number) {
        this.isDrawing = false;
        this._addPoint(x, y);

        for (let i = 0; i < SMOOTHING_SAMPLES; i++) {
            this.smooth(this.points.length - 1 + (i - SMOOTHING_SAMPLES));
        }

        this.points = DouglasPeucker(this.points, 0.5);
    }

    mouseMove(x: number, y: number) {
        if (this.isDrawing) {
            this._addPoint(x, y);
        }
    }

    private _addPoint(x: number, y: number) {
        this.points.push(new Vec2(x, y));
        this.smooth(this.points.length - 1 - SMOOTHING_SAMPLES);
    }

    smooth(ind: number) {
        if (ind < 0 || ind >= this.points.length) return;

        let point = this.points[ind];
        let samples = 1;

        for (
            let i = Math.max(ind - SMOOTHING_SAMPLES, 0);
            i < ind;
            i++
        ) {
            point.i_add(this.points[i]);
            samples++;
        }

        for (
            let i = ind + 1;
            i <= Math.floor(Math.min(ind + SMOOTHING_SAMPLES, this.points.length - 1));
            i++
        ) {
            point.i_add(this.points[i]);
            samples++;
        }

        point.i_div_s(samples);
    }
}

let lastTime = 0;
let managers: DrawingManager[] = [];
let renderLoop = (timestamp: number) => {
    let dt = timestamp - lastTime;
    lastTime = timestamp;

    context.clearRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < managers.length; i++) {
        managers[i].renderLoop(dt);
    }

    requestAnimationFrame(renderLoop);
};

@Replicated()
export class DrawingManager {
    paths: Stroke[] = [];
    activePath: Stroke | null = null;
    widthSlider: HTMLInputElement | null = null;
    colorInput: HTMLInputElement | null = null;
    rainbowButton: HTMLButtonElement | null = null;
    mousePos = new Vec2(0, 0);
    rainbow = false;

    onSpawn() {
        console.log("OBJID", (this as any)._ownerId, NetworkManager.instance.userId, this);
        if ((this as any)._ownerId === NetworkManager.instance.userId) {
            canvas.addEventListener("pointerdown", (event) => { this.mouseDown(event.offsetX, event.offsetY); });
            canvas.addEventListener("pointerup", (event) => { this.mouseUp(event.offsetX, event.offsetY); });
            canvas.addEventListener("pointerout", (event) => { this.mouseUp(event.offsetX, event.offsetY); });
            canvas.addEventListener("pointermove", (event) => {
                //@ts-ignore
                if (event.getCoalescedEvents) {
                    //@ts-ignore
                    let events = event.getCoalescedEvents();
                    for (let i = 0; i < events.length; i++) {
                        this.mouseMove(events[i].offsetX, events[i].offsetY);
                    }
                } else {
                    this.mouseMove(event.offsetX, event.offsetY);
                }
            });

            this.colorInput = document.getElementById("lineCol") as HTMLInputElement;
            this.widthSlider = document.getElementById("widthSlider") as HTMLInputElement;
            this.rainbowButton = document.getElementById("rainbow") as HTMLButtonElement;

            this.rainbowButton.onclick = () => { this.toggleRainbow(); };
            this.colorInput.onclick = () => { if (this.rainbow) { this.toggleRainbow(); } }
            (document.getElementById("undo") as HTMLButtonElement).onclick = () => {
                this.undo();
            };
            // (document.getElementById("sendMessage") as HTMLFormElement).onclick = (event) => {
            //     event.preventDefault();
            //     this.sendMessage(chatInput.value);
            //     chatInput.value = "";
            // };
            (document.getElementById("clear") as HTMLButtonElement).onclick = () => {
                this.clear();
            };
            document.addEventListener('keydown', (event) => {
                if (event.ctrlKey && event.key === 'z') {
                    this.undo();
                }
            });
            managers.push(this);
        } else {
            if (managers.length === 0) {
                managers.push(this);
            } else {
                managers.splice(managers.length - 1, 0, this);
            }
        }
    }

    toggleRainbow() {
        if (this.rainbow) {
            this.rainbowButton?.classList.remove("rainbowOn");
            this.rainbow = false;
        } else {
            this.rainbowButton?.classList.add("rainbowOn");
            this.rainbow = true;
        }
    }

    @IRPC(Number, Number, Number, UInt8, UInt8, UInt8, Boolean)
    newPath(x: number, y: number, width: number, r: number, g: number, b: number, rainbow: boolean) {
        this.activePath = new Stroke(new Color(r, g, b), width, rainbow);
        this.paths.push(this.activePath);
        this.activePath.mouseDown(x, y);
    }

    @IRPC(Number, Number)
    mouseMove(x: number, y: number) {
        this.mousePos.x = x;
        this.mousePos.y = y;
        if (!this.activePath) return;
        this.activePath.mouseMove(x, y);
    }

    mouseDown(x: number, y: number) {
        let col = this.colorInput?.value || "#000000";
        let width = 1;

        if (this.widthSlider) {
            width = parseInt(this.widthSlider.value);
        }
        this.newPath(x, y, width, parseInt(col.substr(1, 2), 16), parseInt(col.substr(3, 2), 16), parseInt(col.substr(5, 2), 16), this.rainbow);
    }

    @IRPC()
    clear() {
        this.paths = [];
    }

    @IRPC()
    undo() {
        this.paths.pop();
    }

    // @IRPC(String)
    // sendMessage(message: string) {
    //     let div = document.createElement("div");
    //     div.textContent = message;
    //     chatbox.append(div);
    // }

    @IRPC(Number, Number)
    mouseUp(x: number, y: number) {
        if (!this.activePath) return;
        this.activePath.mouseUp(x, y);
        this.activePath = null;
    }

    renderLoop(dt: number) {
        for (let i = 0; i < this.paths.length; i++) {
            this.paths[i].draw(dt);
        }
        if ((this as any)._ownerId !== NetworkManager.instance.userId) {
            context.beginPath();
            context.fillStyle = "#000000";
            context.arc(this.mousePos.x, this.mousePos.y, 5, 0, Math.PI * 2);
            context.fill();
        }
    };
}

let statusDiv = document.getElementById("status") as HTMLElement;
let preloader = document.getElementById("preloader") as HTMLElement;
let controls = document.getElementById("controls") as HTMLElement;
let hostIFrame: HTMLIFrameElement | null = null;

// @ts-ignore
window.startHost = function (isNew: boolean) {
    if (isNew) {
        if (!hostIFrame) {
            hostIFrame = document.createElement("iframe");
            hostIFrame.src = window.location.href;
            hostIFrame.style.display = "none";
            document.body.append(hostIFrame);
            hostIFrame.onload = () => {
                // @ts-ignore
                hostIFrame.contentWindow?.startHost();
            }
        } else {
            hostIFrame.contentWindow?.location.reload();
        }
    } else {
        NetworkManager.instance.startHost().then((roomId: string) => {
            console.log("STARTED AS HOST WITH ROOM ID", roomId);
            // @ts-ignore
            window.parent.startedHost(roomId);
        });
    }
}

// @ts-ignore
window.startClient = function (roomId) {
    console.log('ROOMID', roomId);
    statusDiv.textContent = "Connecting...";
    NetworkManager.instance.connect(roomId).then((roomId) => {
        console.log('CONNECTED');
        // roomIdInput.value = roomId;
        statusDiv.textContent = roomId;
        statusDiv.onclick = () => {
            navigator.clipboard.writeText(`http://${window.location.hostname}:25565/?roomId=${roomId}`).then(function () {
                console.log('Async: Copying to clipboard was successful!');
            }, function (err) {
                console.error('Async: Could not copy text: ', err);
            });
        }
        statusDiv.click();
        NetworkManager.instance.onSyncCompleted = () => {
            console.log("Synced");
            canvas.classList.add("visible");
            controls.classList.add("visible");
            preloader.classList.add("hidden");
            manager = new DrawingManager();
            requestAnimationFrame(renderLoop);
        };
    }).catch(err => {
        statusDiv.textContent = "Failed to connect";
    });
};

// @ts-ignore
window.startedHost = (roomId) => {
    console.log("LOCATION", window.location.hostname);
    // @ts-ignore
    window.startClient(roomId);
}

window.onload = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const isHost = urlParams.get('isHost');
    const roomId = urlParams.get('roomId');
    const name = localStorage.getItem('username') || "Guest";

    if (isHost) {
        // @ts-ignore
        window.startHost(true);
    } else if (roomId) {
        // @ts-ignore
        window.startClient(roomId);
    } else {
        statusDiv.textContent = "Invalid Room ID";
    }
};