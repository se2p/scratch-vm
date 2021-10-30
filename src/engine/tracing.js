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
        this.id = block.id;
        this.opcode = block.opcode;
        this.ops = block._ops.filter(op => op.id !== block.id)
            .map(op => new Trace(op, targets));
        this.inputs = block.inputs;
        this.argValues = Object.assign({}, block._argValues);
        delete this.argValues.mutation;
        this.fields = block.fields;
        this.distances = [...block._distances];
        this.remainingScaledHaltingDuration = block.utility.getScaledRemainingHaltingTime();

        this.updateTargets(targets);
    }

    ti (targetId) {
        return this.targetsInfo[targetId];
    }

    updateTargets (targets) {
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
                    let value;
                    if (variable.type === 'list') {
                        value = Array.from(variable.value);
                    } else {
                        value = variable.value;
                    }
                    info.variables[id] = {
                        id: id,
                        type: variable.type,
                        name: variable.name,
                        value: value
                    };
                }
                this.targetsInfo[target.id] = info;
            }
        }
    }
}

/**
 * This class allows to trace a Scratch program by recording blocks during execution.
 */
class Tracer {
    constructor () {
        // this.traces = [];
        this.traces = {};
        this.coverage = new Set();
        this.targets = [];
        this.lastTraced = null;
        this.timeDependentBlocks = ['control_wait', 'looks_thinkforsecs', 'looks_sayforsecs', 'motion_glidesecstoxy',
            'sound_playuntildone', 'text2speech_speakAndWait'];
    }

    /**
     * Configure the rules which decide whether a given block should be stored or not.
     * These rules can be built on all recorded block records.
     *
     * @param {BlockCached} block - The block record which this function decides on.
     * @returns {boolean} - <code>true</code> when the block should be stored, <code>false</code> otherwise.
     */
    _filterBlock (block) {

        if ((!this.timeDependentBlocks.includes(block.opcode)) &&
            (!block._distances || block._distances.length === 0 || !block._distances[0])) {
            return false;
        }

        if (this.lastTraced) {
            switch (block.opcode) {
            case 'data_variable': // These occur due to displaying a variable's value
            case 'data_listcontents': // These occur due to displaying list monitor
                return false;
            case 'motion_glideto':
            case 'motion_glidesecstoxy':
                if (this.lastTraced.id === block.id) {
                    this.lastTraced.updateTargets(this.targets);
                    return false;
                }
                break;
            case 'control_wait':
                if (this.lastTraced.id === block.id) {
                    return false;
                }
                break;
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
        this.coverage.add(block.id);
        if (!this._filterBlock(block)) {
            return;
        }
        const newTrace = new Trace(block, this.targets);

        if (block.id in this.traces && newTrace.distances[0]) {
            const oldTrace = this.traces[block.id];
            const oldTrue = oldTrace.distances[0][0];
            const oldFalse = oldTrace.distances[0][1];

            if (newTrace.distances[0][0] < oldTrue) {
                oldTrace.distances[0][0] = newTrace.distances[0][0];
            }

            if (newTrace.distances[0][1] < oldFalse) {
                oldTrace.distances[0][1] = newTrace.distances[0][1];
            }
        } else {
            this.traces[block.id] = newTrace;
        }

        // this.traces.push(newTrace);
        this.lastTraced = newTrace;
    }

    /**
     * Resets the tracer instance by clearing the list of traces and
     * overwriting the targets.
     *
     * @param {Array<Target>} targets - the current targets of the runtime.
     */
    reset (targets) {
        this.targets = targets;
        this.traces = {};
        this.coverage = new Set();
    //    for (const prop of Object.getOwnPropertyNames(this.traces)) {
    //        delete this.traces[prop];
    //    }
    }

    /**
     * Returns whether the recorded trace is empty.
     *
     * @return {boolean} - true when the recorded trace is empty, false otherwise.
     */
    isEmpty () {
        return this.traces.length === 0;
    }
}

module.exports = {
    Tracer,
    Trace
};
