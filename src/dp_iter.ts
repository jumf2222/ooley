import { Vec2 } from "./util";

function PointLineDistance(point: Vec2, p1: Vec2, p2: Vec2): number {
    let t = 0;
    let segmentLength = p1.sqr_dist(p2);

    if (segmentLength === 0) {
        t = point.sqr_dist(p1);
    } else {
        t = ((point.x - p1.x) * (p2.x - p1.x) +
            (point.y - p1.y) * (p2.y - p1.y)) / segmentLength;
    }

    if (t < 0) { return Math.sqrt(point.sqr_dist(p1)); }
    if (t > 1) { return Math.sqrt(point.sqr_dist(p2)); }
    return Math.sqrt(point.sqr_dist(new Vec2(
        p1.x + t * (p2.x - p1.x),
        p1.y + t * (p2.y - p1.y)
    )));
}

function _DouglasPeucker(points: Vec2[], startIndex: number, lastIndex: number, epsilon: number) {
    let stk: [number, number][] = [];
    stk.push([startIndex, lastIndex]);

    let globalStartIndex = startIndex;
    let bitArray = new Array(lastIndex - startIndex + 1).fill(true);

    while (stk.length > 0) {
        let pair = stk.pop() as [number, number];
        startIndex = pair[0];
        lastIndex = pair[1];

        let dmax = 0;
        let index = startIndex;

        for (let i = index + 1; i < lastIndex; ++i) {
            if (bitArray[i - globalStartIndex]) {
                let d = PointLineDistance(points[i], points[startIndex], points[lastIndex]);

                if (d > dmax) {
                    index = i;
                    dmax = d;
                }
            }
        }

        if (dmax > epsilon) {
            stk.push([startIndex, index]);
            stk.push([index, lastIndex]);
        }
        else {
            for (let i = startIndex + 1; i < lastIndex; ++i) {
                bitArray[i - globalStartIndex] = false;
            }
        }
    }

    return bitArray;
}

export function DouglasPeucker(points: Vec2[], epsilon: number): Vec2[] {
    let bitArray = _DouglasPeucker(points, 0, points.length - 1, epsilon);
    let resList = [];

    for (let i = 0, n = points.length; i < n; ++i) {
        if (bitArray[i]) {
            resList.push(points[i]);
        }
    }
    return resList;
}