export class Vec2 {
    constructor(public x: number, public y: number) { }

    add(x: Vec2) {
        return new Vec2(this.x + x.x, this.y + x.y);
    }

    i_add(x: Vec2) {
        this.x += x.x;
        this.y += x.y;
    }

    div(x: Vec2) {
        return new Vec2(this.x / x.x, this.y / x.y);
    }

    i_div(x: Vec2) {
        this.x /= x.x;
        this.y /= x.y;
    }

    div_s(x: number) {
        return new Vec2(this.x / x, this.y / x);
    }

    i_div_s(x: number) {
        this.x /= x;
        this.y /= x;
    }

    sqr_dist(x: Vec2) {
        let dx = this.x - x.x;
        let dy = this.y - x.y;
        return dx * dx + dy * dy;
    }
}

export class Color {
    constructor(public r: number, public g: number, public b: number) { }

    lerp(x: Color, t: number) {
        return new Color(lerp(this.r, x.r, t), lerp(this.g, x.g, t), lerp(this.b, x.b, t));
    }

    toColorString() {
        return `rgb(${this.r},${this.g},${this.b})`;
    }
}


export function lerp(min: number, max: number, t: number) {
    return min + (max - min) * t;
}

export function bezierBlend(t: number) {
    return t * t * (3.0 - 2.0 * t);
}

export function parametricBlend(t: number) {
    let sqt = t * t;
    return sqt / (2.0 * (sqt - t) + 1.0);
}

export function easeIn(t: number) {
    return 2.0 * t * t;
}

export function easeOut(t: number) {
    return 2.0 * t * (1.0 - t) + 0.5;
}

export function inOutQuadBlend(t: number) {
    if (t <= 0.5) return 2.0 * t * t;
    t -= 0.5;
    return 2.0 * t * (1.0 - t) + 0.5;
}