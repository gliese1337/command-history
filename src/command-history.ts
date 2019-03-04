export enum CoalescenceResult {
    IMMISCIBLE,
    COALESCED,
    UNDONE
}

export enum CommandResult {
    ADD,
    NOOP,
    CLEAR,
}

export interface ICommand {
    execute(): Promise<CommandResult>;
    redo(): Promise<void>;
    undo(): Promise<void>;
    coalesce?: (ncom: ICommand) => CoalescenceResult;
    isNoop(): boolean;
    description: string;
}

export class CommandHistory {
    private undoCommands: ICommand[] = [];
    private redoCommands: ICommand[] = [];
    private can_coalesce = true;
    private timeoutId: number | null = null;
    private cleanup: () => void;
    private coalescenceWindow: number;
    private verbose: boolean;
    private _busy: boolean = false;

    constructor({
        cleanup = () => {},
        coalescenceWindow = 3000,
        verbose = true,
     }: {
         cleanup?: () => void,
         coalescenceWindow?: number,
         verbose?: boolean,
    } = {}) {
        this.cleanup = cleanup;
        this.coalescenceWindow = coalescenceWindow;
        this.verbose = verbose;
    }

    get busy() {
        return this._busy;
    }

    get undoCount() {
        return this.undoCommands.filter(c => !c.isNoop()).length;
    }

    get redoCount(){
        return this.redoCommands.length;
    }

    public coalescenceBarrier() {
        this.can_coalesce = false;
    }

    get undoDescription() {
        const undos = this.undoCommands; 
        for (let i = undos.length - 1; i >= 0; i--) {
            const cmd = undos[i];
            if (!cmd.isNoop()) return cmd.description;
        }
    
        return "None";
    }

    get redoDescription() {
        const redos = this.redoCommands;
    
        return redos.length ? redos[redos.length - 1].description : "None";
    }

    public async undo(levels: number = 1) {
        if(this._busy) throw new Error("Cannot undo during another operation.");
        this._busy = true;
        while(levels > 0 && this.undoCommands.length){
            const command = this.undoCommands.pop() as ICommand;
            if (command.isNoop()) continue;
            await command.undo();
            this.verbose && console.info(`Undid ${command.description}.`);
            this.redoCommands.push(command);
            levels--;
        }

        this.can_coalesce = false;
        this.cleanup();
        this._busy = false;
    }

    public async redo(levels: number = 1) {
        if(this._busy) throw new Error("Cannot redo during another operation.");
        this._busy = true;
        while(levels > 0 && this.redoCommands.length){
            const command = this.redoCommands.pop() as ICommand;
            await command.redo();
            this.verbose && console.info(`Redid ${command.description}.`);
            this.undoCommands.push(command);
            levels--;
        }

        this.can_coalesce = false;
        this.cleanup();
        this._busy = false;
    }

    public pop() {
        if(this._busy) throw new Error("Cannot alter command history state during an operation.");
        this.undoCommands.pop();
    }

    public clear(){
        if(this._busy) throw new Error("Cannot alter command history state during an operation.");
        this.undoCommands.length = 0;
        this.redoCommands.length = 0;
    }

    public async execute<C extends ICommand, A extends any[]>(ctor: new (...args: A) => C, ...args: A) {
        if(this._busy) throw new Error("Cannot execute command during another operation.");
        this._busy = true;

        const ncmd = new ctor(...args);

        if (this.can_coalesce) {
            const lcmd = this.undoCommands.pop();
            if (lcmd) {
                if(lcmd.coalesce) {
                    switch (lcmd.coalesce(ncmd)) {
                        case CoalescenceResult.IMMISCIBLE:
                            this.undoCommands.push(lcmd);
                            break;
                        case CoalescenceResult.COALESCED:
                            this.undoCommands.push(lcmd);
                            this.verbose && console.info(`Coalesced ${ncmd.description}.`);
                            return;
                        case CoalescenceResult.UNDONE:
                            this.verbose && console.info(`Dropped ${ncmd.description} due to manual undo.`);
                            return;
                    }
                } else {
                    this.undoCommands.push(lcmd);
                }
            }
        }

        switch (await ncmd.execute()) {
            case CommandResult.ADD:
                this.verbose && console.info(`Added ${ncmd.description} to undo stack.`);
                this.undoCommands.push(ncmd);
                this.redoCommands.length = 0;
                this.can_coalesce = true;
                break;
            case CommandResult.CLEAR:
                this.verbose && console.info(`Executed ${ncmd.description} and cleared stack.`);
                this.undoCommands.length = 0;
                this.redoCommands.length = 0;
                this.can_coalesce = false;
                break;
            case CommandResult.NOOP:
                this.verbose && console.info(`${ncmd.description} was a no-op.`);
                break;
        }

        this._busy = false;

        // Assume that actions separated by less than the specified coalescence
        // window should be considered part of the same logical undoable action.
        if (this.timeoutId !== null) clearTimeout(this.timeoutId);
        if (this.coalescenceWindow > 0) {
            this.timeoutId = setTimeout(() => {
                this.can_coalesce = false;
                this.timeoutId = null;
            }, this.coalescenceWindow);
        } else {
            this.can_coalesce = false;
        }
    }
}