import { clamp, negMod, sampleUniform } from "../common/math.js";
import { ProgramEvent } from "../core/event.js";
import { Bitmap } from "../renderer/bitmap.js";
import { Canvas } from "../renderer/canvas.js";
import { GameObject } from "./gameobject.js";


export const BASE_SHIFT_X = 2;

const SLOPE_WAIT_MIN = 2;
const SLOPE_WAIT_MAX = 12;

const MIN_HEIGHT = [1, 2];
const MAX_HEIGHT = [5, 4];

const DECORATION_WAIT_MIN = 8;
const DECORATION_WAIT_MAX = 16;


const enum TileType {

    None = 0,
    Surface = 1,
    Bridge = 2
};


const enum SlopeDirection {

    Up = -1,
    None = 0,
    Down = 1
};


const enum Decoration {

    None = 0,
    Palmtree = 1,
};


export const enum GroundLayerType {

    Foreground = 0,
    Background = 1
};


export class GroundLayer {


    private height : number[];
    private slope : SlopeDirection[];
    private type : TileType[];
    private decorations : Decoration[];

    private activeHeight : number;
    private activeType : TileType;
    private typeWait : number = 0;

    private slopeWait : number;
    private slopeDuration : number = 0;
    private activeSlope : SlopeDirection = SlopeDirection.None;
    private lastSlope : SlopeDirection = SlopeDirection.None;

    private gapTimer : number = 0;

    private decorationWait : number = 0;

    private ref : GroundLayer | undefined = undefined;

    private readonly layerType : GroundLayerType;
    private readonly width : number;
    private readonly shift : number;


    constructor(width : number, type : GroundLayerType, shift = 0) {

        const INITIAL_HEIGHT = [2, 0];
        const INITIAL_TYPE = [TileType.Surface, TileType.None];

        this.width = width;

        this.activeHeight = INITIAL_HEIGHT[type as number];
        this.activeType = INITIAL_TYPE[type as number];

        this.height = (new Array<number> (this.width)).fill(this.activeHeight);
        this.type = (new Array<TileType> (this.width)).fill(this.activeType);
        this.slope = (new Array<SlopeDirection> (this.width)).fill(SlopeDirection.None);
        this.decorations = (new Array<Decoration> (this.width)).fill(Decoration.None);

        this.slopeWait = sampleUniform(SLOPE_WAIT_MIN, SLOPE_WAIT_MAX);
        this.decorationWait = sampleUniform(DECORATION_WAIT_MIN, DECORATION_WAIT_MAX);
    
        this.layerType = type;
        this.shift = shift;
    }


    private getHeightRange () : [number, number] {

        let min = MIN_HEIGHT[this.layerType as number];
        let max = MAX_HEIGHT[this.layerType as number];
        if (this.layerType == GroundLayerType.Background) {

            min += this.ref?.activeHeight ?? 0;
            max += this.ref?.activeHeight ?? 0;
        }
        return [min, max];
    }


    private updateSlope() : void {

        const SLOPE_DURATION_MIN = 1;
        const SLOPE_DURATION_MAX = 2;

        this.lastSlope = this.activeSlope;

        if ((-- this.slopeDuration ) <= 0) {

            this.activeSlope = SlopeDirection.None;
        }

        let nextHeight : number;
        let dif : number;
        const [min, max] = this.getHeightRange();

        if (this.activeType == TileType.Surface && 
            this.layerType == GroundLayerType.Background &&
            this.ref !== undefined) {

            dif = this.activeHeight - this.ref.activeHeight;
            if ((this.ref.activeSlope == SlopeDirection.Up &&
                dif <= 2) || dif <= 1) {

                this.activeSlope = SlopeDirection.Up;
                this.slopeWait = 2;
                this.slopeDuration = 0;

                this.activeHeight -= this.activeSlope;
                ++ this.typeWait;

                return;
            }
        }

        if (this.activeType == TileType.Surface && 
            this.typeWait >= 2 &&
            (-- this.slopeWait) <= 0) {

            this.slopeDuration = Math.min(this.typeWait - 1, sampleUniform(SLOPE_DURATION_MIN, SLOPE_DURATION_MAX));
            this.slopeWait = (this.slopeDuration - 1) + sampleUniform(SLOPE_WAIT_MIN, SLOPE_WAIT_MAX);

            this.activeSlope = Math.random() < 0.5 ? SlopeDirection.Up : SlopeDirection.Down;

            nextHeight = this.activeHeight - this.activeSlope*this.slopeDuration;
            if (nextHeight != clamp(nextHeight, min, max)) {

                this.activeSlope *= -1;
            }

            ++ this.typeWait;
        }
        this.activeHeight -= this.activeSlope;
    }


    private updateType() : void {

        const TYPE_WAIT_MIN = [[2, 2, 2], [4, 2, 0]];
        const TYPE_WAIT_MAX = [[4, 16, 6], [16, 10, 0]];

        const GAP_JUMP_MAX = 2;
        const BRIDGE_PROB = [0.33, 0];

        let min : number;
        let max : number;

        const [minHeight, maxHeight] = this.getHeightRange();

        if (this.activeType == TileType.None) {

            ++ this.gapTimer;
        }

        if ((-- this.typeWait) <= 0 && this.lastSlope == SlopeDirection.None) {

            if (this.activeType != TileType.Surface) {

                this.activeType = TileType.Surface;
                if (this.layerType == GroundLayerType.Background) {

                    this.activeHeight = sampleUniform(minHeight, maxHeight);
                }

                this.gapTimer = 0;
            }
            else {

                this.activeType = Math.random() < BRIDGE_PROB[this.layerType as number] ? TileType.Bridge : TileType.None;
                if (this.layerType == GroundLayerType.Foreground &&
                    this.activeType == TileType.None) {

                    min = Math.max(minHeight, this.activeHeight - GAP_JUMP_MAX);
                    max = Math.min(maxHeight, this.activeHeight + GAP_JUMP_MAX);

                    this.activeHeight = sampleUniform(min, max);

                    // Try to avoid cases where the background layer goes behind
                    // the front layer
                    /*
                    if (this.ref !== undefined) {

                        if (this.ref.activeHeight <= this.activeHeight) {

                            if ((-- this.activeHeight) < MIN_HEIGHT[0]) {

                                this.activeHeight = MIN_HEIGHT[0];
                                ++ this.typeWait;
                                return;
                            }
                        }
                    }
                    */
                }
            }
            this.typeWait = sampleUniform(
                TYPE_WAIT_MIN[this.layerType as number][this.activeType], 
                TYPE_WAIT_MAX[this.layerType as number][this.activeType]);
        }
    }


    private updateDecorations(tilePointer : number) : boolean {

        if ((-- this.decorationWait) > 0)
            return false;

        if (this.activeType != TileType.Surface ||
            this.activeSlope != SlopeDirection.None ||
            (this.layerType == GroundLayerType.Foreground &&
             this.ref?.activeType !== TileType.None))
            return false;

        this.decorations[tilePointer] = Decoration.Palmtree;
        this.decorationWait = sampleUniform(DECORATION_WAIT_MIN, DECORATION_WAIT_MAX);

        return true;
    }


    private drawDecoration(canvas : Canvas, bmp : Bitmap | undefined,
        decoration : Decoration, dx : number, dy : number) : void {

        switch (decoration) {

        case Decoration.Palmtree:

            canvas.drawBitmap(bmp, dx - 8, dy - 33, 160, 0, 32, 33)
            break;

        default:
            break;
        }
    }


    public update(tilePointer : number) : void {

        this.updateSlope();
        this.updateType();
        if (!this.updateDecorations(tilePointer)) {

            this.decorations[tilePointer] = Decoration.None;
        }

        this.height[tilePointer] = this.activeHeight;
        this.type[tilePointer] = this.activeType;
        this.slope[tilePointer] = this.activeSlope; 
    }


    public setReferenceLayer(ref : GroundLayer) : void {

        this.ref = ref;
    }


    public draw(canvas : Canvas, bmp : Bitmap | undefined, 
        tilePointer : number, tileOffset : number) : void {

        const BRIDGE_Y_OFF = -2;
        const BASE_SRC_X = [80, 32, 96];
        const YOFF = [0, 0, -1];

        let i : number;
        let dx : number;
        let dy : number;
        let dir : number;

        const h = (canvas.height / 16) | 0;

        let sx : number;
        let left : boolean;
        let right : boolean;

        for (let x = 0; x < this.width; ++ x) {

            i = (x + tilePointer) % this.width;
            dir = this.slope[i];

            dx = x*16 - (tileOffset | 0) - BASE_SHIFT_X*16 + this.shift;
            dy = h - this.height[i];

            left = this.type[negMod(i - 1, this.width)] != TileType.Surface;
            right = this.type[(i + 1) % this.width] != TileType.Surface;

            if (this.decorations[i] != Decoration.None) {

                this.drawDecoration(canvas, bmp, this.decorations[i], dx, dy*16);
            }

            switch (this.type[i]) {

            case TileType.Surface:

                sx = BASE_SRC_X[dir + 1];
                if (left)
                    sx -= 16;
                else if (right)
                    sx += 16;

                canvas.drawBitmap(bmp, dx, dy*16 + YOFF[dir + 1]*16, sx, 0, 16, 32);

                // TODO: Find a way to avoid having to compute the same shit twice...
                sx = 32;
                if (left)
                    sx -= 16;
                else if (right)
                    sx += 16;

                for (let y = dy + YOFF[dir + 1] + 2; y < h; ++ y) {
                    
                    canvas.drawBitmap(bmp, dx, y*16, sx, y == dy ? 0 : 16, 16, 16);
                }

                // Grass edges
                if (left) {

                    canvas.drawBitmap(bmp, dx - 16, dy*16, 0, 0, 16, 16);
                }
                if (right) {

                    canvas.drawBitmap(bmp, dx + 16, dy*16, 64, 0, 16, 16);
                }

                break;

            case TileType.Bridge:

                canvas.drawBitmap(bmp, dx, dy*16 + BRIDGE_Y_OFF, 96, 32, 16, 16);
                break;

            default:
                break;
            }
        }
    }


    public objectCollision(o : GameObject, globalSpeed : number, 
        tilePointer : number, tileOffset : number, event : ProgramEvent,) : void {

        const OFFSET = 2;

        let i : number;
        let dx : number;
        let dy : number;

        const h = (event.screenHeight / 16) | 0;
        const px = (( (o.getPosition().x - this.shift) / 16) | 0) + BASE_SHIFT_X;

        let left = 0;
        let right = 0;

        for (let x = px - OFFSET; x <= px + OFFSET; ++ x) {

            i = negMod(x + tilePointer, this.width);

            // Ground collision
            if (this.type[i] == TileType.None)
                continue;

            left = Number(this.type[negMod(i - 1, this.width)] == TileType.None);
            right = Number(this.type[(i + 1) % this.width] == TileType.None);

            dx = x*16 - tileOffset - BASE_SHIFT_X*16 + this.shift;
            dy = (h - this.height[i])*16;

            switch (this.slope[i]) {

            case SlopeDirection.None:

                o.floorCollision(dx, dy, dx + 16, dy, globalSpeed, event, left, right);
                break;

            case SlopeDirection.Up:

                o.floorCollision(dx, dy + 16, dx + 16, dy, globalSpeed, event, 0, 0);
                break;

            case SlopeDirection.Down:

                o.floorCollision(dx, dy - 16, dx + 16, dy, globalSpeed, event, 0, 0);
                break;

            default:
                break;
            }
        }
    }


    public getHeight = () : number => this.activeHeight;
    public hasGap = () : boolean => this.activeType == TileType.None;

    
    public getDistanceFromPlatform = () : number => Math.min(this.gapTimer, this.typeWait);
}
