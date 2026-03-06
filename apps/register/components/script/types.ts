export type ScriptStepType =
    | 'text'
    | 'checkbox'
    | 'radio'
    | 'custom'
    | 'marketing_channel'
    | 'info'
    | 'wait'; // 'wait' for server processing

export interface ScriptOption {
    label: string;
    value: any;
}

/**
 * Parameterized step visibility: show this step only when the condition holds.
 * Field paths can use {{eventCode}} which is replaced with context.event.aid.
 */
export type StepConditionConfig =
    | { type: 'fieldEquals'; field: string; value: any }
    | { type: 'fieldOneOf'; field: string; keys: string[] }
    | { type: 'fieldExactlyOneOf'; field: string; keys: string[] }
    | { type: 'fieldNoneOf'; field: string; keys: string[] };

export interface ScriptStep {
    id: string;
    type: ScriptStepType;
    promptKey?: string; // Key for looking up localized text
    field?: string; // Object path to bind to (e.g. "student.practice.current")
    condition?: (context: ScriptContext) => boolean;
    /** When set, step is only shown when this condition is true (e.g. based on a previous step's answer). */
    showWhen?: StepConditionConfig;
    options?: ScriptOption[];
    component?: React.ComponentType<any>; // Custom component for 'custom' type
    validation?: (value: any, context: ScriptContext) => string | null; // Returns error message or null
    defaultValue?: any;
    optional?: boolean;
}

export interface ScriptContext {
    student: any;
    event: any;
    config: any;
    /** Signers by aid (e.g. eventCode, eventCode-my, eventCode-vy) for supplication body display. */
    signers?: Record<string, string[]>;
    /** When set (e.g. test mode oath override), used instead of sharedFrontend checkEligibility for eligibility checks. */
    checkEligibility?: (poolName: string, studentData: any, currentAid: string, allPoolsData: any[]) => boolean;
    [key: string]: any;
}

export interface ScriptDefinition {
    steps: ScriptStep[];
}
