export = BlockUtility;
/**
 * @fileoverview
 * Interface provided to block primitive functions for interacting with the
 * runtime, thread, target, and convenient methods.
 */
declare class BlockUtility {
    constructor(sequencer?: any, thread?: any);
    /**
     * A sequencer block primitives use to branch or start procedures with
     * @type {?Sequencer}
     */
    sequencer: any;
    /**
     * The block primitives thread with the block's target, stackFrame and
     * modifiable status.
     * @type {?Thread}
     */
    thread: Thread | null;
    _nowObj: {
        now: () => any;
    };
    /**
     * The target the primitive is working on.
     * @type {Target}
     */
    get target(): any;
    /**
     * The runtime the block primitive is running in.
     * @type {Runtime}
     */
    get runtime(): any;
    /**
     * Use the runtime's currentMSecs value as a timestamp value for now
     * This is useful in some cases where we need compatibility with Scratch 2
     * @type {function}
     */
    get nowObj(): Function;
    /**
     * The stack frame used by loop and other blocks to track internal state.
     * @type {object}
     */
    get stackFrame(): any;
    /**
     * Check the number of executed steps and return a boolean based on whether the required amount of steps have
     * elapsed or not.
     * @return {boolean} - true if the required number of steps have elapsed.
     */
    stackTimerFinished(): boolean;
    /**
     * Check if the stack timer measured in steps and time needs initialization.
     * @return {boolean} - true if the stack timer measured in steps needs to be initialized.
     */
    stackTimerNeedsInit(): boolean;
    /**
     * Create and start a stack timer measuring time and steps.
     * @param {number} duration - a duration in milliseconds to set the timer for.
     */
    startStackTimer(duration: number): void;
    /**
     * Calculates and scales the remaining steps until a thread yielding state will be over.
     * @returns {null|number} the scaled remaining halting time in the range [0,1].
     */
    getScaledRemainingHaltingTime(): null | number;
    /**
     * Set the thread to yield.
     */
    yield(): void;
    /**
     * Set the thread to yield until the next tick of the runtime.
     */
    yieldTick(): void;
    /**
     * Start a branch in the current block.
     * @param {number} branchNum Which branch to step to (i.e., 1, 2).
     * @param {boolean} isLoop Whether this block is a loop.
     */
    startBranch(branchNum: number, isLoop: boolean): void;
    /**
     * Stop all threads.
     */
    stopAll(): void;
    /**
     * Stop threads other on this target other than the thread holding the
     * executed block.
     */
    stopOtherTargetThreads(): void;
    /**
     * Stop this thread.
     */
    stopThisScript(): void;
    /**
     * Start a specified procedure on this thread.
     * @param {string} procedureCode Procedure code for procedure to start.
     */
    startProcedure(procedureCode: string): void;
    /**
     * Get names and ids of parameters for the given procedure.
     * @param {string} procedureCode Procedure code for procedure to query.
     * @return {Array.<string>} List of param names for a procedure.
     */
    getProcedureParamNamesAndIds(procedureCode: string): Array<string>;
    /**
     * Get names, ids, and defaults of parameters for the given procedure.
     * @param {string} procedureCode Procedure code for procedure to query.
     * @return {Array.<string>} List of param names for a procedure.
     */
    getProcedureParamNamesIdsAndDefaults(procedureCode: string): Array<string>;
    /**
     * Initialize procedure parameters in the thread before pushing parameters.
     */
    initParams(): void;
    /**
     * Store a procedure parameter value by its name.
     * @param {string} paramName The procedure's parameter name.
     * @param {*} paramValue The procedure's parameter value.
     */
    pushParam(paramName: string, paramValue: any): void;
    /**
     * Retrieve the stored parameter value for a given parameter name.
     * @param {string} paramName The procedure's parameter name.
     * @return {*} The parameter's current stored value.
     */
    getParam(paramName: string): any;
    /**
     * Start all relevant hats.
     * @param {!string} requestedHat Opcode of hats to start.
     * @param {object=} optMatchFields Optionally, fields to match on the hat.
     * @param {Target=} optTarget Optionally, a target to restrict to.
     * @return {Array.<Thread>} List of threads started by this function.
     */
    startHats(requestedHat: string, optMatchFields?: object | undefined, optTarget?: any): Array<Thread>;
    /**
     * Query a named IO device.
     * @param {string} device The name of like the device, like keyboard.
     * @param {string} func The name of the device's function to query.
     * @param {Array.<*>} args Arguments to pass to the device's function.
     * @return {*} The expected output for the device's function.
     */
    ioQuery(device: string, func: string, args: Array<any>): any;
}
import Thread = require("./thread");
