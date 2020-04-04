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
     * @param {BlockCached} block - a Scratch block object.
     * @param {Array<Target>} targets - the current state of targets.
     */
    constructor (block, targets) {
        this.blockId = block.id;
        this.opcode = block.opcode;
        this.ops = block._ops.filter(op => op.id !== block.id).map(op => new Trace(op, targets));
        this.inputs = block.inputs;
        this.argValues = Object.assign({}, block._argValues);
        delete this.argValues.mutation;
        this.fields = block.fields;

        this.targetsInfo = {};

        if (targets) {
            for (const target of targets) {
                const info = {
                    id: target.id,
                    currentCostume: target.currentCostume,
                    variables: {}
                };
                if (!target.isStage) {
                    info.x = target.x;
                    info.y = target.y;
                    info.direction = target.direction;
                    info.size = target.size;
                    info.visible = target.visible;
                }
                for (const id in target.variables) {
                    const variable = target.variables[id];
                    info.variables[id] = {
                        id: id,
                        type: variable.type,
                        name: variable.name,
                        value: variable.value
                    };
                }
                this.targetsInfo[target.id] = info;
            }
        }

        this.ti = targetId => this.targetsInfo[targetId];
    }
}

/**
 * This class allows to trace a Scratch program by recording blocks during execution.
 */
class Tracer {
    constructor () {
        this.traces = [];
        this.targets = [];
    }

    /**
     * Configure the rules which decide whether a given block should be stored or not.
     * These rules can be built on all recorded block records.
     *
     * @param {BlockCached} block - The block record which this function decides on.
     * @returns {boolean} - <code>true</code> when the block should be stored, <code>false</code> otherwise.
     */
    _filterBlock (block) {
        if (this.traces) {
            if (block.opcode === 'data_variable') {
                return false;
            }
            if (block.opcode.startsWith('motion') || block.opcode === 'control_wait') {
                return this.traces[this.traces.length - 1].blockId !== block.blockId;
            }
        }
        return true;
    }

    /**
     * Adds a given block to the trace record iff it is not filtered
     * out by Tracer#_filterBlock.
     *
     * @param {BlockCached} block  - the block that is added as a trace.
     */
    traceExecutedBlock (block) {
        if (!this._filterBlock(block)) {
            return;
        }
        this.traces.push(new Trace(block, this.targets));
    }

    /**
     * Resets the tracer instance by clearing the list of traces and
     * overwriting the targets.
     *
     * @param {Array<Target>} targets - the current targets of the runtime.
     */
    reset (targets) {
        this.targets = targets;
        this.traces = [];
    }
}

module.exports = {
    Tracer,
    Trace
};
