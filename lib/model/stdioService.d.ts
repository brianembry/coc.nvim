/// <reference types="node" />
import EventEmitter = require('events');
import { VimCompleteItem } from '../types';
export declare type Callback = (msg: string) => void;
export default class StdioService extends EventEmitter {
    command: string;
    args: string[];
    private child;
    private running;
    constructor(command: string, args?: string[]);
    readonly isRunnning: boolean;
    start(): void;
    request(data: {
        [index: string]: any;
    }): Promise<VimCompleteItem[] | null>;
    stop(): void;
}