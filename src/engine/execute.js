const BlockUtility = require('./block-utility');
const BlocksExecuteCache = require('./blocks-execute-cache');
const log = require('../util/log');
const Thread = require('./thread');
const {Map} = require('immutable');
const cast = require('../util/cast');
const Sensing = require('../blocks/scratch3_sensing');
const twgl = require('twgl.js');

/**
 * Single BlockUtility instance reused by execute for every pritimive ran.
 * @const
 */
const blockUtility = new BlockUtility();

/**
 * Profiler frame name for block functions.
 * @const {string}
 */
const blockFunctionProfilerFrame = 'blockFunction';

/**
 * Holds all timeDependent opcodes.
 * @type {string[]}
 */
const timeDependentOpCodes = ['control_wait', 'looks_thinkforsecs', 'looks_sayforsecs', 'motion_glidesecstoxy',
    'motion_glideto', 'sound_playuntildone', 'text2speech_speakAndWait'];

/**
 * Holds all operator opcodes.
 * @type {string[]}
 */
const operatorBlockOpcode = ['operator_lt', 'operator_gt', 'operator_equals', 'operator_and', 'operator_or',
    'operator_not'];

/**
 * Profiler frame ID for 'blockFunction'.
 * @type {number}
 */
let blockFunctionProfilerId = -1;

/**
 * Utility function to determine if a value is a Promise.
 * @param {*} value Value to check for a Promise.
 * @return {boolean} True if the value appears to be a Promise.
 */
const isPromise = function (value) {
    return (
        value !== null &&
        typeof value === 'object' &&
        typeof value.then === 'function'
    );
};

/**
 * Handle any reported value from the primitive, either directly returned
 * or after a promise resolves.
 * @param {*} resolvedValue Value eventually returned from the primitive.
 * @param {!Sequencer} sequencer Sequencer stepping the thread for the ran
 * primitive.
 * @param {!Thread} thread Thread containing the primitive.
 * @param {!string} currentBlockId Id of the block in its thread for value from
 * the primitive.
 * @param {!string} opcode opcode used to identify a block function primitive.
 * @param {!boolean} isHat Is the current block a hat?
 */
// @todo move this to callback attached to the thread when we have performance
// metrics (dd)
const handleReport = function (resolvedValue, sequencer, thread, blockCached, lastOperation) {
    const currentBlockId = blockCached.id;
    const opcode = blockCached.opcode;
    const isHat = blockCached._isHat;

    thread.pushReportedValue(resolvedValue);
    if (isHat) {
        // Hat predicate was evaluated.
        if (sequencer.runtime.getIsEdgeActivatedHat(opcode)) {
            // If this is an edge-activated hat, only proceed if the value is
            // true and used to be false, or the stack was activated explicitly
            // via stack click
            if (!thread.stackClick) {
                const hasOldEdgeValue = thread.target.hasEdgeActivatedValue(currentBlockId);
                const oldEdgeValue = thread.target.updateEdgeActivatedValue(
                    currentBlockId,
                    resolvedValue
                );

                const edgeWasActivated = hasOldEdgeValue ? (!oldEdgeValue && resolvedValue) : resolvedValue;
                if (!edgeWasActivated) {
                    sequencer.retireThread(thread);
                }
            }
        } else if (!resolvedValue) {
            // Not an edge-activated hat: retire the thread
            // if predicate was false.
            sequencer.retireThread(thread);
        }
    } else {
        // In a non-hat, report the value visually if necessary if
        // at the top of the thread stack.
        if (lastOperation && typeof resolvedValue !== 'undefined' && thread.atStackTop()) {
            if (thread.stackClick) {
                sequencer.runtime.visualReport(currentBlockId, resolvedValue);
            }
            if (thread.updateMonitor) {
                const targetId = sequencer.runtime.monitorBlocks.getBlock(currentBlockId).targetId;
                if (targetId && !sequencer.runtime.getTargetById(targetId)) {
                    // Target no longer exists
                    return;
                }
                sequencer.runtime.requestUpdateMonitor(Map({
                    id: currentBlockId,
                    spriteName: targetId ? sequencer.runtime.getTargetById(targetId)
                        .getName() : null,
                    value: resolvedValue
                }));
            }
        }
        // Finished any yields.
        thread.status = Thread.STATUS_RUNNING;
    }
};

const handlePromise = (primitiveReportedValue, sequencer, thread, blockCached, lastOperation) => {
    if (thread.status === Thread.STATUS_RUNNING) {
        // Primitive returned a promise; automatically yield thread.
        thread.status = Thread.STATUS_PROMISE_WAIT;
    }
    // Promise handlers
    primitiveReportedValue.then(resolvedValue => {
        handleReport(resolvedValue, sequencer, thread, blockCached, lastOperation);
        // If it's a command block or a top level reporter in a stackClick.
        if (lastOperation) {
            let stackFrame;
            let nextBlockId;
            do {
                // In the case that the promise is the last block in the current thread stack
                // We need to pop out repeatedly until we find the next block.
                const popped = thread.popStack();
                if (popped === null) {
                    return;
                }
                nextBlockId = thread.target.blocks.getNextBlock(popped);
                if (nextBlockId !== null) {
                    // A next block exists so break out this loop
                    break;
                }
                // Investigate the next block and if not in a loop,
                // then repeat and pop the next item off the stack frame
                stackFrame = thread.peekStackFrame();
            } while (stackFrame !== null && !stackFrame.isLoop);

            thread.pushStack(nextBlockId);
        }
    }, rejectionReason => {
        // Promise rejected: the primitive had some error.
        // Log it and proceed.
        log.warn('Primitive rejected promise: ', rejectionReason);
        thread.status = Thread.STATUS_RUNNING;
        thread.popStack();
    });
};

/**
 * A execute.js internal representation of a block to reduce the time spent in
 * execute as the same blocks are called the most.
 *
 * With the help of the Blocks class create a mutable copy of block
 * information. The members of BlockCached derived values of block information
 * that does not need to be reevaluated until a change in Blocks. Since Blocks
 * handles where the cache instance is stored, it drops all cache versions of a
 * block when any change happens to it. This way we can quickly execute blocks
 * and keep perform the right action according to the current block information
 * in the editor.
 *
 * @param {Blocks} blockContainer the related Blocks instance
 * @param {object} cached default set of cached values
 */
class BlockCached {
    constructor(blockContainer, cached) {
        /**
         * Block id in its parent set of blocks.
         * @type {string}
         */
        this.id = cached.id;

        /**
         * Block operation code for this block.
         * @type {string}
         */
        this.opcode = cached.opcode;

        /**
         * Specifies whether this block is a time-dependent execution halting block such as a wait block.
         * @type {boolean}
         */
        this.isTimeDependentBlock = false;

        /**
         * Original block object containing argument values for static fields.
         * @type {object}
         */
        this.fields = cached.fields;

        /**
         * Original block object containing argument values for executable inputs.
         * @type {object}
         */
        this.inputs = cached.inputs;

        /**
         * Procedure mutation.
         * @type {?object}
         */
        this.mutation = cached.mutation;

        /**
         * The profiler the block is configured with.
         * @type {?Profiler}
         */
        this._profiler = null;

        /**
         * Profiler information frame.
         * @type {?ProfilerFrame}
         */
        this._profilerFrame = null;

        /**
         * Is the opcode a hat (event responder) block.
         * @type {boolean}
         */
        this._isHat = false;

        /**
         * The block opcode's implementation function.
         * @type {?function}
         */
        this._blockFunction = null;

        /**
         * Is the block function defined for this opcode?
         * @type {boolean}
         */
        this._definedBlockFunction = false;

        /**
         * Is this block a block with no function but a static value to return.
         * @type {boolean}
         */
        this._isShadowBlock = false;

        /**
         * The static value of this block if it is a shadow block.
         * @type {?any}
         */
        this._shadowValue = null;

        /**
         * A copy of the block's fields that may be modified.
         * @type {object}
         */
        this._fields = Object.assign({}, this.fields);

        /**
         * A copy of the block's inputs that may be modified.
         * @type {object}
         */
        this._inputs = Object.assign({}, this.inputs);

        /**
         * An arguments object for block implementations. All executions of this
         * specific block will use this objecct.
         * @type {object}
         */
        this._argValues = {
            mutation: this.mutation
        };

        /**
         * An arguments object for raw inputs. Used for tracing
         * @type {object}
         */
        this._distances = null;

        /**
         * The inputs key the parent refers to this BlockCached by.
         * @type {string}
         */
        this._parentKey = null;

        /**
         * The target object where the parent wants the resulting value stored
         * with _parentKey as the key.
         * @type {object}
         */
        this._parentValues = null;

        /**
         * The target object where the parent wants branch distances of its ops stored (used for tracing)
         * with _parentKey as the key.
         * @type {object}
         */
        this._parentDistances = null;

        this._parentNegated = false;

        /**
         * Stores the BlockUtility Object used for calculating the remaining steps for execution halting blocks.
         * @type {BlockUtility}
         */
        this.utility = blockUtility;

        /**
         * A sequence of non-shadow operations that can must be performed. This
         * list recreates the order this block and its children are executed.
         * Since the order is always the same we can safely store that order
         * and iterate over the operations instead of dynamically walking the
         * tree every time.
         * @type {Array<BlockCached>}
         */
        this._ops = [];

        const {runtime} = blockUtility.sequencer;

        const {opcode, fields, inputs} = this;

        // Assign opcode isHat and blockFunction data to avoid dynamic lookups.
        this._isHat = runtime.getIsHat(opcode);
        this._blockFunction = runtime.getOpcodeFunction(opcode);
        this._definedBlockFunction = typeof this._blockFunction !== 'undefined';
        this._distances = [];

        // Store the current shadow value if there is a shadow value.
        const fieldKeys = Object.keys(fields);
        this._isShadowBlock = (
            !this._definedBlockFunction &&
            fieldKeys.length === 1 &&
            Object.keys(inputs).length === 0
        );
        this._shadowValue = this._isShadowBlock && fields[fieldKeys[0]].value;

        // Store the static fields onto _argValues.
        for (const fieldName in fields) {
            if (
                fieldName === 'VARIABLE' ||
                fieldName === 'LIST' ||
                fieldName === 'BROADCAST_OPTION'
            ) {
                this._argValues[fieldName] = {
                    id: fields[fieldName].id,
                    name: fields[fieldName].value
                };
            } else {
                this._argValues[fieldName] = fields[fieldName].value;
            }
        }

        // Remove custom_block. It is not part of block execution.
        delete this._inputs.custom_block;

        if ('BROADCAST_INPUT' in this._inputs) {
            // BROADCAST_INPUT is called BROADCAST_OPTION in the args and is an
            // object with an unchanging shape.
            this._argValues.BROADCAST_OPTION = {
                id: null,
                name: null
            };

            // We can go ahead and compute BROADCAST_INPUT if it is a shadow
            // value.
            const broadcastInput = this._inputs.BROADCAST_INPUT;
            if (broadcastInput.block === broadcastInput.shadow) {
                // Shadow dropdown menu is being used.
                // Get the appropriate information out of it.
                const shadow = blockContainer.getBlock(broadcastInput.shadow);
                const broadcastField = shadow.fields.BROADCAST_OPTION;
                this._argValues.BROADCAST_OPTION.id = broadcastField.id;
                this._argValues.BROADCAST_OPTION.name = broadcastField.value;

                // Evaluating BROADCAST_INPUT here we do not need to do so
                // later.
                delete this._inputs.BROADCAST_INPUT;
            }
        }

        // Cache all input children blocks in the operation lists. The
        // operations can later be run in the order they appear in correctly
        // executing the operations quickly in a flat loop instead of needing to
        // recursivly iterate them.
        for (const inputName in this._inputs) {
            const input = this._inputs[inputName];
            if (input.block) {
                const inputCached = BlocksExecuteCache.getCached(blockContainer, input.block, BlockCached);

                if (inputCached._isHat) {
                    continue;
                }

                this._ops.push(...inputCached._ops);
                inputCached._parentKey = inputName;
                inputCached._parentValues = this._argValues;
                inputCached._parentDistances = this._distances;

                if (this._parentNegated || this.opcode === 'operator_not') {
                    inputCached._parentNegated = !this._parentNegated;
                } else {
                    inputCached._parentNegated = this._parentNegated;
                }

                // Shadow values are static and do not change, go ahead and
                // store their value on args.
                if (inputCached._isShadowBlock) {
                    this._argValues[inputName] = inputCached._shadowValue;
                }
            }
        }

        // The final operation is this block itself. At the top most block is a
        // command block or a block that is being run as a monitor.
        if (this._definedBlockFunction) {
            this._ops.push(this);
        }

        this.isTimeDependentBlock = timeDependentOpCodes.includes(this.opcode);
    }
}

/**
 * Initialize a BlockCached instance so its command/hat
 * block and reporters can be profiled during execution.
 * @param {Profiler} profiler - The profiler that is currently enabled.
 * @param {BlockCached} blockCached - The blockCached instance to profile.
 */
const _prepareBlockProfiling = function (profiler, blockCached) {
    blockCached._profiler = profiler;

    if (blockFunctionProfilerId === -1) {
        blockFunctionProfilerId = profiler.idByName(blockFunctionProfilerFrame);
    }

    const ops = blockCached._ops;
    for (let i = 0; i < ops.length; i++) {
        ops[i]._profilerFrame = profiler.frame(blockFunctionProfilerId, ops[i].opcode);
    }
};

/**
 * Execute a block.
 * @param {!Sequencer} sequencer Which sequencer is executing.
 * @param {!Thread} thread Thread which to read and execute.
 */
const execute = function (sequencer, thread) {
    const runtime = sequencer.runtime;

    // store sequencer and thread so block functions can access them through
    // convenience methods.
    blockUtility.sequencer = sequencer;
    blockUtility.thread = thread;

    // Current block to execute is the one on the top of the stack.
    const currentBlockId = thread.peekStack();
    const currentStackFrame = thread.peekStackFrame();

    let blockContainer = thread.blockContainer;
    let blockCached = BlocksExecuteCache.getCached(blockContainer, currentBlockId, BlockCached);
    if (blockCached === null) {
        blockContainer = runtime.flyoutBlocks;
        blockCached = BlocksExecuteCache.getCached(blockContainer, currentBlockId, BlockCached);
        // Stop if block or target no longer exists.
        if (blockCached === null) {
            // No block found: stop the thread; script no longer exists.
            sequencer.retireThread(thread);
            return;
        }
    }

    const ops = blockCached._ops;
    const length = ops.length;

    let i = 0;

    if (currentStackFrame.reported !== null) {
        const reported = currentStackFrame.reported;
        // Reinstate all the previous values.
        for (; i < reported.length; i++) {
            const {opCached: oldOpCached, inputValue} = reported[i];

            const opCached = ops.find(op => op.id === oldOpCached);

            if (opCached) {
                const inputName = opCached._parentKey;
                const argValues = opCached._parentValues;

                if (inputName === 'BROADCAST_INPUT') {
                    // Something is plugged into the broadcast input.
                    // Cast it to a string. We don't need an id here.
                    argValues.BROADCAST_OPTION.id = null;
                    argValues.BROADCAST_OPTION.name = cast.toString(inputValue);
                } else {
                    argValues[inputName] = inputValue;
                }
            }
        }

        // Find the last reported block that is still in the set of operations.
        // This way if the last operation was removed, we'll find the next
        // candidate. If an earlier block that was performed was removed then
        // we'll find the index where the last operation is now.
        if (reported.length > 0) {
            const lastExisting = reported.reverse()
                .find(report => ops.find(op => op.id === report.opCached));
            if (lastExisting) {
                i = ops.findIndex(opCached => opCached.id === lastExisting.opCached) + 1;
            } else {
                i = 0;
            }
        }

        // The reporting block must exist and must be the next one in the sequence of operations.
        if (thread.justReported !== null && ops[i] && ops[i].id === currentStackFrame.reporting) {
            const opCached = ops[i];
            const inputValue = thread.justReported;

            thread.justReported = null;

            const inputName = opCached._parentKey;
            const argValues = opCached._parentValues;

            if (inputName === 'BROADCAST_INPUT') {
                // Something is plugged into the broadcast input.
                // Cast it to a string. We don't need an id here.
                argValues.BROADCAST_OPTION.id = null;
                argValues.BROADCAST_OPTION.name = cast.toString(inputValue);
            } else {
                argValues[inputName] = inputValue;
            }

            i += 1;
        }

        currentStackFrame.reporting = null;
        currentStackFrame.reported = null;
    }

    // If we do not have any ops and this is a hat we can set the distances automatically
    if (length === 0 && (blockCached.opcode.startsWith('event_') ||
        blockCached.opcode === 'control_start_as_clone')) {
        blockCached._distances.push([0, 1]);
    } else if (blockCached.opcode === 'procedures_definition' || blockCached.opcode === 'procedures_call') {
        blockCached._distances.push([0, 1]);
    }

    const start = i;

    for (; i < length; i++) {
        const lastOperation = i === length - 1;
        const opCached = ops[i];

        const blockFunction = opCached._blockFunction;

        // Update values for arguments (inputs).
        const argValues = opCached._argValues;

        // Fields are set during opCached initialization.

        // Blocks should glow when a script is starting,
        // not after it has finished (see #1404).
        // Only blocks in blockContainers that don't forceNoGlow
        // should request a glow.
        if (!blockContainer.forceNoGlow) {
            thread.requestScriptGlowInFrame = true;
        }

        // Inputs are set during previous steps in the loop.

        const primitiveReportedValue = blockFunction(argValues, blockUtility);
        const primitiveBranchDistanceValue = branchDistanceValue(blockFunction, argValues, opCached, primitiveReportedValue, runtime, thread.target, blockUtility);

        // If it's a promise, wait until promise resolves.
        if (isPromise(primitiveReportedValue)) {
            handlePromise(primitiveReportedValue, sequencer, thread, opCached, lastOperation);

            // Store the already reported values. They will be thawed into the
            // future versions of the same operations by block id. The reporting
            // operation if it is promise waiting will set its parent value at
            // that time.
            thread.justReported = null;
            currentStackFrame.reporting = ops[i].id;
            currentStackFrame.reported = ops.slice(0, i)
                .map(reportedCached => {
                    const inputName = reportedCached._parentKey;
                    const reportedValues = reportedCached._parentValues;

                    if (inputName === 'BROADCAST_INPUT') {
                        return {
                            opCached: reportedCached.id,
                            inputValue: reportedValues[inputName].BROADCAST_OPTION.name
                        };
                    }
                    return {
                        opCached: reportedCached.id,
                        inputValue: reportedValues[inputName]
                    };
                });

            // We are waiting for a promise. Stop running this set of operations
            // and continue them later after thawing the reported values.
            break;
        } else if (thread.status === Thread.STATUS_RUNNING) {
            if (lastOperation) {
                handleReport(primitiveReportedValue, sequencer, thread, opCached, lastOperation);
                if (opCached._distances) {
                    opCached._distances.push(primitiveBranchDistanceValue);
                }
            } else {
                // By definition a block that is not last in the list has a
                // parent.
                const inputName = opCached._parentKey;
                const parentValues = opCached._parentValues;
                opCached._parentDistances.push(primitiveBranchDistanceValue);

                if (inputName === 'BROADCAST_INPUT') {
                    // Something is plugged into the broadcast input.
                    // Cast it to a string. We don't need an id here.
                    parentValues.BROADCAST_OPTION.id = null;
                    parentValues.BROADCAST_OPTION.name = cast.toString(primitiveReportedValue);
                } else {
                    parentValues[inputName] = primitiveReportedValue;
                }
            }
        }
        // Add branchDistances for time-dependent execution halting blocks.
        else if (timeDependentOpCodes.includes(opCached.opcode)){
            opCached._distances[0] = primitiveBranchDistanceValue;
        }
    }

    runtime.traceInfo.tracer.traceExecutedBlock(blockCached);

    // TODO: Why > 0?
    while (blockCached._distances.length > 0) {
        blockCached._distances.pop();
    }

    for (let j = 0; j < length; j++) {
        const opCached = ops[j];
        // sadly we need to do this with a loop because we still have references to this array
        while (opCached._distances.length) {
            opCached._distances.pop();
        }
    }

    if (runtime.profiler !== null) {
        if (blockCached._profiler !== runtime.profiler) {
            _prepareBlockProfiling(runtime.profiler, blockCached);
        }
        // Determine the index that is after the last executed block. `i` is
        // currently the block that was just executed. `i + 1` will be the block
        // after that. `length` with the min call makes sure we don't try to
        // reference an operation outside of the set of operations.
        const end = Math.min(i + 1, length);
        for (let p = start; p < end; p++) {
            ops[p]._profilerFrame.count += 1;
        }
    }
};


const getCachedTrueDistance = function (distanceValues) {
    if (distanceValues !== undefined) {
        return distanceValues[0];
    } else {
        // True-distance to undefined is 1
        return 1;
    }
};

const getCachedFalseDistance = function (distanceValues) {
    if (distanceValues !== undefined) {
        return distanceValues[1];
    } else {
        // False-distance to undefined is 0
        return 0;
    }
};

/**
 * Specialization of sets intended for managing coordinates of points (pairs of whole numbers) on a two-dimensional
 * integer grid. Duplicate elimination is performed by checking structural equality rather than referential equality.
 * This means, two pairs of numbers `p1 = [x1,y1]` and `p2 = [x2,y2]` are considered equal iff `x1 === x2` and
 * `y1 === y2` rather than checking if the references point to the same object in memory (`p1 === p2`).
 */
class PointQueueSet {

    /**
     * Constructs a new set. It manages points on an a two-dimensional integer grid with the given boundaries.
     *
     * @param {{left: number, right: number, top: number, bottom: number}} boundaries boundaries of the grid
     */
    constructor (boundaries) {
        const left = Math.trunc(boundaries.left);
        const right = Math.trunc(boundaries.right);
        this._width = right - left;
        this._offsetX = left;
        this._offsetY = Math.trunc(boundaries.bottom);
        this._workingSet = new Set();
    }

    _serialize ([x, y]) {
        // JavaScript Sets use reference equality for objects, and value equality for primitive types. We want to manage
        // pairs of whole numbers in terms of value equality, so we have to define a canonical enumeration for pairs of
        // numbers, and identify a pair by its unique number in the enumeration.
        return ((x - this._offsetX) * this._width) + (y - this._offsetY);
    }

    _deserialize (n) {
        const x = Math.trunc(n / this._width) + this._offsetX;
        const y = (n % this._width) + this._offsetY;
        return [x, y];
    }

    /**
     * Adds the given points to the end of the queue, unless a point is already present in the queue.
     *
     * @param {[number, number]} points the points to add
     */
    push (...points) {
        for (const point of points) {
            this._workingSet.add(this._serialize(point));
        }
    }

    /**
     * Tells whether the given point is contained in the set.
     *
     * @param {[number, number]} point the point to check
     * @return {boolean} `true` iff the `point` is contained in the set
     */
    has (point) {
        return this._workingSet.has(this._serialize(point));
    }

    [Symbol.iterator] () {
        const iter = this._workingSet[Symbol.iterator]();
        const outer = this;
        return {
            next: function () {
                const {done, value} = iter.next();

                return done ? {
                    done
                } : {
                    done,
                    value: outer._deserialize(value)
                };
            }
        };
    }
}

let sensing = undefined;

const branchDistanceValue = function (blockFunction, argValues, opCached, primitiveReportedValue, runtime, threadTarget, blockUtility) {
    if (sensing === undefined || sensing.runtime !== runtime) {
        sensing = new Sensing(runtime);
    }

    // Special treatment for text2speech block since we may still have to wait for the response containing the
    // translated text and duration.
    if (opCached.opcode === 'text2speech_speakAndWait') {
        const remainingDuration = blockUtility.getScaledRemainingHaltingTime();
        if (remainingDuration === 0) {
            return [0, 1];
        } else if (remainingDuration === null){
            return [1, 0];
        } else{
            return [blockUtility.getScaledRemainingHaltingTime(), 0];
        }
    }

    // Add branchDistances for time-dependent execution halting blocks.
    if (timeDependentOpCodes.includes(opCached.opcode)){
        const remainingDuration = blockUtility.getScaledRemainingHaltingTime();
        if(remainingDuration === 0){
            return [0, 1];
        }
        else{
            return [blockUtility.getScaledRemainingHaltingTime(), 0];
        }
    }

    if (opCached.opcode === 'control_forever') {
        return [0, 1];
    }

    if (opCached.opcode === 'control_repeat') {
        // Get total number of iterations as fallback
        let times = Math.round(cast.toNumber(argValues.TIMES));
        if (blockUtility.thread.stackFrames.length > 0 &&
            blockUtility.thread.stackFrames[0].executionContext &&
            blockUtility.thread.stackFrames[0].executionContext.loopCounter) {
            // Determine how many iterations are left
            times = blockUtility.thread.stackFrames[0].executionContext.loopCounter;
        }
        if (times > 0) {
            return [0, times];
        } else {
            return [1, 0];
        }
    }

    if (opCached.opcode === 'sensing_keypressed') {
        if (primitiveReportedValue === true) {
            return [0, 1];
        } else {
            return [1, 0];
        }
    }

    if (opCached.opcode === 'sensing_mousedown') {
        if (primitiveReportedValue === true) {
            return [0, 1];
        } else {
            return [1, 0];
        }
    }

    /**
     * Tells whether the two given colors (in [R,G,B] color array format) match.
     *
     * @param {number[]} a the first color
     * @param {number[]} b the second color
     * @return {boolean} true iff the colors match
     */
    const colorMatches = (a, b) => (
        (a[0] & 0b11111000) === (b[0] & 0b11111000) &&
        (a[1] & 0b11111000) === (b[1] & 0b11111000) &&
        (a[2] & 0b11110000) === (b[2] & 0b11110000)
    );

    /**
     * Starting at a given point with coordinates x and y, generates a set of points on the Cartesian grid delimited by
     * the given boundaries left, right, top, and bottom. Every point is equidistant (evenly-spaced) to its neighbor.
     * The generator first returns the starting point, followed by its neighbors, the neighbors' neighbors, and so on.
     * Every point on the grid is returned only once, and no out-of-bounds points are returned.
     *
     * @param {[number, number]} start the coordinates of the start point
     * @param {{left: number, right: number, top: number, bottom: number}} bounds the boundaries of the grid
     * @param {number} space the distance between two neighbors
     */
    const points = function *(start, bounds, space) {
        const {left, right, top, bottom} = bounds;

        /**
         * Tells whether the given x-coordinate is within the bounds.
         *
         * @param {number} x the coordinate
         * @return {boolean} true iff within bounds
         */
        const isWithinHorizontalBounds = function (x) {
            return left <= x && x <= right;
        };

        /**
         * Tells whether the given y-coordinate is within the bounds.
         *
         * @param {number} y the coordinate
         * @return {boolean} true iff within bounds
         */
        const isWithinVerticalBounds = function (y) {
            return bottom <= y && y <= top;
        };

        // Set of already visited points on the grid.
        const visited = new PointQueueSet(bounds);

        /**
         * Returns all yet unvisited neighbors of the point with the given coordinates. The returned points are
         * within the boundaries of the grid, and will also be marked as visited.
         *
         * @param {number} x the x-coordinate of the point
         * @param {number} y the y-coordinate of the point
         * @return {[number, number][]} unvisited neighbors of the point
         */
        const unvisitedNeighbors = function ([x, y]) {
            const neighborsX = [x - space, x, x + space].filter(_x => isWithinHorizontalBounds(_x));
            const neighborsY = [y - space, y, y + space].filter(_y => isWithinVerticalBounds(_y));
            const neighbors = [];

            for (const _x of neighborsX) {
                for (const _y of neighborsY) {
                    const neighbor = [_x, _y];
                    if (!visited.has(neighbor)) {
                        visited.push(neighbor);
                        neighbors.push(neighbor);
                    }
                }
            }

            return neighbors;
        };

        // The queue of points yet to be visited.
        const pending = new PointQueueSet(bounds);

        // Initialize the queue with the start point. For the workings of the algorithm it is important to consider
        // whole numbers only.
        const startPoint = start.map(Math.trunc);
        pending.push(startPoint);
        visited.push(startPoint);

        // As long as there are still unvisited points, yield these points, mark them as visited and mark their
        // unvisited neighbors as pending.
        for (const next of pending) {
            pending.push(...unvisitedNeighbors(next));
            yield next;
        }
    };

    /**
     * In the given list of touchable objects, tries to find the specified color within the grid defined by the
     * boundaries, starting at the given point. If the search was successful, the returned object contains the
     * coordinates where the color was located, and the distance to the color from the start point. If
     * the color was not found, the distance is assumed to be diameter of the grid.
     *
     * @param {{number, Drawable}[]} touchables array of touchable objects to search in
     * @param {string} color the color to search for in "#RRGGBB" hex format
     * @param {[number, number]} start the center of the search circle
     * @param {{left: number, right: number, top: number, bottom: number}} bounds the boundaries of the grid
     * @return {{distance: [number, number], colorFound: boolean, coordinates: [number, number]}} the search result
     */
    const fuzzyFindColor = function (touchables, color, start = [threadTarget.x, threadTarget.y], bounds) {
        const targetColor = cast.toRgbColorList(color);
        const gridDiameter = Math.hypot(bounds.top - bounds.bottom, bounds.right - bounds.left);

        // Compute the size of the search area.
        const {right, left, top, bottom} = bounds;
        const width = Math.ceil(right - left);
        const height = Math.ceil(top - bottom);
        const area = width * height;

        // Choose a sampling resolution based on the size of the search area. We allocate a fixed budget of maxSamples.
        // For bigger areas, the resolution will be lower (the points are spaced out more), whereas it will be higher
        // for small ares (the points are closer together).
        const maxSamples = 48 * 36; // Arbitrary, but based on the stage dimensions of 480 × 360
        const dynamicSpace = Math.trunc(Math.sqrt(area / maxSamples));
        const actualSpace = Math.max(1, dynamicSpace);

        for (const [x, y] of points(start, bounds, actualSpace)) {
            const point = twgl.v3.create(x, y);
            const currentColor = threadTarget.renderer.constructor.sampleColor3b(point, touchables);
            if (colorMatches(targetColor, currentColor)) {
                const distanceToColor = Math.hypot(start[0] - x, start[1] - y);
                const normalized = distanceToColor / gridDiameter;
                return {
                    distance: [normalized, 0],
                    colorFound: true,
                    coordinates: [x, y]
                };
            }
        }

        return {
            distance: [1, 0],
            colorFound: false,
            coordinates: []
        };
    };

    /**
     * Returns the branch distances for "touchingColor" blocks when the current sprite does not touch the color.
     *
     * @param {string} color the color to touch in "#RRGGBB" hex format
     * @param {[number, number]} center a point located within the current sprite to compute the distance from (by
     * default, the center of the sprite)
     * @return {[number, number]} the branch distance
     */
    const handleTouchingColorFalse = function (color, center = [threadTarget.x, threadTarget.y]) {
        const renderer = threadTarget.renderer;

        // Constructs a list of touchable objects excluding the current sprite itself.
        const touchables = [];
        for (let index = renderer._visibleDrawList.length - 1; index >= 0; index--) {
            const id = renderer._visibleDrawList[index];
            if (id !== threadTarget.drawableID) {
                const drawable = renderer._allDrawables[id];
                touchables.push({id, drawable});
            }
        }

        const stageBounds = {
            right: renderer._xRight,
            left: renderer._xLeft,
            top: renderer._yTop,
            bottom: renderer._yBottom
        };

        const {distance} = fuzzyFindColor(touchables, color, center, stageBounds);
        return distance;
    };

    if (opCached.opcode === 'sensing_touchingcolor') {
        const touchingColor = sensing.getPrimitives().sensing_touchingcolor.bind(sensing);

        if (touchingColor(argValues, blockUtility)) {
            return [0, 1];
        }

        return handleTouchingColorFalse(argValues.COLOR);
    }

    if (opCached.opcode === 'sensing_coloristouchingcolor') { // https://en.scratch-wiki.info/wiki/Color_()_is_Touching_()%3F_(block)
        const colorTouchingColor = sensing.getPrimitives().sensing_coloristouchingcolor.bind(sensing);

        // The first color of the 'colorTouchingColor' block. This color must be present in the current costume of the
        // sprite.
        const color1 = argValues.COLOR;

        // The second color of the 'colorTouchingColor' block. This color is the one we want to touch.
        const color2 = argValues.COLOR2;

        // Check if the current sprite already contains color1 and touches color2.
        if (colorTouchingColor(argValues, blockUtility)) {
            return [0, 1];
        }

        // The sprite does not touch color2 yet. We have to check if the current costume of the sprite contains color1.
        // To this, we retrieve the geometry of the current costume, and use this as search area for color1.
        const spriteBounds = threadTarget.getBounds();

        // The current sprite represented as Drawable object.
        const id = threadTarget.drawableID;
        const drawable = threadTarget.renderer._allDrawables[id];
        const thisSprite = [{id, drawable}];

        // Search for color1 within the current costume of the sprite.
        drawable.updateCPURenderAttributes(); // Necessary, otherwise color sampling does not work.
        const result = fuzzyFindColor(thisSprite, color1, [threadTarget.x, threadTarget.y], spriteBounds);

        // If color1 is not present in the costume, the 'colorTouchingColor' block always reports false.
        if (!result.colorFound) {
            return [1, 0];
        }

        // If color1 is present, the semantics of the 'colorTouchingColor' block are almost the same as 'touchingColor'
        // with target color2. But instead of considering the entire costume (which can also have other colors but
        // color1), we use the coordinates where color1 was actually found for branch distance computation.
        return handleTouchingColorFalse(color2, result.coordinates);
    }

    if (opCached.opcode === 'sensing_touchingobject') {
        dist_args = {};
        dist_args.DISTANCETOMENU = argValues.TOUCHINGOBJECTMENU;

        const touching = sensing.getPrimitives()['sensing_touchingobject'];
        const touchingBound = touching.bind(sensing);
        if (touchingBound(argValues, blockUtility)) {
            return [0, 1];
        }

        if (argValues.TOUCHINGOBJECTMENU === '_edge_') {
            const minEdgeDist = Math.min(240 + threadTarget.x, 180 + threadTarget.y, 240 - threadTarget.x, 180 - threadTarget.y);
            if (minEdgeDist === 0) {
                return [0, 1];
            } else {
                return [minEdgeDist, 0];
            }
        }

        const distanceTo = sensing.getPrimitives()['sensing_distanceto'];
        const bound = distanceTo.bind(sensing);
        const distance = bound(dist_args, blockUtility);
        if (distance > 0) {
            return [distance, 0];
        } else {
            return [0, 1];
        }
    }

    if (!operatorBlockOpcode.includes(opCached.opcode) && opCached._distances) {
        // unsupported operation
        // by default just reuse the previous value
        return opCached._distances[0];
    }

    if (!argValues && ['operator_and', 'operator_or'].includes(opCached.opcode)) {
        // Something has gone wrong, cannot calculate distance
        return null;
    }

    let first;
    let second;
    let td;
    let fd;
    const name = blockFunction.name;
    if ((isNaN(argValues.OPERAND1) || isNaN(argValues.OPERAND2))) {
        first = cast.toString(argValues.OPERAND1);
        second = cast.toString(argValues.OPERAND2);
        td = getTrueDistanceString(name, first, second, opCached._distances);
        fd = getFalseDistanceString(name, first, second, opCached._distances);
    } else {
        first = cast.toNumber(argValues.OPERAND1);
        second = cast.toNumber(argValues.OPERAND2);
        td = getTrueDistanceNum(name, first, second, opCached._distances);
        fd = getFalseDistanceNum(name, first, second, opCached._distances);
    }


    return [td, fd];
};


const getFalseDistanceNum = function (operationName, first, second, distanceValues) {
    if (operationName.includes('gt')) {
        const result = first - second;
        if (result < 0) {
            return 0;
        }
        return result;

    } else if (operationName.includes('lt')) {
        const result = second - first;
        if (result < 0) {
            return 0;
        }
        return result;

    } else if (operationName.includes('equals')) {
        const result = Math.abs(first - second);
        if (result === 0) {
            return 1;
        }
        return 0;

    } else if (operationName.includes('and')) {
        // Not and a b == not a or not b
        // So we flip each and apply or
        return Math.min(getCachedFalseDistance(distanceValues[0]), getCachedFalseDistance(distanceValues[1]));

        // return distanceValues[0][1] + distanceValues[1][1];
    } else if (operationName.includes('or')) {
        // Not or a b == not a and not b
        // return Math.min(distanceValues[0][1], distanceValues[0][1]);

        return getCachedFalseDistance(distanceValues[0]) + getCachedFalseDistance(distanceValues[1]);
    } else if (operationName.includes('not')) {
        return getCachedTrueDistance(distanceValues[0]);
    }
    // by default just reuse the previous value
    return distanceValues[0];

};

const getTrueDistanceNum = function (operationName, first, second, distanceValues) {
    if (operationName.includes('gt')) {
        const result = second - first;
        if (result < 0) {
            return 0;
        }
        return result + 1;

    } else if (operationName.includes('lt')) {
        const result = first - second;
        if (result < 0) {
            return 0;
        }
        return result + 1;

    } else if (operationName.includes('equals')) {
        return Math.abs(first - second);
    } else if (operationName.includes('and')) {
        return getCachedTrueDistance(distanceValues[0]) + getCachedTrueDistance(distanceValues[1]);
    } else if (operationName.includes('or')) {
        return Math.min(getCachedTrueDistance(distanceValues[0]), getCachedTrueDistance(distanceValues[1]));
    } else if (operationName.includes('not')) {
        return getCachedFalseDistance(distanceValues[0]);
    }
    // by default just reuse the previous value
    return distanceValues[0];

};

const getFalseDistanceString = function (operationName, first, second, distanceValues) {
    if (operationName.includes('gt')) {
        if (first < second) {
            return 0;
        }
        return 1;

    } else if (operationName.includes('lt')) {
        if (first < second) {
            return 1;
        }
        return 0;

    } else if (operationName.includes('equals')) {
        if (first === second) {
            return 1;
        }
        return 0;

    } else if (operationName.includes('and')) {
        // Not and a b == not a or not b
        // So we flip each and apply or
        return Math.min(getCachedFalseDistance(distanceValues[0]), getCachedFalseDistance(distanceValues[1]));

        // return distanceValues[0][1] + distanceValues[1][1];
    } else if (operationName.includes('or')) {
        // Not or a b == not a and not b
        // return Math.min(distanceValues[0][1], distanceValues[0][1]);

        return getCachedFalseDistance(distanceValues[0]) + getCachedFalseDistance(distanceValues[1]);
    } else if (operationName.includes('not')) {
        return getCachedTrueDistance(distanceValues[0]);
    }
    // by default just reuse the previous value
    return distanceValues[0];

};


const getTrueDistanceString = function (operationName, first, second, distanceValues) {
    if (operationName.includes('gt')) {
        if (second < first) {
            return 0;
        }
        return 1;

    } else if (operationName.includes('lt')) {
        if (first < second) {
            return 0;
        }
        return 1;

    } else if (operationName.includes('equals')) {
        if (first === second) {
            return 0;
        }
        return 1;
    } else if (operationName.includes('and')) {
        return getCachedTrueDistance(distanceValues[0]) + getCachedTrueDistance(distanceValues[1]);
    } else if (operationName.includes('or')) {
        return Math.min(getCachedTrueDistance(distanceValues[0]), getCachedTrueDistance(distanceValues[1]));
    } else if (operationName.includes('not')) {
        return getCachedFalseDistance(distanceValues[0]);
    }
    // by default just reuse the previous value
    return distanceValues[0];

};

module.exports = execute;
