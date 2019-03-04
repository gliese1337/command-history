#command-history
This package implements a safe command-object based undo/redo system. It exports the `{ CommandHistory }` constructor, as well as the associated `{ ICommand }` interface and `{ CommandResult, CoalescenceResult }` enums.

Undoable actions are represented by custom object types conforming to the `ICommand` interface:

```
interface ICommand {
    execute(): Promise<CommandResult>;
    redo(): Promise<void>;
    undo(): Promise<void>;
    coalesce?: (ncom: ICommand) => CoalescenceResult;
    isNoop(): boolean;
    description: string;
}
```

* `execute(): Promise<CommandResult>` asynchronously performs the undoable action for the first time, and returns a result to the CommandHistory system indicating whether the action was a `NOOP` (in which case the command object will be discarded), an `ADD` (in which case the command object will be added to the undo stack), or a `CLEAR` (in which case the entire stack is cleared; this is useful for actions which are *not* undoable, and cannot be undone past, such as actions which alter remote server state).
* `redo(): Promise<void>` asynchronously restores the effects of a previously-undone action. In many cases, this will simply be an alias for `execute()`, but caching may allow for some actions to be redone more efficiently than they can be done initially.
* `undo(): Promise<void>` asynchronously undoes the effects of an action.
* If implemented, `coalesce(ncom: ICommand): CoalescenceResult` allows multiple actions close in time to be coalesced into a single logical undoable action. It takes in a second `ICommand` object prior to execution, optionally updates internal state to account for the effects of the second object, and returns:
    - `IMMISCIBLE` to indicate that coalescence was impossible, and the second command should be executed independently.
    - `COALESCED` to indicate that the effects of the second command have been accounted for and it need not be executed independently.
    - `UNDONE` to indicate that the effects of the second command have been accounted for and they served to manually undo the effects of the current command; thus, the current command should be dropped from the history.
* `isNoop(): boolean` indicates whether a command in its current state represents a no-op. This can change over time if an object is altered by coalescence, and thus a means of checking this state must be provided separately from the return value of `execute()`.
* `description: string` provides a user-facing description of the action for purposes of communicating the current state of the undo and redo histories.

API
====

`CommandHistory` instances have the following public API:

* `new CommandHistory({ cleanup = () => {}, coalescenceWindow = 3000, verbose = true })`
    - `cleanup` specifies a function to be run automatically after every undo or redo; this is intended to allow, e.g., automatically refreshing UI state so that that logic need not be duplicated in every `ICommand` type.
    - `coalescenceWindow` specifies the number of milliseconds that must pass between two actions for them to be considered ineligible for coalescence.
    - `verbose` indicates whether or not the `CommandHistory` instance should print info messages to the console.
* `readonly undoCount` indicates the current depth of the undo stack.
* `readonly redoCount` indicates the current depth of the redo stack.
* `readonly undoDescription` gets the description for the command at the top of the undo stack.
* `readonly redoDescription` gets the description for the command at the top of the redo stack.
* `async undo(levels: number = 1)` undoes `levels` commands starting at the top of the undo stack and moves them to the redo stack. 
* `async redo(levels: number = 1)` redoes `levels` commands starting at the top of the redo stack and moves them to the undo stack.
* `pop()` removes a command from the undo stack without actually undoing it, or adding it to the redo stack; this can be used if, for example, a particular command cannot be safely undone because of changes to remote state, but earlier commands can still be undone without inducing inconsistency; however, this should not be used very often, as most of these cases can be handled by internal mechanisms in the undo-redo system.
* `clear()` simply eliminates all entried from both the undo and redo stacks.
* `coalescenceBarrier()` provides a means of manually preventing the last command from coalescing with later commands. Coalescence barriers are inserted automatically after calls to `undo()` or `redo()`.
* `async execute<A extends any[], C extends ICommand>(ctor: new (...args: A) => C, ...args: A)` forms the core of the command history service. This takes in a typename, or constructor, for a specific undoable command (an object conforming to the ICommand interface), followed by all of the arguments required by that constructor (if any). This method constructs a new `ICommand` object, queries the most recent earlier command to see if it can be coalesced, and, if not, executes it and adds it to the undo stack if it was not a no-op. By taking in a constructor argument and constructing `ICommand` objects internally rather than allowing pre-constructed `ICommand` objects to be passed it, the command history system ensures that no methods can be called or state altered on `ICommand` objects outside of the system, and thus protects against accidental data corruption that may result from, e.g., multiple commands having `undo` called concurrently or out-of-order.

`undo()`, `redo()`, `pop()`, `clear()`, and `execute()` are temporally exclusive; none of these methods can be called as long as the `Promise` returned by a prior call to `undo()`, `redo()`, or `execute()` has not yet resolved.