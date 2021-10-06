/**
 * This class allows to trace a Scratch program by recording blocks during execution.
 */
export class Tracer {
    traces: {};
    coverage: Set<any>;
    targets: any[];
    lastTraced: Trace;
    /**
     * Configure the rules which decide whether a given block should be stored or not.
     * These rules can be built on all recorded block records.
     *
     * @param {BlockCached} block - The block record which this function decides on.
     * @returns {boolean} - <code>true</code> when the block should be stored, <code>false</code> otherwise.
     */
    _filterBlock(block: any): boolean;
    /**
     * Adds a given block to the trace record iff it is not filtered
     * out by Tracer#_filterBlock.
     *
     * @param {BlockCached} block  - the block that is added as a trace.
     */
    traceExecutedBlock(block: any): void;
    /**
     * Resets the tracer instance by clearing the list of traces and
     * overwriting the targets.
     *
     * @param {Array<Target>} targets - the current targets of the runtime.
     */
    reset(targets: Array<any>): void;
    /**
     * Returns whether the recorded trace is empty.
     *
     * @return {boolean} - true when the recorded trace is empty, false otherwise.
     */
    isEmpty(): boolean;
}
/**
 * This class represents a trace record.
 *
 * Trace records are basically Scratch blocks, but only
 * with information useful for reconstructing execution.
 */
export class Trace {
    /**
     * Given a block from the Scratch VM, constructs a trace record
     * with all required information.
     *
     * @param {BlockCached} block - a Scratch block object.
     * @param {Array<Target>} targets - the current state of targets.
     */
    constructor(block: any, targets: Array<any>);
    id: any;
    opcode: any;
    ops: any;
    inputs: any;
    argValues: any;
    fields: any;
    distances: any[];
    ti(targetId: any): any;
    updateTargets(targets: any): void;
    targetsInfo: {};
}
