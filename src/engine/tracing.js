/**
 * This class represents a trace record.
 *
 * Trace records are basically Scratch blocks, but only
 * with information useful for reconstructing execution.
 */
class Trace {
    /**
     * Given a block from the Scratch VM, constructs a trace record
     * with all required information.
     *
     * @param {BlockCached} cachedBlock - a Scratch block object.
     */
    constructor (cachedBlock) {
        this.blockId = cachedBlock.id;
        this.opcode = cachedBlock.opcode;
        this.ops = cachedBlock._ops;
        this.inputs = cachedBlock.inputs;
        this.fields = cachedBlock.fields;
        this.isHat = cachedBlock._isHat;
        this.isShadowBlock = cachedBlock._isShadowBlock;
        this.shadowOps = cachedBlock._shadowOps;
        this.argValues = cachedBlock._argValues;
    }
}

/**
 * This class allows to trace a Scratch program by recording trace records during execution.
 */
class Tracer {
    constructor () {
        this.traces = [];
    }

    /**
     * Configure the rules which decide whether a given trace should be stored or not.
     * These rules can be built on all recorded trace records.
     *
     * @param {Trace} trace - The trace record which this function decides on.
     * @returns {boolean} - <code>true</code> when the trace should be stored, <code>false</code> otherwise.
     */
    filterTrace (trace) {
        if (this.traces && trace.opcode.startsWith('motion')) {
            return this.traces[this.traces.length - 1].blockId !== trace.blockId;
        }
        return true;
    }

    /**
     * Adds a given trace record to the complete trace iff it is not filtered out by
     * Tracer#filterTrace
     *
     * @param {Trace} trace - the trace that should be added.
     */
    addTraceRecord (trace) {
        if (!this.filterTrace(trace)) {
            return;
        }
        for (const op of trace.ops) {
            if (op.id && op.id !== trace.blockId) {
                this.traces.push(new Trace(op));
            }
        }

        this.traces.push(trace);
    }

    hasMotionBlocks () {
        return this.traces.some(value => value.opcode.startsWith('motion'));
    }

    hasLooksBlocks () {
        return this.traces.some(value => value.opcode.startsWith('looks'));
    }

    hasSoundBlocks () {
        return this.traces.some(value => value.opcode.startsWith('sound'));
    }

    hasEventBlocks () {
        return this.traces.some(value => value.opcode.startsWith('event'));
    }

    hasControlBlocks () {
        return this.traces.some(value => value.opcode.startsWith('control'));
    }

    hasSensingBlocks () {
        return this.traces.some(value => value.opcode.startsWith('sensing'));
    }

    hasOperatorBlocks () {
        return this.traces.some(value => value.opcode.startsWith('operator'));
    }

    hasDataBlocks () {
        return this.traces.some(value => value.opcode.startsWith('data'));
    }

    hasBlock (opcode) {
        return this.traces.some(value => value.opcode === opcode);
    }

    /**
     * Debug print to a given output stream. Most likely console.
     */
    // TODO Phil 29/01/2020: currently, this is just debug output
    debugPrintTrace (stream) {
        stream.log(this.traces);

        stream.log(`hasMotionBlocks(): ${this.hasMotionBlocks()}`);
        stream.log(`hasLooksBlocks(): ${this.hasLooksBlocks()}`);
        stream.log(`hasSoundBlocks(): ${this.hasSoundBlocks()}`);
        stream.log(`hasEventBlocks(): ${this.hasEventBlocks()}`);
        stream.log(`hasSensingBlocks(): ${this.hasSensingBlocks()}`);
        stream.log(`hasControlBlocks(): ${this.hasControlBlocks()}`);
        stream.log(`hasOperatorBlocks(): ${this.hasOperatorBlocks()}`);
        stream.log(`hasDataBlocks(): ${this.hasDataBlocks()}`);
        stream.log(`hasBlock('control_forever'): ${this.hasBlock('control_forever')}`);
    }

    /**
     * Resets the tracer instance by clearing the traces collection.
     */
    reset () {
        this.traces = [];
    }
}

module.exports.tracer = new Tracer();
module.exports.Trace = Trace;
