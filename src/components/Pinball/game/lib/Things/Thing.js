/**
 * Author: DrowsyFlesh
 * Create: 2019/4/3
 * Description: 物体类
 */
import {Rectangle, Container} from 'pixi.js';
import UUID from 'uuid/v1';
import {PullForce, PushForce, StaticFriction} from 'Pinball/game/lib/Forces';
import {BOTTOM, CENTER, EPSILON, LEFT, NOT_INTERSECT, RIGHT, TOP, LimitedVector2, Vector2} from 'Pinball/game/lib/Math';
import {RoundedRect} from 'Pinball/game/lib/Shapes';

export class CollisionResult {
    prototype;
    subAttrName;
    operation;
    value;
    priority;

    constructor(prototype, subAttrName, operation, value, priority = 0) {
        this.prototype = prototype;
        this.subAttrName = subAttrName;
        this.operation = operation;
        this.value = value;
        this.priority = priority;
    }
}

export class CollisionResultMap {
    /**
     * @type {Array<CollisionResult>}
     */
    results = [];

    constructor() {}

    get size() {
        return this.results.length;
    }

    sort() {
        this.results.sort((a, b) => a.priority < b.priority ? -1 : 0);
    }

    /**
     * 添加碰撞反应
     * @param collisionResult {Array<Object>|Object}
     */
    add(collisionResult) {
        if (collisionResult instanceof Array) {
            collisionResult.map((result) => {
                const {prototype, subAttrName, operation, value, priority = 0} = result;
                this.results.push(new CollisionResult(prototype, subAttrName, operation, value, priority));
            });
        } else {
            const {prototype, subAttrName, operation, value, priority = 0} = collisionResult;
            this.results.push(new CollisionResult(prototype, subAttrName, operation, value, priority));
        }
    }

    each(callback) {
        this.sort();
        if (typeof callback === 'function' && this.results.length > 0) {
            this.results.map(callback);
        }
    }

    clear() {
        this.results.length = 0;
    }
}

/**
 * 物体类
 */
export class Thing {
    /**
     * 同一帧更新标记，如果和当前time相同则默认不更新
     * @type {number}
     * @private
     */
    _updateSign = -1;
    _bbox;
    _mass;
    _halfWidth;
    _halfHeight;
    _nextBBox;
    /**
     * 标记质量是否变化
     * 如果density或者width，height变化则应该将该标记置为true
     * 初始为true，首次计算质量
     * @type {boolean}
     * @private
     */
    _massChanged = true;

    /**
     * 标记质量是否变化
     * 如果width，height变化则应该将该标记置为true
     * 初始为true，首次计算质量
     * @type {boolean}
     * @private
     */
    _width;
    _height;
    _widthChanged = true;
    _heightChanged = true;

    /**
     * 再相互作用力处理时，存储一帧中已经碰撞检测过的且力互相作用过的对象
     * 帧计算结束前清空重置
     * @type {Set<string>}
     * @private
     */
    _collisionCheckedMap = new Set();

    game; // pixi.js's application
    next = { // 碰撞检测前计算的出的运动结果数据集
        velocity: new LimitedVector2(0, 0),
    };

    collisionResult = new CollisionResultMap(); // 碰撞检测后，响应前存储的根据碰撞检测结果生成的调整数据集
    newNext = new Map(); // 碰撞响应后下一帧的数据集

    type; // 标记类型，默认为basic

    /**
     * 坐标位置
     * @param vector {LimitedVector2}
     * @private
     */
    _position; // 位置
    acceleration = new LimitedVector2(0, 0); // 加速度
    velocity = new LimitedVector2(0, 0); // 速度
    //mass; // 质量
    density; // 密度
    µ; // 摩擦力系数，包括静摩擦力和滑动摩擦力

    width;
    height;
    color;
    alpha;
    zIndex; // 图层高度
    shape; // 形状管理对象，更新并输出item
    item = new Container(); // 渲染对象

    forces = [];

    /**
     * 物体基类
     * @param app 渲染器对象
     * @param position 坐标
     * @param mass 质量
     * @param originAcceleration 初始加速度
     */
    constructor({game, type = 'basic', position, width, height, radius = 0, density, originAcceleration, color, alpha, µ = 0, zIndex = 0, pivot}) {
        this.id = UUID();
        this.game = game;
        this.type = type;

        this.position = position;
        this.next.position = position;

        //this.acceleration = originAcceleration;
        this.shape = new RoundedRect({
            width: width,
            height: height,
            radius: radius,
            alpha: alpha,
            color: color,
            pivot,
        });

        this.width = width;
        this.height = height;
        this.density = density;
        this.µ = µ;

        this.color = color;
        this.alpha = alpha;
        this.zIndex = zIndex;
        this.item.zIndex = zIndex;

        this.item.addChild(this.shape.item);

        originAcceleration && this.addForce(new PushForce(this, originAcceleration));
        this.addForce(new StaticFriction(this, this.µ));
    }

    get app() {
        return this.game.app;
    }

    get mass() {
        if (this._massChanged) {
            this._mass = this.width * this.height * this.density;
            this._massChanged = false;
        }
        return this._mass;
    }

    get width() {
        return this._width;
    }

    set width(n) {
        if (this._width === n) return;
        this._width = n;
        if (this.shape) this.shape.setSize({width: n});
        this._widthChanged = true;
    }

    get height() {
        return this._height;
    }

    set height(n) {
        if (this._height === n) return;
        this._height = n;
        if (this.shape) this.shape.setSize({height: n});
        this._heightChanged = true;
    }

    get volume() {
        return this.mass / this.density;
    }

    get radius() {
        return this.shape.radius;
    }

    set radius(n) {
        this.shape.radius = n;
    }

    get crossSection() { // 横截面积
        return this.volume / 5; // 先用体积的五分之一代替
    }

    get halfWidth() {
        if (this._widthChanged) {
            this._halfWidth = this.width / 2;
            this._widthChanged = false;
        }
        return this._halfWidth;
    }

    get halfHeight() {
        if (this._heightChanged) {
            this._halfHeight = this.height / 2;
            this._heightChanged = false;
        }
        return this._halfHeight;
    }

    get lastTime() {
        return this.app.ticker.lastTime;
    }

    /**
     * 属性设置
     */
    get position() {
        return this._position;
    }

    /**
     * 坐标位置
     * @param vector {LimitedVector2}
     */
    set position(vector) {
        this._position = vector;
        this.item.x = vector.x;
        this.item.y = vector.y;
    }

    get renderable() {
        return this.item.renderable;
    }

    set renderable(value) {
        this.item.renderable = value;
    }

    get rotation() {
        return this.shape.rotation;
    }

    set rotation(n) {
        this.shape.rotation = n;
    }

    /**
     * 状态更新处理
     */

    /**
     * 将上一帧计算的到并暂存在next中的数据更新到当前帧，用于计算下一帧
     */
    update() {
        for (let key in this.next) {
            const value = this.next[key];
            if (this[key]) {
                this[key] = value;
                delete this.next[key];
            }
        }
    }

    /**
     * 受力处理及相关部分
     */

    /**
     * 施加拉力
     */
    pull(vector) {
        this.addForce(new PullForce(this, vector));
    }

    /**
     * 对目标施加推力，同时会受到反作用力
     * @param targetThing {PIXI.Rectangle}
     */
    push(targetThing) {
        const pushForce = new PushForce(targetThing); // 对目标施加推力
        this.addForce(new PullForce(this, pushForce.reactionForce)); // 对自身施加其反作用力（拉力）
    }

    /**
     * 增加受力
     * @param force {Force}
     */
    addForce(force) {
        this.forces.push(force);
        return this;
    }

    clearForces() {
        this.forces.forEach((force, index) => {
            // 不满足条件的力并且是非持久力则删除
            if (force.instantaneous) this.forces.splice(index, 1);
        });
    }

    /**
     * 力的合成
     * 生成新的加速度，速度和位置到next中
     * @return {Thing}
     */
    composite() {
        const newAcceleration = new LimitedVector2(0, 0);
        this.forces.forEach((force) => {
            // 过滤掉不满足触发条件的力
            if (force.condition() && force.f.length > 0) { // 受力不为零
                newAcceleration.add(force.f);
            }
        });
        const newVelocity = this.velocity.clone().add(newAcceleration);
        const newPosition = this.position.clone().add(newVelocity);
        this.next['acceleration'] = newAcceleration;
        this.next['velocity'] = newVelocity;
        this.next['position'] = newPosition;
        return this;
    }

    /**
     * 碰撞检测结束，开始处理检测后的反应数据
     * 合并next和碰撞检测处理结果生成newNext用于下一帧的渲染数据
     * 结束后清理碰撞检测和反应的过程数据
     */
    compositeWithNextAndCollisionResult() {
        if (this.collisionResult.size > 0) {
            this.collisionResult.each((o) => {
                const {prototype, subAttrName, operation, value} = o;
                const param = this.next[prototype];
                if (param !== undefined) {
                    if (param instanceof LimitedVector2) {
                        if (operation === 'set') {
                            if (subAttrName && param[subAttrName] !== undefined) {
                                const newParam = param.clone();
                                newParam[subAttrName] = value;
                                this.newNext.set(prototype, newParam);
                            } else {
                                this.newNext.set(prototype, value);
                            }
                        } else if (operation === 'add' && value.length > 0) {
                            const newParam = param.clone();
                            if (subAttrName && param[subAttrName] !== undefined) {
                                newParam[subAttrName] += value;
                                this.newNext.set(prototype, newParam);
                            } else {
                                newParam.add(value);
                                this.newNext.set(prototype, newParam);
                            }
                        }
                    }
                }
            });
            this.collisionResult.clear();
        } else {
            for (let key in this.next) {
                this.newNext.set(key, this.next[key]);
            }
        }

        // 清理缓存数据
        this._collisionCheckedMap.clear();
        return this;
    }

    updateWithNewNext() {
        if (this.newNext.size > 0) {
            for (let [key, value] of this.newNext) this[key] = value;
            this.newNext.clear();
        }
        if (this.collisionResult.size > 0) {
            this.collisionResult.clear();
        }
        this.clearForces();
        return this;
    }

    /**
     * 碰撞检测部分
     */

    /**
     * 与物体进行碰撞检测并执行回调
     * @param thing {Thing} 碰撞对象
     * @param mutual {boolean} 标记是否有相互作用
     * @return {Thing}
     */
    collisionWithThingAndCallback(thing, callback = () => {}) {
        if (this._collisionCheckedMap.has(thing.id) || this.id === thing.id) return;
        else {
            this._collisionCheckedMap.add(thing.id);
            thing._collisionCheckedMap.add(this.id);
        }
        const collisionRes = this.onBBox(thing.nextBBox());
        if (!(collisionRes[0] === NOT_INTERSECT || collisionRes[1] === NOT_INTERSECT)) {
            let topS = this.topS(thing);
            let bottomS = this.bottomS(thing);
            let leftS = this.leftS(thing);
            let rightS = this.rightS(thing);

            const thisPosition = this.next.position;
            const targetPosition = thing.next.position;

            const thisL = (index) => thisPosition.x + this.radius[index];
            const thisR = (index) => thisPosition.x + this.width - this.radius[index];
            const thingL = (index) => targetPosition.x + thing.radius[index];
            const thingR = (index) => targetPosition.x + thing.width - thing.radius[index];

            const atUpOrDown = ((thisL(0) >= thingL(0) && thisR(1) <= thingR(1)) || (thisL(0) <= thingL(0) && thisR(1) >= thingR(1))) || ((thisL(3) >= thingL(3) && thisR(2) <= thingR(2)) || (thisL(3) <= thingL(3) && thisR(2) >= thingR(2)));
            if (atUpOrDown) {
                const atTop = Math.abs(topS) - Math.abs(bottomS) < 0 ? true : false;
                if (atTop) {
                    callback(topS);
                } else {
                    callback(bottomS);
                }
                return this;
            } else {
                const thisT = (index) => thisPosition.y + this.radius[index];
                const thisB = (index) => thisPosition.y + this.height - this.radius[index];
                const thingT = (index) => targetPosition.y + thing.radius[index];
                const thingB = (index) => targetPosition.y + thing.height - thing.radius[index];
                const atLeftOrRight = ((thisT(0) >= thingT(0) && thisB(1) <= thingB(1)) || (thisT(0) <= thingT(0) && thisB(1) >= thingB(1))) || ((thisT(3) >= thingT(3) && thisB(2) <= thingB(2)) || (thisT(3) <= thingT(3) && thisB(2) >= thingB(2)));

                if (atLeftOrRight) {
                    const atLeft = Math.abs(leftS) - Math.abs(rightS) < 0 ? true : false;
                    if (atLeft) {
                        callback(leftS);
                    } else {
                        callback(rightS);
                    }
                    return this;
                }
            }
            // 弹板角落回弹处理
            //top left
            if (this.collisionCheckWithCornerCircleAndCallback({
                thing, callback,
                radiusSUM: this.radius[2] + thing.radius[0],
                thisPoint: new Vector2(thisPosition.x + this.width - this.radius[2], thisPosition.y + this.height - this.radius[2]),
                point: targetPosition.clone().addScalar(thing.radius[0]),
            })) return this;

            // top right
            if (this.collisionCheckWithCornerCircleAndCallback({
                thing, callback,
                radiusSUM: this.radius[3] + thing.radius[1],
                thisPoint: new Vector2(thisPosition.x + this.radius[3], thisPosition.y + this.height - this.radius[3]),
                point: new Vector2(targetPosition.x + thing.width - thing.radius[1], targetPosition.y + thing.radius[1]),
            })) return this;

            // bottom left
            if (this.collisionCheckWithCornerCircleAndCallback({
                thing, callback,
                radiusSUM: this.radius[1] + thing.radius[3],
                thisPoint: new Vector2(thisPosition.x + this.width - this.radius[1], thisPosition.y + this.radius[1]),
                point: new Vector2(targetPosition.x + thing.radius[3], targetPosition.y + thing.height - thing.radius[3]),
            })) return this;

            // bottom right
            if (this.collisionCheckWithCornerCircleAndCallback({
                thing, callback,
                radiusSUM: this.radius[0] + thing.radius[2],
                thisPoint: thisPosition.clone().addScalar(this.radius[0]),
                point: new Vector2(targetPosition.x + thing.width - thing.radius[2], targetPosition.y + thing.height - thing.radius[2]),
            })) return this;
        }
    }

    /**
     * 与物体进行碰撞检测并作出反弹
     * @param thing {Thing} 碰撞对象
     * @param mutual {boolean} 标记是否有相互作用
     * @return {Thing}
     */
    collisionWithThingAndReflect(thing, mutual = false) {
        // 添加处理标记并排除自己
        if (this._collisionCheckedMap.has(thing.id) || this.id === thing.id) return;
        else {
            this._collisionCheckedMap.add(thing.id);
            thing._collisionCheckedMap.add(this.id);
        }

        const collisionRes = this.onBBox(thing.nextBBox());
        if (!(collisionRes[0] === NOT_INTERSECT || collisionRes[1] === NOT_INTERSECT)) {
            let topS = this.topS(thing);
            let bottomS = this.bottomS(thing);
            let leftS = this.leftS(thing);
            let rightS = this.rightS(thing);

            const thisPosition = this.next.position;
            const targetPosition = thing.next.position;

            const thisL = (index) => thisPosition.x + this.radius[index];
            const thisR = (index) => thisPosition.x + this.width - this.radius[index];
            const thingL = (index) => targetPosition.x + thing.radius[index];
            const thingR = (index) => targetPosition.x + thing.width - thing.radius[index];

            let delta;

            const atUpOrDown = ((thisL(0) >= thingL(0) && thisR(1) <= thingR(1)) || (thisL(0) <= thingL(0) && thisR(1) >= thingR(1))) || ((thisL(3) >= thingL(3) && thisR(2) <= thingR(2)) || (thisL(3) <= thingL(3) && thisR(2) >= thingR(2)));
            if (atUpOrDown) {
                const atTop = Math.abs(topS) - Math.abs(bottomS) < 0 ? true : false;
                if (atTop) {
                    delta = mutual ? topS / 2 : topS;
                } else {
                    delta = mutual ? -bottomS / 2 : -bottomS;
                }
                if (delta !== undefined) {
                    this.collisionResult.add([
                        {
                            prototype: 'position',
                            subAttrName: 'y',
                            operation: 'set',
                            value: this.next.position.clone().y - delta,
                        },
                        {
                            prototype: 'velocity',
                            operation: 'set',
                            value: this.next.velocity.clone().negateY(),
                        },
                    ]);

                    // 如果没有互相作用，则直接按照完全反弹处理
                    /*if (mutual) {
                        const thisMass = this.next.mass || this.mass;
                        const thingMass = thing.next.mass || thing.mass;

                        const normal = new Vector2(0, atTop ? 1 : -1);

                        // 计算两者互相碰撞时的互相作用力
                        const reflectionVectorFromThing = this.next.velocity.clone().negate().projectWithNormal(normal.clone());
                        const reflectionVectorFromThis = thing.next.velocity.clone().negate().projectWithNormal(normal.clone().negate());

                        reflectionVectorFromThing.length = ((thisMass - thingMass) * this.next.velocity.length + 2 * thingMass * thing.next.velocity.length) / (thisMass + thingMass);
                        reflectionVectorFromThis.length = ((thingMass - thisMass) * thing.next.velocity.length + 2 * thisMass * this.next.velocity.length) / (thisMass + thingMass);

                        if (thing.next.velocity.length < 0) {
                            reflectionVectorFromThis.radian = Math.PI + reflectionVectorFromThing.radian;
                        } else if (this.next.velocity.length < 0) {
                            reflectionVectorFromThing.radian = Math.PI + reflectionVectorFromThis.radian;
                        }

                        // 计算两物体运动方向夹角是否为锐角，大于零则为锐角，小于零则为钝角，等于零则互相垂直
                        const dot = this.next.velocity.dot(thing.next.velocity);
                        if (dot > 0) {
                            reflectionVectorFromThing.negate();
                        }

                        reflectionVectorFromThing.length > 0 && this.collisionResult.add({
                            prototype: 'velocity',
                            operation: 'set',
                            value: reflectionVectorFromThing,
                            priority: 10,
                        });

                        reflectionVectorFromThis.length > 0 && thing.collisionResult.add({
                            prototype: 'velocity',
                            operation: 'set',
                            value: reflectionVectorFromThis,
                            priority: 10,
                        });

                    }*/
                }
                return this;
            } else {
                const thisT = (index) => thisPosition.y + this.radius[index];
                const thisB = (index) => thisPosition.y + this.height - this.radius[index];
                const thingT = (index) => targetPosition.y + thing.radius[index];
                const thingB = (index) => targetPosition.y + thing.height - thing.radius[index];
                const atLeftOrRight = ((thisT(0) >= thingT(0) && thisB(1) <= thingB(1)) || (thisT(0) <= thingT(0) && thisB(1) >= thingB(1))) || ((thisT(3) >= thingT(3) && thisB(2) <= thingB(2)) || (thisT(3) <= thingT(3) && thisB(2) >= thingB(2)));

                if (atLeftOrRight) {
                    const atLeft = Math.abs(leftS) - Math.abs(rightS) < 0 ? true : false;
                    if (atLeft) {
                        delta = mutual ? leftS / 2 : leftS;
                    } else {
                        delta = mutual ? -rightS / 2 : -rightS;
                    }
                    if (delta !== undefined) {
                        this.collisionResult.add([
                            {
                                prototype: 'position',
                                subAttrName: 'x',
                                operation: 'set',
                                value: this.next.position.clone().x - delta,
                                priority: 10,
                            },
                            {
                                prototype: 'velocity',
                                operation: 'set',
                                value: this.next.velocity.clone().negateX(),
                            },
                        ]);

                        // 如果没有互相作用，则直接按照完全反弹处理
                        /*if (mutual) {
                            const thisMass = this.next.mass || this.mass;
                            const thingMass = thing.next.mass || thing.mass;

                            const normal = new Vector2(atLeft ? 1 : -1, 0);

                            // 计算两者互相碰撞时的互相作用力
                            const reflectionVectorFromThing = this.next.velocity.clone().negate().projectWithNormal(normal.clone());
                            const reflectionVectorFromThis = thing.next.velocity.clone().negate().projectWithNormal(normal.clone().negate());

                            reflectionVectorFromThing.length = ((thisMass - thingMass) * this.next.velocity.length + 2 * thingMass * thing.next.velocity.length) / (thisMass + thingMass);
                            reflectionVectorFromThis.length = ((thingMass - thisMass) * thing.next.velocity.length + 2 * thisMass * this.next.velocity.length) / (thisMass + thingMass);

                            if (thing.next.velocity.length < 0) {
                                reflectionVectorFromThis.radian = Math.PI + reflectionVectorFromThing.radian;
                            } else if (this.next.velocity.length < 0) {
                                reflectionVectorFromThing.radian = Math.PI + reflectionVectorFromThis.radian;
                            }

                            // 计算两物体运动方向夹角是否为锐角，大于零则为锐角，小于零则为钝角，等于零则互相垂直
                            const dot = this.next.velocity.dot(thing.next.velocity);
                            if (dot > 0) {
                                reflectionVectorFromThing.negate();
                            }

                            reflectionVectorFromThing.length > 0 && this.collisionResult.add({
                                prototype: 'velocity',
                                operation: 'set',
                                value: reflectionVectorFromThing,
                                priority: 10,
                            });

                            reflectionVectorFromThis.length > 0 && thing.collisionResult.add({
                                prototype: 'velocity',
                                operation: 'set',
                                value: reflectionVectorFromThis,
                                priority: 10,
                            });
                        }*/
                    }
                    return this;
                }
            }

            // 弹板角落回弹处理
            //top left
            if (this.collisionCheckWithCornerCircleAndReflect({
                mutual, thing,
                radiusSUM: this.radius[2] + thing.radius[0],
                thisPoint: new Vector2(thisPosition.x + this.width - this.radius[2], thisPosition.y + this.height - this.radius[2]),
                point: targetPosition.clone().addScalar(thing.radius[0]),
            })) return this;

            // top right
            if (this.collisionCheckWithCornerCircleAndReflect({
                mutual, thing,
                radiusSUM: this.radius[3] + thing.radius[1],
                thisPoint: new Vector2(thisPosition.x + this.radius[3], thisPosition.y + this.height - this.radius[3]),
                point: new Vector2(targetPosition.x + thing.width - thing.radius[1], targetPosition.y + thing.radius[1]),
            })) return this;

            // bottom left
            if (this.collisionCheckWithCornerCircleAndReflect({
                mutual, thing,
                radiusSUM: this.radius[1] + thing.radius[3],
                thisPoint: new Vector2(thisPosition.x + this.width - this.radius[1], thisPosition.y + this.radius[1]),
                point: new Vector2(targetPosition.x + thing.radius[3], targetPosition.y + thing.height - thing.radius[3]),
            })) return this;

            // bottom right
            if (this.collisionCheckWithCornerCircleAndReflect({
                mutual, thing,
                radiusSUM: this.radius[0] + thing.radius[2],
                thisPoint: thisPosition.clone().addScalar(this.radius[0]),
                point: new Vector2(targetPosition.x + thing.width - thing.radius[2], targetPosition.y + thing.height - thing.radius[2]),
            })) return this;
        }
        return this;
    }

    /**
     * 圆角碰撞并执行相应函数
     * @param radiusSUM
     * @param thing
     * @param point
     * @return {boolean}
     */
    collisionCheckWithCornerCircleAndCallback({callback, thing, radiusSUM, thisPoint, point}) {
        const distance = thisPoint.distanceTo(point);
        if (distance - radiusSUM <= 0) {
            let normalVector = thisPoint.clone().sub(point);

            // 嵌入时位置调整
            const amendVector = normalVector.clone();
            amendVector.length = radiusSUM - normalVector.length; // 修正向量

            callback(amendVector);
            return true;
        } else return false;
    }

    /**
     * 圆角碰撞并作出反弹
     * @param radiusSUM
     * @param thing
     * @param point
     * @return {boolean}
     */
    collisionCheckWithCornerCircleAndReflect({mutual, thing, radiusSUM, thisPoint, point}) {
        //const thisPosition = this.next.position;
        const thisVelocity = this.next.velocity;

        const distance = thisPoint.distanceTo(point);
        if (distance - radiusSUM <= 0) {
            let normalVector = thisPoint.clone().sub(point);

            // 嵌入时位置调整
            const amendVector = normalVector.clone();
            const delta = radiusSUM - normalVector.length;
            amendVector.length = mutual ? delta / 2 : delta; // 修正向量

            /*if (mutual) {

                const thisMass = this.next.mass || this.mass;
                const thingMass = thing.next.mass || thing.mass;

                // 计算this反射方向
                const reflectionVectorFromThing = thisVelocity.clone().negate().projectWithNormal(normalVector.clone());
                reflectionVectorFromThing.length = ((thisMass - thingMass) * thisVelocity.length + 2 * thingMass * thing.next.velocity.length) / (thisMass + thingMass);

                // 计算thing反射方向
                const reflectionVectorFromThis = thing.next.velocity.clone().negate().projectWithNormal(normalVector.clone().negate());
                reflectionVectorFromThis.length = ((thingMass - thisMass) * thing.next.velocity.length + 2 * thisMass * this.next.velocity.length) / (thisMass + thingMass);

                if (thing.next.velocity.length === 0) {
                    reflectionVectorFromThis.radian = Math.PI + reflectionVectorFromThing.radian;
                }
                if (this.next.velocity.length === 0) {
                    reflectionVectorFromThing.radian = Math.PI + reflectionVectorFromThis.radian;
                }

                // 计算两物体运动方向夹角是否为锐角，大于零则为锐角，小于零则为钝角，等于零则互相垂直
                const dot = this.next.velocity.dot(thing.next.velocity);
                //console.log(dot);
                if (dot > 0 && reflectionVectorFromThing.length > 0 && reflectionVectorFromThis.length > 0) {
                    reflectionVectorFromThing.negate();
                }
                //this.collisionResult.add(
                //    {
                //        prototype: 'position',
                //        operation: 'set',
                //        value: this.position.clone().add(amendVector),
                //        priority: 10,
                //    },
                //);
                //
                //thing.collisionResult.add(
                //    {
                //        prototype: 'position',
                //        operation: 'set',
                //        value: thing.position.clone().sub(amendVector),
                //        priority: 10,
                //    },
                //);



                reflectionVectorFromThing.length > 0 && this.collisionResult.add({
                    prototype: 'velocity',
                    operation: 'set',
                    value: reflectionVectorFromThing,
                    priority: 10,
                });

                reflectionVectorFromThis.length > 0 && thing.collisionResult.add({
                    prototype: 'velocity',
                    operation: 'set',
                    value: reflectionVectorFromThis,
                    priority: 10,
                });

            } else */
            const newVelocity = thisVelocity.clone().negate().projectWithNormal(normalVector);
            this.collisionResult.add([
                {
                    prototype: 'position',
                    operation: 'set',
                    value: this.next.position.clone().add(amendVector),
                    priority: 9,
                },
                {
                    prototype: 'velocity',
                    subAttrName: 'radian',
                    operation: 'set',
                    value: newVelocity.radian,
                    priority: 10,
                },
            ]);

            return true;
        } else return false;
    }

    /**
     * 与场景进行碰撞检测和碰撞反应处理，默认反弹
     * @param scene {Thing}
     * @return {Thing}
     */
    collisionWithScene(scene) {
        const collisionRes = scene.inBBox(this.nextBBox());
        if (collisionRes[0] === CENTER && collisionRes[1] === CENTER) return false; // 未与场景边缘碰撞
        if (collisionRes[0] === 'left' || collisionRes[0] === 'right') {
            this.collisionResult.add({
                prototype: 'velocity',
                operation: 'set',
                value: this.velocity.clone().negateX(),
                priority: 100,
            });
            if (collisionRes[0] === 'left') {
                this.collisionResult.add({
                    prototype: 'position',
                    subAttrName: 'x',
                    operation: 'set',
                    value: 0,
                    priority: 100,
                });
            } else if (collisionRes[0] === 'right') {
                this.collisionResult.add({
                    prototype: 'position',
                    subAttrName: 'x',
                    operation: 'set',
                    value: (scene.next.width || scene.width) - (this.next.width || this.width),
                    priority: 100,
                });
            }

        }
        if (collisionRes[1] === 'top' || collisionRes[1] === 'bottom') {
            this.collisionResult.add({
                prototype: 'velocity',
                operation: 'set',
                value: this.velocity.clone().negateY(),
                priority: 100,
            });
            if (collisionRes[1] === 'top') {
                this.collisionResult.add({
                    prototype: 'position',
                    subAttrName: 'y',
                    operation: 'set',
                    value: 0,
                    priority: 100,
                });
            } else if (collisionRes[1] === 'bottom') {
                this.collisionResult.add({
                    prototype: 'position',
                    subAttrName: 'y',
                    operation: 'set',
                    value: (scene.next.height || scene.height) - (this.next.height || this.height),
                    priority: 100,
                });
            }
        }
        return this;
    }

    /**
     * 获取
     * @param force 强制更新标记
     * @return {PIXI.Rectangle}
     */
    BBox(force = false) {
        if (this._updateSign !== this.lastTime || force) {
            this._updateSign = this.lastTime;
            this._bbox = new Rectangle(this.position.x, this.position.y, this.width, this.height);
        }
        return this._bbox;
    }

    /**
     * 根据下一帧数据返回BBox
     * @return {PIXI.Rectangle}
     */
    nextBBox(force = false) {
        if (this._updateSign !== this.lastTime || force) {
            this._updateSign = this.lastTime;
            const {position} = this.next;
            const {width, height} = this.item;
            this._nextBBox = new Rectangle(position.x, position.y, width, height);
        }
        return this._nextBBox;
    }

    /**
     * 包围盒内测试，返回全包含和碰撞方向两种状态
     * @param targetBoundRect {PIXI.Rectangle}
     * @return {*[]}
     */
    inBBox(targetBoundRect) {
        const [axis1, axis2] = this.checkBBox(targetBoundRect);
        let res = [null, null];

        if (axis1 <= 3) res[0] = LEFT;
        else if (axis1 >= 5) res[0] = RIGHT;
        else res[0] = CENTER;

        if (axis2 <= 3) res[1] = TOP;
        else if (axis2 >= 5) res[1] = BOTTOM;
        else res[1] = CENTER;

        return res;
    }

    /**
     * 包围盒测试，返回全包含，碰撞方向和未碰撞三种状态
     * @param targetBoundRect {PIXI.Rectangle}
     * @return {*[]}
     */
    onBBox(targetBoundRect) {
        const [axis1, axis2] = this.checkBBox(targetBoundRect);
        let res = [null, null];

        if (axis1 === 1 || axis1 === 2) res[0] = RIGHT;
        else if (axis1 === 7 || axis1 === 8) res[0] = LEFT;
        else if (axis1 === 0 || axis1 === 9) {
            res[0] = NOT_INTERSECT;
        } else res[0] = CENTER;

        if (axis2 === 1 || axis2 === 2) res[1] = BOTTOM;
        else if (axis2 === 7 || axis2 === 8) res[1] = TOP;
        else if (axis2 === 0 || axis2 === 9) {
            res[1] = NOT_INTERSECT;
        } else res[1] = CENTER;

        return res;
    }

    /**
     * 包围盒测试，返回未碰撞和其他两种状态
     * @param targetBoundRect {PIXI.Rectangle}
     * @return {*[]}
     */
    outBBox(targetBoundRect) {
        const [axis1, axis2] = this.checkBBox(targetBoundRect);

        let res = [null, null];

        if (axis1 < 1) res[0] = RIGHT;
        else if (axis1 > 8) res[0] = LEFT;
        else res[0] = CENTER;

        if (axis2 < 1) res[1] = BOTTOM;
        else if (axis2 > 8) res[1] = TOP;
        else res[1] = CENTER;

        return res;
    }

    /**
     * bbox双轴测试
     * @param {PIXI.Rectangle}
     * @return {number[]}
     */
    checkBBox(targetBoundRect) {
        const {x, width, y, height, right, bottom} = targetBoundRect;
        const bbox = this.nextBBox();
        const axis1 = this.segmentRelationship( // y轴向那一测的投影测试
            {
                x: bbox.left,
                w: bbox.width,
                y: bbox.right,
            },
            {
                x,
                w: width,
                y: right,
            },
        );
        const axis2 = this.segmentRelationship( // x轴向那一测的投影测试
            {
                x: bbox.y,
                w: bbox.height,
                y: bbox.bottom,
            },
            {
                x: y,
                w: height,
                y: bottom,
            },
        );
        return [axis1, axis2];
    }

    /**
     * 根据分离轴定律做包围盒相交性测试
     * 判断两线段位置关系
     * @param segment1
     * @param segment2
     * @return {number}
     */
    segmentRelationship({x: x1, w: w1, y: y1}, {x: x2, w: w2, y: y2}) {
        const deltaX = x1 - x2;
        const deltaW = w1 - w2;
        const deltaY = y1 - y2;
        if (y1 < x2) return 0; // 左不交
        else if (x1 > y2) return 9; // 右不交
        else if (x1 > x2 && y2 < y1) return 2; // 左相交
        else if (x1 < x2 && y2 > y1) return 7; // 右相交
        else if ((deltaX > 0 && deltaY < 0) || (deltaX < 0 && deltaY > 0)) return 4; // 全包含
        else if (y1 === x2) return 1; // 左相邻
        else if (y2 === x1) return 8; // 右相邻
        else if (deltaX === 0 && deltaY !== 0) return 3; // 左对齐
        else if (deltaX !== 0 && deltaY === 0) return 6; // 右对齐
        else if (deltaX === 0 && deltaW === 0) return 5; // 完全对齐
    }

    // 用于包围盒检测，但是是可以获得接触时的偏移差值，用于位置修正

    topS = (target) => target.position.y - this.position.y - this.height;
    bottomS = (target) => this.position.y - target.position.y - target.height;
    leftS = (target) => target.position.x - this.position.x - this.width;
    rightS = (target) => this.position.x - target.position.x - target.width;
}
