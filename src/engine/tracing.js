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
     * @param {string} blockKey - the key for the given block following the scheme: id-spriteName
     * @param {Array<Target>} targets - the current state of targets.
     */
    constructor (block, blockKey, targets) {
        this.id = blockKey;
        this.opcode = block.opcode;
        this.ops = block._ops.filter(op => op.id !== block.id)
            .map(op => new Trace(op, targets));
        this.inputs = block.inputs;
        this.argValues = Object.assign({}, block._argValues);
        delete this.argValues.mutation;
        this.fields = block.fields;
        this.distances = [...block._distances];

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
        this.lastStepCoverage = new Set();
        this.targets = [];
        this.lastTraced = null;
    }

    /**
     * Configure the rules which decide whether a given block should be stored or not.
     * These rules can be built on all recorded block records.
     *
     * @param {BlockCached} block - The block record which this function decides on.
     * @returns {boolean} - <code>true</code> when the block should be stored, <code>false</code> otherwise.
     */
    _filterBlock (block) {

        if (!block._distances || block._distances.length === 0 || !block._distances[0]) {
            return false;
        }

        if (this.lastTraced) {
            switch (block.opcode) {
            case 'data_variable': // These occur due to displaying a variable's value
            case 'data_listcontents': // These occur due to displaying list monitor
                return false;
            }
        }
        return true;
    }

    getTargetsOfBlock (block){
        const blockTargets = [];
        for (const target of this.targets) {
            if (block.id in target.blocks._blocks) {
                blockTargets.push(target.sprite.name);
            }
        }
        return blockTargets;
    }

    generateBlockKey (block) {
        let blockTarget = block.utility.target.sprite.name;
        const foundBlockTargets = this.getTargetsOfBlock(block);
        if (!foundBlockTargets.includes(blockTarget) && foundBlockTargets.includes('Stage')) {
            blockTarget = 'Stage';
        } else if (!foundBlockTargets.includes(blockTarget) && block.opcode === 'control_create_clone_of') {
            // Make sure the clone block's key is set to the source target in which the block is located and NOT
            // to the target which is cloned by the block
            blockTarget = foundBlockTargets;
        }

        return `${block.id}-${blockTarget}`;
    }

    /**
     * Adds a given block to the trace record iff it is not filtered
     * out by Tracer#_filterBlock.
     *
     * @param {BlockCached} block  - the block that is added as a trace.
     */
    traceExecutedBlock (block) {
        const blockKey = this.generateBlockKey(block);
        this.coverage.add(blockKey);
        this.lastStepCoverage.add(blockKey);
        if (!this._filterBlock(block)) {
            return;
        }
        const newTrace = new Trace(block, blockKey, this.targets);

        if (blockKey in this.traces && newTrace.distances[0]) {
            const oldTrace = this.traces[blockKey];
            const oldTrue = oldTrace.distances[0][0];
            const oldFalse = oldTrace.distances[0][1];

            if (newTrace.distances[0][0] < oldTrue) {
                oldTrace.distances[0][0] = newTrace.distances[0][0];
            }

            if (newTrace.distances[0][1] < oldFalse) {
                oldTrace.distances[0][1] = newTrace.distances[0][1];
            }
        } else {
            this.traces[blockKey] = newTrace;
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
        this.coverage.clear();
        this.lastStepCoverage.clear();
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
