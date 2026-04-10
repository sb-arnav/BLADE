// src/lib/stateMachine.ts
// Industrial-grade finite state machine for background agents.
// Based on XState principles for maximum deterministic execution.

export type TransitionCallback<C, E> = (context: C, event: E) => Promise<Partial<C> | void>;

export interface StateNode<C, E> {
  on?: Record<string, string>;
  invoke?: {
    src: TransitionCallback<C, E>;
    onDone: string;
    onError: string;
  };
  entry?: TransitionCallback<C, E>[];
  exit?: TransitionCallback<C, E>[];
}

export interface FSMConfig<C, E> {
  id: string;
  initial: string;
  context: C;
  states: Record<string, StateNode<C, E>>;
}

export class StateMachine<C, E extends { type: string; [key: string]: any }> {
  private config: FSMConfig<C, E>;
  private currentState: string;
  private currentContext: C;
  private isProcessing = false;

  constructor(config: FSMConfig<C, E>) {
    this.config = config;
    this.currentState = config.initial;
    this.currentContext = { ...config.context };
  }

  get state() {
    return this.currentState;
  }

  get context() {
    return this.currentContext;
  }

  /**
   * Resumes the machine from a persisted state block.
   */
  public hydrate(persistedState: string, persistedContext: C) {
    if (this.config.states[persistedState]) {
      this.currentState = persistedState;
      this.currentContext = { ...persistedContext };
    }
  }

  /**
   * Dispatches an event, transitioning the machine if valid.
   */
  public async send(event: E): Promise<void> {
    if (this.isProcessing) {
      console.warn(`[FSM ${this.config.id}] Dropping event ${event.type}; transition already in progress.`);
      return;
    }

    const stateNode = this.config.states[this.currentState];
    if (!stateNode) return;

    const nextStateKey = stateNode.on?.[event.type];
    
    if (nextStateKey && this.config.states[nextStateKey]) {
      this.isProcessing = true;
      
      try {
        // Run exit actions on old state
        if (stateNode.exit) {
          for (const action of stateNode.exit) {
            await action(this.currentContext, event);
          }
        }
        
        // Transition
        const oldState = this.currentState;
        this.currentState = nextStateKey;
        const nextStateNode = this.config.states[nextStateKey];

        // Run entry actions on new state
        if (nextStateNode.entry) {
          for (const action of nextStateNode.entry) {
            const contextUpdate = await action(this.currentContext, event);
            if (contextUpdate) {
              this.currentContext = { ...this.currentContext, ...contextUpdate };
            }
          }
        }

        console.debug(`[FSM ${this.config.id}] Transited from ${oldState} -> ${this.currentState}`);

        // Handle auto-invoked promises
        if (nextStateNode.invoke) {
          this.executeInvoke(nextStateNode.invoke, event); // Do not block send()
        }
      } finally {
        this.isProcessing = false;
      }
    }
  }

  private async executeInvoke(invokeConfig: StateNode<C, E>['invoke'], event: E) {
    if (!invokeConfig) return;
    try {
      const result = await invokeConfig.src(this.currentContext, event);
      if (result) {
        this.currentContext = { ...this.currentContext, ...result };
      }
      this.send({ type: 'DONE', data: result } as unknown as E);
    } catch (e: any) {
      this.send({ type: 'ERROR', error: e.message } as unknown as E);
    }
  }
}
