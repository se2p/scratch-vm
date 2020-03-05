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
     * @param {Array<Target>} targets - the current state of targets.
     */
    constructor (cachedBlock, targets) {
        this.blockId = cachedBlock.id;
        this.opcode = cachedBlock.opcode;
        this.ops = cachedBlock._ops;
        this.inputs = cachedBlock.inputs;
        this.fields = cachedBlock.fields;
        this.isHat = cachedBlock._isHat;
        this.isShadowBlock = cachedBlock._isShadowBlock;
        this.shadowOps = cachedBlock._shadowOps;
        this.argValues = cachedBlock._argValues;

        this.targetsInfo = {};

        if (targets) {
            for (const target of targets) {
                this.targetsInfo[target.id] = {
                    id: target.id,
                    x: target.x,
                    y: target.y,
                    currentCostume: target.currentCostume,
                    variables: {}
                };
                for (const id in target.variables) {
                    const variable = target.variables[id];
                    this.targetsInfo[target.id].variables[id] = {
                        id: id,
                        type: variable.type,
                        name: variable.name,
                        value: variable.value
                    };
                }
            }
        }
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
        if (this.traces) {
            if (trace.opcode === 'data_variable') {
                return false;
            }
            if (trace.opcode.startsWith('motion') || trace.opcode === 'control_wait') {
                return this.traces[this.traces.length - 1].blockId !== trace.blockId;
            }
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
    /**
     * Resets the tracer instance by clearing the traces collection.
     */
    reset () {
        this.traces = [];
    }
}

module.exports.tracer = new Tracer();
module.exports.Trace = Trace;
